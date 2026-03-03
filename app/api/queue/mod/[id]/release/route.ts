import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/queue/mod/[id]/release
 * Сброс назначения — возвращает трек в pending.
 * Только для admin.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let authUser: { userId: number; email: string; role: string };
  try {
    authUser = await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const { id } = await params;
  const modQueueId = parseInt(id, 10);
  if (isNaN(modQueueId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const entry = await prisma.modQueue.findUnique({ where: { id: modQueueId } });
  if (!entry) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  if (entry.status === "done") {
    return NextResponse.json({ error: "Трек уже обработан" }, { status: 409 });
  }

  const updated = await prisma.modQueue.update({
    where: { id: modQueueId },
    data: { status: "pending", assignedTo: null, assignedAt: null },
  });

  try {
    await prisma.trackLog.create({
      data: {
        trackId: entry.trackId,
        userId: authUser.userId,
        event: "admin_released",
        details: { email: authUser.email },
      },
    });
  } catch {}

  return NextResponse.json({ modQueue: updated });
}
