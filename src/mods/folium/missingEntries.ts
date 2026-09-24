import { useSyncExternalStore } from 'react';
import { hasVisualizerMode } from '@/components/visualizer/registry';
import { hasVisualizerBackgroundMode } from '@/components/visualizer/backgrounds/registry';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import { visualizersRegistry } from './registries/visualizers';
import { backgroundsRegistry } from './registries/backgrounds';

// src/mods/folium/missingEntries.ts
// Folium's answer to Forge's missing mappings: a saved selection that points at
// a mod entry (`mod:<modid>:<name>`) is never rewritten just because that mod is
// not running. The UI falls back to a builtin and says which mod the selection
// belongs to; once the mod registers the entry again, the selection comes back.
//
// Saved selections live in localStorage under the keys the settings store owns.
// The store validates them at load time (before any mod client ran), so the
// in-memory value may already be a builtin; localStorage keeps the original.

const VISUALIZER_MODE_KEY = 'visualizer_mode';
const BACKGROUND_MODE_KEY = 'visualizer_background_mode';

const readSaved = (key: string): string | null => {
    try {
        const saved = localStorage.getItem(key);
        return saved && saved.startsWith('mod:') ? saved : null;
    } catch {
        return null;
    }
};

/** `mod:<modid>:<name>` → `<modid>`. */
const ownerOf = (mode: string): string => mode.split(':')[1] ?? mode;

/*
 * Re-applies saved mod selections whose entries are registered now. Runs after
 * every client reconcile, so enabling a mod mid-session restores its mode too.
 * Uses notify:false: restoring is not a user action and must not toast.
 */
export const restoreSavedFoliumSelections = () => {
    try {
        const store = useVisualizerSettingsStore.getState();
        const visualizer = readSaved(VISUALIZER_MODE_KEY);
        if (visualizer && hasVisualizerMode(visualizer) && store.visualizerMode !== visualizer) {
            store.handleSetVisualizerMode(visualizer, { notify: false });
        }
        const background = readSaved(BACKGROUND_MODE_KEY);
        if (background && hasVisualizerBackgroundMode(background) && store.visualizerBackgroundMode !== background) {
            store.handleSetVisualizerBackgroundMode(background);
        }
    } catch {
        // Best-effort: a restore failure must never block startup or a reload.
    }
};

export interface MissingFoliumSelection {
    kind: 'visualizer' | 'background';
    mode: string;
    modId: string;
}

const subscribe = (listener: () => void) => {
    const offVisualizers = visualizersRegistry.subscribe(listener);
    const offBackgrounds = backgroundsRegistry.subscribe(listener);
    const offStore = useVisualizerSettingsStore.subscribe(listener);
    return () => {
        offVisualizers();
        offBackgrounds();
        offStore();
    };
};

let cachedKey = '';
let cachedValue: MissingFoliumSelection[] = [];

const readMissing = (): MissingFoliumSelection[] => {
    const missing: MissingFoliumSelection[] = [];
    const visualizer = readSaved(VISUALIZER_MODE_KEY);
    if (visualizer && !hasVisualizerMode(visualizer)) {
        missing.push({ kind: 'visualizer', mode: visualizer, modId: ownerOf(visualizer) });
    }
    const background = readSaved(BACKGROUND_MODE_KEY);
    if (background && !hasVisualizerBackgroundMode(background)) {
        missing.push({ kind: 'background', mode: background, modId: ownerOf(background) });
    }
    // Stable identity between changes so useSyncExternalStore does not loop.
    const key = missing.map((entry) => entry.mode).join('|');
    if (key !== cachedKey) {
        cachedKey = key;
        cachedValue = missing;
    }
    return cachedValue;
};

/** Saved mod selections whose mod is not providing the entry right now. */
export const useMissingFoliumSelections = (): MissingFoliumSelection[] => useSyncExternalStore(subscribe, readMissing, readMissing);
