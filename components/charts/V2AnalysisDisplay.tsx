"use client";

import React from "react";
import dynamic from "next/dynamic";

const PerBeatChart = dynamic(() => import("./PerBeatChart"), { ssr: false });
const TactComparisonChart = dynamic(
  () => import("./TactComparisonChart"),
  { ssr: false },
);

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
  perceptual_energy_mean?: number;
  strong_rows_tact_table?: {
    row_position: number;
    beat: number;
    time_sec: number;
    tact_sum: number;
    tact_avg: number;
  }[];
  /** По 8 тактам ряда после пропуска 4 (tact_sum из таблицы) — предвычислено в скрипте */
  tact_sum_8_after_skip4?: {
    row_position: number;
    beat: number;
    tact_sum: number;
  }[];
  /** Статистика: биты (не последние в такте) выше среднего и выше среднего+N% */
  beats_above_avg_stats?: {
    perceptual_mean: number;
    total_beats_row1: number;
    total_beats_row5: number;
    beats_above_avg_row1: number;
    beats_above_avg_row5: number;
    beats_above_avg_plus_pct_row1: number;
    beats_above_avg_plus_pct_row5: number;
    threshold_avg_plus_pct: number;
    beats_above_avg_plus_pct_config: number;
  };
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
  /** Таблица позиций рядов 1 и 5 (RMS): вероятность минимума в окне ±4 */
  indicator_tact_table?: {
    tact_index: number;
    beat: number;
    time_sec: number;
    beat_energy: number;
    probability_pct: number;
    position: string;
  }[];
  indicators: Indicator[];
  /** Решения по индикаторам (perceptual ветка) — те же индикаторы, проверка через perceptual_energy */
  indicators_perc?: Indicator[];
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
  skip_bridges?: boolean;
  skip_bridges_reason?: string;
  madmom_diff_pct?: number;
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
  /** true если админ вручную свапнул ряды — в Raw Analysis помечаем новый РАЗ оранжевым */
  trackRowSwapped?: boolean;
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
  trackRowSwapped = false,
}: Props) {
  return (
    <div className="space-y-4 text-sm">
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
                  {(() => {
                    const rowOne = data.row_analysis_verdict?.row_one;
                    // При ручном свайпе новый РАЗ = противоположная половина восьмёрки: 1↔5, 2↔6, 3↔7, 4↔8
                    const displayedRazAfterSwap =
                      trackRowSwapped && rowOne != null && rowOne >= 1 && rowOne <= 8
                        ? (rowOne <= 4 ? rowOne + 4 : rowOne - 4)
                        : null;
                    return Object.entries(data.row_analysis)
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
                          rowOne != null && rowNum === rowOne;
                        const isDisplayedRazAfterSwap =
                          displayedRazAfterSwap != null &&
                          rowNum === displayedRazAfterSwap;
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
                              isDisplayedRazAfterSwap
                                ? "bg-orange-900/20 text-orange-300"
                                : isWinner
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
                            <td className="py-1 px-2">
                              {isDisplayedRazAfterSwap ? (
                                <span className="text-orange-400 font-bold" title="Свапнутый ряд (текущий РАЗ)">
                                  &lt;&lt;
                                </span>
                              ) : isRowOne ? (
                                "<<"
                              ) : (
                                ""
                              )}
                            </td>
                          </tr>
                        );
                      });
                  })()}
                </tbody>
              </table>
              {data.row_analysis_verdict && (
                <div className="text-xs text-gray-400 mt-2 space-y-1">
                  {(() => {
                    const winningRows =
                      data.row_analysis_verdict?.winning_rows ??
                      (data.row_analysis_verdict?.winning_row != null
                        ? [data.row_analysis_verdict.winning_row]
                        : []);
                    if (winningRows.length < 2) return null;
                    // row_one = истинный РАЗ (из find_song_start_perc), может не совпадать с winningRows[0]
                    // winning_rows всегда [меньший_ряд, больший_ряд] — по позиции, а не по РАЗ/ПЯТЬ
                    const rowOne = data.row_analysis_verdict?.row_one;
                    const r1 = rowOne != null && winningRows.includes(rowOne) ? rowOne : winningRows[0];
                    const r2 = winningRows.find((r) => r !== r1) ?? winningRows[1];

                    // 1. Мадмом %
                    const r1Madmom =
                      data.row_analysis?.[`row_${r1}`]?.madmom_sum ?? 0;
                    const r2Madmom =
                      data.row_analysis?.[`row_${r2}`]?.madmom_sum ?? 0;
                    const madmomDiff =
                      r2Madmom !== 0
                        ? ((r1Madmom - r2Madmom) / Math.abs(r2Madmom)) * 100
                        : 0;

                    // 2. Перцептуал по битам %
                    const r1Beats =
                      data.per_beat_data?.filter(
                        (b) => (b.id - 1) % 8 === r1 - 1,
                      ) ?? [];
                    const r2Beats =
                      data.per_beat_data?.filter(
                        (b) => (b.id - 1) % 8 === r2 - 1,
                      ) ?? [];
                    const r1PercSum = r1Beats.reduce(
                      (s, b) => s + (b.perceptual_energy ?? 0),
                      0,
                    );
                    const r2PercSum = r2Beats.reduce(
                      (s, b) => s + (b.perceptual_energy ?? 0),
                      0,
                    );
                    // Средние на бит (не суммы) — сравнимы независимо от кол-ва битов
                    const r1PercAvg = r1Beats.length > 0 ? r1PercSum / r1Beats.length : 0;
                    const r2PercAvg = r2Beats.length > 0 ? r2PercSum / r2Beats.length : 0;
                    // dB diff: положительный = РАЗ громче, отрицательный = ПЯТЬ громче
                    const percDiff = r1PercAvg - r2PercAvg;

                    // 3. Такт-суммы перцептуал % (весь трек)
                    const table = data.strong_rows_tact_table ?? [];
                    const r1Tacts = table.filter((t) => t.row_position === r1 - 1);
                    const r2Tacts = table.filter((t) => t.row_position === r2 - 1);
                    let tactSum1: number | null = null;
                    let tactSum2: number | null = null;
                    let tactDiff: number | null = null;
                    if (r1Tacts.length > 0 && r2Tacts.length > 0) {
                      tactSum1 = r1Tacts.reduce((s, t) => s + (t.tact_sum ?? 0), 0);
                      tactSum2 = r2Tacts.reduce((s, t) => s + (t.tact_sum ?? 0), 0);
                      tactDiff =
                        tactSum2 !== 0
                          ? ((tactSum1 - tactSum2) / Math.abs(tactSum2)) * 100
                          : 0;
                    }

                    const fmt = (n: number) =>
                      `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
                    const cls = (n: number) =>
                      n >= 0 ? "text-green-400" : "text-red-400";

                    return (
                      <>
                        <p>
                          Мадмом: РАЗ={r1Madmom.toFixed(3)}, ПЯТЬ=
                          {r2Madmom.toFixed(3)} →{" "}
                          <span className={cls(madmomDiff)}>
                            {fmt(madmomDiff)}
                          </span>
                          {Math.round(Math.abs(madmomDiff) * 10) / 10 >= 5 && (
                            <span className="ml-2 px-1 py-0.5 rounded text-xs bg-green-800 text-green-200">
                              |≥5%| → без мостиков
                            </span>
                          )}

                        </p>
                        <p>
                          Перцептуал (avg/бит): РАЗ={r1PercAvg.toFixed(2)} dB,
                          ПЯТЬ={r2PercAvg.toFixed(2)} dB →{" "}
                          <span className={cls(percDiff)}>
                            {percDiff >= 0 ? "+" : ""}{percDiff.toFixed(2)} dB
                          </span>
                        </p>
                        {tactSum1 !== null &&
                          tactSum2 !== null &&
                          tactDiff !== null && (
                            <>
                              <p>
                                Перцептуал по тактам: РАЗ={tactSum1.toFixed(1)},
                                ПЯТЬ={tactSum2.toFixed(1)} →{" "}
                                <span className={cls(tactDiff)}>
                                  {fmt(tactDiff)}
                                </span>
                              </p>
                              {(() => {
                                const avgR1 = tactSum1 / r1Tacts.length;
                                const avgR2 = tactSum2 / r2Tacts.length;
                                const dbDiff = avgR1 - avgR2;
                                return (
                                  <p>
                                    Разница громкости: avg РАЗ={avgR1.toFixed(2)} dB,
                                    avg ПЯТЬ={avgR2.toFixed(2)} dB →{" "}
                                    <span className={cls(dbDiff)}>
                                      {dbDiff >= 0 ? "+" : ""}
                                      {dbDiff.toFixed(2)} dB
                                    </span>
                                  </p>
                                );
                              })()}
                            </>
                          )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </details>
        )}

      {/* Графики — под катом */}
      {(data.per_beat_data?.length ?? 0) > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-gray-300 hover:text-white">
            Графики
          </summary>
          <div className="mt-2 space-y-2">
            <PerBeatChart
              beats={data.per_beat_data!}
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
            {data.track_type === "bachata" &&
              data.strong_rows_tact_table &&
              data.strong_rows_tact_table.length > 0 &&
              data.row_analysis_verdict?.winning_rows &&
              data.row_analysis_verdict.winning_rows.length >= 2 && (
                <TactComparisonChart
                  tactTable={data.strong_rows_tact_table}
                  winningRows={data.row_analysis_verdict.winning_rows}
                  songStartBeat={data.song_start_beat}
                  percMean={data.perceptual_energy_mean}
                  height={180}
                />
              )}
          </div>
        </details>
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
              {data.skip_bridges && (
                <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-green-800 text-green-200">
                  мостики пропущены:{" "}
                  {data.skip_bridges_reason === "all_green"
                    ? "все квадраты зелёные"
                    : data.skip_bridges_reason?.startsWith("madmom_dominance")
                      ? `мадмом РАЗ>${data.madmom_diff_pct?.toFixed(1)}%`
                      : data.skip_bridges_reason}
                </span>
              )}
            </summary>
            <div className="mt-2 space-y-4">
              {/* Perceptual Energy: 4 строки (1/1, 1/2, 1/3, 1/5) */}
              <div>
                <div className="text-xs font-medium text-gray-400 mb-1.5">
                  Perceptual Energy
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

              {/* RMS Energy: 4 строки (1/1, 1/2, 1/3, 1/5) */}
              <div>
                <div className="text-xs font-medium text-gray-400 mb-1.5">
                  RMS Energy
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

      {/* Индикаторы Perceptual — решения по тем же индикаторам через perceptual_energy */}
      {data.indicators_perc && data.indicators_perc.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-purple-300 hover:text-purple-100">
            Индикаторы Perceptual ({data.indicators_perc.length})
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left py-1 px-1">Beat</th>
                  <th className="text-left py-1 px-1">Время</th>
                  <th className="text-left py-1 px-1">Ряд</th>
                  <th className="text-left py-1 px-1">Решение</th>
                  <th className="text-left py-1 px-1">R1/R5 (dB)</th>
                </tr>
              </thead>
              <tbody>
                {data.indicators_perc.map((ind, i) => (
                  <tr key={i} className="border-b border-gray-800">
                    <td className="py-1 px-1 font-mono">{ind.beat}</td>
                    <td className="py-1 px-1">{formatTime(ind.time_sec)}</td>
                    <td className="py-1 px-1">{ind.position}</td>
                    <td className={`py-1 px-1 ${ACTION_COLORS[ind.action] || ""}`}>
                      {ACTION_LABELS[ind.action] || ind.action}
                      {ind.diff_pct !== undefined && (
                        <span className="text-gray-500 ml-1">({ind.diff_pct}%)</span>
                      )}
                    </td>
                    <td className="py-1 px-1 text-gray-500">
                      {ind.row1_sum !== undefined && ind.row5_sum !== undefined && (
                        <>{ind.row1_sum.toFixed(1)} / {ind.row5_sum.toFixed(1)}</>
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
