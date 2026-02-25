import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { GridMap } from "@/types";
import { requireAdmin } from "@/lib/auth";

/**
 * POST /api/rhythm/apply-layout
 * Body: { track_id: number, type: 'rms' | 'perc' }
 * Переключает активную раскладку v2Layout в gridMap трека.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const trackId =
      typeof body.track_id === "number"
        ? body.track_id
        : parseInt(body.track_id, 10);
    const type = body.type as "rms" | "perc";

    if (isNaN(trackId) || (type !== "rms" && type !== "perc")) {
      return NextResponse.json(
        { error: "Invalid track_id or type (must be 'rms' or 'perc')" },
        { status: 400 },
      );
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

    const gridMapData = track.gridMap as GridMap | null;
    if (!gridMapData || typeof gridMapData !== "object") {
      return NextResponse.json(
        { error: "Track has no gridMap, run analysis first" },
        { status: 400 },
      );
    }

    const sourceLayout =
      type === "perc" ? gridMapData.v2LayoutPerc : gridMapData.v2LayoutRms;

    if (!sourceLayout || sourceLayout.length === 0) {
      return NextResponse.json(
        { error: `Layout '${type}' not found, run v2 analysis first` },
        { status: 400 },
      );
    }

    // Мостики для визуальных маркеров = time_start каждого сегмента кроме первого
    const bridgeTimes = sourceLayout.slice(1).map((s) => s.time_start);

    const updatedGridMap: GridMap = {
      ...gridMapData,
      v2Layout: sourceLayout,
      bridges: bridgeTimes, // визуальные маркеры совпадают с началами сегментов
    };

    const updated = await prisma.track.update({
      where: { id: trackId },
      data: { gridMap: updatedGridMap as object },
    });

    return NextResponse.json({ success: true, track: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Apply layout error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
