import { getLocalSong } from '../../../../services/db';
import type { HifiTrackSource } from '../../../../services/hifi/hifiPlayback';
import { ensureLocalSongCoverAsset, getAudioFromLocalSong, getFileFromLocalSong } from '../../../../services/localMusicService';
import { getNavidromeConfig, navidromeApi } from '../../../../services/navidromeService';
import { loadOnlineSongAudioSource, type LoadOnlineAudioSourceOptions } from '../../../../services/onlinePlayback';
import { getPlaybackRepresentationForRevision } from '../../../../services/playbackRecovery/representationRegistry';
import { buildLocalSourceRevision, buildNavidromeSourceRevision } from '../../../../services/playbackRecovery/sourceRevision';
import type { PrefetchedSongData } from '../../../../services/prefetchService';
import type { LocalSong, SongResult } from '../../../../types';
import type { NavidromeConfig, NavidromeSong, SubsonicSong } from '../../../../types/navidrome';
import type { AudioQualityPreference } from '../../../../types/onlineMusic';
import {
    getPlaybackSongKey,
    isLocalPlaybackSong,
    isNavidromePlaybackSong,
    resolveNavidromePlaybackCarrier,
} from '../../../../utils/appPlaybackGuards';

// src/components/app/playback/source/songAudioSource.ts
//
// How each kind of song gets the address its audio plays from, and what comes with that address.
// One function per kind. Every route that starts, restores or recovers playback calls it: playSong,
// onPlayLocalSong, onPlayNavidromeSong, restorePlaybackSourceForSong and the online recovery.
//
// What a route does around the address stays in the route: the queue, the player state, the status
// message, the lyrics, the theme, its checks whether it was overtaken, and what becomes of the blob
// URL that was there before.

/**
 * A local file: its audio behind a fresh blob URL, and its library record with the cover asset
 * made if it had none. null when the file cannot be read.
 * The caller owns `blobUrl`: it plays it, or hands it to `retireBlobUrl`.
 */
export const loadLocalSongAudio = async (localSong: LocalSong) => {
    const blobUrl = await getAudioFromLocalSong(localSong);
    if (!blobUrl) return null;
    const preparedSong = await ensureLocalSongCoverAsset(localSong);
    return {
        blobUrl,
        localSong: preparedSong,
        /**
         * The copy that took the place of this file's audio earlier in this session (a transcode of
         * a format the browser cannot play), if it was made from the file as it is now.
         */
        recoveredCopy: (songKey: string) => (
            getPlaybackRepresentationForRevision(songKey, buildLocalSourceRevision(preparedSong))
        ),
    };
};

/**
 * A local file for the HiFi route: the file itself, which mpv reads through the main process (it
 * cannot open a blob URL, so none is made), and its library record with the cover asset made if it
 * had none. null when the file cannot be read.
 */
export const loadLocalSongHifiSource = async (localSong: LocalSong) => {
    const file = await getFileFromLocalSong(localSong);
    if (!file) return null;
    const preparedSong = await ensureLocalSongCoverAsset(localSong);
    return { file, localSong: preparedSong };
};

/**
 * The HiFi source of a song waiting in the queue, for mpv to queue behind the song playing so that
 * it follows without a gap: a local file read as `loadLocalSongHifiSource` reads it (its cover asset
 * is left for the play that takes it over), or a Navidrome song's stream of the original file with
 * the server's configuration of now. null for any other song, or when the file or the server
 * cannot be reached.
 */
export const loadQueuedSongHifiSource = async (song: SongResult): Promise<HifiTrackSource | null> => {
    if (isLocalPlaybackSong(song)) {
        const localSong = await getLocalSong(song.localRef.songId);
        const file = localSong ? await getFileFromLocalSong(localSong) : null;
        return localSong && file ? { kind: 'local', localSong, file } : null;
    }
    const carrier = isNavidromePlaybackSong(song) ? resolveNavidromePlaybackCarrier(song) : null;
    const config = carrier ? getNavidromeConfig() : null;
    if (!carrier || !config) return null;
    return { kind: 'navidrome', carrier, streamUrl: navidromeApi.getStreamUrl(config, carrier.navidromeData.id, 'raw') };
};

// The original file's format as the server knows it, written onto the song for the HiFi route's
// signal path (services/hifi/sourceSpec.ts). A field the server leaves out keeps what the song had.
const writeServerFormat = (navidromeData: NavidromeSong['navidromeData'], answered: SubsonicSong) => {
    if (answered.contentType) navidromeData.contentType = answered.contentType;
    if (typeof answered.bitDepth === 'number') navidromeData.bitDepth = answered.bitDepth;
    if (typeof answered.samplingRate === 'number') navidromeData.samplingRate = answered.samplingRate;
    if (typeof answered.channelCount === 'number') navidromeData.channelCount = answered.channelCount;
};

/**
 * A Navidrome song: its stream address, built here (nothing is fetched for it), and the server's
 * own record of the song, asked for at once and waited for by `takeServerGain`.
 */
export const loadNavidromeSongAudio = (config: NavidromeConfig, navidromeSong: NavidromeSong) => {
    const songId = navidromeSong.navidromeData.id;
    const streamUrl = navidromeApi.getStreamUrl(config, songId);
    const serverSong = navidromeApi.getSong(config, songId);
    return {
        streamUrl,
        /**
         * The stream of the original file, never transcoded by the server: what mpv plays on the
         * HiFi route. Built when asked for. Its query carries the credentials, as `streamUrl`'s does.
         */
        rawStreamUrl: () => navidromeApi.getStreamUrl(config, songId, 'raw'),
        /** Waits for the server's record and writes its replay gain onto the song. */
        takeServerGain: async () => {
            const answered = await serverSong;
            if (answered?.replayGain) {
                navidromeSong.navidromeData.replayGain = answered.replayGain;
            }
        },
        /**
         * The HiFi route's `takeServerGain`: the same wait, and the original file's format (content
         * type, bit depth, sampling rate, channels) written onto the song along with the gain.
         */
        takeServerGainAndFormat: async () => {
            const answered = await serverSong;
            if (!answered) return;
            if (answered.replayGain) {
                navidromeSong.navidromeData.replayGain = answered.replayGain;
            }
            writeServerFormat(navidromeSong.navidromeData, answered);
        },
        /** The source revision of `song` when it plays from this address. */
        revisionOf: (song: SongResult) => buildNavidromeSourceRevision(song, streamUrl),
        /** The copy that took the place of this stream earlier in this session, if it was made from it. */
        recoveredCopy: (song: SongResult) => (
            getPlaybackRepresentationForRevision(getPlaybackSongKey(song), buildNavidromeSourceRevision(song, streamUrl))
        ),
    };
};

/**
 * An online song: what `loadOnlineSongAudioSource` answers, and with an address the moment it was
 * fetched. `fetchedAt` is the time of the prefetch when the prefetched address is the one answered,
 * now for an address that was just asked for, and null for a copy from the media cache, which
 * does not run out. `options`: what the route asks of the load (passing over the media cache, asking
 * again where the platform could not be reached), as `loadOnlineSongAudioSource` takes them.
 */
export const loadOnlineSongAudio = async (
    song: SongResult,
    audioQuality: AudioQualityPreference,
    prefetched: PrefetchedSongData | null = null,
    options: LoadOnlineAudioSourceOptions = {},
) => {
    const result = await loadOnlineSongAudioSource(song, audioQuality, prefetched, options);
    if (result.kind !== 'ok') return result;
    const fetchedAt = result.blobUrl
        ? null
        : prefetched?.audioUrl === result.audioSrc ? prefetched.audioUrlFetchedAt : Date.now();
    return { ...result, fetchedAt };
};
