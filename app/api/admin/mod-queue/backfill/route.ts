import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/mod-queue/backfill
 * Добавляет в ModQueue все unlistened-треки (не popsa), у которых ещё нет записи.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  // Треки со статусом unlistened, у которых нет записи в ModQueue
  const tracks = await prisma.track.findMany({
    where: {
      trackStatus: "unlistened",
      modQueue: null,
    },
    select: { id: true },
  });

  if (tracks.length === 0) {
    return NextResponse.json({ added: 0, message: "Все треки уже в очереди." });
  }

  let added = 0;
  for (const t of tracks) {
    try {
      await prisma.modQueue.create({ data: { trackId: t.id } });
      added++;
    } catch {
      // unique constraint — уже есть, пропускаем
    }
  }

  return NextResponse.json({ added, total: tracks.length });
}
