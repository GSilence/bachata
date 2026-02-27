"use client";

import { useState, useEffect, useRef } from "react";
import { usePlayerStore } from "@/store/playerStore";
import type { Track, PlaylistSortBy } from "@/types";

interface PlaylistProps {
  onTrackSelect: (track: Track) => void;
}

export default function Playlist({ onTrackSelect }: PlaylistProps) {
  const {
    tracks,
    currentTrack,
    playlistFilter,
    searchQuery,
    bridgeFilterWith,
    bridgeFilterWithout,
    bridgeFilterSwapped,
    playlistSortBy,
    sortDirection,
    squareSortDirection,
    squareDominanceMin,
    squareDominanceMax,
    setPlaylistFilter,
    setSearchQuery,
    setBridgeFilterWith,
    setBridgeFilterWithout,
    setBridgeFilterSwapped,
    setPlaylistSortBy,
    setSortDirection,
    setSquareSortDirection,
    setSquareDominanceRange,
  } = usePlayerStore();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);

  // Фильтрация треков
  let filteredTracks = (Array.isArray(tracks) ? tracks : []).filter((track) => {
    // Фильтр по типу
    if (playlistFilter === "free" && !track.isFree) {
      return false;
    }

    // OR-фильтр: трек показывается если подходит хотя бы под один активный тег
    const gm = track.gridMap as Record<string, unknown> | null;
    const percLayout = Array.isArray(gm?.v2LayoutPerc)
      ? (gm!.v2LayoutPerc as unknown[])
      : null;
    const hasBridges = percLayout != null ? percLayout.length > 1 : false;
    const isSwapped = !!(gm?.rowSwapped);

    const matchesBridgeWith = hasBridges && bridgeFilterWith;
    const matchesBridgeWithout = !hasBridges && bridgeFilterWithout;
    const matchesSwapped = isSwapped && bridgeFilterSwapped;
    if (!matchesBridgeWith && !matchesBridgeWithout && !matchesSwapped) return false;

    // Фильтр по % доминирования РАЗ (только для несвапнутых треков без мостиков)
    if (!hasBridges && !isSwapped) {
      const pct = (track.gridMap as { rowDominancePercent?: number })
        ?.rowDominancePercent;
      const isNarrowed = squareDominanceMin > -100 || squareDominanceMax < 100;
      if (isNarrowed) {
        if (pct == null) return false;
        if (pct < squareDominanceMin) return false;
        if (pct > squareDominanceMax) return false;
      }
    }

    // Поиск по названию
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesTitle = track.title.toLowerCase().includes(query);
      const matchesArtist =
        track.artist?.toLowerCase().includes(query) || false;
      return matchesTitle || matchesArtist;
    }

    return true;
  });

  const collator = new Intl.Collator(undefined, {
    sensitivity: "base",
    numeric: true,
  });
  const dir = sortDirection === "desc" ? -1 : 1;
  const sortByMain = (list: Track[]): Track[] =>
    [...list].sort((a, b) => {
      switch (playlistSortBy) {
        case "title":
          return (collator.compare(a.title, b.title) || a.id - b.id) * dir;
        case "duration": {
          const da = a.gridMap?.duration ?? 0;
          const db = b.gridMap?.duration ?? 0;
          return (da !== db ? da - db : a.id - b.id) * dir;
        }
        case "date": {
          const ta = new Date(a.createdAt).getTime();
          const tb = new Date(b.createdAt).getTime();
          // asc = oldest first, desc = newest first
          return (ta !== tb ? ta - tb : a.id - b.id) * dir;
        }
        default:
          return a.id - b.id;
      }
    });

  let sortedTracks = sortByMain(filteredTracks);

  if (squareSortDirection !== "none") {
    const gmHasBridges = (t: Track) => {
      const gm = t.gridMap as Record<string, unknown> | null;
      const percLayout = Array.isArray(gm?.v2LayoutPerc)
        ? (gm!.v2LayoutPerc as unknown[])
        : null;
      return percLayout != null ? percLayout.length > 1 : false;
    };
    const getDominance = (t: Track) =>
      (t.gridMap as { rowDominancePercent?: number })?.rowDominancePercent ??
      -Infinity;
    const squareTracks = sortedTracks.filter((t) => !gmHasBridges(t));
    const bridgeTracks = sortedTracks.filter((t) => gmHasBridges(t));
    const sortedSquare =
      squareSortDirection === "desc"
        ? [...squareTracks].sort((a, b) => {
            const d = getDominance(b) - getDominance(a);
            return d !== 0 ? d : a.id - b.id;
          })
        : [...squareTracks].sort((a, b) => {
            const d = getDominance(a) - getDominance(b);
            return d !== 0 ? d : a.id - b.id;
          });
    sortedTracks = [...sortedSquare, ...bridgeTracks];
  }

  // Проверяем, есть ли прокрутка
  useEffect(() => {
    const checkScroll = () => {
      if (scrollContainerRef.current) {
        const { scrollTop, scrollHeight, clientHeight } =
          scrollContainerRef.current;
        setShowScrollIndicator(scrollTop + clientHeight < scrollHeight - 10);
      }
    };

    checkScroll();
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener("scroll", checkScroll);
      const resizeObserver = new ResizeObserver(checkScroll);
      resizeObserver.observe(container);

      return () => {
        container.removeEventListener("scroll", checkScroll);
        resizeObserver.disconnect();
      };
    }
  }, [sortedTracks]);

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
      {/* Заголовок с тарифом */}
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold text-white">Плейлист</h2>
        <span className="text-sm text-gray-600 select-none">Free</span>
      </div>

      {/* Поиск */}
      <input
        type="text"
        placeholder="Поиск по названию..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600 text-white placeholder-gray-400"
      />

      {/* Сортировка */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-400 shrink-0">Сортировка:</span>
        <select
          value={playlistSortBy}
          onChange={(e) => setPlaylistSortBy(e.target.value as PlaylistSortBy)}
          className="flex-1 px-3 py-1.5 text-sm rounded bg-gray-700 border border-gray-600 text-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-600 cursor-pointer"
        >
          <option value="title">По названию</option>
          <option value="duration">По длительности</option>
          <option value="date">По дате загрузки</option>
        </select>
        <button
          type="button"
          onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
          className="px-2 py-1.5 rounded bg-gray-700 border border-gray-600 text-gray-300 hover:bg-gray-600 transition-colors text-sm select-none"
          title={sortDirection === "asc" ? "По возрастанию" : "По убыванию"}
        >
          {sortDirection === "asc" ? "↑" : "↓"}
        </button>
      </div>

      {/* Фильтр по мостикам */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setBridgeFilterWith(!bridgeFilterWith)}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            bridgeFilterWith
              ? "bg-purple-600 text-white"
              : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-300"
          }`}
        >
          С мостиками
        </button>
        <button
          type="button"
          onClick={() => setBridgeFilterWithout(!bridgeFilterWithout)}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            bridgeFilterWithout
              ? "bg-purple-600 text-white"
              : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-300"
          }`}
        >
          Без мостиков
        </button>
        <button
          type="button"
          onClick={() => setBridgeFilterSwapped(!bridgeFilterSwapped)}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            bridgeFilterSwapped
              ? "bg-orange-600 text-white"
              : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-300"
          }`}
        >
          Свапнутые
        </button>
      </div>

      {/* Фильтр по % доминирования РАЗ над ПЯТЬ (только для треков без мостиков) */}
      {bridgeFilterWithout && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">% РАЗ над ПЯТЬ</span>
            <span className="text-xs text-gray-500 tabular-nums">
              {squareDominanceMin > -100 || squareDominanceMax < 100
                ? `${squareDominanceMin}% — ${squareDominanceMax}%`
                : "все"}
            </span>
          </div>
          <input
            type="range"
            min="-100"
            max="100"
            value={squareDominanceMin}
            onChange={(e) =>
              setSquareDominanceRange(
                Math.min(Number(e.target.value), squareDominanceMax),
                squareDominanceMax,
              )
            }
            className="w-full h-1 accent-purple-500 cursor-pointer"
            title={`Минимум: ${squareDominanceMin}%`}
          />
          <input
            type="range"
            min="-100"
            max="100"
            value={squareDominanceMax}
            onChange={(e) =>
              setSquareDominanceRange(
                squareDominanceMin,
                Math.max(Number(e.target.value), squareDominanceMin),
              )
            }
            className="w-full h-1 accent-purple-500 cursor-pointer"
            title={`Максимум: ${squareDominanceMax}%`}
          />
        </div>
      )}

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
          sortedTracks.map((track) => {
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
