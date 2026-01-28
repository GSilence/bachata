"use client";

import { useState, useEffect } from "react";
import { usePlayerStore } from "@/store/playerStore";
import { useRouter } from "next/navigation";

interface TrackInfoProps {}

export default function TrackInfo({}: TrackInfoProps) {
  const {
    currentTrack,
    setCurrentTrack,
    tracks,
    setTracks,
    stop,
    isReanalyzing,
    setReanalyzing,
  } = usePlayerStore();
  const router = useRouter();
  const [editingBpm, setEditingBpm] = useState(false);
  const [editingOffset, setEditingOffset] = useState(false);
  const [tempBpm, setTempBpm] = useState(currentTrack?.bpm.toString() || "120");
  const [tempOffset, setTempOffset] = useState(
    currentTrack?.offset.toString() || "0",
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // Обновляем временные значения при смене трека
  useEffect(() => {
    if (currentTrack) {
      setTempBpm(currentTrack.bpm.toString());
      setTempOffset(currentTrack.offset.toString());
      // Сбрасываем режимы редактирования при смене трека
      setEditingBpm(false);
      setEditingOffset(false);
    }
  }, [currentTrack]);

  if (!currentTrack) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <p className="text-gray-400 text-center">
          Выберите трек для воспроизведения
        </p>
      </div>
    );
  }

  const handleBpmChange = async (newBpm: number) => {
    if (!currentTrack) return;

    // Обновляем локально
    const updatedTrack = { ...currentTrack, bpm: newBpm };
    setCurrentTrack(updatedTrack);

    // Убраны вызовы audioEngine - упрощенный плеер не анализирует файл
    // TODO: Обновить BPM в БД через API
    console.log("BPM changed to:", newBpm);
  };

  const handleOffsetChange = async (newOffset: number) => {
    if (!currentTrack) return;

    // Обновляем локально
    const updatedTrack = { ...currentTrack, offset: newOffset };
    setCurrentTrack(updatedTrack);

    // Убраны вызовы audioEngine - упрощенный плеер не анализирует файл
    // TODO: Обновить Offset в БД через API
    console.log("Offset changed to:", newOffset);
  };

  const resetBpm = () => {
    if (currentTrack.baseBpm) {
      setTempBpm(currentTrack.baseBpm.toString());
      handleBpmChange(currentTrack.baseBpm);
    }
  };

  const resetOffset = () => {
    if (
      currentTrack.baseOffset !== null &&
      currentTrack.baseOffset !== undefined
    ) {
      setTempOffset(currentTrack.baseOffset.toString());
      handleOffsetChange(currentTrack.baseOffset);
    }
  };

  const handleDelete = async () => {
    if (!currentTrack || isDeleting) return;

    // Подтверждение удаления
    if (
      !confirm(
        `Вы уверены, что хотите удалить трек "${currentTrack.title}"? Это действие нельзя отменить.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);

    try {
      // Останавливаем воспроизведение если удаляется текущий трек
      stop();

      // Удаляем трек через API
      const response = await fetch(`/api/tracks/${currentTrack.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete track");
      }

      // Удаляем трек из списка в store
      const updatedTracks = tracks.filter((t) => t.id !== currentTrack.id);
      setTracks(updatedTracks);

      // Очищаем currentTrack если удалили текущий
      setCurrentTrack(null);

      // Обновляем страницу для перезагрузки списка треков
      router.refresh();
    } catch (error) {
      console.error("Error deleting track:", error);
      alert(
        `Ошибка при удалении трека: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReanalyze = async (analyzer: "basic" | "extended") => {
    if (!currentTrack || isReanalyzing) return;
    setReanalyzing(true);
    try {
      const res = await fetch(`/api/tracks/${currentTrack.id}/reanalyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyzer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка перезапуска анализа");
      const listRes = await fetch("/api/tracks");
      const list = await listRes.json();
      if (Array.isArray(list)) setTracks(list);
      const updated = list?.find(
        (t: { id: number }) => t.id === currentTrack.id,
      );
      if (updated) setCurrentTrack(updated);
    } catch (e) {
      console.error("Reanalyze failed:", e);
      alert(
        `Ошибка при перезапуске анализа: ${
          e instanceof Error ? e.message : "Unknown error"
        }`,
      );
    } finally {
      setReanalyzing(false);
    }
  };

  return (
    <div
      className="bg-gray-800 rounded-lg p-4 sm:p-6 border border-gray-700"
      data-component="track-info"
    >
      {/* Название и исполнитель */}
      <div className="mb-4 sm:mb-6 flex items-start justify-between gap-4">
        <div className="flex-1">
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-1">
            {currentTrack.title}
          </h2>
          {currentTrack.artist && (
            <p className="text-gray-400">{currentTrack.artist}</p>
          )}
        </div>
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Удалить трек"
          aria-label="Удалить трек"
        >
          {isDeleting ? (
            <svg
              className="w-5 h-5 animate-spin"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          ) : (
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Расклад анализа и кнопки перезапуска */}
      <div className="mb-4 sm:mb-6 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-400">Расклад:</span>
        <span className="text-sm text-white">
          {currentTrack.analyzerType === "extended"
            ? "Расширенный"
            : currentTrack.analyzerType === "basic"
              ? "Базовый"
              : "не указан"}
        </span>
        <div className="flex items-center gap-2 ml-2">
          <button
            type="button"
            onClick={() => handleReanalyze("basic")}
            disabled={isReanalyzing}
            title="Перезапустить базовый анализ (BPM/Offset)"
            className="text-xs px-2 py-1.5 rounded bg-gray-600 hover:bg-gray-500 text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-1.5 min-w-[7rem]"
          >
            {isReanalyzing ? (
              <svg
                className="w-4 h-4 animate-spin shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            ) : null}
            {isReanalyzing ? "Анализ…" : "Базовый анализ"}
          </button>
          <button
            type="button"
            onClick={() => handleReanalyze("extended")}
            disabled={isReanalyzing}
            title="Перезапустить расширенный анализ (BPM/Offset/Grid)"
            className="text-xs px-2 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-1.5 min-w-[7rem]"
          >
            {isReanalyzing ? (
              <svg
                className="w-4 h-4 animate-spin shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            ) : null}
            {isReanalyzing ? "Анализ…" : "Расширенный анализ"}
          </button>
        </div>
      </div>

      {/* Параметры */}
      <div className="space-y-2">
        {/* BPM и Offset в одну строку */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-400">BPM:</span>
            {editingBpm ? (
              <>
                <input
                  type="number"
                  value={tempBpm}
                  onChange={(e) => setTempBpm(e.target.value)}
                  onBlur={() => {
                    const bpm = parseInt(tempBpm);
                    if (!isNaN(bpm) && bpm > 0) {
                      handleBpmChange(bpm);
                    }
                    setEditingBpm(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const bpm = parseInt(tempBpm);
                      if (!isNaN(bpm) && bpm > 0) {
                        handleBpmChange(bpm);
                      }
                      setEditingBpm(false);
                    } else if (e.key === "Escape") {
                      setTempBpm(currentTrack.bpm.toString());
                      setEditingBpm(false);
                    }
                  }}
                  className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                  autoFocus
                />
                {currentTrack.baseBpm &&
                  currentTrack.baseBpm !== parseInt(tempBpm) && (
                    <button
                      onClick={resetBpm}
                      className="text-xs text-purple-400 hover:text-purple-300"
                      title="Сбросить к базовому значению"
                    >
                      ↺
                    </button>
                  )}
              </>
            ) : (
              <>
                <span className="text-white font-medium">
                  {currentTrack.bpm}
                </span>
                <button
                  onClick={() => setEditingBpm(true)}
                  className="text-xs text-purple-400 hover:text-purple-300 ml-2 px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 transition-colors hidden"
                  title="Редактировать BPM"
                >
                  ✎
                </button>
                {currentTrack.baseBpm &&
                  currentTrack.baseBpm !== currentTrack.bpm && (
                    <button
                      onClick={resetBpm}
                      className="text-xs text-purple-400 hover:text-purple-300 ml-1"
                      title="Сбросить к базовому значению"
                    >
                      ↺
                    </button>
                  )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-400">Offset:</span>
            {editingOffset ? (
              <>
                <input
                  type="number"
                  step="0.1"
                  value={tempOffset}
                  onChange={(e) => setTempOffset(e.target.value)}
                  onBlur={() => {
                    const offset = parseFloat(tempOffset);
                    if (!isNaN(offset) && offset >= 0) {
                      handleOffsetChange(offset);
                    }
                    setEditingOffset(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const offset = parseFloat(tempOffset);
                      if (!isNaN(offset) && offset >= 0) {
                        handleOffsetChange(offset);
                      }
                      setEditingOffset(false);
                    } else if (e.key === "Escape") {
                      setTempOffset(currentTrack.offset.toString());
                      setEditingOffset(false);
                    }
                  }}
                  className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                  autoFocus
                />
                {currentTrack.baseOffset !== null &&
                  currentTrack.baseOffset !== undefined &&
                  currentTrack.baseOffset !== parseFloat(tempOffset) && (
                    <button
                      onClick={resetOffset}
                      className="text-xs text-purple-400 hover:text-purple-300"
                      title="Сбросить к базовому значению"
                    >
                      ↺
                    </button>
                  )}
              </>
            ) : (
              <>
                <span className="text-white font-medium">
                  {currentTrack.offset.toFixed(2)}s
                </span>
                <button
                  onClick={() => setEditingOffset(true)}
                  className="text-xs text-purple-400 hover:text-purple-300 ml-2 px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 transition-colors hidden"
                  title="Редактировать Offset"
                >
                  ✎
                </button>
                {currentTrack.baseOffset !== null &&
                  currentTrack.baseOffset !== undefined &&
                  currentTrack.baseOffset !== currentTrack.offset && (
                    <button
                      onClick={resetOffset}
                      className="text-xs text-purple-400 hover:text-purple-300 ml-1"
                      title="Сбросить к базовому значению"
                    >
                      ↺
                    </button>
                  )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
