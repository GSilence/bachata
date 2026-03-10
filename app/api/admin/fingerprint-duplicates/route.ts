import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findAllDuplicateClusters, FINGERPRINT_BER_THRESHOLD } from "@/lib/fingerprint";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/fingerprint-duplicates
 * Find all duplicate clusters by fingerprint comparison.
 * Returns clusters with track details.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "DB unavailable" }, { status: 500 });
  }

  const url = new URL(request.url);
  const threshold = parseFloat(url.searchParams.get("threshold") || "") || FINGERPRINT_BER_THRESHOLD;

  const { clusters } = await findAllDuplicateClusters(prisma, threshold);

  // Enrich clusters with track details
  const allIds = clusters.flatMap((c) => c.trackIds);
  const tracks = allIds.length > 0
    ? await prisma.track.findMany({
        where: { id: { in: allIds } },
        select: {
          id: true,
          title: true,
          artist: true,
          filename: true,
          duration: true,
          fileSize: true,
          trackStatus: true,
          visibility: true,
          isPrimary: true,
          fingerprintDuration: true,
        },
      })
    : [];

  const trackMap = new Map(tracks.map((t: any) => [t.id, {
    ...t,
    fileSize: t.fileSize != null ? Number(t.fileSize) : null,
  }]));

  const enriched = clusters.map((c) => ({
    ber: Math.round(c.ber * 10000) / 10000,
    similarity: Math.round((1 - c.ber) * 100),
    tracks: c.trackIds.map((id) => trackMap.get(id)).filter(Boolean),
  }));

  // Sort: highest similarity first
  enriched.sort((a, b) => b.similarity - a.similarity);

  return NextResponse.json({
    clusters: enriched,
    totalClusters: enriched.length,
    totalDuplicateTracks: allIds.length,
  });
}
