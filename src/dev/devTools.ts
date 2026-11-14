import { isMainAppSurface } from '../utils/appSurface';
import { loadsMockLibraryAtLaunch, loadsMockSongAtLaunch } from './devLaunchFlags';

// src/dev/devTools.ts
// Dev-build handles for local debugging and agents, on window.__foliaDev. index.tsx imports this only
// when import.meta.env.DEV, so a production build has none of it. What is behind each handle loads on
// first use.

type FoliaDevTools = {
    /** Imports the dev mock song (synthesized audio, word-timed lyrics, cover) as a local file and plays it. */
    playMockSong: () => Promise<unknown>;
    /** Imports the mock library (six albums, 24 short tracks) as a local folder and plays all of it as the queue. */
    loadMockLibrary: () => Promise<unknown>;
};

declare global {
    interface Window {
        __foliaDev?: FoliaDevTools;
    }
}

const playMockSong = async () => {
    const { playMockSong: play } = await import('./mockSong');
    return await play();
};

const loadMockLibrary = async () => {
    const { loadMockLibrary: load } = await import('./mockLibrary');
    return await load();
};

if (isMainAppSurface) {
    window.__foliaDev = { playMockSong, loadMockLibrary };
    // The library makes its own queue and plays it, so it wins over the single mock song.
    if (loadsMockLibraryAtLaunch) {
        if (loadsMockSongAtLaunch) console.info('[DevTools] ?mockLibrary and ?mockSong both given: loading the library, not the single song');
        loadMockLibrary().catch((error: unknown) => console.warn('[DevTools] Mock library failed to load', error));
    } else if (loadsMockSongAtLaunch) {
        playMockSong().catch(error => console.warn('[DevTools] Mock song failed to load', error));
    }
}

export {};
