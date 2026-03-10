"use client";

import { usePlayerStore } from "@/store/playerStore";
import { audioEngine } from "@/lib/audioEngine";
import { useEffect, useRef, useState } from "react";

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
  const musicVolume = usePlayerStore((s) => s.musicVolume);
  const voiceVolume = usePlayerStore((s) => s.voiceVolume);
  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
  const setMusicVolume = usePlayerStore((s) => s.setMusicVolume);
  const setVoiceVolume = usePlayerStore((s) => s.setVoiceVolume);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const setPlaybackRate = usePlayerStore((s) => s.setPlaybackRate);

  const [isDragging, setIsDragging] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const isInteractingRef = useRef(false);
  const limitTriggeredRef = useRef(false);
  const limitTriggeredForTrackIdRef = useRef<number | null>(null);

  // Синхронизируем лимит с audioEngine — он проверяет его внутри setInterval(16ms),
  // который продолжает работать при заблокированном экране и скрытой вкладке.
  useEffect(() => {
    audioEngine.setPlayUntilSeconds(playUntilSeconds ?? null);
  }, [playUntilSeconds]);

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
        // Переключаем по лимиту только если длительность известна и лимит в пределах трека (защита от сброса/глюков)
        if (
          limit != null &&
          limit > 0 &&
          dur >= limit &&
          time >= limit &&
          !limitTriggeredRef.current
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
    const endTime =
      playUntilSeconds != null && playUntilSeconds > 0
        ? Math.min(duration, playUntilSeconds)
        : duration;
    const newTime = Math.min(percentage * endTime, endTime);

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

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Effective end time: limit if "play until" is set, else full duration
  const effectiveDuration =
    playUntilSeconds != null && playUntilSeconds > 0
      ? Math.min(duration, playUntilSeconds)
      : duration;

  // Simple render: Use currentTime directly from store; cap progress by effective duration
  const progressPercentage =
    effectiveDuration > 0
      ? Math.min(100, (currentTime / effectiveDuration) * 100)
      : 0;

  return (
    <div className="space-y-4 sm:space-y-6" data-component="player-controls">
      {/* Play/Pause/Stop + Prev/Next Buttons */}
      <div className="flex justify-center items-center gap-2 sm:gap-3">
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
            <svg
              className="w-7 h-7 ml-0.5"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
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

      {/* Progress Bar */}
      <div className="space-y-2">
        <div
          ref={progressRef}
          onClick={handleProgressClick}
          className="w-full h-2 bg-gray-700 rounded-full cursor-pointer relative"
        >
          <div
            className="absolute top-0 left-0 h-full bg-purple-600 rounded-full"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        <div className="flex justify-between text-sm text-gray-400">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(effectiveDuration)}</span>
        </div>
      </div>

      {/* Volume Mixer */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Music Volume: {musicVolume}%
          </label>
          <div className="relative">
            <input
              type="range"
              min="0"
              max="100"
              value={musicVolume}
              onChange={(e) => {
                const vol = parseInt(e.target.value);
                setMusicVolume(vol); // Store method handles audioEngine sync
              }}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
              style={{
                background: `linear-gradient(to right, rgb(168, 85, 247) 0%, rgb(168, 85, 247) ${musicVolume}%, rgb(55, 65, 81) ${musicVolume}%, rgb(55, 65, 81) 100%)`,
              }}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Voice Volume: {voiceVolume}%
          </label>
          <div className="relative">
            <input
              type="range"
              min="0"
              max="100"
              value={voiceVolume}
              onChange={(e) => {
                const vol = parseInt(e.target.value);
                setVoiceVolume(vol);
              }}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
              style={{
                background: `linear-gradient(to right, rgb(168, 85, 247) 0%, rgb(168, 85, 247) ${voiceVolume}%, rgb(55, 65, 81) ${voiceVolume}%, rgb(55, 65, 81) 100%)`,
              }}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Speed: {Math.round(playbackRate * 100)}%
          </label>
          <div className="relative">
            <input
              type="range"
              min="50"
              max="150"
              step="5"
              value={Math.round(playbackRate * 100)}
              onChange={(e) => {
                setPlaybackRate(parseInt(e.target.value) / 100);
              }}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
              style={{
                background: (() => {
                  const pct = ((playbackRate * 100 - 50) / 100) * 100;
                  return `linear-gradient(to right, rgb(168, 85, 247) 0%, rgb(168, 85, 247) ${pct}%, rgb(55, 65, 81) ${pct}%, rgb(55, 65, 81) 100%)`;
                })(),
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
