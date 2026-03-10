import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/tracks/[id]/play
 * Инкрементирует счётчик прослушиваний.
 * Месячный счётчик сбрасывается автоматически при смене месяца.
 * Доступно для всех (включая гостей) — только подсчёт.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {

  const { id } = await params;
  const trackId = parseInt(id, 10);
  if (isNaN(trackId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const { prisma } = await import("@/lib/prisma");
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { id: true, playsMonthResetAt: true },
  });
  if (!track) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const resetAt = track.playsMonthResetAt;
  const sameMonth =
    resetAt &&
    resetAt.getFullYear() === now.getFullYear() &&
    resetAt.getMonth() === now.getMonth();

  if (sameMonth) {
    // Тот же месяц — просто инкрементируем оба счётчика
    await prisma.track.update({
      where: { id: trackId },
      data: { playsTotal: { increment: 1 }, playsMonth: { increment: 1 } },
    });
  } else {
    // Новый месяц (или первое прослушивание) — сбрасываем месячный счётчик
    await prisma.track.update({
      where: { id: trackId },
      data: { playsTotal: { increment: 1 }, playsMonth: 1, playsMonthResetAt: now },
    });
  }

  return NextResponse.json({ ok: true });
}
