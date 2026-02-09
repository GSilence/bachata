"use client";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
} from "recharts";
import { BeatData, CHART_COLORS, formatTime, TOOLTIP_STYLE } from "./SharedChartProps";

interface Props {
  beats: BeatData[];
}

export default function OnsetStrengthChart({ beats }: Props) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={beats} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <XAxis
          dataKey="time"
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          tickFormatter={formatTime}
        />
        <YAxis tick={{ fill: CHART_COLORS.text, fontSize: 10 }} width={45} />
        <Tooltip
          {...TOOLTIP_STYLE}
          labelFormatter={(v) => formatTime(v as number)}
        />
        <Area
          type="monotone"
          dataKey="onset_strength"
          stroke={CHART_COLORS.onset}
          fill={CHART_COLORS.onset}
          fillOpacity={0.2}
          strokeWidth={1.5}
          dot={false}
          name="Onset Strength"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
