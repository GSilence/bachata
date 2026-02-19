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
  PlaylistFilter,
} from "@/types";

// Функция для сохранения/восстановления трека из localStorage
const trackStorage = {
  getItem: (name: string): string | null => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(name, value);
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
      playlistFilter: "free",
      searchQuery: "",
      bridgeFilterWith: true,
      bridgeFilterWithout: true,
      squareSortDirection: "none",
      squareDominanceMin: 0,
      squareDominanceMax: 100,
      isReanalyzing: false,

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
      setPlaylistFilter: (filter) => set({ playlistFilter: filter }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setBridgeFilterWith: (value) => set({ bridgeFilterWith: value }),
      setBridgeFilterWithout: (value) => set({ bridgeFilterWithout: value }),
      setSquareSortDirection: (dir) => set({ squareSortDirection: dir }),
      setSquareDominanceRange: (min, max) =>
        set({
          squareDominanceMin: Math.max(0, Math.min(100, min)),
          squareDominanceMax: Math.max(0, Math.min(100, max)),
        }),
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
        const {
          currentTrack,
          tracks,
          playMode,
          playlistFilter,
          searchQuery,
          bridgeFilterWith,
          bridgeFilterWithout,
          squareDominanceMin,
          squareDominanceMax,
          isPlaying,
        } = get();
        if (!currentTrack || tracks.length === 0) return;

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

          // Мостики: с / без
          const hasBridges = (track.gridMap?.bridges?.length ?? 0) > 0;
          if (hasBridges && !bridgeFilterWith) return false;
          if (!hasBridges && !bridgeFilterWithout) return false;

          // Квадратные: диапазон % превосходства
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
            if (!matchesTitle && !matchesArtist) {
              return false;
            }
          }

          return true;
        });

        const squareSortDirection = get().squareSortDirection;
        const sortedForPlay =
          squareSortDirection === "none"
            ? filteredTracks
            : (() => {
                const hasBridges = (t: Track) =>
                  (t.gridMap?.bridges?.length ?? 0) > 0;
                const getDominance = (t: Track) =>
                  (t.gridMap as { rowDominancePercent?: number })
                    ?.rowDominancePercent ?? -Infinity;
                const squareTracks = filteredTracks.filter(
                  (t) => !hasBridges(t),
                );
                const bridgeTracks = filteredTracks.filter((t) =>
                  hasBridges(t),
                );
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
        console.log(
          `playNext: currentTrack=${currentTrack.title} (id=${currentTrack.id}), currentIndex=${currentIndex}, playMode=${playMode}, filteredCount=${sortedForPlay.length}, wasPlaying=${isPlaying}`,
        );
        console.log(
          `Filtered tracks:`,
          sortedForPlay.map((t) => `${t.title} (id=${t.id})`),
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
          // Auto-play if we were playing before
          if (wasPlaying) {
            // Small delay to ensure track is loaded
            setTimeout(() => {
              const { currentTrack: verifyTrack } = get();
              if (
                verifyTrack?.id === nextTrack.id &&
                audioEngine.isTrackLoaded()
              ) {
                play();
              }
            }, 100);
          }
        } else {
          console.warn("playNext: No next track found");
        }
      },

      playPrevious: () => {
        const { currentTrack, tracks, playMode, isPlaying } = get();
        if (!currentTrack || tracks.length === 0) return;

        // STEP 1: Save playing state before switching (for auto-play after track loads)
        const wasPlaying = isPlaying;

        // STEP 2: Set isPlaying to false BEFORE switching tracks
        set({ isPlaying: false });

        const currentIndex = tracks.findIndex((t) => t.id === currentTrack.id);
        let prevTrack: Track | null = null;

        if (playMode === "random") {
          const randomIndex = Math.floor(Math.random() * tracks.length);
          prevTrack = tracks[randomIndex];
        } else if (playMode === "loop") {
          // Остаемся на том же треке
          return;
        } else {
          // sequential
          const prevIndex =
            currentIndex === 0 ? tracks.length - 1 : currentIndex - 1;
          prevTrack = tracks[prevIndex];
        }

        // STEP 3: Use setCurrentTrack which includes mandatory Stop logic
        if (prevTrack) {
          const { setCurrentTrack, play } = get();
          setCurrentTrack(prevTrack);
          // Auto-play if we were playing before
          if (wasPlaying) {
            setTimeout(() => {
              const { currentTrack: verifyTrack } = get();
              if (
                verifyTrack?.id === prevTrack.id &&
                audioEngine.isTrackLoaded()
              ) {
                play();
              }
            }, 100);
          }
        }
      },
    }),
    {
      name: "player-storage",
      partialize: (state) => ({
        savedTrackId: state.currentTrack?.id ?? null,
        playlistFilter: state.playlistFilter,
        searchQuery: state.searchQuery,
        bridgeFilterWith: state.bridgeFilterWith,
        bridgeFilterWithout: state.bridgeFilterWithout,
        squareSortDirection: state.squareSortDirection,
        squareDominanceMin: state.squareDominanceMin,
        squareDominanceMax: state.squareDominanceMax,
      }),
      storage: trackStorage,
      merge: (persistedState: any, currentState: any) => {
        const stored = persistedState?.state ?? persistedState ?? {};
        return {
          ...currentState,
          savedTrackId: stored.savedTrackId ?? null,
          playlistFilter: stored.playlistFilter ?? currentState.playlistFilter,
          searchQuery: stored.searchQuery ?? currentState.searchQuery,
          bridgeFilterWith:
            stored.bridgeFilterWith ?? currentState.bridgeFilterWith,
          bridgeFilterWithout:
            stored.bridgeFilterWithout ?? currentState.bridgeFilterWithout,
          squareSortDirection:
            stored.squareSortDirection ?? currentState.squareSortDirection,
          squareDominanceMin:
            stored.squareDominanceMin ?? currentState.squareDominanceMin,
          squareDominanceMax:
            stored.squareDominanceMax ?? currentState.squareDominanceMax,
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
    if (!stored) return null;

    // Проверяем, что это валидная JSON строка
    if (typeof stored !== "string") {
      // Если это не строка, значит что-то не так - очищаем
      try {
        trackStorage.removeItem("player-storage");
      } catch {
        // Игнорируем ошибки очистки
      }
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(stored);
    } catch {
      // Если не удалось распарсить - очищаем поврежденные данные
      try {
        trackStorage.removeItem("player-storage");
      } catch {
        // Игнорируем ошибки очистки
      }
      return null;
    }

    // Zustand persist сохраняет данные в формате { state: { ... }, version: ... }
    const savedTrackId = parsed?.state?.savedTrackId;

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
