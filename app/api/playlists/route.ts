/**
 * GET    /api/playlists           — все кастомные плейлисты пользователя
 * POST   /api/playlists           — создать плейлист { name }
 * DELETE  /api/playlists?id=X      — удалить кастомный плейлист
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let auth;
  try {
    auth = await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prisma } = await import("@/lib/prisma");
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const playlists = await prisma.playlist.findMany({
    where: { userId: auth.userId, type: "custom" },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true, _count: { select: { items: true } } },
  });

  return NextResponse.json({
    playlists: playlists.map((p) => ({
      id: p.id,
      name: p.name,
      trackCount: p._count.items,
      createdAt: p.createdAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  let auth;
  try {
    auth = await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prisma } = await import("@/lib/prisma");
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const body = await request.json();
  const name = (body.name || "").trim().slice(0, 200);
  if (!name) {
    return NextResponse.json({ error: "Название не может быть пустым" }, { status: 400 });
  }

  const playlist = await prisma.playlist.create({
    data: { userId: auth.userId, name, type: "custom", isSystem: false },
  });

  return NextResponse.json({ id: playlist.id, name: playlist.name });
}

export async function DELETE(request: NextRequest) {
  let auth;
  try {
    auth = await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prisma } = await import("@/lib/prisma");
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get("id") || "", 10);
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // Только свой кастомный плейлист
  const playlist = await prisma.playlist.findFirst({
    where: { id, userId: auth.userId, type: "custom" },
  });
  if (!playlist) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.playlist.delete({ where: { id } });
  return NextResponse.json({ deleted: true });
}
