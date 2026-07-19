import { describe, expect, it } from 'vitest';
import { PlayerState, type SongResult } from '../../src/types';
import {
    buildDiscordPresenceSnapshotFromPlaybackSyncBridge,
    buildPlaybackSyncBridgeModel,
    buildRemoteControlSnapshotFromPlaybackSyncBridge,
    buildStagePlayerSnapshotFromPlaybackSyncBridge,
    buildTaskbarControlsFromPlaybackSyncBridge,
} from '../../src/utils/playbackSyncBridge';

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

        expect(buildRemoteControlSnapshotFromPlaybackSyncBridge(model, { playerChromeVisibilityMode: 'auto-hide' })).toMatchObject({
            title: 'Current Song',
            artist: 'Artist 2',
            currentTime: 42,
            duration: 180,
            canGoPrevious: true,
            canGoNext: true,
            playerChromeVisibilityMode: 'auto-hide',
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
        expect(buildRemoteControlSnapshotFromPlaybackSyncBridge(model, { playerChromeVisibilityMode: 'always-hidden' })).toMatchObject({
            hasTrack: false,
            controlsDisabled: true,
            isStageActive: true,
            playerChromeVisibilityMode: 'always-hidden',
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
