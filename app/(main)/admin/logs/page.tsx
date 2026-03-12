"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { isAdmin } from "@/lib/roles";

const EVENT_LABELS: Record<string, { label: string; color: string }> = {
  analyzer_done:             { label: "Анализ завершён",  color: "bg-blue-900/60 text-blue-300 border-blue-700" },
  mod_assigned:              { label: "Назначен",         color: "bg-indigo-900/60 text-indigo-300 border-indigo-700" },
  mod_verdict_correct:       { label: "Верно",            color: "bg-green-900/60 text-green-300 border-green-700" },
  mod_verdict_incorrect:     { label: "Не верно (1)",     color: "bg-amber-900/60 text-amber-300 border-amber-700" },
  mod_verdict_incorrect_again: { label: "Не верно (2)",   color: "bg-red-900/60 text-red-300 border-red-700" },
  rows_swapped:              { label: "Ряды свапнуты",    color: "bg-orange-900/60 text-orange-300 border-orange-700" },
  status_change:             { label: "Смена статуса",    color: "bg-purple-900/60 text-purple-300 border-purple-700" },
  track_deleted:             { label: "Удалён",           color: "bg-gray-800 text-gray-400 border-gray-600" },
  admin_released:            { label: "Освобождён",       color: "bg-cyan-900/60 text-cyan-300 border-cyan-700" },
  upload_new:                { label: "Загружен",         color: "bg-emerald-900/60 text-emerald-300 border-emerald-700" },
  upload_duplicate:          { label: "Дубликат",         color: "bg-pink-900/60 text-pink-300 border-pink-700" },
};

const ALL_EVENTS = Object.keys(EVENT_LABELS);

interface LogEntry {
  id: number;
  trackId: number | null;
  trackTitle: string | null;
  event: string;
  details: any;
  createdAt: string;
  userEmail: string | null;
}

export default function AdminLogsPage() {
  const router = useRouter();
  const { user, isLoading, checkAuth } = useAuthStore();

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [eventFilter, setEventFilter] = useState("");
  const [trackSearch, setTrackSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [period, setPeriod] = useState("");
  const [fetching, setFetching] = useState(false);

  // Дебаунс-таймеры для текстовых полей
  const trackDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { checkAuth(); }, [checkAuth]);
  useEffect(() => {
    if (!isLoading && (!user || !isAdmin(user?.role))) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  const fetchLogs = useCallback(async (
    p: number,
    ev: string,
    track: string,
    usr: string,
    per: string = "",
  ) => {
    setFetching(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: "50" });
      if (ev) params.set("event", ev);
      if (track) params.set("track", track);
      if (usr) params.set("user", usr);
      if (per) params.set("period", per);
      const res = await fetch(`/api/admin/logs?${params}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs ?? []);
        setTotal(data.total ?? 0);
        setPages(data.pages ?? 1);
      }
    } finally {
      setFetching(false);
    }
  }, []);

  // Начальная загрузка и при смене страницы / event-фильтра / периода
  useEffect(() => {
    if (isAdmin(user?.role)) fetchLogs(page, eventFilter, trackSearch, userSearch, period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, page, eventFilter, period, fetchLogs]);

  const handleEventChange = (ev: string) => {
    setEventFilter(ev);
    setPage(1);
  };

  const handleTrackSearch = (value: string) => {
    setTrackSearch(value);
    if (trackDebounce.current) clearTimeout(trackDebounce.current);
    trackDebounce.current = setTimeout(() => {
      setPage(1);
      fetchLogs(1, eventFilter, value, userSearch, period);
    }, 400);
  };

  const handleUserSearch = (value: string) => {
    setUserSearch(value);
    if (userDebounce.current) clearTimeout(userDebounce.current);
    userDebounce.current = setTimeout(() => {
      setPage(1);
      fetchLogs(1, eventFilter, trackSearch, value, period);
    }, 400);
  };

  const handlePeriodChange = (value: string) => {
    setPeriod(value);
    setPage(1);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }) + " " +
      d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  };

  const DUP_METHOD_LABELS: Record<string, string> = {
    fileHash: "по хешу файла",
    meta: "по метаданным",
    titleArtist: "по названию+исполнителю",
  };

  const formatDetails = (details: any): string => {
    if (!details) return "";
    const parts: string[] = [];
    if (details.title || details.uploadedTitle) parts.push(`«${details.title || details.uploadedTitle}»`);
    if (details.uploadedArtist) parts.push(details.uploadedArtist);
    if (details.method) parts.push(DUP_METHOD_LABELS[details.method] || details.method);
    if (details.originalName) parts.push(details.originalName);
    if (details.oldStatus && details.newStatus) parts.push(`${details.oldStatus} → ${details.newStatus}`);
    if (details.reason) parts.push(details.reason);
    if (details.email) parts.push(details.email);
    if (details.fileSize) parts.push(`${(details.fileSize / 1024 / 1024).toFixed(1)} МБ`);
    return parts.join(" · ");
  };

  return (
    <div className="min-h-screen bg-gray-950 px-4 py-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Лог событий</h1>
          <p className="text-gray-500 text-sm mt-0.5">{total} записей</p>
        </div>
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
          ← Назад
        </button>
      </div>

      {/* Фильтры */}
      <div className="mb-4 flex gap-2 flex-wrap items-center">
        <select
          value={eventFilter}
          onChange={(e) => handleEventChange(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none"
        >
          <option value="">Все события</option>
          {ALL_EVENTS.map((ev) => (
            <option key={ev} value={ev}>{EVENT_LABELS[ev]?.label ?? ev}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Поиск по треку..."
          value={trackSearch}
          onChange={(e) => handleTrackSearch(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none placeholder-gray-600 w-44"
        />
        <input
          type="text"
          placeholder="Поиск по email..."
          value={userSearch}
          onChange={(e) => handleUserSearch(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none placeholder-gray-600 w-44"
        />
        <button
          onClick={() => fetchLogs(page, eventFilter, trackSearch, userSearch, period)}
          className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
        >
          {fetching ? "..." : "↻ Обновить"}
        </button>
      </div>

      {/* Период */}
      <div className="mb-4 flex gap-1.5 flex-wrap">
        {[
          { value: "", label: "Все" },
          { value: "today", label: "Сегодня" },
          { value: "yesterday", label: "Вчера" },
          { value: "week", label: "Неделя" },
        ].map((opt) => (
          <button
            key={opt.value}
            onClick={() => handlePeriodChange(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              period === opt.value
                ? "bg-purple-600/20 text-purple-300 border border-purple-500/30"
                : "bg-gray-800/60 text-gray-400 hover:bg-gray-700 hover:text-white border border-transparent"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Таблица */}
      <div className="bg-gray-900 border border-gray-700 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="text-left px-4 py-3 font-medium">Время</th>
              <th className="text-left px-4 py-3 font-medium">Трек</th>
              <th className="text-left px-4 py-3 font-medium">Событие</th>
              <th className="text-left px-4 py-3 font-medium">Пользователь</th>
              <th className="text-left px-4 py-3 font-medium">Детали</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-gray-600 py-10">
                  {fetching ? "Загрузка..." : "Нет событий"}
                </td>
              </tr>
            )}
            {logs.map((log) => {
              const ev = EVENT_LABELS[log.event];
              return (
                <tr key={log.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(log.createdAt)}</td>
                  <td className="px-4 py-3 text-gray-200 max-w-[200px] truncate">
                    {log.trackTitle ?? <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${ev?.color ?? "bg-gray-800 text-gray-400 border-gray-600"}`}>
                      {ev?.label ?? log.event}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{log.userEmail ?? <span className="text-gray-600">system</span>}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatDetails(log.details)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Пагинация */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm disabled:opacity-40 transition-colors"
          >
            ← Назад
          </button>
          <span className="text-gray-500 text-sm">{page} / {pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page === pages}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm disabled:opacity-40 transition-colors"
          >
            Вперёд →
          </button>
        </div>
      )}
    </div>
  );
}
