import type { ReplayGainInfo, SongResult } from '../../types';
import type { MigrationResult } from '../../utils/lyrics/renderHints';
import { getCachedAudioBlob, hasCachedAudio, saveAudioBlob } from '../audioCache';
import { getCachedCoverUrl, hasCachedCover, saveCoverBlob } from '../coverCache';
import { getFromCache, saveToCache } from '../db';
import { getLegacySongResourceCacheKeys, getSongResourceCacheKey, type SongResourceKind } from './resourceKeys';

// src/services/onlineMusic/resourceCache.ts

const identityMigration = <T>(value: T): MigrationResult<T> => ({ value, changed: false });

// Reads legacy NetEase entries once and writes them back under the provider-aware key.
export const getSongCacheWithLegacyMigration = async <T>(
    kind: SongResourceKind,
    song: SongResult,
    migrate: (value: T) => MigrationResult<T> = identityMigration,
): Promise<T | null> => {
    const cacheKey = getSongResourceCacheKey(kind, song);
    const current = await getFromCache<T>(cacheKey);
    if (current != null) {
        const migrated = migrate(current);
        if (migrated.changed) void saveToCache(cacheKey, migrated.value);
        return migrated.value;
    }

    for (const legacyKey of getLegacySongResourceCacheKeys(kind, song)) {
        const legacy = await getFromCache<T>(legacyKey);
        if (legacy == null) continue;
        const migrated = migrate(legacy);
        await saveToCache(cacheKey, migrated.value);
        return migrated.value;
    }
    return null;
};

export const getCachedSongAudioBlob = async (song: SongResult): Promise<Blob | null> => {
    const cacheKey = getSongResourceCacheKey('audio', song);
    const current = await getCachedAudioBlob(cacheKey);
    if (current) return current;

    for (const legacyKey of getLegacySongResourceCacheKeys('audio', song)) {
        const legacy = await getCachedAudioBlob(legacyKey);
        if (!legacy) continue;
        await saveAudioBlob(cacheKey, legacy);
        return legacy;
    }
    return null;
};

export const hasCachedSongAudio = async (song: SongResult): Promise<boolean> => {
    const cacheKey = getSongResourceCacheKey('audio', song);
    if (await hasCachedAudio(cacheKey)) return true;

    for (const legacyKey of getLegacySongResourceCacheKeys('audio', song)) {
        if (await hasCachedAudio(legacyKey)) return true;
    }
    return false;
};

/**
 * The cover half of `hasCachedSongAudio`, and separate from it on purpose.
 *
 * The two caches are pruned independently - `cacheRepository` files them under different categories -
 * so "audio present, cover gone" is a state a listener reaches by normal use, not an edge case. Asked
 * on its own so a cover can be refilled without the audio needing to be missing too.
 */
export const hasCachedSongCover = async (song: SongResult): Promise<boolean> => {
    if (await hasCachedCover(getSongResourceCacheKey('cover', song))) return true;

    for (const legacyKey of getLegacySongResourceCacheKeys('cover', song)) {
        if (await hasCachedCover(legacyKey)) return true;
    }
    return false;
};

/**
 * ReplayGain, kept for as long as the audio it describes.
 *
 * It arrives only with an audio URL from the provider, and the whole point of the media cache is
 * never to ask for that URL again - so a track played from cache used to reach the fader with no
 * gain at all and silently fall back to 0dB. In album mode that is the one outcome the feature
 * exists to prevent: in a real listen, fifteen cached tracks played at 0dB while the sixteenth,
 * the only one whose URL had just been fetched, played 10.4dB down. A step that size mid-album is
 * far worse than no ReplayGain at all, and it got worse the more of an album was cached.
 *
 * Stored under the song's own resource key, beside the audio, the lyric and the cover.
 */
export const getCachedSongReplayGain = async (song: SongResult): Promise<ReplayGainInfo | undefined> => (
    await getFromCache<ReplayGainInfo>(getSongResourceCacheKey('replayGain', song)) ?? undefined
);

export const saveSongReplayGain = async (song: SongResult, replayGain: ReplayGainInfo): Promise<void> => {
    await saveToCache(getSongResourceCacheKey('replayGain', song), replayGain);
};

export const getCachedSongCoverUrl = async (song: SongResult): Promise<string | null> => {
    const cacheKey = getSongResourceCacheKey('cover', song);
    const current = await getCachedCoverUrl(cacheKey);
    if (current) return current;

    for (const legacyKey of getLegacySongResourceCacheKeys('cover', song)) {
        const legacyUrl = await getCachedCoverUrl(legacyKey);
        if (!legacyUrl) continue;
        try {
            const legacyBlob = await (await fetch(legacyUrl)).blob();
            await saveCoverBlob(cacheKey, legacyBlob);
        } catch (error) {
            console.warn('[ResourceCache] Failed to write back legacy cover cache', error);
        }
        return legacyUrl;
    }
    return null;
};
