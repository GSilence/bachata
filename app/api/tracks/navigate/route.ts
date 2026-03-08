import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminOrModerator } from "@/lib/roles";
import { buildTracksWhere, buildTracksOrderBy } from "@/lib/trackQuery";

export const dynamic = "force-dynamic";

/**
 * POST /api/tracks/navigate
 *
 * Finds the next/previous/random track given current track ID and filters.
 * Returns a single track WITH gridMap (ready for playback).
 *
 * Body: {
 *   currentTrackId: number,
 *   direction: "next" | "prev" | "random",
 *   filters: { search, sort, sortDir, squareSort, bridges, status, accents, mambo, dominance, filter }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { currentTrackId, direction, filters } = body as {
      currentTrackId: number;
      direction: "next" | "prev" | "random";
      filters: Record<string, string>;
    };

    if (!currentTrackId || !direction) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    const { prisma } = await import("@/lib/prisma");
    if (!prisma) {
      return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
    }

    const admin = isAdminOrModerator(user.role);

    // Build URLSearchParams from filters object
    const sp = new URLSearchParams();
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value != null && value !== "") sp.set(key, String(value));
      }
    }

    const where = buildTracksWhere(sp, admin);
    const orderBy = buildTracksOrderBy(sp);

    if (direction === "random") {
      // Random: get count, pick random offset
      const total = await prisma.track.count({ where });
      if (total === 0) {
        return NextResponse.json({ track: null });
      }

      // Avoid returning the same track
      let attempts = 0;
      const maxAttempts = Math.min(5, total);
      let track = null;

      while (attempts < maxAttempts) {
        const offset = Math.floor(Math.random() * total);
        const [candidate] = await prisma.track.findMany({
          where,
          orderBy,
          skip: offset,
          take: 1,
        });
        if (candidate && candidate.id !== currentTrackId) {
          track = candidate;
          break;
        }
        if (candidate && total === 1) {
          // Only one track available, return it
          track = candidate;
          break;
        }
        attempts++;
      }

      if (!track) {
        // Fallback: just get any track
        const [fallback] = await prisma.track.findMany({
          where,
          orderBy,
          take: 1,
        });
        track = fallback ?? null;
      }

      if (!track) {
        return NextResponse.json({ track: null });
      }

      return NextResponse.json({
        track: {
          ...track,
          fileSize: track.fileSize != null ? Number(track.fileSize) : null,
        },
      });
    }

    // Sequential: next or prev
    // Strategy: fetch ALL IDs in the filtered+sorted order, find current position,
    // then return the next/prev full track.
    // For 3000 tracks, selecting just IDs is fast (~3ms).
    const allIds = await prisma.track.findMany({
      select: { id: true },
      where,
      orderBy,
    });

    if (allIds.length === 0) {
      return NextResponse.json({ track: null });
    }

    const currentIndex = allIds.findIndex((t) => t.id === currentTrackId);
    let targetIndex: number;

    if (direction === "next") {
      if (currentIndex === -1) {
        targetIndex = 0;
      } else {
        targetIndex = (currentIndex + 1) % allIds.length;
      }
    } else {
      // prev
      if (currentIndex === -1) {
        targetIndex = allIds.length - 1;
      } else {
        targetIndex = currentIndex <= 0 ? allIds.length - 1 : currentIndex - 1;
      }
    }

    const targetId = allIds[targetIndex].id;

    // Fetch full track with gridMap
    const track = await prisma.track.findUnique({
      where: { id: targetId },
    });

    if (!track) {
      return NextResponse.json({ track: null });
    }

    return NextResponse.json({
      track: {
        ...track,
        fileSize: track.fileSize != null ? Number(track.fileSize) : null,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("Navigate error:", error);
    }
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
