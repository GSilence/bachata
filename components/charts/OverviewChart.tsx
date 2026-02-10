"use client";
import { useMemo, useState, useCallback } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
} from "recharts";
import { BeatData, CHART_COLORS, formatTime, TOOLTIP_STYLE } from "./SharedChartProps";

interface Props {
  beats: BeatData[];
  height?: number;
}

interface NormalizedBeat {
  time: number;
  energy: number;
  harmonic: number;
  onset: number;
  centroid: number;
  bpm: number;
  // originals for tooltip
  _energy: number;
  _harmonic: number;
  _onset: number;
  _centroid: number;
  _bpm: number;
  _id: number;
}

const SERIES = ["energy", "harmonic", "onset", "centroid", "bpm"] as const;
type SeriesKey = typeof SERIES[number];

function minMax(values: number[]): [number, number] {
  let min = Infinity, max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

function normalize(val: number, min: number, range: number): number {
  return range > 0 ? (val - min) / range : 0;
}

export default function OverviewChart({ beats, height = 220 }: Props) {
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());

  const toggleSeries = useCallback((key: SeriesKey) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const data = useMemo(() => {
    const energies = beats.map((b) => b.energy);
    const harmonics = beats.map((b) => b.harmonic);
    const onsets = beats.map((b) => b.onset_strength ?? 0);
    const centroids = beats.map((b) => b.spectral_centroid ?? 0);
    const bpms = beats.map((b) => b.local_bpm ?? 0);

    const [eMin, eMax] = minMax(energies);
    const [hMin, hMax] = minMax(harmonics);
    const [oMin, oMax] = minMax(onsets);
    const [cMin, cMax] = minMax(centroids);
    const [bMin, bMax] = minMax(bpms);

    const eR = eMax - eMin;
    const hR = hMax - hMin;
    const oR = oMax - oMin;
    const cR = cMax - cMin;
    const bR = bMax - bMin;

    return beats.map((b, i): NormalizedBeat => ({
      time: b.time,
      energy: normalize(energies[i], eMin, eR),
      harmonic: normalize(harmonics[i], hMin, hR),
      onset: normalize(onsets[i], oMin, oR),
      centroid: normalize(centroids[i], cMin, cR),
      bpm: normalize(bpms[i], bMin, bR),
      _energy: energies[i],
      _harmonic: harmonics[i],
      _onset: onsets[i],
      _centroid: centroids[i],
      _bpm: bpms[i],
      _id: b.id,
    }));
  }, [beats]);

  const handleLegendClick = (e: any) => {
    const key = e.dataKey as SeriesKey;
    if (key) toggleSeries(key);
  };

  const renderLegend = (props: any) => {
    const { payload } = props;
    return (
      <div className="flex flex-wrap justify-center gap-3 text-xs mt-1">
        {payload.map((entry: any) => {
          const key = entry.dataKey as SeriesKey;
          const isHidden = hidden.has(key);
          return (
            <span
              key={key}
              onClick={() => toggleSeries(key)}
              className="cursor-pointer select-none transition-opacity"
              style={{ opacity: isHidden ? 0.3 : 1 }}
            >
              <span
                className="inline-block w-3 h-0.5 mr-1 align-middle rounded"
                style={{ backgroundColor: entry.color }}
              />
              <span style={{ color: isHidden ? '#6b7280' : entry.color }}>
                {entry.value}
              </span>
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <XAxis
          dataKey="time"
          tick={{ fill: CHART_COLORS.text, fontSize: 10 }}
          tickFormatter={formatTime}
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
            return `Beat ${pt?._id ?? '?'} · ${formatTime(v as number)}`;
          }}
          formatter={(value: any, name: string, props: any) => {
            const p = props.payload as NormalizedBeat;
            const key = props.dataKey as SeriesKey;
            if (hidden.has(key)) return [null, null];
            switch (name) {
              case "Energy": return [`${p._energy.toFixed(4)}`, "Energy"];
              case "Harmonic": return [`${p._harmonic.toFixed(4)}`, "Harmonic"];
              case "Onset": return [`${p._onset.toFixed(4)}`, "Onset"];
              case "Centroid": return [`${Math.round(p._centroid)} Hz`, "Centroid"];
              case "BPM": return [`${p._bpm.toFixed(1)}`, "BPM"];
              default: return [value, name];
            }
          }}
        />
        <Legend content={renderLegend} onClick={handleLegendClick} />
        <Line type="monotone" dataKey="energy" stroke={CHART_COLORS.energy} dot={false} strokeWidth={1.5} name="Energy" hide={hidden.has("energy")} />
        <Line type="monotone" dataKey="harmonic" stroke={CHART_COLORS.harmonic} dot={false} strokeWidth={1.5} name="Harmonic" hide={hidden.has("harmonic")} />
        <Line type="monotone" dataKey="onset" stroke={CHART_COLORS.onset} dot={false} strokeWidth={1.5} name="Onset" hide={hidden.has("onset")} />
        <Line type="monotone" dataKey="centroid" stroke={CHART_COLORS.centroid} dot={false} strokeWidth={1.5} name="Centroid" hide={hidden.has("centroid")} />
        <Line type="monotone" dataKey="bpm" stroke={CHART_COLORS.bpm} dot={false} strokeWidth={1.5} name="BPM" hide={hidden.has("bpm")} />
      </LineChart>
    </ResponsiveContainer>
  );
}
