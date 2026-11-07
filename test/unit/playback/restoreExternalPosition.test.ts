import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const translateMock = vi.hoisted(() => vi.fn((key: string, _options?: Record<string, unknown>) => key));
const setDurationMock = vi.hoisted(() => vi.fn());
const setCurrentTimeMock = vi.hoisted(() => vi.fn());
const canPlayExternallyMock = vi.hoisted(() => vi.fn(() => true));
const runningPositionMock = vi.hoisted(() => vi.fn(async (): Promise<number | null> => null));
const runningStatusMock = vi.hoisted(() => vi.fn(async (): Promise<unknown> => null));
const adoptMock = vi.hoisted(() => vi.fn(async (_song: unknown): Promise<boolean> => false));
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
        getExternalPlaybackRunningStatus: runningStatusMock,
        isExternalPlaybackStatusForSong: (song: SongResult, status: { mediaId: string }) => (
            status.mediaId !== '' && status.mediaId === song.sourceRef?.mediaId
        ),
        playSongExternally: playMock,
        pauseExternalPlayback: pauseMock,
        resumeExternalPlayback: resumeMock,
        seekExternalPlayback: seekMock,
        warmUpExternalPlayers: warmUpMock,
        getLyrics: vi.fn(),
        getProviderLabel: (id: string) => id,
    },
}));
// The player taken over: a session restore that finds it playing the remembered song hands it to
// the external route, which is this call and nothing else.
vi.mock('@/services/onlineMusic/externalPlayback', () => ({ adoptExternalPlayback: adoptMock }));
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
const restore = (options: { sessionRestore?: boolean; shouldAutoPlayRef?: { current: boolean } } = {}) => restorePlaybackSourceForSong(song, {
    audioQuality: 'high',
    blobUrlRef: { current: null },
    currentOnlineAudioUrlFetchedAtRef: { current: null },
    setLyrics: vi.fn(),
    queue: [song],
    stillWanted: startRestore(),
    ...(options.sessionRestore === false ? {} : { resumeExternalPosition: true }),
    ...(options.shouldAutoPlayRef ? { shouldAutoPlayRef: options.shouldAutoPlayRef } : {}),
});

describe('a restored song whose own player is still running it', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        canPlayExternallyMock.mockReturnValue(true);
        runningPositionMock.mockImplementation(async () => null);
        runningStatusMock.mockImplementation(async () => null);
        adoptMock.mockImplementation(async () => false);
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

// The player outlived the app with the remembered song still sounding in it: a session restore that
// finds it playing that song takes the player over as it stands - the external route, its clock, the
// media keys and the songs that follow are the ones this app follows anyway - and one that finds
// anything else, a pause and another track and an advertisement included, only shows where it is.
// Neither path ever starts, resumes or pauses the player: nothing here is the listener's action.
describe('a session restored onto a player that kept running the song', () => {
    const status = (mediaId: string, isPlaying: boolean) => ({
        mediaId, isPlaying, ended: false, positionMs: 75_400, durationMs: 200_000,
    });

    beforeEach(() => {
        vi.clearAllMocks();
        canPlayExternallyMock.mockReturnValue(true);
        runningPositionMock.mockImplementation(async () => null);
        runningStatusMock.mockImplementation(async () => null);
        adoptMock.mockImplementation(async () => false);
        playbackState.currentSong = song;
        askForSong(song);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('takes the playing player over, and leaves none of the restore own play intent behind', async () => {
        const shouldAutoPlayRef = { current: true };
        runningStatusMock.mockImplementation(async () => status('bodian-song', true));
        adoptMock.mockImplementation(async () => true);

        await expect(restore({ shouldAutoPlayRef })).resolves.toBe('restored');
        expect(adoptMock).toHaveBeenCalledWith(song);
        // The player sounds it: an intent to play left armed would fire on what comes next.
        expect(shouldAutoPlayRef.current).toBe(false);
        expect(playMock).not.toHaveBeenCalled();
        expect(pauseMock).not.toHaveBeenCalled();
        expect(resumeMock).not.toHaveBeenCalled();
        expect(seekMock).not.toHaveBeenCalled();
        expect(warmUpMock).not.toHaveBeenCalled();
        // The taken-over player carries the clock; the restore shows nothing at its place.
        expect(setCurrentTimeMock).not.toHaveBeenCalled();
    });

    it('only shows where a paused player is, and never takes a pause over', async () => {
        runningStatusMock.mockImplementation(async () => status('bodian-song', false));

        await expect(restore()).resolves.toBe('restored');
        expect(adoptMock).not.toHaveBeenCalled();
        expect(setCurrentTimeMock).toHaveBeenCalledWith(75.4);
        expect(playMock).not.toHaveBeenCalled();
        expect(resumeMock).not.toHaveBeenCalled();
    });

    it('leaves a player on another track alone', async () => {
        runningStatusMock.mockImplementation(async () => status('bodian-other', true));

        await expect(restore()).resolves.toBe('restored');
        expect(adoptMock).not.toHaveBeenCalled();
        expect(setCurrentTimeMock).not.toHaveBeenCalled();
        expect(playMock).not.toHaveBeenCalled();
        expect(pauseMock).not.toHaveBeenCalled();
    });

    it('only shows the position where the app answers through the media session, naming no track', async () => {
        runningStatusMock.mockImplementation(async () => ({ ...status('', true), fallback: true }));
        runningPositionMock.mockImplementation(async () => 75_400);

        await expect(restore()).resolves.toBe('restored');
        expect(adoptMock).not.toHaveBeenCalled();
        expect(setCurrentTimeMock).toHaveBeenCalledWith(75.4);
        expect(pauseMock).not.toHaveBeenCalled();
    });

    it('never takes an advertisement over', async () => {
        runningStatusMock.mockImplementation(async () => ({
            mediaId: '', isPlaying: false, ended: false, positionMs: 0, durationMs: 0, advertisement: true,
        }));

        await expect(restore()).resolves.toBe('restored');
        expect(adoptMock).not.toHaveBeenCalled();
        expect(setCurrentTimeMock).not.toHaveBeenCalled();
        expect(pauseMock).not.toHaveBeenCalled();
    });

    it('falls back to showing the position where the take-over failed, and pauses nothing', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        runningStatusMock.mockImplementation(async () => status('bodian-song', true));
        adoptMock.mockImplementation(async () => false);

        await expect(restore()).resolves.toBe('restored');
        expect(setCurrentTimeMock).toHaveBeenCalledWith(75.4);
        expect(pauseMock).not.toHaveBeenCalled();
        expect(playMock).not.toHaveBeenCalled();
        expect(warn).toBeDefined();
    });

    it('drops an answer that lands after another song was asked for', async () => {
        runningStatusMock.mockImplementation(async () => {
            askForSong(otherSong);
            return status('bodian-song', true);
        });
        adoptMock.mockImplementation(async () => true);

        await restore();
        expect(adoptMock).not.toHaveBeenCalled();
        expect(setCurrentTimeMock).not.toHaveBeenCalled();
    });

    it('drops an answer that lands after this song was asked for again by a play', async () => {
        runningStatusMock.mockImplementation(async () => {
            askForSong(song);
            return status('bodian-song', true);
        });
        adoptMock.mockImplementation(async () => true);

        await restore();
        expect(adoptMock).not.toHaveBeenCalled();
        expect(setCurrentTimeMock).not.toHaveBeenCalled();
    });

    it('asks the player nothing for the hand-off of a window, which carries its own state', async () => {
        await restore({ sessionRestore: false });

        expect(runningStatusMock).not.toHaveBeenCalled();
        expect(adoptMock).not.toHaveBeenCalled();
        expect(setCurrentTimeMock).not.toHaveBeenCalled();
    });
});
