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
    playlistSortBy,
    squareSortDirection,
    squareDominanceMin,
    squareDominanceMax,
    setPlaylistFilter,
    setSearchQuery,
    setBridgeFilterWith,
    setBridgeFilterWithout,
    setPlaylistSortBy,
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
    // TODO: 'my' и 'all' фильтры для будущей реализации

    const hasBridges = (track.gridMap?.bridges?.length ?? 0) > 0;
    if (hasBridges && !bridgeFilterWith) return false;
    if (!hasBridges && !bridgeFilterWithout) return false;

    if (!hasBridges && track.gridMap) {
      const pct = (track.gridMap as { rowDominancePercent?: number })
        .rowDominancePercent;
      if (pct != null) {
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
  const sortByMain = (list: Track[]): Track[] =>
    [...list].sort((a, b) => {
      switch (playlistSortBy) {
        case "title":
          return collator.compare(a.title, b.title) || a.id - b.id;
        case "duration": {
          const da = a.gridMap?.duration ?? 0;
          const db = b.gridMap?.duration ?? 0;
          return da !== db ? da - db : a.id - b.id;
        }
        case "date": {
          const ta = new Date(a.createdAt).getTime();
          const tb = new Date(b.createdAt).getTime();
          return tb - ta || a.id - b.id;
        }
        default:
          return a.id - b.id;
      }
    });

  let sortedTracks = sortByMain(filteredTracks);

  if (squareSortDirection !== "none") {
    const hasBridges = (t: Track) => (t.gridMap?.bridges?.length ?? 0) > 0;
    const getDominance = (t: Track) =>
      (t.gridMap as { rowDominancePercent?: number })?.rowDominancePercent ??
      -Infinity;
    const squareTracks = sortedTracks.filter((t) => !hasBridges(t));
    const bridgeTracks = sortedTracks.filter((t) => hasBridges(t));
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

      {/* Основная сортировка */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-400">Сортировка:</span>
        {(
          [
            { value: "title" as const, label: "По названию" },
            { value: "duration" as const, label: "По длительности" },
            { value: "date" as const, label: "По дате загрузки" },
          ] satisfies { value: PlaylistSortBy; label: string }[]
        ).map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setPlaylistSortBy(value)}
            className={`px-3 py-1.5 text-sm rounded transition-colors ${
              playlistSortBy === value
                ? "bg-purple-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Фильтр по мостикам */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-gray-400">Показать:</span>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={bridgeFilterWith}
            onChange={(e) => setBridgeFilterWith(e.target.checked)}
            className="rounded border-gray-500 bg-gray-700 text-purple-600 focus:ring-purple-500"
          />
          <span className="text-gray-300">С мостиками</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={bridgeFilterWithout}
            onChange={(e) => setBridgeFilterWithout(e.target.checked)}
            className="rounded border-gray-500 bg-gray-700 text-purple-600 focus:ring-purple-500"
          />
          <span className="text-gray-300">Без мостиков</span>
        </label>
      </div>

      {/* Фильтр по % доминирования РАЗ над ПЯТЬ и сортировка только для песен без мостиков */}
      <div className="space-y-2 rounded-lg bg-gray-800/50 p-3 border border-gray-700">
        <div className="text-xs text-gray-400 uppercase tracking-wide">
          % доминирования РАЗ над ПЯТЬ (отриц. = ПЯТЬ больше)
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-400">от</span>
          <input
            type="range"
            min={-100}
            max={100}
            value={squareDominanceMin}
            onChange={(e) => {
              const v = parseFloat(e.target.value) ?? -100;
              setSquareDominanceRange(v, Math.max(v, squareDominanceMax));
            }}
            className="w-24 h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-purple-600"
          />
          <span className="text-sm text-gray-300 tabular-nums w-10">
            {squareDominanceMin}%
          </span>
          <span className="text-sm text-gray-400">до</span>
          <input
            type="range"
            min={-100}
            max={100}
            value={squareDominanceMax}
            onChange={(e) => {
              const v = parseFloat(e.target.value) ?? 100;
              setSquareDominanceRange(Math.min(v, squareDominanceMin), v);
            }}
            className="w-24 h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-purple-600"
          />
          <span className="text-sm text-gray-300 tabular-nums w-10">
            {squareDominanceMax}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">
            Сортировка (только без мостиков):
          </span>
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() =>
                setSquareSortDirection(
                  squareSortDirection === "asc" ? "none" : "asc",
                )
              }
              title={
                squareSortDirection === "asc"
                  ? "Снять сортировку (клик ещё раз)"
                  : "По возрастанию % (сначала меньше)"
              }
              className={`p-1 rounded ${squareSortDirection === "asc" ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 10l7-7m0 0l7 7m-7-7v18"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() =>
                setSquareSortDirection(
                  squareSortDirection === "desc" ? "none" : "desc",
                )
              }
              title={
                squareSortDirection === "desc"
                  ? "Снять сортировку (клик ещё раз)"
                  : "По убыванию % (сначала больше)"
              }
              className={`p-1 rounded ${squareSortDirection === "desc" ? "bg-purple-600 text-white" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}
            >
              <svg
                className="w-4 h-4"
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
            </button>
          </div>
          {squareSortDirection !== "none" && (
            <span className="text-xs text-gray-500">
              песни с мостиками внизу
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500">
          Фильтр: показывать песни без мостиков с % в диапазоне от{" "}
          {squareDominanceMin}% до {squareDominanceMax}% (на сколько РАЗ больше
          ПЯТЬ: (РАЗ−ПЯТЬ)/ПЯТЬ×100). Сортировка только по песням без мостиков;
          при включении сортировки треки с мостиками уходят вниз. Снять выбор
          стрелки — без сортировки.
        </p>
      </div>

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
