import { create } from "zustand";
import { persist } from "zustand/middleware";
import { audioEngine } from "@/lib/audioEngine";
import type {
  PlayerState,
  Track,
  PlayMode,
  VoiceFilter,
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

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      // Initial state
      currentTrack: null,
      tracks: [],
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      musicVolume: 100,
      voiceVolume: 120, // На 20% громче музыки по умолчанию (ограничено до 100 в UI)

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

      playMode: "sequential",
      voiceFilter: "on1and5",
      playlistFilter: "free",
      searchQuery: "",

      // AudioEngine reference (kept for compatibility, but we import directly now)
      audioEngine: null,

      // Actions
      setCurrentTrack: (track) => {
        if (!track) {
          set({ currentTrack: null, isPlaying: false, currentTime: 0, duration: 0 });
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
        const { isStemsMode, stemsEnabled, stemsVolume, musicVolume, voiceVolume } = get();
        audioEngine.loadTrack(track, isStemsMode, stemsEnabled, stemsVolume);

        // STEP 4: Set volume from store
        audioEngine.setMusicVolume(musicVolume);
        audioEngine.setVoiceVolume(voiceVolume);
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
      },
      setVoiceVolume: (volume) => {
        const clampedVolume = Math.max(0, Math.min(100, volume));
        set({ voiceVolume: clampedVolume });
        // Sync with AudioEngine
        audioEngine.setVoiceVolume(clampedVolume);
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
              ])
            ),
          },
        }));
        // Синхронизируем с AudioEngine
        const { stemsVolume: currentVolumes } = get();
        audioEngine.setStemsVolume(currentVolumes);
      },
      setPlayMode: (mode) => set({ playMode: mode }),
      setVoiceFilter: (filter) => {
        set({ voiceFilter: filter });
        // Убран вызов audioEngine.setVoiceFilter - упрощенный плеер
      },
      setPlaylistFilter: (filter) => set({ playlistFilter: filter }),
      setSearchQuery: (query) => set({ searchQuery: query }),
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

        if (filteredTracks.length === 0) return;

        const currentIndex = filteredTracks.findIndex(
          (t) => t.id === currentTrack.id
        );
        console.log(
          `playNext: currentTrack=${currentTrack.title} (id=${currentTrack.id}), currentIndex=${currentIndex}, playMode=${playMode}, filteredCount=${filteredTracks.length}, wasPlaying=${isPlaying}`
        );
        console.log(
          `Filtered tracks:`,
          filteredTracks.map((t) => `${t.title} (id=${t.id})`)
        );

        let nextTrack: Track | null = null;

        if (playMode === "random") {
          let randomIndex = Math.floor(Math.random() * filteredTracks.length);
          // Если только один трек, не выбираем его снова
          if (filteredTracks.length > 1 && randomIndex === currentIndex) {
            randomIndex = (randomIndex + 1) % filteredTracks.length;
          }
          nextTrack = filteredTracks[randomIndex];
          console.log(
            `Random: selected index=${randomIndex}, track=${nextTrack?.title} (id=${nextTrack?.id})`
          );
        } else if (playMode === "loop") {
          // Остаемся на том же треке - перезагружаем его
          console.log(
            `Loop: restarting track=${currentTrack.title} (id=${currentTrack.id})`
          );
          nextTrack = currentTrack;
        } else {
          // sequential
          if (currentIndex === -1) {
            // Текущий трек не найден в отфильтрованном списке - выбираем первый
            console.warn(
              "Current track not found in filtered list, selecting first track"
            );
            if (filteredTracks.length > 0) {
              nextTrack = filteredTracks[0];
            }
          } else {
            const nextIndex = (currentIndex + 1) % filteredTracks.length;
            nextTrack = filteredTracks[nextIndex];
            console.log(
              `Sequential: currentIndex=${currentIndex}, nextIndex=${nextIndex}, total=${filteredTracks.length}`
            );
            console.log(
              `Sequential: currentTrack=${currentTrack.title} (id=${currentTrack.id}), nextTrack=${nextTrack?.title} (id=${nextTrack?.id})`
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
              if (verifyTrack?.id === nextTrack.id && audioEngine.isTrackLoaded()) {
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

        // STEP 1: Set isPlaying to false BEFORE switching tracks
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

        // STEP 2: Use setCurrentTrack which includes mandatory Stop logic
        if (prevTrack) {
          const { setCurrentTrack, play } = get();
          setCurrentTrack(prevTrack);
          // Auto-play if we were playing before
          if (isPlaying) {
            setTimeout(() => {
              const { currentTrack: verifyTrack } = get();
              if (verifyTrack?.id === prevTrack.id && audioEngine.isTrackLoaded()) {
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
        // Сохраняем только ID трека, чтобы при загрузке найти его в списке
        // audioEngine НЕ сохраняем (это объект класса)
        savedTrackId: state.currentTrack?.id ?? null,
      }),
      storage: trackStorage,
      // Восстанавливаем только savedTrackId, не весь currentTrack и не audioEngine
      merge: (persistedState: any, currentState: any) => {
        return {
          ...currentState,
          savedTrackId: persistedState?.savedTrackId ?? null,
          // audioEngine всегда null при восстановлении
          audioEngine: null,
        };
      },
    }
  )
);

// Функция для восстановления трека из сохраненного ID
export const restoreTrackFromStorage = (tracks: Track[]): Track | null => {
  if (typeof window === "undefined" || tracks.length === 0) return null;

  try {
    const stored = trackStorage.getItem("player-storage");
    if (!stored) return null;

    // Проверяем, что это валидная JSON строка, а не [object Object]
    if (typeof stored !== 'string' || stored === '[object Object]') {
      console.warn("localStorage содержит невалидные данные, очищаем...");
      try {
        trackStorage.removeItem("player-storage");
      } catch (clearError) {
        console.error("Failed to clear corrupted localStorage:", clearError);
      }
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(stored);
    } catch (parseError) {
      // localStorage corruption detected - clear it to prevent crash loop
      console.error(
        "localStorage corruption detected, clearing 'player-storage':",
        parseError
      );
      try {
        trackStorage.removeItem("player-storage");
      } catch (clearError) {
        console.error("Failed to clear corrupted localStorage:", clearError);
      }
      return null;
    }

    // Zustand persist сохраняет данные в формате { state: { ... }, version: ... }
    const savedTrackId = parsed?.state?.savedTrackId;

    if (savedTrackId) {
      const track = tracks.find((t) => t.id === savedTrackId);
      return track || null;
    }
  } catch (error) {
    console.warn("Failed to restore track from storage:", error);
    // If any other error occurs, try to clear the corrupted data
    try {
      trackStorage.removeItem("player-storage");
    } catch (clearError) {
      console.error("Failed to clear corrupted localStorage:", clearError);
    }
  }

  return null;
};
