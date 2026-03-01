import { create } from "zustand";
import { persist } from "zustand/middleware";
import { audioEngine } from "@/lib/audioEngine";
import { restoreUserSettings, saveUserSettings } from "@/lib/userSettings";
import type {
  PlayerState,
  Track,
  PlayMode,
  VoiceFilter,
  VoiceLanguage,
  VoiceType,
  PlaylistFilter,
  PlaylistSortBy,
} from "@/types";

// Хранилище для persist: zustand передаёт в setItem объект { state, version }, не строку
const trackStorage = {
  getItem: (
    name: string,
  ): { state: Record<string, unknown>; version?: number } | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(name);
      if (raw == null) return null;
      return JSON.parse(raw) as {
        state: Record<string, unknown>;
        version?: number;
      };
    } catch {
      return null;
    }
  },
  setItem: (
    name: string,
    value: { state: Record<string, unknown>; version?: number },
  ): void => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(name, JSON.stringify(value));
    } catch {
      // Ignore storage errors
    }
  },
  removeItem: (name: string): void => {
    if (typeof window === "undefined") return;
    try {
      localStorage.removeItem(name);
    } catch {
      // Ignore storage errors
    }
  },
};

// Восстанавливаем настройки пользователя при инициализации
const restoredSettings = restoreUserSettings();

// Защита от повторного входа при переключении треков (onTrackEnd + playNext/playPrevious)
let transitionLock = false;
const TRANSITION_LOCK_MS = 200;

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      // Initial state - используем восстановленные настройки или значения по умолчанию
      currentTrack: null,
      tracks: [],
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      musicVolume: restoredSettings.musicVolume,
      voiceVolume: restoredSettings.voiceVolume, // Базовая громкость (реальная громкость будет увеличена на 250% в audioEngine)

      // Управление дорожками
      isStemsMode: false, // По умолчанию используем цельный файл (экономия ресурсов)
      stemsEnabled: {
        vocals: true,
        drums: true,
        bass: true,
        other: true,
      },
      stemsVolume: {
        vocals: 100,
        drums: 100,
        bass: 100,
        other: 100,
      },

      playMode: restoredSettings.playMode,
      voiceFilter: restoredSettings.voiceFilter,
      voiceLanguage: restoredSettings.voiceLanguage,
      voiceType: (restoredSettings as { voiceType?: VoiceType }).voiceType ?? "human",
      playlistFilter: "free",
      searchQuery: "",
      bridgeFilterWith: true,
      bridgeFilterWithout: true,
      bridgeFilterSwapped: true,
      isAdmin: false,
      statusFilterUnlistened: true,
      statusFilterModeration: true,
      statusFilterApproved: true,
      accentFilterOn: false,
      mamboFilterOn: false,
      squareSortDirection: "none",
      playlistSortBy: "title",
      sortDirection: "asc",
      dominanceBucketNeg: true,
      dominanceBucketLow: true,
      dominanceBucketHigh: true,
      playUntilSeconds: null,
      isReanalyzing: false,
      savedTrackId: null,

      // AudioEngine reference (kept for compatibility, but we import directly now)
      audioEngine: null,

      // Actions
      setReanalyzing: (value) => set({ isReanalyzing: value }),
      setCurrentTrack: (track) => {
        if (!track) {
          set({
            currentTrack: null,
            isPlaying: false,
            currentTime: 0,
            duration: 0,
          });
          return;
        }

        // STEP 1: IMMEDIATELY reset state to prevent stale duration from corrupting seek calculations
        // This ensures the UI renders "0:00 / 0:00" instead of using the previous track's timeline
        set({
          currentTrack: track,
          savedTrackId: track.id,
          isPlaying: false, // Don't auto-play, let play() be called explicitly
          currentTime: 0,
          duration: 0, // Will be updated when track loads
        });

        // STEP 2: Stop playback explicitly (simulates user pressing Stop button)
        audioEngine.stop();

        // STEP 3: Load the new track with stems settings
        const {
          isStemsMode,
          stemsEnabled,
          stemsVolume,
          musicVolume,
          voiceVolume,
        } = get();
        audioEngine.loadTrack(track, isStemsMode, stemsEnabled, stemsVolume);

        // STEP 4: Set volume from store
        audioEngine.setMusicVolume(musicVolume);
        audioEngine.setVoiceVolume(voiceVolume);
      },
      updateCurrentTrack: (track) => {
        // Обновляет метаданные трека без перезагрузки аудио (для бриджей, offset и т.д.)
        set({ currentTrack: track });
      },
      setTracks: (tracks) => set({ tracks }),
      setIsPlaying: (isPlaying) => {
        set({ isPlaying });
        // Sync with AudioEngine
        if (isPlaying) {
          audioEngine.play();
        } else {
          audioEngine.pause();
        }
      },
      setCurrentTime: (time) => {
        // Обновляем только состояние, НЕ вызываем seek автоматически
        // seek должен вызываться только при явном действии пользователя (клик на прогресс-баре)
        set({ currentTime: time });
      },
      setDuration: (duration) => set({ duration }),
      setMusicVolume: (volume) => {
        const clampedVolume = Math.max(0, Math.min(100, volume));
        set({ musicVolume: clampedVolume });
        // Sync with AudioEngine
        audioEngine.setMusicVolume(clampedVolume);
        // Сохраняем настройки в localStorage
        saveUserSettings({ musicVolume: clampedVolume });
      },
      setVoiceVolume: (volume) => {
        const clampedVolume = Math.max(0, Math.min(100, volume));
        set({ voiceVolume: clampedVolume });
        // Sync with AudioEngine
        audioEngine.setVoiceVolume(clampedVolume);
        // Сохраняем настройки в localStorage
        saveUserSettings({ voiceVolume: clampedVolume });
      },
      setStemsMode: (enabled) => {
        set({ isStemsMode: enabled });
        // Синхронизируем с AudioEngine
        audioEngine.setStemsMode(enabled);
      },
      setStemsEnabled: (stems) => {
        set((state) => ({
          stemsEnabled: { ...state.stemsEnabled, ...stems },
        }));
        // Синхронизируем с AudioEngine
        const { stemsEnabled: currentStems } = get();
        audioEngine.setStemsEnabled(currentStems);
      },
      setStemsVolume: (stems) => {
        set((state) => ({
          stemsVolume: {
            ...state.stemsVolume,
            ...Object.fromEntries(
              Object.entries(stems).map(([key, value]) => [
                key,
                Math.max(0, Math.min(100, value)),
              ]),
            ),
          },
        }));
        // Синхронизируем с AudioEngine
        const { stemsVolume: currentVolumes } = get();
        audioEngine.setStemsVolume(currentVolumes);
      },
      setPlayMode: (mode) => {
        set({ playMode: mode });
        // Сохраняем настройки в localStorage
        saveUserSettings({ playMode: mode });
      },
      setVoiceFilter: (filter) => {
        set({ voiceFilter: filter });
        // Синхронизируем с audioEngine
        audioEngine.setVoiceFilter(filter);
        // Сохраняем настройки в localStorage
        saveUserSettings({ voiceFilter: filter });
      },
      setVoiceLanguage: (language) => {
        set({ voiceLanguage: language });
        audioEngine.setVoiceLanguage(language);
        saveUserSettings({ voiceLanguage: language });
      },
      setVoiceType: (type) => {
        set({ voiceType: type });
        saveUserSettings({ voiceType: type });
        audioEngine.setVoiceType(type);
      },
      setPlaylistFilter: (filter) => set({ playlistFilter: filter }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setBridgeFilterWith: (value) => set({ bridgeFilterWith: value }),
      setBridgeFilterWithout: (value) => set({ bridgeFilterWithout: value }),
      setBridgeFilterSwapped: (value) => set({ bridgeFilterSwapped: value }),
      setAdmin: (value) => set({ isAdmin: value }),
      setStatusFilterUnlistened: (value) => set({ statusFilterUnlistened: value }),
      setStatusFilterModeration: (value) => set({ statusFilterModeration: value }),
      setStatusFilterApproved: (value) => set({ statusFilterApproved: value }),
      setAccentFilterOn: (value) => set({ accentFilterOn: value }),
      setMamboFilterOn: (value) => set({ mamboFilterOn: value }),
      setSquareSortDirection: (dir) => set({ squareSortDirection: dir }),
      setPlaylistSortBy: (by) => set({ playlistSortBy: by }),
      setSortDirection: (dir) => set({ sortDirection: dir }),
      setDominanceBucket: (bucket, value) => {
        if (bucket === "neg") set({ dominanceBucketNeg: value });
        else if (bucket === "low") set({ dominanceBucketLow: value });
        else set({ dominanceBucketHigh: value });
      },
      setPlayUntilSeconds: (seconds) => set({ playUntilSeconds: seconds }),
      setAudioEngine: (engine) => set({ audioEngine: engine }),

      // AudioEngine methods - call audioEngine directly
      play: () => {
        const { currentTrack } = get();
        if (currentTrack) {
          const currentTime = audioEngine.getCurrentTime();
          audioEngine.play();
          set({ isPlaying: true, currentTime: currentTime });
        }
      },
      pause: () => {
        const currentTime = audioEngine.getCurrentTime();
        audioEngine.pause();
        set({ isPlaying: false, currentTime: currentTime });
      },
      stop: () => {
        audioEngine.stop();
        set({ isPlaying: false, currentTime: 0 });
      },
      loadTrack: (track) => {
        // Use setCurrentTrack which includes the mandatory Stop logic
        const { setCurrentTrack } = get();
        setCurrentTrack(track);
      },
      seek: (time) => {
        set({ currentTime: time });
        audioEngine.seek(time);
      },

      playNext: () => {
        if (transitionLock) return;
        transitionLock = true;
        const releaseLock = () => {
          setTimeout(() => {
            transitionLock = false;
          }, TRANSITION_LOCK_MS);
        };
        try {
          const {
            currentTrack,
            tracks,
            playMode,
            playlistFilter,
            searchQuery,
            bridgeFilterWith,
            bridgeFilterWithout,
            bridgeFilterSwapped,
            isAdmin,
            statusFilterUnlistened,
            statusFilterModeration,
            statusFilterApproved,
            accentFilterOn,
            mamboFilterOn,
            dominanceBucketNeg,
            dominanceBucketLow,
            dominanceBucketHigh,
            isPlaying,
          } = get();
          if (!currentTrack || tracks.length === 0) {
            releaseLock();
            return;
          }

          // STEP 1: Save playing state before switching (for auto-play after track loads)
          const wasPlaying = isPlaying;

          // STEP 2: Set isPlaying to false BEFORE switching tracks
          // This prevents double audio and ensures clean state
          set({ isPlaying: false });

          // Фильтруем треки по тем же правилам, что и в плейлисте
          const filteredTracks = tracks.filter((track) => {
            // Фильтр по типу
            if (playlistFilter === "free" && !track.isFree) {
              return false;
            }
            // TODO: 'my' и 'all' фильтры для будущей реализации

            // Базовый фильтр для админа: по статусу (хотя бы один выбран, трек должен попадать в выбранные)
            if (isAdmin) {
              const s = track.trackStatus ?? "unlistened";
              const match =
                (s === "unlistened" && statusFilterUnlistened) ||
                (s === "moderation" && statusFilterModeration) ||
                (s === "approved" && statusFilterApproved);
              if (!match) return false;
            }

            // OR-фильтр: трек показывается если подходит хотя бы под один активный тег
            const isSwapped = track.rowSwapped; // колонка БД
            const hasBridges =
              track.hasBridges ??
              (Array.isArray(track.gridMap?.v2LayoutPerc)
                ? (track.gridMap!.v2LayoutPerc!.length > 1)
                : Array.isArray(track.gridMap?.bridges) && track.gridMap!.bridges!.length > 0);
            const matchesBridgeWith = hasBridges && bridgeFilterWith;
            const matchesBridgeWithout = !hasBridges && bridgeFilterWithout;
            const matchesSwapped = isSwapped && bridgeFilterSwapped;
            if (!matchesBridgeWith && !matchesBridgeWithout && !matchesSwapped) return false;

            // AND-фильтр по меткам: если кнопка включена — только треки с этой меткой
            if (accentFilterOn && !track.hasAccents) return false;
            if (mamboFilterOn && !track.hasMambo) return false;

            // Квадратные: фильтр по bucket'ам % доминирования (для всех треков)
            const noneSelected = !dominanceBucketNeg && !dominanceBucketLow && !dominanceBucketHigh;
            const allSelected = dominanceBucketNeg && dominanceBucketLow && dominanceBucketHigh;
            if (!noneSelected && !allSelected) {
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

            // Поиск по названию
            if (searchQuery) {
              const query = searchQuery.toLowerCase();
              const matchesTitle = track.title.toLowerCase().includes(query);
              const matchesArtist =
                track.artist?.toLowerCase().includes(query) || false;
              if (!matchesTitle && !matchesArtist) {
                return false;
              }
            }

            return true;
          });

          const playlistSortBy = get().playlistSortBy;
          const sortDirection = get().sortDirection;
          const squareSortDirection = get().squareSortDirection;

          const sortByMain = (list: Track[]): Track[] => {
            const collator = new Intl.Collator(undefined, {
              sensitivity: "base",
              numeric: true,
            });
            const dir = sortDirection === "desc" ? -1 : 1;
            return [...list].sort((a, b) => {
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
                  return (ta !== tb ? ta - tb : a.id - b.id) * dir;
                }
                default:
                  return a.id - b.id;
              }
            });
          };

          const baseSorted = sortByMain(filteredTracks);
          const sortedForPlay =
            squareSortDirection === "none"
              ? baseSorted
              : (() => {
                  const tHasBridges = (t: Track) =>
                    t.hasBridges ??
                    (Array.isArray(t.gridMap?.v2LayoutPerc)
                      ? t.gridMap!.v2LayoutPerc!.length > 1
                      : Array.isArray(t.gridMap?.bridges) && (t.gridMap!.bridges!.length > 0));
                  const getDominance = (t: Track) =>
                    t.rowDominancePercent ?? (t.gridMap as { rowDominancePercent?: number } | null)?.rowDominancePercent ?? -Infinity;
                  const squareTracks = baseSorted.filter((t) => !tHasBridges(t));
                  const bridgeTracks = baseSorted.filter((t) => tHasBridges(t));
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
                  return [...sortedSquare, ...bridgeTracks];
                })();

          if (sortedForPlay.length === 0) return;

          const currentIndex = sortedForPlay.findIndex(
            (t) => t.id === currentTrack.id,
          );

          let nextTrack: Track | null = null;

          if (playMode === "random") {
            let randomIndex = Math.floor(Math.random() * sortedForPlay.length);
            // Если только один трек, не выбираем его снова
            if (sortedForPlay.length > 1 && randomIndex === currentIndex) {
              randomIndex = (randomIndex + 1) % sortedForPlay.length;
            }
            nextTrack = sortedForPlay[randomIndex];
            console.log(
              `Random: selected index=${randomIndex}, track=${nextTrack?.title} (id=${nextTrack?.id})`,
            );
          } else if (playMode === "loop") {
            // Остаемся на том же треке - перезагружаем его
            console.log(
              `Loop: restarting track=${currentTrack.title} (id=${currentTrack.id})`,
            );
            nextTrack = currentTrack;
          } else {
            // sequential
            if (currentIndex === -1) {
              // Текущий трек не найден в отфильтрованном списке - выбираем первый
              console.warn(
                "Current track not found in filtered list, selecting first track",
              );
              if (sortedForPlay.length > 0) {
                nextTrack = sortedForPlay[0];
              }
            } else {
              const nextIndex = (currentIndex + 1) % sortedForPlay.length;
              nextTrack = sortedForPlay[nextIndex];
              console.log(
                `Sequential: currentIndex=${currentIndex}, nextIndex=${nextIndex}, total=${sortedForPlay.length}`,
              );
              console.log(
                `Sequential: currentTrack=${currentTrack.title} (id=${currentTrack.id}), nextTrack=${nextTrack?.title} (id=${nextTrack?.id})`,
              );
            }
          }

          // STEP 3: Use setCurrentTrack which includes mandatory Stop logic
          if (nextTrack) {
            const { setCurrentTrack, play } = get();
            setCurrentTrack(nextTrack);
            if (wasPlaying) {
              // Запуск по загрузке трека — без задержки, чтобы не терять аудиофокус на мобильных
              audioEngine.setOnTrackLoaded(() => {
                const g = get();
                if (g.currentTrack?.id === nextTrack.id) {
                  play();
                }
                audioEngine.setOnTrackLoaded(null);
              });
            }
          } else {
            console.warn("playNext: No next track found");
          }
        } finally {
          releaseLock();
        }
      },

      playPrevious: () => {
        if (transitionLock) return;
        transitionLock = true;
        const releaseLock = () => {
          setTimeout(() => {
            transitionLock = false;
          }, TRANSITION_LOCK_MS);
        };
        try {
          const {
            currentTrack,
            tracks,
            playMode,
            isPlaying,
            playlistFilter,
            searchQuery,
            bridgeFilterWith,
            bridgeFilterWithout,
            bridgeFilterSwapped,
            isAdmin,
            statusFilterUnlistened,
            statusFilterModeration,
            statusFilterApproved,
            accentFilterOn,
            mamboFilterOn,
            dominanceBucketNeg,
            dominanceBucketLow,
            dominanceBucketHigh,
          } = get();
          if (!currentTrack || tracks.length === 0) {
            releaseLock();
            return;
          }

          const wasPlaying = isPlaying;
          set({ isPlaying: false });

          const filteredTracks = tracks.filter((track) => {
            if (playlistFilter === "free" && !track.isFree) return false;
            if (isAdmin) {
              const s = track.trackStatus ?? "unlistened";
              const match =
                (s === "unlistened" && statusFilterUnlistened) ||
                (s === "moderation" && statusFilterModeration) ||
                (s === "approved" && statusFilterApproved);
              if (!match) return false;
            }
            const isSwapped = track.rowSwapped; // колонка БД
            const hasBridges =
              track.hasBridges ??
              (Array.isArray(track.gridMap?.v2LayoutPerc)
                ? (track.gridMap!.v2LayoutPerc!.length > 1)
                : Array.isArray(track.gridMap?.bridges) && track.gridMap!.bridges!.length > 0);
            const matchesBridgeWith = hasBridges && bridgeFilterWith;
            const matchesBridgeWithout = !hasBridges && bridgeFilterWithout;
            const matchesSwapped = isSwapped && bridgeFilterSwapped;
            if (!matchesBridgeWith && !matchesBridgeWithout && !matchesSwapped) return false;
            if (accentFilterOn && !track.hasAccents) return false;
            if (mamboFilterOn && !track.hasMambo) return false;
            const noneSelected = !dominanceBucketNeg && !dominanceBucketLow && !dominanceBucketHigh;
            const allSelected = dominanceBucketNeg && dominanceBucketLow && dominanceBucketHigh;
            if (!noneSelected && !allSelected) {
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
            if (searchQuery) {
              const q = searchQuery.toLowerCase();
              const ok =
                track.title.toLowerCase().includes(q) ||
                (track.artist?.toLowerCase().includes(q) ?? false);
              if (!ok) return false;
            }
            return true;
          });

          const playlistSortBy = get().playlistSortBy;
          const sortDirection = get().sortDirection;
          const squareSortDirection = get().squareSortDirection;
          const collator = new Intl.Collator(undefined, {
            sensitivity: "base",
            numeric: true,
          });
          const sortByMain = (list: Track[]): Track[] => {
            const dir = sortDirection === "desc" ? -1 : 1;
            return [...list].sort((a, b) => {
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
                  return (ta !== tb ? ta - tb : a.id - b.id) * dir;
                }
                default:
                  return a.id - b.id;
              }
            });
          };
          const baseSorted = sortByMain(filteredTracks);
          const sortedForPlay =
            squareSortDirection === "none"
              ? baseSorted
              : (() => {
                  const tHasBridges = (t: Track) =>
                    t.hasBridges ??
                    (Array.isArray(t.gridMap?.v2LayoutPerc)
                      ? t.gridMap!.v2LayoutPerc!.length > 1
                      : Array.isArray(t.gridMap?.bridges) && (t.gridMap!.bridges!.length > 0));
                  const getDominance = (t: Track) =>
                    t.rowDominancePercent ?? (t.gridMap as { rowDominancePercent?: number } | null)?.rowDominancePercent ?? -Infinity;
                  const squareTracks = baseSorted.filter((t) => !tHasBridges(t));
                  const bridgeTracks = baseSorted.filter((t) => tHasBridges(t));
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
                  return [...sortedSquare, ...bridgeTracks];
                })();

          const currentIndex = sortedForPlay.findIndex(
            (t) => t.id === currentTrack.id,
          );
          let prevTrack: Track | null = null;

          if (playMode === "random") {
            const randomIndex = Math.floor(
              Math.random() * sortedForPlay.length,
            );
            prevTrack = sortedForPlay[randomIndex];
          } else if (playMode === "loop") {
            releaseLock();
            return;
          } else {
            const prevIndex =
              currentIndex <= 0 ? sortedForPlay.length - 1 : currentIndex - 1;
            prevTrack = sortedForPlay[prevIndex];
          }

          if (prevTrack) {
            const { setCurrentTrack, play } = get();
            setCurrentTrack(prevTrack);
            if (wasPlaying) {
              audioEngine.setOnTrackLoaded(() => {
                const g = get();
                if (g.currentTrack?.id === prevTrack.id) {
                  play();
                }
                audioEngine.setOnTrackLoaded(null);
              });
            }
          }
        } finally {
          releaseLock();
        }
      },
    }),
    {
      name: "player-storage",
      version: 3,
      partialize: (state) => ({
        savedTrackId: state.savedTrackId,
        playlistFilter: state.playlistFilter,
        searchQuery: state.searchQuery,
        bridgeFilterWith: state.bridgeFilterWith,
        bridgeFilterWithout: state.bridgeFilterWithout,
        bridgeFilterSwapped: state.bridgeFilterSwapped,
        statusFilterUnlistened: state.statusFilterUnlistened,
        statusFilterModeration: state.statusFilterModeration,
        statusFilterApproved: state.statusFilterApproved,
        accentFilterOn: state.accentFilterOn,
        mamboFilterOn: state.mamboFilterOn,
        squareSortDirection: state.squareSortDirection,
        playlistSortBy: state.playlistSortBy,
        sortDirection: state.sortDirection,
        dominanceBucketNeg: state.dominanceBucketNeg,
        dominanceBucketLow: state.dominanceBucketLow,
        dominanceBucketHigh: state.dominanceBucketHigh,
        playUntilSeconds: state.playUntilSeconds,
      }),
      storage: trackStorage,
      merge: (persistedState: any, currentState: any) => {
        // Формат в localStorage: { state: { ... }, version } или сразу { ... }
        const stored = persistedState?.state ?? persistedState ?? {};
        const storedVersion = persistedState?.version ?? stored?.version ?? 0;
        const get = <T>(key: string, defaultVal: T): T =>
          Object.prototype.hasOwnProperty.call(stored, key)
            ? (stored[key] as T)
            : defaultVal;
        // Сброс бакетов фильтра % при обновлении версии (избегаем старого инвертированного состояния)
        const useDefaultBuckets = storedVersion < 2;
        return {
          ...currentState,
          savedTrackId: stored.savedTrackId ?? null,
          playlistFilter: get("playlistFilter", currentState.playlistFilter),
          searchQuery: get("searchQuery", currentState.searchQuery),
          bridgeFilterWith: get(
            "bridgeFilterWith",
            currentState.bridgeFilterWith,
          ),
          bridgeFilterWithout: get(
            "bridgeFilterWithout",
            currentState.bridgeFilterWithout,
          ),
          bridgeFilterSwapped: get(
            "bridgeFilterSwapped",
            currentState.bridgeFilterSwapped,
          ),
          statusFilterUnlistened: get("statusFilterUnlistened", currentState.statusFilterUnlistened),
          statusFilterModeration: get("statusFilterModeration", currentState.statusFilterModeration),
          statusFilterApproved: get("statusFilterApproved", currentState.statusFilterApproved),
          accentFilterOn: get("accentFilterOn", currentState.accentFilterOn),
          mamboFilterOn: get("mamboFilterOn", currentState.mamboFilterOn),
          squareSortDirection: get(
            "squareSortDirection",
            currentState.squareSortDirection,
          ),
          playlistSortBy: get("playlistSortBy", currentState.playlistSortBy),
          sortDirection: get("sortDirection", currentState.sortDirection),
          ...(stored.playlistSortBy === "artist"
            ? { playlistSortBy: "title" as const }
            : {}),
          dominanceBucketNeg: useDefaultBuckets ? currentState.dominanceBucketNeg : get("dominanceBucketNeg", currentState.dominanceBucketNeg),
          dominanceBucketLow: useDefaultBuckets ? currentState.dominanceBucketLow : get("dominanceBucketLow", currentState.dominanceBucketLow),
          dominanceBucketHigh: useDefaultBuckets ? currentState.dominanceBucketHigh : get("dominanceBucketHigh", currentState.dominanceBucketHigh),
          playUntilSeconds: get(
            "playUntilSeconds",
            currentState.playUntilSeconds,
          ),
          audioEngine: null,
        };
      },
    },
  ),
);

// Функция для восстановления трека из сохраненного ID
export const restoreTrackFromStorage = (tracks: Track[]): Track | null => {
  if (typeof window === "undefined" || tracks.length === 0) return null;

  try {
    const stored = trackStorage.getItem("player-storage");
    if (!stored?.state) return null;

    const savedTrackId = stored.state.savedTrackId;

    if (savedTrackId && typeof savedTrackId === "number") {
      const track = tracks.find((t) => t.id === savedTrackId);
      return track || null;
    }
  } catch (error) {
    // Тихо игнорируем ошибки восстановления
    if (process.env.NODE_ENV === "development") {
      console.warn("Failed to restore track from storage:", error);
    }
  }

  return null;
};
