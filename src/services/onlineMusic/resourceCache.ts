import type { ReplayGainInfo, SongResult } from '../../types';
import type { AudioQualityPreference } from '../../types/onlineMusic';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import type { MigrationResult } from '../../utils/lyrics/renderHints';
import { getCachedAudioBlob, hasCachedAudio, removeAudioBlob, saveAudioBlob } from '../audioCache';
import { getCachedCoverUrl, hasCachedCover, saveCoverBlob } from '../coverCache';
import { getFromCache, removeFromCache, saveToCache } from '../db';
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

/**
 * The quality level a song's cached audio was fetched at, kept beside it like the ReplayGain below.
 *
 * The audio key names the song and no level, so a copy fetched at one level used to answer for all
 * of them: a song played to its end at 'standard' went on playing that copy after the quality
 * option was moved to 'high'. A reader that passes the level it wants (playback, the prefetch pass,
 * the end-of-song writer) now gets a miss for a copy of another one. A reader that passes none (the
 * automix analysis and the stems, whose results are kept per song) takes any copy. So does a copy
 * with no level saved - every copy older than this record, and the legacy NetEase ones: its level
 * is unknown and it answers for any, as before.
 */
const getSongAudioLevelKey = (song: SongResult): string => `audioLevel_${getPlaybackSongKey(song)}`;

/**
 * Called after a song's audio is written from a URL (the end-of-song writer, the automix analysis
 * read), with the level that URL was fetched at. Without one the level saved for an earlier copy
 * is removed: it does not describe the new copy, which is then of an unknown level.
 */
export const saveSongAudioLevel = async (song: SongResult, level: AudioQualityPreference | undefined): Promise<void> => {
    if (level) await saveToCache(getSongAudioLevelKey(song), level);
    else await removeFromCache(getSongAudioLevelKey(song));
};

// Whether the song's own copy is to be passed over: it is there, and was fetched at another level
// than the one asked for. The saved level is read first, so that such a copy is never read into
// memory. It outlives a pruned file, so the file is asked for before the copy is called passed over.
const isCopyOfAnotherLevel = async (
    song: SongResult,
    cacheKey: string,
    level: AudioQualityPreference | undefined,
): Promise<boolean> => {
    if (!level) return false;
    const saved = await getFromCache<AudioQualityPreference>(getSongAudioLevelKey(song));
    if (!saved || saved === level || !await hasCachedAudio(cacheKey)) return false;
    console.log(`[Cache] Copy of ${getPlaybackSongKey(song)} passed over: fetched at ${saved}, asked for ${level}`);
    return true;
};

export const getCachedSongAudioBlob = async (song: SongResult, level?: AudioQualityPreference): Promise<Blob | null> => {
    const cacheKey = getSongResourceCacheKey('audio', song);
    if (await isCopyOfAnotherLevel(song, cacheKey, level)) return null;
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

/**
 * Deletes the song's audio copy that was read (`size` bytes) with the level saved for it: for a
 * copy playback found not to be the song (onlinePlayback.ts). Under the legacy keys too, which
 * `getCachedSongAudioBlob` would otherwise copy back under the song's own key on the next read. A
 * file written since the read is not that copy and stays, and so does the level: it is the new
 * file's. Resolves to whether a copy was deleted.
 */
export const deleteCachedSongAudio = async (song: SongResult, size: number): Promise<boolean> => {
    let deleted = false;
    for (const cacheKey of [getSongResourceCacheKey('audio', song), ...getLegacySongResourceCacheKeys('audio', song)]) {
        if (await removeAudioBlob(cacheKey, size)) deleted = true;
    }
    if (deleted) await removeFromCache(getSongAudioLevelKey(song));
    return deleted;
};

export const hasCachedSongAudio = async (song: SongResult, level?: AudioQualityPreference): Promise<boolean> => {
    const cacheKey = getSongResourceCacheKey('audio', song);
    if (await isCopyOfAnotherLevel(song, cacheKey, level)) return false;
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
