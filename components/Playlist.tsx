"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { usePlayerStore } from "@/store/playerStore";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "@/store/authStore";
import { isAdmin } from "@/lib/roles";
import { useModeratorStore } from "@/store/moderatorStore";
import { useFavoritesStore } from "@/store/favoritesStore";
import { usePlaylistsStore } from "@/store/playlistsStore";
import ComplaintModal from "@/components/ComplaintModal";
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
  onSelect,
  onComplain,
  customPlaylistId,
  onRemoveFromPlaylist,
}: {
  track: Track;
  isActive: boolean;
  isAdminUser: boolean;
  onSelect: (track: Track) => void;
  onComplain: (track: Track) => void;
  customPlaylistId?: number;
  onRemoveFromPlaylist?: (trackId: number) => void;
}) {
  // Точечная подписка: только isFav этого трека — не перерисовывает остальные
  const isFav = useFavoritesStore((s) => s.favoriteIds.has(track.id));
  const toggleFav = useFavoritesStore((s) => s.toggle);

  const handleToggleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFav(track.id);
  };

  const handleComplain = (e: React.MouseEvent) => {
    e.stopPropagation();
    onComplain(track);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemoveFromPlaylist?.(track.id);
  };

  return (
    <div className="relative group">
      <button
        onClick={() => onSelect(track)}
        className={`w-full text-left px-3 py-2.5 pr-16 rounded-xl transition-colors flex items-center gap-3 ${
          isActive
            ? "bg-purple-600/30 border border-purple-500/50 hover:bg-purple-600/40"
            : "border border-transparent hover:bg-white/5"
        }`}
      >
        {/* Обложка */}
        <div className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-gray-700">
          {track.coverArtUrl ? (
            <img
              src={track.coverArtUrl}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/>
              </svg>
            </div>
          )}
        </div>

        {/* Текст */}
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-medium truncate ${isActive ? "text-white" : "text-gray-100"}`} title={track.metaTitle || track.title}>
            {track.metaTitle || track.title}
            {track.isProcessed && (
              <span className="ml-1.5 text-green-400 text-xs" title="Stems обработаны">🎵</span>
            )}
          </div>
          {(track.artist || track.metaArtist) && (
            <div className={`text-xs truncate mt-0.5 ${isActive ? "text-purple-200" : "text-gray-400"}`}>
              {track.artist || track.metaArtist}
            </div>
          )}
        </div>
      </button>

      {/* Кнопка удаления из кастомного плейлиста */}
      {customPlaylistId != null && (
        <button
          onClick={handleRemove}
          title="Убрать из плейлиста"
          className="absolute right-14 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-all text-gray-500 opacity-0 group-hover:opacity-100 hover:text-red-400"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* Кнопка Пожаловаться */}
      <button
        onClick={handleComplain}
        title="Пожаловаться"
        className="absolute right-8 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-all text-gray-500 opacity-0 group-hover:opacity-100 hover:text-amber-400"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </button>

      {/* Кнопка Избранное */}
      <button
        onClick={handleToggleFav}
        title={isFav ? "Убрать из Избранного" : "Добавить в Избранное"}
        className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-all ${
          isFav
            ? "text-pink-400 opacity-100"
            : "text-gray-500 opacity-0 group-hover:opacity-100 hover:text-pink-400"
        }`}
      >
        <svg className="w-4 h-4" fill={isFav ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
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
  activePlaylist: string;
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
  // For favorites/bookmarks tabs pass playlist= param; otherwise use filter= for isFree etc.
  if (opts.activePlaylist !== "general") {
    sp.set("playlist", opts.activePlaylist);
  } else {
    sp.set("filter", opts.playlistFilter);
  }
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

const PLAYLISTS = [
  { id: "general", name: "Общий" },
  { id: "favorites", name: "Избранное" },
  { id: "bookmarks", name: "Закладки" },
];

const SORT_LABELS: Record<string, string> = {
  title: "По названию",
  duration: "По длительности",
  date: "По дате",
};

// ── Playlist ────────────────────────────────────────────────────────────────
export default function Playlist({ onTrackSelect }: PlaylistProps) {
  const { user } = useAuthStore();
  const isAdminUser = isAdmin(user?.role);

  // ── Жалоба ──
  const [complaintTrack, setComplaintTrack] = useState<Track | null>(null);

  // ── Выбранный плейлист (в сторе, чтобы playNext/playPrev знал контекст) ──
  const activePlaylist = usePlayerStore((s) => s.activePlaylist);
  const setActivePlaylist = usePlayerStore((s) => s.setActivePlaylist);
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabsDragRef = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const hasDraggedRef = useRef(false);

  // ── Кастомные плейлисты ──
  const customPlaylists = usePlaylistsStore((s) => s.playlists);
  const fetchPlaylists = usePlaylistsStore((s) => s.fetch);
  const createPlaylist = usePlaylistsStore((s) => s.create);
  const fetchTrackIds = usePlaylistsStore((s) => s.fetchTrackIds);
  const customTrackIds = usePlaylistsStore((s) => s.trackIds);
  const removeTrackFromPl = usePlaylistsStore((s) => s.removeTrack);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newPlName, setNewPlName] = useState("");
  const [isCreatingPl, setIsCreatingPl] = useState(false);
  const createInputRef = useRef<HTMLInputElement>(null);

  // ── Попап сортировки ─────────────────────────────────────────────────────
  const [sortPopoverOpen, setSortPopoverOpen] = useState(false);
  const sortPopoverRef = useRef<HTMLDivElement>(null);

  const onTabsMouseDown = (e: React.MouseEvent) => {
    const el = tabsRef.current;
    if (!el) return;
    hasDraggedRef.current = false;
    tabsDragRef.current = { active: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft };
    el.style.cursor = "grabbing";
  };
  const onTabsMouseMove = (e: React.MouseEvent) => {
    const el = tabsRef.current;
    if (!el || !tabsDragRef.current.active) return;
    const walk = (e.pageX - el.offsetLeft) - tabsDragRef.current.startX;
    if (Math.abs(walk) > 4) hasDraggedRef.current = true;
    el.scrollLeft = tabsDragRef.current.scrollLeft - walk;
  };
  const onTabsMouseUp = () => {
    tabsDragRef.current.active = false;
    if (tabsRef.current) tabsRef.current.style.cursor = "";
  };
  const onTabsWheel = (e: React.WheelEvent) => {
    const el = tabsRef.current;
    if (!el) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY + e.deltaX;
  };

  // Закрываем попап сортировки при клике вне него
  useEffect(() => {
    if (!sortPopoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (sortPopoverRef.current && !sortPopoverRef.current.contains(e.target as Node)) {
        setSortPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sortPopoverOpen]);

  // ── Zustand — только нужные поля ─────────────────────────────────────────
  const currentTrackId = useCurrentTrackId();
  const playlistFilter = usePlaylistFilter();
  const searchQuery = useSearchQuery();
  const { bridgeFilterWith, bridgeFilterWithout, bridgeFilterSwapped } = useBridgeFilters();
  const { statusFilterUnlistened, statusFilterModeration, statusFilterApproved, statusFilterPopsa } = useStatusFilters();
  const { accentFilterOn, mamboFilterOn } = useTagFilters();
  const { playlistSortBy, sortDirection, squareSortDirection } = useSortSettings();
  const { dominanceBucketNeg, dominanceBucketLow, dominanceBucketHigh } = useDominanceBuckets();
  const isAdminMode = useModeratorStore((s) => s.isAdminMode);

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

  // Загружаем кастомные плейлисты при наличии пользователя
  useEffect(() => {
    if (user) fetchPlaylists();
  }, [user, fetchPlaylists]);

  // Загружаем ID треков при выборе кастомного плейлиста
  useEffect(() => {
    if (activePlaylist.startsWith("custom_")) {
      const plId = parseInt(activePlaylist.replace("custom_", ""), 10);
      if (plId && !customTrackIds[plId]) fetchTrackIds(plId);
    }
  }, [activePlaylist, customTrackIds, fetchTrackIds]);

  // ID кастомного плейлиста (если активен) — для кнопки удаления из плейлиста
  const activeCustomPlId = activePlaylist.startsWith("custom_")
    ? parseInt(activePlaylist.replace("custom_", ""), 10) || undefined
    : undefined;

  const handleRemoveFromPlaylist = useCallback(async (trackId: number) => {
    if (!activeCustomPlId) return;
    const ok = await removeTrackFromPl(activeCustomPlId, trackId);
    if (ok) {
      // Убираем трек из локального списка
      setTracks((prev) => prev.filter((t) => t.id !== trackId));
      setTotal((prev) => Math.max(0, prev - 1));
    }
  }, [activeCustomPlId, removeTrackFromPl]);

  const handleCreatePlaylist = async () => {
    const name = newPlName.trim();
    if (!name) return;
    setIsCreatingPl(true);
    await createPlaylist(name);
    setIsCreatingPl(false);
    setNewPlName("");
    setShowCreateInput(false);
  };

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
      activePlaylist,
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

    try {
      const res = await fetch(`/api/tracks?${params}`, { cache: "no-store" });
      if (!res.ok || version !== fetchVersionRef.current) return;

      const data = await res.json();
      if (version !== fetchVersionRef.current) return;

      const newTracks: Track[] = data.tracks ?? [];
      const newTotal: number = data.total ?? 0;

      if (append) {
        setTracks((prev) => [...prev, ...newTracks]);
      } else {
        setTracks(newTracks);
      }
      setTotal(newTotal);
      setCurrentPage(page);
      setHasMore(page * PAGE_SIZE < newTotal);

      // Sync to playerStore
      if (append) {
        const existing = usePlayerStore.getState().tracks;
        usePlayerStore.getState().setTracks([...existing, ...newTracks]);
      } else {
        usePlayerStore.getState().setTracks(newTracks);
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
    setCurrentPage(1);
    setHasMore(true);
    doFetchRef.current?.(1, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedSearch, playlistFilter, activePlaylist, isAdminUser,
    bridgeFilterWith, bridgeFilterWithout, bridgeFilterSwapped,
    statusFilterUnlistened, statusFilterModeration, statusFilterApproved, statusFilterPopsa,
    accentFilterOn, mamboFilterOn,
    dominanceBucketNeg, dominanceBucketLow, dominanceBucketHigh,
    playlistSortBy, sortDirection, squareSortDirection,
  ]);

  // Re-fetch при изменении трека (смена статуса, удаление) — с сохранением скролла
  const refetchTrigger = usePlayerStore((s) => (s as any).playlistRefetchTrigger);
  const refetchTriggerRef = useRef(refetchTrigger);
  useEffect(() => {
    if (refetchTriggerRef.current === refetchTrigger) return; // skip initial
    refetchTriggerRef.current = refetchTrigger;
    const scrollEl = scrollContainerRef.current;
    const savedScroll = scrollEl?.scrollTop ?? 0;
    // Перезапрашиваем все загруженные страницы одним запросом
    const totalLoaded = currentPage * PAGE_SIZE;
    const fetchAll = async () => {
      const version = ++fetchVersionRef.current;
      const params = buildFilterParams({
        page: 1,
        pageSize: totalLoaded,
        searchQuery: debouncedSearch,
        playlistFilter,
        activePlaylist,
        isAdmin: isAdminUser,
        bridgeFilterWith, bridgeFilterWithout, bridgeFilterSwapped,
        statusFilterUnlistened, statusFilterModeration, statusFilterApproved, statusFilterPopsa,
        accentFilterOn, mamboFilterOn,
        dominanceBucketNeg, dominanceBucketLow, dominanceBucketHigh,
        playlistSortBy, sortDirection, squareSortDirection,
      });
      try {
        const res = await fetch(`/api/tracks?${params}`, { cache: "no-store" });
        if (!res.ok || version !== fetchVersionRef.current) return;
        const data = await res.json();
        if (version !== fetchVersionRef.current) return;
        const newTracks: Track[] = data.tracks ?? [];
        setTracks(newTracks);
        setTotal(data.total ?? 0);
        setHasMore(newTracks.length < (data.total ?? 0));
        usePlayerStore.getState().setTracks(newTracks);
        // Восстанавливаем скролл
        requestAnimationFrame(() => {
          if (scrollEl) scrollEl.scrollTop = savedScroll;
        });
      } catch (err) {
        console.error("Playlist refetch error:", err);
      }
    };
    fetchAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchTrigger]);

  // Re-fetch when favoriteIds change while viewing favorites playlist
  const favoriteIds = useFavoritesStore((s) => s.favoriteIds);
  const favSizeRef = useRef(favoriteIds.size);
  useEffect(() => {
    if (favSizeRef.current === favoriteIds.size) { favSizeRef.current = favoriteIds.size; return; }
    favSizeRef.current = favoriteIds.size;
    if (activePlaylist === "favorites") {
      doFetchRef.current?.(1, false);
    }
  }, [favoriteIds, activePlaylist]);

  // Load more pages
  const loadMore = useCallback(() => {
    if (isLoading || !hasMore) return;
    doFetchRef.current?.(currentPage + 1, true);
  }, [isLoading, hasMore, currentPage]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Refs для управления авто-прокруткой
  const isUserHoveringRef = useRef(false);   // мышь над списком
  const hasInitialScrolled = useRef(false);  // уже прокрутили при загрузке
  const prevTrackIdRef = useRef<number | null>(null); // предыдущий трек

  // ── Виртуализация списка — в DOM только видимые элементы ──
  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 56,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
    // Ключ по ID трека — высоты кешируются по ключу, а не по индексу.
    // При удалении трека из середины оставшиеся сохраняют свои измеренные высоты.
    getItemKey: (index) => tracks[index]?.id ?? index,
  });

  // Авто-прокрутка к текущему треку:
  // - при загрузке страницы (один раз)
  // - при смене трека во время воспроизведения
  // НЕ прокручивает при подгрузке страниц пагинации или когда пользователь
  // держит мышь над списком.
  useEffect(() => {
    if (currentTrackId == null || tracks.length === 0) return;
    const idx = tracks.findIndex((t) => t.id === currentTrackId);
    if (idx < 0) return;

    const isTrackChange = currentTrackId !== prevTrackIdRef.current;
    const isInitial = !hasInitialScrolled.current;

    // Пагинация: tracks изменился, но трек тот же — пропускаем
    if (!isInitial && !isTrackChange) return;
    // Смена трека, но пользователь работает с плейлистом — пропускаем
    if (!isInitial && isTrackChange && isUserHoveringRef.current) return;

    prevTrackIdRef.current = currentTrackId;
    hasInitialScrolled.current = true;
    virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
  }, [currentTrackId, tracks, virtualizer]);

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
    <div className="flex flex-col h-full">
      <div
        className="shrink-0 space-y-4 pt-8 px-4 pb-4"
        style={{ backgroundColor: "rgb(var(--bg-sidebar))" }}
      >
      {/* Заголовок */}
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Треки</h2>

      {/* Поиск — самый верх */}
      <input
        type="text"
        placeholder="Найти трек..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600 text-white placeholder-gray-400"
      />

      {/* Мои плейлисты — область с фоном */}
      <div className="bg-gray-800/50 rounded-xl px-3 py-3 space-y-2">
        {user && (
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Мои плейлисты</span>
          </div>
        )}
        <div
          ref={tabsRef}
          className="flex gap-2 pb-2 overflow-x-auto select-none cursor-grab [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-700/50 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-gray-600/70"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(55,65,81,0.5) transparent" }}
          onMouseDown={onTabsMouseDown}
          onMouseMove={onTabsMouseMove}
          onMouseUp={onTabsMouseUp}
          onMouseLeave={onTabsMouseUp}
          onWheel={onTabsWheel}
        >
          {user && (
            <button
              type="button"
              onClick={() => { setShowCreateInput(true); setTimeout(() => createInputRef.current?.focus(), 50); }}
              title="Создать плейлист"
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xl text-gray-500 hover:bg-purple-600/20 hover:text-purple-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          )}
          {PLAYLISTS.map((pl) => (
            <button
              key={pl.id}
              type="button"
              onClick={() => { if (!hasDraggedRef.current) setActivePlaylist(pl.id); }}
              className={`shrink-0 px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                activePlaylist === pl.id
                  ? "bg-purple-600 text-white"
                  : "text-gray-400 hover:bg-purple-600/20 hover:text-purple-200"
              }`}
            >
              {pl.name}
            </button>
          ))}
          {user && customPlaylists.map((pl) => (
            <button
              key={`custom_${pl.id}`}
              type="button"
              onClick={() => { if (!hasDraggedRef.current) setActivePlaylist(`custom_${pl.id}`); }}
              className={`shrink-0 px-4 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                activePlaylist === `custom_${pl.id}`
                  ? "bg-purple-600 text-white"
                  : "text-gray-400 hover:bg-purple-600/20 hover:text-purple-200"
              }`}
            >
              {pl.name}
            </button>
          ))}
        </div>
        {/* Инлайн-создание плейлиста */}
        {showCreateInput && (
          <div className="flex gap-2">
            <input
              ref={createInputRef}
              type="text"
              value={newPlName}
              onChange={(e) => setNewPlName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePlaylist();
                if (e.key === "Escape") { setShowCreateInput(false); setNewPlName(""); }
              }}
              placeholder="Название плейлиста..."
              className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
            <button
              onClick={handleCreatePlaylist}
              disabled={isCreatingPl || !newPlName.trim()}
              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg transition-colors disabled:opacity-40"
            >
              {isCreatingPl ? "..." : "OK"}
            </button>
            <button
              onClick={() => { setShowCreateInput(false); setNewPlName(""); }}
              className="px-2 py-1.5 text-gray-500 hover:text-gray-300 text-sm transition-colors"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Мостики + теги (Акценты/Мамбо) — один ряд с переносом */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setBridgeFilterWith(!bridgeFilterWith)}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
            bridgeFilterWith
              ? "bg-purple-600 text-white"
              : "text-gray-400 hover:bg-purple-600/20 hover:text-purple-200"
          }`}
        >
          С мостиками
        </button>
        <button
          type="button"
          onClick={() => setBridgeFilterWithout(!bridgeFilterWithout)}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
            bridgeFilterWithout
              ? "bg-purple-600 text-white"
              : "text-gray-400 hover:bg-purple-600/20 hover:text-purple-200"
          }`}
        >
          Без мостиков
        </button>
        <button
          type="button"
          onClick={() => setAccentFilterOn(!accentFilterOn)}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
            accentFilterOn
              ? "bg-purple-600 text-white"
              : "text-gray-400 hover:bg-purple-600/20 hover:text-purple-200"
          }`}
          title={accentFilterOn ? "Показать только треки с акцентами" : "Не фильтровать по акцентам"}
        >
          Акценты
        </button>
        <button
          type="button"
          onClick={() => setMamboFilterOn(!mamboFilterOn)}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
            mamboFilterOn
              ? "bg-purple-600 text-white"
              : "text-gray-400 hover:bg-purple-600/20 hover:text-purple-200"
          }`}
          title={mamboFilterOn ? "Показать только треки с мамбо" : "Не фильтровать по мамбо"}
        >
          Мамбо
        </button>
        {isAdminUser && isAdminMode && (
          <button
            type="button"
            onClick={() => setBridgeFilterSwapped(!bridgeFilterSwapped)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
              bridgeFilterSwapped
                ? "bg-purple-600 text-white"
                : "text-gray-400 hover:bg-purple-600/20 hover:text-purple-200"
            }`}
          >
            Свапнутые
          </button>
        )}
      </div>

      {/* Админ: фильтры только в режиме администратора */}
      {isAdminUser && isAdminMode && (
        <>
          {/* Фильтр по статусу */}
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

          {/* Фильтр по % доминирования РАЗ */}
          {bridgeFilterWithout && (
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
        </>
      )}

      {/* Счётчик + сортировка — одна строка */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {tracks.length} из {total}
          {isLoading && <span className="ml-2 text-purple-400">загрузка...</span>}
        </span>
        <div className="flex items-center gap-2">
          {/* Текстовый триггер сортировки */}
          <div ref={sortPopoverRef} className="relative">
            <button
              type="button"
              onClick={() => setSortPopoverOpen((v) => !v)}
              className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
            >
              {SORT_LABELS[playlistSortBy] ?? playlistSortBy}
            </button>
            {sortPopoverOpen && (
              <div className="absolute bottom-full right-0 mb-1 bg-gray-800 border border-gray-700 rounded-xl shadow-lg overflow-hidden z-20 min-w-max">
                {Object.entries(SORT_LABELS).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => { setPlaylistSortBy(val as PlaylistSortBy); setSortPopoverOpen(false); }}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                      playlistSortBy === val
                        ? "text-white bg-purple-600"
                        : "text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Кнопка направления — одна, с двумя стрелками */}
          <button
            type="button"
            onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
            title={sortDirection === "asc" ? "По возрастанию" : "По убыванию"}
            className="p-1 hover:opacity-80 transition-opacity"
          >
            <svg width="14" height="18" viewBox="0 0 14 18" fill="none">
              {/* Стрелка вниз */}
              <path
                d="M10 9 L10 2 M7 6 L10 2 L13 6"
                stroke={sortDirection === "asc" ? "rgb(192,132,252)" : "rgb(75,85,99)"}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Стрелка вверх */}
              <path
                d="M4 9 L4 16 M1 12 L4 16 L7 12"
                stroke={sortDirection === "desc" ? "rgb(192,132,252)" : "rgb(75,85,99)"}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      </div>{/* end shrink-0 filters */}

      {/* Список треков — виртуализированный, заполняет остаток высоты */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 md:min-h-[400px] overflow-y-auto px-4 pt-4 pb-4 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-700/50 [&::-webkit-scrollbar-thumb:hover]:bg-gray-600/70"
        data-block="playlist"
        onMouseEnter={() => { isUserHoveringRef.current = true; }}
        onMouseLeave={() => { isUserHoveringRef.current = false; }}
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
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="pb-2">
                    <TrackItem
                      track={track}
                      isActive={currentTrackId === track.id}
                      isAdminUser={isAdminUser}
                      onSelect={onTrackSelect}
                      onComplain={setComplaintTrack}
                      customPlaylistId={activeCustomPlId}
                      onRemoveFromPlaylist={handleRemoveFromPlaylist}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Модалка жалобы */}
      {complaintTrack && (
        <ComplaintModal
          trackId={complaintTrack.id}
          trackTitle={complaintTrack.metaTitle || complaintTrack.title}
          trackArtist={complaintTrack.artist || complaintTrack.metaArtist}
          trackAlbum={complaintTrack.metaAlbum}
          onClose={() => setComplaintTrack(null)}
        />
      )}
    </div>
  );
}
