/**
 * Общая утилита свапа рядов РАЗ↔ПЯТЬ.
 * Используется в:
 *  - app/api/tracks/[id]/swap-rows/route.ts
 *  - app/api/queue/mod/[id]/verdict/route.ts
 */

import type { V2LayoutSegment, GridMap } from "@/types";

const flipRow = (seg: V2LayoutSegment): V2LayoutSegment => ({
  ...seg,
  row1_start: seg.row1_start === 1 ? 5 : 1,
});

const alignFirstSegmentToOffset = (
  layout: V2LayoutSegment[] | undefined,
  firstTimeStart: number,
  firstRow1: 1 | 5,
): V2LayoutSegment[] | undefined => {
  if (!layout || layout.length === 0) return layout;
  const [first, ...rest] = layout;
  if (!first) return layout;
  return [{ ...first, time_start: firstTimeStart, row1_start: firstRow1 }, ...rest];
};

/**
 * Выполняет свап рядов для трека в БД.
 * Не проверяет мостики (с новым алгоритмом v2Layout всегда пустой).
 * Возвращает обновлённый трек.
 */
export async function performSwap(trackId: number, prisma: any): Promise<any> {
  const track = await prisma.track.findUnique({ where: { id: trackId } });
  if (!track) throw new Error("Track not found");

  const gm = (track.gridMap as unknown as GridMap) || {};

  const currentBase = track.baseOffset ?? track.offset;
  const rowOne = gm.row_one;
  const winningRows = Array.isArray(gm.winning_rows) ? gm.winning_rows : [];
  const hasRowInfo = rowOne != null && winningRows.length >= 2;
  const currentOneRow: number | null = hasRowInfo
    ? (track.rowSwapped
        ? (winningRows.find((r: number) => r !== rowOne) ?? rowOne)
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
    newBaseOffset = gm.originalOffset ?? track.baseOffset ?? (track.offset - halfCycleSec);
  }

  const newGridMap: GridMap = {
    ...gm,
    ...originalsToSave,
    offset: newBaseOffset,
    v2Layout: alignFirstSegmentToOffset(
      Array.isArray(gm.v2Layout) ? gm.v2Layout.map(flipRow) : gm.v2Layout,
      newBaseOffset, 1,
    ) ?? gm.v2Layout,
    v2LayoutRms: alignFirstSegmentToOffset(
      Array.isArray(gm.v2LayoutRms) ? gm.v2LayoutRms.map(flipRow) : gm.v2LayoutRms,
      newBaseOffset, 1,
    ) ?? gm.v2LayoutRms,
    v2LayoutPerc: alignFirstSegmentToOffset(
      Array.isArray(gm.v2LayoutPerc) ? gm.v2LayoutPerc.map(flipRow) : gm.v2LayoutPerc,
      newBaseOffset, 1,
    ) ?? gm.v2LayoutPerc,
  };

  return prisma.track.update({
    where: { id: trackId },
    data: {
      gridMap: newGridMap as object,
      baseOffset: newBaseOffset,
      offset: newBaseOffset,
      rowSwapped: !track.rowSwapped,
    },
  });
}
