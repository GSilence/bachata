"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import SettingsPanel from "@/components/SettingsPanel";
import { useAuthStore } from "@/store/authStore";
import { isAdmin } from "@/lib/roles";

interface TrackStats {
  total: number;
  newCount: number;
  moderationCount: number;
  approvedCount: number;
  withBridges: number;
  withAccents: number;
  withMambo: number;
  minBpm: number;
  maxBpm: number;
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, isLoading, checkAuth } = useAuthStore();
  const [isExporting, setIsExporting] = useState(false);
  const [stats, setStats] = useState<TrackStats | null>(null);
  const [tracks, setTracks] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationStopped, setMigrationStopped] = useState(false);
  const migrationStopRef = useRef(false);
  const [migrationStats, setMigrationStats] = useState<{ total: number; localCount: number; s3Count: number } | null>(null);
  const [migrationProgress, setMigrationProgress] = useState<{ migrated: number; skipped: number; lastTitle: string } | null>(null);
  const [migrationDone, setMigrationDone] = useState(false);

  // Auth check
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isLoading && (!user || !isAdmin(user?.role))) {
      router.push("/login?redirect=/settings");
    }
  }, [user, isLoading, router]);

  // Загружаем статистику при монтировании (только для админа)
  useEffect(() => {
    if (isAdmin(user?.role)) fetchStats();
  }, [user]);

  const fetchStats = async () => {
    try {
      const response = await fetch("/api/tracks", { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        setTracks(data);

        if (data.length > 0) {
          const bpms = data.map((t: any) => t.bpm).filter((b: number) => b > 0);
          setStats({
            total: data.length,
            newCount: data.filter((t: any) => t.trackStatus === "unlistened").length,
            moderationCount: data.filter((t: any) => t.trackStatus === "moderation").length,
            approvedCount: data.filter((t: any) => t.trackStatus === "approved").length,
            withBridges: data.filter(
              (t: any) => (t.gridMap?.bridges?.length ?? 0) > 0,
            ).length,
            withAccents: data.filter((t: any) => t.hasAccents).length,
            withMambo: data.filter((t: any) => t.hasMambo).length,
            minBpm: bpms.length ? Math.min(...bpms) : 0,
            maxBpm: bpms.length ? Math.max(...bpms) : 0,
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    }
  };

  const fetchMigrationStats = async () => {
    try {
      const r = await fetch("/api/admin/migrate-to-s3");
      if (r.ok) setMigrationStats(await r.json());
    } catch {}
  };

  useEffect(() => {
    if (isAdmin(user?.role)) fetchMigrationStats();
  }, [user]);

  const handleMigrate = async () => {
    migrationStopRef.current = false;
    setIsMigrating(true);
    setMigrationStopped(false);
    setMigrationDone(false);
    setMigrationProgress({ migrated: 0, skipped: 0, lastTitle: "" });

    let migrated = 0;
    let skipped = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (migrationStopRef.current) break;
      try {
        const r = await fetch("/api/admin/migrate-to-s3", { method: "POST" });
        if (!r.ok) { alert("Ошибка миграции: " + (await r.text())); break; }
        const data = await r.json();
        if (data.skipped) skipped++; else migrated++;
        setMigrationProgress({ migrated, skipped, lastTitle: data.title || "" });
        if (data.done) { setMigrationDone(true); break; }
      } catch (e: any) {
        alert("Сетевая ошибка: " + e.message);
        break;
      }
    }

    setIsMigrating(false);
    fetchMigrationStats();
  };

  const handleExport = async (format: "csv" | "json" | "manifest") => {
    setIsExporting(true);
    try {
      const response = await fetch(`/api/tracks/export?format=${format}`);
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = format === "manifest" ? "csv" : format;
      const name = format === "manifest" ? "tracks_manifest" : "tracks_export";
      a.download = `${name}_${new Date().toISOString().split("T")[0]}.${ext}`;
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Загрузка...</div>
      </div>
    );
  }

  if (!user || !isAdmin(user.role)) {
    return null;
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-8">Настройки</h1>

      {/* Статистика */}
      {stats && (
        <div className="bg-gray-800/50 rounded-xl p-6 mb-8 border border-gray-700">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg
              className="w-5 h-5 text-purple-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            Статистика библиотеки
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-white">{stats.total}</div>
              <div className="text-sm text-gray-400">Всего треков</div>
            </div>
            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-gray-300">{stats.newCount}</div>
              <div className="text-sm text-gray-400">Новые</div>
            </div>
            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-yellow-400">{stats.moderationCount}</div>
              <div className="text-sm text-gray-400">На модерации</div>
            </div>
            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-green-400">{stats.approvedCount}</div>
              <div className="text-sm text-gray-400">Согласовано</div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-purple-400">{stats.withBridges}</div>
              <div className="text-sm text-gray-400">С мостиками</div>
            </div>
            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-blue-400">
                {stats.minBpm} – {stats.maxBpm}
              </div>
              <div className="text-sm text-gray-400">Диапазон BPM</div>
            </div>
            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-cyan-400">{stats.withAccents}</div>
              <div className="text-sm text-gray-400">С акцентом</div>
            </div>
            <div className="bg-gray-700/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-orange-400">{stats.withMambo}</div>
              <div className="text-sm text-gray-400">С мамбо</div>
            </div>
          </div>
        </div>
      )}

      {/* Экспорт данных */}
      <div className="bg-gray-800/50 rounded-xl p-6 mb-8 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <svg
            className="w-5 h-5 text-purple-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          Экспорт данных
        </h2>
        <p className="text-gray-400 text-sm mb-4">
          Выгрузите список треков: название песни, имя файла на сервере и
          таблицу Row Analysis (ряды и показатели корреляционного анализа с
          главной страницы).
        </p>
        <p className="text-gray-400 text-xs mb-4">
          Манифест — CSV с колонками id, title, artist, pathOriginal,
          report_filename: для сопоставления названий треков и файлов отчётов
          при переносе с сервера (например, чтобы знать, какой JSON-отчёт какому
          треку принадлежит).
        </p>

        <div className="flex flex-wrap gap-3 mb-4">
          <button
            onClick={() => handleExport("manifest")}
            disabled={isExporting || !stats?.total}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600/80 hover:bg-cyan-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {isExporting ? (
              <svg
                className="w-5 h-5 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            ) : (
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            )}
            Скачать манифест (CSV)
          </button>

          <button
            onClick={() => handleExport("csv")}
            disabled={isExporting || !stats?.total}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {isExporting ? (
              <svg
                className="w-5 h-5 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            ) : (
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
            )}
            Скачать CSV
          </button>

          <button
            onClick={() => handleExport("json")}
            disabled={isExporting || !stats?.total}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            Скачать JSON
          </button>

          <button
            onClick={() => setShowPreview(!showPreview)}
            disabled={!stats?.total}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
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

      {/* Миграция треков в S3 */}
      <div className="bg-gray-800/50 rounded-xl p-6 mb-8 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
          </svg>
          Миграция треков в S3
        </h2>
        <p className="text-gray-400 text-sm mb-4">
          Переносит аудиофайлы с локального диска сервера в S3-хранилище (по одному треку).
          После переноса обновляет ссылку в базе данных. Локальные файлы не удаляются — их можно удалить вручную после проверки.
        </p>

        {migrationStats && (
          <div className="flex gap-4 mb-4">
            <div className="bg-gray-700/50 rounded-lg px-4 py-2">
              <span className="text-2xl font-bold text-white">{migrationStats.localCount}</span>
              <span className="text-sm text-gray-400 ml-2">локальных</span>
            </div>
            <div className="bg-gray-700/50 rounded-lg px-4 py-2">
              <span className="text-2xl font-bold text-sky-400">{migrationStats.s3Count}</span>
              <span className="text-sm text-gray-400 ml-2">в S3</span>
            </div>
            <div className="bg-gray-700/50 rounded-lg px-4 py-2">
              <span className="text-2xl font-bold text-gray-300">{migrationStats.total}</span>
              <span className="text-sm text-gray-400 ml-2">всего</span>
            </div>
          </div>
        )}

        {migrationStats && migrationStats.localCount > 0 && (
          <div className="mb-4">
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 transition-all duration-300"
                style={{ width: `${Math.round((migrationStats.s3Count / migrationStats.total) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {Math.round((migrationStats.s3Count / migrationStats.total) * 100)}% в S3
            </p>
          </div>
        )}

        <div className="flex items-center gap-4 flex-wrap">
          {!isMigrating ? (
            <button
              onClick={handleMigrate}
              disabled={!migrationStats || migrationStats.localCount === 0}
              className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              {migrationStats?.localCount === 0 ? "Все треки в S3" : `Начать миграцию (${migrationStats?.localCount ?? "…"})`}
            </button>
          ) : (
            <button
              onClick={() => { migrationStopRef.current = true; setMigrationStopped(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Остановить
            </button>
          )}

          {isMigrating && migrationProgress && (
            <span className="text-sm text-gray-300 flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Перенесено: <span className="text-sky-400">{migrationProgress.migrated}</span>
              {migrationProgress.skipped > 0 && (
                <span className="text-yellow-400 ml-1">(пропущено: {migrationProgress.skipped})</span>
              )}
              {migrationProgress.lastTitle && (
                <span className="text-gray-500 max-w-xs truncate">— {migrationProgress.lastTitle}</span>
              )}
            </span>
          )}

          {migrationDone && !isMigrating && (
            <span className="text-green-400 text-sm">Миграция завершена!</span>
          )}
          {migrationStopped && !isMigrating && (
            <span className="text-yellow-400 text-sm">Остановлено. Прогресс сохранён.</span>
          )}
        </div>
      </div>

      {/* Превью данных */}
      {showPreview && tracks.length > 0 && (
        <div className="bg-gray-800/50 rounded-xl p-6 mb-8 border border-gray-700 overflow-hidden">
          <h2 className="text-lg font-semibold text-white mb-4">
            Данные треков (как в экспорте)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="pb-2 pr-4">Название</th>
                  <th className="pb-2 pr-4">Файл (сервер)</th>
                  <th className="pb-2 pr-4 text-center">Row Analysis</th>
                </tr>
              </thead>
              <tbody>
                {tracks.slice(0, 20).map((track) => {
                  const ca =
                    track.gridMap &&
                    typeof track.gridMap === "object" &&
                    (track.gridMap as Record<string, unknown>)
                      .correlationAnalysis;
                  const verdict =
                    ca &&
                    typeof ca === "object" &&
                    (ca as Record<string, unknown>).verdict;
                  const winningRow =
                    verdict &&
                    typeof verdict === "object" &&
                    (verdict as Record<string, unknown>).winning_row;
                  return (
                    <tr
                      key={track.id}
                      className="border-b border-gray-700/50 hover:bg-gray-700/30"
                    >
                      <td className="py-2 pr-4 text-white">{track.title}</td>
                      <td className="py-2 pr-4 text-gray-400 font-mono text-xs">
                        {track.filename || "—"}
                      </td>
                      <td className="py-2 pr-4 text-center">
                        {winningRow != null ? (
                          <span className="text-green-400">
                            Row {String(winningRow)}
                          </span>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {tracks.length > 20 && (
              <p className="text-gray-500 text-sm mt-4 text-center">
                Показано 20 из {tracks.length} треков. В файле — полная таблица
                Row Analysis (Beats, Sum, Avg, Max по каждому ряду).
              </p>
            )}
          </div>
        </div>
      )}

      {/* Настройки воспроизведения */}
      <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <svg
            className="w-5 h-5 text-purple-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Настройки воспроизведения
        </h2>
        <SettingsPanel />
      </div>
    </div>
  );
}
