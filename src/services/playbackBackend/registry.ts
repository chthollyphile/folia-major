import type { PlaybackBackendDefinition } from './types';

// Only registration and explicit selection live here; decoding and DSP belong to extensions.

export interface PlaybackBackendEntry {
    id: string;
    definition: PlaybackBackendDefinition;
}

const entries = new Map<string, PlaybackBackendEntry>();
const listeners = new Set<() => void>();
let snapshot: readonly PlaybackBackendEntry[] = [];
let selected: string | null = null;

const notify = () => {
    snapshot = Object.freeze([...entries.values()]);
    listeners.forEach(listener => listener());
};

export const subscribePlaybackBackends = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export const listPlaybackBackends = () => snapshot;
export const selectedPlaybackBackend = () => selected;
export const getPlaybackBackend = () => selected ? entries.get(selected) ?? null : null;

/** Selection is session-only: enabling a mod must never seize the audio device. */
export const selectPlaybackBackend = (id: string | null) => {
    if (id !== null && !entries.has(id)) throw new Error('playback-backend-not-found');
    if (selected === id) return;
    selected = id;
    notify();
};

export const registerPlaybackBackend = (id: string, definition: PlaybackBackendDefinition) => {
    if (entries.has(id)) throw new Error(`duplicate-playback-backend:${id}`);
    if (!definition?.name || typeof definition.create !== 'function') throw new TypeError('invalid-playback-backend');
    for (const capability of ['seek', 'volume', 'http'] as const) {
        if (typeof definition.capabilities?.[capability] !== 'boolean') throw new TypeError(`invalid-backend-capability:${capability}`);
    }
    const entry = { id, definition };
    entries.set(id, entry);
    notify();
    return () => {
        if (entries.get(id) !== entry) return;
        entries.delete(id);
        // Keep the missing selection: the host pauses, never silently changes the output path.
        notify();
    };
};
