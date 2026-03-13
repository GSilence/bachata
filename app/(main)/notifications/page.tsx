"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

interface Complaint {
  id: number;
  reason: string;
  message: string;
  trackInfo: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  sent: { label: "Отправлена", cls: "bg-blue-900/50 text-blue-300" },
  reviewing: { label: "На рассмотрении", cls: "bg-amber-900/50 text-amber-300" },
  rejected: { label: "Отклонена", cls: "bg-red-900/50 text-red-300" },
  approved: { label: "Согласовано", cls: "bg-green-900/50 text-green-300" },
};

const REASON_LABELS: Record<string, string> = {
  wrong_grid: "Неверно разложенный трек",
  not_bachata: "Это не бачата",
  low_quality: "Низкое качество записи",
  other: "Иное",
};

export default function NotificationsPage() {
  const router = useRouter();
  const { user, isLoading, checkAuth } = useAuthStore();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { checkAuth(); }, [checkAuth]);
  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login?redirect=/notifications");
    }
  }, [user, isLoading, router]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/complaints");
      if (!res.ok) return;
      const data = await res.json();
      setComplaints(data.complaints ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (isLoading || !user) {
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
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6">Мои обращения</h1>

        {loading ? (
          <div className="text-gray-500 text-center py-8">Загрузка...</div>
        ) : complaints.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            <p className="text-gray-400">У вас пока нет обращений</p>
            <p className="text-gray-500 text-sm mt-1">
              Нажмите на иконку предупреждения рядом с треком, чтобы отправить жалобу
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {complaints.map((c) => {
              const st = STATUS_MAP[c.status] || STATUS_MAP.sent;
              return (
                <div
                  key={c.id}
                  className="bg-gray-800 border border-gray-700 rounded-xl p-4"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-white text-sm font-medium truncate" title={c.trackInfo}>
                        {c.trackInfo}
                      </p>
                      <p className="text-gray-500 text-xs mt-0.5">
                        {REASON_LABELS[c.reason] || c.reason}
                      </p>
                    </div>
                    <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-lg ${st.cls}`}>
                      {st.label}
                    </span>
                  </div>
                  <p className="text-gray-300 text-sm whitespace-pre-wrap">{c.message}</p>
                  <p className="text-gray-600 text-xs mt-2">{formatDate(c.createdAt)}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
