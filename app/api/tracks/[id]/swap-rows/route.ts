import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import type { V2LayoutSegment, GridMap } from "@/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/tracks/[id]/swap-rows
 *
 * Полноценный свап рядов: РАЗ↔ПЯТЬ.
 * - offset сдвигается на 4 бита (= 240/BPM секунд) — новым РАЗ становится старый ПЯТЬ
 * - row1_start инвертируется во всех Layout-сегментах (1↔5)
 * - При первом свапе сохраняются оригинальные значения для ресета
 * - rowSwapped в БД тоглится
 *
 * POST /api/tracks/[id]/swap-rows?reset=1
 * Ресет к оригинальному состоянию анализатора (из сохранённых оригиналов).
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

  const gm = (track.gridMap as GridMap) || {};
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

  if (isReset) {
    // --- РЕСЕТ: восстанавливаем оригинальные значения ---
    if (!track.rowSwapped) {
      return NextResponse.json({ error: "Трек уже в оригинальном состоянии" }, { status: 400 });
    }

    const originalOffset =
      gm.originalOffset ??         // сохранено при первом свапе
      track.baseOffset ??           // fallback: исходный оффсет анализатора
      track.offset;                 // последний резерв

    const newGridMap: GridMap = {
      ...gm,
      offset: originalOffset,
      v2Layout:     gm.v2LayoutOriginal    ?? gm.v2Layout?.map(flipRow),
      v2LayoutRms:  gm.v2LayoutRmsOriginal ?? gm.v2LayoutRms?.map(flipRow),
      v2LayoutPerc: gm.v2LayoutPercOriginal ?? gm.v2LayoutPerc?.map(flipRow),
    };

    const updated = await prisma.track.update({
      where: { id: trackId },
      data: {
        gridMap: newGridMap as object,
        offset: originalOffset,
        rowSwapped: false,
      },
    });

    return NextResponse.json({ track: updated });
  }

  // --- СВАП (TOGGLE) ---
  // Кнопка «Свайп» переключает между двумя половинами восьмёрки (1-4 ↔ 5-8).
  // Направление (±4 бита) зависит от того, в какой половине выбран лидирующий ряд при анализе:
  //   rowDominancePercent < 0 → лидирует ПЯТЬ (вторая половина 5-8) → свайп = показать первую половину → −4 бита
  //   rowDominancePercent >= 0 или null → лидирует РАЗ (первая половина 1-4) → свайп = показать вторую половину → +4 бита
  // Так мы не уходим на «вторую восьмёрку», когда лидирующий ряд уже во второй половине.
  const leadingIsSecondHalf = track.rowDominancePercent != null && track.rowDominancePercent < 0;
  const direction = leadingIsSecondHalf ? -1 : 1;
  const halfCycleSec = direction * 4 * (60 / track.bpm);

  let newOffset: number;
  let originalsToSave: Record<string, unknown> = {};

  if (!track.rowSwapped) {
    // Первый свап: идём на ±4 бита и запоминаем оригиналы
    newOffset = track.offset + halfCycleSec;
    originalsToSave = {
      originalOffset: track.offset,
      v2LayoutOriginal:     Array.isArray(gm.v2Layout)     ? [...gm.v2Layout]     : gm.v2Layout,
      v2LayoutRmsOriginal:  Array.isArray(gm.v2LayoutRms)  ? [...gm.v2LayoutRms]  : gm.v2LayoutRms,
      v2LayoutPercOriginal: Array.isArray(gm.v2LayoutPerc) ? [...gm.v2LayoutPerc] : gm.v2LayoutPerc,
    };
  } else {
    // Повторный свап: возвращаемся к исходной позиции
    // halfCycleSec здесь уже учитывает направление → вычитаем его (отменяем первый свап)
    newOffset =
      gm.originalOffset ??
      track.baseOffset ??
      (track.offset - halfCycleSec);
  }

  const newGridMap: GridMap = {
    ...gm,
    ...originalsToSave,
    offset: newOffset,
    v2Layout:     Array.isArray(gm.v2Layout)     ? gm.v2Layout.map(flipRow)     : gm.v2Layout,
    v2LayoutRms:  Array.isArray(gm.v2LayoutRms)  ? gm.v2LayoutRms.map(flipRow)  : gm.v2LayoutRms,
    v2LayoutPerc: Array.isArray(gm.v2LayoutPerc) ? gm.v2LayoutPerc.map(flipRow) : gm.v2LayoutPerc,
  };

  const updated = await prisma.track.update({
    where: { id: trackId },
    data: {
      gridMap: newGridMap as object,
      offset: newOffset,
      rowSwapped: !track.rowSwapped,
    },
  });

  return NextResponse.json({ track: updated });
}
