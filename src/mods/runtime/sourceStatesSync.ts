import { getSourceStates, isModsBridgeAvailable, subscribeSourceStates } from '../ipc';
import { setSourceStates } from '@/services/onlineMusic/sourceStates';

// src/mods/runtime/sourceStatesSync.ts
// Keeps the window's copy of the source states (services/onlineMusic/sourceStates.ts) in step with the main
// process's table (Folium 2.0 plan §5.3): read once at the start, then replaced on every change it pushes.

let installed: Promise<boolean> | null = null;

/**
 * Installs the sync once; resolves when the first table has arrived (at once without the bridge), with whether
 * the main process runs a source mod (whose client the first screen then waits for).
 */
export const installFoliumSourceStatesSync = (): Promise<boolean> => {
    if (installed) return installed;
    if (!isModsBridgeAvailable()) {
        installed = Promise.resolve(false);
        return installed;
    }
    subscribeSourceStates((payload) => setSourceStates(payload.states));
    installed = getSourceStates()
        .then((payload) => {
            setSourceStates(payload.states);
            return payload.hasSourceMods;
        })
        .catch((error: unknown) => {
            console.warn('[Folium] the source states could not be read; every source counts as enabled', error);
            return false;
        });
    return installed;
};
