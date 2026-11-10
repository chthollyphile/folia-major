import { create } from 'zustand';

// src/stores/useLatticeControlsStore.ts
// The mounted wall publishes the visibility of its current-song chrome.
type LatticeControlsState = {
    isCurrentSongPosterVisible: boolean;
    setCurrentSongPosterVisible: (visible: boolean) => void;
};

export const useLatticeControlsStore = create<LatticeControlsState>(set => ({
    isCurrentSongPosterVisible: true,
    setCurrentSongPosterVisible: visible => set(state => (
        state.isCurrentSongPosterVisible === visible
            ? state
            : { isCurrentSongPosterVisible: visible }
    )),
}));

export const setLatticeCurrentSongPosterVisible = (visible: boolean) => (
    useLatticeControlsStore.getState().setCurrentSongPosterVisible(visible)
);
