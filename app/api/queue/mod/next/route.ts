import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isAdmin, isModerator } from "@/lib/roles";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Поля трека, нужные audioEngine для воспроизведения с раскладкой
const TRACK_SELECT = {
  id: true, title: true, artist: true,
  filename: true, bpm: true, baseBpm: true,
  offset: true, baseOffset: true,
  isFree: true, createdAt: true,
  pathOriginal: true,
  pathVocals: true, pathDrums: true, pathBass: true, pathOther: true,
  isProcessed: true,
  gridMap: true,
  rowSwapped: true, rowDominancePercent: true, hasBridges: true,
  trackStatus: true, hasAccents: true, hasMambo: true,
  genreHint: true,
  metaTitle: true, metaArtist: true, metaAlbum: true,
  metaYear: true, metaGenre: true, metaComment: true, metaTrackNum: true,
};

/**
 * GET /api/queue/mod/next
 * Возвращает следующий трек для модерации.
 * - Если уже есть assigned трек для этого пользователя → возвращает его
 * - Иначе: берёт первый pending → атомарно назначает
 */
export async function GET(request: NextRequest) {
  let authUser: { userId: number; email: string; role: string };
  try {
    authUser = await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isModerator(authUser.role) && !isAdmin(authUser.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  // Проверяем: есть ли уже назначенный трек у этого пользователя
  const existing = await prisma.modQueue.findFirst({
    where: { assignedTo: authUser.userId, status: "assigned" },
    include: { track: { select: TRACK_SELECT } },
  });
  if (existing) {
    return NextResponse.json({
      modQueueId: existing.id,
      swapCount: existing.swapCount,
      track: existing.track,
    });
  }

  // Берём первый pending в транзакции
  const entry = await prisma.$transaction(async (tx) => {
    const pending = await tx.modQueue.findFirst({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
    });
    if (!pending) return null;
    return tx.modQueue.update({
      where: { id: pending.id },
      data: { status: "assigned", assignedTo: authUser.userId, assignedAt: new Date() },
      include: { track: { select: TRACK_SELECT } },
    });
  });

  if (!entry) {
    return NextResponse.json({ modQueueId: null, track: null });
  }

  // Лог назначения
  try {
    await prisma.trackLog.create({
      data: {
        trackId: entry.trackId,
        userId: authUser.userId,
        event: "mod_assigned",
        details: { email: authUser.email },
      },
    });
  } catch {}

  return NextResponse.json({
    modQueueId: entry.id,
    swapCount: entry.swapCount,
    track: entry.track,
  });
}
