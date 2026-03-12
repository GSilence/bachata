"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "@/store/playerStore";
import BeatCounter from "@/components/BeatCounter";
import PlayerControls from "@/components/PlayerControls";
import StemsControl from "@/components/StemsControl";
import TrackInfo from "@/components/TrackInfo";
import NowPlayingBar from "@/components/NowPlayingBar";
import DancerToolbar from "@/components/DancerToolbar";
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
import ComplaintModal from "@/components/ComplaintModal";
import type { Track } from "@/types";

export default function PlaybackPage() {
  const router = useRouter();
  const isModerating = useModeratorStore((s) => s.isModerating);
  const isAdminMode = useModeratorStore((s) => s.isAdminMode);
  const [mobilePlaylistOpen, setMobilePlaylistOpen] = useState(false);
  const [showComplaint, setShowComplaint] = useState(false);
  const user = useAuthStore((s) => s.user);
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

  // Автозагрузка первого трека, когда плейлист загрузится и трек ещё не выбран
  useEffect(() => {
    if (!isClient) return;
    const unsub = usePlayerStore.subscribe((state, prev) => {
      if (!state.currentTrack && !prev.currentTrack && state.tracks.length > 0 && prev.tracks.length === 0) {
        loadTrack(state.tracks[0]);
      }
    });
    return unsub;
  }, [isClient, loadTrack]);

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
    <div className="min-h-screen relative">
      <ModerationModal />

      {/* Mobile playlist toggle button (top-right) */}
      <button
        onClick={() => setMobilePlaylistOpen(!mobilePlaylistOpen)}
        className="lg:hidden fixed top-4 right-4 z-50 p-2 bg-gray-800 rounded-lg text-white hover:bg-gray-700 transition-colors"
        aria-label="Toggle playlist"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          {mobilePlaylistOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          )}
        </svg>
      </button>

      {/* Mobile playlist overlay */}
      {mobilePlaylistOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMobilePlaylistOpen(false)} />
      )}

      {/* Mobile playlist slide-up panel */}
      <div
        className={`lg:hidden fixed inset-x-0 bottom-0 z-40 h-screen transform transition-transform duration-300 ease-in-out ${
          mobilePlaylistOpen ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ backgroundColor: "rgb(var(--bg-secondary))" }}
      >
        <div className="flex flex-col h-full">
          {/* Handle bar */}
          <div
            className="flex justify-center py-3 cursor-pointer"
            onClick={() => setMobilePlaylistOpen(false)}
          >
            <div className="w-10 h-1 rounded-full bg-gray-600" />
          </div>
          <div className="flex-1 overflow-y-auto">
            <Playlist onTrackSelect={(track) => { handleTrackSelect(track); setMobilePlaylistOpen(false); }} />
          </div>
        </div>
      </div>

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
      <div className={`grid grid-cols-1 min-h-screen ${isModerating ? "" : "lg:grid-cols-3"}`}>
          {/* Основная секция - слева */}
          <div className="lg:col-span-2">
            {/* Главный блок плеера */}
            <div
              data-block="ui-player"
            >
              {/* Информация о треке (только в режиме администратора) */}
              {isAdminMode && (
                <div data-block="admin-panel" className="pt-14 lg:pt-0" style={{ backgroundColor: "rgb(var(--bg-elevated))" }}>
                  <TrackInfo />
                </div>
              )}

              {/* Счёт — первым */}
              <div data-block="beat-counter" className="relative">
                {/* Кнопка Пожаловаться — верхний правый угол */}
                {currentTrack && user && (
                  <button
                    onClick={() => setShowComplaint(true)}
                    title="Пожаловаться на трек"
                    className="absolute top-3 right-3 z-10 p-2 rounded-lg text-gray-600 hover:text-amber-400 hover:bg-gray-800/60 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </button>
                )}
                <div className={`px-4 md:px-12 ${isAdminMode ? "py-10" : "pt-8 pb-4 md:py-24 md:py-28"}`}>
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
                    <div className="text-center py-8 text-gray-400">Загрузка...</div>
                  )}
                </div>
              </div>

              {/* Название, артист · альбом · год + лайк / плейлист */}
              <div className="px-6 pb-2 border-t border-gray-700/50 pt-4">
                <NowPlayingBar />
              </div>

              {/* Прогресс-бар + кнопки управления */}
              <div className="px-6 pt-6 pb-6" data-block="player-controls">
                {isClient ? (
                  <PlayerControls
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onStop={handleStop}
                  />
                ) : (
                  <div className="text-center py-8 text-gray-400">Загрузка...</div>
                )}
              </div>

              {/* Инструменты */}
              {isClient && (
                <DancerToolbar
                  beatCounterMode={beatCounterMode}
                  onBeatCounterModeChange={setBeatCounterMode}
                />
              )}
            </div>

            {/* Управление дорожками */}
            {isClient && currentTrack && (
              <div
                data-block="stems-control"
                style={{ display: "none" }}
              >
                <StemsControl />
              </div>
            )}
          </div>

          {/* Боковая панель - справа (скрыта на мобильных и в режиме модератора) */}
          {!isModerating && (
            <div
              className="flex flex-col h-screen border-l border-gray-800/60 lg:sticky lg:top-0 lg:flex-col"
              data-block="sidebar"
              style={{ backgroundColor: "rgb(var(--bg-secondary))" }}
            >
              <Playlist onTrackSelect={handleTrackSelect} />
            </div>
          )}
        </div>

      {/* Модалка жалобы */}
      {showComplaint && currentTrack && (
        <ComplaintModal
          trackId={currentTrack.id}
          trackTitle={currentTrack.metaTitle || currentTrack.title}
          trackArtist={currentTrack.artist || currentTrack.metaArtist}
          trackAlbum={currentTrack.metaAlbum}
          onClose={() => setShowComplaint(false)}
        />
      )}
    </div>
  );
}
