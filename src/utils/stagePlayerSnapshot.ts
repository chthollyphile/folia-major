import { PlayerState, type SongResult, type StagePlayerPlaybackContext, type StagePlayerQueueItem, type StagePlayerSnapshot } from '../types';
import { isLocalPlaybackSong, isNavidromePlaybackSong, isStagePlaybackSong, resolveNavidromePlaybackCarrier } from './appPlaybackGuards';

// src/utils/stagePlayerSnapshot.ts
// Builds the public Stage player snapshot without coupling Electron bridge code to song source details.

type BuildStagePlayerSnapshotArgs = {
    activePlaybackContext: 'main' | 'stage';
    isExternalPlaybackSourceActive: boolean;
    currentSong: SongResult | null;
    playQueue: SongResult[];
    playerState: PlayerState;
    positionMs: number;
    durationMs: number;
    canGoPrevious: boolean;
    canGoNext: boolean;
    coverUrl: string | null;
};

type ResolveStagePlayerPositionSecArgs = {
    activePlaybackContext: 'main' | 'stage';
    isExternalPlaybackSourceActive: boolean;
    audioCurrentTimeSec: number | null | undefined;
    motionCurrentTimeSec: number;
    syntheticStageLyricsTimeSec?: number;
};

const getSongArtists = (song: SongResult | null): string => {
    if (!song) {
        return '';
    }

    const artistNames = song.ar?.map(artist => artist.name).filter(Boolean)
        ?? song.artists?.map(artist => artist.name).filter(Boolean)
        ?? [];
    if (artistNames.length > 0) {
        return artistNames.join(', ');
    }

    if (isLocalPlaybackSong(song)) {
        return song.localData.matchedArtists || song.localData.artist || '';
    }

    const navidromeSong = resolveNavidromePlaybackCarrier(song);
    return navidromeSong?.artists?.map(artist => artist.name).filter(Boolean).join(', ') || '';
};

const getSongAlbum = (song: SongResult | null): string => {
    if (!song) {
        return '';
    }

    if (song.al?.name || song.album?.name) {
        return song.al?.name || song.album?.name || '';
    }

    if (isLocalPlaybackSong(song)) {
        return song.localData.matchedAlbumName || song.localData.album || '';
    }

    const navidromeSong = resolveNavidromePlaybackCarrier(song);
    return navidromeSong?.album?.name || '';
};

const getSongSource = (song: SongResult | null): string => {
    if (!song) {
        return 'unknown';
    }

    if (isStagePlaybackSong(song)) {
        return 'stage-session';
    }

    if (isLocalPlaybackSong(song)) {
        return 'local';
    }

    if (isNavidromePlaybackSong(song)) {
        return 'navidrome';
    }

    return 'netease';
};

export const buildStagePlayerQueueItemId = (song: SongResult, index: number): string => {
    const source = getSongSource(song);
    const id = String(song.id ?? `${source}-${index}`);
    return `${source}:${id}:${index}`;
};

// Resolves a public queue item identifier only when it still matches the current queue item.
export const resolveStagePlayerQueueItemIndex = (queue: SongResult[], queueItemId?: string): number => {
    if (!queueItemId) {
        return -1;
    }

    const firstSeparatorIndex = queueItemId.indexOf(':');
    const lastSeparatorIndex = queueItemId.lastIndexOf(':');
    if (firstSeparatorIndex <= 0 || lastSeparatorIndex <= firstSeparatorIndex) {
        return -1;
    }

    const encodedSource = queueItemId.slice(0, firstSeparatorIndex);
    const encodedSongId = queueItemId.slice(firstSeparatorIndex + 1, lastSeparatorIndex);
    const encodedIndex = Number(queueItemId.slice(lastSeparatorIndex + 1));
    if (!Number.isInteger(encodedIndex) || encodedIndex < 0 || encodedIndex >= queue.length) {
        return -1;
    }

    const queuedSong = queue[encodedIndex];
    if (!queuedSong) {
        return -1;
    }

    const currentSource = getSongSource(queuedSong);
    const currentSongId = String(queuedSong.id);
    return currentSource === encodedSource && currentSongId === encodedSongId ? encodedIndex : -1;
};

const getSongDurationMs = (song: SongResult | null, fallbackMs = 0): number => {
    if (!song) {
        return Math.max(0, Math.floor(fallbackMs));
    }

    return Math.max(0, Math.floor(song.duration || song.dt || fallbackMs || 0));
};

const buildQueueItem = (song: SongResult, index: number, fallbackCoverUrl: string | null): StagePlayerQueueItem => {
    const source = getSongSource(song);
    const id = String(song.id ?? `${source}-${index}`);
    const coverUrl = song.al?.picUrl || song.album?.picUrl || fallbackCoverUrl || null;

    return {
        queueItemId: buildStagePlayerQueueItemId(song, index),
        id,
        source,
        title: song.name || 'Unknown Song',
        artist: getSongArtists(song),
        album: getSongAlbum(song),
        durationMs: getSongDurationMs(song),
        coverUrl,
    };
};

const resolvePlaybackContext = (
    activePlaybackContext: 'main' | 'stage',
    isExternalPlaybackSourceActive: boolean,
    currentSong: SongResult | null,
): StagePlayerPlaybackContext => {
    if (isExternalPlaybackSourceActive) {
        return 'external-playback-source';
    }

    if (activePlaybackContext === 'stage' || isStagePlaybackSong(currentSong)) {
        return 'stage-session';
    }

    return 'normal-playback';
};

// Picks the most authoritative clock for the public player snapshot.
export const resolveStagePlayerPositionSec = ({
    activePlaybackContext,
    isExternalPlaybackSourceActive,
    audioCurrentTimeSec,
    motionCurrentTimeSec,
    syntheticStageLyricsTimeSec,
}: ResolveStagePlayerPositionSecArgs): number => {
    if (Number.isFinite(audioCurrentTimeSec)) {
        return Math.max(0, audioCurrentTimeSec ?? 0);
    }

    if (
        activePlaybackContext === 'stage'
        && !isExternalPlaybackSourceActive
        && Number.isFinite(syntheticStageLyricsTimeSec)
    ) {
        return Math.max(0, syntheticStageLyricsTimeSec ?? 0);
    }

    if (Number.isFinite(motionCurrentTimeSec)) {
        return Math.max(0, motionCurrentTimeSec);
    }

    return 0;
};

export const buildStagePlayerSnapshot = ({
    activePlaybackContext,
    isExternalPlaybackSourceActive,
    currentSong,
    playQueue,
    playerState,
    positionMs,
    durationMs,
    canGoPrevious,
    canGoNext,
    coverUrl,
}: BuildStagePlayerSnapshotArgs): StagePlayerSnapshot => {
    const playbackContext = resolvePlaybackContext(activePlaybackContext, isExternalPlaybackSourceActive, currentSong);
    const currentSource = getSongSource(currentSong);
    const currentId = currentSong ? String(currentSong.id) : '';
    const queueItems = playQueue.map((song, index) => buildQueueItem(song, index, coverUrl));
    const currentIndex = currentSong ? queueItems.findIndex(item => item.source === currentSource && item.id === currentId) : -1;
    const hasCurrent = Boolean(currentSong);
    const canControlTransport = playbackContext !== 'external-playback-source' && hasCurrent;
    const canEditQueue = playbackContext === 'normal-playback';
    const safeDurationMs = Math.max(0, Math.floor(durationMs || getSongDurationMs(currentSong)));

    return {
        playbackContext,
        current: currentSong
            ? {
                id: currentId,
                source: currentSource,
                title: currentSong.name || 'Unknown Song',
                artist: getSongArtists(currentSong),
                album: getSongAlbum(currentSong),
                durationMs: safeDurationMs,
                coverUrl: coverUrl || currentSong.al?.picUrl || currentSong.album?.picUrl || null,
            }
            : null,
        playerState,
        positionMs: Math.max(0, Math.floor(positionMs)),
        durationMs: safeDurationMs,
        sampledAtMs: Date.now(),
        updatedAt: Date.now(),
        controlCapabilities: {
            play: canControlTransport,
            pause: canControlTransport,
            resume: canControlTransport,
            seek: canControlTransport,
            previous: playbackContext === 'normal-playback' && canGoPrevious,
            next: playbackContext === 'normal-playback' && canGoNext,
        },
        queueCapabilities: {
            append: canEditQueue,
            insertNext: canEditQueue,
            remove: canEditQueue,
            move: canEditQueue,
            select: canEditQueue,
            clear: canEditQueue,
        },
        queue: {
            items: queueItems,
            currentIndex,
            length: queueItems.length,
        },
    };
};
