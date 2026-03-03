"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePlayerStore } from "@/store/playerStore";
import { useAuthStore } from "@/store/authStore";
import { isAdmin } from "@/lib/roles";
import type { Track, PlaylistSortBy } from "@/types";

interface PlaylistProps {
  onTrackSelect: (track: Track) => void;
}

export default function Playlist({ onTrackSelect }: PlaylistProps) {
  const { user } = useAuthStore();
  const isAdminUser = isAdmin(user?.role);

  // ── Избранное ────────────────────────────────────────────────────────────
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [togglingFav, setTogglingFav] = useState<number | null>(null);

  const fetchFavorites = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/playlists/favorites/tracks");
      if (res.ok) {
        const data = await res.json();
        setFavoriteIds(new Set(data.trackIds ?? []));
      }
    } catch {}
  }, [user]);

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  const toggleFavorite = async (e: React.MouseEvent, trackId: number) => {
    e.stopPropagation();
    if (togglingFav === trackId) return;
    setTogglingFav(trackId);
    const isFav = favoriteIds.has(trackId);
    // Optimistic update
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(trackId); else next.add(trackId);
      return next;
    });
    try {
      if (isFav) {
        await fetch(`/api/playlists/favorites/tracks?trackId=${trackId}`, { method: "DELETE" });
      } else {
        await fetch("/api/playlists/favorites/tracks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackId }),
        });
      }
    } catch {
      // Rollback on error
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (isFav) next.add(trackId); else next.delete(trackId);
        return next;
      });
    } finally {
      setTogglingFav(null);
    }
  };
  const {
    tracks,
    currentTrack,
    playlistFilter,
    searchQuery,
    bridgeFilterWith,
    bridgeFilterWithout,
    bridgeFilterSwapped,
    setAdmin,
    statusFilterUnlistened,
    statusFilterModeration,
    statusFilterApproved,
    statusFilterPopsa,
    accentFilterOn,
    mamboFilterOn,
    playlistSortBy,
    sortDirection,
    squareSortDirection,
    dominanceBucketNeg,
    dominanceBucketLow,
    dominanceBucketHigh,
    setPlaylistFilter,
    setSearchQuery,
    setBridgeFilterWith,
    setBridgeFilterWithout,
    setBridgeFilterSwapped,
    setStatusFilterUnlistened,
    setStatusFilterModeration,
    setStatusFilterApproved,
    setStatusFilterPopsa,
    setAccentFilterOn,
    setMamboFilterOn,
    setPlaylistSortBy,
    setSortDirection,
    setSquareSortDirection,
    setDominanceBucket,
  } = usePlayerStore();

  // Синхронизируем флаг админа в store для фильтра в playNext/playPrevious
  useEffect(() => {
    setAdmin(isAdminUser);
  }, [isAdminUser, setAdmin]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);

  // Фильтрация треков
  let filteredTracks = (Array.isArray(tracks) ? tracks : []).filter((track) => {
    // Фильтр по типу
    if (playlistFilter === "free" && !track.isFree) {
      return false;
    }

    // Базовый фильтр для админа: по статусу (хотя бы один выбран, трек должен попадать в выбранные)
    if (isAdminUser) {
      const s = track.trackStatus ?? "unlistened";
      const match =
        (s === "unlistened" && statusFilterUnlistened) ||
        (s === "moderation" && statusFilterModeration) ||
        (s === "approved" && statusFilterApproved) ||
        (s === "popsa" && statusFilterPopsa);
      if (!match) return false;
    }

    // OR-фильтр: трек показывается если подходит хотя бы под один активный тег
    // hasBridges: из колонки БД, fallback на gridMap для старых записей
    const hasBridges =
      track.hasBridges ??
      (() => {
        const gm = track.gridMap;
        if (!gm) return false;
        if (Array.isArray(gm.bridges) && gm.bridges.length > 0) return true;
        const pl = Array.isArray(gm.v2LayoutPerc) ? gm.v2LayoutPerc : gm.v2Layout;
        return Array.isArray(pl) && pl.length > 1;
      })();
    // rowSwapped и rowDominancePercent теперь отдельные колонки БД
    const isSwapped = track.rowSwapped;

    const matchesBridgeWith = hasBridges && bridgeFilterWith;
    const matchesBridgeWithout = !hasBridges && bridgeFilterWithout;
    const matchesSwapped = isSwapped && bridgeFilterSwapped;
    const includeSwapped = isAdminUser && matchesSwapped;
    if (!matchesBridgeWith && !matchesBridgeWithout && !includeSwapped) return false;

    // AND-фильтр по меткам: включённая кнопка = только треки с этой меткой
    if (accentFilterOn && !track.hasAccents) return false;
    if (mamboFilterOn && !track.hasMambo) return false;

    // Фильтр по % доминирования РАЗ (только для админа, для всех треков)
    if (isAdminUser) {
      const noneSelected = !dominanceBucketNeg && !dominanceBucketLow && !dominanceBucketHigh;
      const allSelected = dominanceBucketNeg && dominanceBucketLow && dominanceBucketHigh;
      if (!noneSelected && !allSelected) {
        // Один источник: БД (track.rowDominancePercent), fallback из gridMap если обновили трек из отчёта
        const pct =
          track.rowDominancePercent ??
          (track.gridMap as { rowDominancePercent?: number } | null)?.rowDominancePercent ??
          undefined;
        if (pct == null) return false;
        const inNeg = dominanceBucketNeg && pct < 0;
        const inLow = dominanceBucketLow && pct >= 0 && pct < 5;
        const inHigh = dominanceBucketHigh && pct >= 5;
        if (!inNeg && !inLow && !inHigh) return false;
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
      if (t.hasBridges != null) return t.hasBridges;
      const pl = Array.isArray(t.gridMap?.v2LayoutPerc)
        ? t.gridMap!.v2LayoutPerc!
        : null;
      return pl != null ? pl.length > 1 : false;
    };
    const getDominance = (t: Track) =>
      t.rowDominancePercent ?? (t.gridMap as { rowDominancePercent?: number } | null)?.rowDominancePercent ?? -Infinity;
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

      {/* Админ: базовый фильтр по статусу — перед поиском */}
      {isAdminUser && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setStatusFilterUnlistened(!statusFilterUnlistened)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              statusFilterUnlistened
                ? "bg-sky-600 text-white"
                : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-300"
            }`}
            title={statusFilterUnlistened ? "Показать новые (не прослушаны)" : "Скрыть новые"}
          >
            Новые
          </button>
          <button
            type="button"
            onClick={() => setStatusFilterModeration(!statusFilterModeration)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              statusFilterModeration
                ? "bg-amber-600 text-white"
                : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-300"
            }`}
            title={statusFilterModeration ? "Показать на модерации" : "Скрыть на модерации"}
          >
            Модерация
          </button>
          <button
            type="button"
            onClick={() => setStatusFilterApproved(!statusFilterApproved)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              statusFilterApproved
                ? "bg-emerald-600 text-white"
                : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-300"
            }`}
            title={statusFilterApproved ? "Показать согласованные" : "Скрыть согласованные"}
          >
            Согласована
          </button>
          <button
            type="button"
            onClick={() => setStatusFilterPopsa(!statusFilterPopsa)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              statusFilterPopsa
                ? "bg-orange-600 text-white"
                : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-300"
            }`}
            title={statusFilterPopsa ? "Показать попсу" : "Скрыть попсу"}
          >
            Попса
          </button>
        </div>
      )}

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
        {isAdminUser && (
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
        )}
      </div>

      {/* Фильтр по % доминирования РАЗ над ПЯТЬ — только для админа */}
      {isAdminUser && bridgeFilterWithout && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-gray-400 self-center shrink-0">% РАЗ:</span>
          {(
            [
              { key: "neg", label: "−4.99% — 0" },
              { key: "low", label: "0 — 4.99%" },
              { key: "high", label: "5% — 100%" },
            ] as const
          ).map(({ key, label }) => {
            const active =
              key === "neg"
                ? dominanceBucketNeg
                : key === "low"
                  ? dominanceBucketLow
                  : dominanceBucketHigh;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setDominanceBucket(key, !active)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  active
                    ? "bg-teal-600 text-white"
                    : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-300"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Фильтр по меткам: Акценты / Мамбо — выбрано = только с меткой (AND к остальным) */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setAccentFilterOn(!accentFilterOn)}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            accentFilterOn
              ? "bg-amber-600 text-white"
              : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-300"
          }`}
          title={accentFilterOn ? "Показать только треки с акцентами" : "Не фильтровать по акцентам"}
        >
          Акценты
        </button>
        <button
          type="button"
          onClick={() => setMamboFilterOn(!mamboFilterOn)}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            mamboFilterOn
              ? "bg-rose-600 text-white"
              : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-300"
          }`}
          title={mamboFilterOn ? "Показать только треки с мамбо" : "Не фильтровать по мамбо"}
        >
          Мамбо
        </button>
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
            const pct =
              track.rowDominancePercent ??
              (track.gridMap as { rowDominancePercent?: number } | null)?.rowDominancePercent;
            const trackHasBridges =
              track.hasBridges ??
              (() => {
                const gm = track.gridMap;
                if (!gm) return false;
                if (Array.isArray((gm as { bridges?: unknown }).bridges) && (gm as { bridges: unknown[] }).bridges.length > 0) return true;
                const pl = Array.isArray((gm as { v2LayoutPerc?: unknown }).v2LayoutPerc) ? (gm as { v2LayoutPerc: unknown[] }).v2LayoutPerc : (gm as { v2Layout?: unknown }).v2Layout;
                return Array.isArray(pl) && pl.length > 1;
              })();
            const isSquare = isAdminUser && !trackHasBridges && !track.rowSwapped;
            const pctLabel =
              isSquare && pct != null
                ? ` — ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`
                : "";
            const isFav = favoriteIds.has(track.id);
            return (
              <div key={track.id} className="relative group">
                <button
                  onClick={() => onTrackSelect(track)}
                  className={`w-full text-left px-4 py-3 pr-10 rounded-lg transition-colors ${
                    isActive
                      ? "bg-purple-600 border-2 border-purple-400 hover:bg-purple-700"
                      : "bg-gray-700 border border-gray-600 hover:bg-gray-600 hover:border-purple-600"
                  }`}
                >
                  <div className="font-medium text-white">
                    {track.title}
                    {pctLabel && (
                      <span className="text-gray-400 font-normal text-xs ml-1" title="% РАЗ (для фильтра)">
                        {pctLabel}
                      </span>
                    )}
                  </div>
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

                {/* Кнопка Избранное */}
                <button
                  onClick={(e) => toggleFavorite(e, track.id)}
                  disabled={togglingFav === track.id}
                  title={isFav ? "Убрать из Избранного" : "Добавить в Избранное"}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-all ${
                    isFav
                      ? "text-pink-400 opacity-100"
                      : "text-gray-500 opacity-0 group-hover:opacity-100 hover:text-pink-400"
                  }`}
                >
                  <svg
                    className="w-4 h-4"
                    fill={isFav ? "currentColor" : "none"}
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                    />
                  </svg>
                </button>
              </div>
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
