"use client";
import { useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine,
} from "recharts";
import { BeatData, CHART_COLORS, formatTime, TOOLTIP_STYLE } from "./SharedChartProps";

interface Props {
  beats: BeatData[];
  avgCentroid?: number;
}

export default function SpectralCentroidChart({ beats, avgCentroid }: Props) {
  const avg = useMemo(() => {
    if (avgCentroid != null) return avgCentroid;
    const vals = beats.map((b) => b.spectral_centroid).filter((v): v is number => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  }, [beats, avgCentroid]);

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
        {avg > 0 && (
          <ReferenceLine
            y={avg}
            stroke="#6366f1"
            strokeDasharray="6 3"
            label={{ value: `avg ${avg} Hz`, position: "right", fill: "#6366f1", fontSize: 10 }}
          />
        )}
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
