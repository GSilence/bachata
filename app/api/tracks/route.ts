import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminOrModerator } from "@/lib/roles";
import { buildTracksWhere, buildTracksOrderBy, LIGHT_SELECT, INTERNAL_FIELDS } from "@/lib/trackQuery";

export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
} as const;

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Войдите в аккаунт, чтобы видеть музыку" },
        { status: 401, headers: NO_CACHE_HEADERS }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Войдите в аккаунт, чтобы видеть музыку" },
      { status: 401, headers: NO_CACHE_HEADERS }
    );
  }

  try {
    const { prisma } = await import("@/lib/prisma");
    if (!prisma) {
      if (process.env.NODE_ENV === "development") {
        console.warn("Prisma Client not initialized. Returning empty result.");
      }
      return NextResponse.json(
        { tracks: [], total: 0, page: 1, pageSize: 40 },
        { headers: NO_CACHE_HEADERS }
      );
    }

    const user = await getCurrentUser();
    const admin = isAdminOrModerator(user!.role);
    const sp = request.nextUrl.searchParams;

    // Pagination (pageSize=0 → без лимита, все треки)
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const rawPageSize = parseInt(sp.get("pageSize") ?? "40", 10);
    const pageSize = rawPageSize === 0 ? 0 : Math.min(200, Math.max(1, rawPageSize || 40));

    // Build WHERE clause
    const where = buildTracksWhere(sp, admin);

    // Build ORDER BY clause
    const orderBy = buildTracksOrderBy(sp);

    // DEBUG: trace filter pipeline
    console.log("[tracks] params:", Object.fromEntries(sp.entries()));
    console.log("[tracks] admin:", admin, "where:", JSON.stringify(where));

    // Execute count + data in parallel
    const [total, raw] = await Promise.all([
      prisma.track.count({ where }),
      prisma.track.findMany({
        select: LIGHT_SELECT,
        where,
        orderBy,
        ...(pageSize > 0 ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
      }),
    ]);

    let tracks: Record<string, unknown>[];
    if (admin) {
      tracks = raw.map((t) => ({
        ...t,
        fileSize: t.fileSize != null ? Number(t.fileSize) : null,
        gridMap: null,
      }));
    } else {
      tracks = raw.map((t) => {
        const sanitized: Record<string, unknown> = {
          ...t,
          fileSize: t.fileSize != null ? Number(t.fileSize) : null,
          gridMap: null,
        };
        for (const field of INTERNAL_FIELDS) delete sanitized[field];
        return sanitized;
      });
    }

    console.log("[tracks] total:", total, "returned:", raw.length);

    return NextResponse.json(
      { tracks, total, page, pageSize },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("Error fetching tracks:", error);
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as { code?: string })?.code;

    if (
      errorCode === "P1001" ||
      errorCode === "P1000" ||
      errorMessage.includes("connect") ||
      errorMessage.includes("DATABASE_URL") ||
      errorMessage.includes("Can't reach database")
    ) {
      if (process.env.NODE_ENV === "development") {
        console.warn("Database connection error. Returning empty result.");
      }
    }

    return NextResponse.json(
      { tracks: [], total: 0, page: 1, pageSize: 40 },
      { headers: NO_CACHE_HEADERS }
    );
  }
}
