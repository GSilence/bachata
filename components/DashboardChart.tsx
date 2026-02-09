"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { ReportData } from "./charts/SharedChartProps";

const EnergyHarmonicChart = dynamic(() => import("./charts/EnergyHarmonicChart"), { ssr: false });
const OnsetStrengthChart = dynamic(() => import("./charts/OnsetStrengthChart"), { ssr: false });
const SpectralCentroidChart = dynamic(() => import("./charts/SpectralCentroidChart"), { ssr: false });
const ChromaChart = dynamic(() => import("./charts/ChromaChart"), { ssr: false });

type ChartTab = "energy" | "onset" | "centroid" | "chroma";

const TABS: { key: ChartTab; label: string }[] = [
  { key: "energy", label: "Energy" },
  { key: "onset", label: "Onset" },
  { key: "centroid", label: "Brightness" },
  { key: "chroma", label: "Chroma" },
];

interface Props {
  reportPath: string;
}

export default function DashboardChart({ reportPath }: Props) {
  const [report, setReport] = useState<ReportData | null>(null);
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
                <span className="px-2 py-0.5 bg-gray-700 rounded text-gray-300">
                  Flatness: {summary.spectral_flatness_mean.toFixed(4)}
                </span>
                <span className="px-2 py-0.5 bg-gray-700 rounded text-gray-300">
                  ZCR: {summary.zcr_mean.toFixed(4)}
                </span>
              </div>
            )}

            {/* Tab buttons */}
            <div className="flex gap-1 mb-2">
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
              {activeTab === "onset" && (
                <OnsetStrengthChart beats={report.beats} />
              )}
              {activeTab === "centroid" && (
                <SpectralCentroidChart beats={report.beats} />
              )}
              {activeTab === "chroma" && (
                <ChromaChart beats={report.beats} />
              )}
            </div>
          </>
        )}
      </div>
    </details>
  );
}
