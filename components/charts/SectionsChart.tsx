"use client";
import { formatTime } from "./SharedChartProps";

interface FourCount {
  count: number;
  start_time: number;
  end_time: number;
  duration: number;
  avg_intensity: number;
  level?: string;
}

interface Props {
  fourCounts?: FourCount[];
  duration: number;
}

const LEVEL_COLORS: Record<string, string> = {
  HIGH: "bg-red-500/50",
  MEDIUM: "bg-yellow-500/30",
  LOW: "bg-green-500/20",
};

export default function SectionsChart({ fourCounts, duration }: Props) {
  return (
    <div className="space-y-4">
      {fourCounts && fourCounts.length > 0 && (
        <div>
          <div className="text-xs text-gray-400 mb-1">
            Four-Counts ({fourCounts.length} groups)
          </div>
          <div className="flex w-full h-6 rounded overflow-hidden border border-gray-700">
            {fourCounts.map((ec) => {
              const widthPct = (ec.duration / duration) * 100;
              const bgColor = LEVEL_COLORS[ec.level ?? "MEDIUM"];
              return (
                <div
                  key={ec.count}
                  className={`${bgColor} border-r border-gray-700/50 last:border-r-0`}
                  style={{ width: `${widthPct}%` }}
                  title={`Count ${ec.count}: ${formatTime(ec.start_time)}–${formatTime(ec.end_time)} | ${ec.level} (${ec.avg_intensity.toFixed(3)})`}
                />
              );
            })}
          </div>
          <div className="flex gap-3 mt-1 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-red-500/50 inline-block" /> HIGH
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-yellow-500/30 inline-block" /> MEDIUM
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-green-500/20 inline-block" /> LOW
            </span>
          </div>
        </div>
      )}
      {(!fourCounts || fourCounts.length === 0) && (
        <p className="text-gray-500 text-sm text-center py-4">
          Нет данных four-counts. Переанализируйте трек.
        </p>
      )}
    </div>
  );
}
