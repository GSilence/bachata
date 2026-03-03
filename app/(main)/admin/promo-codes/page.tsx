"use client";

import { useState, useEffect, useCallback } from "react";

interface PromoCode {
  id: number;
  code: string;
  description: string | null;
  createdAt: string;
}

export default function PromoCodesPage() {
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [description, setDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const fetchCodes = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/promo-codes");
      if (res.ok) {
        const data = await res.json();
        setCodes(data.codes ?? []);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCodes();
  }, [fetchCodes]);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const res = await fetch("/api/admin/promo-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      if (res.ok) {
        setDescription("");
        await fetchCodes();
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Удалить промокод? Действие необратимо.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/promo-codes/${id}`, { method: "DELETE" });
      if (res.ok) setCodes((prev) => prev.filter((c) => c.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopy = (id: number, code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Промокоды модераторов</h1>
        <p className="text-gray-400 text-sm mt-1">
          Одноразовые коды. При использовании регистрирующийся получает роль{" "}
          <span className="text-yellow-400">moderator</span> и код удаляется автоматически.
        </p>
      </div>

      {/* Создать новый */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Создать новый промокод</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Описание (для кого, необязательно)"
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
          />
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {isCreating ? "Создаю..." : "+ Создать"}
          </button>
        </div>
      </div>

      {/* Список кодов */}
      {isLoading ? (
        <div className="text-gray-500 text-center py-8">Загрузка...</div>
      ) : codes.length === 0 ? (
        <div className="text-gray-500 text-center py-8">
          <p>Нет промокодов</p>
          <p className="text-sm mt-1">Создайте первый промокод выше</p>
        </div>
      ) : (
        <div className="space-y-3">
          {codes.map((c) => (
            <div
              key={c.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="font-mono text-purple-300 text-sm bg-purple-900/20 px-2 py-0.5 rounded select-all">
                    {c.code}
                  </code>
                  <button
                    onClick={() => handleCopy(c.id, c.code)}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                    title="Скопировать"
                  >
                    {copied === c.id ? "✓ скопировано" : "копировать"}
                  </button>
                </div>
                {c.description && (
                  <p className="text-gray-400 text-sm mt-1">{c.description}</p>
                )}
                <p className="text-gray-600 text-xs mt-1">
                  Создан: {new Date(c.createdAt).toLocaleString("ru-RU")}
                </p>
              </div>

              <button
                onClick={() => handleDelete(c.id)}
                disabled={deletingId === c.id}
                className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/30 border border-red-800/30 rounded-lg transition-colors disabled:opacity-50 shrink-0"
              >
                {deletingId === c.id ? "..." : "Удалить"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
