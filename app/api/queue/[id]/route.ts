import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { isS3Enabled, deleteFile as deleteS3File } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/queue/[id]
 * Статус конкретной записи очереди. Используется для polling с фронта.
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

  const { id } = await params;
  const entryId = parseInt(id, 10);
  if (isNaN(entryId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const { prisma } = await import("@/lib/prisma");
  if (!prisma) return NextResponse.json({ error: "Database not available" }, { status: 500 });

  const entry = await (prisma as any).uploadQueue.findUnique({ where: { id: entryId } });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Считаем позицию в очереди
  let position: number | null = null;
  if (entry.status === "pending" || entry.status === "processing") {
    position = await (prisma as any).uploadQueue.count({
      where: {
        status: { in: ["pending", "processing"] },
        createdAt: { lte: entry.createdAt },
      },
    });
  }

  return NextResponse.json({ ...entry, position });
}

/**
 * DELETE /api/queue/[id]
 * Удаляет запись из очереди (только pending или failed).
 */
export async function DELETE(
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

  if (entry.status === "processing") {
    return NextResponse.json({ error: "Нельзя удалить запись в процессе обработки" }, { status: 400 });
  }

  // Удаляем файл из S3 или локально
  if (entry.status === "pending" || entry.status === "failed") {
    if (isS3Enabled()) {
      try { await deleteS3File(`queue/${entry.filename}`); } catch {}
    } else {
      const queueFile = join(process.cwd(), "public", "uploads", "queue", entry.filename);
      if (existsSync(queueFile)) {
        try { rmSync(queueFile); } catch {}
      }
    }
  }

  await (prisma as any).uploadQueue.delete({ where: { id: entryId } });
  return NextResponse.json({ success: true });
}
