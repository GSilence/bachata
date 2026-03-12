/**
 * GET  /api/playlists/bookmarks/tracks — список ID треков в Закладках
 * POST /api/playlists/bookmarks/tracks — добавить трек { trackId }
 * DELETE /api/playlists/bookmarks/tracks?trackId=X — удалить трек
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function getBookmarksPlaylist(prisma: any, userId: number) {
  let playlist = await prisma.playlist.findFirst({
    where: { userId, type: "bookmarks" },
  });
  if (!playlist) {
    playlist = await prisma.playlist.create({
      data: { userId, name: "Закладки", type: "bookmarks", isSystem: true },
    });
  }
  return playlist;
}

export async function GET(request: NextRequest) {
  let auth;
  try {
    auth = await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { prisma } = await import("@/lib/prisma");
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const playlist = await getBookmarksPlaylist(prisma, auth.userId);
  const items = await (prisma as any).playlistItem.findMany({
    where: { playlistId: playlist.id },
    select: { trackId: true },
  });

  return NextResponse.json({ trackIds: items.map((i: any) => i.trackId) });
}

export async function POST(request: NextRequest) {
  let auth;
  try {
    auth = await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { trackId } = await request.json().catch(() => ({}));
  if (!trackId || typeof trackId !== "number") {
    return NextResponse.json({ error: "trackId required" }, { status: 400 });
  }

  const { prisma } = await import("@/lib/prisma");
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const playlist = await getBookmarksPlaylist(prisma, auth.userId);

  await (prisma as any).playlistItem.upsert({
    where: { playlistId_trackId: { playlistId: playlist.id, trackId } },
    update: {},
    create: { playlistId: playlist.id, trackId },
  });

  return NextResponse.json({ added: true });
}

export async function DELETE(request: NextRequest) {
  let auth;
  try {
    auth = await requireAuth(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const trackId = parseInt(new URL(request.url).searchParams.get("trackId") || "", 10);
  if (isNaN(trackId)) {
    return NextResponse.json({ error: "trackId required" }, { status: 400 });
  }

  const { prisma } = await import("@/lib/prisma");
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const playlist = await getBookmarksPlaylist(prisma, auth.userId);

  await (prisma as any).playlistItem.deleteMany({
    where: { playlistId: playlist.id, trackId },
  });

  return NextResponse.json({ removed: true });
}
