// src/dev/devLaunchFlags.ts
// Shortcuts for local debugging and agents, read once at launch. Every flag is false in a production
// build: import.meta.env.DEV is the constant false there, so the checks fold away.
//
// - `?skipStartup` in the URL, or VITE_SKIP_STARTUP_EXPERIENCE=true in .env.local: the startup
//   sequence (release notes, the library / playback choice, the Ponder gate) does not open.
// - `?mockSong` in the URL: the dev mock song (src/dev/mockSong.ts) loads and plays once the app is up.

const searchParams = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);

export const skipsStartupExperience = import.meta.env.DEV && (
    import.meta.env.VITE_SKIP_STARTUP_EXPERIENCE === 'true' || searchParams.has('skipStartup')
);

export const loadsMockSongAtLaunch = import.meta.env.DEV && searchParams.has('mockSong');
