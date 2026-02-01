import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { GridMap } from "@/types";

/**
 * POST /api/rhythm/update-offset
 * Body: { track_id: number, new_offset: number }
 * Обновляет offset трека и пересчитывает gridMap.downbeats при необходимости.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const trackId =
      typeof body.track_id === "number"
        ? body.track_id
        : parseInt(body.track_id, 10);
    const newOffset =
      typeof body.new_offset === "number"
        ? body.new_offset
        : parseFloat(body.new_offset);

    if (isNaN(trackId) || isNaN(newOffset) || newOffset < 0) {
      return NextResponse.json(
        { error: "Invalid track_id or new_offset (must be >= 0)" },
        { status: 400 },
      );
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

    const oldOffset = track.offset;
    const delta = newOffset - oldOffset;

    let gridMapData: GridMap | Record<string, unknown> | null =
      track.gridMap as GridMap | null;
    if (gridMapData && typeof gridMapData === "object") {
      const grid = { ...gridMapData } as GridMap & Record<string, unknown>;
      grid.offset = newOffset;

      const downbeats = (grid as GridMap).downbeats;
      if (Array.isArray(downbeats) && downbeats.length > 0) {
        const shifted = downbeats.map((t) => t + delta).filter((t) => t >= 0);
        (grid as GridMap).downbeats = shifted;
      }

      gridMapData = grid;
    }

    const updated = await prisma.track.update({
      where: { id: trackId },
      data: {
        offset: newOffset,
        gridMap: gridMapData as object | null,
      },
    });

    return NextResponse.json({
      success: true,
      track: updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Update offset error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
