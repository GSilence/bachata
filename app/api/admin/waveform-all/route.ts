import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isS3Enabled, downloadFile, keyFromUrl } from "@/lib/storage";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

const execAsync = promisify(exec);

/**
 * GET /api/admin/waveform-all
 * Returns stats: how many tracks have/don't have waveform data.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const [total, withWaveform] = await Promise.all([
    prisma.track.count(),
    prisma.track.count({ where: { waveformData: { not: null } } }),
  ]);

  return NextResponse.json({ total, withWaveform, without: total - withWaveform });
}

/**
 * POST /api/admin/waveform-all
 * Process one track without waveform. Call repeatedly to process all.
 * Returns { processed, trackId, title, remaining } or { done: true }.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const track = await prisma.track.findFirst({
    where: { waveformData: null },
    select: { id: true, pathOriginal: true, filename: true, title: true },
    orderBy: { id: "asc" },
  });

  if (!track) {
    return NextResponse.json({ done: true, message: "All tracks have waveform data" });
  }

  const pythonPath = process.env.DEMUCS_PYTHON_PATH || "python";
  const scriptPath = join(process.cwd(), "scripts", "generate-waveform.py");

  let tempPath: string | null = null;

  try {
    let filePath: string;

    if (isS3Enabled() && track.pathOriginal) {
      const s3Key = keyFromUrl(track.pathOriginal);
      if (!s3Key) throw new Error("Cannot determine S3 key");
      const ext = s3Key.split(".").pop() || "mp3";
      tempPath = join(tmpdir(), `wf_${randomBytes(8).toString("hex")}.${ext}`);
      await downloadFile(s3Key, tempPath);
      filePath = tempPath;
    } else {
      const rawPath = join(process.cwd(), "public", "uploads", "raw", track.filename);
      if (!existsSync(rawPath)) throw new Error("File not found");
      filePath = rawPath;
    }

    const { stdout } = await execAsync(
      `"${pythonPath}" "${scriptPath}" "${filePath}"`,
      { maxBuffer: 1 * 1024 * 1024, timeout: 120_000 },
    );

    const result = JSON.parse(stdout.trim());
    if (result.error) throw new Error(result.error);
    if (!result.peaks?.length) throw new Error("Empty peaks array");

    await prisma.track.update({
      where: { id: track.id },
      data: { waveformData: JSON.stringify(result.peaks) },
    });

    const remaining = await prisma.track.count({ where: { waveformData: null } });

    return NextResponse.json({ processed: true, trackId: track.id, title: track.title, remaining });
  } catch (err: any) {
    // Mark with "error" to skip on next call and not loop forever
    try {
      await prisma.track.update({ where: { id: track.id }, data: { waveformData: "error" } });
    } catch {}
    const remaining = await prisma.track.count({ where: { waveformData: null } });
    return NextResponse.json({ processed: false, trackId: track.id, title: track.title, error: err.message, remaining });
  } finally {
    if (tempPath) {
      try { unlinkSync(tempPath); } catch {}
    }
  }
}
