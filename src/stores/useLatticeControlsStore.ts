import { create } from 'zustand';

// src/stores/useLatticeControlsStore.ts
// The mounted wall publishes its focus action for the panel and scoped palette command.
type LatticeControlsState = {
    focusCurrentSong: (() => void) | null;
    registerFocus: (action: (() => void) | null) => () => void;
};

export const useLatticeControlsStore = create<LatticeControlsState>((set, get) => ({
    focusCurrentSong: null,
    registerFocus: action => {
        set({ focusCurrentSong: action });
        return () => {
            if (get().focusCurrentSong === action) set({ focusCurrentSong: null });
        };
    },
}));

export const focusLatticeCurrentSong = () => {
    const action = useLatticeControlsStore.getState().focusCurrentSong;
    if (!action) return false;
    action();
    return true;
};
