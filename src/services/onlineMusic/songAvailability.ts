import type { SongResult, UnifiedSong } from '../../types';
import type { ProviderSongAvailability, ProviderSongReplacement } from '../../types/onlineMusic';
import { getOnlineMusicProviderForSong } from './providerRegistry';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';

// src/services/onlineMusic/songAvailability.ts

const PLAYABLE: ProviderSongAvailability = { state: 'playable' };
const UNKNOWN: ProviderSongAvailability = { state: 'unknown' };

// Resolves provider-owned availability without exposing provider-specific fields to UI code.
export const getSongAvailability = (song: SongResult): ProviderSongAvailability => {
    if (getPlaybackSourceRef(song).kind !== 'online') return PLAYABLE;

    const provider = getOnlineMusicProviderForSong(song);
    return provider?.playback?.getAvailability?.(song) || UNKNOWN;
};

export const isSongUnavailable = (song: SongResult | null | undefined): boolean => (
    Boolean(song && getSongAvailability(song).state === 'unavailable')
);

export const getSongUnavailableLabel = (
    song: SongResult | null | undefined,
    fallbackLabel: string,
): string => {
    if (!song) return fallbackLabel;
    return getSongAvailability(song).label || fallbackLabel;
};

// The tag a row shows beside a song's name: why it cannot be played, else that its audio is a
// video's; '' where it shows none.
export const getSongTag = (song: SongResult, labels: { unavailable: string; video: string }): string => {
    if (isSongUnavailable(song)) return getSongUnavailableLabel(song, labels.unavailable);
    return song.isVideo ? labels.video : '';
};

export const getSongReplacement = async (
    song: SongResult,
): Promise<ProviderSongReplacement | null> => {
    if (getPlaybackSourceRef(song).kind !== 'online') return null;
    return getOnlineMusicProviderForSong(song)?.playback?.getReplacement?.(song) || null;
};

/**
 * The song `song` is played as in its place (the platform's getPlayedSong), or null; null without
 * a wait where its platform has no such song, and where the platform could not be asked.
 */
export const askPlayedSong = (song: SongResult): Promise<UnifiedSong | null> | null => {
    if (getPlaybackSourceRef(song).kind !== 'online') return null;
    const playback = getOnlineMusicProviderForSong(song)?.playback;
    return playback?.getPlayedSong ? playback.getPlayedSong(song).catch(() => null) : null;
};
