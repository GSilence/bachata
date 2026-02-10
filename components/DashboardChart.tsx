"use client";
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import type { ReportData, WaveformPoint } from "./charts/SharedChartProps";

const EnergyHarmonicChart = dynamic(() => import("./charts/EnergyHarmonicChart"), { ssr: false });
const OnsetStrengthChart = dynamic(() => import("./charts/OnsetStrengthChart"), { ssr: false });
const SpectralCentroidChart = dynamic(() => import("./charts/SpectralCentroidChart"), { ssr: false });
const TempoChart = dynamic(() => import("./charts/TempoChart"), { ssr: false });
const WaveformChart = dynamic(() => import("./charts/WaveformChart"), { ssr: false });
const OverviewChart = dynamic(() => import("./charts/OverviewChart"), { ssr: false });

type ChartTab = "overview" | "energy" | "tempo" | "onset" | "centroid" | "waveform";

const TABS: { key: ChartTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "energy", label: "Energy" },
  { key: "tempo", label: "Tempo" },
  { key: "onset", label: "Onset" },
  { key: "centroid", label: "Centroid" },
  { key: "waveform", label: "Waveform" },
];

interface ExtendedReport extends ReportData {
  spectrogram?: string | null;
  tempo_changes?: any[];
  waveform_data?: WaveformPoint[];
  bpm?: number;
  duration?: number;
}

interface Props {
  reportPath: string;
}

export default function DashboardChart({ reportPath }: Props) {
  const [report, setReport] = useState<ExtendedReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ChartTab>("overview");
  const [isOpen, setIsOpen] = useState(false);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

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

  // Escape to close fullscreen
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setFullscreen(false);
  }, []);

  useEffect(() => {
    if (fullscreen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [fullscreen, handleKeyDown]);

  const hasLibrosa = report?.beats?.[0]?.spectral_centroid !== undefined;
  const summary = report?.librosa_summary;

  const renderChart = (chartHeight?: number) => (
    <>
      {activeTab === "overview" && (
        <OverviewChart beats={report!.beats} height={chartHeight} />
      )}
      {activeTab === "energy" && (
        <EnergyHarmonicChart beats={report!.beats} />
      )}
      {activeTab === "tempo" && (
        <TempoChart
          beats={report!.beats}
          avgBpm={report!.bpm ?? 0}
          tempoChanges={report!.tempo_changes}
        />
      )}
      {activeTab === "onset" && (
        <OnsetStrengthChart beats={report!.beats} />
      )}
      {activeTab === "centroid" && (
        <SpectralCentroidChart beats={report!.beats} avgCentroid={summary?.spectral_centroid_mean} />
      )}
      {activeTab === "waveform" && report!.waveform_data && report!.waveform_data.length > 0 && (
        <WaveformChart
          waveformData={report!.waveform_data}
          beats={report!.beats}
        />
      )}
      {activeTab === "waveform" && (!report!.waveform_data || report!.waveform_data.length === 0) && report!.spectrogram && (
        <div className="flex justify-center">
          <img
            src={`${report!.spectrogram}?t=${Date.now()}`}
            alt="Waveform Overview"
            className="rounded max-w-full"
          />
        </div>
      )}
      {activeTab === "waveform" && !report!.spectrogram && (!report!.waveform_data || report!.waveform_data.length === 0) && (
        <p className="text-gray-500 text-sm text-center py-4">
          Waveform недоступен. Переанализируйте трек.
        </p>
      )}
    </>
  );

  return (
    <>
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
                    Centroid: {summary.spectral_centroid_mean.toFixed(0)} Hz
                  </span>
                  {summary.bpm_min !== undefined && (
                    <span className="px-2 py-0.5 bg-gray-700 rounded text-gray-300">
                      BPM range: {summary.bpm_min}–{summary.bpm_max}
                    </span>
                  )}
                </div>
              )}

              {/* Tab buttons + expand */}
              <div className="flex items-center gap-1 mb-2">
                <div className="flex flex-wrap gap-1">
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
                <button
                  onClick={() => setFullscreen(true)}
                  className="ml-auto text-gray-500 hover:text-gray-300 p-1 rounded hover:bg-gray-700 transition-colors"
                  title="Fullscreen"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                  </svg>
                </button>
              </div>

              {/* Active chart (inline) */}
              <div className="bg-gray-900/50 rounded p-2">
                {renderChart()}
              </div>
            </>
          )}
        </div>
      </details>

      {/* Fullscreen overlay */}
      {fullscreen && report && hasLibrosa && (
        <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-2 p-3 border-b border-gray-700">
            <div className="flex flex-wrap gap-1">
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
            <button
              onClick={() => setFullscreen(false)}
              className="ml-auto text-gray-400 hover:text-white p-1.5 rounded hover:bg-gray-700 transition-colors"
              title="Close (Esc)"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Chart area */}
          <div className="flex-1 p-4 overflow-hidden">
            {renderChart(typeof window !== "undefined" ? window.innerHeight - 100 : 600)}
          </div>
        </div>
      )}
    </>
  );
}
