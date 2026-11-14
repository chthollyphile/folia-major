import { LYRIC_SOURCES } from '../../utils/lyrics/lyricSources';
import { getSourceDeclaration } from './sourceDeclarations';

// src/services/onlineMusic/sourceStates.ts
// The state of each online source as the user switched it (Folium 2.0 plan §5.3): enabled, used only for
// matching, or disabled. The table lives in the main process (electron/modSystem/modSystem.cjs, the
// mod-system store); the main window's mod runtime hands it here (src/mods/runtime/sourceStatesSync.ts) as it
// arrives and each time it changes. No record reads as enabled, so before the table arrives, in the web build
// and for every source nobody switched, a source is enabled.

export type SourceState = 'enabled' | 'matching' | 'disabled';

const SOURCE_STATE_VALUES: readonly SourceState[] = ['enabled', 'matching', 'disabled'];

let states: Readonly<Record<string, SourceState>> = Object.freeze({});
// Bumped by every real change of the table, for the lists that follow it (omni's provider lists).
let statesVersion = 0;
const listeners = new Set<() => void>();

/** The state of `sourceId`: its record, or 'enabled' without one. */
export const getSourceState = (sourceId: string): SourceState => states[sourceId] ?? 'enabled';

/** The whole table as last handed in (only the sources that have a record, or that the main process listed). */
export const getSourceStates = (): Readonly<Record<string, SourceState>> => states;

/** Replaces the table; anything that is not one of the three states is left out. Listeners hear a real change. */
export const setSourceStates = (next: Readonly<Record<string, unknown>> | null | undefined): void => {
    const cleaned: Record<string, SourceState> = {};
    Object.entries(next ?? {}).forEach(([sourceId, state]) => {
        if (SOURCE_STATE_VALUES.includes(state as SourceState)) cleaned[sourceId] = state as SourceState;
    });
    const before = JSON.stringify(states);
    states = Object.freeze(cleaned);
    if (JSON.stringify(states) === before) return;
    statesVersion += 1;
    listeners.forEach((listener) => {
        try {
            listener();
        } catch (error) {
            console.warn('[sourceStates] a listener failed', error);
        }
    });
};

/** Bumped by every real change of the table. */
export const getSourceStatesVersion = (): number => statesVersion;

/** Calls `listener` whenever the table changes; returns the function that stops it. */
export const subscribeSourceStates = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/**
 * Whether `sourceId` may be used only for matching (plan §5.3): it can match lyrics for other platforms' songs
 * and local songs, or give local songs online details, without anyone signed in.
 *
 * A Folium 2 source mod says so through its capabilities (sourceDeclarations.ts: `lyrics@1.crossSource` or
 * `songs@1.metadataMatch`, each with `access: 'anonymous'`). A built-in platform, still registered by the host,
 * is read from S1's lyric source registry (an entry of that platform that needs no account, or that does the
 * metadata match).
 */
export const canSourceMatchOnly = (sourceId: string): boolean => {
    const declaration = getSourceDeclaration(sourceId);
    if (declaration) {
        return Boolean(declaration.lyrics?.crossSource && declaration.lyrics.access === 'anonymous')
            || Boolean(declaration.songs?.metadataMatch && declaration.songs.access === 'anonymous');
    }
    return LYRIC_SOURCES.some((source) => (
        source.platform && source.id === sourceId && (Boolean(source.metadataMatch) || !source.needsAccount)
    ));
};
