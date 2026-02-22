"use client";
import { useMemo, useState, useCallback, useEffect } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  ReferenceLine, ReferenceArea,
} from "recharts";
import { CHART_COLORS, formatTime } from "./SharedChartProps";

const TOOLTIP_DIV_STYLE: React.CSSProperties = {
  backgroundColor: "#1f2937",
  border: "1px solid #374151",
  color: "#e5e7eb",
  fontSize: 12,
  borderRadius: 6,
  padding: "6px 10px",
};

interface PerBeat {
  id: number;
  time: number;
  energy: number;
  perceptual_energy?: number;
  madmom_score: number;
  local_bpm?: number;
}

interface Props {
  beats: PerBeat[];
  height?: number;
  songStartBeat?: number;
  songStartTime?: number;
}

const SERIES = ["energy", "perceptual_energy", "madmom", "bpm"] as const;
type SeriesKey = typeof SERIES[number];

const SERIES_COLORS: Record<SeriesKey, string> = {
  energy:            CHART_COLORS.energy ?? "#4ade80",
  perceptual_energy: "#f97316",
  madmom:            "#38bdf8",
  bpm:               "#a78bfa",
};

const SERIES_LABELS: Record<SeriesKey, string> = {
  energy:            "Energy (RMS)",
  perceptual_energy: "Perceptual (A-weight)",
  madmom:            "Madmom score",
  bpm:               "Local BPM",
};

function normalize(v: number, min: number, range: number) {
  return range === 0 ? 0 : (v - min) / range;
}
function minMax(arr: number[]): [number, number] {
  const mn = Math.min(...arr);
  const mx = Math.max(...arr);
  return [mn, mx - mn];
}

export default function PerBeatChart({ beats, height = 260, songStartBeat, songStartTime }: Props) {
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const toggle = useCallback((key: SeriesKey) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const hasPerceptual = beats.some((b) => (b.perceptual_energy ?? 0) !== 0);
  const hasBpm        = beats.some((b) => (b.local_bpm ?? 0) !== 0);

  const data = useMemo(() => {
    const energies = beats.map((b) => b.energy);
    const percs    = beats.map((b) => b.perceptual_energy ?? 0);
    const madmoms  = beats.map((b) => b.madmom_score);
    const bpms     = beats.map((b) => b.local_bpm ?? 0);

    const [eMin, eR] = minMax(energies);
    const [pMin, pR] = minMax(percs);
    const [dMin, dR] = minMax(madmoms);
    const [bMin, bR] = minMax(bpms);

    return beats.map((b, i) => ({
      id:                b.id,
      time:              b.time,
      energy:            normalize(energies[i], eMin, eR),
      perceptual_energy: normalize(percs[i], pMin, pR),
      madmom:            normalize(madmoms[i], dMin, dR),
      bpm:               normalize(bpms[i], bMin, bR),
      // raw для тултипа
      _energy:    energies[i],
      _perc:      percs[i],
      _madmom:    madmoms[i],
      _bpm:       bpms[i],
    }));
  }, [beats]);

  // Нормализованные средние и пороги (среднее × 0.7) для reference lines
  const refs = useMemo(() => {
    if (!data.length) return null;
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const eMean = avg(data.map((d) => d.energy));
    const pMean = avg(data.map((d) => d.perceptual_energy));
    return {
      energyMean:   eMean,
      energyThresh: eMean * 0.7,
      percMean:     pMean,
      percThresh:   pMean * 0.7,
    };
  }, [data]);

  // Полоски РАЗ / ПЯТЬ в верхней части графика
  const beatAreas = useMemo(() => {
    if (songStartBeat == null || !beats.length) return [];
    type Area = { x1: number; x2: number; isRaz: boolean };
    const areas: Area[] = [];
    let groupStart: number | null = null;
    let groupIsRaz = false;
    let prevTime = 0;
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const pos = ((beat.id - songStartBeat) % 8 + 8) % 8;
      if (pos === 0 || pos === 4) {
        if (groupStart !== null) areas.push({ x1: groupStart, x2: prevTime, isRaz: groupIsRaz });
        groupStart = beat.time;
        groupIsRaz = pos < 4;
      }
      prevTime = beat.time;
    }
    if (groupStart !== null) areas.push({ x1: groupStart, x2: prevTime, isRaz: groupIsRaz });
    return areas;
  }, [beats, songStartBeat]);

  const handleLegendClick = (e: any) => {
    const key = e.dataKey as SeriesKey;
    if (key) toggle(key);
  };

  const renderLegend = (props: any) => {
    const { payload } = props;
    return (
      <div className="flex flex-wrap justify-center gap-3 text-xs mt-1">
        {(payload as any[]).map((entry) => {
          const key = entry.dataKey as SeriesKey;
          if (key === "perceptual_energy" && !hasPerceptual) return null;
          if (key === "bpm" && !hasBpm) return null;
          const isHidden = hidden.has(key);
          return (
            <span
              key={key}
              onClick={() => toggle(key)}
              className="cursor-pointer select-none transition-opacity"
              style={{ opacity: isHidden ? 0.3 : 1 }}
            >
              <span
                className="inline-block w-3 h-0.5 mr-1 align-middle rounded"
                style={{ backgroundColor: entry.color }}
              />
              <span style={{ color: isHidden ? "#6b7280" : entry.color }}>
                {SERIES_LABELS[key]}
              </span>
            </span>
          );
        })}
      </div>
    );
  };

  const renderTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div style={TOOLTIP_DIV_STYLE}>
        <div className="text-gray-400 mb-1">
          Beat {d.id} · {formatTime(label)}
          {songStartBeat != null && (() => {
            const pos = ((d.id - songStartBeat) % 8 + 8) % 8;
            const isRaz = pos < 4;
            return (
              <span style={{ color: isRaz ? "#60a5fa" : "#c084fc", marginLeft: 6 }}>
                {isRaz ? `РАЗ (${pos + 1}/4)` : `ПЯТЬ (${pos - 3}/4)`}
              </span>
            );
          })()}
        </div>
        {!hidden.has("energy") && (
          <div style={{ color: SERIES_COLORS.energy }}>
            Energy: {d._energy?.toFixed(4)}
          </div>
        )}
        {!hidden.has("perceptual_energy") && hasPerceptual && (
          <div style={{ color: SERIES_COLORS.perceptual_energy }}>
            Perceptual: {d._perc?.toFixed(2)} dB
          </div>
        )}
        {!hidden.has("madmom") && (
          <div style={{ color: SERIES_COLORS.madmom }}>
            Madmom: {d._madmom?.toFixed(4)}
          </div>
        )}
        {!hidden.has("bpm") && hasBpm && (
          <div style={{ color: SERIES_COLORS.bpm }}>
            BPM: {d._bpm?.toFixed(1)}
          </div>
        )}
      </div>
    );
  };

  const renderChart = (h: number) => (
    <ResponsiveContainer width="100%" height={h}>
      <LineChart data={data} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
        <XAxis
          dataKey="time"
          tick={{ fill: "#9ca3af", fontSize: 10 }}
          tickFormatter={formatTime}
        />
        <YAxis
          domain={[0, 1]}
          tick={{ fill: "#9ca3af", fontSize: 10 }}
          tickFormatter={(v) => v.toFixed(1)}
          width={28}
        />
        <Tooltip content={renderTooltip} />
        <Legend content={renderLegend} onClick={handleLegendClick} />
        {/* Полоски РАЗ / ПЯТЬ в верхней полоске (y=0.95–1.0) */}
        {beatAreas.map((area, i) => (
          <ReferenceArea
            key={i}
            x1={area.x1} x2={area.x2}
            y1={0.95} y2={1.0}
            fill={area.isRaz ? "#3b82f6" : "#a855f7"}
            fillOpacity={0.45}
            stroke="none"
          />
        ))}
        {/* Линия старта счёта */}
        {songStartTime != null && (
          <ReferenceLine
            x={songStartTime}
            stroke="#fbbf24"
            strokeDasharray="4 2"
            strokeWidth={2}
            strokeOpacity={0.9}
            label={{ value: "▼", position: "insideTopRight", fill: "#fbbf24", fontSize: 9 }}
          />
        )}
        {/* Reference lines: среднее (пунктир) и среднее×0.7 (штрих-пунктир) */}
        {refs && !hidden.has("energy") && (
          <>
            <ReferenceLine y={refs.energyMean}   stroke={SERIES_COLORS.energy} strokeDasharray="6 3"     strokeOpacity={0.55} strokeWidth={1} />
            <ReferenceLine y={refs.energyThresh} stroke={SERIES_COLORS.energy} strokeDasharray="6 3 2 3" strokeOpacity={0.4}  strokeWidth={1} />
          </>
        )}
        {refs && hasPerceptual && !hidden.has("perceptual_energy") && (
          <>
            <ReferenceLine y={refs.percMean}   stroke={SERIES_COLORS.perceptual_energy} strokeDasharray="6 3"     strokeOpacity={0.55} strokeWidth={1} />
            <ReferenceLine y={refs.percThresh} stroke={SERIES_COLORS.perceptual_energy} strokeDasharray="6 3 2 3" strokeOpacity={0.4}  strokeWidth={1} />
          </>
        )}
        <Line type="monotone" dataKey="energy"            stroke={SERIES_COLORS.energy}            dot={false} strokeWidth={1.5} hide={hidden.has("energy")} />
        {hasPerceptual && (
          <Line type="monotone" dataKey="perceptual_energy" stroke={SERIES_COLORS.perceptual_energy} dot={false} strokeWidth={1.5} hide={hidden.has("perceptual_energy")} />
        )}
        <Line type="monotone" dataKey="madmom"            stroke={SERIES_COLORS.madmom}            dot={false} strokeWidth={1.5} hide={hidden.has("madmom")} />
        {hasBpm && (
          <Line type="monotone" dataKey="bpm" stroke={SERIES_COLORS.bpm} dot={false} strokeWidth={1} hide={hidden.has("bpm")} />
        )}
      </LineChart>
    </ResponsiveContainer>
  );

  return (
    <>
      {/* Inline (normal) */}
      <div className="relative">
        <button
          onClick={() => setFullscreen(true)}
          className="absolute top-0 right-0 z-10 text-gray-500 hover:text-gray-300 p-1 rounded hover:bg-gray-700 transition-colors"
          title="Fullscreen (Esc — закрыть)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
          </svg>
        </button>
        {renderChart(height)}
      </div>

      {/* Fullscreen overlay */}
      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700">
            <span className="text-sm text-gray-400">Побитовые параметры</span>
            <button
              onClick={() => setFullscreen(false)}
              className="ml-auto text-gray-400 hover:text-white p-1.5 rounded hover:bg-gray-700 transition-colors"
              title="Закрыть (Esc)"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 p-4 overflow-hidden">
            {renderChart(typeof window !== "undefined" ? window.innerHeight - 100 : 700)}
          </div>
        </div>
      )}
    </>
  );
}
