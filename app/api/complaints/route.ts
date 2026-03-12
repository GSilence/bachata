import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET — список жалоб текущего пользователя
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    const complaints = await prisma!.complaint.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ complaints });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Server error";
    if (msg === "Unauthorized" || msg === "Invalid token") {
      return NextResponse.json({ error: msg }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST — создать жалобу
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();

    const { reason, message, trackInfo, trackId, userName, userEmail } = body;

    if (!reason || !message?.trim()) {
      return NextResponse.json({ error: "Заполните все поля" }, { status: 400 });
    }

    const complaint = await prisma!.complaint.create({
      data: {
        userId: user.userId,
        userName: userName || user.email.split("@")[0],
        userEmail: userEmail || user.email,
        reason,
        message: message.trim(),
        trackInfo: trackInfo || "",
        trackId: trackId ? Number(trackId) : null,
        status: "sent",
      },
    });

    return NextResponse.json({ complaint }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Server error";
    if (msg === "Unauthorized" || msg === "Invalid token") {
      return NextResponse.json({ error: msg }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
