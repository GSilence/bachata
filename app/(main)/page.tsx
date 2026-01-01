"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "@/store/playerStore";
// Убран BeatCounter - упрощенный плеер без beat tracking
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

  // Убран currentBeat - упрощенный плеер без beat tracking
  const [isClient, setIsClient] = useState(false);

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

          // Всегда пытаемся восстановить трек из localStorage или выбрать первый
          if (data.length > 0) {
            // Используем restoreTrackFromStorage для безопасного восстановления
            // Эта функция автоматически очистит corrupted localStorage
            const restoredTrack = restoreTrackFromStorage(data);

            // Определяем, какой трек выбрать
            const trackToLoad: Track | null = restoredTrack || data[0];

            // Загружаем трек, если он отличается от текущего
            if (
              trackToLoad &&
              (!currentTrack || currentTrack.id !== trackToLoad.id)
            ) {
              console.log("Loading initial track:", trackToLoad.title);
              // Используем loadTrack, который автоматически загрузит трек в AudioEngine
              loadTrack(trackToLoad);
            }
          }
        } else {
          console.warn("API returned non-array data:", data);
          setTracks([]);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Error loading tracks:", error);
        setTracks([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isClient, setTracks, setCurrentTrack]);

  // UI Update Loop moved to PlayerControls.tsx to avoid duplication

  // Убраны эффекты для voice filter и stems - упрощенный плеер

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
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">Воспроизведение</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Основная секция - слева */}
          <div className="lg:col-span-2 space-y-6">
            {/* Информация о треке */}
            <TrackInfo />

            {/* Визуализация счета */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              {/* Убран BeatCounter - упрощенный плеер без beat tracking */}
            </div>

            {/* Управление воспроизведением */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
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
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <SettingsPanel showOnlyVoiceFilter />
            </div>

            {/* Управление дорожками (только для обработанных треков) */}
            {isClient && currentTrack?.isProcessed && (
              <div className="bg-gray-800 rounded-lg border border-gray-700">
                <StemsControl />
              </div>
            )}
          </div>

          {/* Боковая панель - справа */}
          <div className="space-y-6">
            {/* Плейлист и настройки воспроизведения */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <SettingsPanel showOnlyPlayMode />
            </div>

            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <Playlist onTrackSelect={handleTrackSelect} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
