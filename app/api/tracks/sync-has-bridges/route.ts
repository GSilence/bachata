import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import type { GridMap } from "@/types";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/tracks/sync-has-bridges
 * Синхронизирует колонку hasBridges из gridMap по всем трекам.
 * Только для админа (меняет данные в БД).
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!prisma) return NextResponse.json({ updated: 0 });

  const tracks = await prisma.track.findMany({});
  let updated = 0;

  for (const track of tracks) {
    const gm = (track.gridMap as GridMap) || {};
    const computed =
      (Array.isArray(gm.bridges) && gm.bridges.length > 0) ||
      (Array.isArray(gm.v2Layout) && gm.v2Layout.length > 1);
    const current = (track as { hasBridges?: boolean }).hasBridges ?? false;
    if (current === computed) continue;

    await prisma.track.update({
      where: { id: track.id },
      data: { hasBridges: computed },
    });
    updated++;
  }

  return NextResponse.json({ updated, total: tracks.length });
}
