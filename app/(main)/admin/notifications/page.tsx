"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { isAdmin } from "@/lib/roles";

interface Complaint {
  id: number;
  userId: number;
  userName: string;
  userEmail: string;
  reason: string;
  message: string;
  trackInfo: string;
  trackId: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  sent: { label: "Отправлена", cls: "bg-blue-900/50 text-blue-300 border-blue-700/50" },
  reviewing: { label: "На рассмотрении", cls: "bg-amber-900/50 text-amber-300 border-amber-700/50" },
  rejected: { label: "Отклонена", cls: "bg-red-900/50 text-red-300 border-red-700/50" },
  approved: { label: "Согласовано", cls: "bg-green-900/50 text-green-300 border-green-700/50" },
};

const STATUS_OPTIONS = [
  { value: "sent", label: "Отправлена" },
  { value: "reviewing", label: "На рассмотрении" },
  { value: "rejected", label: "Отклонена" },
  { value: "approved", label: "Согласовано" },
];

const REASON_LABELS: Record<string, string> = {
  wrong_grid: "Неверно разложенный трек",
};

export default function AdminNotificationsPage() {
  const router = useRouter();
  const { user, isLoading, checkAuth } = useAuthStore();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  useEffect(() => { checkAuth(); }, [checkAuth]);
  useEffect(() => {
    if (!isLoading && (!user || !isAdmin(user.role))) {
      router.push("/login?redirect=/admin/notifications");
    }
  }, [user, isLoading, router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/admin/complaints?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setComplaints(data.complaints ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleStatusChange = async (id: number, newStatus: string) => {
    setUpdatingId(id);
    try {
      const res = await fetch("/api/admin/complaints", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });
      if (res.ok) {
        setComplaints((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: newStatus } : c))
        );
      }
    } finally {
      setUpdatingId(null);
    }
  };

  if (isLoading || !user || !isAdmin(user.role)) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Загрузка...</div>
      </div>
    );
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">Уведомления</h1>
          <span className="text-gray-500 text-sm">Всего: {total}</span>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mb-5">
          {[{ value: "", label: "Все" }, ...STATUS_OPTIONS].map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setStatusFilter(opt.value); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                statusFilter === opt.value
                  ? "bg-purple-600/20 text-purple-300 border border-purple-500/30"
                  : "bg-gray-800/60 text-gray-400 hover:bg-gray-700 hover:text-white border border-transparent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="text-gray-500 text-center py-8">Загрузка...</div>
        ) : complaints.length === 0 ? (
          <div className="text-gray-500 text-center py-12">Нет обращений</div>
        ) : (
          <div className="space-y-3">
            {complaints.map((c) => {
              const st = STATUS_MAP[c.status] || STATUS_MAP.sent;
              const isExpanded = expandedId === c.id;

              return (
                <div
                  key={c.id}
                  className={`bg-gray-800 border rounded-xl transition-colors ${
                    isExpanded ? "border-purple-500/40" : "border-gray-700"
                  }`}
                >
                  {/* Header — clickable */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : c.id)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white text-sm font-medium truncate">
                          {c.trackInfo || "Без трека"}
                        </span>
                        <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded border ${st.cls}`}>
                          {st.label}
                        </span>
                      </div>
                      <p className="text-gray-500 text-xs mt-0.5">
                        {c.userName} ({c.userEmail}) &middot; {formatDate(c.createdAt)}
                      </p>
                    </div>
                    <svg
                      className={`w-4 h-4 text-gray-500 transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-700/50 pt-3">
                      <p className="text-gray-400 text-xs mb-2">
                        Причина: {REASON_LABELS[c.reason] || c.reason}
                      </p>
                      <p className="text-gray-200 text-sm whitespace-pre-wrap mb-4">
                        {c.message}
                      </p>

                      {/* Status change */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-gray-500 text-xs">Изменить статус:</span>
                        {STATUS_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => handleStatusChange(c.id, opt.value)}
                            disabled={updatingId === c.id || c.status === opt.value}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-40 ${
                              c.status === opt.value
                                ? "bg-purple-600 text-white"
                                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40 text-sm"
            >
              &larr;
            </button>
            <span className="text-gray-400 text-sm">{page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40 text-sm"
            >
              &rarr;
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
