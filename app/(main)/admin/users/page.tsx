"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { isAdmin } from "@/lib/roles";
import AdminSubNav from "@/components/AdminSubNav";

interface UserRow {
  id: number;
  email: string;
  name: string | null;
  role: string;
  city: string | null;
  country: string | null;
  telegram: string | null;
  isBanned: boolean;
  bannedReason: string | null;
  createdAt: string;
}

const TABS = [
  { key: "", label: "Все" },
  { key: "admin", label: "Администраторы" },
  { key: "moderator", label: "Модераторы" },
  { key: "user", label: "Пользователи" },
];

const ROLE_BADGES: Record<string, { label: string; cls: string }> = {
  admin: { label: "Админ", cls: "bg-red-900/50 text-red-300" },
  moderator: { label: "Модератор", cls: "bg-yellow-900/50 text-yellow-300" },
  user: { label: "Пользователь", cls: "bg-gray-700 text-gray-300" },
};

export default function UsersPage() {
  const router = useRouter();
  const { user, isLoading, checkAuth } = useAuthStore();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [roleFilter, setRoleFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => { checkAuth(); }, [checkAuth]);
  useEffect(() => {
    if (!isLoading && (!user || !isAdmin(user.role))) {
      router.push("/login?redirect=/admin/users");
    }
  }, [user, isLoading, router]);

  // Debounce search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [search]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (roleFilter) params.set("role", roleFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`/api/admin/users?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setUsers(data.users);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      console.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [page, roleFilter, debouncedSearch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (isLoading || !user || !isAdmin(user.role)) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Загрузка...</div>
      </div>
    );
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "2-digit",
    });

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-6xl mx-auto">
        <AdminSubNav group="users" />
        <h1 className="text-2xl font-bold text-white mb-6">Пользователи</h1>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4 border-b border-gray-700 pb-px">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setRoleFilter(tab.key); setPage(1); }}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                roleFilter === tab.key
                  ? "bg-gray-800 text-white border-b-2 border-purple-500"
                  : "text-gray-400 hover:text-white hover:bg-gray-800/50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search + stats */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по имени или email..."
              className="w-full px-4 py-2 pl-9 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm placeholder-gray-500 focus:ring-2 focus:ring-purple-600 focus:border-transparent"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <span className="text-gray-500 text-sm">
            Найдено: {total}
          </span>
        </div>

        {/* Table */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">Имя</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Роль</th>
                  <th className="px-4 py-3 font-medium">Город</th>
                  <th className="px-4 py-3 font-medium">Telegram</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 font-medium">Регистрация</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                      Загрузка...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                      {debouncedSearch ? "Ничего не найдено" : "Пользователей нет"}
                    </td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const badge = ROLE_BADGES[u.role] || ROLE_BADGES.user;
                    return (
                      <tr key={u.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                        <td className="px-4 py-3 text-gray-500">{u.id}</td>
                        <td className="px-4 py-3 text-white">
                          {u.name || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-300 max-w-[200px] truncate" title={u.email}>
                          {u.email}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400">
                          {[u.city, u.country].filter(Boolean).join(", ") || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-400">
                          {u.telegram || "—"}
                        </td>
                        <td className="px-4 py-3">
                          {u.isBanned ? (
                            <span className="text-xs font-medium px-2 py-0.5 rounded bg-red-900/50 text-red-300" title={u.bannedReason || undefined}>
                              Заблокирован
                            </span>
                          ) : (
                            <span className="text-xs font-medium px-2 py-0.5 rounded bg-green-900/50 text-green-300">
                              Активен
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                          {formatDate(u.createdAt)}
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
