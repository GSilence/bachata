"use client";
import { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, XAxis, YAxis, Tooltip,
  ReferenceLine,
} from "recharts";
import {
  BeatData, WaveformPoint, CHART_COLORS, formatTime, TOOLTIP_STYLE,
} from "./SharedChartProps";

interface Props {
  waveformData: WaveformPoint[];
  beats: BeatData[];
}

interface WaveformRow {
  time: number;
  peak: number;
  peakNeg: number;
  rms: number;
  rmsNeg: number;
}

export default function WaveformChart({ waveformData, beats }: Props) {
  // Pre-compute mirrored data
  const data: WaveformRow[] = useMemo(
    () =>
      waveformData.map((p) => ({
        time: p.time,
        peak: p.peak,
        peakNeg: -p.peak,
        rms: p.rms,
        rmsNeg: -p.rms,
      })),
    [waveformData],
  );

  // Downbeat times (every 8th beat) for vertical reference lines
  const downbeats = useMemo(
    () => beats.filter((_, i) => i % 8 === 0).map((b) => b.time),
    [beats],
  );

  // Find nearest beat for tooltip
  const findBeat = (time: number) => {
    let closest = beats[0];
    let minDiff = Math.abs(beats[0].time - time);
    for (let i = 1; i < beats.length; i++) {
      const diff = Math.abs(beats[i].time - time);
      if (diff < minDiff) {
        minDiff = diff;
        closest = beats[i];
      } else {
        break; // beats are sorted by time
      }
    }
    return closest;
  };

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <XAxis
          dataKey="time"
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          tickFormatter={formatTime}
          type="number"
          domain={["dataMin", "dataMax"]}
        />
        <YAxis
          tick={false}
          axisLine={false}
          width={10}
          domain={[-1, 1]}
        />
        <Tooltip
          {...TOOLTIP_STYLE}
          labelFormatter={(v) => {
            const t = Number(v);
            const beat = findBeat(t);
            return `Beat ${beat.id} (row ${beat.row}) · ${formatTime(t)}`;
          }}
          formatter={(value: any, name: string) => {
            const abs = Math.abs(Number(value));
            if (name === "Peak" || name === "peakNeg") return [`${abs.toFixed(3)}`, "Peak"];
            if (name === "RMS" || name === "rmsNeg") return [`${abs.toFixed(3)}`, "RMS"];
            return [null, null];
          }}
          // Hide duplicate negative entries
          itemSorter={() => 0}
        />

        {/* Downbeat reference lines */}
        {downbeats.map((t) => (
          <ReferenceLine
            key={t}
            x={t}
            stroke="#f59e0b"
            strokeWidth={0.5}
            strokeOpacity={0.25}
          />
        ))}

        {/* Peak envelope (positive + negative) */}
        <Area
          type="monotone"
          dataKey="peak"
          stroke="none"
          fill={CHART_COLORS.waveformPeak}
          fillOpacity={0.35}
          dot={false}
          activeDot={false}
          name="Peak"
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="peakNeg"
          stroke="none"
          fill={CHART_COLORS.waveformPeak}
          fillOpacity={0.35}
          dot={false}
          activeDot={false}
          name="peakNeg"
          legendType="none"
          isAnimationActive={false}
        />

        {/* RMS envelope (positive + negative) */}
        <Area
          type="monotone"
          dataKey="rms"
          stroke="none"
          fill={CHART_COLORS.waveformRms}
          fillOpacity={0.7}
          dot={false}
          activeDot={false}
          name="RMS"
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="rmsNeg"
          stroke="none"
          fill={CHART_COLORS.waveformRms}
          fillOpacity={0.7}
          dot={false}
          activeDot={false}
          name="rmsNeg"
          legendType="none"
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
