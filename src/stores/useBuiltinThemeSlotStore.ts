import { create } from 'zustand';
import type { BuiltinThemeColorSlot, BuiltinThemeSlotPrefs } from '../utils/builtinTheme/generateBuiltinDualTheme';

// src/stores/useBuiltinThemeSlotStore.ts
// The cover-derived theme's per-slot colour source: which cover swatch each of the four theme
// colours takes its hue from. A slot at `null` keeps the generator's own choice; a number is the
// 1-based position in the cover's extracted colours (1 and 2 are the cover's dominant colours).
//
// This is the "customise where each of the four colours reads its recommended colour" asked for in
// #547: it is a persistent preference, applied every time a theme is generated from a cover.

const STORAGE_KEY = 'builtin_theme_color_slots';

const readStoredPrefs = (): BuiltinThemeSlotPrefs => {
    if (typeof window === 'undefined') {
        return {};
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return {};
    try {
        const parsed = JSON.parse(saved) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
        const result: BuiltinThemeSlotPrefs = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if ((key === 'backgroundColor' || key === 'primaryColor' || key === 'accentColor' || key === 'secondaryColor')
                && typeof value === 'number' && Number.isInteger(value) && value >= 1) {
                result[key] = value;
            }
        }
        return result;
    } catch {
        return {};
    }
};

type BuiltinThemeSlotState = {
    slotPrefs: BuiltinThemeSlotPrefs;
    setSlotPref: (slot: BuiltinThemeColorSlot, position: number | null) => void;
};

export const useBuiltinThemeSlotStore = create<BuiltinThemeSlotState>((set) => ({
    slotPrefs: readStoredPrefs(),
    setSlotPref: (slot, position) => {
        set((state) => {
            const next = { ...state.slotPrefs };
            if (position === null) {
                delete next[slot];
            } else {
                next[slot] = position;
            }
            if (typeof window !== 'undefined') {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            }
            return { slotPrefs: next };
        });
    },
}));
