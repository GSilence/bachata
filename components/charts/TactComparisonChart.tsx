"use client";
import { useState, useEffect, useCallback } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";

interface TactEntry {
  row_position: number;
  beat: number;
  time_sec: number;
  tact_sum: number;
  tact_avg: number;
}

interface Props {
  tactTable: TactEntry[];
  /** 1-индексированные: [peak_row_1, peak_row_2] */
  winningRows: number[];
  songStartBeat: number;
  percMean?: number;
  height?: number;
}

interface ChartPoint {
  idx: number;
  r1: number | null;
  r2: number | null;
}

export default function TactComparisonChart({
  tactTable,
  winningRows,
  songStartBeat,
  percMean,
  height = 200,
}: Props) {
  const [fullscreen, setFullscreen] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setFullscreen(false);
  }, []);

  useEffect(() => {
    if (fullscreen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [fullscreen, handleKeyDown]);

  if (!tactTable.length || winningRows.length < 2) return null;

  const pos1 = winningRows[0] - 1; // 0-индексированная позиция в 8-бит цикле
  const pos2 = winningRows[1] - 1;

  const row1Tacts = tactTable
    .filter((t) => t.row_position === pos1)
    .sort((a, b) => a.beat - b.beat);
  const row2Tacts = tactTable
    .filter((t) => t.row_position === pos2)
    .sort((a, b) => a.beat - b.beat);

  const maxLen = Math.min(row1Tacts.length, row2Tacts.length);
  if (maxLen === 0) return null;

  // Находим номер пары тактов, где начинается песня (song_start_beat)
  let startTactIdx = 0;
  for (let i = 0; i < maxLen; i++) {
    const minBeat = Math.min(
      row1Tacts[i]?.beat ?? Infinity,
      row2Tacts[i]?.beat ?? Infinity,
    );
    if (minBeat >= songStartBeat) {
      startTactIdx = i + 1;
      break;
    }
  }

  const chartData: ChartPoint[] = Array.from({ length: maxLen }, (_, i) => ({
    idx: i + 1,
    r1: row1Tacts[i]?.tact_avg ?? null,
    r2: row2Tacts[i]?.tact_avg ?? null,
  }));

  const renderChart = (chartHeight: number, tickInterval: number) => (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <LineChart
        data={chartData}
        margin={{ top: 6, right: 16, bottom: 4, left: 0 }}
      >
        <XAxis
          dataKey="idx"
          tick={{ fontSize: 9, fill: "#9ca3af" }}
          interval={tickInterval}
        />
        <YAxis tick={{ fontSize: 9, fill: "#9ca3af" }} width={38} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#1f2937",
            border: "1px solid #374151",
            color: "#e5e7eb",
            fontSize: 11,
          }}
          formatter={(value: unknown, name: string) => [
            typeof value === "number" ? `${value.toFixed(2)} dB` : "—",
            name,
          ]}
          labelFormatter={(label) => `Пара тактов #${label}`}
        />
        <Legend wrapperStyle={{ fontSize: 10, paddingTop: 2 }} />

        {/* Горизонталь: среднее perceptual по всей песне */}
        {percMean != null && (
          <ReferenceLine
            y={percMean}
            stroke="#6b7280"
            strokeDasharray="4 2"
            label={{
              value: `avg ${percMean.toFixed(1)}dB`,
              fill: "#6b7280",
              fontSize: 9,
              position: "insideTopRight",
            }}
          />
        )}

        {/* Вертикаль: начало активной части (song_start_beat) */}
        {startTactIdx > 0 && (
          <ReferenceLine
            x={startTactIdx}
            stroke="#facc15"
            strokeDasharray="3 2"
            label={{
              value: "start",
              fill: "#facc15",
              fontSize: 9,
              position: "insideTopRight",
            }}
          />
        )}

        <Line
          dataKey="r1"
          name={`Ряд ${winningRows[0]}`}
          stroke="#4ade80"
          dot={false}
          strokeWidth={1.5}
          connectNulls
        />
        <Line
          dataKey="r2"
          name={`Ряд ${winningRows[1]}`}
          stroke="#f97316"
          dot={false}
          strokeWidth={1.5}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );

  const tickInterval = Math.max(1, Math.floor(maxLen / 12));
  const title = `Perceptual Energy тактов: ряд ${winningRows[0]} vs ряд ${winningRows[1]}`;

  return (
    <>
      <div>
        <div className="flex items-center gap-1 mb-1">
          <div className="text-xs font-semibold text-gray-400 flex-1">
            {title}{" "}
            <span className="text-gray-600 font-normal">
              (пар: {maxLen}, X = номер пары такт-А/такт-Б)
            </span>
          </div>
          <button
            onClick={() => setFullscreen(true)}
            className="text-gray-500 hover:text-gray-300 p-1 rounded hover:bg-gray-700 transition-colors flex-shrink-0"
            title="Fullscreen"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
            </svg>
          </button>
        </div>
        {renderChart(height, tickInterval)}
      </div>

      {/* Fullscreen overlay */}
      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
          <div className="flex items-center gap-2 p-3 border-b border-gray-700">
            <div className="text-sm font-semibold text-gray-300 flex-1">
              {title}{" "}
              <span className="text-gray-500 font-normal text-xs">
                (пар: {maxLen})
              </span>
            </div>
            <button
              onClick={() => setFullscreen(false)}
              className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-700 transition-colors"
              title="Закрыть (Escape)"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 p-4 min-h-0">
            {renderChart(undefined as unknown as number, Math.max(1, Math.floor(maxLen / 20)))}
          </div>
        </div>
      )}
    </>
  );
}
