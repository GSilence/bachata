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

/**
 * GET /api/tracks/[id]/analyze-v2
 * Returns saved v2 analysis results if available.
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
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 500 },
      );
    }

    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    const pathOriginal = track.pathOriginal;
    if (!pathOriginal) {
      return NextResponse.json({ found: false });
    }

    const audioBasename = pathOriginal
      .replace(/^.*[\\/]/, "")
      .replace(/\.[^.]+$/, "");
    const resultPath = join(
      process.cwd(),
      "public",
      "uploads",
      "reports",
      `${audioBasename}_v2_analysis.json`,
    );

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
 * POST /api/tracks/[id]/analyze-v2
 * Runs v2 analysis (row dominance + bridge detection).
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

    const track = await prisma.track.findUnique({ where: { id: trackId } });
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
    const scriptPath = join(process.cwd(), "scripts", "analyze-track-v2.py");

    if (!existsSync(scriptPath)) {
      return NextResponse.json(
        { error: "V2 analysis script not found" },
        { status: 500 },
      );
    }

    const command = `"${pythonPath}" "${scriptPath}" "${filePath}"`;
    console.log(`[V2 Analysis] Running: ${command}`);

    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300000,
    });

    if (stderr) {
      console.log(`[V2 Analysis] stderr: ${stderr}`);
    }

    const result = JSON.parse(stdout.trim());

    // Save results to JSON file
    const audioBasename = pathOriginal
      .replace(/^.*[\\/]/, "")
      .replace(/\.[^.]+$/, "");
    const resultPath = join(
      process.cwd(),
      "public",
      "uploads",
      "reports",
      `${audioBasename}_v2_analysis.json`,
    );
    const toSave = { success: true, trackId, ...result };
    writeFileSync(resultPath, JSON.stringify(toSave, null, 2));
    console.log("[V2 Analysis] Results saved: " + resultPath);

    // Применяем раскладку v2 к треку в БД — счёт при воспроизведении будет учитывать мостики
    const existingGridMap = (track.gridMap as Record<string, unknown>) || {};
    const v2Layout = Array.isArray(result.layout) ? result.layout : [];
    const v2BridgesTimes = Array.isArray(result.bridges)
      ? (result.bridges as { time_sec?: number }[]).map((b) => b.time_sec ?? 0)
      : [];
    const mergedGridMap = {
      ...existingGridMap,
      bpm: result.bpm ?? track.bpm ?? existingGridMap.bpm,
      offset: track.offset ?? existingGridMap.offset,
      duration: result.duration ?? existingGridMap.duration,
      v2Layout,
      bridges:
        v2BridgesTimes.length > 0 ? v2BridgesTimes : existingGridMap.bridges,
    };
    await prisma.track.update({
      where: { id: trackId },
      data: { gridMap: mergedGridMap as object },
    });
    console.log(
      "[V2 Analysis] Track gridMap updated with v2Layout (" +
        v2Layout.length +
        " segments)",
    );

    return NextResponse.json(toSave);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[V2 Analysis] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
