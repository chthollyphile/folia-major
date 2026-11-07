import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const translateMock = vi.hoisted(() => vi.fn((key: string, _options?: Record<string, unknown>) => key));
const setDurationMock = vi.hoisted(() => vi.fn());
const setCurrentTimeMock = vi.hoisted(() => vi.fn());
const canPlayExternallyMock = vi.hoisted(() => vi.fn(() => true));
const runningPositionMock = vi.hoisted(() => vi.fn(async (): Promise<number | null> => null));
const pauseMock = vi.hoisted(() => vi.fn(async () => undefined));
const resumeMock = vi.hoisted(() => vi.fn(async () => undefined));
const playMock = vi.hoisted(() => vi.fn(async () => undefined));
const seekMock = vi.hoisted(() => vi.fn(async () => undefined));
const warmUpMock = vi.hoisted(() => vi.fn(async () => undefined));
const playbackState = vi.hoisted(() => ({ currentSong: null as unknown, playQueue: [] as unknown[] }));

vi.mock('@/i18n/config', () => ({ default: { t: translateMock, on: () => {}, language: 'en' } }));
vi.mock('@/services/onlinePlayback', () => ({
    loadOnlineSongAudioSource: vi.fn(),
    applyOnlineAudioSourceMetadata: (song: unknown) => song,
}));
// The provider's own player, as a song restored from the last session finds it: the restore only
// ever asks where it is on the song, so every call that would steer it is a spy that must stay unused.
vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        canPlaySong: () => true,
        canPlayExternally: canPlayExternallyMock,
        getExternalPlaybackRunningPositionMs: runningPositionMock,
        playSongExternally: playMock,
        pauseExternalPlayback: pauseMock,
        resumeExternalPlayback: resumeMock,
        seekExternalPlayback: seekMock,
        warmUpExternalPlayers: warmUpMock,
        getLyrics: vi.fn(),
        getProviderLabel: (id: string) => id,
    },
}));
vi.mock('@/stores/motionSignals', () => ({
    currentTime: { get: () => 0, set: setCurrentTimeMock },
}));
vi.mock('@/stores/usePlaybackStore', () => ({
    usePlaybackStore: { getState: () => playbackState },
    setAudioSrc: vi.fn(),
    setCurrentSong: vi.fn(),
    setCachedCoverUrl: vi.fn(),
    setActiveLocalLyricsSource: vi.fn(),
    setDuration: setDurationMock,
}));
vi.mock('@/stores/useStatusMessageStore', () => ({
    setStatusMessage: vi.fn(),
    useStatusMessageStore: { getState: () => ({ message: null }) },
}));
vi.mock('@/stores/useOnlineProviderAccountStore', () => ({
    useOnlineProviderAccountStore: { getState: () => ({ accounts: {} }) },
}));
vi.mock('@/stores/useLyricSettingsStore', () => ({
    useLyricSettingsStore: { getState: () => ({ localLyricsPriority: [] }) },
}));
vi.mock('@/services/onlineMusic/resourceCache', () => ({
    getCachedSongCoverUrl: vi.fn(async () => null),
    getSongCacheWithLegacyMigration: vi.fn(async () => null),
}));
vi.mock('@/utils/onlineLyricsState', () => ({
    loadOnlineLyricsState: vi.fn(async () => null),
    resolveOnlineLyrics: (_state: unknown, lyrics: unknown) => lyrics ?? null,
}));
vi.mock('@/services/coverCache', () => ({
    getCachedCoverUrl: vi.fn(async () => null),
    loadCachedOrFetchCover: vi.fn(async () => null),
}));
vi.mock('@/services/db', () => ({ getLocalSongs: vi.fn(async () => []) }));
vi.mock('@/services/localMusicService', () => ({ ensureLocalSongCoverAsset: vi.fn(), getAudioFromLocalSong: vi.fn() }));
vi.mock('@/services/localLibraryEntityRepository', () => ({ getLocalLibraryCatalogSnapshot: vi.fn() }));
vi.mock('@/services/navidromeService', () => ({ getNavidromeConfig: vi.fn(() => null) }));
vi.mock('@/services/playbackAdapters', () => ({ applyLocalLibraryEntityDisplay: vi.fn(), buildUnifiedLocalSong: vi.fn() }));
vi.mock('@/utils/appNavidromeLyrics', () => ({ hydrateNavidromeLyricPayload: vi.fn(), resolvePreferredNavidromeLyrics: vi.fn() }));
vi.mock('@/utils/lyrics/localSongLyrics', () => ({ resolveLocalSongLyrics: vi.fn() }));

import { restorePlaybackSourceForSong } from '@/components/app/playback/restore/restorePlaybackSource';
import { askForSong, startRestore } from '@/components/app/playback/currentSong';
import type { SongResult } from '@/types';

// test/unit/playback/restoreExternalPosition.test.ts
// A song whose player outlived the app: the session restored at launch shows where that player is
// on it, paused, so the press of play starts from there. Only a session restore asks - a window
// hand-off carries the position of the window that is gone - and only a read is ever made: the
// player is never started, resumed or paused for it.

const song: SongResult = {
    id: 'bodian-song',
    name: 'Song',
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 200_000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: 'bodian-song' },
};

const otherSong: SongResult = {
    ...song,
    id: 'bodian-other',
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: 'bodian-other' },
};

/** The session restore's call; a window hand-off is the same call without the flag (see below). */
const restore = (options: { sessionRestore?: boolean; forSong?: SongResult } = {}) => restorePlaybackSourceForSong(options.forSong ?? song, {
    audioQuality: 'high',
    blobUrlRef: { current: null },
    currentOnlineAudioUrlFetchedAtRef: { current: null },
    setLyrics: vi.fn(),
    queue: [options.forSong ?? song],
    stillWanted: startRestore(),
    ...(options.sessionRestore === false ? {} : { resumeExternalPosition: true }),
});

describe('a restored song whose own player is still running it', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        canPlayExternallyMock.mockReturnValue(true);
        runningPositionMock.mockImplementation(async () => null);
        playbackState.currentSong = song;
        askForSong(song);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows where the player is on that song, paused, in seconds', async () => {
        runningPositionMock.mockImplementation(async () => 75_400);

        await expect(restore()).resolves.toBe('restored');
        expect(setCurrentTimeMock).toHaveBeenCalledWith(75.4);
        // Shown, not started: the song keeps the paused state the restore leaves it in.
        expect(playMock).not.toHaveBeenCalled();
        expect(resumeMock).not.toHaveBeenCalled();
        expect(pauseMock).not.toHaveBeenCalled();
        expect(seekMock).not.toHaveBeenCalled();
        expect(warmUpMock).not.toHaveBeenCalled();
    });

    it('writes the position of a Spotify song its session names one artist of', async () => {
        // The report: Spotify keeps playing after Folia quits, and its media session names only the
        // leading artist of a song Folia remembers with both.
        const duet: SongResult = {
            ...song,
            id: 'helpless',
            name: 'Helpless',
            artists: [
                { id: 'artist-psoo', name: 'Phillipa Soo' },
                { id: 'artist-obc', name: 'Original Broadway Cast of Hamilton' },
            ],
            sourceRef: { kind: 'online', providerId: 'spotify', mediaId: 'helpless' },
        };
        askForSong(duet);
        runningPositionMock.mockImplementation(async () => 75_400);

        await expect(restore({ forSong: duet })).resolves.toBe('restored');
        expect(runningPositionMock).toHaveBeenCalledWith(duet);
        expect(setCurrentTimeMock).toHaveBeenCalledWith(75.4);
    });

    it('leaves the song at its beginning where the player is on another track', async () => {
        runningPositionMock.mockImplementation(async () => null);

        await expect(restore()).resolves.toBe('restored');
        expect(runningPositionMock).toHaveBeenCalledWith(song);
        expect(setCurrentTimeMock).not.toHaveBeenCalled();
        expect(playMock).not.toHaveBeenCalled();
    });

    it('leaves it at its beginning where the player could not be asked', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        runningPositionMock.mockImplementation(async () => { throw new Error('no media session'); });

        await expect(restore()).resolves.toBe('restored');
        expect(warn).toHaveBeenCalled();
        expect(setCurrentTimeMock).not.toHaveBeenCalled();
        expect(playMock).not.toHaveBeenCalled();
    });

    it('never shows a position past the end of the song', async () => {
        runningPositionMock.mockImplementation(async () => 900_000);

        await restore();
        expect(setCurrentTimeMock).toHaveBeenCalledWith(200);
    });

    it('drops an answer that lands after another song was asked for', async () => {
        runningPositionMock.mockImplementation(async () => {
            askForSong(otherSong);
            return 75_400;
        });

        await restore();
        expect(setCurrentTimeMock).not.toHaveBeenCalled();
    });

    it('drops an answer that lands after this song was asked for again by a play', async () => {
        runningPositionMock.mockImplementation(async () => {
            askForSong(song);
            return 75_400;
        });

        await restore();
        expect(setCurrentTimeMock).not.toHaveBeenCalled();
    });

    it('asks the player nothing for the hand-off of a window, which carries its own position', async () => {
        await restore({ sessionRestore: false });

        expect(runningPositionMock).not.toHaveBeenCalled();
        expect(setCurrentTimeMock).not.toHaveBeenCalled();
    });
});
