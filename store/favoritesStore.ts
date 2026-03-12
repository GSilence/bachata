import { create } from "zustand";

interface FavoritesState {
  favoriteIds: Set<number>;
  /** Fetch current user's favorites from API and populate the set */
  init: () => Promise<void>;
  /** Optimistic toggle + API call */
  toggle: (trackId: number) => Promise<void>;
  /** Clear on logout */
  reset: () => void;
}

export const useFavoritesStore = create<FavoritesState>()((set, get) => ({
  favoriteIds: new Set<number>(),

  init: async () => {
    try {
      const res = await fetch("/api/playlists/favorites/tracks");
      if (res.ok) {
        const data = await res.json();
        set({ favoriteIds: new Set<number>(data.trackIds ?? []) });
      }
    } catch {}
  },

  toggle: async (trackId: number) => {
    const { favoriteIds } = get();
    const wasFav = favoriteIds.has(trackId);

    // Optimistic update
    const next = new Set(favoriteIds);
    if (wasFav) next.delete(trackId); else next.add(trackId);
    set({ favoriteIds: next });

    try {
      if (wasFav) {
        await fetch(`/api/playlists/favorites/tracks?trackId=${trackId}`, { method: "DELETE" });
      } else {
        await fetch("/api/playlists/favorites/tracks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackId }),
        });
      }
    } catch {
      // Rollback
      set({ favoriteIds });
    }
  },

  reset: () => set({ favoriteIds: new Set<number>() }),
}));
