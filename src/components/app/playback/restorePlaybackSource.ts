import i18n from '../../../i18n/config';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { getCachedCoverUrl, loadCachedOrFetchCover } from '../../../services/coverCache';
import { getLocalSongs } from '../../../services/db';
import { ensureLocalSongEmbeddedCover, getAudioFromLocalSong } from '../../../services/localMusicService';
import { applyLocalLibraryEntityDisplay, buildUnifiedLocalSong } from '../../../services/playbackAdapters';
import { getLocalLibraryCatalogSnapshot } from '../../../services/localLibraryEntityRepository';
import { getNavidromeConfig, navidromeApi } from '../../../services/navidromeService';
import type { ThemeCacheSongKey } from '../../../services/themeCache';
import type { LyricData, LocalSong, SongResult, StatusMessage } from '../../../types';
import type { NavidromeSong } from '../../../types/navidrome';
import { hydrateNavidromeLyricPayload, resolvePreferredNavidromeLyrics } from '../../../utils/appNavidromeLyrics';
import { hasRenderableLyrics, toSafeRemoteUrl } from '../../../utils/appPlaybackHelpers';
import {
    isLocalPlaybackSong,
    isNavidromePlaybackSong,
    isSamePlaybackSong,
    replacePlaybackSongInQueue,
} from '../../../utils/appPlaybackGuards';
import { createSafeObjectUrl, isBlob } from '../../../utils/blobGuards';
import { LyricParserFactory } from '../../../utils/lyrics/LyricParserFactory';
import { isPureMusicLyricText } from '../../../utils/lyrics/pureMusic';
import { migrateLyricDataRenderHints } from '../../../utils/lyrics/renderHints';
import { loadOnlineLyricsState, resolveOnlineLyrics } from '../../../utils/onlineLyricsState';
import type { AudioQualityPreference, MediaId } from '../../../types/onlineMusic';
import { omni } from '../../../services/onlineMusic/omni';
import { getSongResourceCacheKey } from '../../../services/onlineMusic/resourceKeys';
import { getCachedSongAudioBlob, getCachedSongCoverUrl, getSongCacheWithLegacyMigration } from '../../../services/onlineMusic/resourceCache';
import { getSongCoverUrl } from '../../../services/onlineMusic/songMetadata';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';

// src/components/app/playback/restorePlaybackSource.ts
// Rehydrates playable audio and lyrics for a remembered song without reusing stale blob URLs.

type SetState<T> = Dispatch<SetStateAction<T>>;

type RestorePlaybackSourceParams = {
    audioQuality: AudioQualityPreference;
    userId?: MediaId;
    blobUrlRef: MutableRefObject<string | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
    setCurrentSong: SetState<SongResult | null>;
    setCachedCoverUrl: SetState<string | null>;
    setAudioSrc: SetState<string | null>;
    setLyrics: (nextLyrics: LyricData | null) => void;
    setStatusMsg: SetState<StatusMessage | null>;
    restoreCachedThemeForSong?: (songId: ThemeCacheSongKey | SongResult, options?: {
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
    await restoreCachedThemeForSong?.(song, {
        allowLastUsedFallback: true,
        preserveCurrentOnMiss: false,
    });

    setCachedCoverUrl(await getCachedSongCoverUrl(song));

    if (isNavidromePlaybackSong(song)) {
        const navidromeSongToRestore = (song as unknown as SongResult & { navidromeData?: NavidromeSong }).navidromeData;
        const config = getNavidromeConfig();
        const navidromeId = navidromeSongToRestore?.navidromeData?.id;

        if (!navidromeSongToRestore || !config || !navidromeId) {
            console.warn('[restorePlaybackSourceForSong] Navidrome song could not be restored');
            return false;
        }

        currentOnlineAudioUrlFetchedAtRef.current = null;
        const serverSong = await navidromeApi.getSong(config, navidromeId);
        if (serverSong?.replayGain) {
            navidromeSongToRestore.navidromeData.replayGain = serverSong.replayGain;
        }
        setAudioSrc(navidromeApi.getStreamUrl(config, navidromeId));
        const restoredCoverUrl = getSongCoverUrl(song) || navidromeSongToRestore.navidromeData.coverArtUrl;
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

    const legacyLocalData = (song as SongResult & { localData?: LocalSong }).localData;
    if (isLocalPlaybackSong(song) || legacyLocalData?.id) {
        const localSongId = isLocalPlaybackSong(song) ? song.localRef.songId : legacyLocalData?.id;
        let songToRestore: LocalSong | undefined;
        const songs = await getLocalSongs();

        if (localSongId) {
            songToRestore = songs.find(candidate => candidate.id === localSongId);
        }

        if (!songToRestore) {
            songToRestore = songs.find(candidate =>
                (candidate.title || candidate.fileName) === song.name &&
                Math.abs(candidate.duration - song.durationMs) < 1000,
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
        const catalog = await getLocalLibraryCatalogSnapshot();
        const restoredSong = applyLocalLibraryEntityDisplay(buildUnifiedLocalSong({
            localSong: songToRestore,
            matchedSong: null,
            coverUrl: songToRestore.useOnlineCover ? songToRestore.onlineMetadata?.coverUrl || null : null,
            preferOnlineMetadata: false,
        }), catalog);
        setCurrentSong(restoredSong);
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

        const cacheKey = `cover_local_${songToRestore.id}`;
        const cachedCoverUrl = songToRestore.useOnlineCover
            ? await getCachedCoverUrl(cacheKey)
            : null;
        if (cachedCoverUrl) setCachedCoverUrl(cachedCoverUrl);
        else if (songToRestore.useOnlineCover && songToRestore.onlineMetadata?.coverUrl) {
            setCachedCoverUrl(await loadCachedOrFetchCover(cacheKey, songToRestore.onlineMetadata.coverUrl));
        } else if (isBlob(songToRestore.embeddedCover)) {
            setCachedCoverUrl(createSafeObjectUrl(songToRestore.embeddedCover));
        } else {
            setCachedCoverUrl(null);
        }
        const restoredQueue = replacePlaybackSongInQueue(queue || [restoredSong], restoredSong);
        void persistLastPlaybackCache?.(restoredSong, restoredQueue);
        return true;
    }

    const onlineLyricsState = await loadOnlineLyricsState(song);
    if (onlineLyricsState) {
        setCurrentSong(prev => {
            if (!prev || !isSamePlaybackSong(prev, song)) return prev;
            return { ...prev, onlineLyricsState };
        });
    }

    if (!omni.canPlaySong(song)) {
        setStatusMsg({ type: 'error', text: i18n.t('status.playbackFailed') });
        return false;
    }

    const cachedAudio = await getCachedSongAudioBlob(song);
    let restoredCachedAudio = false;
    if (cachedAudio) {
        const blobUrl = createSafeObjectUrl(cachedAudio);
        if (blobUrl) {
            replaceBlobUrl(blobUrlRef, blobUrl);
            currentOnlineAudioUrlFetchedAtRef.current = null;
            setAudioSrc(blobUrl);
            restoredCachedAudio = true;
        }
    }
    if (!restoredCachedAudio) {
        const audioSource = await omni.getAudioSource(song, audioQuality);
        const url = toSafeRemoteUrl(audioSource?.url);
        if (url) {
            currentOnlineAudioUrlFetchedAtRef.current = Date.now();
            setAudioSrc(url);
        } else {
            setStatusMsg({ type: 'error', text: i18n.t('status.playbackFailed') });
            return false;
        }
    }

    const cachedLyrics = await getSongCacheWithLegacyMigration<LyricData>('lyric', song, migrateLyricDataRenderHints);
    const restoredPreferredLyrics = resolveOnlineLyrics(onlineLyricsState, cachedLyrics);
    if (restoredPreferredLyrics) {
        const cachedText = restoredPreferredLyrics.lines.map(line => line.fullText).join('\n');
        setCurrentSong(prev => {
            if (!prev || !isSamePlaybackSong(prev, song)) return prev;
            return {
                ...prev,
                isPureMusic: onlineLyricsState?.lyricsSource === 'online' && typeof onlineLyricsState.matchedIsPureMusic === 'boolean'
                    ? onlineLyricsState.matchedIsPureMusic
                    : isPureMusicLyricText(cachedText),
            };
        });
        setLyrics(restoredPreferredLyrics);
        return true;
    }

    const songProviderId = song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : null;
    const effectiveUserId = songProviderId
        ? (useOnlineProviderAccountStore.getState().accounts[songProviderId]?.user?.id ?? userId)
        : userId;
    const processed = await omni.getLyrics(song, { userId: effectiveUserId });
    const resolvedLyrics = resolveOnlineLyrics(onlineLyricsState, processed.lyrics);
    setCurrentSong(prev => {
        if (!prev || !isSamePlaybackSong(prev, song)) return prev;
        return {
            ...prev,
            isPureMusic: onlineLyricsState?.lyricsSource === 'online' && typeof onlineLyricsState.matchedIsPureMusic === 'boolean'
                ? onlineLyricsState.matchedIsPureMusic
                : processed.isPureMusic,
        };
    });
    setLyrics(resolvedLyrics);
    return true;
};
