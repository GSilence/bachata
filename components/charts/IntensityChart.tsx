"use client";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine,
} from "recharts";
import { BeatData, CHART_COLORS, formatTime, TOOLTIP_STYLE } from "./SharedChartProps";

interface Climax {
  beat_id: number;
  time: number;
  rank: number;
  intensity: number;
}

interface Props {
  beats: BeatData[];
  climaxes?: Climax[];
}

export default function IntensityChart({ beats, climaxes }: Props) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={beats} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <XAxis
          dataKey="time"
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          tickFormatter={formatTime}
        />
        <YAxis tick={{ fill: CHART_COLORS.text, fontSize: 10 }} width={45} domain={[0, 1]} />
        <Tooltip
          {...TOOLTIP_STYLE}
          labelFormatter={(v) => formatTime(v as number)}
          formatter={(value: any) => [Number(value ?? 0).toFixed(3), "Intensity"]}
        />
        {climaxes?.map((c) => (
          <ReferenceLine
            key={c.rank}
            x={c.time}
            stroke="#ef4444"
            strokeWidth={2}
            strokeDasharray="4 2"
            label={{ value: `#${c.rank}`, position: "top", fill: "#ef4444", fontSize: 10 }}
          />
        ))}
        <Area
          type="monotone"
          dataKey="intensity"
          stroke="#f472b6"
          fill="#f472b6"
          fillOpacity={0.15}
          strokeWidth={1.5}
          dot={false}
          name="Intensity"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
