"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { isAdmin } from "@/lib/roles";
import AdminSubNav from "@/components/AdminSubNav";

interface QueueItem {
  id: number;
  filename: string;
  originalName: string;
  title: string;
  artist: string | null;
  status: string;
  error: string | null;
  trackId: number | null;
  uploadedBy: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Ожидание", cls: "bg-gray-600 text-gray-300" },
  processing: { label: "Обработка", cls: "bg-amber-900/50 text-amber-200" },
  done: { label: "Готово", cls: "bg-green-900/50 text-green-200" },
  failed: { label: "Ошибка", cls: "bg-red-900/50 text-red-200" },
};

export default function UploadQueuePage() {
  const router = useRouter();
  const { user, isLoading, checkAuth } = useAuthStore();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { checkAuth(); }, [checkAuth]);
  useEffect(() => {
    if (!isLoading && (!user || !isAdmin(user.role))) {
      router.push("/login?redirect=/admin/upload-queue");
    }
  }, [user, isLoading, router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/admin/upload-queue?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setItems(data.items);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      console.error("Failed to load upload queue");
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (isLoading || !user || !isAdmin(user.role)) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Загрузка...</div>
      </div>
    );
  }

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  };

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-6xl mx-auto">
        <AdminSubNav group="library" />
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Очередь загрузки</h1>
          <button
            onClick={fetchData}
            className="px-3 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors text-sm"
          >
            Обновить
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 text-sm"
          >
            <option value="">Все статусы</option>
            <option value="pending">Ожидание</option>
            <option value="processing">Обработка</option>
            <option value="done">Готово</option>
            <option value="failed">Ошибка</option>
          </select>
          <span className="text-gray-500 text-sm">
            Всего: {total}
          </span>
        </div>

        {/* Table */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">Название</th>
                  <th className="px-4 py-3 font-medium">Исполнитель</th>
                  <th className="px-4 py-3 font-medium">Файл</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 font-medium">Загрузил</th>
                  <th className="px-4 py-3 font-medium">Создан</th>
                  <th className="px-4 py-3 font-medium">Завершён</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                      Загрузка...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                      Очередь пуста
                    </td>
                  </tr>
                ) : (
                  items.map((item) => {
                    const st = STATUS_LABELS[item.status] || STATUS_LABELS.pending;
                    return (
                      <tr key={item.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                        <td className="px-4 py-3 text-gray-500">{item.id}</td>
                        <td className="px-4 py-3 text-white max-w-[200px] truncate" title={item.title}>
                          {item.title}
                        </td>
                        <td className="px-4 py-3 text-gray-300 max-w-[150px] truncate">
                          {item.artist || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-400 max-w-[200px] truncate" title={item.originalName}>
                          {item.originalName}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${st.cls}`}>
                            {st.label}
                          </span>
                          {item.error && (
                            <p className="text-xs text-red-400 mt-1 max-w-[200px] truncate" title={item.error}>
                              {item.error}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-400">
                          {item.uploadedBy ? `#${item.uploadedBy}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                          {formatDate(item.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                          {formatDate(item.finishedAt)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40 text-sm"
            >
              ←
            </button>
            <span className="text-gray-400 text-sm">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40 text-sm"
            >
              →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
