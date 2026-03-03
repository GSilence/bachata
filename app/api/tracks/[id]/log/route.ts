import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/tracks/[id]/log
 * История событий трека (только для admin).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const { id } = await params;
  const trackId = parseInt(id, 10);
  if (isNaN(trackId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const logs = await prisma.trackLog.findMany({
    where: { trackId },
    orderBy: { createdAt: "desc" },
  });

  // Получаем emails пользователей
  const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean) as number[])];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
    : [];
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.email]));

  return NextResponse.json(
    logs.map((l) => ({
      id: l.id,
      event: l.event,
      details: l.details,
      createdAt: l.createdAt,
      userEmail: l.userId ? (userMap[l.userId] ?? null) : null,
    }))
  );
}
