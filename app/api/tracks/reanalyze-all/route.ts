import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { existsSync } from "fs";
import { analyzeTrack } from "@/lib/analyzeAudio";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 минут

/**
 * POST /api/tracks/reanalyze-all
 * Перезапускает корреляционный анализ для ВСЕХ треков
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const tracks = await prisma.track.findMany({
      select: {
        id: true,
        title: true,
        pathOriginal: true,
        createdAt: true,
      },
      orderBy: { id: "asc" },
    });

    const results: { id: number; title: string; status: string; error?: string }[] = [];

    for (const track of tracks) {
      if (!track.pathOriginal) {
        results.push({ id: track.id, title: track.title, status: "skipped", error: "No original file" });
        continue;
      }

      const relativePath = track.pathOriginal.replace(/^\//, "");
      const filePath = join(process.cwd(), "public", relativePath);

      if (!existsSync(filePath)) {
        results.push({ id: track.id, title: track.title, status: "skipped", error: "File not found" });
        continue;
      }

      try {
        console.log(`[ReanalyzeAll] Processing: ${track.title} (ID: ${track.id})`);

        const analysisResult = await analyzeTrack(filePath, {
          analyzer: "correlation",
          reportName: track.title,
          reportDate: track.createdAt,
        });

        const finalBpm = Math.round(analysisResult.bpm);
        const finalOffset = analysisResult.offset;

        let gridMapData: Record<string, unknown> | null = null;
        if (analysisResult.gridMap) {
          gridMapData = {
            ...JSON.parse(JSON.stringify(analysisResult.gridMap)),
            duration: analysisResult.duration,
          };
          // Preserve existing metadata
          const existing = (await prisma.track.findUnique({ where: { id: track.id } }))?.gridMap as Record<string, unknown> | null;
          if (existing?.metadata) {
            gridMapData.metadata = existing.metadata;
          }
        }

        await prisma.track.update({
          where: { id: track.id },
          data: {
            bpm: finalBpm,
            offset: finalOffset,
            baseBpm: finalBpm,
            baseOffset: finalOffset,
            analyzerType: "correlation",
            gridMap: gridMapData,
          },
        });

        results.push({ id: track.id, title: track.title, status: "success" });
        console.log(`[ReanalyzeAll] Done: ${track.title}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ id: track.id, title: track.title, status: "error", error: msg });
        console.error(`[ReanalyzeAll] Error for ${track.title}:`, msg);
      }
    }

    const success = results.filter((r) => r.status === "success").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const errors = results.filter((r) => r.status === "error").length;

    return NextResponse.json({
      message: `Reanalyzed ${success}/${tracks.length} tracks`,
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
