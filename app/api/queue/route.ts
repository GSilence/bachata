import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { existsSync, rmSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/queue
 * Возвращает список записей очереди.
 * ?status=pending,processing  — фильтр по статусам (через запятую)
 * ?limit=50                   — кол-во записей (по умолчанию 50)
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prisma } = await import("@/lib/prisma");
  if (!prisma) return NextResponse.json({ error: "Database not available" }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);

  const whereStatus = statusParam
    ? { status: { in: statusParam.split(",").map((s) => s.trim()) } }
    : {};

  const entries = await (prisma as any).uploadQueue.findMany({
    where: whereStatus,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // Позиции в очереди (только для pending/processing)
  const pendingIds = entries
    .filter((e: any) => e.status === "pending" || e.status === "processing")
    .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((e: any, i: number) => ({ id: e.id, position: i + 1 }));

  const positionMap = Object.fromEntries(pendingIds.map((p: any) => [p.id, p.position]));

  const result = entries.map((e: any) => ({
    ...e,
    position: positionMap[e.id] ?? null,
  }));

  return NextResponse.json({ entries: result, total: result.length });
}

/**
 * DELETE /api/queue
 * Удаляет все done-записи (файлов уже нет — они в raw/ или __dup__).
 */
export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prisma } = await import("@/lib/prisma");
  if (!prisma) return NextResponse.json({ error: "Database not available" }, { status: 500 });

  const doneEntries = await (prisma as any).uploadQueue.findMany({
    where: { status: "done" },
    select: { id: true, filename: true },
  });

  // Подчищаем файлы __dup__ или любые оставшиеся в queue/ (на всякий случай)
  for (const e of doneEntries) {
    if (e.filename && e.filename !== "__dup__") {
      const f = join(process.cwd(), "public", "uploads", "queue", e.filename);
      if (existsSync(f)) try { rmSync(f); } catch {}
    }
  }

  const { count } = await (prisma as any).uploadQueue.deleteMany({ where: { status: "done" } });
  return NextResponse.json({ deleted: count });
}
