"use client";

import { useState, useEffect } from "react";
import SettingsPanel from "@/components/SettingsPanel";

interface TrackStats {
  total: number;
  processed: number;
  avgBpm: number;
  minBpm: number;
  maxBpm: number;
}

export default function SettingsPage() {
  const [isExporting, setIsExporting] = useState(false);
  const [stats, setStats] = useState<TrackStats | null>(null);
  const [tracks, setTracks] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  // Загружаем статистику при монтировании
  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await fetch("/api/tracks");
      if (response.ok) {
        const data = await response.json();
        setTracks(data);
        
        if (data.length > 0) {
          const bpms = data.map((t: any) => t.bpm).filter((b: number) => b > 0);
          setStats({
            total: data.length,
            processed: data.filter((t: any) => t.isProcessed).length,
            avgBpm: Math.round(bpms.reduce((a: number, b: number) => a + b, 0) / bpms.length),
            minBpm: Math.min(...bpms),
            maxBpm: Math.max(...bpms),
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    }
  };

  const handleExport = async (format: "csv" | "json") => {
    setIsExporting(true);
    try {
      const response = await fetch(`/api/tracks/export?format=${format}`);
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tracks_export_${new Date().toISOString().split("T")[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export error:", error);
      alert("Ошибка при экспорте данных");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-8">Настройки</h1>

      {/* Статистика */}
      {stats && (
        <div className="bg-gray-800/50 rounded-xl p-6 mb-8 border border-gray-700">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Статистика библиотеки
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-white">{stats.total}</div>
              <div className="text-sm text-gray-400">Всего треков</div>
            </div>
            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-green-400">{stats.processed}</div>
              <div className="text-sm text-gray-400">Обработано</div>
            </div>
            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-purple-400">{stats.avgBpm}</div>
              <div className="text-sm text-gray-400">Средний BPM</div>
            </div>
            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-blue-400">{stats.minBpm} - {stats.maxBpm}</div>
              <div className="text-sm text-gray-400">Диапазон BPM</div>
            </div>
          </div>
        </div>
      )}

      {/* Экспорт данных */}
      <div className="bg-gray-800/50 rounded-xl p-6 mb-8 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Экспорт данных
        </h2>
        <p className="text-gray-400 text-sm mb-4">
          Выгрузите список всех треков с их BPM и Offset в удобном формате.
        </p>
        
        <div className="flex flex-wrap gap-3 mb-4">
          <button
            onClick={() => handleExport("csv")}
            disabled={isExporting || !stats?.total}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {isExporting ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
            Скачать CSV
          </button>
          
          <button
            onClick={() => handleExport("json")}
            disabled={isExporting || !stats?.total}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Скачать JSON
          </button>
          
          <button
            onClick={() => setShowPreview(!showPreview)}
            disabled={!stats?.total}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            {showPreview ? "Скрыть" : "Просмотр"}
          </button>
        </div>

        {!stats?.total && (
          <p className="text-yellow-500 text-sm">
            В базе данных нет треков для экспорта.
          </p>
        )}
      </div>

      {/* Превью данных */}
      {showPreview && tracks.length > 0 && (
        <div className="bg-gray-800/50 rounded-xl p-6 mb-8 border border-gray-700 overflow-hidden">
          <h2 className="text-lg font-semibold text-white mb-4">Данные треков</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-2 pr-4">Название</th>
                  <th className="pb-2 pr-4">Исполнитель</th>
                  <th className="pb-2 pr-4 text-right">BPM</th>
                  <th className="pb-2 pr-4 text-right">Offset</th>
                  <th className="pb-2 text-center">Обработан</th>
                </tr>
              </thead>
              <tbody>
                {tracks.slice(0, 20).map((track) => (
                  <tr key={track.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-2 pr-4 text-white">{track.title}</td>
                    <td className="py-2 pr-4 text-gray-400">{track.artist || "—"}</td>
                    <td className="py-2 pr-4 text-right text-purple-400">{track.bpm}</td>
                    <td className="py-2 pr-4 text-right text-blue-400">{track.offset.toFixed(2)}s</td>
                    <td className="py-2 text-center">
                      {track.isProcessed ? (
                        <span className="text-green-400">✓</span>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tracks.length > 20 && (
              <p className="text-gray-500 text-sm mt-4 text-center">
                Показано 20 из {tracks.length} треков. Скачайте файл для полного списка.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Настройки воспроизведения */}
      <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Настройки воспроизведения
        </h2>
        <SettingsPanel />
      </div>
    </div>
  );
}
