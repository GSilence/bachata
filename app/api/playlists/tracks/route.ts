/**
 * GET    /api/playlists/tracks?playlistId=X  — ID треков в плейлисте
 * POST   /api/playlists/tracks               — добавить трек { playlistId, trackId }
 * DELETE  /api/playlists/tracks?playlistId=X&trackId=Y — удалить трек
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

  const { searchParams } = new URL(request.url);
  const playlistId = parseInt(searchParams.get("playlistId") || "", 10);
  if (!playlistId) return NextResponse.json({ error: "Missing playlistId" }, { status: 400 });

  // Проверяем что плейлист принадлежит пользователю
  const playlist = await prisma.playlist.findFirst({
    where: { id: playlistId, userId: auth.userId },
  });
  if (!playlist) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const items = await prisma.playlistItem.findMany({
    where: { playlistId },
    select: { trackId: true },
    orderBy: { addedAt: "desc" },
  });

  return NextResponse.json({ trackIds: items.map((i: { trackId: number }) => i.trackId) });
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

  const { playlistId, trackId } = await request.json();
  if (!playlistId || !trackId) {
    return NextResponse.json({ error: "Missing playlistId or trackId" }, { status: 400 });
  }

  // Проверяем что плейлист принадлежит пользователю
  const playlist = await prisma.playlist.findFirst({
    where: { id: playlistId, userId: auth.userId },
  });
  if (!playlist) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await prisma.playlistItem.create({
      data: { playlistId, trackId },
    });
  } catch {
    // unique constraint — трек уже в плейлисте
    return NextResponse.json({ error: "Трек уже в плейлисте" }, { status: 409 });
  }

  return NextResponse.json({ added: true });
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
  const playlistId = parseInt(searchParams.get("playlistId") || "", 10);
  const trackId = parseInt(searchParams.get("trackId") || "", 10);
  if (!playlistId || !trackId) {
    return NextResponse.json({ error: "Missing playlistId or trackId" }, { status: 400 });
  }

  const playlist = await prisma.playlist.findFirst({
    where: { id: playlistId, userId: auth.userId },
  });
  if (!playlist) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.playlistItem.deleteMany({
    where: { playlistId, trackId },
  });

  return NextResponse.json({ removed: true });
}
