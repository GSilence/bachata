import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import type { V2LayoutSegment, GridMap } from "@/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/tracks/[id]/swap-rows
 *
 * Свап рядов РАЗ↔ПЯТЬ: источник истины — baseOffset (время первого бита ряда РАЗ).
 * - baseOffset сдвигается на ±4 бита; offset храним в sync с baseOffset.
 * - row1_start в первом сегменте выравниваем так, чтобы первый счёт всегда РАЗ (1).
 * - При первом свапе сохраняем originalOffset в gridMap для ресета.
 *
 * POST /api/tracks/[id]/swap-rows?reset=1 — ресет к состоянию после анализа.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const trackId = parseInt(id, 10);
  if (isNaN(trackId)) {
    return NextResponse.json({ error: "Invalid track ID" }, { status: 400 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const gm = (track.gridMap as unknown as GridMap) || {};
  const hasBridges =
    (Array.isArray(gm.bridges) && gm.bridges.length > 0) ||
    (Array.isArray(gm.v2Layout) && gm.v2Layout.length > 1);
  if (hasBridges) {
    return NextResponse.json(
      { error: "Удалите все бриджи перед сменой рядов (или обратным свайпом)" },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const isReset = url.searchParams.get("reset") === "1";

  const flipRow = (seg: V2LayoutSegment): V2LayoutSegment => ({
    ...seg,
    row1_start: seg.row1_start === 1 ? 5 : 1,
  });

  // После свайпа первый произносимый бит ВСЕГДА РАЗ (1). Для этого первый сегмент
  // должен начинаться в newOffset и иметь row1_start=1 (чтобы localBeatIndex=0 дал number=1).
  const alignFirstSegmentToOffset = (
    layout: V2LayoutSegment[] | undefined,
    firstTimeStart: number,
    firstRow1: 1 | 5,
  ): V2LayoutSegment[] | undefined => {
    if (!layout || layout.length === 0) return layout;
    const [first, ...rest] = layout;
    if (!first) return layout;
    return [
      { ...first, time_start: firstTimeStart, row1_start: firstRow1 },
      ...rest,
    ];
  };

  if (isReset) {
    // --- РЕСЕТ: восстанавливаем baseOffset и grid из сохранённых оригиналов ---
    if (!track.rowSwapped) {
      return NextResponse.json({ error: "Трек уже в оригинальном состоянии" }, { status: 400 });
    }

    const originalBase =
      gm.originalOffset ?? track.baseOffset ?? track.offset;

    const newGridMap: GridMap = {
      ...gm,
      offset: originalBase,
      v2Layout:     gm.v2LayoutOriginal    ?? gm.v2Layout?.map(flipRow),
      v2LayoutRms:  gm.v2LayoutRmsOriginal ?? gm.v2LayoutRms?.map(flipRow),
      v2LayoutPerc: gm.v2LayoutPercOriginal ?? gm.v2LayoutPerc?.map(flipRow),
    };

    const updated = await prisma.track.update({
      where: { id: trackId },
      data: {
        gridMap: newGridMap as object,
        baseOffset: originalBase,
        offset: originalBase,
        rowSwapped: false,
      },
    });

    return NextResponse.json({ track: updated });
  }

  // --- СВАП (TOGGLE) ---
  // Сдвиг на ±4 бита внутри двух сильных рядов: РАЗ на ряду 1–4 → +4, на ряду 5–8 → −4.
  const currentBase = track.baseOffset ?? track.offset;
  const rowOne = gm.row_one;
  const winningRows = Array.isArray(gm.winning_rows) ? gm.winning_rows : [];
  const hasRowInfo = rowOne != null && winningRows.length >= 2;
  const currentOneRow: number | null = hasRowInfo
    ? (track.rowSwapped
        ? (winningRows.find((r) => r !== rowOne) ?? rowOne)
        : rowOne)
    : null;
  const direction =
    currentOneRow != null
      ? (currentOneRow >= 1 && currentOneRow <= 4 ? 1 : -1)
      : (track.rowDominancePercent != null && track.rowDominancePercent < 0 ? -1 : 1);
  const halfCycleSec = direction * 4 * (60 / track.bpm);

  let newBaseOffset: number;
  let originalsToSave: Record<string, unknown> = {};

  if (!track.rowSwapped) {
    newBaseOffset = currentBase + halfCycleSec;
    originalsToSave = {
      originalOffset: currentBase,
      v2LayoutOriginal:     Array.isArray(gm.v2Layout)     ? [...gm.v2Layout]     : gm.v2Layout,
      v2LayoutRmsOriginal:  Array.isArray(gm.v2LayoutRms)  ? [...gm.v2LayoutRms]  : gm.v2LayoutRms,
      v2LayoutPercOriginal: Array.isArray(gm.v2LayoutPerc) ? [...gm.v2LayoutPerc] : gm.v2LayoutPerc,
    };
  } else {
    newBaseOffset =
      gm.originalOffset ??
      track.baseOffset ??
      (track.offset - halfCycleSec);
  }

  const newGridMap: GridMap = {
    ...gm,
    ...originalsToSave,
    offset: newBaseOffset,
    v2Layout: alignFirstSegmentToOffset(
      Array.isArray(gm.v2Layout) ? gm.v2Layout.map(flipRow) : gm.v2Layout,
      newBaseOffset,
      1,
    ) ?? gm.v2Layout,
    v2LayoutRms: alignFirstSegmentToOffset(
      Array.isArray(gm.v2LayoutRms) ? gm.v2LayoutRms.map(flipRow) : gm.v2LayoutRms,
      newBaseOffset,
      1,
    ) ?? gm.v2LayoutRms,
    v2LayoutPerc: alignFirstSegmentToOffset(
      Array.isArray(gm.v2LayoutPerc) ? gm.v2LayoutPerc.map(flipRow) : gm.v2LayoutPerc,
      newBaseOffset,
      1,
    ) ?? gm.v2LayoutPerc,
  };

  const updated = await prisma.track.update({
    where: { id: trackId },
    data: {
      gridMap: newGridMap as object,
      baseOffset: newBaseOffset,
      offset: newBaseOffset,
      rowSwapped: !track.rowSwapped,
    },
  });

  return NextResponse.json({ track: updated });
}
