"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { ReportData } from "./charts/SharedChartProps";

const EnergyHarmonicChart = dynamic(() => import("./charts/EnergyHarmonicChart"), { ssr: false });
const OnsetStrengthChart = dynamic(() => import("./charts/OnsetStrengthChart"), { ssr: false });
const SpectralCentroidChart = dynamic(() => import("./charts/SpectralCentroidChart"), { ssr: false });
const ChromaChart = dynamic(() => import("./charts/ChromaChart"), { ssr: false });
const IntensityChart = dynamic(() => import("./charts/IntensityChart"), { ssr: false });
const TempoChart = dynamic(() => import("./charts/TempoChart"), { ssr: false });
const SectionsChart = dynamic(() => import("./charts/SectionsChart"), { ssr: false });

type ChartTab = "energy" | "intensity" | "tempo" | "onset" | "centroid" | "chroma" | "sections" | "spectrogram";

const TABS: { key: ChartTab; label: string }[] = [
  { key: "energy", label: "Energy" },
  { key: "intensity", label: "Intensity" },
  { key: "tempo", label: "Tempo" },
  { key: "onset", label: "Onset" },
  { key: "centroid", label: "Brightness" },
  { key: "chroma", label: "Chroma" },
  { key: "sections", label: "4-Counts" },
  { key: "spectrogram", label: "Spectrogram" },
];

interface ExtendedReport extends ReportData {
  four_counts?: any[];
  spectrogram?: string | null;
  climaxes?: any[];
  tempo_changes?: any[];
  click_track?: string | null;
  markers_file?: string | null;
  bpm?: number;
  duration?: number;
}

interface Props {
  reportPath: string;
}

export default function DashboardChart({ reportPath }: Props) {
  const [report, setReport] = useState<ExtendedReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ChartTab>("energy");
  const [isOpen, setIsOpen] = useState(false);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);

  // Reset when track changes
  useEffect(() => {
    if (reportPath !== loadedPath) {
      setReport(null);
      setLoadedPath(null);
    }
  }, [reportPath, loadedPath]);

  useEffect(() => {
    if (!isOpen || loadedPath === reportPath) return;
    setLoading(true);
    fetch(`${reportPath}?t=${Date.now()}`)
      .then((r) => r.json())
      .then((data) => {
        setReport(data);
        setLoadedPath(reportPath);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [isOpen, reportPath, loadedPath]);

  const hasLibrosa = report?.beats?.[0]?.spectral_centroid !== undefined;
  const summary = report?.librosa_summary;

  return (
    <details
      className="group mt-3"
      onToggle={(e) => setIsOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="text-sm font-medium text-gray-400 cursor-pointer hover:text-gray-300 select-none">
        Dashboard Charts
        {hasLibrosa && (
          <span className="text-purple-400 ml-1 text-xs">(Librosa)</span>
        )}
      </summary>

      <div className="mt-3">
        {loading && (
          <p className="text-gray-500 text-sm animate-pulse">
            Загрузка данных...
          </p>
        )}

        {report && !hasLibrosa && (
          <p className="text-yellow-500 text-xs">
            Переанализируйте трек, чтобы получить спектральные данные
          </p>
        )}

        {report && hasLibrosa && (
          <>
            {/* Librosa summary badges */}
            {summary && (
              <div className="flex flex-wrap gap-2 mb-3 text-xs">
                <span className="px-2 py-0.5 bg-gray-700 rounded text-gray-300">
                  Librosa BPM: {summary.librosa_tempo}
                </span>
                <span className="px-2 py-0.5 bg-gray-700 rounded text-gray-300">
                  Key: {summary.dominant_key}
                </span>
                <span className="px-2 py-0.5 bg-gray-700 rounded text-gray-300">
                  Centroid: {summary.spectral_centroid_mean.toFixed(0)} Hz
                </span>
                {summary.bpm_min !== undefined && (
                  <span className="px-2 py-0.5 bg-gray-700 rounded text-gray-300">
                    BPM range: {summary.bpm_min}–{summary.bpm_max}
                  </span>
                )}
              </div>
            )}

            {/* Tab buttons */}
            <div className="flex flex-wrap gap-1 mb-2">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    activeTab === tab.key
                      ? "bg-purple-600 text-white"
                      : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Active chart */}
            <div className="bg-gray-900/50 rounded p-2">
              {activeTab === "energy" && (
                <EnergyHarmonicChart beats={report.beats} />
              )}
              {activeTab === "intensity" && (
                <IntensityChart
                  beats={report.beats}
                  climaxes={report.climaxes}
                />
              )}
              {activeTab === "tempo" && (
                <TempoChart
                  beats={report.beats}
                  avgBpm={report.bpm ?? 0}
                  tempoChanges={report.tempo_changes}
                />
              )}
              {activeTab === "onset" && (
                <OnsetStrengthChart beats={report.beats} />
              )}
              {activeTab === "centroid" && (
                <SpectralCentroidChart beats={report.beats} />
              )}
              {activeTab === "chroma" && (
                <ChromaChart beats={report.beats} />
              )}
              {activeTab === "sections" && (
                <SectionsChart
                  fourCounts={report.four_counts}
                  duration={report.duration ?? 0}
                />
              )}
              {activeTab === "spectrogram" && report.spectrogram && (
                <div className="flex justify-center">
                  <img
                    src={`${report.spectrogram}?t=${Date.now()}`}
                    alt="Mel Spectrogram"
                    className="rounded max-w-full"
                    style={{ maxHeight: 300 }}
                  />
                </div>
              )}
              {activeTab === "spectrogram" && !report.spectrogram && (
                <p className="text-gray-500 text-sm text-center py-4">
                  Спектрограмма недоступна. Переанализируйте трек.
                </p>
              )}
            </div>

            {/* Download buttons */}
            <div className="flex flex-wrap gap-3 mt-3 text-xs">
              {report.click_track && (
                <a
                  href={report.click_track}
                  download
                  className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300 hover:underline"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Click track (WAV)
                </a>
              )}
              {report.markers_file && (
                <a
                  href={report.markers_file}
                  download
                  className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 hover:underline"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Markers (TXT)
                </a>
              )}
              {report.climaxes && report.climaxes.length > 0 && (
                <span className="text-gray-500">
                  Climaxes: {report.climaxes.map((c: any) =>
                    `${Math.floor(c.time / 60)}:${Math.floor(c.time % 60).toString().padStart(2, '0')}`
                  ).join(', ')}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </details>
  );
}
