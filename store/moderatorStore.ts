import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ModeratorState {
  isModerating: boolean;
  /** Показывать ли модальное окно оценки (после окончания трека) */
  showRatingModal: boolean;
  /** ID трека, который нужно оценить */
  ratingTrackId: number | null;
  isAdminMode: boolean;

  enterModeratorMode: () => void;
  exitModeratorMode: () => void;
  openRatingModal: (trackId: number) => void;
  closeRatingModal: () => void;
  enterAdminMode: () => void;
  exitAdminMode: () => void;
}

export const useModeratorStore = create<ModeratorState>()(
  persist(
    (set) => ({
      isModerating: false,
      showRatingModal: false,
      ratingTrackId: null,
      isAdminMode: false,

      enterModeratorMode: () => set({ isModerating: true }),
      exitModeratorMode: () =>
        set({ isModerating: false, showRatingModal: false, ratingTrackId: null }),
      openRatingModal: (trackId) =>
        set({ showRatingModal: true, ratingTrackId: trackId }),
      closeRatingModal: () =>
        set({ showRatingModal: false, ratingTrackId: null }),
      enterAdminMode: () => set({ isAdminMode: true }),
      exitAdminMode: () => set({ isAdminMode: false }),
    }),
    {
      name: "moderator-store",
      partialize: (state) => ({ isAdminMode: state.isAdminMode }),
    }
  )
);
