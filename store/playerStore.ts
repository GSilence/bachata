import { create } from "zustand";
import { persist } from "zustand/middleware";
import { audioEngine } from "@/lib/audioEngine";
import { restoreUserSettings, saveUserSettings } from "@/lib/userSettings";
import { fetchTrackFull } from "@/lib/fetchTrackFull";
import { buildNavigateFilters } from "@/lib/buildNavigateFilters";
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
      statusFilterPopsa: true,
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
      setCurrentTrack: (track, autoPlay) => {
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
        set({
          currentTrack: track,
          savedTrackId: track.id,
          isPlaying: false,
          currentTime: 0,
          duration: 0,
        });

        // STEP 2: Stop playback explicitly
        audioEngine.stop();

        // Внутренний хелпер загрузки аудио
        const doLoad = (t: Track) => {
          const {
            isStemsMode,
            stemsEnabled,
            stemsVolume,
            musicVolume,
            voiceVolume,
          } = get();
          // loadTrack: unload старый → создаёт новый Howl (musicTrack = null на мгновение)
          audioEngine.loadTrack(t, isStemsMode, stemsEnabled, stemsVolume);
          audioEngine.setMusicVolume(musicVolume);
          audioEngine.setVoiceVolume(voiceVolume);
          // autoPlay: ставим callback ПОСЛЕ loadTrack — старый трек уже unloaded,
          // isTrackLoaded() не стрельнёт false-positive на старом треке.
          // Если новый Howl уже загружен (из кэша), setOnTrackLoaded вызовет play() немедленно.
          // Отправляем статистику прослушивания (fire-and-forget)
          fetch(`/api/tracks/${t.id}/play`, { method: "POST" }).catch(() => {});

          if (autoPlay) {
            audioEngine.setOnTrackLoaded(() => {
              const g = get();
              if (g.currentTrack?.id === t.id) {
                g.play();
              }
              audioEngine.setOnTrackLoaded(null);
            });
          }
        };

        // STEP 3: Если gridMap не загружена — подтянуть с сервера, иначе грузить сразу
        if (track.gridMap == null) {
          fetchTrackFull(track).then((fullTrack) => {
            // Проверяем что пользователь не переключил трек пока шёл запрос
            const current = get().currentTrack;
            if (current?.id !== track.id) return;
            set({ currentTrack: fullTrack });
            doLoad(fullTrack);
          });
        } else {
          doLoad(track);
        }
      },
      updateCurrentTrack: (track) => {
        // Обновляет метаданные трека без перезагрузки аудио (для бриджей, offset и т.д.)
        set({ currentTrack: track });
      },
      setTracks: (tracks) => set({ tracks }),
      playlistRefetchTrigger: 0,
      triggerPlaylistRefetch: () => set((s) => ({ playlistRefetchTrigger: (s as any).playlistRefetchTrigger + 1 })),
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
      setStatusFilterPopsa: (value) => set({ statusFilterPopsa: value }),
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

        const state = get();
        const { currentTrack, playMode, isPlaying } = state;

        if (!currentTrack) {
          releaseLock();
          return;
        }

        const wasPlaying = isPlaying;
        set({ isPlaying: false });

        // Loop mode: restart same track
        if (playMode === "loop") {
          const { setCurrentTrack } = get();
          setCurrentTrack(currentTrack, wasPlaying);
          releaseLock();
          return;
        }

        // Server-side navigation: next/random
        const direction = playMode === "random" ? "random" : "next";
        const filters = buildNavigateFilters(state);

        fetch("/api/tracks/navigate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentTrackId: currentTrack.id,
            direction,
            filters,
          }),
        })
          .then((res) => res.json())
          .then((data) => {
            const nextTrack = data.track as Track | null;
            if (nextTrack) {
              // Navigate endpoint returns full track with gridMap
              const { setCurrentTrack } = get();
              setCurrentTrack(nextTrack, wasPlaying);
            } else {
              console.warn("playNext: No next track found");
            }
          })
          .catch((err) => {
            console.error("playNext navigate error:", err);
          })
          .finally(releaseLock);
      },

      playPrevious: () => {
        if (transitionLock) return;
        transitionLock = true;
        const releaseLock = () => {
          setTimeout(() => {
            transitionLock = false;
          }, TRANSITION_LOCK_MS);
        };

        const state = get();
        const { currentTrack, playMode, isPlaying } = state;

        if (!currentTrack) {
          releaseLock();
          return;
        }

        // Loop mode: do nothing
        if (playMode === "loop") {
          releaseLock();
          return;
        }

        const wasPlaying = isPlaying;
        set({ isPlaying: false });

        const direction = playMode === "random" ? "random" : "prev";
        const filters = buildNavigateFilters(state);

        fetch("/api/tracks/navigate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentTrackId: currentTrack.id,
            direction,
            filters,
          }),
        })
          .then((res) => res.json())
          .then((data) => {
            const prevTrack = data.track as Track | null;
            if (prevTrack) {
              const { setCurrentTrack } = get();
              setCurrentTrack(prevTrack, wasPlaying);
            }
          })
          .catch((err) => {
            console.error("playPrevious navigate error:", err);
          })
          .finally(releaseLock);
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
        statusFilterPopsa: state.statusFilterPopsa,
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
        const stored = persistedState?.state ?? persistedState ?? {};
        const get = <T>(key: string, defaultVal: T): T =>
          Object.prototype.hasOwnProperty.call(stored, key)
            ? (stored[key] as T)
            : defaultVal;
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
          statusFilterPopsa: get("statusFilterPopsa", currentState.statusFilterPopsa),
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
          dominanceBucketNeg: get("dominanceBucketNeg", currentState.dominanceBucketNeg),
          dominanceBucketLow: get("dominanceBucketLow", currentState.dominanceBucketLow),
          dominanceBucketHigh: get("dominanceBucketHigh", currentState.dominanceBucketHigh),
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
