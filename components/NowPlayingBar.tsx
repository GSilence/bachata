"use client";

import { usePlayerStore } from "@/store/playerStore";
import { useAuthStore } from "@/store/authStore";
import { useFavoritesStore } from "@/store/favoritesStore";
import { useState, useEffect } from "react";

export default function NowPlayingBar() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const user = useAuthStore((s) => s.user);

  const isFav = useFavoritesStore((s) => s.favoriteIds.has(currentTrack?.id ?? -1));
  const toggleFav = useFavoritesStore((s) => s.toggle);
  const initFavorites = useFavoritesStore((s) => s.init);
  const resetFavorites = useFavoritesStore((s) => s.reset);

  const [showPlaylistModal, setShowPlaylistModal] = useState(false);

  // Инициализируем / сбрасываем избранное при смене пользователя
  useEffect(() => {
    if (user) {
      initFavorites();
    } else {
      resetFavorites();
    }
  }, [user, initFavorites, resetFavorites]);

  if (!currentTrack) {
    return (
      <div className="py-2 px-1 text-gray-600 text-sm">Трек не выбран</div>
    );
  }

  const title = currentTrack.metaTitle || currentTrack.title;
  const artist = currentTrack.metaArtist || currentTrack.artist;
  const album = currentTrack.metaAlbum;
  const year = currentTrack.metaYear;
  const metaParts = [artist, album, year?.toString()].filter(Boolean);

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        {/* Обложка альбома */}
        <div className="flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden bg-gray-700">
          {currentTrack.coverArtUrl ? (
            <img
              src={currentTrack.coverArtUrl}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-7 h-7 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/>
              </svg>
            </div>
          )}
        </div>

        {/* Название + мета */}
        <div className="min-w-0 flex-1">
          <div className="font-bold text-white text-[22px] leading-snug truncate" title={title}>
            {title}
          </div>
          {metaParts.length > 0 && (
            <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0 text-base text-gray-400">
              {metaParts.map((part, i) => (
                <span key={i} className="flex items-center gap-1.5 min-w-0">
                  {i > 0 && <span className="text-gray-600 leading-none select-none">·</span>}
                  <span className="truncate">{part}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Правая часть: лайк + плейлист (только для авторизованных) */}
        {user && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => currentTrack && toggleFav(currentTrack.id)}
              title={isFav ? "Убрать из избранного" : "В избранное"}
              className={`w-11 h-11 flex items-center justify-center rounded-full transition-colors ${
                isFav ? "text-pink-400" : "text-gray-600 hover:text-pink-400"
              }`}
            >
              <svg className="w-7 h-7" fill={isFav ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
              </svg>
            </button>

            <button
              onClick={() => setShowPlaylistModal(true)}
              title="Добавить в плейлист"
              className="w-11 h-11 flex items-center justify-center rounded-full text-gray-600 hover:text-purple-400 transition-colors"
            >
              <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Модальное окно: добавить в плейлист */}
      {showPlaylistModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowPlaylistModal(false)}
        >
          <div
            className="bg-gray-800 rounded-2xl p-6 w-80 shadow-2xl border border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-semibold text-lg mb-1">Добавить в плейлист</h3>
            <p className="text-gray-500 text-sm mb-5 truncate">«{title}»</p>

            {/* Список плейлистов — заглушка */}
            <div className="text-gray-500 text-sm text-center py-6 border border-dashed border-gray-700 rounded-xl mb-4">
              Плейлисты появятся здесь
            </div>

            <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-gray-600 text-gray-400 hover:border-purple-500 hover:text-purple-400 transition-colors text-sm mb-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Создать новый плейлист
            </button>

            <button
              onClick={() => setShowPlaylistModal(false)}
              className="w-full px-4 py-2 rounded-xl text-gray-500 hover:text-gray-300 text-sm transition-colors"
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </>
  );
}
