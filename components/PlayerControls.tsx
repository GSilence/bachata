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
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    musicVolume,
    voiceVolume,
    setCurrentTime,
    setMusicVolume,
    setVoiceVolume,
  } = usePlayerStore();

  const [isDragging, setIsDragging] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const isInteractingRef = useRef(false); // Interaction lock to prevent race conditions

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
        // Update store directly to drive UI
        state.setCurrentTime(time);
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

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Simple render: Use currentTime directly from store
  // No local state conflicts - single source of truth
  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div 
      className="space-y-4 sm:space-y-6"
      data-component="player-controls"
    >
      {/* Play/Pause/Stop Buttons */}
      <div className="flex justify-center items-center gap-3 sm:gap-4">
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
            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6 4h4v12H6V4zm4 0h4v12h-4V4z" />
            </svg>
          ) : (
            <svg
              className="w-8 h-8 ml-1"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
            </svg>
          )}
        </button>

        <button
          onClick={onStop}
          disabled={!currentTrack}
          className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-colors shadow-lg ${
            !currentTrack
              ? "bg-gray-600 text-gray-400 cursor-not-allowed"
              : "bg-red-600 text-white hover:bg-red-700"
          }`}
          aria-label="Stop"
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
            <path d="M4 4h12v12H4V4z" />
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
            className="absolute top-0 left-0 h-full bg-purple-600 rounded-full transition-all"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        <div className="flex justify-between text-sm text-gray-400">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
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
      </div>
    </div>
  );
}
