import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/mod-queue
 * Все записи ModQueue кроме done.
 * Включает trак, email назначенного пользователя, staleSec.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  // Удаляем сиротские записи (трек удалён, а ModQueue осталась)
  await prisma.modQueue.deleteMany({
    where: { track: null as any },
  }).catch(() => {});
  // Fallback: прямой SQL на случай если Prisma не поддерживает null-фильтр на relation
  await prisma.$executeRawUnsafe(
    "DELETE FROM ModQueue WHERE trackId NOT IN (SELECT id FROM Track)"
  ).catch(() => {});

  const entries = await prisma.modQueue.findMany({
    where: { status: { not: "done" } },
    orderBy: { createdAt: "asc" },
    include: {
      track: { select: { id: true, title: true, artist: true } },
    },
  });

  const now = Date.now();

  // Собираем userId для fetchUser
  const userIds = [...new Set(entries.map((e) => e.assignedTo).filter(Boolean) as number[])];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
    : [];
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.email]));

  const result = entries.map((e) => ({
    id: e.id,
    trackId: e.trackId,
    status: e.status,
    swapCount: e.swapCount,
    createdAt: e.createdAt,
    assignedAt: e.assignedAt,
    staleSec: e.assignedAt ? Math.round((now - new Date(e.assignedAt).getTime()) / 1000) : null,
    userEmail: e.assignedTo ? (userMap[e.assignedTo] ?? null) : null,
    track: e.track,
  }));

  return NextResponse.json(result);
}
