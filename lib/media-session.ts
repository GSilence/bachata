/**
 * Media Session API: lock screen / notification controls and metadata.
 * Enables "Now Playing" and play/pause from background.
 */

import type { Track } from "@/types";

function isMediaSessionSupported(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

export function initMediaSession(handlers: {
  play: () => void;
  pause: () => void;
}) {
  if (!isMediaSessionSupported()) return;

  const { mediaSession } = navigator;

  try {
    mediaSession.setActionHandler("play", () => handlers.play());
    mediaSession.setActionHandler("pause", () => handlers.pause());
    mediaSession.setActionHandler("stop", () => {
      handlers.pause();
    });
    // next/prev — no-op or optional later
    mediaSession.setActionHandler("previoustrack", null);
    mediaSession.setActionHandler("nexttrack", null);
  } catch {
    // some browsers restrict setActionHandler
  }
}

export function setMediaSessionMetadata(
  track: Track | null,
  currentTime: number,
  duration: number,
) {
  if (!isMediaSessionSupported() || !track) return;

  try {
    if (typeof MediaMetadata !== "undefined") {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title ?? "Bachata",
        artist: track.artist ?? "Beat counter",
        album: "Bachata",
      });
    }
    if (
      typeof navigator.mediaSession.setPositionState === "function" &&
      Number.isFinite(duration) &&
      duration > 0
    ) {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.max(0, Math.min(currentTime, duration)),
      });
    }
  } catch {
    // ignore
  }
}

export function setMediaSessionPlaybackState(
  state: "playing" | "paused" | "none",
) {
  if (!isMediaSessionSupported()) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    // ignore
  }
}
