"use client";

import React from "react";
import dynamic from "next/dynamic";

const PerBeatChart = dynamic(() => import("./PerBeatChart"), { ssr: false });

interface Indicator {
  quarter_index: number;
  beat: number;
  time_sec: number;
  energy_sum: number;
  probability: number;
  position: string;
  action: string;
  reason?: string;
  row1_sum?: number;
  row5_sum?: number;
  diff_pct?: number;
}

interface Bridge {
  beat: number;
  time_sec: number;
  quarter_index: number;
  row1_sum: number;
  row5_sum: number;
  diff_pct: number;
}

interface SquarePart {
  row1_perc?: number;
  row5_perc?: number;
  status_perc?: "green" | "red";
  row1_energy?: number;
  row5_energy?: number;
  status_energy?: "green" | "red";
  status: "green" | "red";
  time_start?: number;
  time_end?: number;
  /** Старый формат */
  row1?: number;
  row5?: number;
}

interface V2Result {
  success: boolean;
  track_type: "bachata" | "popsa";
  peaks_per_octave: number;
  bpm: number;
  duration: number;
  song_start_beat: number;
  song_start_time: number;
  row1_sum: number;
  row5_sum: number;
  row_swapped: boolean;
  strong_rows_tact_table?: {
    row_position: number;
    beat: number;
    time_sec: number;
    tact_sum: number;
    tact_avg: number;
  }[];
  row_analysis?: Record<
    string,
    {
      count: number;
      madmom_sum: number;
      madmom_avg: number;
      madmom_max: number;
      madmom_min?: number;
    }
  >;
  row_analysis_verdict?: {
    winning_row: number;
    winning_rows?: number[];
    /** Ряд, с которого начинается песня (РАЗ) — для знака << */
    row_one?: number;
    start_beat_id: number;
    start_time: number;
    reason?: string;
  };
  square_analysis: {
    parts: Record<string, SquarePart>;
    verdict: string;
    /** Разница в %: на сколько РАЗ больше ПЯТЬ — (РАЗ−ПЯТЬ)/ПЯТЬ×100 (только при square_confirmed) */
    row_dominance_pct?: number;
  };
  /** Таблица позиций рядов 1 и 5: энергия пикового бита, вероятность минимума в окне ±4 (100% = подозрение на мостик) */
  indicator_tact_table?: {
    tact_index: number;
    beat: number;
    time_sec: number;
    beat_energy: number;
    probability_pct: number;
    position: string;
  }[];
  indicators: Indicator[];
  bridges: Bridge[];
  perc_bridge_candidates?: {
    beat: number;
    time_sec: number;
    position: string;
    perc_energy: number;
  }[];
  perc_confirmed_bridges?: {
    beat: number;
    time_sec: number;
    position: string;
    diff_pct: number;
  }[];
  /** Сегменты раскладки (не выводим в UI, но приходят с API) */
  layout?: {
    from_beat: number;
    to_beat: number;
    time_start: number;
    time_end: number;
    row1_start: number;
  }[];
}

interface PerBeat {
  id: number;
  time: number;
  energy: number;
  perceptual_energy?: number;
  madmom_score: number;
  local_bpm?: number;
}

// Добавляем per_beat_data в V2Result
type V2ResultWithBeats = V2Result & { per_beat_data?: PerBeat[] };

interface Props {
  data: V2ResultWithBeats;
  trackId?: number;
  trackTitle?: string;
}

const ACTION_COLORS: Record<string, string> = {
  bridge_confirmed: "text-yellow-400 font-bold",
  ignored_break: "text-gray-500",
  ignored_same_square: "text-gray-500",
  ignored_no_change: "text-blue-400",
  ignored_small_diff: "text-orange-400",
  ignored_no_data: "text-gray-600",
  not_processed: "text-gray-600",
};

const ACTION_LABELS: Record<string, string> = {
  bridge_confirmed: "МОСТИК",
  ignored_break: "Брейк",
  ignored_same_square: "Не прошёл МК",
  ignored_no_change: "Ряды не менялись",
  ignored_small_diff: "Разница <3%",
  ignored_no_data: "Нет данных",
  not_processed: "Не обработан",
};

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function sanitizeTitle(title: string): string {
  return title
    .substring(0, 40)
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function downloadBeatsCSV(beats: PerBeat[], trackTitle?: string) {
  const suffix = trackTitle ? `_${sanitizeTitle(trackTitle)}` : "";
  const bom = "\ufeff";
  const header = "Beat,Time_sec,Energy,Perceptual_Energy,Madmom,Local_BPM\n";
  const rows = beats
    .map(
      (b) =>
        `${b.id},${b.time.toFixed(3)},${b.energy.toFixed(6)},${(b.perceptual_energy ?? 0).toFixed(3)},${b.madmom_score.toFixed(4)},${(b.local_bpm ?? 0).toFixed(1)}`,
    )
    .join("\n");
  const blob = new Blob([bom + header + rows], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `beats_v2${suffix}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function V2AnalysisDisplay({
  data,
  trackId,
  trackTitle,
}: Props) {
  return (
    <div className="space-y-4 text-sm">
      {/* Header badges */}
      <div className="flex flex-wrap gap-2">
        <span
          className={`px-2 py-1 rounded text-xs font-bold ${
            data.track_type === "popsa" ? "bg-purple-700" : "bg-green-700"
          }`}
        >
          {data.track_type === "popsa" ? "ПОПСА (4 пика)" : "БАЧАТА (2 пика)"}
        </span>
        <span className="px-2 py-1 rounded text-xs bg-gray-700">
          BPM: {data.bpm}
        </span>
        {data.row_swapped && (
          <span className="px-2 py-1 rounded text-xs bg-orange-700">
            Ряды свопнуты
          </span>
        )}
        <span
          className={`px-2 py-1 rounded text-xs ${
            data.bridges.length > 0 ? "bg-yellow-700" : "bg-green-800"
          }`}
        >
          Мостиков: {data.bridges.length}
        </span>
      </div>

      {/* Перцептивные мостики и кандидаты (наблюдательные, не влияют на сетку) */}
      {data.perc_confirmed_bridges?.length ||
      data.perc_bridge_candidates?.length ? (
        <div className="space-y-1">
          {data.perc_confirmed_bridges &&
            data.perc_confirmed_bridges.length > 0 && (
              <div className="text-xs">
                <span className="text-gray-500">
                  Перцептивные мостики ({data.perc_confirmed_bridges.length}):
                </span>{" "}
                {data.perc_confirmed_bridges.map((c, i) => (
                  <span key={i} className="mr-2">
                    <span className="text-orange-400 font-medium">
                      {c.time_sec.toFixed(1)}s
                    </span>
                    <span className="text-gray-600 ml-0.5">+{c.diff_pct}%</span>
                  </span>
                ))}
              </div>
            )}
          {data.perc_bridge_candidates &&
            data.perc_bridge_candidates.length > 0 && (
              <div className="text-xs text-gray-600">
                <span>Кандидаты (локал. мин.):</span>{" "}
                {data.perc_bridge_candidates.map((c, i) => (
                  <span key={i} className="mr-1.5">
                    <span className="text-gray-500">
                      {c.time_sec.toFixed(1)}s
                    </span>
                    <span className="text-gray-700 ml-0.5">
                      ({c.perc_energy}dB)
                    </span>
                  </span>
                ))}
              </div>
            )}
        </div>
      ) : null}

      {/* Raw Analysis (8 рядов, Beats / Sum / Avg / Max + Perc sum/avg) */}
      {data.track_type === "bachata" &&
        data.row_analysis &&
        Object.keys(data.row_analysis).length > 0 && (
          <details className="group" open>
            <summary className="text-sm font-medium text-gray-400 cursor-pointer hover:text-gray-300 select-none">
              Raw Analysis
            </summary>
            <div className="mt-2 overflow-x-auto space-y-2">
              {data.track_type === "bachata" &&
                data.row_analysis_verdict &&
                data.row_analysis && (
                  <div
                    className="text-xs text-gray-400"
                    title="Лидирующие ряды и их madmom sum по всем битам"
                  >
                    {(
                      data.row_analysis_verdict.winning_rows ?? [
                        data.row_analysis_verdict.winning_row,
                      ]
                    ).map((r, i) => {
                      const rowKey = `row_${r}`;
                      const rowData = data.row_analysis![rowKey];
                      const sum = rowData?.madmom_sum ?? 0;
                      const sumStr =
                        typeof sum === "number" ? sum.toFixed(3) : String(sum);
                      return (
                        <span key={r}>
                          {i > 0 && " | "}
                          <span className="text-green-400">Row {r}</span>:{" "}
                          {sumStr}
                        </span>
                      );
                    })}
                  </div>
                )}
              {data.row_analysis_verdict && (
                <p className="text-xs text-green-400">
                  Offset: {data.row_analysis_verdict.start_time}s (beat #
                  {data.row_analysis_verdict.start_beat_id})
                </p>
              )}
              <table className="text-xs w-full border-collapse">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-1 px-2">Row</th>
                    <th className="text-right py-1 px-2">Beats</th>
                    <th className="text-right py-1 px-2">Sum</th>
                    <th className="text-right py-1 px-2">Avg</th>
                    <th className="text-right py-1 px-2">Max</th>
                    <th className="text-right py-1 px-2">Perc sum</th>
                    <th className="text-right py-1 px-2">Perc avg</th>
                    <th className="text-left py-1 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.row_analysis)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, row]) => {
                      const rowNum = parseInt(key.replace("row_", ""), 10);
                      const winningRows =
                        data.row_analysis_verdict?.winning_rows ??
                        (data.row_analysis_verdict?.winning_row != null
                          ? [data.row_analysis_verdict.winning_row]
                          : []);
                      const isWinner = winningRows.includes(rowNum);
                      const isRowOne =
                        data.row_analysis_verdict?.row_one != null &&
                        rowNum === data.row_analysis_verdict.row_one;
                      const beatsInRow =
                        data.per_beat_data?.filter(
                          (b) => (b.id - 1) % 8 === rowNum - 1,
                        ) ?? [];
                      const percSum = beatsInRow.reduce(
                        (s, b) => s + (b.perceptual_energy ?? 0),
                        0,
                      );
                      const percAvg =
                        beatsInRow.length > 0 ? percSum / beatsInRow.length : 0;
                      return (
                        <tr
                          key={key}
                          className={`border-b border-gray-800 ${
                            isWinner
                              ? "bg-green-900/20 text-green-300"
                              : "text-gray-300"
                          }`}
                        >
                          <td className="py-1 px-2 font-mono">{rowNum}</td>
                          <td className="py-1 px-2 text-right font-mono">
                            {row.count}
                          </td>
                          <td className="py-1 px-2 text-right font-mono">
                            {row.madmom_sum?.toFixed(3)}
                          </td>
                          <td className="py-1 px-2 text-right font-mono">
                            {row.madmom_avg?.toFixed(3)}
                          </td>
                          <td className="py-1 px-2 text-right font-mono">
                            {row.madmom_max?.toFixed(3)}
                          </td>
                          <td className="py-1 px-2 text-right font-mono">
                            {percSum.toFixed(2)}
                          </td>
                          <td className="py-1 px-2 text-right font-mono">
                            {percAvg.toFixed(2)}
                          </td>
                          <td className="py-1 px-2">{isRowOne ? "<<" : ""}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {data.row_analysis_verdict && (
                <div className="text-xs text-gray-500 mt-2 space-y-1">
                  {(() => {
                    // Та же логика, что и ниже: пропуск 4 тактов, следующие 8 тактов (tact_sum из таблицы)
                    const SKIP_TACTS_PER_ROW = 4;
                    const TAKE_TACTS_PER_ROW = 8;
                    const winningRows =
                      data.row_analysis_verdict?.winning_rows ??
                      (data.row_analysis_verdict?.winning_row != null
                        ? [data.row_analysis_verdict.winning_row]
                        : []);
                    if (winningRows.length < 2) return null;
                    const [r1, r2] = winningRows;
                    const pos1 = r1 - 1;
                    const pos2 = r2 - 1;
                    const table = data.strong_rows_tact_table ?? [];
                    const row1Tacts = table
                      .filter((t) => t.row_position === pos1)
                      .sort((a, b) => a.beat - b.beat);
                    const row2Tacts = table
                      .filter((t) => t.row_position === pos2)
                      .sort((a, b) => a.beat - b.beat);
                    if (
                      row1Tacts.length <
                        SKIP_TACTS_PER_ROW + TAKE_TACTS_PER_ROW ||
                      row2Tacts.length < SKIP_TACTS_PER_ROW + TAKE_TACTS_PER_ROW
                    ) {
                      return (
                        <p className="text-gray-500 mt-1">
                          По Perc sum: нет данных (таблица тактов пуста или мало
                          записей)
                        </p>
                      );
                    }
                    const row1Slice = row1Tacts.slice(
                      SKIP_TACTS_PER_ROW,
                      SKIP_TACTS_PER_ROW + TAKE_TACTS_PER_ROW,
                    );
                    const row2Slice = row2Tacts.slice(
                      SKIP_TACTS_PER_ROW,
                      SKIP_TACTS_PER_ROW + TAKE_TACTS_PER_ROW,
                    );
                    const sum1 = row1Slice.reduce(
                      (s, t) => s + (t.tact_sum ?? 0),
                      0,
                    );
                    const sum2 = row2Slice.reduce(
                      (s, t) => s + (t.tact_sum ?? 0),
                      0,
                    );
                    const winnerRow = sum1 >= sum2 ? r1 : r2;
                    const winnerSlice = sum1 >= sum2 ? row1Slice : row2Slice;
                    const firstTact = winnerSlice[0];
                    const startBeatId = firstTact?.beat ?? winnerRow;
                    const startTime = firstTact?.time_sec ?? 0;
                    return (
                      <p className="text-gray-400 mt-1">
                        По Perc sum: ряд {winnerRow} победил, старт с бита #
                        {startBeatId} ({Number(startTime).toFixed(2)}s)
                      </p>
                    );
                  })()}
                  {(() => {
                    // Как в таблице «Такты сильных рядов»: откидываем первые 4 ТАКТА в каждом ряду, суммируем tact_sum следующих 8 тактов
                    const SKIP_TACTS_PER_ROW = 4;
                    const TAKE_TACTS_PER_ROW = 8;
                    const winningRows =
                      data.row_analysis_verdict?.winning_rows ??
                      (data.row_analysis_verdict?.winning_row != null
                        ? [data.row_analysis_verdict.winning_row]
                        : []);
                    if (winningRows.length < 2) return null;
                    const [r1, r2] = winningRows;
                    // row_position в таблице 0–7, ряд 1 → 0, ряд 5 → 4
                    const pos1 = r1 - 1;
                    const pos2 = r2 - 1;

                    const table = data.strong_rows_tact_table ?? [];
                    const row1Tacts = table
                      .filter((t) => t.row_position === pos1)
                      .sort((a, b) => a.beat - b.beat);
                    const row2Tacts = table
                      .filter((t) => t.row_position === pos2)
                      .sort((a, b) => a.beat - b.beat);

                    if (
                      row1Tacts.length <
                        SKIP_TACTS_PER_ROW + TAKE_TACTS_PER_ROW ||
                      row2Tacts.length < SKIP_TACTS_PER_ROW + TAKE_TACTS_PER_ROW
                    ) {
                      return (
                        <p className="text-gray-500 mt-1">
                          По тактам: нет данных (таблица тактов пуста или мало
                          записей)
                        </p>
                      );
                    }

                    const row1Slice = row1Tacts.slice(
                      SKIP_TACTS_PER_ROW,
                      SKIP_TACTS_PER_ROW + TAKE_TACTS_PER_ROW,
                    );
                    const row2Slice = row2Tacts.slice(
                      SKIP_TACTS_PER_ROW,
                      SKIP_TACTS_PER_ROW + TAKE_TACTS_PER_ROW,
                    );
                    const sum1 = row1Slice.reduce(
                      (s, t) => s + (t.tact_sum ?? 0),
                      0,
                    );
                    const sum2 = row2Slice.reduce(
                      (s, t) => s + (t.tact_sum ?? 0),
                      0,
                    );
                    const winnerByTacts = sum1 >= sum2 ? r1 : r2;
                    return (
                      <p className="text-gray-400 mt-1">
                        По 8 тактам ряда после пропуска 4 (tact_sum из таблицы):
                        ряд {winnerByTacts} победил (Row {r1}: {sum1.toFixed(1)}{" "}
                        | Row {r2}: {sum2.toFixed(1)})
                      </p>
                    );
                  })()}
                </div>
              )}
            </div>
          </details>
        )}

      {/* Графики побитовых данных (сразу после Raw Analysis) */}
      {data.per_beat_data && data.per_beat_data.length > 0 && (
        <div className="space-y-1">
          <PerBeatChart
            beats={data.per_beat_data}
            height={220}
            songStartBeat={data.song_start_beat}
            songStartTime={data.song_start_time}
          />
          <button
            onClick={() => downloadBeatsCSV(data.per_beat_data!, trackTitle)}
            className="px-2 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 cursor-pointer"
            title="Beat, Time_sec, Energy, Mel_Energy, Perceptual_Energy, Madmom — UTF-8 с BOM"
          >
            ↓ CSV побитов
          </button>
        </div>
      )}

      {/* Таблица тактов сильных рядов (суммы энергий по тактам) */}
      {data.track_type === "bachata" &&
        data.strong_rows_tact_table &&
        data.strong_rows_tact_table.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-gray-300 hover:text-white">
              Такты сильных рядов ({data.strong_rows_tact_table.length} записей)
            </summary>
            <div className="mt-2 overflow-x-auto max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700 sticky top-0 bg-gray-900">
                    <th className="text-left py-1 px-1">Ряд (поз.)</th>
                    <th className="text-left py-1 px-1">Бит</th>
                    <th className="text-left py-1 px-1">Время</th>
                    <th className="text-right py-1 px-1">Сумма такта</th>
                    <th className="text-right py-1 px-1">Ср. такта</th>
                  </tr>
                </thead>
                <tbody>
                  {data.strong_rows_tact_table.slice(0, 100).map((r, i) => (
                    <tr key={i} className="border-b border-gray-800">
                      <td className="py-1 px-1 font-mono">{r.row_position}</td>
                      <td className="py-1 px-1 font-mono">{r.beat}</td>
                      <td className="py-1 px-1">{formatTime(r.time_sec)}</td>
                      <td className="py-1 px-1 text-right">
                        {r.tact_sum.toFixed(4)}
                      </td>
                      <td className="py-1 px-1 text-right">
                        {r.tact_avg.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.strong_rows_tact_table.length > 100 && (
                <p className="text-gray-500 text-xs mt-1">
                  … и ещё {data.strong_rows_tact_table.length - 100} записей
                </p>
              )}
            </div>
          </details>
        )}

      {/* Square analysis: 4 строки по мадмому, затем 4 строки по энергии */}
      {data.square_analysis?.parts &&
        Object.keys(data.square_analysis.parts).length > 0 && (
          <details open={data.square_analysis.verdict === "has_bridges"}>
            <summary className="cursor-pointer text-xs font-semibold text-gray-300 hover:text-white">
              Квадратный анализ:{" "}
              {data.square_analysis.verdict === "has_bridges"
                ? "есть красные"
                : "все зелёные"}
            </summary>
            <div className="mt-2 space-y-4">
              {/* Mel Energy: 4 строки (1/1, 1/2, 1/3, 1/5) */}
              <div>
                <div className="text-xs font-medium text-gray-400 mb-1.5">
                  Mel Energy
                </div>
                <div className="space-y-2">
                  {[
                    ["1/1"],
                    ["1/2_first", "1/2_second"],
                    ["1/3_first", "1/3_second", "1/3_third"],
                    ["1/5_1", "1/5_2", "1/5_3", "1/5_4", "1/5_5"],
                  ].map((keys, rowIdx) => {
                    const entries: [string, SquarePart][] = keys
                      .map((k) => {
                        const part = data.square_analysis!.parts[k];
                        return part
                          ? ([k, part] as [string, SquarePart])
                          : null;
                      })
                      .filter((x): x is [string, SquarePart] => x != null);
                    if (entries.length === 0) return null;
                    return (
                      <div
                        key={`mel-${rowIdx}`}
                        className="flex flex-wrap gap-1.5 items-stretch"
                      >
                        {entries.map(([name, part]) => {
                          const hasPerc =
                            part.row1_perc != null && part.row5_perc != null;
                          const status = hasPerc
                            ? part.status_perc
                            : (part.status as "green" | "red");
                          return (
                            <div
                              key={name}
                              className={`px-2 py-1.5 rounded text-xs min-w-[6rem] ${
                                status === "green"
                                  ? "bg-green-900/50 text-green-300"
                                  : "bg-red-900/50 text-red-300"
                              }`}
                            >
                              <span className="font-mono">{name}</span>
                              {part.time_start != null &&
                                part.time_end != null && (
                                  <>
                                    <br />
                                    <span className="text-gray-400">
                                      {formatTime(part.time_start)} –{" "}
                                      {formatTime(part.time_end)}
                                    </span>
                                  </>
                                )}
                              <br />
                              {hasPerc ? (
                                <>
                                  R1 {(part.row1_perc ?? 0).toFixed(0)} / R5{" "}
                                  {(part.row5_perc ?? 0).toFixed(0)}
                                </>
                              ) : (
                                <>
                                  R1 {(part.row1 ?? 0).toFixed(2)} / R5{" "}
                                  {(part.row5 ?? 0).toFixed(2)}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Энергия: 4 строки (1/1, 1/2, 1/3, 1/5) */}
              <div>
                <div className="text-xs font-medium text-gray-400 mb-1.5">
                  Энергия
                </div>
                <div className="space-y-2">
                  {[
                    ["1/1"],
                    ["1/2_first", "1/2_second"],
                    ["1/3_first", "1/3_second", "1/3_third"],
                    ["1/5_1", "1/5_2", "1/5_3", "1/5_4", "1/5_5"],
                  ].map((keys, rowIdx) => {
                    const entries: [string, SquarePart][] = keys
                      .map((k) => {
                        const part = data.square_analysis!.parts[k];
                        return part
                          ? ([k, part] as [string, SquarePart])
                          : null;
                      })
                      .filter((x): x is [string, SquarePart] => x != null);
                    if (entries.length === 0) return null;
                    return (
                      <div
                        key={`energy-${rowIdx}`}
                        className="flex flex-wrap gap-1.5 items-stretch"
                      >
                        {entries.map(([name, part]) => {
                          const hasNew =
                            part.row1_energy != null &&
                            part.row5_energy != null;
                          const status = hasNew
                            ? part.status_energy
                            : (part.status as "green" | "red");
                          return (
                            <div
                              key={name}
                              className={`px-2 py-1.5 rounded text-xs min-w-[6rem] ${
                                status === "green"
                                  ? "bg-green-900/50 text-green-300"
                                  : "bg-red-900/50 text-red-300"
                              }`}
                            >
                              <span className="font-mono">{name}</span>
                              {part.time_start != null &&
                                part.time_end != null && (
                                  <>
                                    <br />
                                    <span className="text-gray-400">
                                      {formatTime(part.time_start)} –{" "}
                                      {formatTime(part.time_end)}
                                    </span>
                                  </>
                                )}
                              <br />
                              {hasNew ? (
                                <>
                                  R1 {(part.row1_energy ?? 0).toFixed(2)} / R5{" "}
                                  {(part.row5_energy ?? 0).toFixed(2)}
                                </>
                              ) : (
                                <>
                                  R1 {(part.row1 ?? 0).toFixed(2)} / R5{" "}
                                  {(part.row5 ?? 0).toFixed(2)}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </details>
        )}

      {/* Таблица тактов: вероятность минимума в окне ±4 (100% = подозрение на мостик) */}
      {data.indicator_tact_table && data.indicator_tact_table.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-gray-300 hover:text-white">
            Ряды 1 и 5 — энергия пикового бита, вероятность минимума (
            {data.indicator_tact_table.length} поз.)
          </summary>
          <div className="mt-2 overflow-x-auto max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700 sticky top-0 bg-gray-900">
                  <th className="text-left py-1 px-1">№</th>
                  <th className="text-left py-1 px-1">Бит</th>
                  <th className="text-left py-1 px-1">Время</th>
                  <th className="text-left py-1 px-1">Энергия бита</th>
                  <th className="text-left py-1 px-1">Вероятность %</th>
                  <th className="text-left py-1 px-1">Позиция</th>
                </tr>
              </thead>
              <tbody>
                {data.indicator_tact_table.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b border-gray-800 ${
                      row.probability_pct >= 99.99
                        ? "bg-amber-900/30 text-amber-200"
                        : ""
                    }`}
                  >
                    <td className="py-1 px-1 font-mono">{row.tact_index}</td>
                    <td className="py-1 px-1 font-mono">{row.beat}</td>
                    <td className="py-1 px-1">{formatTime(row.time_sec)}</td>
                    <td className="py-1 px-1">
                      {(
                        row.beat_energy ??
                        (row as { tact_sum?: number }).tact_sum ??
                        0
                      ).toFixed(3)}
                    </td>
                    <td className="py-1 px-1 font-mono">
                      {row.probability_pct.toFixed(1)}%
                      {row.probability_pct >= 99.99 && (
                        <span className="ml-1 text-amber-400">
                          подозрение на мостик
                        </span>
                      )}
                    </td>
                    <td className="py-1 px-1 text-gray-500">{row.position}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Indicators table */}
      {data.indicators && data.indicators.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-gray-300 hover:text-white">
            Индикаторы ({data.indicators.length})
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left py-1 px-1">Beat</th>
                  <th className="text-left py-1 px-1">Время</th>
                  <th className="text-left py-1 px-1">Ряд</th>
                  <th className="text-left py-1 px-1">Energy</th>
                  <th className="text-left py-1 px-1">Решение</th>
                  <th className="text-left py-1 px-1">R1/R5</th>
                </tr>
              </thead>
              <tbody>
                {data.indicators.map((ind, i) => (
                  <tr key={i} className="border-b border-gray-800">
                    <td className="py-1 px-1 font-mono">{ind.beat}</td>
                    <td className="py-1 px-1">{formatTime(ind.time_sec)}</td>
                    <td className="py-1 px-1">{ind.position}</td>
                    <td className="py-1 px-1">{ind.energy_sum?.toFixed(3)}</td>
                    <td
                      className={`py-1 px-1 ${ACTION_COLORS[ind.action] || ""}`}
                    >
                      {ACTION_LABELS[ind.action] || ind.action}
                      {ind.diff_pct !== undefined && (
                        <span className="text-gray-500 ml-1">
                          ({ind.diff_pct}%)
                        </span>
                      )}
                    </td>
                    <td className="py-1 px-1 text-gray-500">
                      {ind.row1_sum !== undefined &&
                        ind.row5_sum !== undefined && (
                          <>
                            {ind.row1_sum.toFixed(2)} /{" "}
                            {ind.row5_sum.toFixed(2)}
                          </>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
