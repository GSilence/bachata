"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { isAdmin } from "@/lib/roles";
import AdminSubNav from "@/components/AdminSubNav";

interface ClusterTrack {
  id: number;
  title: string;
  artist: string | null;
  bpm: number;
  duration: number | null;
  fileSize: number | null;
  isPrimary: boolean;
  filename: string;
  pathOriginal: string | null;
  trackStatus: string;
}

interface Cluster {
  id: number;
  tracks: ClusterTrack[];
  createdAt: string;
}

export default function DuplicatesPage() {
  const router = useRouter();
  const { user, isLoading, checkAuth } = useAuthStore();

  // Параметры поиска
  const [fileSizeEnabled, setFileSizeEnabled] = useState(true);
  const [fileSizePercent, setFileSizePercent] = useState(2);
  const [durationEnabled, setDurationEnabled] = useState(true);
  const [durationSeconds, setDurationSeconds] = useState(5);
  const [bpmEnabled, setBpmEnabled] = useState(true);
  const [bpmDelta, setBpmDelta] = useState(0);
  const [artistEnabled, setArtistEnabled] = useState(true);
  const [titleEnabled, setTitleEnabled] = useState(false);
  const [fingerprintEnabled, setFingerprintEnabled] = useState(false);

  // Состояние
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanResult, setScanResult] = useState<string | null>(null);

  // Аудио
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingTrackId, setPlayingTrackId] = useState<number | null>(null);

  // Модалка подтверждения
  const [mergeConfirm, setMergeConfirm] = useState<Cluster | null>(null);
  const [merging, setMerging] = useState(false);

  useEffect(() => { checkAuth(); }, [checkAuth]);
  useEffect(() => {
    if (!isLoading && (!user || !isAdmin(user?.role))) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  // Загрузка кластеров
  const fetchClusters = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/clusters");
      if (res.ok) {
        const data = await res.json();
        setClusters(data.clusters || []);
      }
    } catch (e) {
      console.error("Fetch clusters error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user && isAdmin(user?.role)) fetchClusters();
  }, [user, fetchClusters]);

  // Сканирование
  const handleScan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/admin/clusters/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileSizeEnabled,
          fileSizePercent,
          durationEnabled,
          durationSeconds,
          bpmEnabled,
          bpmDelta,
          artistEnabled,
          titleEnabled,
          fingerprintEnabled,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setScanResult(
          `Найдено ${data.clustersCreated} групп (${data.tracksClustered} треков из ${data.tracksProcessed})`
        );
        await fetchClusters();
      } else {
        setScanResult(`Ошибка: ${data.error}`);
      }
    } catch (e: any) {
      setScanResult(`Ошибка: ${e.message}`);
    } finally {
      setScanning(false);
    }
  };

  // Play/Stop
  const handlePlay = (track: ClusterTrack) => {
    if (playingTrackId === track.id) {
      audioRef.current?.pause();
      setPlayingTrackId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const raw = track.pathOriginal || track.filename;
    const src = raw.startsWith("http") ? raw : `/${raw}`;
    const audio = new Audio(src);
    audio.onended = () => setPlayingTrackId(null);
    audio.play();
    audioRef.current = audio;
    setPlayingTrackId(track.id);
  };

  // Set primary
  const handleSetPrimary = async (trackId: number, clusterId: number) => {
    await fetch("/api/admin/clusters/set-primary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId, clusterId }),
    });
    await fetchClusters();
  };

  // Remove track from cluster
  const handleRemoveTrack = async (trackId: number, clusterId: number, exclude: boolean) => {
    await fetch("/api/admin/clusters/remove-track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId, clusterId, exclude }),
    });
    await fetchClusters();
  };

  // Merge
  const handleMerge = async (clusterId: number) => {
    setMerging(true);
    try {
      const res = await fetch("/api/admin/clusters/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusterId }),
      });
      const data = await res.json();
      if (res.ok) {
        setScanResult(`Объединено. Удалено ${data.deletedTrackIds.length} дубликатов.`);
      } else {
        setScanResult(`Ошибка: ${data.error}`);
      }
    } catch (e: any) {
      setScanResult(`Ошибка: ${e.message}`);
    } finally {
      setMerging(false);
      setMergeConfirm(null);
      await fetchClusters();
    }
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const formatSize = (bytes: number | null) => {
    if (bytes == null) return "—";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  };

  const formatDuration = (sec: number | null) => {
    if (sec == null) return "—";
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (isLoading || !user) return null;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <AdminSubNav group="library" />
      <h1 className="text-2xl font-bold text-white mb-6">Поиск дубликатов</h1>

      {/* Параметры */}
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Параметры поиска
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Размер файла */}
          <label className="flex items-center gap-3 text-gray-300">
            <input
              type="checkbox"
              checked={fileSizeEnabled}
              onChange={(e) => setFileSizeEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500"
            />
            <span>Размер файла ±</span>
            <input
              type="number"
              min={0.1}
              step={0.5}
              value={fileSizePercent}
              onChange={(e) => setFileSizePercent(Number(e.target.value))}
              disabled={!fileSizeEnabled}
              className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-sm disabled:opacity-40"
            />
            <span>%</span>
          </label>

          {/* Длительность */}
          <label className="flex items-center gap-3 text-gray-300">
            <input
              type="checkbox"
              checked={durationEnabled}
              onChange={(e) => setDurationEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500"
            />
            <span>Длительность ±</span>
            <input
              type="number"
              min={1}
              step={1}
              value={durationSeconds}
              onChange={(e) => setDurationSeconds(Number(e.target.value))}
              disabled={!durationEnabled}
              className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-sm disabled:opacity-40"
            />
            <span>сек</span>
          </label>

          {/* BPM */}
          <label className="flex items-center gap-3 text-gray-300">
            <input
              type="checkbox"
              checked={bpmEnabled}
              onChange={(e) => setBpmEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500"
            />
            <span>BPM ±</span>
            <input
              type="number"
              min={0}
              step={1}
              value={bpmDelta}
              onChange={(e) => setBpmDelta(Number(e.target.value))}
              disabled={!bpmEnabled}
              className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-sm disabled:opacity-40"
            />
          </label>

          {/* Артист */}
          <label className="flex items-center gap-3 text-gray-300">
            <input
              type="checkbox"
              checked={artistEnabled}
              onChange={(e) => setArtistEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500"
            />
            <span>Артист (точное совпадение)</span>
          </label>

          {/* Название */}
          <label className="flex items-center gap-3 text-gray-300">
            <input
              type="checkbox"
              checked={titleEnabled}
              onChange={(e) => setTitleEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-purple-500 focus:ring-purple-500"
            />
            <span>Название (общие слова)</span>
          </label>

          {/* Fingerprint */}
          <label className="flex items-center gap-3 text-gray-300">
            <input
              type="checkbox"
              checked={fingerprintEnabled}
              onChange={(e) => setFingerprintEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500"
            />
            <span>Audio fingerprint (Chromaprint)</span>
          </label>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <button
            onClick={handleScan}
            disabled={scanning || (!fileSizeEnabled && !durationEnabled && !bpmEnabled && !artistEnabled && !titleEnabled && !fingerprintEnabled)}
            className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {scanning ? (fingerprintEnabled ? "Анализ аудио..." : "Сканирование...") : "Сканировать"}
          </button>
          {scanResult && (
            <span className="text-sm text-gray-400">{scanResult}</span>
          )}
        </div>
      </div>

      {/* Кластеры */}
      {loading ? (
        <div className="text-gray-500 text-center py-8">Загрузка...</div>
      ) : clusters.length === 0 ? (
        <div className="text-gray-500 text-center py-8">
          Нет групп дубликатов. Запустите сканирование.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-sm text-gray-400 mb-2">
            Найдено {clusters.length} групп ({clusters.reduce((s, c) => s + c.tracks.length, 0)} треков)
          </div>

          {clusters.map((cluster) => (
            <div
              key={cluster.id}
              className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden"
            >
              <div className="px-4 py-2 bg-gray-800/50 border-b border-gray-700 flex items-center justify-between">
                <span className="text-sm text-gray-400">
                  Группа #{cluster.id} ({cluster.tracks.length} треков)
                </span>
                <button
                  onClick={() => setMergeConfirm(cluster)}
                  disabled={!cluster.tracks.some((t) => t.isPrimary)}
                  className="px-3 py-1 bg-red-600/80 hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded text-xs font-medium transition-colors"
                >
                  Объединить и удалить дубли
                </button>
              </div>

              <div className="divide-y divide-gray-800">
                {cluster.tracks.map((track) => (
                  <div
                    key={track.id}
                    className={`px-4 py-3 flex items-center gap-3 ${
                      track.isPrimary ? "bg-green-900/10" : ""
                    }`}
                  >
                    {/* Primary star */}
                    <button
                      onClick={() => handleSetPrimary(track.id, cluster.id)}
                      className={`text-lg transition-colors ${
                        track.isPrimary
                          ? "text-yellow-400"
                          : "text-gray-600 hover:text-yellow-400/60"
                      }`}
                      title={track.isPrimary ? "Главный трек" : "Сделать главным"}
                    >
                      {track.isPrimary ? "\u2605" : "\u2606"}
                    </button>

                    {/* Play/Stop */}
                    <button
                      onClick={() => handlePlay(track)}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-800 hover:bg-gray-700 text-white transition-colors"
                    >
                      {playingTrackId === track.id ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <rect x="6" y="4" width="4" height="16" />
                          <rect x="14" y="4" width="4" height="16" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>

                    {/* Track info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">
                        {track.artist && (
                          <span className="text-gray-400">{track.artist} — </span>
                        )}
                        {track.title}
                      </div>
                      <div className="text-xs text-gray-500 flex items-center gap-3 mt-0.5">
                        <span>{formatDuration(track.duration)}</span>
                        <span>{formatSize(track.fileSize)}</span>
                        <span>{track.bpm} BPM</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            track.trackStatus === "approved"
                              ? "bg-emerald-900/40 text-emerald-400"
                              : track.trackStatus === "moderation"
                                ? "bg-amber-900/40 text-amber-400"
                                : track.trackStatus === "popsa"
                                  ? "bg-orange-900/40 text-orange-400"
                                  : "bg-sky-900/40 text-sky-400"
                          }`}
                        >
                          {track.trackStatus === "approved"
                            ? "Согласована"
                            : track.trackStatus === "moderation"
                              ? "Модерация"
                              : track.trackStatus === "popsa"
                                ? "Попса"
                                : "Новая"}
                        </span>
                        <span className="text-gray-600">#{track.id}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRemoveTrack(track.id, cluster.id, false)}
                        className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                        title="Убрать из группы (будет пересканирован)"
                      >
                        Убрать
                      </button>
                      <button
                        onClick={() => handleRemoveTrack(track.id, cluster.id, true)}
                        className="px-2 py-1 text-xs text-gray-500 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
                        title="Исключить навсегда (не попадёт при пересканировании)"
                      >
                        Исключить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Модалка подтверждения */}
      {mergeConfirm && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-semibold text-white mb-4">
              Подтверждение объединения
            </h3>
            <div className="text-sm text-gray-300 mb-4">
              <p className="mb-2">
                Главный трек:{" "}
                <span className="text-white font-medium">
                  {mergeConfirm.tracks.find((t) => t.isPrimary)?.title || "—"}
                </span>
              </p>
              <p className="mb-2">
                Будут удалены ({mergeConfirm.tracks.length - 1} треков):
              </p>
              <ul className="list-disc list-inside text-gray-400 space-y-1">
                {mergeConfirm.tracks
                  .filter((t) => !t.isPrimary)
                  .map((t) => (
                    <li key={t.id}>
                      {t.artist ? `${t.artist} — ` : ""}
                      {t.title}{" "}
                      <span className="text-gray-600">
                        ({formatSize(t.fileSize)})
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
            <p className="text-xs text-red-400 mb-4">
              UserTrack и PlaylistItem будут перенесены на главный трек. Файлы
              дубликатов будут удалены. Это действие необратимо.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setMergeConfirm(null)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={() => handleMerge(mergeConfirm.id)}
                disabled={merging}
                className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg font-medium transition-colors"
              >
                {merging ? "Удаление..." : "Удалить дубликаты"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
