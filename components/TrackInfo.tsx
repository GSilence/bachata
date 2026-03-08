"use client";

import { useState, useEffect } from "react";
import { usePlayerStore } from "@/store/playerStore";
import { useAuthStore } from "@/store/authStore";
import { isAdmin } from "@/lib/roles";
import { useRouter } from "next/navigation";
import React from "react";
import type { GridMap, TrackStatus } from "@/types";
import TrackInfoAdminPanel from "./TrackInfoAdminPanel";

const TRACK_STATUS_OPTIONS: { value: TrackStatus; label: string }[] = [
  { value: "unlistened", label: "Не прослушана" },
  { value: "moderation", label: "На модерации" },
  { value: "approved", label: "Согласована" },
  { value: "popsa", label: "Попса" },
];

interface TrackInfoProps {}

export default function TrackInfo({}: TrackInfoProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const updateCurrentTrack = usePlayerStore((s) => s.updateCurrentTrack);
  const tracks = usePlayerStore((s) => s.tracks);
  const setTracks = usePlayerStore((s) => s.setTracks);
  const stop = usePlayerStore((s) => s.stop);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isReanalyzing = usePlayerStore((s) => s.isReanalyzing);
  const router = useRouter();
  const { user } = useAuthStore();
  const isAdminUser = isAdmin(user?.role);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMarkingNotPopsa, setIsMarkingNotPopsa] = useState(false);

  const handleMarkNotPopsa = async () => {
    if (!currentTrack) return;
    setIsMarkingNotPopsa(true);
    try {
      const res = await fetch(`/api/tracks/${currentTrack.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackStatus: "unlistened" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || res.statusText);
      }
      const { track } = await res.json();
      updateCurrentTrack(track);
      setTracks(tracks.map((t) => (t.id === track.id ? track : t)));
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setIsMarkingNotPopsa(false);
    }
  };

  // Admin: редактирование названия и метаданных
  const [isEditingMeta, setIsEditingMeta] = useState(false);
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaDraft, setMetaDraft] = useState({
    title: "",
    artist: "",
    metaTitle: "",
    metaArtist: "",
    metaAlbum: "",
    metaYear: "" as string,
    metaGenre: "",
    metaComment: "",
    metaTrackNum: "" as string,
  });
  const fillMetaDraft = () => {
    if (!currentTrack) return;
    setMetaDraft({
      title: currentTrack.title || "",
      artist: currentTrack.artist ?? "",
      metaTitle: currentTrack.metaTitle ?? "",
      metaArtist: currentTrack.metaArtist ?? "",
      metaAlbum: currentTrack.metaAlbum ?? "",
      metaYear: currentTrack.metaYear != null ? String(currentTrack.metaYear) : "",
      metaGenre: currentTrack.metaGenre ?? "",
      metaComment: currentTrack.metaComment ?? "",
      metaTrackNum: currentTrack.metaTrackNum != null ? String(currentTrack.metaTrackNum) : "",
    });
  };
  const handleStartEditMeta = () => {
    fillMetaDraft();
    setIsEditingMeta(true);
  };
  const handleCancelEditMeta = () => {
    setIsEditingMeta(false);
  };
  const handleSaveMeta = async () => {
    if (!currentTrack || metaSaving) return;
    setMetaSaving(true);
    try {
      const res = await fetch(`/api/tracks/${currentTrack.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: metaDraft.title.trim() || currentTrack.title,
          artist: metaDraft.artist.trim() || null,
          metaTitle: metaDraft.metaTitle.trim() || null,
          metaArtist: metaDraft.metaArtist.trim() || null,
          metaAlbum: metaDraft.metaAlbum.trim() || null,
          metaYear: metaDraft.metaYear.trim() ? parseInt(metaDraft.metaYear, 10) || null : null,
          metaGenre: metaDraft.metaGenre.trim() || null,
          metaComment: metaDraft.metaComment.trim() || null,
          metaTrackNum: metaDraft.metaTrackNum.trim() ? parseInt(metaDraft.metaTrackNum, 10) || null : null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || res.statusText);
      }
      const { track } = await res.json();
      updateCurrentTrack(track);
      const list = usePlayerStore.getState().tracks;
      setTracks(list.map((t) => (t.id === track.id ? track : t)));
      setIsEditingMeta(false);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setMetaSaving(false);
    }
  };

  // Обновляем временные значения при смене трека (для формы меты)
  useEffect(() => {
    if (currentTrack && isEditingMeta) {
      fillMetaDraft();
    }
  }, [currentTrack?.id]);

  if (!currentTrack) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <p className="text-gray-400 text-center">
          Выберите трек для воспроизведения
        </p>
      </div>
    );
  }

  const handleDelete = async () => {
    if (!currentTrack || isDeleting) return;

    if (
      !confirm(
        `Вы уверены, что хотите удалить трек "${currentTrack.title}"? Это действие нельзя отменить.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);

    try {
      stop();

      const response = await fetch(`/api/tracks/${currentTrack.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete track");
      }

      const updatedTracks = tracks.filter((t) => t.id !== currentTrack.id);
      setTracks(updatedTracks);
      setCurrentTrack(null);
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

  const refetchTracks = () => {
    fetch(`/api/tracks?pageSize=0&t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((json: any) => {
        const data = json.tracks ?? json;
        if (Array.isArray(data)) setTracks(data);
      })
      .catch(() => {});
  };

  return (
    <div
      className="bg-gray-800 rounded-lg p-4 sm:p-6 border border-gray-700"
      data-component="track-info"
    >
      {/* Название, исполнитель, год, альбом — для всех (только чтение) */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            {isAdminUser && (
              <button
                type="button"
                onClick={handleStartEditMeta}
                className="p-1.5 rounded text-amber-400 hover:text-amber-300 hover:bg-amber-900/20 transition-colors shrink-0"
                title="Редактировать название и мета"
                aria-label="Редактировать название и мета"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            )}
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-1">
              {currentTrack.title}
            </h2>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-gray-400 text-sm">
            {(currentTrack.artist || currentTrack.metaArtist) && (
              <span>{currentTrack.artist || currentTrack.metaArtist}</span>
            )}
            {currentTrack.metaYear != null && (
              <span>{currentTrack.metaYear}</span>
            )}
            {currentTrack.metaAlbum && (
              <span>{currentTrack.metaAlbum}</span>
            )}
          </div>
          {isAdminUser && (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  if (!currentTrack) return;
                  const newValue = !currentTrack.isPrimary;
                  try {
                    const res = await fetch(`/api/tracks/${currentTrack.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ isPrimary: newValue }),
                    });
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({}));
                      throw new Error(err?.error || res.statusText);
                    }
                    const { track } = await res.json();
                    updateCurrentTrack(track);
                    const list = usePlayerStore.getState().tracks;
                    setTracks(list.map((t) => (t.id === track.id ? track : t)));
                  } catch (err) {
                    console.error(err);
                    alert(err instanceof Error ? err.message : "Ошибка");
                  }
                }}
                className={`text-3xl leading-none transition-colors ${
                  currentTrack.isPrimary
                    ? "text-yellow-400 hover:text-yellow-300"
                    : "text-gray-600 hover:text-yellow-400/60"
                }`}
                title={currentTrack.isPrimary ? "Главный трек (снять)" : "Сделать главным"}
              >
                {currentTrack.isPrimary ? "\u2605" : "\u2606"}
              </button>
              <select
                  value={currentTrack.trackStatus ?? "unlistened"}
                  onChange={async (e) => {
                    const value = e.target.value as TrackStatus;
                    if (!currentTrack || value === (currentTrack.trackStatus ?? "unlistened")) return;
                    try {
                      const res = await fetch(`/api/tracks/${currentTrack.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ trackStatus: value }),
                      });
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        throw new Error(err?.error || res.statusText);
                      }
                      const { track } = await res.json();
                      updateCurrentTrack(track);
                      const list = usePlayerStore.getState().tracks;
                      setTracks(list.map((t) => (t.id === track.id ? track : t)));
                    } catch (err) {
                      console.error(err);
                      alert(err instanceof Error ? err.message : "Ошибка смены статуса");
                    }
                  }}
                  className="px-2 py-1.5 text-sm rounded bg-gray-700 border border-gray-600 text-gray-200 focus:outline-none focus:ring-1 focus:ring-purple-600 cursor-pointer"
                >
                  {TRACK_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
            </div>
          )}
        </div>
        {isAdminUser && currentTrack?.trackStatus === "popsa" && (
          <button
            onClick={handleMarkNotPopsa}
            disabled={isMarkingNotPopsa}
            className="px-2 py-1 text-xs text-orange-400 hover:text-orange-300 hover:bg-orange-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-orange-800/40"
            title="Убрать метку попса — перевести в 'Не прослушана'"
          >
            {isMarkingNotPopsa ? "…" : "Не попса"}
          </button>
        )}
        {isAdminUser && (
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
        )}
      </div>

      {/* Метаданные: для админа — форма редактирования по клику на иконку */}
      {isAdminUser && (
        <div className="mt-2 text-sm text-gray-400">
          {!isEditingMeta ? null : (
            <div className="mt-2 p-3 bg-gray-700/50 rounded-lg space-y-2 max-w-xl">
              {currentTrack.genreHint && (
                <p className="text-xs text-gray-500">Предполагаемый стиль: <span className="text-gray-300">{currentTrack.genreHint}</span></p>
              )}
              <div>
              <label className="block text-xs text-gray-500 mb-0.5">Название</label>
              <input
                type="text"
                value={metaDraft.title}
                onChange={(e) => setMetaDraft((d) => ({ ...d, title: e.target.value }))}
                className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Исполнитель</label>
              <input
                type="text"
                value={metaDraft.artist}
                onChange={(e) => setMetaDraft((d) => ({ ...d, artist: e.target.value }))}
                className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Альбом</label>
                <input
                  type="text"
                  value={metaDraft.metaAlbum}
                  onChange={(e) => setMetaDraft((d) => ({ ...d, metaAlbum: e.target.value }))}
                  className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Год</label>
                <input
                  type="text"
                  value={metaDraft.metaYear}
                  onChange={(e) => setMetaDraft((d) => ({ ...d, metaYear: e.target.value }))}
                  className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  placeholder="число"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Жанр</label>
                <input
                  type="text"
                  value={metaDraft.metaGenre}
                  onChange={(e) => setMetaDraft((d) => ({ ...d, metaGenre: e.target.value }))}
                  className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">№ в альбоме</label>
                <input
                  type="text"
                  value={metaDraft.metaTrackNum}
                  onChange={(e) => setMetaDraft((d) => ({ ...d, metaTrackNum: e.target.value }))}
                  className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-sm"
                  placeholder="число"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Комментарий</label>
              <input
                type="text"
                value={metaDraft.metaComment}
                onChange={(e) => setMetaDraft((d) => ({ ...d, metaComment: e.target.value }))}
                className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-sm"
              />
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={handleSaveMeta}
                disabled={metaSaving}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded disabled:opacity-50"
              >
                {metaSaving ? "Сохранение…" : "Сохранить"}
              </button>
              <button
                type="button"
                onClick={handleCancelEditMeta}
                disabled={metaSaving}
                className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded disabled:opacity-50"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
        </div>
      )}

      {/* Админ: анализ, счёт, бриджи — отдельный компонент */}
      {isAdminUser && (
        <TrackInfoAdminPanel
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          isReanalyzing={isReanalyzing}
          onTracksRefetch={refetchTracks}
        />
      )}
    </div>
  );
}
