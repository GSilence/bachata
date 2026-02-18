import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

const execAsync = promisify(exec);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function getResultPath(trackTitle: string): string {
  const safe = trackTitle.replace(/[^a-zA-Z0-9_\-а-яА-ЯёЁ ]/g, "_");
  return join(process.cwd(), "public", "uploads", "reports", `${safe}_bridge_analysis.json`);
}

/**
 * GET /api/tracks/[id]/bridge-analysis
 * Returns saved bridge analysis results if available.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const trackId = parseInt(id, 10);
    if (isNaN(trackId)) {
      return NextResponse.json({ error: "Invalid track ID" }, { status: 400 });
    }

    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 500 });
    }

    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    // Derive filename from audio file (same as Python script uses)
    const pathOriginal = track.pathOriginal;
    if (!pathOriginal) {
      return NextResponse.json({ found: false });
    }
    const audioBasename = pathOriginal.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
    const resultPath = join(process.cwd(), "public", "uploads", "reports", `${audioBasename}_bridge_analysis.json`);

    if (!existsSync(resultPath)) {
      return NextResponse.json({ found: false });
    }

    const data = JSON.parse(readFileSync(resultPath, "utf-8"));
    return NextResponse.json({ found: true, ...data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/tracks/[id]/bridge-analysis
 * Runs Spleeter-based bridge detection on the track audio.
 * Saves results to JSON file for persistence.
 *
 * Body (optional): { threshold?: number, window_beats?: number }
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

  try {
    const { id } = await params;
    const trackId = parseInt(id, 10);
    if (isNaN(trackId)) {
      return NextResponse.json({ error: "Invalid track ID" }, { status: 400 });
    }

    if (!prisma) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 500 },
      );
    }

    const track = await prisma.track.findUnique({
      where: { id: trackId },
    });
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    const pathOriginal = track.pathOriginal;
    if (!pathOriginal) {
      return NextResponse.json(
        { error: "Track has no original file path" },
        { status: 400 },
      );
    }

    const relativePath = pathOriginal.replace(/^\//, "");
    const filePath = join(process.cwd(), "public", relativePath);
    if (!existsSync(filePath)) {
      return NextResponse.json(
        { error: "Original audio file not found on disk" },
        { status: 404 },
      );
    }

    // Get BPM and offset from track record
    const bpm = track.bpm || 130;
    const offset = track.offset || 0;

    // Optional params from request body
    const body = await request.json().catch(() => ({}));
    const threshold = body.threshold ?? 0.15;
    const windowBeats = body.window_beats ?? 4;

    const pythonPath = process.env.DEMUCS_PYTHON_PATH || "python";
    const scriptPath = join(process.cwd(), "scripts", "analyze_bridge_spleeter.py");

    if (!existsSync(scriptPath)) {
      return NextResponse.json(
        { error: "Bridge analysis script not found" },
        { status: 500 },
      );
    }

    const command = `"${pythonPath}" "${scriptPath}" "${filePath}" ${bpm} ${offset} ${threshold} ${windowBeats}`;
    console.log(`[Bridge] Running: ${command}`);

    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300000,
    });

    if (stderr) {
      console.log(`[Bridge] stderr: ${stderr}`);
    }

    const result = JSON.parse(stdout.trim());

    // Save results to JSON file for persistence
    const audioBasename = pathOriginal.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
    const resultPath = join(process.cwd(), "public", "uploads", "reports", `${audioBasename}_bridge_analysis.json`);
    const toSave = { success: true, trackId, ...result };
    writeFileSync(resultPath, JSON.stringify(toSave, null, 2));
    console.log(`[Bridge] Results saved: ${resultPath}`);

    return NextResponse.json(toSave);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Bridge analysis error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
