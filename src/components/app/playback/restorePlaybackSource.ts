import i18n from '../../../i18n/config';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { getCachedAudioBlob } from '../../../services/audioCache';
import { getCachedCoverUrl } from '../../../services/coverCache';
import { getFromCacheWithMigration, getLocalSongs } from '../../../services/db';
import { ensureLocalSongEmbeddedCover, getAudioFromLocalSong } from '../../../services/localMusicService';
import { getOnlineSongCacheKey, isCloudSong, neteaseApi } from '../../../services/netease';
import { getNavidromeConfig, navidromeApi } from '../../../services/navidromeService';
import type { ThemeCacheSongKey } from '../../../services/themeCache';
import type { LyricData, LocalSong, SongResult, StatusMessage } from '../../../types';
import type { NavidromeSong } from '../../../types/navidrome';
import { hydrateNavidromeLyricPayload, resolvePreferredNavidromeLyrics } from '../../../utils/appNavidromeLyrics';
import { hasRenderableLyrics } from '../../../utils/appPlaybackHelpers';
import { isLocalPlaybackSong, isNavidromePlaybackSong } from '../../../utils/appPlaybackGuards';
import { isBlob } from '../../../utils/blobGuards';
import { LyricParserFactory } from '../../../utils/lyrics/LyricParserFactory';
import { processNeteaseLyrics } from '../../../utils/lyrics/neteaseProcessing';
import { isPureMusicLyricText } from '../../../utils/lyrics/pureMusic';
import { migrateLyricDataRenderHints } from '../../../utils/lyrics/renderHints';
import { loadOnlineLyricsState, resolveOnlineLyrics } from '../../../utils/onlineLyricsState';

// src/components/app/playback/restorePlaybackSource.ts
// Rehydrates playable audio and lyrics for a remembered song without reusing stale blob URLs.

type SetState<T> = Dispatch<SetStateAction<T>>;

type RestorePlaybackSourceParams = {
    audioQuality: string;
    userId?: number;
    blobUrlRef: MutableRefObject<string | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
    setCurrentSong: SetState<SongResult | null>;
    setCachedCoverUrl: SetState<string | null>;
    setAudioSrc: SetState<string | null>;
    setLyrics: (nextLyrics: LyricData | null) => void;
    setStatusMsg: SetState<StatusMessage | null>;
    restoreCachedThemeForSong?: (songId: ThemeCacheSongKey, options?: {
        allowLastUsedFallback?: boolean;
        preserveCurrentOnMiss?: boolean;
    }) => Promise<unknown>;
    persistLastPlaybackCache?: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    queue?: SongResult[];
};

const replaceBlobUrl = (
    blobUrlRef: MutableRefObject<string | null>,
    nextBlobUrl: string,
) => {
    if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
    }
    blobUrlRef.current = nextBlobUrl;
};

export const restorePlaybackSourceForSong = async (
    song: SongResult,
    {
        audioQuality,
        userId,
        blobUrlRef,
        currentOnlineAudioUrlFetchedAtRef,
        setCurrentSong,
        setCachedCoverUrl,
        setAudioSrc,
        setLyrics,
        setStatusMsg,
        restoreCachedThemeForSong,
        persistLastPlaybackCache,
        queue,
    }: RestorePlaybackSourceParams,
) => {
    await restoreCachedThemeForSong?.(song.id, {
        allowLastUsedFallback: true,
        preserveCurrentOnMiss: false,
    });

    setCachedCoverUrl(await getCachedCoverUrl(getOnlineSongCacheKey('cover', song)));

    if (isNavidromePlaybackSong(song)) {
        const navidromeSongToRestore = (song as unknown as SongResult & { navidromeData?: NavidromeSong }).navidromeData;
        const config = getNavidromeConfig();
        const navidromeId = navidromeSongToRestore?.navidromeData?.id;

        if (!navidromeSongToRestore || !config || !navidromeId) {
            console.warn('[restorePlaybackSourceForSong] Navidrome song could not be restored');
            return false;
        }

        currentOnlineAudioUrlFetchedAtRef.current = null;
        setAudioSrc(navidromeApi.getStreamUrl(config, navidromeId));
        const restoredCoverUrl = song.al?.picUrl || song.album?.picUrl || navidromeSongToRestore.navidromeData.coverArtUrl;
        if (restoredCoverUrl) {
            setCachedCoverUrl(restoredCoverUrl);
        }

        if (navidromeSongToRestore.lyricsSource === 'online' && navidromeSongToRestore.matchedLyrics) {
            setLyrics(navidromeSongToRestore.matchedLyrics);
        } else {
            await hydrateNavidromeLyricPayload(config, navidromeSongToRestore);
            const restoredLyrics = await resolvePreferredNavidromeLyrics(navidromeSongToRestore);
            if (hasRenderableLyrics(restoredLyrics)) {
                navidromeSongToRestore.lyricsSource = 'navi';
            }
            setLyrics(restoredLyrics);
        }

        const restoredSong = { ...song, navidromeData: navidromeSongToRestore } as SongResult;
        setCurrentSong(restoredSong);
        void persistLastPlaybackCache?.(restoredSong, queue && queue.length > 0 ? queue : [restoredSong]);
        return true;
    }

    if (isLocalPlaybackSong(song)) {
        const localData = (song as SongResult & { localData?: LocalSong }).localData;
        let songToRestore: LocalSong | undefined;
        const songs = await getLocalSongs();

        if (localData?.id) {
            songToRestore = songs.find(candidate => candidate.id === localData.id);
        }

        if (!songToRestore) {
            songToRestore = songs.find(candidate =>
                (candidate.title || candidate.fileName) === song.name &&
                Math.abs(candidate.duration - song.duration) < 1000,
            );
        }

        if (!songToRestore) {
            console.warn('[restorePlaybackSourceForSong] Could not find local song in library');
            setStatusMsg({
                type: 'info',
                text: i18n.t('status.localSongNotInLibrary'),
            });
            return false;
        }

        const blobUrl = await getAudioFromLocalSong(songToRestore);
        if (!blobUrl) {
            console.warn('[restorePlaybackSourceForSong] Local song file not accessible - needs resync');
            setStatusMsg({
                type: 'info',
                text: i18n.t('status.localFileReauthorize'),
            });
            return false;
        }

        songToRestore = await ensureLocalSongEmbeddedCover(songToRestore);
        replaceBlobUrl(blobUrlRef, blobUrl);
        currentOnlineAudioUrlFetchedAtRef.current = null;
        setAudioSrc(blobUrl);

        const source = songToRestore.lyricsSource;
        if (source === 'online' && songToRestore.matchedLyrics) {
            setLyrics(songToRestore.matchedLyrics);
        } else if (source === 'embedded' && songToRestore.embeddedLyricsContent) {
            setLyrics(await LyricParserFactory.parse({
                type: 'embedded',
                textContent: songToRestore.embeddedLyricsContent,
                translationContent: songToRestore.embeddedTranslationLyricsContent,
            }));
        } else if ((source === 'local' || songToRestore.hasLocalLyrics) && songToRestore.localLyricsContent) {
            setLyrics(await LyricParserFactory.parse({
                type: 'local',
                lrcContent: songToRestore.localLyricsContent,
                tLrcContent: songToRestore.localTranslationLyricsContent,
                formatHint: songToRestore.localLyricsFormat,
            }));
        } else if (songToRestore.hasEmbeddedLyrics && songToRestore.embeddedLyricsContent) {
            setLyrics(await LyricParserFactory.parse({
                type: 'embedded',
                textContent: songToRestore.embeddedLyricsContent,
                translationContent: songToRestore.embeddedTranslationLyricsContent,
            }));
        } else if (songToRestore.matchedLyrics) {
            setLyrics(songToRestore.matchedLyrics);
        }

        if (isBlob(songToRestore.embeddedCover)) {
            setCachedCoverUrl(URL.createObjectURL(songToRestore.embeddedCover));
        } else if (songToRestore.matchedCoverUrl) {
            setCachedCoverUrl(songToRestore.matchedCoverUrl);
        }
        return true;
    }

    const onlineLyricsState = await loadOnlineLyricsState(song);
    if (onlineLyricsState) {
        setCurrentSong(prev => prev?.id === song.id ? { ...prev, onlineLyricsState } : prev);
    }

    const cachedAudio = await getCachedAudioBlob(getOnlineSongCacheKey('audio', song));
    if (cachedAudio) {
        const blobUrl = URL.createObjectURL(cachedAudio);
        replaceBlobUrl(blobUrlRef, blobUrl);
        currentOnlineAudioUrlFetchedAtRef.current = null;
        setAudioSrc(blobUrl);
    } else {
        const urlRes = await neteaseApi.getSongUrl(song.id, audioQuality);
        let url = urlRes.data?.[0]?.url;
        if (url) {
            if (url.startsWith('http:')) {
                url = url.replace('http:', 'https:');
            }
            currentOnlineAudioUrlFetchedAtRef.current = Date.now();
            setAudioSrc(url);
        }
    }

    const cachedLyrics = await getFromCacheWithMigration<LyricData>(
        getOnlineSongCacheKey('lyric', song),
        migrateLyricDataRenderHints,
    );
    const restoredPreferredLyrics = resolveOnlineLyrics(onlineLyricsState, cachedLyrics);
    if (restoredPreferredLyrics) {
        const cachedText = restoredPreferredLyrics.lines.map(line => line.fullText).join('\n');
        setCurrentSong(prev => prev?.id === song.id ? {
            ...prev,
            isPureMusic: onlineLyricsState?.lyricsSource === 'online' && typeof onlineLyricsState.matchedIsPureMusic === 'boolean'
                ? onlineLyricsState.matchedIsPureMusic
                : isPureMusicLyricText(cachedText),
        } : prev);
        setLyrics(restoredPreferredLyrics);
        return true;
    }

    const lyricRes = isCloudSong(song) && userId
        ? await neteaseApi.getCloudLyric(userId, song.id)
        : await neteaseApi.getLyric(song.id);
    const processed = await processNeteaseLyrics(neteaseApi.getProcessedLyricPayload(lyricRes), { songId: song.id });
    const resolvedLyrics = resolveOnlineLyrics(onlineLyricsState, processed.lyrics);
    setCurrentSong(prev => prev?.id === song.id ? {
        ...prev,
        isPureMusic: onlineLyricsState?.lyricsSource === 'online' && typeof onlineLyricsState.matchedIsPureMusic === 'boolean'
            ? onlineLyricsState.matchedIsPureMusic
            : processed.isPureMusic,
    } : prev);
    setLyrics(resolvedLyrics);
    return true;
};
