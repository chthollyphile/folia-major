import type { ModClearSourceDataResult, ModSourceState, ModSourceStatesPayload } from '../types';
import { invokeClearSourceData, invokeSetSourceState, subscribeSourcesStopping } from '../ipc';
import { canSourceMatchOnly, setSourceStates } from '@/services/onlineMusic/sourceStates';
import { PlayerState } from '@/types';
import { selectDisplaySong, usePlaybackStore } from '@/stores/usePlaybackStore';
import { getPlaybackSourceRef } from '@/utils/appPlaybackGuards';
import { pauseFoliumHostPlayback } from '../folium/services';
import { listStoredKeysStartingWith, removeStoredKey } from '@/stores/storagePrimitives';

// src/mods/runtime/sourceSwitches.ts
// The window's half of switching a source and of clearing its data (Folium 2.0 plan §5.2, §5.3). Before the main
// process unloads a source, the host stops what of it is playing (an external player or a surface is handed
// back first): whoever owns playback registers that step here (`registerSourcePlaybackStop`). Then the main
// process switches it: only its own mod reloads. "Clear data" also removes what the source keeps in this
// window's storage (its page store and cache keys). "Settings → Sources" (S8) calls these; S2 has no button.

type SourcePlaybackStop = (sourceIds: readonly string[]) => void | Promise<void>;

let stopPlayback: SourcePlaybackStop | null = null;

/** Who stops the playback of a source that is about to be unloaded; null takes the registration away. */
export const registerSourcePlaybackStop = (stop: SourcePlaybackStop | null): void => {
    stopPlayback = stop;
};

/**
 * The main window's default: when the displayed song is one of `sourceIds` and is playing, it is paused (an
 * external player pauses with it). Installed by mainWindowStart.ts; S6 adds handing a surface back.
 */
export const installDefaultSourcePlaybackStop = (): void => {
    registerSourcePlaybackStop((sourceIds) => {
        const state = usePlaybackStore.getState();
        const song = selectDisplaySong(state);
        if (!song || state.playerState !== PlayerState.PLAYING) return;
        const sourceRef = getPlaybackSourceRef(song);
        if (sourceRef.kind === 'online' && sourceIds.includes(sourceRef.providerId)) {
            console.info(`[Folium] pausing a song of ${sourceRef.providerId}: its source is about to stop`);
            pauseFoliumHostPlayback();
        }
    });
};

/**
 * Listens for the main process's notice that sources are about to be unloaded (whatever asked for it: the master
 * switch, an install over a running copy, a switch) and stops their playback. Returns the function that stops it.
 */
export const installSourcesStoppingListener = (): (() => void) => subscribeSourcesStopping(({ sourceIds }) => {
    if (Array.isArray(sourceIds) && sourceIds.length > 0) void stopPlaybackOf(sourceIds);
});

/** Stops what of `sourceIds` is playing (the registered step), before they are unloaded; never rejects. */
export const stopPlaybackOfSources = (sourceIds: readonly string[]): Promise<void> => stopPlaybackOf(sourceIds);

const stopPlaybackOf = async (sourceIds: readonly string[]) => {
    if (!stopPlayback) return;
    try {
        await stopPlayback(sourceIds);
    } catch (error) {
        console.warn('[Folium] stopping the playback of a source before its unload failed', error);
    }
};

/**
 * Switches `sourceId` to `state`. 'matching' is refused for a source that cannot match anonymously
 * (canSourceMatchOnly). Leaving 'enabled' stops its playback first. Resolves the main process's answer.
 */
export const switchSourceState = async (
    sourceId: string,
    state: ModSourceState,
): Promise<{ ok: boolean; error?: string } & Partial<ModSourceStatesPayload>> => {
    if (state === 'matching' && !canSourceMatchOnly(sourceId)) {
        return { ok: false, error: 'source-cannot-match-only' };
    }
    if (state !== 'enabled') await stopPlaybackOf([sourceId]);
    const answer = await invokeSetSourceState(sourceId, state);
    if (answer.ok && answer.states) setSourceStates(answer.states);
    console.info(`[Folium] source ${sourceId} → ${state}: ${answer.ok ? 'done' : answer.error ?? 'refused'}`);
    return answer;
};

/* Removes every stored key that starts with one of `prefixes`; the count it removed. */
const removeStoredKeys = (prefixes: readonly string[]): number => {
    try {
        const keys = listStoredKeysStartingWith(prefixes);
        keys.forEach(removeStoredKey);
        return keys.length;
    } catch (error) {
        console.warn('[Folium] clearing the keys a source keeps in this window failed', error);
        return 0;
    }
};

/**
 * "Clear data" of `sourceId` (plan §5.3): its playback stops, the main process removes its sign-in, secrets, data
 * and cache (it restarts signed out), and this window's keys of it go. The caller has asked the user first.
 */
export const clearSourceData = async (sourceId: string): Promise<ModClearSourceDataResult & { removedKeys?: number }> => {
    await stopPlaybackOf([sourceId]);
    const answer = await invokeClearSourceData(sourceId);
    const removedKeys = answer.pageStorePrefixes ? removeStoredKeys(answer.pageStorePrefixes) : 0;
    console.info(`[Folium] data of source ${sourceId} cleared: ${answer.ok ? 'done' : answer.error ?? 'refused'}, ${removedKeys} window keys`);
    return { ...answer, removedKeys };
};
