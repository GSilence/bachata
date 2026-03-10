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

export default function SettingsPage() {
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

  // Fingerprint
  const [fpStats, setFpStats] = useState<{ total: number; withFingerprint: number; withError: number; without: number } | null>(null);
  const [isFingerprinting, setIsFingerprinting] = useState(false);
  const fpStopRef = useRef(false);
  const [fpStopped, setFpStopped] = useState(false);
  const [fpProgress, setFpProgress] = useState<{ processed: number; lastTitle: string; errors: number } | null>(null);
  const [fpDone, setFpDone] = useState(false);

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

  const fetchFpStats = async () => {
    try {
      const r = await fetch("/api/admin/fingerprint-all");
      if (r.ok) setFpStats(await r.json());
    } catch {}
  };

  useEffect(() => {
    if (isAdmin(user?.role)) fetchFpStats();
  }, [user]);

  const handleFingerprint = async () => {
    fpStopRef.current = false;
    setIsFingerprinting(true);
    setFpStopped(false);
    setFpDone(false);
    setFpProgress({ processed: 0, lastTitle: "", errors: 0 });

    let processed = 0;
    let errors = 0;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (fpStopRef.current) break;
      try {
        const r = await fetch("/api/admin/fingerprint-all", { method: "POST" });
        const data = await r.json();
        if (data.done) { setFpDone(true); break; }
        if (data.processed) {
          processed++;
          consecutiveErrors = 0;
        } else {
          errors++;
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            setFpDone(true);
            break;
          }
        }
        setFpProgress({ processed, lastTitle: data.title || "", errors });
      } catch (e: any) {
        alert("Сетевая ошибка: " + e.message);
        break;
      }
    }

    setIsFingerprinting(false);
    fetchFpStats();
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

      {/* Статистика + экспорт */}
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
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
      <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
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

      {/* Chromaprint Fingerprint */}
      <div className="bg-gray-800/50 rounded-xl p-6 mt-8 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
          </svg>
          Аудио-отпечатки (Chromaprint)
        </h2>
        <p className="text-gray-400 text-sm mb-4">
          Генерирует сырой Chromaprint fingerprint (массив int32) для каждого трека. Используется для дедупликации —
          если пользователь загружает трек, который уже есть в базе (даже в другом битрейте или обрезанный), он будет распознан.
          <br /><span className="text-yellow-500">⚠ Старые base64-отпечатки несовместимы — перегенерируйте все.</span>
        </p>

        {fpStats && (
          <div className="flex gap-4 mb-4">
            <div className="bg-gray-700/50 rounded-lg px-4 py-2">
              <span className="text-2xl font-bold text-emerald-400">{fpStats.withFingerprint}</span>
              <span className="text-sm text-gray-400 ml-2">с отпечатком</span>
            </div>
            <div className="bg-gray-700/50 rounded-lg px-4 py-2">
              <span className="text-2xl font-bold text-red-400">{fpStats.without}</span>
              <span className="text-sm text-gray-400 ml-2">без отпечатка</span>
            </div>
            {fpStats.withError > 0 && (
              <div className="bg-gray-700/50 rounded-lg px-4 py-2">
                <span className="text-2xl font-bold text-yellow-400">{fpStats.withError}</span>
                <span className="text-sm text-gray-400 ml-2">ошибки</span>
              </div>
            )}
            <div className="bg-gray-700/50 rounded-lg px-4 py-2">
              <span className="text-2xl font-bold text-gray-300">{fpStats.total}</span>
              <span className="text-sm text-gray-400 ml-2">всего</span>
            </div>
          </div>
        )}

        {fpStats && fpStats.without > 0 && fpStats.withFingerprint > 0 && (
          <div className="mb-4">
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${Math.round((fpStats.withFingerprint / fpStats.total) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {Math.round((fpStats.withFingerprint / fpStats.total) * 100)}% готово
            </p>
          </div>
        )}

        <div className="flex items-center gap-4 flex-wrap">
          {!isFingerprinting ? (
            <button
              onClick={handleFingerprint}
              disabled={!fpStats || fpStats.without === 0}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
              </svg>
              {fpStats?.without === 0 ? "Все треки с отпечатком" : `Сгенерировать (${fpStats?.without ?? "…"})`}
            </button>
          ) : (
            <button
              onClick={() => { fpStopRef.current = true; setFpStopped(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Остановить
            </button>
          )}

          {isFingerprinting && fpProgress && (
            <span className="text-sm text-gray-300 flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin text-emerald-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Готово: <span className="text-emerald-400">{fpProgress.processed}</span>
              {fpProgress.errors > 0 && (
                <span className="text-red-400 ml-1">(ошибок: {fpProgress.errors})</span>
              )}
              {fpProgress.lastTitle && (
                <span className="text-gray-500 max-w-xs truncate">— {fpProgress.lastTitle}</span>
              )}
            </span>
          )}

          {fpDone && !isFingerprinting && (
            <span className="text-green-400 text-sm">Все отпечатки сгенерированы!</span>
          )}
          {fpStopped && !isFingerprinting && (
            <span className="text-yellow-400 text-sm">Остановлено. Прогресс сохранён.</span>
          )}
        </div>
      </div>

    </div>
  );
}
