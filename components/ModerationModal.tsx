"use client";

import { useState } from "react";
import { useModeratorStore } from "@/store/moderatorStore";
import { usePlayerStore } from "@/store/playerStore";

export default function ModerationModal() {
  const { showRatingModal, ratingTrackId, closeRatingModal } = useModeratorStore();
  const { playTrack, currentTrack } = usePlayerStore() as any;

  const [layoutCorrect, setLayoutCorrect] = useState<boolean | null>(null);
  const [hasMambo, setHasMambo] = useState<boolean | null>(null);
  const [hasAccents, setHasAccents] = useState<boolean | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!showRatingModal || !ratingTrackId) return null;

  const canSubmit =
    layoutCorrect !== null && hasMambo !== null && hasAccents !== null;

  const handleReplay = () => {
    if (currentTrack) {
      // Перемотка в начало и воспроизведение
      const { audioEngine } = require("@/lib/audioEngine");
      audioEngine.seek(0);
      audioEngine.play();
    }
    closeRatingModal();
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError("");
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/tracks/${ratingTrackId}/moderate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layoutCorrect, hasMambo, hasAccents }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Ошибка отправки");
        return;
      }

      // Сбрасываем состояние и закрываем
      setLayoutCorrect(null);
      setHasMambo(null);
      setHasAccents(null);
      closeRatingModal();
    } catch {
      setError("Ошибка соединения");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-white mb-1">Оценка трека</h2>
        <p className="text-gray-400 text-sm mb-6">
          Ответьте на вопросы и отправьте результат.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Вопрос 1 */}
        <Question
          label="Расклад верный?"
          value={layoutCorrect}
          onChange={setLayoutCorrect}
        />

        {/* Вопрос 2 */}
        <Question
          label="Есть Мамбо?"
          value={hasMambo}
          onChange={setHasMambo}
        />

        {/* Вопрос 3 */}
        <Question
          label="Есть Акценты?"
          value={hasAccents}
          onChange={setHasAccents}
        />

        {/* Кнопки */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleReplay}
            className="flex-1 py-3.5 bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white rounded-xl transition-colors text-sm font-medium"
          >
            Прослушать снова
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || isSubmitting}
            className="flex-1 py-3.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Отправка..." : "Отправить"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Question({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="mb-4">
      <p className="text-gray-200 text-sm font-medium mb-2">{label}</p>
      <div className="flex gap-3">
        <button
          onClick={() => onChange(true)}
          className={`flex-1 py-3 rounded-xl text-sm font-medium transition-colors ${
            value === true
              ? "bg-green-600 text-white ring-2 ring-green-400"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
          }`}
        >
          Да
        </button>
        <button
          onClick={() => onChange(false)}
          className={`flex-1 py-3 rounded-xl text-sm font-medium transition-colors ${
            value === false
              ? "bg-red-600 text-white ring-2 ring-red-400"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
          }`}
        >
          Нет
        </button>
      </div>
    </div>
  );
}
