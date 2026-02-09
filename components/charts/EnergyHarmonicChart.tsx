"use client";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
} from "recharts";
import { BeatData, CHART_COLORS, formatTime, TOOLTIP_STYLE } from "./SharedChartProps";

interface Props {
  beats: BeatData[];
}

export default function EnergyHarmonicChart({ beats }: Props) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={beats} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <XAxis
          dataKey="time"
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          tickFormatter={formatTime}
        />
        <YAxis tick={{ fill: CHART_COLORS.text, fontSize: 10 }} width={45} />
        <Tooltip
          {...TOOLTIP_STYLE}
          labelFormatter={(v) => `Beat ${beats.find(b => b.time === v)?.id ?? '?'} · ${formatTime(v as number)}`}
        />
        <Legend wrapperStyle={{ color: CHART_COLORS.text, fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="energy"
          stroke={CHART_COLORS.energy}
          dot={false}
          strokeWidth={1.5}
          name="Energy"
        />
        <Line
          type="monotone"
          dataKey="harmonic"
          stroke={CHART_COLORS.harmonic}
          dot={false}
          strokeWidth={1.5}
          name="Harmonic"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
