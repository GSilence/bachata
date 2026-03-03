import { create } from "zustand";

interface ModeratorState {
  isModerating: boolean;
  /** Показывать ли модальное окно оценки (после окончания трека) */
  showRatingModal: boolean;
  /** ID трека, который нужно оценить */
  ratingTrackId: number | null;

  enterModeratorMode: () => void;
  exitModeratorMode: () => void;
  openRatingModal: (trackId: number) => void;
  closeRatingModal: () => void;
}

export const useModeratorStore = create<ModeratorState>((set) => ({
  isModerating: false,
  showRatingModal: false,
  ratingTrackId: null,

  enterModeratorMode: () => set({ isModerating: true }),
  exitModeratorMode: () =>
    set({ isModerating: false, showRatingModal: false, ratingTrackId: null }),
  openRatingModal: (trackId) =>
    set({ showRatingModal: true, ratingTrackId: trackId }),
  closeRatingModal: () =>
    set({ showRatingModal: false, ratingTrackId: null }),
}));
