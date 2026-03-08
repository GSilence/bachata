"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { usePlayerStore } from "@/store/playerStore";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "@/store/authStore";
import { isAdmin } from "@/lib/roles";
import type { Track, PlaylistSortBy } from "@/types";

interface PlaylistProps {
  onTrackSelect: (track: Track) => void;
}

// ── Zustand selectors — подписка ТОЛЬКО на нужные поля ──────────────────────
const useCurrentTrackId = () => usePlayerStore((s) => s.currentTrack?.id ?? null);
const usePlaylistFilter = () => usePlayerStore((s) => s.playlistFilter);
const useSearchQuery = () => usePlayerStore((s) => s.searchQuery);
const useBridgeFilters = () =>
  usePlayerStore(useShallow((s) => ({
    bridgeFilterWith: s.bridgeFilterWith,
    bridgeFilterWithout: s.bridgeFilterWithout,
    bridgeFilterSwapped: s.bridgeFilterSwapped,
  })));
const useStatusFilters = () =>
  usePlayerStore(useShallow((s) => ({
    statusFilterUnlistened: s.statusFilterUnlistened,
    statusFilterModeration: s.statusFilterModeration,
    statusFilterApproved: s.statusFilterApproved,
    statusFilterPopsa: (s as any).statusFilterPopsa ?? true,
  })));
const useTagFilters = () =>
  usePlayerStore(useShallow((s) => ({
    accentFilterOn: s.accentFilterOn,
    mamboFilterOn: s.mamboFilterOn,
  })));
const useSortSettings = () =>
  usePlayerStore(useShallow((s) => ({
    playlistSortBy: s.playlistSortBy,
    sortDirection: s.sortDirection,
    squareSortDirection: s.squareSortDirection,
  })));
const useDominanceBuckets = () =>
  usePlayerStore(useShallow((s) => ({
    dominanceBucketNeg: s.dominanceBucketNeg,
    dominanceBucketLow: s.dominanceBucketLow,
    dominanceBucketHigh: s.dominanceBucketHigh,
  })));

// ── Мемоизированный элемент трека ───────────────────────────────────────────
const TrackItem = memo(function TrackItem({
  track,
  isActive,
  isAdminUser,
  isFav,
  togglingFav,
  onSelect,
  onToggleFav,
}: {
  track: Track;
  isActive: boolean;
  isAdminUser: boolean;
  isFav: boolean;
  togglingFav: boolean;
  onSelect: (track: Track) => void;
  onToggleFav: (e: React.MouseEvent, trackId: number) => void;
}) {
  const pct = track.rowDominancePercent;
  const trackHasBridges = track.hasBridges ?? false;
  const isSquare = isAdminUser && !trackHasBridges && !track.rowSwapped;
  const pctLabel =
    isSquare && pct != null
      ? ` — ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`
      : "";

  return (
    <div className="relative group">
      <button
        onClick={() => onSelect(track)}
        className={`w-full text-left px-4 py-3 pr-10 rounded-lg transition-colors ${
          isActive
            ? "bg-purple-600 border-2 border-purple-400 hover:bg-purple-700"
            : "bg-gray-700 border border-gray-600 hover:bg-gray-600 hover:border-purple-600"
        }`}
      >
        <div className="font-medium text-white">
          {track.title}
          {pctLabel && (
            <span
              className="text-gray-400 font-normal text-xs ml-1"
              title="% РАЗ (для фильтра)"
            >
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
        onClick={(e) => onToggleFav(e, track.id)}
        disabled={togglingFav}
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
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Builds URL query params from current Zustand filter state */
function buildFilterParams(opts: {
  page: number;
  pageSize: number;
  searchQuery: string;
  playlistFilter: string;
  isAdmin: boolean;
  bridgeFilterWith: boolean;
  bridgeFilterWithout: boolean;
  bridgeFilterSwapped: boolean;
  statusFilterUnlistened: boolean;
  statusFilterModeration: boolean;
  statusFilterApproved: boolean;
  statusFilterPopsa: boolean;
  accentFilterOn: boolean;
  mamboFilterOn: boolean;
  dominanceBucketNeg: boolean;
  dominanceBucketLow: boolean;
  dominanceBucketHigh: boolean;
  playlistSortBy: string;
  sortDirection: string;
  squareSortDirection: string;
}): string {
  const sp = new URLSearchParams();
  sp.set("page", String(opts.page));
  sp.set("pageSize", String(opts.pageSize));

  if (opts.searchQuery) sp.set("search", opts.searchQuery);
  sp.set("filter", opts.playlistFilter);
  sp.set("sort", opts.playlistSortBy);
  sp.set("sortDir", opts.sortDirection);
  if (opts.squareSortDirection !== "none") sp.set("squareSort", opts.squareSortDirection);

  // Bridges
  const bridges: string[] = [];
  if (opts.bridgeFilterWith) bridges.push("with");
  if (opts.bridgeFilterWithout) bridges.push("without");
  if (opts.bridgeFilterSwapped) bridges.push("swapped");
  if (bridges.length > 0 && bridges.length < 3) {
    sp.set("bridges", bridges.join(","));
  }

  // Status (admin only)
  if (opts.isAdmin) {
    const statuses: string[] = [];
    if (opts.statusFilterUnlistened) statuses.push("unlistened");
    if (opts.statusFilterModeration) statuses.push("moderation");
    if (opts.statusFilterApproved) statuses.push("approved");
    if (opts.statusFilterPopsa) statuses.push("popsa");
    if (statuses.length > 0 && statuses.length < 4) {
      sp.set("status", statuses.join(","));
    }
  }

  // Tags
  if (opts.accentFilterOn) sp.set("accents", "1");
  if (opts.mamboFilterOn) sp.set("mambo", "1");

  // Dominance
  if (opts.isAdmin) {
    const dom: string[] = [];
    if (opts.dominanceBucketNeg) dom.push("neg");
    if (opts.dominanceBucketLow) dom.push("low");
    if (opts.dominanceBucketHigh) dom.push("high");
    if (dom.length > 0 && dom.length < 3) {
      sp.set("dominance", dom.join(","));
    }
  }

  return sp.toString();
}

const PAGE_SIZE = 40;

// ── Playlist ────────────────────────────────────────────────────────────────
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

  const toggleFavorite = useCallback(async (e: React.MouseEvent, trackId: number) => {
    e.stopPropagation();
    if (togglingFav === trackId) return;
    setTogglingFav(trackId);
    const isFav = favoriteIds.has(trackId);
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
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (isFav) next.add(trackId); else next.delete(trackId);
        return next;
      });
    } finally {
      setTogglingFav(null);
    }
  }, [togglingFav, favoriteIds]);

  // ── Zustand — только нужные поля ─────────────────────────────────────────
  const currentTrackId = useCurrentTrackId();
  const playlistFilter = usePlaylistFilter();
  const searchQuery = useSearchQuery();
  const { bridgeFilterWith, bridgeFilterWithout, bridgeFilterSwapped } = useBridgeFilters();
  const { statusFilterUnlistened, statusFilterModeration, statusFilterApproved, statusFilterPopsa } = useStatusFilters();
  const { accentFilterOn, mamboFilterOn } = useTagFilters();
  const { playlistSortBy, sortDirection, squareSortDirection } = useSortSettings();
  const { dominanceBucketNeg, dominanceBucketLow, dominanceBucketHigh } = useDominanceBuckets();

  // Actions — стабильные ссылки, не вызывают ре-рендер
  const setAdmin = usePlayerStore((s) => s.setAdmin);
  const setPlaylistFilter = usePlayerStore((s) => s.setPlaylistFilter);
  const setSearchQuery = usePlayerStore((s) => s.setSearchQuery);
  const setBridgeFilterWith = usePlayerStore((s) => s.setBridgeFilterWith);
  const setBridgeFilterWithout = usePlayerStore((s) => s.setBridgeFilterWithout);
  const setBridgeFilterSwapped = usePlayerStore((s) => s.setBridgeFilterSwapped);
  const setStatusFilterUnlistened = usePlayerStore((s) => s.setStatusFilterUnlistened);
  const setStatusFilterModeration = usePlayerStore((s) => s.setStatusFilterModeration);
  const setStatusFilterApproved = usePlayerStore((s) => s.setStatusFilterApproved);
  const setStatusFilterPopsa = usePlayerStore((s) => (s as any).setStatusFilterPopsa);
  const setAccentFilterOn = usePlayerStore((s) => s.setAccentFilterOn);
  const setMamboFilterOn = usePlayerStore((s) => s.setMamboFilterOn);
  const setPlaylistSortBy = usePlayerStore((s) => s.setPlaylistSortBy);
  const setSortDirection = usePlayerStore((s) => s.setSortDirection);
  const setSquareSortDirection = usePlayerStore((s) => s.setSquareSortDirection);
  const setDominanceBucket = usePlayerStore((s) => s.setDominanceBucket);

  useEffect(() => {
    setAdmin(isAdminUser);
  }, [isAdminUser, setAdmin]);

  // ── Server-side paginated data ──────────────────────────────────────────
  const [tracks, setTracks] = useState<Track[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const fetchVersionRef = useRef(0); // For cancelling stale fetches

  // Debounced search: track the "committed" search value
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch tracks from API — ref always has latest closure values
  const doFetchRef = useRef<(page: number, append: boolean) => Promise<void>>();
  doFetchRef.current = async (page: number, append: boolean) => {
    const version = ++fetchVersionRef.current;
    setIsLoading(true);

    const params = buildFilterParams({
      page,
      pageSize: PAGE_SIZE,
      searchQuery: debouncedSearch,
      playlistFilter,
      isAdmin: isAdminUser,
      bridgeFilterWith,
      bridgeFilterWithout,
      bridgeFilterSwapped,
      statusFilterUnlistened,
      statusFilterModeration,
      statusFilterApproved,
      statusFilterPopsa,
      accentFilterOn,
      mamboFilterOn,
      dominanceBucketNeg,
      dominanceBucketLow,
      dominanceBucketHigh,
      playlistSortBy,
      sortDirection,
      squareSortDirection,
    });

    console.log("[Playlist] fetching with params:", params);

    try {
      const res = await fetch(`/api/tracks?${params}`, { cache: "no-store" });
      if (!res.ok || version !== fetchVersionRef.current) return;

      const data = await res.json();
      if (version !== fetchVersionRef.current) return;

      const newTracks: Track[] = data.tracks ?? [];
      const newTotal: number = data.total ?? 0;
      console.log("[Playlist] API response: total=", newTotal, "returned=", newTracks.length, "page=", page);

      if (append) {
        setTracks((prev) => [...prev, ...newTracks]);
      } else {
        setTracks(newTracks);
      }
      setTotal(newTotal);
      setCurrentPage(page);
      setHasMore(page * PAGE_SIZE < newTotal);

      // Sync loaded tracks to playerStore (for saved track restore, etc.)
      if (!append) {
        usePlayerStore.getState().setTracks(newTracks);
      } else {
        // Append to store too
        const existing = usePlayerStore.getState().tracks;
        usePlayerStore.getState().setTracks([...existing, ...newTracks]);
      }
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.error("Playlist fetch error:", err);
      }
    } finally {
      if (version === fetchVersionRef.current) {
        setIsLoading(false);
      }
    }
  };

  // Reset to page 1 when filters/sort change — direct deps, no useCallback indirection
  useEffect(() => {
    console.log("[Playlist] filter change → refetch page 1, accents=", accentFilterOn, "mambo=", mamboFilterOn, "bridgeWith=", bridgeFilterWith);
    setCurrentPage(1);
    setHasMore(true);
    doFetchRef.current?.(1, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedSearch, playlistFilter, isAdminUser,
    bridgeFilterWith, bridgeFilterWithout, bridgeFilterSwapped,
    statusFilterUnlistened, statusFilterModeration, statusFilterApproved, statusFilterPopsa,
    accentFilterOn, mamboFilterOn,
    dominanceBucketNeg, dominanceBucketLow, dominanceBucketHigh,
    playlistSortBy, sortDirection, squareSortDirection,
  ]);

  // Load more pages
  const loadMore = useCallback(() => {
    if (isLoading || !hasMore) return;
    doFetchRef.current?.(currentPage + 1, true);
  }, [isLoading, hasMore, currentPage]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ── Виртуализация списка — в DOM только видимые элементы ──
  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 64,
    overscan: 5,
  });

  // Infinite scroll: detect when near bottom
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      // Load more when within 200px of bottom
      if (scrollHeight - scrollTop - clientHeight < 200) {
        loadMore();
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [loadMore]);

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

      {/* Фильтр по меткам: Акценты / Мамбо */}
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

      {/* Счётчик треков */}
      <div className="text-xs text-gray-500 text-right">
        {tracks.length} из {total}
        {isLoading && <span className="ml-2 text-purple-400">загрузка...</span>}
      </div>

      {/* Список треков — виртуализированный */}
      <div
        ref={scrollContainerRef}
        className="max-h-96 overflow-y-auto scrollbar-hide relative"
        data-block="playlist"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        {total === 0 && !isLoading ? (
          tracks.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-400 mb-2">Плейлист пуст</p>
              <p className="text-sm text-gray-500">
                Загрузите треки в разделе "Медиатека"
              </p>
            </div>
          ) : (
            <p className="text-gray-400 text-center py-4">Треки не найдены</p>
          )
        ) : (
          <div
            style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const track = tracks[virtualRow.index];
              return (
                <div
                  key={track.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="pb-2">
                    <TrackItem
                      track={track}
                      isActive={currentTrackId === track.id}
                      isAdminUser={isAdminUser}
                      isFav={favoriteIds.has(track.id)}
                      togglingFav={togglingFav === track.id}
                      onSelect={onTrackSelect}
                      onToggleFav={toggleFavorite}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
