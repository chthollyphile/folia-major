import { describe, expect, it } from 'vitest';
import { PlayerState, type SongResult } from '../../src/types';
import {
    buildDiscordPresenceSnapshotFromPlaybackSyncBridge,
    buildPlaybackSyncBridgeModel,
    buildRemoteControlSnapshotFromPlaybackSyncBridge,
    buildStagePlayerSnapshotFromPlaybackSyncBridge,
    buildTaskbarControlsFromPlaybackSyncBridge,
} from '../../src/utils/playbackSyncBridge';
import { getPlaybackSongKey } from '../../src/utils/appPlaybackGuards';
import { resolvePlaybackNeighbors } from '../../src/utils/playbackNeighbors';

// test/unit/playbackSyncBridge.test.ts
// Verifies shared playback publishing model adapters stay aligned.

const exportState = {
    status: 'idle',
    presetId: null,
    progress: 0,
    elapsed: 0,
    duration: 0,
    countdown: null,
    filePath: null,
    error: null,
} as const;

const makeSong = (id: number, name: string): SongResult => ({
    id,
    name,
    artists: [{ id, name: `Artist ${id}` }],
    album: { id, name: `Album ${id}`, coverUrl: `https://example.com/${id}.jpg` },
    durationMs: 180_000,
});

describe('playbackSyncBridge', () => {
    it('builds aligned remote, stage, and taskbar publisher payloads', () => {
        const currentSong = makeSong(2, 'Current Song');
        const model = buildPlaybackSyncBridgeModel({
            activePlaybackContext: 'main',
            currentSong,
            playQueue: [makeSong(1, 'Previous Song'), currentSong, makeSong(3, 'Next Song')],
            currentTimeSec: 42,
            stagePositionSec: 43,
            durationSec: 180,
            stageDurationSec: 181,
            playerState: PlayerState.PLAYING,
            coverUrl: null,
            cachedCoverUrl: 'https://example.com/cached.jpg',
            effectiveLoopMode: 'off',
            isFmMode: false,
            isStageActive: false,
            controlsDisabled: false,
            transparentModeEnabled: true,
            mainWindowClickThroughEnabled: false,
            mainWindowBorderVisible: true,
            playerChromeHidden: false,
            exportState,
            isDaylight: true,
            isLiked: true,
            mainWindowWidth: 1280,
            mainWindowHeight: 720,
            sampledAt: 1234,
        });

        expect(model.currentIndex).toBe(1);
        expect(model.artist).toBe('Artist 2');
        expect(model.coverUrl).toBe('https://example.com/cached.jpg');

        const trackTransition = { startedAtMs: 10_000, durationSec: 12, crossover: 0.65 };
        expect(buildRemoteControlSnapshotFromPlaybackSyncBridge(model, {
            playerChromeVisibilityMode: 'auto-hide',
            subtitleContentMode: 'both',
            trackTransition,
        })).toMatchObject({
            title: 'Current Song',
            artist: 'Artist 2',
            currentTime: 42,
            duration: 180,
            loopMode: 'off',
            canGoPrevious: true,
            canGoNext: true,
            trackKey: getPlaybackSongKey(currentSong),
            prevTrackKey: getPlaybackSongKey(model.playQueue[0]),
            prevTrackTitle: 'Previous Song',
            prevTrackArtist: 'Artist 1',
            prevTrackCoverUrl: 'https://example.com/1.jpg',
            nextTrackKey: getPlaybackSongKey(model.playQueue[2]),
            nextTrackTitle: 'Next Song',
            nextTrackArtist: 'Artist 3',
            nextTrackCoverUrl: 'https://example.com/3.jpg',
            trackTransition,
            playerChromeVisibilityMode: 'auto-hide',
            subtitleContentMode: 'both',
            updatedAt: 1234,
        });
        expect(buildStagePlayerSnapshotFromPlaybackSyncBridge(model)).toMatchObject({
            current: {
                title: 'Current Song',
                coverUrl: 'https://example.com/cached.jpg',
            },
            positionMs: 43_000,
            durationMs: 181_000,
        });
        expect(buildTaskbarControlsFromPlaybackSyncBridge(model)).toEqual({
            hasActiveTrack: true,
            canGoPrevious: true,
            canGoNext: true,
            isPlaying: true,
        });
        expect(buildDiscordPresenceSnapshotFromPlaybackSyncBridge(model)).toEqual({
            hasTrack: true,
            title: 'Current Song',
            artist: 'Artist 2',
            coverUrl: 'https://example.com/cached.jpg',
            currentTime: 42,
            duration: 180,
            playerState: PlayerState.PLAYING,
            updatedAt: 1234,
        });
    });

    it('disables transport payloads while Stage owns now playing', () => {
        const currentSong = makeSong(1, 'Stage Song');
        const model = buildPlaybackSyncBridgeModel({
            activePlaybackContext: 'stage',
            currentSong,
            playQueue: [currentSong],
            currentTimeSec: 10,
            durationSec: 60,
            playerState: PlayerState.PLAYING,
            coverUrl: null,
            effectiveLoopMode: 'all',
            isFmMode: false,
            isStageActive: true,
            controlsDisabled: false,
            transparentModeEnabled: false,
            mainWindowClickThroughEnabled: false,
            mainWindowBorderVisible: false,
            playerChromeHidden: true,
            exportState,
            isDaylight: false,
            isLiked: false,
            mainWindowWidth: 800,
            mainWindowHeight: 600,
            sampledAt: 4321,
        });

        expect(model.hasTrack).toBe(false);
        expect(buildRemoteControlSnapshotFromPlaybackSyncBridge(model, { playerChromeVisibilityMode: 'always-hidden', subtitleContentMode: 'none' })).toMatchObject({
            hasTrack: false,
            controlsDisabled: true,
            isStageActive: true,
            trackKey: null,
            prevTrackKey: null,
            prevTrackTitle: null,
            prevTrackArtist: null,
            prevTrackCoverUrl: null,
            nextTrackKey: null,
            nextTrackTitle: null,
            nextTrackArtist: null,
            nextTrackCoverUrl: null,
            trackTransition: null,
            playerChromeVisibilityMode: 'always-hidden',
            subtitleContentMode: 'none',
        });
        expect(buildTaskbarControlsFromPlaybackSyncBridge(model)).toEqual({
            hasActiveTrack: false,
            canGoPrevious: false,
            canGoNext: false,
            isPlaying: false,
        });
    });

    it('locates the current song by source when numeric ids collide', () => {
        const localSong = {
            ...makeSong(-1, 'Local Song'),
            isLocal: true,
            localRef: { songId: 'local-1' },
        } as SongResult;
        const navidromeSong = {
            ...makeSong(-1, 'Navidrome Song'),
            isNavidrome: true,
            navidromeData: {
                id: 'navi-1',
                streamUrl: 'https://example.com/navi-1',
                albumId: 'album-1',
                artistId: 'artist-1',
                path: 'navi-1.flac',
                suffix: 'flac',
            },
        } as SongResult;

        const model = buildPlaybackSyncBridgeModel({
            activePlaybackContext: 'main',
            currentSong: navidromeSong,
            playQueue: [localSong, navidromeSong],
            currentTimeSec: 0,
            durationSec: 180,
            playerState: PlayerState.PAUSED,
            coverUrl: null,
            effectiveLoopMode: 'off',
            isFmMode: false,
            isStageActive: false,
            controlsDisabled: false,
            transparentModeEnabled: false,
            mainWindowClickThroughEnabled: false,
            mainWindowBorderVisible: false,
            playerChromeHidden: false,
            exportState,
            isDaylight: false,
            isLiked: false,
            mainWindowWidth: 800,
            mainWindowHeight: 600,
        });

        expect(model.currentIndex).toBe(1);
        expect(model.canGoPrevious).toBe(true);
    });
});

// The remote window, the taskbar and the stage snapshot enable Previous / Next exactly when the
// main window's arrows do, which is when the press does something.
describe('playbackSyncBridge previous / next availability', () => {
    const [first, second, third] = [makeSong(1, 'First'), makeSong(2, 'Second'), makeSong(3, 'Third')];
    const outsider = makeSong(99, 'Outsider');

    const modelFor = (overrides: Partial<Parameters<typeof buildPlaybackSyncBridgeModel>[0]>) => (
        buildPlaybackSyncBridgeModel({
            activePlaybackContext: 'main',
            currentSong: second,
            playQueue: [first, second, third],
            currentTimeSec: 0,
            durationSec: 180,
            playerState: PlayerState.PLAYING,
            coverUrl: null,
            effectiveLoopMode: 'off',
            isFmMode: false,
            isStageActive: false,
            controlsDisabled: false,
            transparentModeEnabled: false,
            mainWindowClickThroughEnabled: false,
            mainWindowBorderVisible: false,
            playerChromeHidden: false,
            exportState,
            isDaylight: false,
            isLiked: false,
            mainWindowWidth: 800,
            mainWindowHeight: 600,
            ...overrides,
        })
    );
    const flags = (overrides: Parameters<typeof modelFor>[0]) => {
        const model = modelFor(overrides);
        return { previous: model.canGoPrevious, next: model.canGoNext };
    };

    it('enables both on a one-track queue in repeat-all, where the press replays the track', () => {
        expect(flags({ playQueue: [first], currentSong: first, effectiveLoopMode: 'all' }))
            .toEqual({ previous: true, next: true });
        expect(flags({ playQueue: [first], currentSong: first, effectiveLoopMode: 'off' }))
            .toEqual({ previous: false, next: false });
    });

    it('enables next for a current song that is not in the queue, where the press plays the first track', () => {
        expect(flags({ currentSong: outsider, effectiveLoopMode: 'off' })).toEqual({ previous: false, next: true });
        expect(flags({ currentSong: outsider, effectiveLoopMode: 'all' })).toEqual({ previous: true, next: true });
    });

    it('disables next in Personal FM with an empty queue, where the press does nothing', () => {
        expect(flags({ playQueue: [], isFmMode: true })).toEqual({ previous: false, next: false });
    });

    it('keeps the answers inside a queue, at its ends and on the last Personal FM track', () => {
        expect(flags({})).toEqual({ previous: true, next: true });
        expect(flags({ currentSong: first })).toEqual({ previous: false, next: true });
        expect(flags({ currentSong: third })).toEqual({ previous: true, next: false });
        expect(flags({ currentSong: third, effectiveLoopMode: 'one' })).toEqual({ previous: true, next: false });
        expect(flags({ currentSong: first, effectiveLoopMode: 'all' })).toEqual({ previous: true, next: true });
        expect(flags({ currentSong: third, effectiveLoopMode: 'all' })).toEqual({ previous: true, next: true });
        expect(flags({ currentSong: third, isFmMode: true })).toEqual({ previous: true, next: true });
        expect(flags({ currentSong: null })).toEqual({ previous: false, next: false });
    });

    it('gives every publisher the main window arrows\' answer on every input', () => {
        const tracks = [first, second, third];
        for (let length = 0; length <= tracks.length; length += 1) {
            const playQueue = tracks.slice(0, length);
            for (const currentSong of [null, outsider, ...playQueue]) {
                for (const effectiveLoopMode of ['off', 'all', 'one'] as const) {
                    for (const isFmMode of [false, true]) {
                        for (const isStageActive of [false, true]) {
                            const label = `${length} tracks, on ${currentSong?.name ?? 'nothing'}, ${effectiveLoopMode}, fm ${isFmMode}, stage ${isStageActive}`;
                            const arrows = resolvePlaybackNeighbors({
                                playQueue,
                                currentSong,
                                loopMode: effectiveLoopMode,
                                isFmMode,
                                isStageActive,
                            });
                            const expected = { canGoPrevious: arrows.prev.canGo, canGoNext: arrows.next.canGo };
                            const model = modelFor({ playQueue, currentSong, effectiveLoopMode, isFmMode, isStageActive });

                            expect(buildRemoteControlSnapshotFromPlaybackSyncBridge(model, { playerChromeVisibilityMode: 'auto-hide', subtitleContentMode: 'translation' }), label)
                                .toMatchObject(expected);
                            expect(buildTaskbarControlsFromPlaybackSyncBridge(model), label).toMatchObject(expected);
                            expect(buildStagePlayerSnapshotFromPlaybackSyncBridge(model).controlCapabilities, label)
                                .toMatchObject({ previous: expected.canGoPrevious, next: expected.canGoNext });
                        }
                    }
                }
            }
        }
    });
});
