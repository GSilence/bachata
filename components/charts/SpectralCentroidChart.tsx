"use client";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
} from "recharts";
import { BeatData, CHART_COLORS, formatTime, TOOLTIP_STYLE } from "./SharedChartProps";

interface Props {
  beats: BeatData[];
}

export default function SpectralCentroidChart({ beats }: Props) {
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
          width={55}
          tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
        />
        <Tooltip
          {...TOOLTIP_STYLE}
          labelFormatter={(v) => formatTime(v as number)}
          formatter={(value: any) => [`${Math.round(Number(value ?? 0))} Hz`, "Centroid"]}
        />
        <Line
          type="monotone"
          dataKey="spectral_centroid"
          stroke={CHART_COLORS.centroid}
          dot={false}
          strokeWidth={1.5}
          name="Spectral Centroid (Hz)"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
