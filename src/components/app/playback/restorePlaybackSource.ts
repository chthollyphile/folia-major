import i18n from '../../../i18n/config';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { getCachedCoverUrl, loadCachedOrFetchCover } from '../../../services/coverCache';
import { getLocalSongs } from '../../../services/db';
import { ensureLocalSongCoverAsset, getAudioFromLocalSong } from '../../../services/localMusicService';
import { applyLocalLibraryEntityDisplay, buildUnifiedLocalSong } from '../../../services/playbackAdapters';
import { buildNavidromeSourceRevision } from '../../../services/playbackRecovery/sourceRevision';
import { getLocalLibraryCatalogSnapshot } from '../../../services/localLibraryEntityRepository';
import { getNavidromeConfig, navidromeApi } from '../../../services/navidromeService';
import { applyOnlineAudioSourceMetadata, loadOnlineSongAudioSource } from '../../../services/onlinePlayback';
import { getPlaybackFailureMessage } from '../../../services/playbackRecovery/playbackFailurePolicy';
import type { ThemeCacheSongKey } from '../../../services/themeCache';
import type { LyricData, LocalSong, SongResult, StatusMessage } from '../../../types';
import type { NavidromeSong } from '../../../types/navidrome';
import { hydrateNavidromeLyricPayload, resolvePreferredNavidromeLyrics } from '../../../utils/appNavidromeLyrics';
import { hasRenderableLyrics } from '../../../utils/appPlaybackHelpers';
import {
    getOnlineProviderIdForSong,
    isLocalPlaybackSong,
    isNavidromePlaybackSong,
    isSamePlaybackSong,
    replacePlaybackSongInQueue,
} from '../../../utils/appPlaybackGuards';
import { getLocalCoverAssetUrl } from '../../../services/localCoverAssetUrl';
import { isPureMusicLyricText } from '../../../utils/lyrics/pureMusic';
import { migrateLyricDataRenderHints } from '../../../utils/lyrics/renderHints';
import { resolveLocalSongLyrics } from '../../../utils/lyrics/localSongLyrics';
import { loadOnlineLyricsState, resolveOnlineLyrics } from '../../../utils/onlineLyricsState';
import type { AudioQualityPreference, MediaId } from '../../../types/onlineMusic';
import type { PlaybackFailure, RestorePlaybackSourceOutcome } from '../../../types/playbackFailure';
import { omni } from '../../../services/onlineMusic/omni';
import { getCachedSongCoverUrl, getSongCacheWithLegacyMigration } from '../../../services/onlineMusic/resourceCache';
import { getSongCoverUrl } from '../../../services/onlineMusic/songMetadata';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { setStatusMessage as setStatusMsg } from '../../../stores/useStatusMessageStore';
import { setActiveLocalLyricsSource, setAudioSrc, setCachedCoverUrl, setCurrentSong, usePlaybackStore } from '../../../stores/usePlaybackStore';
import { useLyricSettingsStore } from '../../../stores/useLyricSettingsStore';

// src/components/app/playback/restorePlaybackSource.ts
// Rehydrates playable audio and lyrics for a remembered song without reusing stale blob URLs.

type SetState<T> = Dispatch<SetStateAction<T>>;

type RestorePlaybackSourceParams = {
    audioQuality: AudioQualityPreference;
    userId?: MediaId;
    blobUrlRef: MutableRefObject<string | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
    setPlayQueue?: SetState<SongResult[]>;
    setLyrics: (nextLyrics: LyricData | null) => void;
    restoreCachedThemeForSong?: (songId: ThemeCacheSongKey | SongResult, options?: {
        allowLastUsedFallback?: boolean;
        preserveCurrentOnMiss?: boolean;
    }) => Promise<unknown>;
    persistLastPlaybackCache?: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    queue?: SongResult[];
    /**
     * The caller has a still-valid source of its own to fall back on (the window handoff's snapshot URL).
     * An online restore then fails after one attempt instead of waiting through the loader's silent
     * retries, and shows no message: the fallback plays, and should it fail too, its media error is
     * reported like any other.
     */
    hasFallbackSource?: boolean;
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

// Restore context: one plain error line naming the reason, no countdown and no buttons.
// It never replaces a persistent toast: that belongs to a newer play request (its retry / skip, or a
// countdown), which the store cannot yet tell apart from this song while that request is loading.
const showRestoreFailure = (failure: PlaybackFailure) => {
    const { key, params } = getPlaybackFailureMessage(failure);
    const message: StatusMessage = { type: 'error', text: params ? i18n.t(key, params) : i18n.t(key) };
    setStatusMsg(prev => (prev?.persistent ? prev : message));
};

// Restores the remembered song's source and lyrics. 'stale' means the listener moved on to another
// song while this was awaiting, so nothing was written for the old one.
export const restorePlaybackSourceForSong = async (
    song: SongResult,
    {
        audioQuality,
        userId,
        blobUrlRef,
        currentOnlineAudioUrlFetchedAtRef,
        setPlayQueue,
        setLyrics,
        restoreCachedThemeForSong,
        persistLastPlaybackCache,
        queue,
        hasFallbackSource = false,
    }: RestorePlaybackSourceParams,
): Promise<RestorePlaybackSourceOutcome> => {
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
            return 'failed';
        }

        currentOnlineAudioUrlFetchedAtRef.current = null;
        const serverSong = await navidromeApi.getSong(config, navidromeId);
        if (serverSong?.replayGain) {
            navidromeSongToRestore.navidromeData.replayGain = serverSong.replayGain;
        }
        const restoredStreamUrl = navidromeApi.getStreamUrl(config, navidromeId);
        setAudioSrc(restoredStreamUrl);
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

        const restoredCarrier = { ...song, navidromeData: navidromeSongToRestore } as SongResult;
        // Recomputed rather than carried over from the persisted object: without a revision every
        // representation lookup misses, and a restored session re-transcodes what is already cached.
        const restoredSong = {
            ...restoredCarrier,
            playbackSourceRevision: buildNavidromeSourceRevision(restoredCarrier, restoredStreamUrl),
        } as SongResult;
        setCurrentSong(restoredSong);
        void persistLastPlaybackCache?.(restoredSong, queue && queue.length > 0 ? queue : [restoredSong]);
        return 'restored';
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
            return 'failed';
        }

        const blobUrl = await getAudioFromLocalSong(songToRestore);
        if (!blobUrl) {
            console.warn('[restorePlaybackSourceForSong] Local song file not accessible - needs resync');
            setStatusMsg({
                type: 'info',
                text: i18n.t('status.localFileReauthorize'),
            });
            return 'failed';
        }

        songToRestore = await ensureLocalSongCoverAsset(songToRestore);
        const localCoverUrl = getLocalCoverAssetUrl(songToRestore.localCoverAssetId, 1024);
        const catalog = await getLocalLibraryCatalogSnapshot();
        const restoredSong = applyLocalLibraryEntityDisplay(buildUnifiedLocalSong({
            localSong: songToRestore,
            matchedSong: null,
            coverUrl: songToRestore.useOnlineCover
                ? songToRestore.onlineMetadata?.coverUrl || localCoverUrl
                : localCoverUrl,
            preferOnlineMetadata: false,
        }), catalog);
        setCurrentSong(restoredSong);
        replaceBlobUrl(blobUrlRef, blobUrl);
        currentOnlineAudioUrlFetchedAtRef.current = null;
        setAudioSrc(blobUrl);

        const resolvedLyrics = await resolveLocalSongLyrics(
            songToRestore,
            useLyricSettingsStore.getState().localLyricsPriority,
        );
        setLyrics(resolvedLyrics.lyrics);
        setActiveLocalLyricsSource(resolvedLyrics.source);

        const cacheKey = `cover_local_${songToRestore.id}`;
        const cachedCoverUrl = songToRestore.useOnlineCover
            ? await getCachedCoverUrl(cacheKey)
            : null;
        if (cachedCoverUrl) setCachedCoverUrl(cachedCoverUrl);
        else if (songToRestore.useOnlineCover && songToRestore.onlineMetadata?.coverUrl) {
            setCachedCoverUrl(await loadCachedOrFetchCover(cacheKey, songToRestore.onlineMetadata.coverUrl));
        } else if (localCoverUrl) {
            setCachedCoverUrl(localCoverUrl);
        } else {
            setCachedCoverUrl(null);
        }
        const restoredQueue = replacePlaybackSongInQueue(queue || [restoredSong], restoredSong);
        void persistLastPlaybackCache?.(restoredSong, restoredQueue);
        return 'restored';
    }

    // Every await below can outlive the restore: the listener may pick another song meanwhile, and
    // a late write would put this song's status, source or lyrics over theirs.
    const isCurrent = () => isSamePlaybackSong(usePlaybackStore.getState().currentSong, song);
    const providerId = getOnlineProviderIdForSong(song) ?? undefined;
    const reportFailure = (failure: PlaybackFailure) => {
        if (hasFallbackSource) console.warn('[restorePlaybackSourceForSong] Source not refreshed; the caller falls back to its own', failure);
        else showRestoreFailure(failure);
    };

    const onlineLyricsState = await loadOnlineLyricsState(song);
    if (!isCurrent()) return 'stale';
    if (onlineLyricsState) {
        setCurrentSong(prev => {
            if (!prev || !isSamePlaybackSong(prev, song)) return prev;
            return { ...prev, onlineLyricsState };
        });
    }

    if (!omni.canPlaySong(song)) {
        reportFailure({ reason: 'unknown', stage: 'restore', providerId });
        return 'failed';
    }

    const audioResult = await loadOnlineSongAudioSource(song, audioQuality, null, hasFallbackSource
        ? { stage: 'restore' }
        : { stage: 'restore', retry: { isCurrent } });
    if (!isCurrent()) {
        if (audioResult.kind === 'ok' && audioResult.blobUrl) {
            URL.revokeObjectURL(audioResult.blobUrl);
        }
        return 'stale';
    }
    if (audioResult.kind === 'failed') {
        reportFailure(audioResult.failure);
        return 'failed';
    }

    if (audioResult.blobUrl) {
        replaceBlobUrl(blobUrlRef, audioResult.blobUrl);
        currentOnlineAudioUrlFetchedAtRef.current = null;
    } else {
        currentOnlineAudioUrlFetchedAtRef.current = Date.now();
    }
    setAudioSrc(audioResult.audioSrc);

    const restoredSong = applyOnlineAudioSourceMetadata(song, audioResult.replayGain);
    if (restoredSong.replayGain) {
        setCurrentSong(prev => {
            if (!prev || !isSamePlaybackSong(prev, song)) return prev;
            return { ...prev, replayGain: restoredSong.replayGain };
        });
        const restoredQueue = replacePlaybackSongInQueue(queue || [restoredSong], restoredSong);
        setPlayQueue?.(restoredQueue);
        void persistLastPlaybackCache?.(restoredSong, restoredQueue);
    }

    // The source has landed, so a lyric failure from here on is not a failed restore: reported as one,
    // session restore would withdraw autoplay and the window handoff would swap the snapshot's old URL
    // back in over the fresh one. A throw that lands after the listener moved on is stale like any other.
    try {
        const cachedLyrics = await getSongCacheWithLegacyMigration<LyricData>('lyric', song, migrateLyricDataRenderHints);
        if (!isCurrent()) return 'stale';
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
            return 'restored';
        }

        const songProviderId = song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : null;
        const effectiveUserId = songProviderId
            ? (useOnlineProviderAccountStore.getState().accounts[songProviderId]?.user?.id ?? userId)
            : userId;
        const processed = await omni.getLyrics(song, { userId: effectiveUserId });
        if (!isCurrent()) return 'stale';
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
        return 'restored';
    } catch (error) {
        if (!isCurrent()) return 'stale';
        console.warn('[restorePlaybackSourceForSong] Lyrics could not be restored after the source landed', error);
        return 'restored';
    }
};
