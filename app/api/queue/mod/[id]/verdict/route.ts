import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isAdmin, isModerator } from "@/lib/roles";
import { prisma } from "@/lib/prisma";
import { performSwap } from "@/lib/swapRows";

export const dynamic = "force-dynamic";

/**
 * POST /api/queue/mod/[id]/verdict
 * Вердикт модератора по треку.
 * Body: { layoutCorrect: boolean, hasMambo: boolean, hasAccents: boolean }
 *
 * Логика:
 *  - layoutCorrect=true → approved, ModQueue done
 *  - layoutCorrect=false + swapCount=0 → swap рядов, swapCount=1, return swap_and_continue
 *  - layoutCorrect=false + swapCount≥1 → moderation, ModQueue done
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  const modQueueId = parseInt(id, 10);
  if (isNaN(modQueueId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const { layoutCorrect, hasMambo, hasAccents, notBachata } = body;

  if (notBachata !== true && typeof layoutCorrect !== "boolean") {
    return NextResponse.json({ error: "layoutCorrect (boolean) обязателен" }, { status: 400 });
  }

  const entry = await prisma.modQueue.findUnique({
    where: { id: modQueueId },
    include: { track: { select: { id: true, trackStatus: true, title: true } } },
  });

  if (!entry) {
    return NextResponse.json({ error: "Запись очереди не найдена" }, { status: 404 });
  }
  if (entry.status === "done") {
    return NextResponse.json({ error: "Трек уже обработан" }, { status: 409 });
  }
  // Только назначенный мод или admin
  if (!isAdmin(authUser.role) && entry.assignedTo !== authUser.userId) {
    return NextResponse.json({ error: "Этот трек назначен другому модератору" }, { status: 403 });
  }

  const trackId = entry.trackId;

  // ── Не бачата → popsa ────────────────────────────────────────────────
  if (notBachata === true) {
    await prisma.track.update({
      where: { id: trackId },
      data: { trackStatus: "popsa" },
    });
    await prisma.modQueue.update({
      where: { id: modQueueId },
      data: { status: "done" },
    });
    try {
      await prisma.trackLog.createMany({
        data: [
          { trackId, userId: authUser.userId, event: "mod_verdict_not_bachata", details: { email: authUser.email } },
          { trackId, userId: authUser.userId, event: "status_change", details: { email: authUser.email, oldStatus: entry.track.trackStatus, newStatus: "popsa" } },
        ],
      });
    } catch {}
    return NextResponse.json({ action: "not_bachata" });
  }

  if (layoutCorrect) {
    // ── ВЕРНО → approved ──────────────────────────────────────────────
    await prisma.track.update({
      where: { id: trackId },
      data: {
        trackStatus: "approved",
        hasMambo: hasMambo === true,
        hasAccents: hasAccents === true,
      },
    });
    await prisma.modQueue.update({
      where: { id: modQueueId },
      data: { status: "done" },
    });
    try {
      await prisma.trackLog.createMany({
        data: [
          { trackId, userId: authUser.userId, event: "mod_verdict_correct", details: { email: authUser.email, hasMambo, hasAccents } },
          { trackId, userId: authUser.userId, event: "status_change", details: { email: authUser.email, oldStatus: "unlistened", newStatus: "approved" } },
        ],
      });
    } catch {}
    return NextResponse.json({ action: "approved" });
  }

  if (entry.swapCount === 0) {
    // ── НЕ ВЕРНО, первый раз → свап ───────────────────────────────────
    let updatedTrack;
    try {
      updatedTrack = await performSwap(trackId, prisma);
    } catch (e: any) {
      return NextResponse.json({ error: `Swap failed: ${e.message}` }, { status: 500 });
    }
    await prisma.modQueue.update({
      where: { id: modQueueId },
      data: { swapCount: 1 },
    });
    try {
      await prisma.trackLog.createMany({
        data: [
          { trackId, userId: authUser.userId, event: "mod_verdict_incorrect", details: { email: authUser.email } },
          { trackId, userId: authUser.userId, event: "rows_swapped", details: { email: authUser.email, reason: "mod_verdict_incorrect" } },
        ],
      });
    } catch {}
    return NextResponse.json({
      action: "swap_and_continue",
      track: {
        id: updatedTrack.id,
        bpm: updatedTrack.bpm,
        offset: updatedTrack.offset,
        baseOffset: updatedTrack.baseOffset,
        gridMap: updatedTrack.gridMap,
        rowSwapped: updatedTrack.rowSwapped,
      },
    });
  }

  // ── НЕ ВЕРНО, второй раз → откатить свап + moderation ──────────────────
  // Откатываем свап: трек уходит в модерацию в исходном виде (до свапа)
  try {
    await performSwap(trackId, prisma);
  } catch {
    // Если откат не удался — не критично, продолжаем
  }
  await prisma.track.update({
    where: { id: trackId },
    data: {
      trackStatus: "moderation",
      hasMambo: hasMambo === true,
      hasAccents: hasAccents === true,
    },
  });
  await prisma.modQueue.update({
    where: { id: modQueueId },
    data: { status: "done" },
  });
  try {
    await prisma.trackLog.createMany({
      data: [
        { trackId, userId: authUser.userId, event: "mod_verdict_incorrect_again", details: { email: authUser.email } },
        { trackId, userId: authUser.userId, event: "rows_swapped", details: { email: authUser.email, reason: "swap_reverted" } },
        { trackId, userId: authUser.userId, event: "status_change", details: { email: authUser.email, oldStatus: "unlistened", newStatus: "moderation" } },
      ],
    });
  } catch {}
  return NextResponse.json({ action: "moderation" });
}
