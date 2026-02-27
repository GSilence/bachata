import { NextResponse } from "next/server";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/tracks/sync-dominance
 * One-time migration: populates rowDominancePercent and rowSwapped for all
 * tracks that are missing these fields but have a v2 analysis JSON.
 * Safe to call multiple times — skips tracks that already have both values.
 */
export async function GET() {
  if (!prisma) return NextResponse.json({ updated: 0 });

  const tracks = await prisma.track.findMany();
  let updated = 0;

  for (const track of tracks) {
    const gm = track.gridMap as Record<string, unknown> | null;
    if (gm?.rowDominancePercent != null && gm?.rowSwapped != null) continue; // already populated

    const pathOriginal = track.pathOriginal;
    if (!pathOriginal) continue;

    const audioBasename = pathOriginal
      .replace(/^.*[\\/]/, "")
      .replace(/\.[^.]+$/, "");
    const resultPath = join(
      process.cwd(),
      "public",
      "uploads",
      "reports",
      `${audioBasename}_v2_analysis.json`,
    );

    if (!existsSync(resultPath)) continue;

    try {
      const data = JSON.parse(readFileSync(resultPath, "utf-8"));
      const rowAnalysis = data.row_analysis as
        | Record<string, { madmom_sum?: number }>
        | undefined;

      if (!rowAnalysis || typeof rowAnalysis !== "object") continue;

      const r1 =
        (rowAnalysis["row_1"]?.madmom_sum ?? 0) +
        (rowAnalysis["row_2"]?.madmom_sum ?? 0) +
        (rowAnalysis["row_3"]?.madmom_sum ?? 0) +
        (rowAnalysis["row_4"]?.madmom_sum ?? 0);
      const r5 =
        (rowAnalysis["row_5"]?.madmom_sum ?? 0) +
        (rowAnalysis["row_6"]?.madmom_sum ?? 0) +
        (rowAnalysis["row_7"]?.madmom_sum ?? 0) +
        (rowAnalysis["row_8"]?.madmom_sum ?? 0);

      const rowSwapped = data.row_swapped === true;
      const existingGridMap =
        (track.gridMap as Record<string, unknown>) || {};

      const patch: Record<string, unknown> = { rowSwapped };

      if (r5 !== 0 && gm?.rowDominancePercent == null) {
        patch.rowDominancePercent =
          Math.round(((r1 - r5) / r5) * 100 * 100) / 100;
      }

      await prisma.track.update({
        where: { id: track.id },
        data: {
          gridMap: { ...existingGridMap, ...patch } as object,
        },
      });
      updated++;
    } catch {
      // skip this track on error
    }
  }

  return NextResponse.json({ updated });
}
