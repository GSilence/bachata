"use client";

import { usePlayerStore } from "@/store/playerStore";
import { audioEngine } from "@/lib/audioEngine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WaveformBar from "@/components/WaveformBar";

interface PlayerControlsProps {
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
}

export default function PlayerControls({
  onPlay,
  onPause,
  onStop,
}: PlayerControlsProps) {
  // ── Zustand selectors — подписка только на нужные поля ──
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const playUntilSeconds = usePlayerStore((s) => s.playUntilSeconds);
  const loopStartSeconds = usePlayerStore((s) => s.loopStartSeconds);
  const loopPauseSeconds = usePlayerStore((s) => s.loopPauseSeconds);
  const musicVolume = usePlayerStore((s) => s.musicVolume);
  const voiceVolume = usePlayerStore((s) => s.voiceVolume);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setMusicVolume = usePlayerStore((s) => s.setMusicVolume);
  const setVoiceVolume = usePlayerStore((s) => s.setVoiceVolume);
  const setLoopStartSeconds = usePlayerStore((s) => s.setLoopStartSeconds);
  const setPlayUntilSeconds = usePlayerStore((s) => s.setPlayUntilSeconds);
  const playMode = usePlayerStore((s) => s.playMode);
  const setPlayMode = usePlayerStore((s) => s.setPlayMode);

  const [isDragging, setIsDragging] = useState(false);
  const [openVolume, setOpenVolume] = useState<"music" | "voice" | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const volumeAreaRef = useRef<HTMLDivElement>(null);
  const isInteractingRef = useRef(false);
  const limitTriggeredRef = useRef(false);
  const limitTriggeredForTrackIdRef = useRef<number | null>(null);
  // Какой маркер тянем: "start" | "end" | null
  const draggingMarkerRef = useRef<"start" | "end" | null>(null);

  // Синхронизируем параметры цикла с audioEngine — он проверяет их внутри setInterval(16ms),
  // который продолжает работать при заблокированном экране и скрытой вкладке.
  useEffect(() => {
    audioEngine.setPlayUntilSeconds(playUntilSeconds ?? null);
  }, [playUntilSeconds]);
  useEffect(() => {
    audioEngine.setLoopStartSeconds(loopStartSeconds ?? null);
  }, [loopStartSeconds]);
  useEffect(() => {
    audioEngine.setLoopPauseSeconds(loopPauseSeconds ?? null);
  }, [loopPauseSeconds]);

  // Smart Update Loop - Only updates when NOT interacting
  useEffect(() => {
    let rafId: number;

    const updateLoop = () => {
      const state = usePlayerStore.getState();

      // Always update duration (even when paused) so progress bar is visible
      const dur = audioEngine.getDuration();
      if (dur > 0 && dur !== state.duration) {
        usePlayerStore.setState({ duration: dur });
      }

      // CRITICAL: Only update currentTime if NOT dragging, NOT interacting, AND playing
      // This ensures the engine never overwrites the UI during user interactions
      if (!isDragging && !isInteractingRef.current && state.isPlaying) {
        const time = audioEngine.getCurrentTime();
        state.setCurrentTime(time);

        const limit = state.playUntilSeconds;
        const dur = state.duration;
        const hasLoopStart = state.loopStartSeconds != null;
        // Переключаем по лимиту только если длительность известна и лимит в пределах трека.
        // Если задан loopStart — цикл обрабатывается в audioEngine, PlayerControls не вмешивается.
        if (
          limit != null &&
          limit > 0 &&
          dur >= limit &&
          time >= limit &&
          !limitTriggeredRef.current &&
          !hasLoopStart
        ) {
          limitTriggeredRef.current = true;
          limitTriggeredForTrackIdRef.current = state.currentTrack?.id ?? null;
          state.playNext();
        } else if (limit == null || limit <= 0 || time < limit) {
          limitTriggeredRef.current = false;
          limitTriggeredForTrackIdRef.current = null;
        }
      }

      // Сброс флага лимита при смене трека (на случай, если playNext не вызвался)
      const currentTrackId = state.currentTrack?.id ?? null;
      if (
        limitTriggeredForTrackIdRef.current !== null &&
        currentTrackId !== limitTriggeredForTrackIdRef.current
      ) {
        limitTriggeredRef.current = false;
        limitTriggeredForTrackIdRef.current = null;
      }

      rafId = requestAnimationFrame(updateLoop);
    };

    rafId = requestAnimationFrame(updateLoop);
    return () => cancelAnimationFrame(rafId);
  }, [isDragging]);

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !currentTrack || duration === 0) return;

    // STEP 1: Set interaction lock to prevent updateLoop from overwriting
    isInteractingRef.current = true;

    // STEP 2: Calculate new time from click position
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const percentage = Math.max(0, Math.min(1, x / width));
    const newTime = percentage * duration;

    // STEP 3: Optimistically update store (instant visual feedback)
    setCurrentTime(newTime);

    // STEP 4: Command the engine to seek
    audioEngine.seek(newTime);

    // STEP 5: Release interaction lock after cooldown (200ms immunity)
    // This allows AudioEngine enough time to physically process the seek
    setTimeout(() => {
      isInteractingRef.current = false;
    }, 200);
  };

  // ── Drag markers ──
  const calcTimeFromX = useCallback(
    (clientX: number): number => {
      if (!progressRef.current || duration === 0) return 0;
      const rect = progressRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(pct * duration); // целые секунды
    },
    [duration],
  );

  const handleMarkerDragStart = useCallback(
    (which: "start" | "end") => (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation(); // не трогаем handleProgressClick
      e.preventDefault();
      draggingMarkerRef.current = which;
      setIsDragging(true);
      isInteractingRef.current = true;
    },
    [],
  );

  useEffect(() => {
    const onMove = (clientX: number) => {
      const which = draggingMarkerRef.current;
      if (!which) return;
      const time = calcTimeFromX(clientX);
      if (which === "start") {
        setLoopStartSeconds(time > 0 ? time : null);
      } else {
        setPlayUntilSeconds(time > 0 ? time : null);
      }
    };

    const handleMouseMove = (e: MouseEvent) => onMove(e.clientX);
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) onMove(e.touches[0].clientX);
    };

    const handleEnd = () => {
      if (!draggingMarkerRef.current) return;
      draggingMarkerRef.current = null;
      setIsDragging(false);
      setTimeout(() => { isInteractingRef.current = false; }, 200);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleEnd);
    window.addEventListener("touchcancel", handleEnd);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleEnd);
      window.removeEventListener("touchcancel", handleEnd);
    };
  }, [calcTimeFromX, setLoopStartSeconds, setPlayUntilSeconds]);

  // Close volume popup on outside click
  useEffect(() => {
    if (!openVolume) return;
    const handler = (e: MouseEvent) => {
      if (volumeAreaRef.current && !volumeAreaRef.current.contains(e.target as Node)) {
        setOpenVolume(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openVolume]);

  const cyclePlayMode = useCallback(() => {
    const modes = ["sequential", "random", "loop"] as const;
    const idx = modes.indexOf(playMode as typeof modes[number]);
    setPlayMode(modes[(idx + 1) % modes.length]);
  }, [playMode, setPlayMode]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Progress across full track duration
  const progressPercentage =
    duration > 0
      ? Math.min(100, (currentTime / duration) * 100)
      : 0;

  // Waveform peaks — parsed once per track change
  const waveformPeaks = useMemo<number[] | null>(() => {
    const raw = currentTrack?.waveformData;
    if (!raw) return null;
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) && arr.length > 0 ? arr : null;
    } catch {
      return null;
    }
  }, [currentTrack?.waveformData]);

  // Loop marker positions (percentage of full duration)
  const loopStartPct =
    loopStartSeconds != null && loopStartSeconds > 0 && duration > 0
      ? Math.min(100, (loopStartSeconds / duration) * 100)
      : null;
  const loopEndPct =
    playUntilSeconds != null && playUntilSeconds > 0 && duration > 0
      ? Math.min(100, (playUntilSeconds / duration) * 100)
      : null;

  return (
    <div className="space-y-4 sm:space-y-5" data-component="player-controls">
      {/* Progress Bar */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {/* Текущее время */}
          <span className="text-sm text-gray-400 tabular-nums shrink-0">
            {formatTime(currentTime)}
          </span>

          {/* Полоса прогресса */}
          <div
            ref={progressRef}
            onClick={handleProgressClick}
            className={`flex-1 cursor-pointer relative rounded-full ${
              waveformPeaks ? "h-10" : "h-2 bg-gray-700"
            }`}
          >
            {waveformPeaks ? (
              <WaveformBar
                peaks={waveformPeaks}
                progress={duration > 0 ? currentTime / duration : 0}
                loopStartPct={loopStartPct}
                loopEndPct={loopEndPct}
              />
            ) : (
              <>
                {loopStartPct != null && loopEndPct != null && (
                  <div
                    className="absolute top-0 h-full bg-yellow-500/20 rounded-full"
                    style={{ left: `${loopStartPct}%`, width: `${loopEndPct - loopStartPct}%` }}
                  />
                )}
                <div
                  className="absolute top-0 left-0 h-full bg-purple-600 rounded-full"
                  style={{ width: `${progressPercentage}%` }}
                />
              </>
            )}
            {loopStartPct != null && (
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none z-10"
                style={{ left: `${loopStartPct}%` }}
                title={`Начало: ${formatTime(loopStartSeconds ?? 0)}`}
                onMouseDown={handleMarkerDragStart("start")}
                onTouchStart={handleMarkerDragStart("start")}
              >
                <div className="w-0.5 h-4 bg-yellow-400 rounded-full pointer-events-none" />
              </div>
            )}
            {loopEndPct != null && (
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none z-10"
                style={{ left: `${loopEndPct}%` }}
                title={`Конец: ${formatTime(playUntilSeconds ?? 0)}`}
                onMouseDown={handleMarkerDragStart("end")}
                onTouchStart={handleMarkerDragStart("end")}
              >
                <div className="w-0.5 h-4 bg-yellow-400 rounded-full pointer-events-none" />
              </div>
            )}
          </div>

          {/* Длительность */}
          <span className="text-sm text-gray-400 tabular-nums shrink-0">
            {formatTime(duration)}
          </span>
        </div>

        {/* Метки времени маркеров (только когда есть) */}
        {(loopStartPct != null || loopEndPct != null) && (
          <div className="relative h-3 px-11">
            {loopStartPct != null && (
              <span
                className="absolute text-[10px] text-yellow-400/60 -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${loopStartPct}%` }}
              >
                {formatTime(loopStartSeconds ?? 0)}
              </span>
            )}
            {loopEndPct != null && (
              <span
                className="absolute text-[10px] text-yellow-400/60 -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${loopEndPct}%` }}
              >
                {formatTime(playUntilSeconds ?? 0)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Controls row: [PlayMode] [Prev/Play/Stop/Next] [Volume buttons] */}
      <div className="flex items-center">
        {/* Left: Play mode cycling button */}
        <div className="shrink-0 w-11">
          <button
            onClick={cyclePlayMode}
            title={
              playMode === "sequential" ? "По порядку"
              : playMode === "random" ? "Перемешать"
              : "Повторить"
            }
            className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${
              playMode === "sequential"
                ? "text-gray-400 hover:text-white"
                : "text-purple-400 hover:text-purple-300"
            }`}
          >
            {playMode === "sequential" && (
              /* По порядку: list arrows */
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h12M3 12h9m-9 5h6M17 5l3 3-3 3M17 16l3 3-3 3" />
              </svg>
            )}
            {playMode === "random" && (
              /* Перемешать: shuffle */
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 3h5v5M4 20l16-16M16 21h5v-5M4 4l7 7" />
              </svg>
            )}
            {playMode === "loop" && (
              /* Повторить: loop */
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3" />
              </svg>
            )}
          </button>
        </div>

        {/* Center: transport buttons */}
        <div className="flex-1 flex justify-center items-center gap-2 sm:gap-3">
          {/* Предыдущий трек */}
          <button
            onClick={() => usePlayerStore.getState().playPrevious()}
            disabled={!currentTrack}
            className={`w-11 h-11 sm:w-12 sm:h-12 flex items-center justify-center rounded-full transition-colors ${
              !currentTrack
                ? "text-gray-600 cursor-not-allowed"
                : "text-gray-400 hover:text-white active:bg-gray-700"
            }`}
            aria-label="Previous"
            title="Предыдущий трек"
          >
            <svg className="w-7 h-7 sm:w-8 sm:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
            </svg>
          </button>

          {/* Play/Pause */}
          <button
            onClick={isPlaying ? onPause : onPlay}
            disabled={!currentTrack}
            className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center transition-colors shadow-lg ${
              !currentTrack
                ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                : "bg-purple-600 text-white hover:bg-purple-700"
            }`}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-7 h-7 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Stop */}
          <button
            onClick={onStop}
            disabled={!currentTrack}
            className={`w-11 h-11 sm:w-12 sm:h-12 flex items-center justify-center rounded-full transition-colors ${
              !currentTrack
                ? "text-gray-600 cursor-not-allowed"
                : "text-gray-400 hover:text-white active:bg-gray-700"
            }`}
            aria-label="Stop"
            title="Стоп"
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>

          {/* Следующий трек */}
          <button
            onClick={() => usePlayerStore.getState().playNext()}
            disabled={!currentTrack}
            className={`w-11 h-11 sm:w-12 sm:h-12 flex items-center justify-center rounded-full transition-colors ${
              !currentTrack
                ? "text-gray-600 cursor-not-allowed"
                : "text-gray-400 hover:text-white active:bg-gray-700"
            }`}
            aria-label="Next"
            title="Следующий трек"
          >
            <svg className="w-7 h-7 sm:w-8 sm:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
            </svg>
          </button>
        </div>

        {/* Right: Volume popup buttons */}
        <div ref={volumeAreaRef} className="shrink-0 flex items-center gap-1">
          {/* Music volume */}
          <div className="relative">
            <button
              onClick={() => setOpenVolume(openVolume === "music" ? null : "music")}
              title={`Музыка: ${musicVolume}%`}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${
                openVolume === "music" ? "text-purple-400 bg-gray-700" : "text-gray-400 hover:text-white"
              }`}
            >
              {/* Music note icon */}
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9 3v10.55A4 4 0 1 0 11 17V7h4V3H9z"/>
              </svg>
            </button>
            {openVolume === "music" && (
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-600 rounded-xl shadow-2xl py-3 px-2 flex flex-col items-center gap-2 z-50" style={{ width: "52px" }}>
                <span className="text-xs text-gray-400 tabular-nums leading-none">{musicVolume}%</span>
                <div className="flex items-center justify-center" style={{ height: "110px", width: "28px" }}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={musicVolume}
                    onChange={(e) => setMusicVolume(parseInt(e.target.value))}
                    style={{
                      width: "100px",
                      height: "4px",
                      transform: "rotate(-90deg)",
                      accentColor: "rgb(168, 85, 247)",
                      cursor: "pointer",
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Voice volume */}
          <div className="relative">
            <button
              onClick={() => setOpenVolume(openVolume === "voice" ? null : "voice")}
              title={`Голос: ${voiceVolume}%`}
              className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${
                openVolume === "voice" ? "text-purple-400 bg-gray-700" : "text-gray-400 hover:text-white"
              }`}
            >
              {/* Speaking person icon */}
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="8" cy="6" r="3.5"/>
                <path d="M2 19.5c0-3.6 2.7-6.5 6-6.5 1.4 0 2.7.5 3.7 1.4"/>
                <path d="M15 10.5a3 3 0 000-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                <path d="M17.5 12.5a6 6 0 000-9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
              </svg>
            </button>
            {openVolume === "voice" && (
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-600 rounded-xl shadow-2xl py-3 px-2 flex flex-col items-center gap-2 z-50" style={{ width: "52px" }}>
                <span className="text-xs text-gray-400 tabular-nums leading-none">{voiceVolume}%</span>
                <div className="flex items-center justify-center" style={{ height: "110px", width: "28px" }}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={voiceVolume}
                    onChange={(e) => setVoiceVolume(parseInt(e.target.value))}
                    style={{
                      width: "100px",
                      height: "4px",
                      transform: "rotate(-90deg)",
                      accentColor: "rgb(168, 85, 247)",
                      cursor: "pointer",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
