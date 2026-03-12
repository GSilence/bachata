import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET — все жалобы (для админа)
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page")) || 1);
    const limit = 50;
    const skip = (page - 1) * limit;
    const status = searchParams.get("status") || undefined;

    const where = status ? { status } : {};

    const [complaints, total] = await Promise.all([
      prisma!.complaint.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma!.complaint.count({ where }),
    ]);

    return NextResponse.json({
      complaints,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Server error";
    if (msg === "Unauthorized" || msg === "Invalid token") {
      return NextResponse.json({ error: msg }, { status: 401 });
    }
    if (msg === "Forbidden") {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH — обновить статус жалобы
export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const { id, status } = body;

    const allowed = ["sent", "reviewing", "rejected", "approved"];
    if (!id || !allowed.includes(status)) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const complaint = await prisma!.complaint.update({
      where: { id: Number(id) },
      data: { status },
    });

    return NextResponse.json({ complaint });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Server error";
    if (msg === "Unauthorized" || msg === "Invalid token") {
      return NextResponse.json({ error: msg }, { status: 401 });
    }
    if (msg === "Forbidden") {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
