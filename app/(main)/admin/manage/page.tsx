"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
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

export default function AdminManagePage() {
  const router = useRouter();
  const { user, isLoading, checkAuth } = useAuthStore();
  const [isExporting, setIsExporting] = useState(false);
  const [stats, setStats] = useState<TrackStats | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationStopped, setMigrationStopped] = useState(false);
  const migrationStopRef = useRef(false);
  const [migrationStats, setMigrationStats] = useState<{ total: number; localCount: number; s3Count: number } | null>(null);
  const [migrationProgress, setMigrationProgress] = useState<{ migrated: number; skipped: number; lastTitle: string } | null>(null);
  const [migrationDone, setMigrationDone] = useState(false);

  // Waveform bulk generation
  const [wfStats, setWfStats] = useState<{ total: number; withWaveform: number; without: number } | null>(null);

  // Lookup metadata bulk
  const [luStats, setLuStats] = useState<{ total: number; done: number; pending: number; withMeta: number; hasApiKey: boolean } | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const luStopRef = useRef(false);
  const [luStopped, setLuStopped] = useState(false);
  const [luProgress, setLuProgress] = useState<{ processed: number; saved: number; lastTitle: string; errors: number } | null>(null);
  const [luDone, setLuDone] = useState(false);
  const [isWaveforming, setIsWaveforming] = useState(false);
  const wfStopRef = useRef(false);
  const [wfStopped, setWfStopped] = useState(false);
  const [wfProgress, setWfProgress] = useState<{ processed: number; lastTitle: string; errors: number } | null>(null);
  const [wfDone, setWfDone] = useState(false);

  // Auth check
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isLoading && (!user || !isAdmin(user?.role))) {
      router.push("/login?redirect=/admin/manage");
    }
  }, [user, isLoading, router]);

  // Загружаем статистику при монтировании (только для админа)
  useEffect(() => {
    if (isAdmin(user?.role)) fetchStats();
  }, [user]);

  const fetchStats = async () => {
    try {
      const response = await fetch("/api/tracks?pageSize=0", { cache: "no-store" });
      if (response.ok) {
        const json = await response.json();
        const data: any[] = json.tracks ?? json;

        if (data.length > 0) {
          const bpms = data.map((t: any) => t.bpm).filter((b: number) => b > 0);
          setStats({
            total: data.length,
            newCount: data.filter((t: any) => t.trackStatus === "unlistened").length,
            moderationCount: data.filter((t: any) => t.trackStatus === "moderation").length,
            approvedCount: data.filter((t: any) => t.trackStatus === "approved").length,
            withBridges: data.filter((t: any) => t.hasBridges).length,
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

  const fetchWfStats = async () => {
    try {
      const r = await fetch("/api/admin/waveform-all");
      if (r.ok) setWfStats(await r.json());
    } catch {}
  };

  useEffect(() => {
    if (isAdmin(user?.role)) fetchWfStats();
  }, [user]);

  const fetchLuStats = async () => {
    try {
      const r = await fetch("/api/admin/lookup-metadata-all");
      if (r.ok) setLuStats(await r.json());
    } catch {}
  };

  useEffect(() => {
    if (isAdmin(user?.role)) fetchLuStats();
  }, [user]);

  const handleWaveform = async () => {
    wfStopRef.current = false;
    setIsWaveforming(true);
    setWfStopped(false);
    setWfDone(false);
    setWfProgress({ processed: 0, lastTitle: "", errors: 0 });

    let processed = 0;
    let errors = 0;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (wfStopRef.current) break;
      try {
        const r = await fetch("/api/admin/waveform-all", { method: "POST" });
        const data = await r.json();
        if (data.done) { setWfDone(true); break; }
        if (data.processed) {
          processed++;
          consecutiveErrors = 0;
        } else {
          errors++;
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            setWfDone(true);
            break;
          }
        }
        setWfProgress({ processed, lastTitle: data.title || "", errors });
      } catch (e: any) {
        alert("Сетевая ошибка: " + e.message);
        break;
      }
    }

    setIsWaveforming(false);
    fetchWfStats();
  };

  const handleLookup = async () => {
    luStopRef.current = false;
    setIsLookingUp(true);
    setLuStopped(false);
    setLuDone(false);
    setLuProgress({ processed: 0, saved: 0, lastTitle: "", errors: 0 });

    let processed = 0;
    let saved = 0;
    let errors = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (luStopRef.current) break;
      try {
        const r = await fetch("/api/admin/lookup-metadata-all", { method: "POST" });
        const data = await r.json();
        if (data.done) { setLuDone(true); break; }
        if (data.processed) {
          processed++;
          if (data.saved) saved++;
        } else {
          errors++;
        }
        setLuProgress({ processed, saved, lastTitle: data.title || "", errors });
      } catch (e: any) {
        alert("Сетевая ошибка: " + e.message);
        break;
      }
    }

    setIsLookingUp(false);
    fetchLuStats();
  };

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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">Загрузка...</div>
      </div>
    );
  }

  if (!user || !isAdmin(user.role)) {
    return null;
  }

  return (
    <div className="p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-white mb-6">Управление</h1>

      {/* Blocks in flex-wrap layout */}
      <div className="flex flex-wrap gap-6">

        {/* Статистика + экспорт */}
        {stats && (
          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 w-full">
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
            <div className="flex flex-wrap gap-4 mb-4">
              <div className="bg-gray-700/50 rounded-lg p-4 min-w-[140px]">
                <div className="text-2xl font-bold text-white">{stats.total}</div>
                <div className="text-sm text-gray-400">Всего треков</div>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-4 min-w-[140px]">
                <div className="text-2xl font-bold text-gray-300">{stats.newCount}</div>
                <div className="text-sm text-gray-400">Новые</div>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-4 min-w-[140px]">
                <div className="text-2xl font-bold text-yellow-400">{stats.moderationCount}</div>
                <div className="text-sm text-gray-400">На модерации</div>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-4 min-w-[140px]">
                <div className="text-2xl font-bold text-green-400">{stats.approvedCount}</div>
                <div className="text-sm text-gray-400">Согласовано</div>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-4 min-w-[140px]">
                <div className="text-2xl font-bold text-purple-400">{stats.withBridges}</div>
                <div className="text-sm text-gray-400">С мостиками</div>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-4 min-w-[140px]">
                <div className="text-2xl font-bold text-blue-400">
                  {stats.minBpm} – {stats.maxBpm}
                </div>
                <div className="text-sm text-gray-400">Диапазон BPM</div>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-4 min-w-[140px]">
                <div className="text-2xl font-bold text-cyan-400">{stats.withAccents}</div>
                <div className="text-sm text-gray-400">С акцентом</div>
              </div>
              <div className="bg-gray-700/50 rounded-lg p-4 min-w-[140px]">
                <div className="text-2xl font-bold text-orange-400">{stats.withMambo}</div>
                <div className="text-sm text-gray-400">С мамбо</div>
              </div>
            </div>

            {/* Экспорт — CSV / JSON */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => handleExport("csv")}
                disabled={isExporting}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                CSV
              </button>
              <button
                onClick={() => handleExport("json")}
                disabled={isExporting}
                className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                JSON
              </button>
            </div>
          </div>
        )}

        {/* Миграция треков в S3 */}
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 flex-1 min-w-[340px]">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
            Миграция в S3
          </h2>
          <p className="text-gray-400 text-sm mb-4">
            Переносит аудиофайлы с локального диска в S3-хранилище.
          </p>

          {migrationStats && (
            <div className="flex gap-3 mb-4 flex-wrap">
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
                {migrationStats?.localCount === 0 ? "Все в S3" : `Миграция (${migrationStats?.localCount ?? "…"})`}
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
                <span className="text-sky-400">{migrationProgress.migrated}</span>
                {migrationProgress.skipped > 0 && (
                  <span className="text-yellow-400">(пропущено: {migrationProgress.skipped})</span>
                )}
              </span>
            )}

            {migrationDone && !isMigrating && (
              <span className="text-green-400 text-sm">Завершена!</span>
            )}
            {migrationStopped && !isMigrating && (
              <span className="text-yellow-400 text-sm">Остановлено</span>
            )}
          </div>
        </div>

        {/* Waveform bulk generation */}
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 flex-1 min-w-[340px]">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l2 2 2-2v4l2-2 2 2V6" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h2m14 0h2M3 6h2m14 0h2M3 18h2m14 0h2" />
            </svg>
            Waveform
          </h2>
          <p className="text-gray-400 text-sm mb-4">
            Генерация 200 RMS-пиков для отображения в плеере.
          </p>

          {wfStats && (
            <div className="flex gap-3 mb-4 flex-wrap">
              <div className="bg-gray-700/50 rounded-lg px-4 py-2">
                <span className="text-2xl font-bold text-sky-400">{wfStats.withWaveform}</span>
                <span className="text-sm text-gray-400 ml-2">готово</span>
              </div>
              <div className="bg-gray-700/50 rounded-lg px-4 py-2">
                <span className="text-2xl font-bold text-red-400">{wfStats.without}</span>
                <span className="text-sm text-gray-400 ml-2">без</span>
              </div>
            </div>
          )}

          {wfStats && wfStats.withWaveform > 0 && wfStats.without > 0 && (
            <div className="mb-4">
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-500 transition-all duration-300"
                  style={{ width: `${Math.round((wfStats.withWaveform / wfStats.total) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {Math.round((wfStats.withWaveform / wfStats.total) * 100)}% готово
              </p>
            </div>
          )}

          <div className="flex items-center gap-4 flex-wrap">
            {!isWaveforming ? (
              <button
                onClick={handleWaveform}
                disabled={!wfStats || wfStats.without === 0}
                className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l2 2 2-2v4l2-2 2 2V6" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h2m14 0h2M3 6h2m14 0h2M3 18h2m14 0h2" />
                </svg>
                {wfStats?.without === 0 ? "Все готово" : `Генерация (${wfStats?.without ?? "…"})`}
              </button>
            ) : (
              <button
                onClick={() => { wfStopRef.current = true; setWfStopped(true); }}
                className="flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Остановить
              </button>
            )}

            {isWaveforming && wfProgress && (
              <span className="text-sm text-gray-300 flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="text-sky-400">{wfProgress.processed}</span>
                {wfProgress.errors > 0 && (
                  <span className="text-red-400">(ошибок: {wfProgress.errors})</span>
                )}
              </span>
            )}

            {wfDone && !isWaveforming && (
              <span className="text-green-400 text-sm">Готово!</span>
            )}
            {wfStopped && !isWaveforming && (
              <span className="text-yellow-400 text-sm">Остановлено</span>
            )}
          </div>
        </div>

        {/* Lookup Metadata (AcoustID + MusicBrainz) */}
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 flex-1 min-w-[340px]">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Метаданные (AcoustID)
          </h2>
          <p className="text-gray-400 text-sm mb-4">
            Поиск названия, исполнителя, альбома, года и обложки по аудиоотпечатку.
            {luStats && !luStats.hasApiKey && (
              <span className="text-red-400 ml-1">ACOUSTID_API_KEY не задан!</span>
            )}
          </p>

          {luStats && (
            <div className="flex gap-3 mb-4 flex-wrap">
              <div className="bg-gray-700/50 rounded-lg px-4 py-2">
                <span className="text-2xl font-bold text-amber-400">{luStats.withMeta}</span>
                <span className="text-sm text-gray-400 ml-2">найдено</span>
              </div>
              <div className="bg-gray-700/50 rounded-lg px-4 py-2">
                <span className="text-2xl font-bold text-red-400">{luStats.pending}</span>
                <span className="text-sm text-gray-400 ml-2">ожидает</span>
              </div>
            </div>
          )}

          {luStats && luStats.done > 0 && luStats.total > 0 && (
            <div className="mb-4">
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${Math.round((luStats.done / luStats.total) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {Math.round((luStats.done / luStats.total) * 100)}% проверено
              </p>
            </div>
          )}

          <div className="flex items-center gap-4 flex-wrap">
            {!isLookingUp ? (
              <button
                onClick={handleLookup}
                disabled={!luStats || luStats.pending === 0 || !luStats.hasApiKey}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                {luStats?.pending === 0 ? "Все проверены" : `Поиск (${luStats?.pending ?? "…"})`}
              </button>
            ) : (
              <button
                onClick={() => { luStopRef.current = true; setLuStopped(true); }}
                className="flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Остановить
              </button>
            )}

            {isLookingUp && luProgress && (
              <span className="text-sm text-gray-300 flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin text-amber-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="text-amber-400">{luProgress.processed}</span>
                <span className="text-green-400">сохр: {luProgress.saved}</span>
                {luProgress.errors > 0 && (
                  <span className="text-red-400">(ошибок: {luProgress.errors})</span>
                )}
              </span>
            )}

            {luDone && !isLookingUp && (
              <span className="text-green-400 text-sm">Все проверены!</span>
            )}
            {luStopped && !isLookingUp && (
              <span className="text-yellow-400 text-sm">Остановлено</span>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
