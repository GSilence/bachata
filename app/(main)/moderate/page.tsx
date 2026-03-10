"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { usePlayerStore } from "@/store/playerStore";
import { useModeratorStore } from "@/store/moderatorStore";
import { audioEngine } from "@/lib/audioEngine";
import { isAdmin, isModerator } from "@/lib/roles";
import {
  initMediaSession,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
} from "@/lib/media-session";
import BeatCounter from "@/components/BeatCounter";
import type { VoiceFilter } from "@/types";

// ─── VerdictModal ────────────────────────────────────────────────────────────

function VerdictModal({
  modQueueId,
  onClose,
  onDismiss,
  onFinal,
  onSwap,
}: {
  modQueueId: number;
  onClose: () => void; // replay from start
  onDismiss: () => void; // just close
  onFinal: () => void;
  onSwap: (updatedTrack: any) => void;
}) {
  const [layoutCorrect, setLayoutCorrect] = useState<boolean | null>(null);
  const [hasMambo, setHasMambo] = useState<boolean | null>(null);
  const [hasAccents, setHasAccents] = useState<boolean | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [swapState, setSwapState] = useState(false);

  const canSubmit =
    layoutCorrect !== null && hasMambo !== null && hasAccents !== null;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError("");
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/queue/mod/${modQueueId}/verdict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layoutCorrect, hasMambo, hasAccents }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Ошибка отправки");
        return;
      }

      if (data.action === "swap_and_continue") {
        onSwap(data.track);
        setSwapState(true);
        setLayoutCorrect(null);
        setHasMambo(null);
        setHasAccents(null);
      } else {
        onFinal();
      }
    } catch {
      setError("Ошибка соединения");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 bg-black/70 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden my-auto shrink-0">
        {swapState ? (
          <div className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-900/60 border border-amber-600 flex items-center justify-center text-xl">
                🔄
              </div>
              <div>
                <h2 className="text-base font-bold text-white">
                  Счёт перестроен
                </h2>
                <p className="text-amber-400 text-xs">
                  Алгоритм автоматически поменял местами РАЗ и ПЯТЬ
                </p>
              </div>
            </div>
            <p className="text-gray-300 text-sm mb-6">
              Прослушайте трек ещё раз и оцените снова.
            </p>
            <button
              onClick={onClose}
              className="w-full py-3.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl transition-colors text-sm font-medium"
            >
              Слушать сначала
            </button>
          </div>
        ) : (
          <>
            <div className="px-5 pt-5 pb-0">
              <div className="flex items-start justify-between mb-1">
                <h2 className="text-lg font-bold text-white">Оценка трека</h2>
                <button
                  onClick={onDismiss}
                  className="text-gray-500 hover:text-gray-300 transition-colors p-1 -mt-1 -mr-1"
                  title="Закрыть"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              <p className="text-gray-400 text-sm mb-5">
                Ответьте на вопросы и отправьте результат.
              </p>

              {error && (
                <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">
                  {error}
                </div>
              )}

              <VerdictQuestion
                label="Расклад верный?"
                value={layoutCorrect}
                onChange={setLayoutCorrect}
              />
              <VerdictQuestion
                label="Есть Мамбо?"
                value={hasMambo}
                onChange={setHasMambo}
              />
              <VerdictQuestion
                label="Есть Акценты?"
                value={hasAccents}
                onChange={setHasAccents}
              />

            </div>

            <hr className="border-gray-700 mt-12" />

            <div className="flex gap-3 px-5 py-4">
              <button
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting}
                className="flex-1 py-3.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Отправка..." : "Отправить"}
              </button>
              <button
                onClick={onClose}
                className="flex-1 py-3.5 bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white rounded-xl transition-colors text-sm font-medium"
              >
                Повторить
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function VerdictQuestion({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="mb-4">
      <p className="text-gray-200 text-sm font-medium mb-2">{label}</p>
      <div className="flex gap-3">
        <button
          onClick={() => onChange(true)}
          className={`flex-1 py-3 rounded-xl text-sm font-medium transition-colors ${value === true ? "bg-green-600 text-white ring-2 ring-green-400" : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"}`}
        >
          Да
        </button>
        <button
          onClick={() => onChange(false)}
          className={`flex-1 py-3 rounded-xl text-sm font-medium transition-colors ${value === false ? "bg-red-600 text-white ring-2 ring-red-400" : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"}`}
        >
          Нет
        </button>
      </div>
    </div>
  );
}

// ─── Режимы голоса ───────────────────────────────────────────────────────────

const VOICE_FILTERS: { value: VoiceFilter; label: string }[] = [
  { value: "on1", label: "РАЗ" },
  { value: "on1and5", label: "РАЗ+5" },
  { value: "full", label: "Все" },
  { value: "mute", label: "Без" },
];

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ModeratePage() {
  const router = useRouter();
  const { user, isLoading } = useAuthStore();

  const {
    isPlaying,
    currentTime,
    duration,
    musicVolume,
    voiceVolume,
    voiceFilter,
    setMusicVolume,
    setVoiceVolume,
    setVoiceFilter,
  } = usePlayerStore();

  const { enterModeratorMode, exitModeratorMode } = useModeratorStore();

  const [modTrack, setModTrack] = useState<any | null>(null);
  const [modQueueId, setModQueueId] = useState<number | null>(null);
  const [queueEmpty, setQueueEmpty] = useState(false);
  const [loadingTrack, setLoadingTrack] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [trackReady, setTrackReady] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(1);
  const [isBridgeBeat, setIsBridgeBeat] = useState(false);
  const [isMarkingNotBachata, setIsMarkingNotBachata] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const isInteractingRef = useRef(false);
  const isSeekingRef = useRef(false); // блокирует onTrackEnd пока seek в процессе

  // Синхронизируем isModerating в store при входе/выходе со страницы
  useEffect(() => {
    enterModeratorMode();
    return () => {
      exitModeratorMode();
    };
  }, [enterModeratorMode, exitModeratorMode]);

  // Auth: layout handles checkAuth + redirect for unauthenticated users.
  // Here we only guard against wrong roles (e.g. role=user somehow reached this page).
  useEffect(() => {
    if (!isLoading && user && !isModerator(user.role) && !isAdmin(user.role)) {
      router.replace("/");
    }
  }, [user, isLoading, router]);

  // ── Мобильное воспроизведение ────────────────────────────────────────────

  // 1. MediaSession: управление с экрана блокировки
  useEffect(() => {
    initMediaSession({
      play: () => usePlayerStore.getState().play(),
      pause: () => usePlayerStore.getState().pause(),
    });
  }, []);

  // 2. MediaSession metadata + Silent Anchor (держит AudioContext активным в фоне)
  useEffect(() => {
    if (!modTrack) {
      setMediaSessionPlaybackState("none");
      audioEngine.stopSilentAnchor();
      return;
    }
    setMediaSessionMetadata(modTrack, currentTime, duration);
    setMediaSessionPlaybackState(isPlaying ? "playing" : "paused");
    if (isPlaying || currentTime > 0) {
      audioEngine.startSilentAnchor();
    } else {
      audioEngine.stopSilentAnchor();
    }
  }, [modTrack, isPlaying, currentTime, duration]);

  // 3. Wake Lock: не гасим экран при воспроизведении
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
    };
    if (!nav.wakeLock) return;
    if (isPlaying) {
      nav.wakeLock
        .request("screen")
        .then((s) => {
          wakeLockRef.current = s;
          s.addEventListener("release", () => {
            wakeLockRef.current = null;
          });
        })
        .catch(() => {});
    } else {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    }
    return () => {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [isPlaying]);

  // ── Beat counter ──────────────────────────────────────────────────────────
  useEffect(() => {
    audioEngine.setOnBeatUpdate((beatNumber, isBridge) => {
      setCurrentBeat(beatNumber);
      setIsBridgeBeat(!!isBridge);
    });
    return () => {
      audioEngine.setOnBeatUpdate(null);
    };
  }, []);

  // Сброс счёта при стопе — проверяем только isPlaying и modTrack, без currentTime (избегаем 60fps renders)
  useEffect(() => {
    if (modTrack && !isPlaying && audioEngine.getCurrentTime() === 0) {
      setCurrentBeat(1);
      setIsBridgeBeat(false);
    }
  }, [modTrack, isPlaying]);

  // ── Анимационный цикл (как в PlayerControls): синхронизируем currentTime и duration ─
  useEffect(() => {
    let rafId: number;
    const updateLoop = () => {
      const state = usePlayerStore.getState();
      // Duration обновляем всегда (нужно для seek-ползунка даже на паузе)
      const dur = audioEngine.getDuration();
      if (dur > 0 && dur !== state.duration) {
        usePlayerStore.setState({ duration: dur });
      }
      // currentTime — только при воспроизведении и без взаимодействия
      if (!isInteractingRef.current && state.isPlaying) {
        state.setCurrentTime(audioEngine.getCurrentTime());
      }
      rafId = requestAnimationFrame(updateLoop);
    };
    rafId = requestAnimationFrame(updateLoop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Загрузка следующего трека
  const loadNextTrack = useCallback(async () => {
    setLoadingTrack(true);
    setShowModal(false);
    setTrackReady(false);
    audioEngine.stop();
    usePlayerStore.setState({ isPlaying: false, currentTime: 0, duration: 0 });
    try {
      const res = await fetch("/api/queue/mod/next", { cache: "no-store" });
      if (!res.ok) {
        setQueueEmpty(true);
        setLoadingTrack(false);
        return;
      }
      const data = await res.json();
      if (!data.track) {
        setModTrack(null);
        setModQueueId(null);
        setQueueEmpty(true);
      } else {
        setModTrack(data.track);
        setModQueueId(data.modQueueId);
        setQueueEmpty(false);
        // Загружаем в audioEngine
        audioEngine.loadTrack(data.track);
        audioEngine.setMusicVolume(usePlayerStore.getState().musicVolume);
        audioEngine.setVoiceVolume(usePlayerStore.getState().voiceVolume);
        audioEngine.setVoiceFilter(usePlayerStore.getState().voiceFilter ?? "on1");
        // Ждём загрузки Howl перед разрешением воспроизведения
        audioEngine.setOnTrackLoaded(() => {
          setTrackReady(true);
          const dur = audioEngine.getDuration();
          if (dur > 0) usePlayerStore.setState({ duration: dur });
        });
        // Открываем модалку по завершении трека (не открываем если идёт seek)
        audioEngine.setOnTrackEnd(() => {
          usePlayerStore.setState({ isPlaying: false });
          if (!isSeekingRef.current) setShowModal(true);
        });
      }
    } catch {
      setQueueEmpty(true);
    } finally {
      setLoadingTrack(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isLoading && user && (isModerator(user.role) || isAdmin(user.role))) {
      loadNextTrack();
    }
  }, [isLoading, user, loadNextTrack]);

  // Обновление трека после свапа (новый gridMap и offset)
  const handleSwap = (updatedTrack: any) => {
    const merged = { ...modTrack, ...updatedTrack };
    setModTrack(merged);
    setTrackReady(false);
    audioEngine.stop();
    audioEngine.loadTrack(merged);
    audioEngine.setMusicVolume(musicVolume);
    audioEngine.setVoiceVolume(voiceVolume);
    audioEngine.setVoiceFilter(voiceFilter ?? "on1");
    // Ждём загрузки Howl перед разрешением воспроизведения
    audioEngine.setOnTrackLoaded(() => {
      setTrackReady(true);
      const dur = audioEngine.getDuration();
      if (dur > 0) usePlayerStore.setState({ duration: dur });
    });
    audioEngine.setOnTrackEnd(() => {
      usePlayerStore.setState({ isPlaying: false });
      if (!isSeekingRef.current) setShowModal(true);
    });
    usePlayerStore.setState({ isPlaying: false, currentTime: 0, duration: 0 });
  };

  const togglePlay = () => {
    if (isPlaying) {
      const ct = audioEngine.getCurrentTime();
      audioEngine.pause();
      usePlayerStore.setState({ isPlaying: false, currentTime: ct });
    } else if (trackReady) {
      const ct = audioEngine.getCurrentTime();
      audioEngine.play();
      usePlayerStore.setState({ isPlaying: true, currentTime: ct });
    }
  };

  // Seek-хелпер: блокирует RAF + onTrackEnd на 200мс
  const doSeek = (newTime: number) => {
    isInteractingRef.current = true;
    isSeekingRef.current = true;
    usePlayerStore.setState({ currentTime: newTime });
    audioEngine.seek(newTime);
    setTimeout(() => { isInteractingRef.current = false; isSeekingRef.current = false; }, 200);
  };

  // Клик по прогресс-бару — используем duration из store (как в PlayerControls)
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !modTrack || duration <= 0 || !trackReady) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    doSeek(pct * duration);
  };
  const rewind = () => {
    if (!trackReady) return;
    doSeek(Math.max(0, audioEngine.getCurrentTime() - 10));
  };
  const forward = () => {
    if (!trackReady || duration <= 0) return;
    doSeek(Math.min(duration, audioEngine.getCurrentTime() + 10));
  };

  const handleReplayFromStart = () => {
    setShowModal(false);
    if (trackReady) {
      audioEngine.seek(0);
      audioEngine.play();
      usePlayerStore.setState({ isPlaying: true, currentTime: 0 });
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60)
      .toString()
      .padStart(2, "0")}`;
  };

  const handleNotBachata = async () => {
    if (!modQueueId || isMarkingNotBachata) return;
    if (!confirm("Вы уверены, что это не бачата?")) return;
    setIsMarkingNotBachata(true);
    try {
      const res = await fetch(`/api/queue/mod/${modQueueId}/verdict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notBachata: true }),
      });
      if (res.ok) {
        loadNextTrack();
      }
    } catch {}
    setIsMarkingNotBachata(false);
  };

  const handleSwitchToLibrary = () => {
    audioEngine.stop();
    audioEngine.stopSilentAnchor();
    setMediaSessionPlaybackState("none");
    router.push("/library");
  };

  const handleLogout = async () => {
    audioEngine.stop();
    audioEngine.stopSilentAnchor();
    setMediaSessionPlaybackState("none");
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  if (isLoading || loadingTrack) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col -mt-16 lg:mt-0">
      {/* Хедер — fixed на мобильном, чтобы совпадал с бургер-кнопкой Sidebar */}
      <header className="fixed top-0 left-0 right-0 lg:static z-40 flex items-center justify-between px-4 py-4 border-b border-gray-800 min-h-[64px] bg-gray-950">
        {/* На мобильном — пустое место слева (бургер-меню из Sidebar), на десктопе — заголовок */}
        <div className="flex items-center gap-3">
          <span className="text-white font-semibold text-sm hidden lg:block">
            Режим модератора
          </span>
        </div>
        <div className="flex items-center gap-2">
          {user && isAdmin(user.role) && (
            <button
              onClick={handleSwitchToLibrary}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg text-sm transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 10h16M4 14h16M4 18h16"
                />
              </svg>
              <span>Библиотека</span>
            </button>
          )}
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 text-gray-500 hover:text-gray-300 text-sm transition-colors"
          >
            Выйти
          </button>
        </div>
      </header>

      {/* Контент — pt-16 на мобильном компенсирует fixed header */}
      <main className="flex-1 flex flex-col items-center justify-center px-3 pt-16 lg:pt-0">
        {queueEmpty || !modTrack ? (
          <div className="text-center">
            <div className="text-4xl mb-4">🎵</div>
            <h2 className="text-lg font-semibold text-white mb-2">
              Очередь пуста
            </h2>
            <p className="text-gray-500 text-sm mb-6">
              Новые треки для модерации не найдены. Загляните позже.
            </p>
            <button
              onClick={loadNextTrack}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
            >
              Обновить
            </button>
          </div>
        ) : (
          <div className="w-full" style={{ maxWidth: "min(100%, 448px)" }}>
            {/* Инфо о треке */}
            <div className="mb-4 text-center px-1">
              <h1 className="text-lg font-bold text-white mb-1 break-words leading-tight">
                {modTrack.metaTitle || modTrack.title}
              </h1>
              <p className="text-gray-400 text-xs">
                {(modTrack.metaArtist || modTrack.artist) && (
                  <span className="break-words">{modTrack.metaArtist || modTrack.artist} · </span>
                )}
                <span>BPM: {modTrack.bpm}</span>
              </p>
            </div>

            {/* Beat counter */}
            <div className="bg-gray-900 border border-gray-700 rounded-2xl px-4 py-6 mb-3">
              <BeatCounter
                currentBeat={currentBeat - 1}
                isBridge={isBridgeBeat}
                displayMode="inline"
              />
            </div>

            {/* Плеер */}
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 mb-3">
              {/* Прогресс */}
              <div className="mb-4">
                <div
                  ref={progressRef}
                  onClick={handleProgressClick}
                  className="w-full h-4 bg-gray-700 rounded-full cursor-pointer relative"
                >
                  <div
                    className="absolute top-0 left-0 h-full bg-purple-500 rounded-full pointer-events-none"
                    style={{
                      width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-1.5">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Управление */}
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={rewind}
                  className="w-14 h-14 flex items-center justify-center text-gray-400 hover:text-white transition-colors rounded-full active:bg-gray-700"
                  title="-10 сек"
                >
                  <svg
                    className="w-10 h-10"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"
                    />
                  </svg>
                </button>
                <button
                  onClick={togglePlay}
                  disabled={!trackReady}
                  className={`w-16 h-16 rounded-full flex items-center justify-center text-white transition-colors shadow-lg ${trackReady ? "bg-purple-600 hover:bg-purple-500 active:bg-purple-700" : "bg-purple-600/50 cursor-not-allowed"}`}
                >
                  {isPlaying ? (
                    <svg
                      className="w-7 h-7"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                  ) : (
                    <svg
                      className="w-7 h-7 ml-0.5"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => {
                    if (!trackReady) return;
                    audioEngine.stop();
                    usePlayerStore.setState({ isPlaying: false, currentTime: 0 });
                  }}
                  disabled={!trackReady}
                  className="w-14 h-14 flex items-center justify-center text-gray-400 hover:text-white transition-colors rounded-full active:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Стоп"
                >
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="1" />
                  </svg>
                </button>
                <button
                  onClick={forward}
                  className="w-14 h-14 flex items-center justify-center text-gray-400 hover:text-white transition-colors rounded-full active:bg-gray-700"
                  title="+10 сек"
                >
                  <svg
                    className="w-10 h-10"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Слайдеры + режим голоса */}
            <div className="bg-gray-900 border border-gray-700 rounded-2xl px-4 py-4 mb-4 space-y-5">
              {/* Музыка */}
              <div className="flex items-center gap-3">
                <span className="text-gray-500 text-xs w-12 shrink-0">
                  Музыка
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={musicVolume}
                  onChange={(e) => setMusicVolume(Number(e.target.value))}
                  className="flex-1 min-w-0 h-2 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #a855f7 ${musicVolume}%, #374151 ${musicVolume}%)`,
                  }}
                />
                <span className="text-gray-400 text-xs w-7 text-right shrink-0">
                  {musicVolume}%
                </span>
              </div>
              {/* Режим счёта */}
              <div className="flex items-start gap-3">
                <span className="text-gray-500 text-xs w-12 shrink-0 pt-2">
                  Счёт
                </span>
                <div className="flex flex-wrap gap-2">
                  {VOICE_FILTERS.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setVoiceFilter(value)}
                      className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                        (voiceFilter ?? "on1") === value
                          ? "bg-purple-700 text-white"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Громкость счёта */}
              <div className="flex items-center gap-3">
                <span className="text-gray-500 text-xs w-12 shrink-0">
                  Голос
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={voiceVolume}
                  onChange={(e) => setVoiceVolume(Number(e.target.value))}
                  className="flex-1 min-w-0 h-2 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #a855f7 ${voiceVolume}%, #374151 ${voiceVolume}%)`,
                  }}
                />
                <span className="text-gray-400 text-xs w-7 text-right shrink-0">
                  {voiceVolume}%
                </span>
              </div>
            </div>

            {/* Кнопка оценки */}
            <button
              onClick={() => setShowModal(true)}
              className="w-full py-3.5 bg-purple-700 hover:bg-purple-600 text-white font-semibold rounded-2xl transition-colors text-sm flex items-center justify-center gap-2"
            >
              <span>🎧</span> Оценить раскладку
            </button>

            {/* Не бачата */}
            <button
              onClick={handleNotBachata}
              disabled={isMarkingNotBachata}
              className="w-full mt-2 py-3 bg-gray-800 border border-gray-700 text-gray-400 hover:text-red-400 hover:border-red-800 rounded-2xl transition-colors text-sm disabled:opacity-40"
            >
              {isMarkingNotBachata ? "Отправка..." : "Это не бачата"}
            </button>
          </div>
        )}
      </main>

      {/* Модалка вердикта */}
      {showModal && modQueueId && (
        <VerdictModal
          modQueueId={modQueueId}
          onClose={handleReplayFromStart}
          onDismiss={() => setShowModal(false)}
          onFinal={loadNextTrack}
          onSwap={handleSwap}
        />
      )}
    </div>
  );
}
