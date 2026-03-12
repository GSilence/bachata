"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { useAuthStore } from "@/store/authStore";

interface QueueEntry {
  id: number;
  title: string;
  artist: string | null;
  filename: string;
  status: "pending" | "processing" | "done" | "failed";
  error: string | null;
  trackId: number | null;
  position: number | null;
  uploadedBy: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  pending:    "В очереди",
  processing: "Обрабатывается",
  done:       "Готово",
  failed:     "Ошибка",
};

const STATUS_COLORS: Record<string, string> = {
  pending:    "text-yellow-400 bg-yellow-400/10",
  processing: "text-blue-400 bg-blue-400/10",
  done:       "text-green-400 bg-green-400/10",
  failed:     "text-red-400 bg-red-400/10",
};

// Приоритет: обрабатываемые → ждут → готовые → ошибки
const STATUS_PRIORITY: Record<string, number> = {
  processing: 0,
  pending:    1,
  done:       2,
  failed:     3,
};

function sortEntries(entries: QueueEntry[]): QueueEntry[] {
  return [...entries].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status] ?? 9;
    const pb = STATUS_PRIORITY[b.status] ?? 9;
    if (pa !== pb) return pa - pb;
    // pending/processing — старые первыми (порядок очереди)
    if (a.status === "pending" || a.status === "processing") {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
    // done/failed — новые первыми
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? "text-gray-400 bg-gray-400/10"}`}>
      {status === "processing" && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
      )}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

const AVG_PROCESS_SEC = 37.5; // среднее время обработки файла (35-40 сек)

function formatEstimate(seconds: number): string {
  if (seconds < 60) return `~${Math.round(seconds)} сек`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)} мин`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `~${h} ч ${m} мин`;
}

function formatDuration(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)} сек`;
  return `${(ms / 60_000).toFixed(1)} мин`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function QueuePage() {
  const user = useAuthStore((s) => s.user);
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [clearingDone, setClearingDone] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/queue?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntries(data.entries ?? []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    intervalRef.current = setInterval(fetchQueue, 5_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchQueue]);

  const handleRetry = async (id: number) => {
    setRetrying(id);
    try {
      const res = await fetch(`/api/queue/${id}/retry`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error ?? "Ошибка");
      } else {
        await fetchQueue();
      }
    } finally {
      setRetrying(null);
    }
  };

  const handleDelete = async (id: number) => {
    setDeleting(id);
    try {
      const res = await fetch(`/api/queue/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error ?? "Ошибка");
      } else {
        // Убираем из локального стейта сразу, не ждём polling
        setEntries((prev) => prev.filter((e) => e.id !== id));
      }
    } finally {
      setDeleting(null);
    }
  };

  const handleClearDone = async () => {
    setClearingDone(true);
    try {
      const res = await fetch("/api/queue", { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error ?? "Ошибка");
      } else {
        setEntries((prev) => prev.filter((e) => e.status !== "done"));
      }
    } finally {
      setClearingDone(false);
    }
  };

  const sorted = sortEntries(entries);
  const activeCount = entries.filter((e) => e.status === "pending" || e.status === "processing").length;
  const doneCount = entries.filter((e) => e.status === "done").length;

  // Оценка времени ожидания
  const estimate = useMemo(() => {
    if (!user) return null;
    const userId = user.id;

    // Все pending/processing файлы отсортированные по createdAt (порядок очереди)
    const queue = entries
      .filter((e) => e.status === "pending" || e.status === "processing")
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Файлы текущего пользователя в очереди
    const myFiles = queue.filter((e) => e.uploadedBy === userId);
    if (myFiles.length === 0) return null;

    // Индекс первого файла пользователя в общей очереди
    const firstMyIndex = queue.findIndex((e) => e.uploadedBy === userId);
    const filesAhead = firstMyIndex; // файлы других пользователей перед первым нашим

    const waitSec = filesAhead * AVG_PROCESS_SEC;
    const mySec = myFiles.length * AVG_PROCESS_SEC;
    const totalSec = waitSec + mySec;

    return { filesAhead, myCount: myFiles.length, waitSec, mySec, totalSec };
  }, [entries, user]);

  if (isLoading) {
    return (
      <div className="p-8 text-center text-gray-400">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        Загрузка очереди…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Очередь загрузки</h1>
          <p className="text-gray-400 text-sm mt-1">
            {activeCount > 0
              ? `Активных задач: ${activeCount} · обновляется каждые 5 сек`
              : entries.length === 0
              ? "Очередь пуста"
              : "Все задачи завершены"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {doneCount > 0 && (
            <button
              onClick={handleClearDone}
              disabled={clearingDone}
              className="px-3 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {clearingDone ? "Удаляю…" : `Убрать загруженные (${doneCount})`}
            </button>
          )}
          <button
            onClick={fetchQueue}
            className="px-3 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            Обновить
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          Ошибка загрузки: {error}
        </div>
      )}

      {estimate && (
        <div className="mb-5 p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-purple-300 text-sm font-medium">Примерное время</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            {estimate.filesAhead > 0 && (
              <div>
                <span className="text-gray-500">Впереди в очереди:</span>{" "}
                <span className="text-gray-300">{estimate.filesAhead} файл{estimate.filesAhead === 1 ? "" : estimate.filesAhead < 5 ? "а" : "ов"}</span>
                <div className="text-purple-400 text-xs mt-0.5">Ожидание: {formatEstimate(estimate.waitSec)}</div>
              </div>
            )}
            <div>
              <span className="text-gray-500">Ваших файлов:</span>{" "}
              <span className="text-gray-300">{estimate.myCount}</span>
              <div className="text-purple-400 text-xs mt-0.5">Обработка: {formatEstimate(estimate.mySec)}</div>
            </div>
            <div>
              <span className="text-gray-500">Итого:</span>{" "}
              <span className="text-white font-medium">{formatEstimate(estimate.totalSec)}</span>
            </div>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <svg className="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p>Очередь пуста</p>
          <p className="text-sm mt-1">
            Загрузите трек через{" "}
            <Link href="/library" className="text-purple-400 hover:underline">Медиатеку</Link>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((entry) => (
            <div
              key={entry.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <StatusBadge status={entry.status} />
                    {entry.position != null && (
                      <span className="text-xs text-gray-500">#{entry.position}</span>
                    )}
                    <span className="text-white font-medium truncate">{entry.title}</span>
                    {entry.artist && (
                      <span className="text-gray-400 text-sm truncate">— {entry.artist}</span>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>Добавлен: {formatTime(entry.createdAt)}</span>
                    {entry.startedAt && (
                      <span>Начат: {formatTime(entry.startedAt)}</span>
                    )}
                    {entry.finishedAt && (
                      <span>Завершён: {formatTime(entry.finishedAt)}</span>
                    )}
                    {entry.startedAt && entry.finishedAt && (
                      <span>Время: {formatDuration(entry.startedAt, entry.finishedAt)}</span>
                    )}
                  </div>

                  {entry.status === "failed" && entry.error && (
                    <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400 break-words">
                      {entry.error}
                    </div>
                  )}

                  {entry.status === "done" && entry.trackId && (
                    <div className="mt-2">
                      <Link
                        href="/"
                        className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Открыть трек
                      </Link>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {entry.status === "done" && (
                    <button
                      onClick={() => handleDelete(entry.id)}
                      disabled={deleting === entry.id}
                      className="px-3 py-1.5 text-xs bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      {deleting === entry.id ? "…" : "Убрать"}
                    </button>
                  )}
                  {entry.status === "failed" && (
                    <button
                      onClick={() => handleRetry(entry.id)}
                      disabled={retrying === entry.id}
                      className="px-3 py-1.5 text-xs bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border border-yellow-500/20 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {retrying === entry.id ? "…" : "Повторить"}
                    </button>
                  )}
                  {(entry.status === "pending" || entry.status === "failed") && (
                    <button
                      onClick={() => handleDelete(entry.id)}
                      disabled={deleting === entry.id}
                      className="px-3 py-1.5 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {deleting === entry.id ? "…" : "Удалить"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
