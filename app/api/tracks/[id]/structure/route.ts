import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { existsSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

const execAsync = promisify(exec);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/tracks/[id]/structure
 * Runs MSAF structure analysis on the track audio.
 * Does NOT modify the track record — returns analysis results only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const trackId = parseInt(params.id, 10);
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

    const pythonPath = process.env.DEMUCS_PYTHON_PATH || "python";
    const scriptPath = join(process.cwd(), "scripts", "analyze_structure_msaf.py");

    if (!existsSync(scriptPath)) {
      return NextResponse.json(
        { error: "Structure analysis script not found" },
        { status: 500 },
      );
    }

    const command = `"${pythonPath}" "${scriptPath}" "${filePath}"`;
    console.log(`[Structure] Running: ${command}`);

    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300000,
    });

    if (stderr) {
      console.log(`[Structure] stderr: ${stderr}`);
    }

    const result = JSON.parse(stdout.trim());

    return NextResponse.json({
      success: true,
      trackId,
      ...result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Structure analysis error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
