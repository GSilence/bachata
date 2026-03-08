import type { Track } from "@/types";

/**
 * Подгружает полные данные трека (включая gridMap) с сервера.
 * Если gridMap уже есть — возвращает трек как есть.
 */
export async function fetchTrackFull(track: Track): Promise<Track> {
  if (track.gridMap != null) return track;

  try {
    const res = await fetch(`/api/tracks/${track.id}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return track;
    const full = await res.json();
    return { ...track, ...full };
  } catch {
    return track;
  }
}
