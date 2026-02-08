import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { existsSync } from "fs";
import { analyzeTrack, type AnalyzerType } from "@/lib/analyzeAudio";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/tracks/[id]/reanalyze
 * Body: { analyzer?: 'basic' | 'extended' }
 * Перезапускает анализ ритма для трека и перезаписывает bpm, offset, gridMap в БД.
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

    const body = await request.json().catch(() => ({}));
    const validAnalyzers: AnalyzerType[] = ["basic", "extended", "correlation"];
    const analyzer: AnalyzerType = validAnalyzers.includes(body.analyzer)
      ? body.analyzer
      : "correlation";

    const relativePath = pathOriginal.replace(/^\//, "");
    const filePath = join(process.cwd(), "public", relativePath);
    if (!existsSync(filePath)) {
      return NextResponse.json(
        { error: "Original audio file not found on disk" },
        { status: 404 },
      );
    }

    const analysisResult = await analyzeTrack(filePath, {
      analyzer,
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
      const existing = (track.gridMap as Record<string, unknown>) || {};
      if (existing.metadata) {
        gridMapData.metadata = existing.metadata;
      }
    }

    const updated = await prisma.track.update({
      where: { id: trackId },
      data: {
        bpm: finalBpm,
        offset: finalOffset,
        baseBpm: finalBpm,
        baseOffset: finalOffset,
        analyzerType: analyzer,
        gridMap: gridMapData,
      },
    });

    return NextResponse.json({
      success: true,
      track: updated,
      message: `Re-analyzed with ${analyzer} analyzer`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Reanalyze error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
