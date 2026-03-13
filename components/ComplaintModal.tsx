"use client";

import { useState } from "react";
import { useAuthStore } from "@/store/authStore";

interface ComplaintModalProps {
  trackId: number;
  trackTitle: string;
  trackArtist?: string | null;
  trackAlbum?: string | null;
  onClose: () => void;
}

export default function ComplaintModal({
  trackId,
  trackTitle,
  trackArtist,
  trackAlbum,
  onClose,
}: ComplaintModalProps) {
  const { user } = useAuthStore();
  const [reason, setReason] = useState("wrong_grid");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trackInfo = [trackTitle, trackArtist, trackAlbum]
    .filter(Boolean)
    .join(" — ");

  const handleSubmit = async () => {
    if (!message.trim()) {
      setError("Опишите проблему");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          message: message.trim(),
          trackInfo,
          trackId,
          userName: user?.name || user?.email?.split("@")[0] || "",
          userEmail: user?.email || "",
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Ошибка отправки");
        return;
      }
      setSent(true);
    } catch {
      setError("Ошибка сети");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        {sent ? (
          <>
            <div className="text-center py-4">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-green-900/50 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-white font-semibold text-lg">Жалоба отправлена</h3>
              <p className="text-gray-400 text-sm mt-1">
                Мы рассмотрим ваше обращение и уведомим вас о результате.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full mt-4 px-4 py-2.5 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
            >
              Закрыть
            </button>
          </>
        ) : (
          <>
            <h3 className="text-white font-semibold text-lg mb-1">Пожаловаться</h3>
            <p className="text-gray-500 text-sm mb-4 truncate" title={trackInfo}>
              {trackInfo}
            </p>

            {/* Reason selector */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-400 mb-1.5">Причина</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 text-sm focus:ring-2 focus:ring-purple-600 focus:border-transparent"
              >
                <option value="wrong_grid">Неверно разложенный трек</option>
                <option value="not_bachata">Это не бачата</option>
                <option value="low_quality">Низкое качество записи</option>
                <option value="other">Иное</option>
              </select>
            </div>

            {/* Message */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-400 mb-1.5">Комментарий</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Опишите, что не так с раскладом трека..."
                rows={4}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-purple-600 focus:border-transparent resize-none"
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm mb-3">{error}</p>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
              >
                Закрыть
              </button>
              <button
                onClick={handleSubmit}
                disabled={sending}
                className="flex-1 px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-500 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {sending ? "Отправка..." : "Отправить"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
