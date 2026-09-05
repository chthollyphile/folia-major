import { create } from 'zustand';
import { getStoredBoolean } from './storagePrimitives';

// src/stores/useLatticeSettingsStore.ts
// How the queue collage surface looks. Deliberately separate from useLatticeControlsStore: that one
// publishes the mounted wall's runtime actions, this one holds what the user configured about it and
// therefore travels with the appearance config.

export type LatticeSettingsState = {
    latticeVignette: boolean;
    handleToggleLatticeVignette: (enabled: boolean) => void;
};

export const useLatticeSettingsStore = create<LatticeSettingsState>(set => ({
    latticeVignette: getStoredBoolean('lattice_vignette', true),
    handleToggleLatticeVignette: (enabled) => {
        set({ latticeVignette: enabled });
        if (typeof window !== 'undefined') localStorage.setItem('lattice_vignette', enabled.toString());
    },
}));
