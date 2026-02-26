import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

const execAsync = promisify(exec);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 минут

/**
 * POST /api/tracks/reanalyze-all
 * Перезапускает анализ v2 (ряды + мостики) для ВСЕХ треков.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 500 },
    );
  }

  const pythonPath = process.env.DEMUCS_PYTHON_PATH || "python";
  const scriptPath = join(process.cwd(), "scripts", "analyze-track-v2.py");
  if (!existsSync(scriptPath)) {
    return NextResponse.json(
      { error: "V2 analysis script not found: analyze-track-v2.py" },
      { status: 500 },
    );
  }

  try {
    const tracks = await prisma.track.findMany({
      select: {
        id: true,
        title: true,
        pathOriginal: true,
        gridMap: true,
      },
      orderBy: { id: "asc" },
    });

    const results: {
      id: number;
      title: string;
      status: string;
      error?: string;
    }[] = [];

    const reportsDir = join(process.cwd(), "public", "uploads", "reports");
    if (!existsSync(reportsDir)) {
      mkdirSync(reportsDir, { recursive: true });
    }

    for (const track of tracks) {
      if (!track.pathOriginal) {
        results.push({
          id: track.id,
          title: track.title,
          status: "skipped",
          error: "No original file",
        });
        continue;
      }

      const relativePath = track.pathOriginal.replace(/^\//, "");
      const filePath = join(process.cwd(), "public", relativePath);

      if (!existsSync(filePath)) {
        results.push({
          id: track.id,
          title: track.title,
          status: "skipped",
          error: "File not found",
        });
        continue;
      }

      try {
        console.log(`[ReanalyzeAll] V2: ${track.title} (ID: ${track.id})`);
        const command = `"${pythonPath}" "${scriptPath}" "${filePath}"`;
        const { stdout, stderr } = await execAsync(command, {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 300000,
        });
        if (stderr) console.log(`[ReanalyzeAll] stderr:`, stderr);
        const result = JSON.parse(stdout.trim());
        if (result.error) {
          throw new Error(result.error);
        }

        const finalBpm = result.bpm ?? 120;
        const finalOffset = result.song_start_time ?? 0;
        const v2LayoutRms = Array.isArray(result.layout) ? result.layout : [];
        const v2LayoutPerc = Array.isArray(result.layout_perc) ? result.layout_perc : [];
        // Визуальные маркеры мостиков = начала сегментов перцептивной (активной) раскладки
        const v2BridgesTimes = (v2LayoutPerc.length > 1 ? v2LayoutPerc : v2LayoutRms)
          .slice(1)
          .map((s: { time_start?: number }) => s.time_start ?? 0);
        const squareAnalysis = result.square_analysis as
          | { verdict?: string; row_dominance_pct?: number }
          | undefined;
        const rowDominancePercent =
          typeof squareAnalysis?.row_dominance_pct === "number"
            ? squareAnalysis.row_dominance_pct
            : undefined;

        const existingGridMap =
          (track.gridMap as Record<string, unknown>) || {};
        const mergedGridMap = {
          ...existingGridMap,
          bpm: finalBpm,
          offset: finalOffset,
          duration: result.duration ?? existingGridMap.duration,
          v2Layout: v2LayoutPerc,       // активная сетка = Perceptual по умолчанию
          v2LayoutRms,                  // RMS сетка
          v2LayoutPerc,                 // перцептивная сетка
          bridges: v2BridgesTimes,
          ...(rowDominancePercent != null && { rowDominancePercent }),
        };

        const audioBasename = track.pathOriginal
          .replace(/^.*[\\/]/, "")
          .replace(/\.[^.]+$/, "");
        const resultPath = join(
          reportsDir,
          `${audioBasename}_v2_analysis.json`,
        );
        writeFileSync(
          resultPath,
          JSON.stringify(
            { success: true, trackId: track.id, ...result },
            null,
            2,
          ),
        );

        await prisma.track.update({
          where: { id: track.id },
          data: {
            bpm: finalBpm,
            offset: finalOffset,
            baseBpm: finalBpm,
            baseOffset: finalOffset,
            analyzerType: "v2",
            gridMap: mergedGridMap as object,
          },
        });

        results.push({ id: track.id, title: track.title, status: "success" });
        console.log(`[ReanalyzeAll] Done: ${track.title}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({
          id: track.id,
          title: track.title,
          status: "error",
          error: msg,
        });
        console.error(`[ReanalyzeAll] Error for ${track.title}:`, msg);
      }
    }

    const success = results.filter((r) => r.status === "success").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const errors = results.filter((r) => r.status === "error").length;

    return NextResponse.json({
      message: `Reanalyzed ${success}/${tracks.length} tracks (v2)`,
      total: tracks.length,
      success,
      skipped,
      errors,
      results,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("ReanalyzeAll error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
