"use client";

import { useState, useEffect, useRef } from "react";
import { usePlayerStore } from "@/store/playerStore";
import type { Track } from "@/types";

interface PlaylistProps {
  onTrackSelect: (track: Track) => void;
}

export default function Playlist({ onTrackSelect }: PlaylistProps) {
  const {
    tracks,
    currentTrack,
    playlistFilter,
    searchQuery,
    setPlaylistFilter,
    setSearchQuery,
  } = usePlayerStore();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);

  // Фильтрация треков
  const filteredTracks = (Array.isArray(tracks) ? tracks : []).filter(
    (track) => {
      // Фильтр по типу
      if (playlistFilter === "free" && !track.isFree) {
        return false;
      }
      // TODO: 'my' и 'all' фильтры для будущей реализации

      // Поиск по названию
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = track.title.toLowerCase().includes(query);
        const matchesArtist =
          track.artist?.toLowerCase().includes(query) || false;
        return matchesTitle || matchesArtist;
      }

      return true;
    },
  );

  // Проверяем, есть ли прокрутка
  useEffect(() => {
    const checkScroll = () => {
      if (scrollContainerRef.current) {
        const { scrollTop, scrollHeight, clientHeight } =
          scrollContainerRef.current;
        // Показываем индикатор, если есть контент ниже видимой области
        setShowScrollIndicator(scrollTop + clientHeight < scrollHeight - 10);
      }
    };

    checkScroll();
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener("scroll", checkScroll);
      // Проверяем при изменении размера или содержимого
      const resizeObserver = new ResizeObserver(checkScroll);
      resizeObserver.observe(container);

      return () => {
        container.removeEventListener("scroll", checkScroll);
        resizeObserver.disconnect();
      };
    }
  }, [filteredTracks]);

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-white">Плейлист</h2>

      {/* Фильтры */}
      <div className="flex gap-2">
        <button
          onClick={() => setPlaylistFilter("free")}
          className={`px-4 py-2 rounded transition-colors ${
            playlistFilter === "free"
              ? "bg-purple-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          Free
        </button>
        <button
          onClick={() => setPlaylistFilter("my")}
          disabled
          className="px-4 py-2 rounded bg-gray-700 text-gray-500 cursor-not-allowed"
        >
          My (Pro)
        </button>
        <button
          onClick={() => setPlaylistFilter("all")}
          disabled
          className="px-4 py-2 rounded bg-gray-700 text-gray-500 cursor-not-allowed"
        >
          All (Pro)
        </button>
      </div>

      {/* Поиск */}
      <input
        type="text"
        placeholder="Поиск по названию..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600 text-white placeholder-gray-400"
      />

      {/* Список треков */}
      <div
        ref={scrollContainerRef}
        className="space-y-2 max-h-96 overflow-y-auto scrollbar-hide relative"
        data-block="playlist"
        style={{
          scrollbarWidth: "none" /* Firefox */,
          msOverflowStyle: "none" /* IE and Edge */,
        }}
      >
        {tracks.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-400 mb-2">Плейлист пуст</p>
            <p className="text-sm text-gray-500">
              Загрузите треки в разделе "Медиатека"
            </p>
          </div>
        ) : filteredTracks.length === 0 ? (
          <p className="text-gray-400 text-center py-4">Треки не найдены</p>
        ) : (
          filteredTracks.map((track) => {
            const isActive = currentTrack?.id === track.id;
            return (
              <button
                key={track.id}
                onClick={() => onTrackSelect(track)}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? "bg-purple-600 border-2 border-purple-400 hover:bg-purple-700"
                    : "bg-gray-700 border border-gray-600 hover:bg-gray-600 hover:border-purple-600"
                }`}
              >
                <div className="font-medium text-white">{track.title}</div>
                {track.artist && (
                  <div
                    className={`text-sm ${isActive ? "text-purple-100" : "text-gray-400"}`}
                  >
                    {track.artist}
                  </div>
                )}
                {track.isProcessed && (
                  <span
                    className="text-xs text-green-400 mt-1 inline-block"
                    title="Stems обработаны"
                  >
                    🎵
                  </span>
                )}
              </button>
            );
          })
        )}

        {/* Индикатор прокрутки */}
        {showScrollIndicator && (
          <div
            onClick={scrollToBottom}
            className="sticky bottom-0 left-0 right-0 flex justify-center py-2 bg-gradient-to-t from-gray-800/90 to-transparent cursor-pointer hover:from-gray-800/95 transition-opacity"
          >
            <div className="flex flex-col items-center gap-1 text-gray-400 hover:text-purple-400 transition-colors">
              <span className="text-xs">Прокрутить вниз</span>
              <svg
                className="w-5 h-5 animate-bounce"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 14l-7 7m0 0l-7-7m7 7V3"
                />
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
