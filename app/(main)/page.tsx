"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "@/store/playerStore";
import BeatCounter from "@/components/BeatCounter";
import PlayerControls from "@/components/PlayerControls";
import SettingsPanel from "@/components/SettingsPanel";
import StemsControl from "@/components/StemsControl";
import TrackInfo from "@/components/TrackInfo";
import Playlist from "@/components/Playlist";
import { audioEngine } from "@/lib/audioEngine";
import { restoreTrackFromStorage } from "@/store/playerStore";
import type { Track } from "@/types";

export default function PlaybackPage() {
  const {
    currentTrack,
    tracks,
    voiceFilter,
    stemsEnabled,
    stemsVolume,
    setCurrentTrack,
    setTracks,
    setIsPlaying,
    playNext,
    loadTrack,
    setAudioEngine,
    play,
    pause,
    stop,
  } = usePlayerStore();

  const [isClient, setIsClient] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(1); // Текущий бит (1-8)

  // Проверяем, что мы на клиенте
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Инициализация аудио-движка (только на клиенте)
  // Store-Driven: Subscribe to onTrackEnd ONCE on mount
  useEffect(() => {
    if (!isClient || typeof window === "undefined") return;

    try {
      // Subscribe to onTrackEnd ONCE - store will handle playNext
      audioEngine.setOnTrackEnd(() => {
        const { playNext } = usePlayerStore.getState();
        playNext();
      });

      // Save AudioEngine reference in store (for compatibility)
      setAudioEngine(audioEngine);

      // Устанавливаем все восстановленные настройки из store
      const { musicVolume, voiceVolume, voiceFilter } = usePlayerStore.getState();
      audioEngine.setMusicVolume(musicVolume);
      audioEngine.setVoiceVolume(voiceVolume);
      audioEngine.setVoiceFilter(voiceFilter);

      // If track already exists in store, load it via store
      const { currentTrack: existingTrack, tracks } = usePlayerStore.getState();
      if (existingTrack) {
        console.log(
          "Loading existing track after AudioEngine init:",
          existingTrack.title
        );
        loadTrack(existingTrack);
      } else if (!existingTrack && tracks.length > 0) {
        // If no track, load first track
        console.log("No current track, loading first track:", tracks[0].title);
        loadTrack(tracks[0]);
      }
    } catch (error) {
      console.error("Failed to initialize AudioEngine:", error);
    }

    // Cleanup: clear callback
    return () => {
      try {
        audioEngine.setOnTrackEnd(null);
      } catch (error) {
        console.error("Error cleaning up AudioEngine callback:", error);
      }
    };
  }, [isClient, setAudioEngine, loadTrack]);

  // Загрузка треков при монтировании
  useEffect(() => {
    if (!isClient) return;

    let cancelled = false;

    fetch("/api/tracks")
      .then((res) => {
        if (!res.ok) {
          if (res.status === 500) {
            console.warn("Server returned 500, but continuing...");
            return res.json().catch(() => []);
          }
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;

        if (Array.isArray(data)) {
          setTracks(data);

          // Получаем текущий трек из store для проверки
          const { currentTrack: currentTrackState } = usePlayerStore.getState();

          // Если список треков пустой, очищаем currentTrack
          if (data.length === 0) {
            if (currentTrackState) {
              console.log("Clearing currentTrack: no tracks available");
              setCurrentTrack(null);
            }
            return;
          }

          // Проверяем, существует ли текущий трек в новом списке
          if (
            currentTrackState &&
            !data.find((t) => t.id === currentTrackState.id)
          ) {
            console.log("Current track not found in list, clearing it");
            setCurrentTrack(null);
          }

          // Всегда пытаемся восстановить трек из localStorage или выбрать первый
          // Используем restoreTrackFromStorage для безопасного восстановления
          // Эта функция автоматически очистит corrupted localStorage
          const restoredTrack = restoreTrackFromStorage(data);

          // Определяем, какой трек выбрать
          const trackToLoad: Track | null = restoredTrack || data[0];

          // Получаем актуальный currentTrack после возможной очистки
          const { currentTrack: updatedCurrentTrack } =
            usePlayerStore.getState();

          // Загружаем трек, если он отличается от текущего
          if (
            trackToLoad &&
            (!updatedCurrentTrack || updatedCurrentTrack.id !== trackToLoad.id)
          ) {
            console.log("Loading initial track:", trackToLoad.title);
            // Используем loadTrack, который автоматически загрузит трек в AudioEngine
            loadTrack(trackToLoad);
          }
        } else {
          console.warn("API returned non-array data:", data);
          setTracks([]);
          // Очищаем currentTrack при ошибке
          const { currentTrack: currentTrackState } = usePlayerStore.getState();
          if (currentTrackState) {
            setCurrentTrack(null);
          }
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Error loading tracks:", error);
        setTracks([]);
        // Очищаем currentTrack при ошибке
        const { currentTrack: currentTrackState } = usePlayerStore.getState();
        if (currentTrackState) {
          setCurrentTrack(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isClient, setTracks, setCurrentTrack, loadTrack]);

  // Подписка на обновления битов через callback
  useEffect(() => {
    if (!isClient) return;

    // Устанавливаем callback для обновления бита
    audioEngine.setOnBeatUpdate((beatNumber) => {
      setCurrentBeat(beatNumber);
    });

    // Также обновляем при загрузке трека
    const initialBeat = audioEngine.getCurrentBeat();
    setCurrentBeat(initialBeat);

    return () => {
      audioEngine.setOnBeatUpdate(null);
    };
  }, [isClient]);

  // Синхронизация voiceFilter с audioEngine
  useEffect(() => {
    if (!isClient) return;
    audioEngine.setVoiceFilter(voiceFilter);
  }, [isClient, voiceFilter]);

  const handlePlay = () => {
    console.log("Play clicked", {
      currentTrack,
    });
    if (currentTrack) {
      console.log("Calling play() from store");
      play(); // Используем метод из store (он сам обновит isPlaying)
    } else {
      console.warn("Cannot play: currentTrack missing");
    }
  };

  const handlePause = () => {
    pause(); // Используем метод из store (он сам обновит isPlaying)
  };

  const handleStop = () => {
    stop(); // Используем метод из store (он сам обновит isPlaying и currentTime)
  };

  const handleTrackSelect = (track: Track) => {
    // Use store's loadTrack which includes mandatory Stop logic
    loadTrack(track);
    stop(); // Stop playback when manually selecting track
    // Сохраняем выбранный трек в localStorage (только ID, не весь объект)
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("player-storage");
        let parsed: { state?: { savedTrackId?: number } } = { state: {} };

        if (stored) {
          // Проверяем, что это валидная JSON строка, а не [object Object]
          // localStorage.getItem всегда возвращает string | null, но может быть "[object Object]"
          if (
            stored === "[object Object]" ||
            stored.trim() === "[object Object]"
          ) {
            console.warn(
              "localStorage содержит невалидные данные '[object Object]', очищаем..."
            );
            try {
              localStorage.removeItem("player-storage");
            } catch (clearError) {
              console.error(
                "Failed to clear corrupted localStorage:",
                clearError
              );
            }
            parsed = { state: {} };
          } else {
            try {
              parsed = JSON.parse(stored);
            } catch (parseError) {
              // localStorage corruption detected - clear it and start fresh
              console.error(
                "localStorage corruption in handleTrackSelect, clearing:",
                parseError
              );
              try {
                localStorage.removeItem("player-storage");
              } catch (clearError) {
                console.error(
                  "Failed to clear corrupted localStorage:",
                  clearError
                );
              }
              parsed = { state: {} };
            }
          }
        }

        // Ensure state object exists
        if (!parsed.state) {
          parsed.state = {};
        }

        // Save only the track ID (not the entire track object)
        parsed.state.savedTrackId = track.id;
        localStorage.setItem("player-storage", JSON.stringify(parsed));
      } catch (e) {
        console.warn("Failed to save track to storage:", e);
        // Try to clear corrupted storage
        try {
          localStorage.removeItem("player-storage");
        } catch (clearError) {
          console.error("Failed to clear corrupted localStorage:", clearError);
        }
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-4 sm:mb-6 lg:mb-8 pl-12 lg:pl-0">Воспроизведение</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Основная секция - слева */}
          <div className="lg:col-span-2 space-y-6">
            {/* Информация о треке */}
            <div data-block="track-info">
              <TrackInfo />
            </div>

            {/* Визуализация счета */}
            <div
              className="bg-gray-800 rounded-lg p-6 border border-gray-700"
              data-block="beat-counter"
            >
              {isClient ? (
                <BeatCounter currentBeat={currentBeat - 1} />
              ) : (
                <div className="text-center py-8 text-gray-400">
                  Загрузка...
                </div>
              )}
            </div>

            {/* Управление воспроизведением */}
            <div
              className="bg-gray-800 rounded-lg p-6 border border-gray-700"
              data-block="player-controls"
            >
              {isClient ? (
                <PlayerControls
                  onPlay={handlePlay}
                  onPause={handlePause}
                  onStop={handleStop}
                />
              ) : (
                <div className="text-center py-8 text-gray-400">
                  Загрузка...
                </div>
              )}
            </div>

            {/* Режим озвучки (под Voice Volume) */}
            <div
              className="bg-gray-800 rounded-lg p-6 border border-gray-700"
              data-block="voice-filter"
            >
              <SettingsPanel showOnlyVoiceFilter />
            </div>

            {/* Управление дорожками */}
            {isClient && currentTrack && (
              <div
                className="bg-gray-800 rounded-lg border border-gray-700"
                data-block="stems-control"
                style={{ display: 'none' }}
              >
                <StemsControl />
              </div>
            )}
          </div>

          {/* Боковая панель - справа */}
          <div className="space-y-4 sm:space-y-6" data-block="sidebar">
            {/* Плейлист и настройки воспроизведения */}
            <div
              className="bg-gray-800 rounded-lg p-6 border border-gray-700"
              data-block="play-mode"
            >
              <SettingsPanel showOnlyPlayMode />
            </div>

            <div
              className="bg-gray-800 rounded-lg p-6 border border-gray-700"
              data-block="playlist"
            >
              <Playlist onTrackSelect={handleTrackSelect} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
