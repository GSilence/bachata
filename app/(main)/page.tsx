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
import {
  initMediaSession,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
} from "@/lib/media-session";
import { restoreTrackFromStorage } from "@/store/playerStore";
import type { Track } from "@/types";

export default function PlaybackPage() {
  const {
    currentTrack,
    tracks,
    currentTime,
    duration,
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
    isReanalyzing,
    isPlaying,
  } = usePlayerStore();

  const [isClient, setIsClient] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(1); // Текущий бит (1-8)
  const [isBridgeBeat, setIsBridgeBeat] = useState(false);
  const [beatCounterMode, setBeatCounterMode] = useState<
    "inline" | "fullscreen"
  >("inline");

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
      const { musicVolume, voiceVolume, voiceFilter, voiceLanguage } =
        usePlayerStore.getState();
      audioEngine.setMusicVolume(musicVolume);
      audioEngine.setVoiceVolume(voiceVolume);
      audioEngine.setVoiceFilter(voiceFilter);
      audioEngine.setVoiceLanguage(voiceLanguage);

      // If track already exists in store, load it via store
      const { currentTrack: existingTrack, tracks } = usePlayerStore.getState();
      if (existingTrack) {
        console.log(
          "Loading existing track after AudioEngine init:",
          existingTrack.title,
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

  // Media Session + silent anchor для фонового воспроизведения (счёт в фоне / с экрана блокировки)
  useEffect(() => {
    if (!isClient || typeof window === "undefined") return;
    initMediaSession({
      play: () => usePlayerStore.getState().play(),
      pause: () => usePlayerStore.getState().pause(),
    });
  }, [isClient]);

  useEffect(() => {
    if (!currentTrack) {
      setMediaSessionPlaybackState("none");
      audioEngine.stopSilentAnchor();
      return;
    }
    // Обновляем метаданные только при смене трека или длительности, НЕ на каждое обновление времени
    setMediaSessionMetadata(currentTrack, currentTime, duration);
    setMediaSessionPlaybackState(isPlaying ? "playing" : "paused");
    if (isPlaying) {
      audioEngine.startSilentAnchor();
    } else {
      audioEngine.stopSilentAnchor();
    }
  }, [currentTrack, isPlaying, duration]); // Убрали currentTime из зависимостей

  // Загрузка треков при монтировании
  useEffect(() => {
    if (!isClient) return;

    let cancelled = false;

    fetch("/api/tracks", { cache: "no-store" })
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
    audioEngine.setOnBeatUpdate((beatNumber, isBridge) => {
      setCurrentBeat(beatNumber);
      setIsBridgeBeat(!!isBridge);
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
    // Zustand persist автоматически сохранит savedTrackId через partialize функцию
  };

  return (
    <div className="min-h-screen bg-gray-900 p-4 sm:p-6 lg:p-8 relative">
      {isReanalyzing && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-900/90 backdrop-blur-sm"
          aria-modal="true"
          aria-busy="true"
          aria-label="Идёт переоценка расклада"
        >
          <svg
            className="w-12 h-12 text-purple-400 animate-spin mb-4"
            style={{ animationDirection: "reverse" }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <p className="text-white font-medium">Переоценка расклада…</p>
          <p className="text-gray-400 text-sm mt-1">Не закрывайте страницу</p>
        </div>
      )}
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Основная секция - слева */}
          <div className="lg:col-span-2 space-y-6">
            {/* Информация о треке */}
            <div data-block="track-info">
              <TrackInfo />
            </div>

            {/* Визуализация счета */}
            <div className="space-y-4">
              {/* Кнопки переключения режима - как закладки */}
              <div className="flex gap-2 border-b border-gray-700">
                <button
                  onClick={() => setBeatCounterMode("inline")}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                    beatCounterMode === "inline"
                      ? "border-purple-600 text-purple-400"
                      : "border-transparent text-gray-400 hover:text-purple-400"
                  }`}
                >
                  В строке
                </button>
                <button
                  onClick={() => setBeatCounterMode("fullscreen")}
                  className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                    beatCounterMode === "fullscreen"
                      ? "border-purple-600 text-purple-400"
                      : "border-transparent text-gray-400 hover:text-purple-400"
                  }`}
                >
                  Во весь экран
                </button>
              </div>

              <div
                className="bg-gray-800 rounded-lg py-8 px-4 md:p-12 border border-gray-700"
                data-block="beat-counter"
              >
                {isClient ? (
                  <BeatCounter
                    currentBeat={currentBeat - 1}
                    isBridge={isBridgeBeat}
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onStop={handleStop}
                    displayMode={beatCounterMode}
                    onDisplayModeChange={setBeatCounterMode}
                  />
                ) : (
                  <div className="text-center py-8 text-gray-400">
                    Загрузка...
                  </div>
                )}
              </div>
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
              className="bg-gray-800 rounded-lg py-2 px-6 lg:p-6 border border-gray-700"
              data-block="voice-filter"
            >
              <SettingsPanel showOnlyVoiceFilter />
            </div>

            {/* Управление дорожками */}
            {isClient && currentTrack && (
              <div
                className="bg-gray-800 rounded-lg border border-gray-700"
                data-block="stems-control"
                style={{ display: "none" }}
              >
                <StemsControl />
              </div>
            )}
          </div>

          {/* Боковая панель - справа */}
          <div className="space-y-4 sm:space-y-6" data-block="sidebar">
            {/* Плейлист и настройки воспроизведения */}
            <div
              className="bg-gray-800 rounded-lg pt-2 pb-2 px-6 lg:p-6 border border-gray-700"
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
