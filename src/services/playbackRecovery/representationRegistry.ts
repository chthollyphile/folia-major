import type { SongResult } from '../../types';
import type { PlaybackRepresentation } from '../../types/playbackRecovery';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';

// Keeps playback and analysis on one representation for the lifetime of the current renderer.

const representations = new Map<string, PlaybackRepresentation>();

export const registerPlaybackRepresentation = (representation: PlaybackRepresentation): void => {
    representations.set(representation.songKey, representation);
};

export const getPlaybackRepresentation = (
    song: SongResult | null | undefined,
): PlaybackRepresentation | null => {
    if (!song?.playbackSourceRevision) return null;
    return getPlaybackRepresentationForRevision(
        getPlaybackSongKey(song),
        song.playbackSourceRevision,
    );
};

export const getPlaybackRepresentationForRevision = (
    songKey: string,
    sourceRevision: string,
): PlaybackRepresentation | null => {
    const representation = representations.get(songKey);
    if (!representation) return null;
    if (representation.sourceRevision === sourceRevision) return representation;
    representations.delete(songKey);
    return null;
};

export const getPlaybackAnalysisKey = (song: SongResult): string => getPlaybackAnalysisTarget(song).key;

/**
 * The analysis key and the representation it names, resolved together. A caller that reads bytes
 * and later stores what it measured under the key must use this rather than two lookups: a transcode
 * registering in between would file the original's measurement under the transcode's key.
 */
export const getPlaybackAnalysisTarget = (
    song: SongResult,
): { key: string; representation: PlaybackRepresentation | null } => {
    const songKey = getPlaybackSongKey(song);
    const representation = getPlaybackRepresentation(song);
    return {
        key: representation ? `${songKey}@${representation.representationId}` : songKey,
        representation,
    };
};

export const clearPlaybackRepresentationsForTests = (): void => {
    representations.clear();
};
