// src/dev/devLaunchFlags.ts
// Shortcuts for local debugging and agents, read once at launch. Every flag is false in a production
// build: import.meta.env.DEV is the constant false there, so the checks fold away.
//
// - `?skipStartup` in the URL, or VITE_SKIP_STARTUP_EXPERIENCE=true in .env.local: the startup
//   sequence (release notes, the library / playback choice, the Ponder gate) does not open.
// - `?mockSong` in the URL: the dev mock song (src/dev/mockSong.ts) loads and plays once the app is up.
// - `?mockLibrary` in the URL: the mock library (src/dev/mockLibrary.ts, 24 short tracks over six albums)
//   is imported and becomes the play queue once the app is up.
// - `?noSources` in the URL: none of the built-in online platforms is registered, to see the app with no
//   platform at all (Folium 2.0 S1: it starts and shows its empty states). A mod's platform still registers.

// Read where there is no page address too (a test's stand-in window without one): the online platforms' registry
// reads a flag here.
const readPageQuery = (): string => {
    try {
        return typeof window === 'undefined' ? '' : window.location.search;
    } catch {
        return '';
    }
};
const searchParams = new URLSearchParams(readPageQuery());

export const skipsStartupExperience = import.meta.env.DEV && (
    import.meta.env.VITE_SKIP_STARTUP_EXPERIENCE === 'true' || searchParams.has('skipStartup')
);

export const loadsMockSongAtLaunch = import.meta.env.DEV && searchParams.has('mockSong');

export const loadsMockLibraryAtLaunch = import.meta.env.DEV && searchParams.has('mockLibrary');

export const startsWithoutSources = import.meta.env.DEV && searchParams.has('noSources');
