import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { GridMap } from "@/types";
import { requireAdmin } from "@/lib/auth";

/**
 * POST /api/rhythm/update-bridges
 * Body: { track_id: number, bridges: number[] }
 * Обновляет массив бриджей в gridMap трека.
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
    const bridges = body.bridges;

    if (isNaN(trackId) || !Array.isArray(bridges)) {
      return NextResponse.json(
        { error: "Invalid track_id or bridges (must be array of numbers)" },
        { status: 400 },
      );
    }

    for (const b of bridges) {
      if (typeof b !== "number" || isNaN(b) || b < 0) {
        return NextResponse.json(
          { error: "Each bridge must be a non-negative number (seconds)" },
          { status: 400 },
        );
      }
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

    const gridMapData = track.gridMap as GridMap | null;
    if (!gridMapData || typeof gridMapData !== "object") {
      return NextResponse.json(
        { error: "Track has no gridMap, run analysis first" },
        { status: 400 },
      );
    }

    const updatedGridMap: GridMap = {
      ...gridMapData,
      bridges: [...bridges].sort((a, b) => a - b),
    };

    const updated = await prisma.track.update({
      where: { id: trackId },
      data: {
        gridMap: updatedGridMap as object,
      },
    });

    return NextResponse.json({
      success: true,
      track: updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Update bridges error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
