"use client";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine,
} from "recharts";
import { BeatData, CHART_COLORS, formatTime, TOOLTIP_STYLE } from "./SharedChartProps";

interface TempoChange {
  time: number;
  type: string;
  bpm_before: number;
  bpm_after: number;
}

interface Props {
  beats: BeatData[];
  avgBpm: number;
  tempoChanges?: TempoChange[];
}

export default function TempoChart({ beats, avgBpm, tempoChanges }: Props) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={beats} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <XAxis
          dataKey="time"
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          tickFormatter={formatTime}
        />
        <YAxis
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          width={45}
          domain={['auto', 'auto']}
        />
        <Tooltip
          {...TOOLTIP_STYLE}
          labelFormatter={(v) => formatTime(v as number)}
          formatter={(value: any) => [`${Number(value ?? 0).toFixed(1)} BPM`, "Local BPM"]}
        />
        <ReferenceLine
          y={avgBpm}
          stroke="#6366f1"
          strokeDasharray="6 3"
          label={{ value: `avg ${avgBpm}`, position: "right", fill: "#6366f1", fontSize: 10 }}
        />
        {tempoChanges?.map((tc, i) => (
          <ReferenceLine
            key={i}
            x={tc.time}
            stroke={tc.type === "acceleration" ? "#22c55e" : "#ef4444"}
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        ))}
        <Line
          type="monotone"
          dataKey="local_bpm"
          stroke="#f59e0b"
          dot={false}
          strokeWidth={1.5}
          name="Local BPM"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
