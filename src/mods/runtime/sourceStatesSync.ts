import { getSourceStates, isModsBridgeAvailable, subscribeSourceStates } from '../ipc';
import { setSourceStates } from '@/services/onlineMusic/sourceStates';

// src/mods/runtime/sourceStatesSync.ts
// Keeps the window's copy of the source states (services/onlineMusic/sourceStates.ts) in step with the main
// process's table (Folium 2.0 plan §5.3): read once at the start, then replaced on every change it pushes.

let installed: Promise<void> | null = null;

/** Installs the sync once; resolves when the first table has arrived (at once without the bridge). */
export const installFoliumSourceStatesSync = (): Promise<void> => {
    if (installed) return installed;
    if (!isModsBridgeAvailable()) {
        installed = Promise.resolve();
        return installed;
    }
    subscribeSourceStates((payload) => setSourceStates(payload.states));
    installed = getSourceStates()
        .then((payload) => setSourceStates(payload.states))
        .catch((error: unknown) => {
            console.warn('[Folium] the source states could not be read; every source counts as enabled', error);
        });
    return installed;
};
