"use client";
import { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, XAxis, YAxis, Tooltip,
  ReferenceArea, Legend,
} from "recharts";
import { CHART_COLORS, formatTime, TOOLTIP_STYLE } from "./SharedChartProps";

interface StemEnergy {
  time: number;
  beat_index: number;
  bass: number;
  vocals: number;
  other: number;
}

interface Bridge {
  start_time: number;
  end_time: number;
  duration: number;
  beat_start: number;
  beat_end: number;
  stems_triggered: string[];
  confidence: number;
}

interface Props {
  stemsEnergy: StemEnergy[];
  bridges: Bridge[];
  height?: number;
}

const STEM_COLORS = {
  bass: '#f59e0b',    // amber
  vocals: '#a78bfa',  // purple
  other: '#34d399',   // green
};

export default function BridgeAnalysisChart({ stemsEnergy, bridges, height = 280 }: Props) {
  const data = useMemo(() => stemsEnergy, [stemsEnergy]);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <XAxis
          dataKey="time"
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          tickFormatter={formatTime}
          type="number"
          domain={["dataMin", "dataMax"]}
        />
        <YAxis
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          width={30}
          domain={[0, 1]}
          tickFormatter={(v) => v.toFixed(1)}
        />
        <Tooltip
          {...TOOLTIP_STYLE}
          labelFormatter={(v) => {
            const pt = data.find((d) => d.time === v);
            return `Beat ${pt?.beat_index ?? '?'} · ${formatTime(v as number)}`;
          }}
          formatter={(value: any, name: string) => {
            const v = Number(value);
            return [`${(v * 100).toFixed(1)}%`, name.charAt(0).toUpperCase() + name.slice(1)];
          }}
        />
        <Legend wrapperStyle={{ color: CHART_COLORS.text, fontSize: 11 }} />

        {/* Bridge regions highlighted in red */}
        {bridges.map((b, i) => (
          <ReferenceArea
            key={i}
            x1={b.start_time}
            x2={b.end_time}
            fill="#ef4444"
            fillOpacity={0.15}
            stroke="#ef4444"
            strokeOpacity={0.4}
            label={{
              value: `Bridge ${i + 1}`,
              position: "insideTop",
              fill: "#ef4444",
              fontSize: 10,
              fontWeight: "bold",
            }}
          />
        ))}

        <Area
          type="stepAfter"
          dataKey="bass"
          stroke={STEM_COLORS.bass}
          fill={STEM_COLORS.bass}
          fillOpacity={0.2}
          strokeWidth={1.5}
          dot={false}
          name="Bass"
          isAnimationActive={false}
        />
        <Area
          type="stepAfter"
          dataKey="vocals"
          stroke={STEM_COLORS.vocals}
          fill={STEM_COLORS.vocals}
          fillOpacity={0.15}
          strokeWidth={1.5}
          dot={false}
          name="Vocals"
          isAnimationActive={false}
        />
        <Area
          type="stepAfter"
          dataKey="other"
          stroke={STEM_COLORS.other}
          fill={STEM_COLORS.other}
          fillOpacity={0.1}
          strokeWidth={1.5}
          dot={false}
          name="Other"
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
