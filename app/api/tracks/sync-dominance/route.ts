import { NextResponse } from "next/server";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/tracks/sync-dominance
 * Одноразовая миграция: читает row_analysis из v2 JSON-файлов и
 * заполняет колонки rowDominancePercent и rowSwapped в БД.
 * Только для админа (меняет данные в БД).
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!prisma) return NextResponse.json({ updated: 0 });

  // Берём только треки без данных в новых колонках
  const tracks = await prisma.track.findMany({
    where: { rowDominancePercent: null },
  });
  let updated = 0;

  for (const track of tracks) {
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
      const verdict = data.row_analysis_verdict as
        | { row_one?: number; winning_rows?: number[]; winning_row?: number }
        | undefined;

      if (!rowAnalysis || typeof rowAnalysis !== "object") continue;

      // Та же формула, что в UI: два ряда — row_one (РАЗ) и второй winning row (ПЯТЬ)
      let rowDominancePercent: number | undefined;
      if (verdict) {
        const rowOne = verdict.row_one;
        const winningRows =
          verdict.winning_rows ??
          (verdict.winning_row != null ? [verdict.winning_row] : []);
        if (rowOne != null && winningRows.length >= 2) {
          const r1 = rowAnalysis[`row_${rowOne}`]?.madmom_sum ?? 0;
          const other = winningRows.find((r) => r !== rowOne) ?? winningRows[1];
          const r2 = rowAnalysis[`row_${other}`]?.madmom_sum ?? 0;
          if (r2 !== 0) {
            rowDominancePercent =
              Math.round(((r1 - r2) / Math.abs(r2)) * 100 * 100) / 100;
          }
        }
      }
      if (rowDominancePercent == null && typeof data.madmom_diff_pct === "number") {
        rowDominancePercent = data.madmom_diff_pct;
      }

      if (rowDominancePercent == null) continue;

      const rowSwapped = data.row_swapped === true;

      // Пишем в отдельные колонки БД (не в gridMap JSON)
      await prisma.track.update({
        where: { id: track.id },
        data: { rowDominancePercent, rowSwapped },
      });
      updated++;
    } catch {
      // пропускаем трек при ошибке
    }
  }

  return NextResponse.json({ updated });
}
