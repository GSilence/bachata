import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isModerator, isAdmin } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/tracks/[id]/moderate
 * Тело: { layoutCorrect: boolean, hasMambo: boolean, hasAccents: boolean }
 *
 * Доступно модераторам и админам.
 * Если layoutCorrect === true → trackStatus = "approved"
 * Если layoutCorrect === false → trackStatus = "moderation"
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let authUser;
  try {
    authUser = await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isModerator(authUser.role) && !isAdmin(authUser.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const trackId = parseInt(id, 10);
  if (isNaN(trackId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const { layoutCorrect, hasMambo, hasAccents } = await request
    .json()
    .catch(() => ({}));

  if (typeof layoutCorrect !== "boolean") {
    return NextResponse.json(
      { error: "layoutCorrect (boolean) обязателен" },
      { status: 400 },
    );
  }

  const { prisma } = await import("@/lib/prisma");
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { id: true, trackStatus: true },
  });

  if (!track) {
    return NextResponse.json({ error: "Трек не найден" }, { status: 404 });
  }

  if (track.trackStatus !== "unlistened") {
    return NextResponse.json(
      { error: "Трек уже прошёл модерацию" },
      { status: 409 },
    );
  }

  const newStatus = layoutCorrect ? "approved" : "moderation";

  const updated = await prisma.track.update({
    where: { id: trackId },
    data: {
      trackStatus: newStatus,
      hasMambo: hasMambo === true,
      hasAccents: hasAccents === true,
    },
    select: { id: true, trackStatus: true, hasMambo: true, hasAccents: true },
  });

  // Лог
  const logEvent = layoutCorrect ? "mod_verdict_correct" : "mod_verdict_incorrect_again";
  try {
    await prisma.trackLog.create({
      data: {
        trackId,
        userId: authUser.userId,
        event: logEvent,
        details: { email: authUser.email, layoutCorrect, hasMambo, hasAccents },
      },
    });
    await prisma.trackLog.create({
      data: {
        trackId,
        userId: authUser.userId,
        event: "status_change",
        details: { email: authUser.email, oldStatus: "unlistened", newStatus },
      },
    });
  } catch {}

  // Закрываем ModQueue
  try {
    await prisma.modQueue.updateMany({
      where: { trackId, status: { not: "done" } },
      data: { status: "done" },
    });
  } catch {}

  return NextResponse.json({ track: updated });
}
