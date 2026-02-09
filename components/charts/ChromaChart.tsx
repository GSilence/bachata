"use client";
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, Tooltip, Cell,
} from "recharts";
import { BeatData, CHART_COLORS, formatTime, TOOLTIP_STYLE, NOTE_NAMES } from "./SharedChartProps";

interface Props {
  beats: BeatData[];
}

const NOTE_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef',
];

export default function ChromaChart({ beats }: Props) {
  const data = beats
    .filter(b => b.chroma_index !== undefined)
    .map(b => ({
      time: b.time,
      note: b.chroma_index!,
      noteName: b.chroma_note,
      strength: b.chroma_strength ?? 0,
    }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <XAxis
          dataKey="time"
          type="number"
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          tickFormatter={formatTime}
          domain={["dataMin", "dataMax"]}
        />
        <YAxis
          dataKey="note"
          type="number"
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          width={30}
          domain={[0, 11]}
          ticks={[0, 2, 4, 5, 7, 9, 11]}
          tickFormatter={(v) => NOTE_NAMES[v] ?? ""}
        />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(_: unknown, __: unknown, props: any) => [
            `${props?.payload?.noteName ?? ''} (${(props?.payload?.strength ?? 0).toFixed(2)})`,
            "Note",
          ]}
          labelFormatter={(v) => formatTime(v as number)}
        />
        <Scatter data={data} name="Chroma">
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={NOTE_COLORS[d.note]}
              fillOpacity={Math.max(0.3, Math.min(1, d.strength))}
              r={2}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
