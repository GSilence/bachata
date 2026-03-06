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
  });
  if (existing) {
    const track = await prisma.track.findUnique({ where: { id: existing.trackId }, select: TRACK_SELECT });
    if (!track) {
      // Сиротская запись — удаляем, продолжаем к назначению нового
      await prisma.modQueue.delete({ where: { id: existing.id } }).catch(() => {});
    } else {
      return NextResponse.json({
        modQueueId: existing.id,
        swapCount: existing.swapCount,
        track,
      });
    }
  }

  // Берём первый pending, пропуская сиротские записи (трек удалён)
  let entry: any = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await prisma.$transaction(async (tx) => {
      const pending = await tx.modQueue.findFirst({
        where: { status: "pending" },
        orderBy: { createdAt: "asc" },
      });
      if (!pending) return null;

      // Проверяем, существует ли трек
      const track = await tx.track.findUnique({ where: { id: pending.trackId } });
      if (!track) {
        // Сиротская запись — удаляем и сигнализируем retry
        await tx.modQueue.delete({ where: { id: pending.id } });
        return "orphan";
      }

      return tx.modQueue.update({
        where: { id: pending.id },
        data: { status: "assigned", assignedTo: authUser.userId, assignedAt: new Date() },
        include: { track: { select: TRACK_SELECT } },
      });
    });

    if (result === "orphan") continue; // пропускаем, берём следующий
    entry = result;
    break;
  }

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
