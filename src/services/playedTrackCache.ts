import type { SongResult } from '../types';
import { saveAudioBlob } from './audioCache';
import { saveToCache } from './db';
import { hasCachedSongAudio, hasCachedSongCover } from './onlineMusic/resourceCache';
import { getSongResourceCacheKey } from './onlineMusic/resourceKeys';
import { getProviderSongMetadata } from './onlineMusic/songMetadata';
import { getPlaybackSourceRef } from '../utils/appPlaybackGuards';

// src/services/playedTrackCache.ts

/** What a call actually wrote, so a caller can skip refreshing a cache-usage readout for nothing. */
export type PlayedTrackCacheResult = { audio: boolean; cover: boolean };

const NOTHING_WRITTEN: PlayedTrackCacheResult = { audio: false, cover: false };

/**
 * Stores a fully-played track's audio and cover in the media cache.
 *
 * Takes the song and its source explicitly rather than reading the app's current track, because the
 * automix settle path caches the track that just faded OUT - and by then the app's own state already
 * names the track that arrived. `coverUrl` is the currently-displayed cover (which may carry a user
 * override); left undefined - the automix path - the cover comes from the song's own metadata.
 *
 * The two resources are asked about separately, and that separation is the point. They are pruned
 * under different categories, so "audio still cached, cover already gone" is a state ordinary use
 * reaches; while one early return covered both, such a track could never get its cover back, and a
 * blob-source track could never cache a cover at all. Neither resource's presence says anything
 * about the other's.
 */
export const cachePlayedTrackAssets = async (
    song: SongResult | null,
    src: string | null,
    coverUrl?: string | null,
): Promise<PlayedTrackCacheResult> => {
    if (!song) return NOTHING_WRITTEN;

    const result: PlayedTrackCacheResult = { audio: false, cover: false };

    // Audio needs a source that can actually be refetched: a blob: URL is this session's own handle
    // to bytes that are either already cached or on disk, so there is nothing to fetch and store.
    if (src && !src.startsWith('blob:') && !await hasCachedSongAudio(song)) {
        console.log('[Cache] Caching fully played song:', song.name);
        try {
            const response = await fetch(src);
            const blob = await response.blob();
            await saveAudioBlob(getSongResourceCacheKey('audio', song), blob);
            result.audio = true;
            console.log('[Cache] Audio saved');
        } catch (error) {
            console.error('[Cache] Failed to download audio for cache', error);
        }
    }

    const rawCover = coverUrl !== undefined ? coverUrl : getProviderSongMetadata(song).coverUrl;
    const cover = rawCover?.startsWith('http:') ? rawCover.replace('http:', 'https:') : rawCover;
    // Remote covers, and not for local files. A local song's cover already lives under its own
    // `cover_local_<id>` key written by the library path; a matched online cover stored here would
    // land under `cover_local:<id>` instead - close enough to look right, read by nothing. The
    // `https:` test also keeps out the blob: URL the app hands back for an already-cached cover,
    // which the old code refetched and rewrote on every play.
    const isLocal = getPlaybackSourceRef(song).kind === 'local';
    if (!isLocal && cover?.startsWith('https:') && !await hasCachedSongCover(song)) {
        try {
            const response = await fetch(cover, { mode: 'cors' });
            const blob = await response.blob();
            await saveToCache(getSongResourceCacheKey('cover', song), blob);
            result.cover = true;
            console.log('[Cache] Cover saved');
        } catch (error) {
            console.error('[Cache] Failed to download cover for cache', error);
        }
    }

    return result;
};
