import { isMainAppSurface } from '../utils/appSurface';
import { loadsMockSongAtLaunch } from './devLaunchFlags';

// src/dev/devTools.ts
// Dev-build handles for local debugging and agents, on window.__foliaDev. index.tsx imports this only
// when import.meta.env.DEV, so a production build has none of it. What is behind each handle loads on
// first use.

type FoliaDevTools = {
    /** Imports the dev mock song (synthesized audio, word-timed lyrics, cover) as a local file and plays it. */
    playMockSong: () => Promise<unknown>;
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

if (isMainAppSurface) {
    window.__foliaDev = { playMockSong };
    if (loadsMockSongAtLaunch) {
        playMockSong().catch(error => console.warn('[DevTools] Mock song failed to load', error));
    }
}

export {};
