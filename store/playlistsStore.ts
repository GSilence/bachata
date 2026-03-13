import { create } from "zustand";

interface PlaylistInfo {
  id: number;
  name: string;
  trackCount: number;
}

interface PlaylistsState {
  playlists: PlaylistInfo[];
  trackIds: Record<number, Set<number>>; // playlistId → trackId set
  fetched: boolean;
  fetch: () => Promise<void>;
  create: (name: string) => Promise<PlaylistInfo | null>;
  remove: (id: number) => Promise<boolean>;
  addTrack: (playlistId: number, trackId: number) => Promise<boolean>;
  removeTrack: (playlistId: number, trackId: number) => Promise<boolean>;
  fetchTrackIds: (playlistId: number) => Promise<void>;
  reset: () => void;
}

export const usePlaylistsStore = create<PlaylistsState>((set, get) => ({
  playlists: [],
  trackIds: {},
  fetched: false,

  fetch: async () => {
    try {
      const res = await fetch("/api/playlists");
      if (!res.ok) return;
      const data = await res.json();
      set({ playlists: data.playlists ?? [], fetched: true });
    } catch {
      // silent
    }
  },

  create: async (name: string) => {
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return null;
      const pl = await res.json();
      const newPl = { id: pl.id, name: pl.name, trackCount: 0 };
      set((s) => ({ playlists: [newPl, ...s.playlists] }));
      return newPl;
    } catch {
      return null;
    }
  },

  remove: async (id: number) => {
    try {
      const res = await fetch(`/api/playlists?id=${id}`, { method: "DELETE" });
      if (!res.ok) return false;
      set((s) => ({
        playlists: s.playlists.filter((p) => p.id !== id),
        trackIds: Object.fromEntries(Object.entries(s.trackIds).filter(([k]) => Number(k) !== id)),
      }));
      return true;
    } catch {
      return false;
    }
  },

  addTrack: async (playlistId: number, trackId: number) => {
    try {
      const res = await fetch("/api/playlists/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId, trackId }),
      });
      if (!res.ok) return false;
      set((s) => {
        const newTrackIds = { ...s.trackIds };
        if (newTrackIds[playlistId]) {
          newTrackIds[playlistId] = new Set(newTrackIds[playlistId]);
          newTrackIds[playlistId].add(trackId);
        }
        return {
          trackIds: newTrackIds,
          playlists: s.playlists.map((p) =>
            p.id === playlistId ? { ...p, trackCount: p.trackCount + 1 } : p
          ),
        };
      });
      return true;
    } catch {
      return false;
    }
  },

  removeTrack: async (playlistId: number, trackId: number) => {
    try {
      const res = await fetch(`/api/playlists/tracks?playlistId=${playlistId}&trackId=${trackId}`, {
        method: "DELETE",
      });
      if (!res.ok) return false;
      set((s) => {
        const newTrackIds = { ...s.trackIds };
        if (newTrackIds[playlistId]) {
          newTrackIds[playlistId] = new Set(newTrackIds[playlistId]);
          newTrackIds[playlistId].delete(trackId);
        }
        return {
          trackIds: newTrackIds,
          playlists: s.playlists.map((p) =>
            p.id === playlistId ? { ...p, trackCount: Math.max(0, p.trackCount - 1) } : p
          ),
        };
      });
      return true;
    } catch {
      return false;
    }
  },

  fetchTrackIds: async (playlistId: number) => {
    try {
      const res = await fetch(`/api/playlists/tracks?playlistId=${playlistId}`);
      if (!res.ok) return;
      const data = await res.json();
      set((s) => ({
        trackIds: { ...s.trackIds, [playlistId]: new Set(data.trackIds ?? []) },
      }));
    } catch {
      // silent
    }
  },

  reset: () => set({ playlists: [], trackIds: {}, fetched: false }),
}));
