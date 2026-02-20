"use client";

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
  row1_mel?: number;
  row5_mel?: number;
  status_mel?: "green" | "red";
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

interface LayoutSegment {
  from_beat: number;
  to_beat: number;
  time_start: number;
  time_end: number;
  row1_start: number;
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
  layout: LayoutSegment[];
}

interface PerBeat {
  id: number;
  time: number;
  energy: number;
  mel_energy: number;
  madmom_score: number;
}

// Добавляем per_beat_data в V2Result
type V2ResultWithBeats = V2Result & { per_beat_data?: PerBeat[] };

interface Props {
  data: V2ResultWithBeats;
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

function downloadBeatsCSV(beats: PerBeat[]) {
  const bom = "\ufeff";
  const header = "Beat,Time_sec,Energy,Mel_Energy,Madmom\n";
  const rows = beats
    .map(
      (b) =>
        `${b.id},${b.time.toFixed(3)},${b.energy.toFixed(6)},${(b.mel_energy ?? 0).toFixed(2)},${b.madmom_score.toFixed(4)}`,
    )
    .join("\n");
  const blob = new Blob([bom + header + rows], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "beats_v2.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function V2AnalysisDisplay({ data }: Props) {
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
        <span className="px-2 py-1 rounded text-xs bg-gray-700">
          Начало: бит {data.song_start_beat} ({formatTime(data.song_start_time)}
          )
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

      {/* Row sums */}
      {data.track_type === "bachata" && (
        <div className="text-xs text-gray-400">
          Row 1: {data.row1_sum?.toFixed(4)} | Row 5:{" "}
          {data.row5_sum?.toFixed(4)}
        </div>
      )}

      {/* Row Analysis (как в корреляции: 8 рядов, Beats / Sum / Avg / Max) */}
      {data.track_type === "bachata" &&
        data.row_analysis &&
        Object.keys(data.row_analysis).length > 0 && (
          <details className="group" open>
            <summary className="text-sm font-medium text-gray-400 cursor-pointer hover:text-gray-300 select-none">
              Row Analysis{" "}
              {data.row_analysis_verdict && (
                <span className="text-green-400 ml-1">
                  (пики: Row{" "}
                  {data.row_analysis_verdict.winning_rows?.join(", ") ??
                    data.row_analysis_verdict.winning_row}
                  )
                </span>
              )}
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="text-xs w-full border-collapse">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-1 px-2">Row</th>
                    <th className="text-right py-1 px-2">Beats</th>
                    <th className="text-right py-1 px-2">Sum</th>
                    <th className="text-right py-1 px-2">Avg</th>
                    <th className="text-right py-1 px-2">Max</th>
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
                          <td className="py-1 px-2">{isRowOne ? "<<" : ""}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {data.row_analysis_verdict && (
                <div className="text-xs text-gray-500 mt-2 space-y-1">
                  <p>
                    Offset: {data.row_analysis_verdict.start_time}s (beat #
                    {data.row_analysis_verdict.start_beat_id})
                  </p>
                </div>
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
              {typeof data.square_analysis.row_dominance_pct === "number" && (
                <span
                  className={
                    (data.square_analysis.row_dominance_pct ?? 0) >= 0
                      ? "text-green-400 ml-1"
                      : "text-amber-400 ml-1"
                  }
                  title="Разница в %: на сколько РАЗ больше ПЯТЬ — (РАЗ−ПЯТЬ)/ПЯТЬ×100. 0% = поровну, отрицательный = ПЯТЬ больше."
                >
                  (разница РАЗ−ПЯТЬ:{" "}
                  {data.square_analysis.row_dominance_pct.toFixed(1)}%)
                </span>
              )}
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
                          const hasMel =
                            part.row1_mel != null && part.row5_mel != null;
                          const status = hasMel
                            ? part.status_mel
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
                              {hasMel ? (
                                <>
                                  R1 {(part.row1_mel ?? 0).toFixed(0)} / R5{" "}
                                  {(part.row5_mel ?? 0).toFixed(0)}
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
              {data.per_beat_data && data.per_beat_data.length > 0 && (
                <div className="pt-1">
                  <button
                    onClick={() => downloadBeatsCSV(data.per_beat_data!)}
                    className="px-2 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 cursor-pointer"
                    title="Beat, Time_sec, Energy, Mel_Energy, Madmom — UTF-8 с BOM, открывается в Excel"
                  >
                    ↓ CSV побитов
                  </button>
                </div>
              )}
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

      {/* Layout / Bridges timeline */}
      {data.layout && data.layout.length > 0 && (
        <details open>
          <summary className="cursor-pointer text-xs font-semibold text-gray-300 hover:text-white">
            Раскладка рядов ({data.layout.length} сегментов)
          </summary>
          <div className="mt-2 flex flex-wrap gap-1">
            {data.layout.map((seg, i) => {
              const isBridge = i > 0;
              return (
                <div
                  key={i}
                  className={`px-2 py-1 rounded text-xs ${
                    seg.row1_start === 1
                      ? "bg-blue-900/50 text-blue-300"
                      : "bg-purple-900/50 text-purple-300"
                  } ${isBridge ? "border-l-2 border-yellow-500" : ""}`}
                >
                  <div className="font-mono">
                    {formatTime(seg.time_start)} — {formatTime(seg.time_end)}
                  </div>
                  <div>
                    Бит {seg.from_beat}–{seg.to_beat} | Row {seg.row1_start}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
