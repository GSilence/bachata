import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/logs?page=1&limit=50&event=X&track=title&user=email
 * Все логи событий, с пагинацией и фильтрами.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));
  const eventFilter = searchParams.get("event") || undefined;
  const trackSearch = searchParams.get("track")?.trim() || undefined;
  const userSearch = searchParams.get("user")?.trim() || undefined;
  const period = searchParams.get("period") || undefined; // today | yesterday | week

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (eventFilter) where.event = eventFilter;

  // Date filter
  if (period) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === "today") {
      where.createdAt = { gte: todayStart };
    } else if (period === "yesterday") {
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      where.createdAt = { gte: yesterdayStart, lt: todayStart };
    } else if (period === "week") {
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - 7);
      where.createdAt = { gte: weekStart };
    }
  }
  if (trackSearch) where.track = { is: { title: { contains: trackSearch } } };
  if (userSearch) {
    const matchingUsers = await prisma.user.findMany({
      where: { email: { contains: userSearch } },
      select: { id: true },
    });
    where.userId = { in: matchingUsers.map((u) => u.id) };
  }

  const [logs, total] = await prisma.$transaction([
    prisma.trackLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { track: { select: { id: true, title: true } } },
    }),
    prisma.trackLog.count({ where }),
  ]);

  // emails
  const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean) as number[])];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
    : [];
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.email]));

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      trackId: l.trackId,
      trackTitle: l.track?.title ?? null,
      event: l.event,
      details: l.details,
      createdAt: l.createdAt,
      userEmail: l.userId ? (userMap[l.userId] ?? null) : null,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
}
