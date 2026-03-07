import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { existsSync } from "fs";
import { join } from "path";
import { isS3Enabled } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * POST /api/queue/[id]/retry
 * Сбрасывает failed-запись обратно в pending.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const entryId = parseInt(id, 10);
  if (isNaN(entryId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const { prisma } = await import("@/lib/prisma");
  if (!prisma) return NextResponse.json({ error: "Database not available" }, { status: 500 });

  const entry = await (prisma as any).uploadQueue.findUnique({ where: { id: entryId } });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (entry.status !== "failed") {
    return NextResponse.json({ error: "Только failed-записи можно повторить" }, { status: 400 });
  }

  // Проверяем наличие файла: в S3-режиме — пропускаем проверку (файл в облаке)
  if (!isS3Enabled()) {
    const queueFile = join(process.cwd(), "public", "uploads", "queue", entry.filename);
    if (!existsSync(queueFile)) {
      return NextResponse.json(
        { error: "Файл не найден в очереди (возможно, был удалён вручную)" },
        { status: 400 },
      );
    }
  }

  const updated = await (prisma as any).uploadQueue.update({
    where: { id: entryId },
    data: { status: "pending", error: null, startedAt: null, finishedAt: null },
  });

  return NextResponse.json({ success: true, entry: updated });
}
