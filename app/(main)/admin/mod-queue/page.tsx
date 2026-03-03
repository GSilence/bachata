"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { isAdmin } from "@/lib/roles";

interface QueueEntry {
  id: number;
  trackId: number;
  status: "pending" | "assigned";
  swapCount: number;
  createdAt: string;
  assignedAt: string | null;
  staleSec: number | null;
  userEmail: string | null;
  track: { id: number; title: string; artist: string | null } | null;
}

function formatStaleSec(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}с`;
  if (sec < 3600) return `${Math.floor(sec / 60)}м ${sec % 60}с`;
  return `${Math.floor(sec / 3600)}ч ${Math.floor((sec % 3600) / 60)}м`;
}

export default function AdminModQueuePage() {
  const router = useRouter();
  const { user, isLoading, checkAuth } = useAuthStore();

  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [fetching, setFetching] = useState(false);
  const [releasing, setReleasing] = useState<number | null>(null);

  useEffect(() => { checkAuth(); }, [checkAuth]);
  useEffect(() => {
    if (!isLoading && (!user || !isAdmin(user?.role))) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  const fetchQueue = useCallback(async () => {
    setFetching(true);
    try {
      const res = await fetch("/api/admin/mod-queue", { cache: "no-store" });
      if (res.ok) setEntries(await res.json());
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin(user?.role)) fetchQueue();
  }, [user, fetchQueue]);

  const handleRelease = async (id: number) => {
    setReleasing(id);
    try {
      const res = await fetch(`/api/queue/mod/${id}/release`, { method: "POST" });
      if (res.ok) await fetchQueue();
    } finally {
      setReleasing(null);
    }
  };

  const pending = entries.filter((e) => e.status === "pending");
  const assigned = entries.filter((e) => e.status === "assigned");

  return (
    <div className="min-h-screen bg-gray-950 px-4 py-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Очередь модерации</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {pending.length} ожидают · {assigned.length} в работе
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchQueue}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
          >
            {fetching ? "..." : "↻ Обновить"}
          </button>
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-300 text-sm transition-colors">
            ← Назад
          </button>
        </div>
      </div>

      {/* В работе */}
      {assigned.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">В работе</h2>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="text-left px-4 py-3 font-medium">Трек</th>
                  <th className="text-left px-4 py-3 font-medium">Модератор</th>
                  <th className="text-left px-4 py-3 font-medium">Свап</th>
                  <th className="text-left px-4 py-3 font-medium">Время</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {assigned.map((e) => (
                  <tr key={e.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-gray-200 font-medium truncate max-w-[180px]">{e.track?.title ?? "—"}</div>
                      <div className="text-gray-500 text-xs truncate max-w-[180px]">{e.track?.artist ?? ""}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{e.userEmail ?? "—"}</td>
                    <td className="px-4 py-3">
                      {e.swapCount > 0 ? (
                        <span className="px-2 py-0.5 rounded border text-xs font-medium bg-amber-900/60 text-amber-300 border-amber-700">
                          {e.swapCount}×
                        </span>
                      ) : (
                        <span className="text-gray-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {formatStaleSec(e.staleSec)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRelease(e.id)}
                        disabled={releasing === e.id}
                        className="px-3 py-1.5 bg-gray-700 hover:bg-red-900/50 hover:text-red-300 hover:border-red-700 border border-transparent text-gray-300 rounded-lg text-xs transition-colors disabled:opacity-40"
                      >
                        {releasing === e.id ? "..." : "Забрать"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Ожидают */}
      {pending.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Ожидают</h2>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="text-left px-4 py-3 font-medium">Трек</th>
                  <th className="text-left px-4 py-3 font-medium">В очереди с</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((e) => (
                  <tr key={e.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-gray-200 font-medium truncate max-w-[260px]">{e.track?.title ?? "—"}</div>
                      <div className="text-gray-500 text-xs truncate max-w-[260px]">{e.track?.artist ?? ""}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}
                      {" "}
                      {new Date(e.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {entries.length === 0 && !fetching && (
        <div className="text-center py-20 text-gray-600">Очередь пуста</div>
      )}
    </div>
  );
}
