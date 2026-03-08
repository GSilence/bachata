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
import { useAuthStore } from "@/store/authStore";
import { isAdmin } from "@/lib/roles";
import { useRouter } from "next/navigation";
import { useModeratorStore } from "@/store/moderatorStore";
import ModerationModal from "@/components/ModerationModal";
import type { Track } from "@/types";

export default function PlaybackPage() {
  const router = useRouter();
  // ── Zustand selectors — подписка ТОЛЬКО на то, что нужно в рендере ──
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isReanalyzing = usePlayerStore((s) => s.isReanalyzing);
  const voiceFilter = usePlayerStore((s) => s.voiceFilter);

  // Actions — стабильные ссылки, не вызывают ре-рендер
  const loadTrack = usePlayerStore((s) => s.loadTrack);
  const setAudioEngine = usePlayerStore((s) => s.setAudioEngine);
  const play = usePlayerStore((s) => s.play);
  const pause = usePlayerStore((s) => s.pause);
  const stop = usePlayerStore((s) => s.stop);

  const [isClient, setIsClient] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(1); // Текущий бит (1-8)
  const [isBridgeBeat, setIsBridgeBeat] = useState(false);
  const [beatCounterMode, setBeatCounterMode] = useState<
    "inline" | "fullscreen"
  >("inline");

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Проверяем, что мы на клиенте
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Инициализация аудио-движка
  // Store-Driven: Subscribe to onTrackEnd ONCE on mount
  useEffect(() => {
    if (!isClient || typeof window === "undefined") return;

    try {
      // Subscribe to onTrackEnd ONCE - store will handle playNext
      audioEngine.setOnTrackEnd(() => {
        const { isModerating, openRatingModal } = useModeratorStore.getState();
        const { currentTrack: ct, playNext } = usePlayerStore.getState();

        if (isModerating && ct) {
          // В режиме модератора — показываем окно оценки, НЕ переключаем трек
          openRatingModal(ct.id);
        } else {
          playNext();
        }
      });

      // Save AudioEngine reference in store (for compatibility)
      setAudioEngine(audioEngine);

      // Устанавливаем все восстановленные настройки из store
      const { musicVolume, voiceVolume, voiceFilter, voiceLanguage, voiceType } =
        usePlayerStore.getState();
      audioEngine.setMusicVolume(musicVolume);
      audioEngine.setVoiceVolume(voiceVolume);
      audioEngine.setVoiceFilter(voiceFilter);
      audioEngine.setVoiceLanguage(voiceLanguage);
      audioEngine.setVoiceType(voiceType);

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
    // currentTime/duration берём через getState — НЕ подписываемся (60fps не нужен для media session)
    const { currentTime: ct, duration: dur } = usePlayerStore.getState();
    setMediaSessionMetadata(currentTrack, ct, dur);
    setMediaSessionPlaybackState(isPlaying ? "playing" : "paused");
    // Якорь только при воспроизведении или паузе (позиция > 0). В режиме Stop (0:00) не держим.
    const needAnchor = isPlaying || ct > 0;
    if (needAnchor) {
      audioEngine.startSilentAnchor();
    } else {
      audioEngine.stopSilentAnchor();
    }
  }, [currentTrack, isPlaying]);

  // Wake Lock: держим экран/процесс активным при воспроизведении (важно для фона на мобильных)
  useEffect(() => {
    if (!isClient || typeof window === "undefined") return;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
    };
    if (!nav.wakeLock) return;

    if (isPlaying) {
      nav.wakeLock
        .request("screen")
        .then((sentinel) => {
          wakeLockRef.current = sentinel;
          sentinel.addEventListener("release", () => {
            wakeLockRef.current = null;
          });
        })
        .catch(() => {});
    } else {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    }
    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [isClient, isPlaying]);

  // Восстановление сохранённого трека при монтировании
  // Список треков загружается в Playlist (серверная пагинация).
  // Здесь восстанавливаем только последний выбранный трек по savedTrackId.
  useEffect(() => {
    if (!isClient) return;

    const { currentTrack: existing, savedTrackId } = usePlayerStore.getState();
    if (existing || !savedTrackId) return;

    let cancelled = false;

    // Загружаем сохранённый трек по ID (полный, с gridMap)
    fetch(`/api/tracks/${savedTrackId}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) {
          if (res.status === 401) {
            const redirect = encodeURIComponent(window.location.pathname || "/");
            router.replace(`/login?redirect=${redirect}`);
          }
          return null;
        }
        return res.json();
      })
      .then((track) => {
        if (cancelled || !track) return;
        const { currentTrack: current } = usePlayerStore.getState();
        if (current) return; // уже выбрали трек пока шёл запрос
        console.log("Restored saved track:", track.title);
        loadTrack(track);
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("Failed to restore saved track:", err);
        }
      });

    // Только админ: синхронизация метаданных в фоне
    const user = useAuthStore.getState().user;
    if (isAdmin(user?.role)) {
      fetch("/api/tracks/sync-dominance").catch(() => {});
      fetch("/api/tracks/sync-has-bridges").catch(() => {});
    }

    return () => { cancelled = true; };
  }, [isClient, loadTrack, router]);

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

  // Сброс позиции счёта при стопе — выполняется в handleStop, НЕ через useEffect с currentTime

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
    setCurrentBeat(1);
    setIsBridgeBeat(false);
  };

  const handleTrackSelect = (track: Track) => {
    // gridMap подгружается автоматически в setCurrentTrack если отсутствует
    loadTrack(track);
    stop(); // Stop playback when manually selecting track
  };

  return (
    <div className="min-h-screen bg-gray-900 p-4 sm:p-6 lg:p-8 relative">
      <ModerationModal />
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
