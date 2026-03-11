import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { isS3Enabled, keyFromUrl, downloadFile } from "@/lib/storage";

export const runtime = "nodejs";

const execAsync = promisify(exec);

/**
 * GET /api/tracks/[id]/waveform
 * Returns stored waveform peaks (no auth required — used by player).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const trackId = parseInt(id, 10);
    if (isNaN(trackId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

    if (!prisma) return NextResponse.json({ error: "DB not configured" }, { status: 500 });

    const track = await prisma.track.findUnique({
      where: { id: trackId },
      select: { waveformData: true },
    });
    if (!track) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ waveformData: track.waveformData ?? null });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/tracks/[id]/waveform
 * Generates waveform peaks via Python and saves to DB. Admin only.
 * Supports both local files and S3 (downloads to temp, cleans up after).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let tempPath: string | null = null;

  try {
    const { id } = await params;
    const trackId = parseInt(id, 10);
    if (isNaN(trackId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

    if (!prisma) return NextResponse.json({ error: "DB not configured" }, { status: 500 });

    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (!track) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const pathOriginal = track.pathOriginal;
    if (!pathOriginal) return NextResponse.json({ error: "No audio file path" }, { status: 400 });

    let filePath: string;

    if (isS3Enabled()) {
      // S3 mode: download to temp file
      const s3Key = keyFromUrl(pathOriginal);
      if (!s3Key) return NextResponse.json({ error: "Cannot resolve S3 key from path" }, { status: 400 });

      const ext = s3Key.split(".").pop() || "mp3";
      tempPath = join(tmpdir(), `wf_${randomBytes(8).toString("hex")}.${ext}`);
      await downloadFile(s3Key, tempPath);
      filePath = tempPath;
    } else {
      // Local mode: resolve from public/
      const relativePath = pathOriginal.replace(/^\//, "");
      filePath = join(process.cwd(), "public", relativePath);
      if (!existsSync(filePath)) {
        return NextResponse.json({ error: "Audio file not found on disk" }, { status: 404 });
      }
    }

    const pythonPath = process.env.DEMUCS_PYTHON_PATH || "python";
    const scriptPath = join(process.cwd(), "scripts", "generate-waveform.py");

    if (!existsSync(scriptPath)) {
      return NextResponse.json({ error: "Waveform script not found" }, { status: 500 });
    }

    const { stdout } = await execAsync(
      `"${pythonPath}" "${scriptPath}" "${filePath}"`,
      { maxBuffer: 1 * 1024 * 1024, timeout: 120_000 },
    );

    const result = JSON.parse(stdout.trim());
    if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
    if (!result.peaks || !Array.isArray(result.peaks) || result.peaks.length === 0) {
      return NextResponse.json({ error: "Invalid waveform data from script" }, { status: 500 });
    }

    const waveformData = JSON.stringify(result.peaks);
    await prisma.track.update({
      where: { id: trackId },
      data: { waveformData },
    });

    return NextResponse.json({ ok: true, count: result.count, waveformData });
  } catch (err: unknown) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  } finally {
    // Always clean up temp file
    if (tempPath) {
      try { unlinkSync(tempPath); } catch { /* ignore */ }
    }
  }
}
