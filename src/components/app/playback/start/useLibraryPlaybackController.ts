import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { MotionValue } from 'framer-motion';
import { LyricParserFactory } from '../../../../utils/lyrics/LyricParserFactory';
import { getFromCacheWithMigration, getLocalSong, getLocalSongs, removeFromCache, saveLocalSong, saveToCache } from '../../../../services/db';
import { getCachedCoverUrl, loadCachedOrFetchCover } from '../../../../services/coverCache';
import { ensureLocalSongCoverAsset } from '../../../../services/localMusicService';
import { addSongsToLocalPlaylist, buildCanonicalLocalSongIdIndex, createLocalPlaylist, getLocalPlaylists, setLocalSongFavorite } from '../../../../services/localPlaylistService';
import { applyLocalLibraryEntityDisplay, buildLocalQueue, buildNavidromeQueue, buildUnifiedLocalSong, buildUnifiedNavidromeSong, resolveLocalSongMetadata } from '../../../../services/playbackAdapters';
import { getPrefetchedData, prefetchNearbySongs } from '../../../../services/prefetchService';
import { retireBlobUrl } from '../../../../services/playbackBlobUrls';
import type { ThemeCacheSongKey } from '../../../../services/themeCache';
import { hasRenderableLyrics } from '../../../../utils/appPlaybackHelpers';
import {
    isLocalPlaybackSong,
    isNavidromePlaybackSong,
    isSamePlaybackSong,
    isStagePlaybackSong,
    getPlaybackSongKey,
    hasMixedPlaybackSources,
    replacePlaybackSongInQueue,
    replacePlaybackSongWhereQueued,
    resolveNavidromePlaybackCarrier,
    getPlaybackSourceRef,
} from '../../../../utils/appPlaybackGuards';
import { hydrateNavidromeLyricPayload, resolvePreferredNavidromeLyrics } from '../../../../utils/appNavidromeLyrics';
import { migrateLyricDataRenderHints } from '../../../../utils/lyrics/renderHints';
import { migrateMatchedLyricsCarrierRenderHints } from '../../../../utils/lyrics/storageMigration';
import { autoMatchBestLyric } from '../../../../utils/lyrics/autoMatchBestLyric';
import { getPlatformLyricSource } from '../../../../utils/lyrics/lyricSources';
import { resolveExplicitFileTimedLyricFormat } from '../../../../utils/lyrics/formatDetection';
import { applyUploadedLocalLyrics } from '../../../../utils/lyrics/localLyricsUpload';
import { omni } from '../../../../services/onlineMusic/omni';
import { getProviderSongMetadata } from '../../../../services/onlineMusic/songMetadata';
import { getSongResourceCacheKey } from '../../../../services/onlineMusic/resourceKeys';
import { getSongCacheWithLegacyMigration } from '../../../../services/onlineMusic/resourceCache';
import { getProviderCacheKey } from '../../../../services/onlineMusic/providerStorage';
import { getNavidromeConfig, navidromeApi } from '../../../../services/navidromeService';
import { notifyPlaybackFailed, untransformedLyrics } from '../../../../services/hostExtensionHooks';
import { lyricsBeforeRules } from '../../../../utils/lyrics/lyricLineRules';
import { wholeQueueWritesSoFar } from '../../../../services/wholeQueueWrites';
import type { LyricData, LocalPlaylist, LocalSong, OnlineLyricsState, QueueAddBehavior, SongResult, StatusMessage } from '../../../../types';
import type { AudioQualityPreference, MediaId, ProviderCollection } from '../../../../types/onlineMusic';
import type { PlaybackSnapshot, PlaybackNavigationOptions } from '../../../../types/appPlayback';
import { getNavidromeMatchCacheKey, type NavidromeMatchData, type NavidromeSong } from '../../../../types/navidrome';
import { applyQueueAddBehavior } from '../../../../utils/queueAddBehavior';
import { loadOnlineLyricsState, resolveOnlineLyrics, saveOnlineLyricsState, getOnlineLyricsStateCacheKey } from '../../../../utils/onlineLyricsState';
import { hasLocalSongCover } from '../../../../utils/localSongCover';
import { isSameLocalSongRecord } from '../../../../utils/localSongRecordEquality';
import { getLocalCoverAssetUrl } from '../../../../services/localCoverAssetUrl';
import { applyMatchedMetadata } from '../../../../services/localLibraryCatalogService';
import { setLocalSongPureMusicMark } from '../../../../services/localSongMatchSelectionService';
import { buildLocalSongLyricMatchContext, shouldRefreshLocalSongLyricsFromMetadata, shouldRunLocalSongAutomaticMatch } from '../../../../utils/lyrics/localSongMatchContext';
import { getLocalLibraryCatalogSnapshot } from '../../../../services/localLibraryEntityRepository';
import { setStatusMessage as setStatusMsg } from '../../../../stores/useStatusMessageStore';
import { useLyricSettingsStore } from '../../../../stores/useLyricSettingsStore';
import { setActiveLocalLyricsSource, setAudioSrc, setCachedCoverUrl, setCurrentLineIndex, setCurrentSong, setPlayQueue, startLoadingToPlay } from '../../../../stores/usePlaybackStore';
import { askedSongKeyRef, askForSong, playsDroppedSoFar, replaceShownSong, showSong, startPlay } from '../currentSong';
import { loadLocalSongAudio, loadNavidromeSongAudio } from '../source/songAudioSource';
import { supplyLyricsAfterEmptyLoad } from '../createLyricsSetter';
import { useStableActionSurface } from '../../../../hooks/useStableCallbacks';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { useLibraryStore } from '../../../../stores/useLibraryStore';
import { setIsPanelOpen } from '../../../../stores/useAppViewStore';
import { currentTime } from '../../../../stores/motionSignals';
import { resolveLocalSongLyrics } from '../../../../utils/lyrics/localSongLyrics';
import { detectLyricFileIssues } from '../../../../utils/lyrics/lyricFileIssues';
import { createLikePresses } from '../../../../utils/likePresses';

// src/components/app/playback/start/useLibraryPlaybackController.ts

type SetState<T> = Dispatch<SetStateAction<T>>;

// The song told to the extensions (hostExtensionHooks.notifyPlaybackFailed) when a local file cannot be
// played: null where the record is too broken to build one, so the telling cannot throw on the failure path.
const toReportedLocalSong = (localSong: LocalSong): SongResult | null => {
    try {
        return buildUnifiedLocalSong({ localSong, matchedSong: null, coverUrl: null, preferOnlineMetadata: false });
    } catch {
        return null;
    }
};

// A broken sidecar lyric file is reported once per song per session; the Folder tab keeps the details.
const reportedLyricFileIssueSongIds = new Set<string>();

const shouldReportShiftedLyricFile = (localSong: LocalSong, lyricsSource: string | null): boolean => {
    if (lyricsSource !== 'local' || reportedLyricFileIssueSongIds.has(localSong.id)) return false;
    const issues = detectLyricFileIssues(localSong.localLyricsContent, localSong.localLyricsFormat);
    if (!issues.includes('translation-shifted-to-end-time')) return false;
    reportedLyricFileIssueSongIds.add(localSong.id);
    return true;
};

// The presses on a Navidrome song's star, by the song's id. (An online song's go through omni.)
const navidromeStarPresses = createLikePresses({ name: 'navidrome' });
// The runs of like requests whose failure the heart has said already: one failure, one message.
const failedLikeRunsSaid = new WeakSet<object>();

const isBlobObjectUrl = (url: string | null | undefined): url is string => (
    typeof url === 'string' && url.startsWith('blob:')
);

// A save takes a moment (a lyric match, uploaded lyrics), and the listener may have moved on when it
// ends. What follows it, a replay of the song or a reload of its lyrics, is for the song the save
// was for: only while the player is still asked for that song and shows it.
const isStillPlaying = (song: SongResult): boolean => {
    const key = getPlaybackSongKey(song);
    const shown = usePlaybackStore.getState().currentSong;
    return askedSongKeyRef.current === key && shown !== null && getPlaybackSongKey(shown) === key;
};

/*
 * Whether a library play's landing leaves a whole-queue write standing (a mod's replaceQueue, its undo,
 * made while the play waited). playSong hands its own judgement in (`queueRewritten`); a play called here
 * directly with a unified queue (a reload of the song after its lyrics changed, which passes the store's
 * queue) counts the writes from its start; one without (a click in the local library) is a list of its own.
 */
const queueRewrittenFor = (options: PlaybackNavigationOptions): (() => boolean) => {
    if (options.queueRewritten) return options.queueRewritten;
    const writesAtEntry = wholeQueueWritesSoFar();
    return () => options.unifiedQueue !== undefined && wholeQueueWritesSoFar() !== writesAtEntry;
};

/*
 * The queue a library play lands in. Rewritten meanwhile: the store's queue as it is now, with the song
 * swapped in only where it holds it (`write` null: nothing to write). Otherwise the play's own.
 */
const landingQueue = (rewritten: boolean, own: SongResult[], song: SongResult): { write: SongResult[] | null; queue: SongResult[] } => {
    if (!rewritten) return { write: own, queue: own };
    const live = usePlaybackStore.getState().playQueue;
    const swapped = replacePlaybackSongWhereQueued(live, song);
    return { write: swapped, queue: swapped ?? live };
};

type UseLibraryPlaybackControllerParams = {
    userId?: MediaId;
    setLyrics: (nextLyrics: LyricData | null) => void;
    setIsLyricsLoading: SetState<boolean>;
    /** How often the loading mark was written, by anyone. */
    lyricsLoadingWritesRef: MutableRefObject<number>;
    navigateToPlaybackView: () => void;
    persistLastPlaybackCache: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    restoreCachedThemeForSong: (songOrId: ThemeCacheSongKey | SongResult, options?: {
        allowLastUsedFallback?: boolean;
        preserveCurrentOnMiss?: boolean;
    }) => Promise<unknown>;
    interruptStagePlaybackForMainTransition: () => PlaybackSnapshot | null;
    blobUrlRef: MutableRefObject<string | null>;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
    pendingResumeTimeRef: MutableRefObject<number | null>;
    lastAudioRecoverySourceRef: MutableRefObject<string | null>;
};

// Owns local and Navidrome playback helpers so App.tsx can stay focused on assembly.
export function useLibraryPlaybackController({
    userId,
    setLyrics,
    setIsLyricsLoading,
    lyricsLoadingWritesRef,
    navigateToPlaybackView,
    persistLastPlaybackCache,
    restoreCachedThemeForSong,
    interruptStagePlaybackForMainTransition,
    blobUrlRef,
    shouldAutoPlayRef,
    currentOnlineAudioUrlFetchedAtRef,
    pendingResumeTimeRef,
    lastAudioRecoverySourceRef,
}: UseLibraryPlaybackControllerParams) {
    // Read here rather than passed in: all store fields, a module-level signal, or i18n.
    const { t } = useTranslation();
    const audioQuality = useAudioSettingsStore(state => state.audioQuality);
    const queueAddBehavior = useAudioSettingsStore(state => state.queueAddBehavior);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const lyrics = usePlaybackStore(state => state.lyrics);
    const playQueue = usePlaybackStore(state => state.playQueue);
    const starredNavidromeSongIds = useLibraryStore(state => state.starredNavidromeSongIds);
    const setStarredNavidromeSongIds = useLibraryStore(state => state.setStarredNavidromeSongIds);

    const [localSongs, setLocalSongs] = useState<LocalSong[]>([]);
    const [localPlaylists, setLocalPlaylists] = useState<LocalPlaylist[]>([]);
    // The window for matching lyrics by hand: the key of the song it was opened for, or none. It
    // is open only while that song plays, and another song closes it for good.
    const [lyricMatchSongKey, setLyricMatchSongKey] = useState<string | null>(null);
    const managedCachedCoverObjectUrlRef = useRef<string | null>(null);
    const resolveLocalSongRecord = useCallback((song: SongResult | null | undefined): LocalSong | undefined => {
        const songId = (song as SongResult & { localRef?: { songId: string } } | null | undefined)?.localRef?.songId;
        return songId ? localSongs.find(localSong => localSong.id === songId) : undefined;
    }, [localSongs]);
    // A local song's window is filled from its library record: without the record there is no
    // window to draw, so none is open.
    const hasLyricMatchWindow = useCallback((song: SongResult): boolean => (
        !isLocalPlaybackSong(song) || resolveLocalSongRecord(song) !== undefined
    ), [resolveLocalSongRecord]);
    const isLyricMatchOpen = lyricMatchSongKey !== null && currentSong !== null
        && getPlaybackSongKey(currentSong) === lyricMatchSongKey
        && hasLyricMatchWindow(currentSong);
    if (lyricMatchSongKey !== null && !isLyricMatchOpen) {
        setLyricMatchSongKey(null);
    }

    // `localSongs` only refreshes on explicit reloads, so a panel action can otherwise spread a
    // record that predates the last write and persist it back over the newer fields.
    const resolveLatestLocalSongRecord = useCallback(async (song: SongResult | null | undefined): Promise<LocalSong | undefined> => {
        const songId = (song as SongResult & { localRef?: { songId: string } } | null | undefined)?.localRef?.songId;
        if (!songId) return undefined;
        try {
            const songs = await getLocalSongs();
            return songs.find(localSong => localSong.id === songId) ?? resolveLocalSongRecord(song);
        } catch (error) {
            console.error('Failed to reload local song record:', error);
            return resolveLocalSongRecord(song);
        }
    }, [resolveLocalSongRecord]);

    const revokeManagedCachedCoverObjectUrl = useCallback(() => {
        if (managedCachedCoverObjectUrlRef.current) {
            URL.revokeObjectURL(managedCachedCoverObjectUrlRef.current);
            managedCachedCoverObjectUrlRef.current = null;
        }
    }, []);

    const setManagedCachedCoverUrl = useCallback((nextUrl: string | null) => {
        const previousUrl = managedCachedCoverObjectUrlRef.current;
        if (previousUrl && previousUrl !== nextUrl) {
            URL.revokeObjectURL(previousUrl);
            managedCachedCoverObjectUrlRef.current = null;
        }

        if (isBlobObjectUrl(nextUrl)) {
            managedCachedCoverObjectUrlRef.current = nextUrl;
        }

        setCachedCoverUrl(nextUrl);
    }, [setCachedCoverUrl]);

    useEffect(() => {
        return () => {
            revokeManagedCachedCoverObjectUrl();
        };
    }, [revokeManagedCachedCoverObjectUrl]);

    useEffect(() => {
        if (!isLocalPlaybackSong(currentSong)) {
            revokeManagedCachedCoverObjectUrl();
        }
    }, [currentSong, revokeManagedCachedCoverObjectUrl]);

    const loadLocalSongs = useCallback(async () => {
        try {
            const songs = await getLocalSongs();
            setLocalSongs(songs);
        } catch (error) {
            console.error('Failed to load local songs:', error);
        }
    }, []);

    // 按 id 把给定的最新记录换进 localSongs，不重读整张 local_music 表。
    // 内容与状态里那条相同的记录不换（库里读回的总是新对象，只比引用会每次都换），没有实际替换时保持原数组：
    // localSongs 的引用一变，useLocalLibraryCatalog 就要整表重读目录，曲库视图也跟着重算。
    const patchLocalSongsInState = useCallback((records: LocalSong[]) => {
        if (records.length === 0) return;
        const recordsById = new Map(records.map(record => [record.id, record]));
        setLocalSongs(previous => {
            let changed = false;
            const next = previous.map(song => {
                const record = recordsById.get(song.id);
                if (!record || isSameLocalSongRecord(record, song)) return song;
                changed = true;
                return record;
            });
            return changed ? next : previous;
        });
    }, []);

    const loadLocalPlaylists = useCallback(async () => {
        try {
            const playlists = await getLocalPlaylists();
            setLocalPlaylists(playlists);
        } catch (error) {
            console.error('Failed to load local playlists:', error);
        }
    }, []);

    const onRefreshLocalSongs = useCallback(async () => {
        const [songs, catalog] = await Promise.all([
            getLocalSongs(),
            getLocalLibraryCatalogSnapshot(),
            loadLocalPlaylists(),
        ]);
        setLocalSongs(songs);
        const songsById = new Map(songs.map(song => [song.id, song]));
        const rebuild = (snapshot: SongResult): SongResult | null => {
            if (!isLocalPlaybackSong(snapshot)) return snapshot;
            const localSong = songsById.get(snapshot.localRef.songId);
            return localSong ? buildLocalQueue([localSong], undefined, catalog)[0] || null : null;
        };
        const playingBefore = usePlaybackStore.getState().currentSong;
        if (playingBefore && !rebuild(playingBefore)) {
            // The playing local file is no longer in the library: no song is shown. Its load, if one
            // is still running, stops at its next check and never clears these two itself. Where
            // another song was asked for meanwhile, the two are that play's and stay.
            const stillAskedFor = askedSongKeyRef.current === getPlaybackSongKey(playingBefore);
            replaceShownSong(playingBefore, null);
            if (stillAskedFor) {
                setIsLyricsLoading(false);
                shouldAutoPlayRef.current = false;
            }
        } else {
            setCurrentSong(previous => previous ? rebuild(previous) : null);
        }
        setPlayQueue(previous => previous.map(rebuild).filter((song): song is SongResult => Boolean(song)));

        // The playing song marked as instrumental or unmarked (the match window, the library, the command
        // palette): its lyrics change where they are, without playing it again.
        if (!isLocalPlaybackSong(playingBefore)) return;
        const record = songsById.get(playingBefore.localRef.songId);
        const rebuilt = rebuild(playingBefore);
        if (!record || !rebuilt || Boolean(rebuilt.isPureMusic) === Boolean(playingBefore.isPureMusic)) return;
        const resolvedLyrics = await resolveLocalSongLyrics(record, useLyricSettingsStore.getState().localLyricsPriority);
        const shown = usePlaybackStore.getState();
        if (!isSamePlaybackSong(shown.currentSong, playingBefore)) return;
        // The screen has this source and these lyrics or none already (a stale flag in a snapshot
        // "flipping"): nothing changes, so the current line is not cleared.
        if (resolvedLyrics.source === shown.activeLocalLyricsSource
            && Boolean(resolvedLyrics.lyrics?.lines.length) === Boolean(shown.lyrics?.lines.length)) return;
        setLyrics(resolvedLyrics.lyrics);
        setActiveLocalLyricsSource(resolvedLyrics.source);
        setCurrentLineIndex(-1);
    }, [loadLocalPlaylists, setCurrentSong, setIsLyricsLoading, setLyrics, setPlayQueue, shouldAutoPlayRef]);

    const getFavoriteLocalPlaylist = useMemo(
        () => localPlaylists.find(playlist => playlist.isFavorite) ?? null,
        [localPlaylists],
    );

    const loadBaseOnlineLyrics = useCallback(async (
        onlineSong: SongResult,
        fallbackLyrics: LyricData | null = lyrics
    ): Promise<LyricData | null> => {
        const cachedLyrics = await getSongCacheWithLegacyMigration<LyricData>('lyric', onlineSong, migrateLyricDataRenderHints);
        if (cachedLyrics) return cachedLyrics;

        const prefetched = getPrefetchedData(onlineSong, audioQuality);
        if (prefetched?.lyrics) return prefetched.lyrics;

        return (await omni.getLyrics(onlineSong, { userId })).lyrics ?? fallbackLyrics;
    }, [audioQuality, lyrics, userId]);

    const resolveOnlineSongLyricsState = useCallback(async (
        onlineSong: SongResult,
        fallbackLyrics: LyricData | null = lyrics
    ): Promise<{ state: OnlineLyricsState | null; lyrics: LyricData | null; }> => {
        const state = await loadOnlineLyricsState(onlineSong);
        const baseLyrics = await loadBaseOnlineLyrics(onlineSong, fallbackLyrics);
        return {
            state,
            lyrics: resolveOnlineLyrics(state, baseLyrics),
        };
    }, [loadBaseOnlineLyrics, lyrics]);

    // 同一文件被导入两次时，歌单里留下的是 canonical 那一份的 id，而播放中的可能是另一份副本。
    const canonicalLocalSongIds = useMemo(() => buildCanonicalLocalSongIdIndex(localSongs), [localSongs]);

    const isLocalSongLiked = useCallback((song: SongResult | null) => {
        if (!song || !isLocalPlaybackSong(song) || !getFavoriteLocalPlaylist) {
            return false;
        }

        const songId = song.localRef.songId;
        return getFavoriteLocalPlaylist.songIds.includes(canonicalLocalSongIds.get(songId) ?? songId);
    }, [canonicalLocalSongIds, getFavoriteLocalPlaylist]);

    const saveCurrentQueueAsLocalPlaylist = useCallback(async (name: string) => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Playlist name is empty');
        }

        // TODO: Define cross-source playlist export before allowing mixed queues to be saved.
        if (hasMixedPlaybackSources(playQueue)) {
            throw new Error('Mixed-source queues cannot be saved as playlists yet');
        }

        const queueSongs = playQueue
            .map(resolveLocalSongRecord)
            .filter((song): song is LocalSong => Boolean(song?.id));

        if (!queueSongs.length) {
            throw new Error('No local songs in queue');
        }

        await createLocalPlaylist(trimmedName, queueSongs);
        await loadLocalPlaylists();
    }, [loadLocalPlaylists, playQueue, resolveLocalSongRecord]);

    // In the six below `song` is the one the picker shows, which during a blend is not the store's
    // current song.
    const addCurrentSongToLocalPlaylist = useCallback(async (playlistId: string, song: SongResult) => {
        const localSong = resolveLocalSongRecord(song);
        if (!isLocalPlaybackSong(song) || !localSong) {
            throw new Error('Current song is not local');
        }

        await addSongsToLocalPlaylist(playlistId, [localSong]);
        await loadLocalPlaylists();
    }, [loadLocalPlaylists, resolveLocalSongRecord]);

    const createCurrentLocalPlaylist = useCallback(async (name: string, song: SongResult) => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Playlist name is empty');
        }

        const localSong = resolveLocalSongRecord(song);
        if (!isLocalPlaybackSong(song) || !localSong) {
            throw new Error('Current song is not local');
        }

        await createLocalPlaylist(trimmedName, [localSong]);
        await loadLocalPlaylists();
        setStatusMsg({ type: 'success', text: t('status.playlistUpdated') || '' });
    }, [loadLocalPlaylists, resolveLocalSongRecord, setStatusMsg, t]);

    const addCurrentSongToOnlinePlaylist = useCallback(async (playlist: ProviderCollection, song: SongResult) => {
        if (!omni.canAddSongToPlaylist(song)) {
            const source = getPlaybackSourceRef(song);
            const provider = source.kind === 'online' ? omni.getProviderLabel(source.providerId) : '';
            setStatusMsg({
                type: 'info',
                text: t('status.providerPlaylistMutationUnavailable').replace('{{provider}}', provider),
            });
            return;
        }
        await omni.addSongToPlaylist(song, playlist);
        await removeFromCache(getProviderCacheKey(playlist.providerId, `playlist_tracks_${playlist.id}`));
        await removeFromCache(getProviderCacheKey(playlist.providerId, `playlist_detail_${playlist.id}`));
        setStatusMsg({ type: 'success', text: t('status.playlistUpdated') || '' });
    }, [setStatusMsg, t]);

    const createCurrentOnlinePlaylist = useCallback(async (name: string, song: SongResult) => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Playlist name is empty');
        }

        await omni.createPlaylistWithSong(song, trimmedName);
        setStatusMsg({ type: 'success', text: t('status.playlistUpdated') || '' });
    }, [setStatusMsg, t]);

    const addCurrentSongToNavidromePlaylist = useCallback(async (playlistId: string, song: SongResult) => {
        if (!isNavidromePlaybackSong(song)) {
            throw new Error('Current song is not a Navidrome song');
        }

        const config = getNavidromeConfig();
        const navidromeSong = resolveNavidromePlaybackCarrier(song);
        if (!config || !navidromeSong?.navidromeData?.id) {
            throw new Error('Navidrome is not configured');
        }

        await navidromeApi.updatePlaylist(config, playlistId, {
            songIdsToAdd: [navidromeSong.navidromeData.id],
        });
        setStatusMsg({ type: 'success', text: t('status.playlistUpdated') || '' });
    }, [setStatusMsg, t]);

    const createCurrentNavidromePlaylist = useCallback(async (name: string, song: SongResult) => {
        if (!isNavidromePlaybackSong(song)) {
            throw new Error('Current song is not a Navidrome song');
        }

        const config = getNavidromeConfig();
        const navidromeSong = resolveNavidromePlaybackCarrier(song);
        if (!config || !navidromeSong?.navidromeData?.id) {
            throw new Error('Navidrome is not configured');
        }

        await navidromeApi.createPlaylist(config, name, [navidromeSong.navidromeData.id]);
        setStatusMsg({ type: 'success', text: t('status.playlistUpdated') || '' });
    }, [setStatusMsg, t]);

    const handleLocalSongMatch = useCallback(async (localSong: LocalSong): Promise<{ updatedLocalSong: LocalSong; matchedSongResult: SongResult | null; }> => {
        let updatedLocalSong = localSong;
        let matchedSongResult: SongResult | null = null;
        const onlineFirst = useLyricSettingsStore.getState().localLyricsPriority === 'online';
        const needsLyricsMatch = (
            (onlineFirst || (!localSong.hasLocalLyrics && !localSong.hasEmbeddedLyrics))
            && (!localSong.matchedLyrics && !localSong.matchedIsPureMusic
                || shouldRefreshLocalSongLyricsFromMetadata(localSong))
        );
        const needsCoverMatch = !hasLocalSongCover(localSong) && !localSong.onlineMetadata?.coverUrl;

        // 标记为纯音乐的歌 matchLyrics 整个不做（封面也是），这里就别提示「正在匹配歌词和封面」。
        if (!localSong.markedPureMusic && (needsLyricsMatch || needsCoverMatch) && shouldRunLocalSongAutomaticMatch(localSong)) {
            setStatusMsg({ type: 'info', text: t('status.matchingLyricsAndCover') || '' });
            try {
                const { matchLyrics } = await import('../../../../services/localMusicService');
                await matchLyrics(localSong);
            } catch (error) {
                console.warn('Auto-match failed:', error);
            }
            // 只把这一首的最新记录换进 localSongs。以前这里整表 loadLocalSongs，换掉了预热正在写的那批对象，
            // 预热结果因此到不了下一次切歌；整表替换还会让依赖 localSongs 的曲库视图跟着全量重算。
            const found = await getLocalSong(localSong.id);
            if (found) {
                updatedLocalSong = found;
                patchLocalSongsInState([found]);
            }
        }

        return { updatedLocalSong, matchedSongResult };
    }, [patchLocalSongsInState, setStatusMsg]);

    const resolveLocalMetadataUI = useCallback(async (localData: LocalSong, matchedSong: SongResult | null) => {
        const localCoverUrl = getLocalCoverAssetUrl(localData.localCoverAssetId, 1024);
        const preferOnlineCover = localData.useOnlineCover === true;
        const coverUrl = preferOnlineCover
            ? (localData.onlineMetadata?.coverUrl || localCoverUrl || null)
            : localCoverUrl;

        const resolvedLyrics = await resolveLocalSongLyrics(
            localData,
            useLyricSettingsStore.getState().localLyricsPriority,
        );

        const catalog = await getLocalLibraryCatalogSnapshot();
        const unifiedSong = applyLocalLibraryEntityDisplay(buildUnifiedLocalSong({
            localSong: localData,
            matchedSong,
            coverUrl,
            preferOnlineMetadata: false,
        }), catalog);

        return { lyrics: resolvedLyrics.lyrics, lyricsSource: resolvedLyrics.source, coverUrl, unifiedSong, catalog };
    }, []);

    const loadCurrentSongLyricPreview = useCallback(async (): Promise<LyricData | null> => {
        if (!currentSong) {
            return null;
        }
        // The lyrics shown, as their source gave them: the filter rules and the mod transform are laid on at display.
        const shownSource = lyricsBeforeRules(untransformedLyrics(lyrics));

        if (isLocalPlaybackSong(currentSong)) {
            const localData = resolveLocalSongRecord(currentSong);
            if (!localData) return shownSource;
            const resolved = await resolveLocalSongLyrics(
                localData,
                useLyricSettingsStore.getState().localLyricsPriority,
            );
            return resolved.source ? resolved.lyrics : shownSource;
        }

        if (isNavidromePlaybackSong(currentSong)) {
            const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
            if (!navidromeSong) {
                return shownSource;
            }

            if ((navidromeSong as NavidromeSong & { lyricsSource?: string; matchedLyrics?: LyricData; }).lyricsSource === 'online' && (navidromeSong as NavidromeSong & { matchedLyrics?: LyricData; }).matchedLyrics) {
                return (navidromeSong as NavidromeSong & { matchedLyrics?: LyricData; }).matchedLyrics ?? null;
            }

            const config = getNavidromeConfig();
            if (config) {
                await hydrateNavidromeLyricPayload(config, navidromeSong);
            }

            const resolved = await resolvePreferredNavidromeLyrics(navidromeSong);
            if (resolved) return resolved;

            return shownSource;
        }

        const onlineSong = currentSong;
        const resolved = await resolveOnlineSongLyricsState(onlineSong, shownSource);
        return resolved.lyrics;
    }, [currentSong, lyrics, resolveLocalSongRecord, resolveOnlineSongLyricsState]);

    const handleLocalQueueAdd = useCallback(async (localSong: LocalSong) => {
        const preparedLocalSong = await ensureLocalSongCoverAsset(localSong);
        const { unifiedSong } = await resolveLocalMetadataUI(preparedLocalSong, null);
        // The queue and the song as the store holds them after those waits, as the online add reads them
        // (appendOnlineSongsToMainQueue): an edit or a whole-queue write made meanwhile is added to, not undone.
        const live = usePlaybackStore.getState();
        const baseQueue = live.playQueue.length > 0 ? live.playQueue : (live.currentSong ? [live.currentSong] : []);
        const { nextQueue, affectedSongs, changed } = applyQueueAddBehavior({
            queue: baseQueue,
            songs: [unifiedSong],
            currentSong: live.currentSong,
            behavior: queueAddBehavior,
        });

        if (!changed || affectedSongs.length === 0) {
            return;
        }

        setPlayQueue(nextQueue);
        void persistLastPlaybackCache(live.currentSong, nextQueue);
        setStatusMsg({
            type: 'success',
            text: queueAddBehavior === 'next' ? (t('status.insertedToNext') || '') : (t('status.queueUpdated') || ''),
            nonce: Date.now(),
            durationMs: 1200,
        });
    }, [persistLastPlaybackCache, queueAddBehavior, resolveLocalMetadataUI, setPlayQueue, setStatusMsg, t]);

    // 预热一首本地歌曲的封面与在线匹配；可能写过库（提取了封面或跑过匹配）时返回 true，供调用方回写到 localSongs。
    const prewarmLocalSongMetadata = useCallback(async (localSong: LocalSong): Promise<boolean> => {
        const preparedLocalSong = await ensureLocalSongCoverAsset(localSong);
        const coverExtracted = preparedLocalSong !== localSong;
        Object.assign(localSong, preparedLocalSong);

        const onlineFirst = useLyricSettingsStore.getState().localLyricsPriority === 'online';
        const needsLyricsMatch = (
            (onlineFirst || (!localSong.hasLocalLyrics && !localSong.hasEmbeddedLyrics))
            && (!localSong.matchedLyrics && !localSong.matchedIsPureMusic
                || shouldRefreshLocalSongLyricsFromMetadata(localSong))
        );
        const needsCoverMatch = !hasLocalSongCover(localSong) && !localSong.onlineMetadata?.coverUrl;
        if (!localSong.markedPureMusic && (needsLyricsMatch || needsCoverMatch) && shouldRunLocalSongAutomaticMatch(localSong)) {
            try {
                const { matchLyrics } = await import('../../../../services/localMusicService');
                await matchLyrics(localSong);
            } catch (error) {
                console.warn('[LocalPrewarm] Failed to prewarm local song metadata:', error);
            }
            return true;
        }
        return coverExtracted;
    }, []);

    const prewarmNearbyLocalSongs = useCallback((currentLocalSong: LocalSong, queue: LocalSong[] = []) => {
        if (queue.length === 0) {
            return;
        }

        const currentIndex = queue.findIndex(song => song.id === currentLocalSong.id);
        if (currentIndex === -1) {
            return;
        }

        const nearbySongs = [-1, 1, 2]
            .map(offset => queue[currentIndex + offset])
            .filter((song): song is LocalSong => Boolean(song));

        if (nearbySongs.length === 0) {
            return;
        }

        window.setTimeout(() => {
            void (async () => {
                const touchedSongIds: string[] = [];
                for (const nearbySong of nearbySongs) {
                    if (await prewarmLocalSongMetadata(nearbySong)) touchedSongIds.push(nearbySong.id);
                }
                // 预热结果必须回到 localSongs：队列与预热都从这里取记录，拿到旧快照就会重新提取封面、重新联网匹配。
                // 等三首都做完才回写，此时才从库里读：每首做完就读的话，等后面几首联网匹配的这几秒里，
                // 用户的改动或切到这首后的匹配写回会被这份更早的读覆盖回去。攒齐一次性回写，曲库视图只重算一次。
                const records = await Promise.all(touchedSongIds.map(songId => getLocalSong(songId)));
                patchLocalSongsInState(records.filter((record): record is LocalSong => Boolean(record)));
            })();
        }, 1000);
    }, [patchLocalSongsInState, prewarmLocalSongMetadata]);

    const onPlayLocalSong = useCallback(async (localSong: LocalSong, queue: LocalSong[] = [], options: PlaybackNavigationOptions = {}) => {
        const stillWanted = startPlay();
        const queueRewritten = queueRewrittenFor(options);
        interruptStagePlaybackForMainTransition();

        const audio = await loadLocalSongAudio(localSong);
        if (!audio) {
            // Another song was asked for while the file was read: this failure is not the listener's
            // any more, and is neither said nor told.
            if (stillWanted()) {
                setStatusMsg({ type: 'error', text: t('status.localFileAccessError') || '' });
                notifyPlaybackFailed({ song: toReportedLocalSong(localSong), reason: null, phase: 'play', willAutoSkip: false });
            }
            return;
        }

        const { blobUrl, localSong: preparedLocalSong } = audio;
        // A newer play started, or the plays in flight were dropped, while this one waited: nothing
        // of this song is written, and the blob URL just made for it is given back.
        const givesUp = () => {
            if (stillWanted()) return false;
            URL.revokeObjectURL(blobUrl);
            return true;
        };
        if (givesUp()) return;
        const initialMeta = await resolveLocalMetadataUI(preparedLocalSong, null);
        if (givesUp()) return;
        const initialSongKey = getPlaybackSongKey(initialMeta.unifiedSong);
        const recoveredRepresentation = audio.recoveredCopy(initialSongKey);
        const playbackUrl = recoveredRepresentation?.url ?? blobUrl;

        // Handed over, not revoked here: a blend is still playing the song this replaces on the
        // other deck, and a revoked URL is a deck that can no longer be seeked. See `retireBlobUrl`.
        retireBlobUrl(blobUrlRef.current);
        blobUrlRef.current = recoveredRepresentation ? null : blobUrl;
        if (recoveredRepresentation) {
            retireBlobUrl(blobUrl);
            retireBlobUrl(null);
        }

        shouldAutoPlayRef.current = true;
        askForSong(initialMeta.unifiedSong);
        // A new song starts at its beginning: a time to resume at was left for another song.
        pendingResumeTimeRef.current = null;
        lastAudioRecoverySourceRef.current = null;
        setLyrics(initialMeta.lyrics);
        setActiveLocalLyricsSource(initialMeta.lyricsSource);
        setCurrentLineIndex(-1);
        currentTime.set(0);
        showSong(initialMeta.unifiedSong);
        setAudioSrc(playbackUrl);

        if (initialMeta.coverUrl) {
            loadCachedOrFetchCover(`cover_local_${preparedLocalSong.id}`, initialMeta.coverUrl).then((resolvedCoverUrl) => {
                if (askedSongKeyRef.current === initialSongKey) {
                    setManagedCachedCoverUrl(resolvedCoverUrl);
                }
            });
        } else {
            setManagedCachedCoverUrl(null);
        }

        setIsLyricsLoading(true);

        const landed = landingQueue(queueRewritten(), options.unifiedQueue
            ? replacePlaybackSongInQueue(options.unifiedQueue, initialMeta.unifiedSong)
            : queue.length > 0
                ? buildLocalQueue(queue, initialMeta.unifiedSong, initialMeta.catalog)
                : [initialMeta.unifiedSong], initialMeta.unifiedSong);
        const finalQueue = landed.queue;
        if (landed.write) setPlayQueue(landed.write);
        void persistLastPlaybackCache(initialMeta.unifiedSong, finalQueue);
        // As playSong does for an online song: this song and the one after it are analysed for the
        // blend between them, and online songs queued nearby are fetched ahead.
        if (finalQueue.length > 0) {
            void prefetchNearbySongs(initialMeta.unifiedSong, finalQueue, audioQuality, userId);
        }

        if (options.shouldNavigateToPlayer ?? true) {
            navigateToPlaybackView();
        }
        startLoadingToPlay();
        if (shouldReportShiftedLyricFile(preparedLocalSong, initialMeta.lyricsSource)) {
            setStatusMsg({
                type: 'info',
                text: t('status.lyricFileIssueShifted', { title: initialMeta.unifiedSong.name }),
                durationMs: 8000,
            });
        } else {
            setStatusMsg({ type: 'success', text: t('status.localMusicLoaded')});
        }
        void restoreCachedThemeForSong(initialMeta.unifiedSong).catch((error) => {
            console.warn('Theme load error', error);
        });

        // The work left running below asks this after each of its waits, and writes nothing more of
        // this song once the answer is yes: another song was asked for (the key moved; a platform
        // switch asks for none), or the plays in flight were dropped (opening the stage does that,
        // and the key stays on this song until the stage asks for its own). `stillWanted` is not
        // the question here: it also says no once a newer play has only started, and one that gives
        // up (a file that cannot be read) leaves this song playing with its lyrics still to come.
        const droppedBefore = playsDroppedSoFar();
        const overtaken = () => askedSongKeyRef.current !== initialSongKey || playsDroppedSoFar() !== droppedBefore;

        void (async () => {
            let prewarmBaseSong = preparedLocalSong;

            try {
                const { updatedLocalSong, matchedSongResult } = await handleLocalSongMatch(preparedLocalSong);
                prewarmBaseSong = updatedLocalSong;
                if (overtaken()) return;

                const updatedMeta = await resolveLocalMetadataUI(updatedLocalSong, matchedSongResult);
                if (overtaken()) return;
                setCurrentSong(previous => isSamePlaybackSong(previous, updatedMeta.unifiedSong) ? updatedMeta.unifiedSong : previous);
                setLyrics(updatedMeta.lyrics);
                setActiveLocalLyricsSource(updatedMeta.lyricsSource);
                setIsLyricsLoading(false);
                // The load has ended; a song it left without lyrics may get some from a mod.
                supplyLyricsAfterEmptyLoad();

                if (updatedMeta.coverUrl && updatedMeta.coverUrl !== initialMeta.coverUrl) {
                    loadCachedOrFetchCover(`cover_local_${updatedLocalSong.id}`, updatedMeta.coverUrl).then((resolvedCoverUrl) => {
                        if (askedSongKeyRef.current === initialSongKey) {
                            setManagedCachedCoverUrl(resolvedCoverUrl);
                        }
                    });
                } else if (!updatedMeta.coverUrl) {
                    setManagedCachedCoverUrl(null);
                }

                void restoreCachedThemeForSong(updatedMeta.unifiedSong).catch((error) => {
                    console.warn('Theme load error', error);
                });
            } catch (error) {
                console.warn('Local song match pipeline failed:', error);
                if (!overtaken()) {
                    setIsLyricsLoading(false);
                    supplyLyricsAfterEmptyLoad();
                }
            } finally {
                if (askedSongKeyRef.current === initialSongKey) {
                    prewarmNearbyLocalSongs(prewarmBaseSong, queue);
                }
            }
        })();
    }, [
        audioQuality,
        blobUrlRef,
        currentTime,
        handleLocalSongMatch,
        interruptStagePlaybackForMainTransition,
        navigateToPlaybackView,
        persistLastPlaybackCache,
        prewarmNearbyLocalSongs,
        restoreCachedThemeForSong,
        resolveLocalMetadataUI,
        setAudioSrc,
        setManagedCachedCoverUrl,
        setCurrentLineIndex,
        setCurrentSong,
        setIsLyricsLoading,
        setLyrics,
        setPlayQueue,
        setStatusMsg,
        shouldAutoPlayRef,
        userId,
    ]);

    const onPlayNavidromeSong = useCallback(async (
        navidromeSong: NavidromeSong,
        queue: NavidromeSong[] = [],
        options: PlaybackNavigationOptions = {},
    ) => {
        const stillWanted = startPlay();
        const queueRewritten = queueRewrittenFor(options);
        interruptStagePlaybackForMainTransition();

        const shouldNavigateToPlayer = options.shouldNavigateToPlayer ?? true;
        const config = getNavidromeConfig();
        if (!config) {
            setStatusMsg({ type: 'error', text: 'Navidrome not configured' });
            notifyPlaybackFailed({ song: navidromeSong, reason: null, phase: 'play', willAutoSkip: false });
            return;
        }

        setIsLyricsLoading(true);
        const ownMark = lyricsLoadingWritesRef.current;
        // A newer play started, or the plays in flight were dropped, while this one waited: nothing
        // of this song is written. The loading mark set above does not stay behind, but it is
        // cleared only while it is still this play's: once anyone wrote the mark since (a newer
        // play for itself, a route that empties the player), it is theirs.
        const givesUp = () => {
            if (stillWanted()) return false;
            if (lyricsLoadingWritesRef.current === ownMark) setIsLyricsLoading(false);
            return true;
        };

        try {
            const navidromeId = navidromeSong.navidromeData.id;
            const audio = loadNavidromeSongAudio(config, navidromeSong);
            const matchData = await getFromCacheWithMigration<NavidromeMatchData>(
                getNavidromeMatchCacheKey(navidromeSong),
                migrateMatchedLyricsCarrierRenderHints,
            );

            let nextLyrics: LyricData | null = null;
            let coverUrl: string | undefined;
            let showedLoadingToast = false;
            if (matchData) {
                if (matchData.lyricsSource === 'online' && matchData.matchedLyrics) {
                    nextLyrics = matchData.matchedLyrics;
                }
                if (matchData.useOnlineCover && matchData.matchedCoverUrl) {
                    coverUrl = matchData.matchedCoverUrl;
                }
            }

            if (!nextLyrics) {
                await hydrateNavidromeLyricPayload(config, navidromeSong);
                nextLyrics = await resolvePreferredNavidromeLyrics(navidromeSong);
            }
            // Before the search for lyrics elsewhere: it asks other services and tells the listener.
            if (givesUp()) return;

            let isAutoMatched = false;
            let autoMatchedLyrics: LyricData | null = null;
            let matchedLyricsSource: SongResult['matchedLyricsSource'] | undefined;
            let matchedLyricsProviderPlatform: SongResult['matchedLyricsProviderPlatform'] | undefined;

            if (!nextLyrics && !matchData?.noAutoMatch && !matchData?.matchedIsPureMusic) {
                try {
                    if (!showedLoadingToast) {
                        setStatusMsg({ type: 'info', text: t('status.loadingSong') || '' });
                        showedLoadingToast = true;
                    }
                    const navidromeMetadata = getProviderSongMetadata(navidromeSong);
                    const artistName = navidromeMetadata.artists.map(artist => artist.name).filter(Boolean).join(', ');
                    const albumName = navidromeMetadata.album?.name || '';
  const settingsLyricSettings = useLyricSettingsStore.getState();

                    if (settingsLyricSettings.autoUseBestLyric) {
                        const bestMatch = await autoMatchBestLyric(navidromeSong.name, artistName, navidromeMetadata.durationMs, {
                            album: albumName,
                            preferredSource: settingsLyricSettings.preferredAlternativeLyricSource,
                        });
                        if (bestMatch?.isPureMusic) {
                            isAutoMatched = true;
                            autoMatchedLyrics = null;
                            (navidromeSong as NavidromeSong & { matchedIsPureMusic?: boolean; }).matchedIsPureMusic = true;
                        } else if (bestMatch && 'lyrics' in bestMatch) {
                            nextLyrics = bestMatch.lyrics;
                            autoMatchedLyrics = bestMatch.lyrics;
                            isAutoMatched = true;
                            matchedLyricsSource = bestMatch.source;
                            matchedLyricsProviderPlatform = bestMatch.matchedLyricsProviderPlatform;

                            const newMatchData: NavidromeMatchData = {
                                matchedLyrics: bestMatch.lyrics,
                                matchedLyricsSource: bestMatch.source,
                                matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
                                lyricsSource: 'online',
                                useOnlineLyrics: true,
                            };

                            if (bestMatch.source === 'netease' || (bestMatch.source === 'amll' && bestMatch.matchedLyricsProviderPlatform === 'ncm')) {
                                newMatchData.matchedSongId = bestMatch.id as number;
                                try {
                                    const nSong = await omni.getSongDetail('netease', bestMatch.id);
                                    if (nSong) {
                                        const metadata = getProviderSongMetadata(nSong, 'netease');
                                        newMatchData.matchedArtists = metadata.artists.map(artist => artist.name).join(', ');
                                        newMatchData.matchedAlbumName = metadata.album?.name;
                                        const coverUrl = metadata.coverUrl;
                                        if (coverUrl) {
                                            newMatchData.matchedCoverUrl = coverUrl.replace('http:', 'https:');
                                            newMatchData.useOnlineCover = true;
                                        }
                                    }
                                } catch (err) {
                                    console.error('[NaviPlay] Failed to fetch NetEase song detail for metadata:', err);
                                }
                            }

                            await saveToCache(getNavidromeMatchCacheKey(navidromeSong), newMatchData);
                        }
                    }

                    if (!isAutoMatched) {
                        const searchQuery = `${navidromeSong.name} ${artistName}`.trim();
                        const searchPage = await omni.searchProviderSongs('netease', searchQuery, { limit: 1, offset: 0 });

                        if (searchPage?.items?.length) {
                            const matchedSong = searchPage.items[0];
                            const lyricResult = await omni.getLyrics(matchedSong);
                            nextLyrics = lyricResult?.lyrics || null;
                            (navidromeSong as NavidromeSong & { matchedIsPureMusic?: boolean; }).matchedIsPureMusic = lyricResult?.isPureMusic || false;
                            if (nextLyrics || lyricResult?.isPureMusic) {
                                autoMatchedLyrics = nextLyrics;
                                isAutoMatched = true;
                                matchedLyricsSource = 'netease';

                            const newMatchData: NavidromeMatchData = {
                                matchedSongId: matchedSong.id,
                                matchedLyrics: nextLyrics || undefined,
                                matchedIsPureMusic: lyricResult?.isPureMusic || false,
                                matchedLyricsSource: 'netease',
                                    lyricsSource: 'online',
                                    useOnlineLyrics: true,
                                };
                                await saveToCache(getNavidromeMatchCacheKey(navidromeSong), newMatchData);
                            }
                        }
                    }
                } catch (error) {
                    console.warn('[App] Failed to fetch Netease lyrics for Navidrome song:', error);
                }
            }

            const mutableSong = navidromeSong as NavidromeSong & {
                matchedLyrics?: LyricData;
                matchedIsPureMusic?: boolean;
                useOnlineLyrics?: boolean;
                lyricsSource?: string;
                matchedLyricsSource?: SongResult['matchedLyricsSource'];
                matchedLyricsProviderPlatform?: SongResult['matchedLyricsProviderPlatform'];
            };
            if (isAutoMatched) {
                mutableSong.matchedLyrics = autoMatchedLyrics ?? undefined;
                mutableSong.useOnlineLyrics = true;
                mutableSong.lyricsSource = 'online';
                mutableSong.matchedLyricsSource = matchedLyricsSource;
                mutableSong.matchedLyricsProviderPlatform = matchedLyricsProviderPlatform;
            } else {
                mutableSong.matchedLyrics = matchData?.matchedLyrics;
                mutableSong.matchedIsPureMusic = matchData?.matchedIsPureMusic;
                mutableSong.useOnlineLyrics = matchData?.useOnlineLyrics;
                mutableSong.lyricsSource = matchData?.lyricsSource === 'online'
                    ? 'online'
                    : (hasRenderableLyrics(nextLyrics) ? 'navi' : matchData?.lyricsSource);
                mutableSong.matchedLyricsSource = matchData?.matchedLyricsSource;
                mutableSong.matchedLyricsProviderPlatform = matchData?.matchedLyricsProviderPlatform;
            }

            if (!coverUrl) {
                coverUrl = getProviderSongMetadata(navidromeSong).coverUrl || navidromeApi.getCoverArtUrl(config, navidromeId);
            }

            await audio.takeServerGain();
            if (givesUp()) return;

            const unifiedSong = buildUnifiedNavidromeSong(navidromeSong, {
                coverUrl,
                useOnlineMetadata: matchData?.useOnlineMetadata,
                matchedArtists: matchData?.matchedArtists,
                matchedAlbumName: matchData?.matchedAlbumName,
                matchedLyricsSource: mutableSong.matchedLyricsSource || matchData?.matchedLyricsSource,
                matchedLyricsProviderPlatform: mutableSong.matchedLyricsProviderPlatform || matchData?.matchedLyricsProviderPlatform,
            });
            const recoveredRepresentation = audio.recoveredCopy(unifiedSong);

            shouldAutoPlayRef.current = true;
            askForSong(unifiedSong);
            // A new song starts at its beginning: a time to resume at was left for another song.
            pendingResumeTimeRef.current = null;
            lastAudioRecoverySourceRef.current = null;
            setLyrics(nextLyrics);
            setCurrentLineIndex(-1);
            currentTime.set(0);
            showSong(unifiedSong);
            setManagedCachedCoverUrl(coverUrl ?? null);
            setAudioSrc(recoveredRepresentation?.url ?? audio.streamUrl);
            setIsLyricsLoading(false);
            // The lyrics came with the match data; a song without any may get some from a mod.
            supplyLyricsAfterEmptyLoad();

            const landed = landingQueue(queueRewritten(), options.unifiedQueue
                ? replacePlaybackSongInQueue(options.unifiedQueue, unifiedSong)
                : queue.length > 0
                    ? buildNavidromeQueue(queue, unifiedSong)
                    : [unifiedSong], unifiedSong);
            const finalQueue = landed.queue;
            if (landed.write) setPlayQueue(landed.write);
            void persistLastPlaybackCache(unifiedSong, finalQueue);
            // As in onPlayLocalSong.
            if (finalQueue.length > 0) {
                void prefetchNearbySongs(unifiedSong, finalQueue, audioQuality, userId);
            }

            if (shouldNavigateToPlayer) {
                navigateToPlaybackView();
            }
            startLoadingToPlay();
            setStatusMsg({ type: 'success', text: t('status.navidromeSongLoaded')});
            void restoreCachedThemeForSong(unifiedSong).catch((error) => {
                console.warn('Theme load error', error);
            });
        } catch (error) {
            console.error('[App] Failed to play Navidrome song:', error);
            // No longer wanted: the failure is not said over the song that plays now, nor told.
            if (givesUp()) return;
            setStatusMsg({ type: 'error', text: t('status.playbackFailed')});
            setIsLyricsLoading(false);
            // The Navidrome carrier itself is told (it is the SongResult playSong knows): a unified song
            // built here from the same broken record could throw again.
            notifyPlaybackFailed({ song: navidromeSong, reason: null, phase: 'play', willAutoSkip: false });
        }
    }, [
        audioQuality,
        currentTime,
        interruptStagePlaybackForMainTransition,
        lyricsLoadingWritesRef,
        navigateToPlaybackView,
        persistLastPlaybackCache,
        restoreCachedThemeForSong,
        setAudioSrc,
        setManagedCachedCoverUrl,
        setCurrentLineIndex,
        setIsLyricsLoading,
        setLyrics,
        setPlayQueue,
        setStatusMsg,
        shouldAutoPlayRef,
        t,
        userId,
    ]);

    const onMatchNavidromeSong = useCallback(async () => {
        setStatusMsg({ type: 'info', text: t('navidrome.fetchingLyrics')});
    }, [setStatusMsg, t]);

    const handleUpdateLocalLyrics = useCallback(async (content: string, isTranslation: boolean, fileName?: string) => {
        if (!isLocalPlaybackSong(currentSong)) return;

        const localData = await resolveLatestLocalSongRecord(currentSong);
        if (!localData) return;

        const updatedLocalSong = applyUploadedLocalLyrics(localData, { content, isTranslation, fileName });

        try {
            const { saveLocalSong } = await import('../../../../services/db');
            await saveLocalSong(updatedLocalSong);
            await loadLocalSongs();
            if (isStillPlaying(currentSong)) {
                // The store's queue after those waits, not this render's: a whole-queue write (a mod's
                // replaceQueue) or an edit made while the lyrics were saved is what the reload lands in.
                void onPlayLocalSong(updatedLocalSong, localSongs, { unifiedQueue: usePlaybackStore.getState().playQueue });
            }
            setStatusMsg({ type: 'success', text: isTranslation ? 'Translation lyrics updated' : 'Lyrics updated' });
        } catch (error) {
            console.error('Failed to save local lyrics', error);
            setStatusMsg({ type: 'error', text: 'Failed to save lyrics' });
        }
    }, [currentSong, loadLocalSongs, localSongs, onPlayLocalSong, resolveLatestLocalSongRecord, setStatusMsg]);

    const handleChangeLyricsSource = useCallback(async (source: 'local' | 'embedded' | 'online') => {
        if (!isLocalPlaybackSong(currentSong)) return;

        const localData = await resolveLatestLocalSongRecord(currentSong);
        if (!localData) return;

        const updatedLocalSong = { ...localData, lyricsSource: source };
        try {
            const { saveLocalSong } = await import('../../../../services/db');
            await saveLocalSong(updatedLocalSong);

            const resolvedLyrics = await resolveLocalSongLyrics(
                updatedLocalSong,
                useLyricSettingsStore.getState().localLyricsPriority,
            );

            setLyrics(resolvedLyrics.lyrics);
            setActiveLocalLyricsSource(resolvedLyrics.source);
            setCurrentLineIndex(-1);
            setCurrentSong(prev => {
                if (!prev || !isSamePlaybackSong(prev, currentSong)) return prev;
                // 显式来源下 isPureMusic 只在选 online 时取在线判定（与 buildUnifiedLocalSong 一致），
                // 否则之后一次无关的 onRefreshLocalSongs 会把它当成纯音乐标记的切换。
                return { ...prev, isPureMusic: source === 'online' ? Boolean(updatedLocalSong.matchedIsPureMusic) : false };
            });
            // The lyrics are set; a song still playing that was left without any may get some from a mod.
            if (isStillPlaying(currentSong)) supplyLyricsAfterEmptyLoad();
            await loadLocalSongs();
            setStatusMsg({ type: 'success', text: t('status.lyricsSourceSwitched')});
        } catch (error) {
            console.error('Failed to save lyrics source', error);
            setStatusMsg({ type: 'error', text: 'Failed to save lyrics source' });
        }
    }, [currentSong, loadLocalSongs, resolveLatestLocalSongRecord, setCurrentLineIndex, setCurrentSong, setLyrics, setStatusMsg]);

    // Opens that window for the song that plays, whatever its kind. A stage song has none.
    const openLyricMatch = useCallback(() => {
        if (!currentSong || isStagePlaybackSong(currentSong) || !hasLyricMatchWindow(currentSong)) {
            return;
        }

        setIsPanelOpen(false);
        setLyricMatchSongKey(getPlaybackSongKey(currentSong));
    }, [currentSong, hasLyricMatchWindow, setIsPanelOpen]);

    const closeLyricMatch = useCallback(() => {
        setLyricMatchSongKey(null);
    }, []);

    // A match was saved for `matchedFor`: its window closes. A window opened since for another song stays.
    const closeLyricMatchOf = useCallback((matchedFor: SongResult) => {
        setLyricMatchSongKey(openFor => (openFor === getPlaybackSongKey(matchedFor) ? null : openFor));
    }, []);

    // The three handlers below are given the song their window was opened for, not the song that
    // plays when the save ends.
    const handleLyricMatchComplete = useCallback(async (matchedFor: SongResult, failureMessage?: string) => {
        closeLyricMatchOf(matchedFor);
        let reloaded = false;
        try {
            if (isLocalPlaybackSong(matchedFor)) {
                await loadLocalSongs();
                const updatedList = await getLocalSongs();
                const found = updatedList.find(song => song.id === matchedFor.localRef.songId);
                if (found && isStillPlaying(matchedFor)) {
                    // The store's queue after the reads above, as for uploaded lyrics.
                    await onPlayLocalSong(found, localSongs, { unifiedQueue: usePlaybackStore.getState().playQueue });
                    reloaded = true;
                }
            }
        } finally {
            // One message is shown at a time, and reloading the song sets its own: what the match window
            // could not apply is said last, in place of the success, also when the reload fails.
            if (failureMessage) {
                setStatusMsg({ type: 'error', text: failureMessage });
            } else if (reloaded) {
                setStatusMsg({ type: 'success', text: t('status.matchSuccessful') || 'Match successful' });
            }
        }
    }, [closeLyricMatchOf, loadLocalSongs, localSongs, onPlayLocalSong, setStatusMsg]);

    // The match window switched the instrumental mark: it closes, and the records and the lyrics shown are
    // refreshed (onRefreshLocalSongs changes them where they are), without playing the song again.
    const handleLyricMatchPureMusicMarkChanged = useCallback(async (marked: boolean) => {
        setLyricMatchSongKey(null);
        await onRefreshLocalSongs();
        setStatusMsg({ type: 'success', text: t(marked ? 'status.markedPureMusic' : 'status.unmarkedPureMusic') });
    }, [onRefreshLocalSongs, setStatusMsg]);

    // The command palette: the instrumental mark of the local song playing, switched.
    const handleToggleCurrentSongPureMusicMark = useCallback(async (): Promise<boolean> => {
        if (!isLocalPlaybackSong(currentSong)) return false;
        const localData = await resolveLatestLocalSongRecord(currentSong);
        if (!localData) return false;
        const marked = !localData.markedPureMusic;
        try {
            await setLocalSongPureMusicMark(localData.id, marked);
            await onRefreshLocalSongs();
            setStatusMsg({ type: 'success', text: t(marked ? 'status.markedPureMusic' : 'status.unmarkedPureMusic') });
            return true;
        } catch (error) {
            console.error('Failed to toggle the instrumental mark', error);
            setStatusMsg({ type: 'error', text: t('localMusic.pureMusicMarkFailed') });
            return false;
        }
    }, [currentSong, onRefreshLocalSongs, resolveLatestLocalSongRecord, setStatusMsg]);

    const handleNaviLyricMatchComplete = useCallback(async (matchedFor: SongResult) => {
        closeLyricMatchOf(matchedFor);
        if ((matchedFor as SongResult & { isNavidrome?: boolean; }).isNavidrome && isStillPlaying(matchedFor)) {
            const navidromeQueue = playQueue
                .map(song => (song as SongResult & { navidromeData?: NavidromeSong; }).navidromeData)
                .filter((song): song is NavidromeSong => Boolean(song?.isNavidrome));
            await onPlayNavidromeSong(
                (matchedFor as SongResult & { navidromeData: NavidromeSong; }).navidromeData,
                navidromeQueue,
                { unifiedQueue: playQueue },
            );
            setStatusMsg({ type: 'success', text: t('status.matchSuccessful') || 'Match successful' });
        }
    }, [closeLyricMatchOf, onPlayNavidromeSong, playQueue, setStatusMsg]);

    const handleImportOnlineLyrics = useCallback(async (content: string, fileName: string) => {
        if (!currentSong || isStagePlaybackSong(currentSong) || isLocalPlaybackSong(currentSong) || isNavidromePlaybackSong(currentSong)) {
            return;
        }

        try {
            const importedLyrics = fileName.toLowerCase().endsWith('.txt')
                ? await LyricParserFactory.parse({ type: 'embedded', textContent: content })
                : await LyricParserFactory.parse({
                    type: 'local',
                    lrcContent: content,
                    formatHint: resolveExplicitFileTimedLyricFormat(fileName),
                });
            const previousState = await loadOnlineLyricsState(currentSong);
            const nextState: OnlineLyricsState = {
                lyricsSource: 'imported',
                importedLyrics,
                importedLyricsName: fileName,
                hasOnlineOverride: previousState?.hasOnlineOverride ?? false,
                onlineOverrideLyrics: previousState?.onlineOverrideLyrics ?? null,
                matchedSongId: previousState?.matchedSongId,
                matchedIsPureMusic: previousState?.matchedIsPureMusic,
                matchedLyricsSource: previousState?.matchedLyricsSource,
                matchedLyricsProviderPlatform: previousState?.matchedLyricsProviderPlatform,
            };
            await saveOnlineLyricsState(currentSong, nextState);

            if (isStillPlaying(currentSong)) {
                const updatedSong = { ...currentSong, onlineLyricsState: nextState };
                setCurrentSong(prev => isSamePlaybackSong(prev, currentSong) ? updatedSong : prev);
                setLyrics(importedLyrics);
                setCurrentLineIndex(-1);
                // An imported file of only "instrumental" lines is set as none; a mod may supply some.
                supplyLyricsAfterEmptyLoad();
                await persistLastPlaybackCache(updatedSong, playQueue);
            }
            setStatusMsg({ type: 'success', text: 'Lyrics updated' });
        } catch (error) {
            console.error('Failed to import online lyrics', error);
            setStatusMsg({ type: 'error', text: 'Failed to save lyrics' });
        }
    }, [currentSong, persistLastPlaybackCache, playQueue, setCurrentLineIndex, setCurrentSong, setLyrics, setStatusMsg]);

    const handleChangeOnlineLyricsSource = useCallback(async (source: 'online' | 'imported') => {
        if (!currentSong || isStagePlaybackSong(currentSong) || isLocalPlaybackSong(currentSong) || isNavidromePlaybackSong(currentSong)) {
            return;
        }

        const previousState = await loadOnlineLyricsState(currentSong);
        const nextState: OnlineLyricsState = {
            lyricsSource: source,
            importedLyrics: previousState?.importedLyrics ?? null,
            importedLyricsName: previousState?.importedLyricsName ?? null,
            hasOnlineOverride: previousState?.hasOnlineOverride ?? false,
            onlineOverrideLyrics: previousState?.onlineOverrideLyrics ?? null,
            matchedSongId: previousState?.matchedSongId,
            matchedIsPureMusic: previousState?.matchedIsPureMusic,
            matchedLyricsSource: previousState?.matchedLyricsSource,
            matchedLyricsProviderPlatform: previousState?.matchedLyricsProviderPlatform,
        };

        if (source === 'imported' && !nextState.importedLyrics) {
            return;
        }

        try {
            await saveOnlineLyricsState(currentSong, nextState);
            const baseLyrics = await loadBaseOnlineLyrics(currentSong, lyrics);
            const nextLyrics = resolveOnlineLyrics(nextState, baseLyrics);
            const updatedSong = { ...currentSong, onlineLyricsState: nextState };
            setCurrentSong(prev => isSamePlaybackSong(prev, currentSong) ? updatedSong : prev);
            setLyrics(nextLyrics);
            setCurrentLineIndex(-1);
            // The lyrics are set; a song still playing that was left without any may get some from a mod.
            if (isStillPlaying(currentSong)) supplyLyricsAfterEmptyLoad();
            await persistLastPlaybackCache(updatedSong, playQueue);
            setStatusMsg({ type: 'success', text: t('status.lyricsSourceSwitched') || '' });
        } catch (error) {
            console.error('Failed to switch online lyrics source', error);
            setStatusMsg({ type: 'error', text: 'Failed to save lyrics source' });
        }
    }, [currentSong, loadBaseOnlineLyrics, lyrics, persistLastPlaybackCache, playQueue, setCurrentLineIndex, setCurrentSong, setLyrics, setStatusMsg]);

    const handleOnlineLyricMatchComplete = useCallback(async (matchedFor: SongResult) => {
        closeLyricMatchOf(matchedFor);
        if (!currentSong || !isStillPlaying(matchedFor) || isStagePlaybackSong(currentSong) || isLocalPlaybackSong(currentSong) || isNavidromePlaybackSong(currentSong)) {
            return;
        }

        const resolved = await resolveOnlineSongLyricsState(currentSong, lyrics);
        if (!isStillPlaying(matchedFor)) {
            return;
        }
        const updatedSong = {
            ...currentSong,
            onlineLyricsState: resolved.state ?? undefined,
            isPureMusic: resolved.state?.lyricsSource === 'online' && typeof resolved.state.matchedIsPureMusic === 'boolean'
                ? resolved.state.matchedIsPureMusic
                : currentSong.isPureMusic,
        };
        setCurrentSong(prev => isSamePlaybackSong(prev, currentSong) ? updatedSong : prev);
        setLyrics(resolved.lyrics);
        setCurrentLineIndex(-1);
        // Still playing (checked after the wait above); a match to an instrumental leaves no lyrics,
        // and a mod may supply some.
        supplyLyricsAfterEmptyLoad();
        await persistLastPlaybackCache(updatedSong, playQueue);
        setStatusMsg({ type: 'success', text: t('status.matchSuccessful') || 'Match successful' });
    }, [closeLyricMatchOf, currentSong, lyrics, persistLastPlaybackCache, playQueue, resolveOnlineSongLyricsState, setCurrentLineIndex, setCurrentSong, setLyrics, setStatusMsg]);

    const handleClearOnlineLyricsState = useCallback(async () => {
        if (!currentSong || isStagePlaybackSong(currentSong) || isLocalPlaybackSong(currentSong) || isNavidromePlaybackSong(currentSong)) {
            return;
        }

        try {
            const key = getOnlineLyricsStateCacheKey(currentSong);
            await removeFromCache(key);

            const resolved = await resolveOnlineSongLyricsState(currentSong, null);
            const updatedSong = {
                ...currentSong,
                onlineLyricsState: undefined,
            };
            setCurrentSong(prev => isSamePlaybackSong(prev, currentSong) ? updatedSong : prev);
            setLyrics(resolved.lyrics);
            setCurrentLineIndex(-1);
            // The lyrics are set; a song still playing that was left without any may get some from a mod.
            if (isStillPlaying(currentSong)) supplyLyricsAfterEmptyLoad();
            await persistLastPlaybackCache(updatedSong, playQueue);
            setStatusMsg({ type: 'success', text: t('status.clearedManualLyrics') || '' });
        } catch (error) {
            console.error('Failed to clear online lyrics state', error);
            setStatusMsg({ type: 'error', text: t('status.clearFailed') || '' });
        }
    }, [currentSong, persistLastPlaybackCache, playQueue, resolveOnlineSongLyricsState, setCurrentLineIndex, setCurrentSong, setLyrics, setStatusMsg]);

    const handleHomeMatchSong = useCallback(async (song: LocalSong) => {
        await loadLocalSongs();

        if (isLocalPlaybackSong(currentSong)) {
            const currentLocalData = resolveLocalSongRecord(currentSong);
            if (currentLocalData && currentLocalData.id === song.id) {
                const updatedSongs = await getLocalSongs();
                const updatedSong = updatedSongs.find(item => item.id === song.id);

                if (updatedSong) {
                    const resolvedUi = await resolveLocalMetadataUI(updatedSong, null);
                    setCurrentSong(previous => isSamePlaybackSong(previous, resolvedUi.unifiedSong) ? resolvedUi.unifiedSong : previous);

                    if (updatedSong.useOnlineCover && updatedSong.onlineMetadata?.coverUrl) {
                        try {
                            const resolvedCoverUrl = await loadCachedOrFetchCover(`cover_local_${updatedSong.id}`, updatedSong.onlineMetadata.coverUrl);
                            setManagedCachedCoverUrl(resolvedCoverUrl || updatedSong.onlineMetadata.coverUrl);
                        } catch (error) {
                            console.warn('Failed to cache updated cover:', error);
                            setManagedCachedCoverUrl(updatedSong.onlineMetadata.coverUrl);
                        }
                    } else {
                        setManagedCachedCoverUrl(resolvedUi.coverUrl);
                    }

                    setLyrics(resolvedUi.lyrics);
                    setActiveLocalLyricsSource(resolvedUi.lyricsSource);
                    // The lyrics are set; a song still playing that was left without any may get some from a mod.
                    if (isStillPlaying(currentSong)) supplyLyricsAfterEmptyLoad();
                }
            }
        }
    }, [currentSong, loadLocalSongs, resolveLocalMetadataUI, resolveLocalSongRecord, setCurrentSong, setLyrics, setManagedCachedCoverUrl]);

    const handleAutoMatchBestLyricForCurrentSong = useCallback(async (): Promise<boolean> => {
        if (!currentSong) {
            setStatusMsg({ type: 'info', text: t('status.noSongPlaying') || '' });
            return false;
        }

        if (isStagePlaybackSong(currentSong)) {
            setStatusMsg({ type: 'info', text: t('status.stageActionUnavailable') || '' });
            return false;
        }

  const settingsLyricSettings = useLyricSettingsStore.getState();
        setStatusMsg({ type: 'info', text: t('status.matchingBestLyrics') || '' });

        try {
            if (isLocalPlaybackSong(currentSong)) {
                // 读库里的最新记录：下面整条写回，不能带着 localSongs 里过期的字段（例如刚打的纯音乐标记）。
                const localData = await resolveLatestLocalSongRecord(currentSong);
                if (!localData) return false;
                const catalog = await getLocalLibraryCatalogSnapshot();
                const resolvedMetadata = resolveLocalSongMetadata(localData.id, catalog);
                const matchContext = buildLocalSongLyricMatchContext(localData, {
                    artistNames: resolvedMetadata.artists.map(artist => artist.name),
                    albumName: resolvedMetadata.album?.name,
                });
                const bestMatch = await autoMatchBestLyric(matchContext.title, matchContext.artist, matchContext.durationMs, {
                    album: matchContext.album,
                    preferredSource: settingsLyricSettings.preferredAlternativeLyricSource,
                    metadataCandidate: matchContext.metadataCandidate,
                });

                if (!bestMatch) {
                    setStatusMsg({ type: 'info', text: t('status.bestLyricsNotFound') || '' });
                    return false;
                }
                if ('isPureMusic' in bestMatch) {
                    setStatusMsg({ type: 'info', text: t('status.bestLyricsPureMusic') || '' });
                    return false;
                }

                const updatedLocalSong: LocalSong = {
                    ...localData,
                    matchedLyrics: bestMatch.lyrics,
                    matchedLyricsSongId: bestMatch.id,
                    matchedLyricsSource: bestMatch.source,
                    matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
                    matchedIsPureMusic: false,
                    // 用户主动要了最佳歌词，纯音乐标记随之取消。
                    markedPureMusic: undefined,
                    lyricsSource: 'online',
                };
                await applyMatchedMetadata(localData.id, {}, {
                    lyricsOnly: true,
                    songPatch: updatedLocalSong,
                });
                // 快照的 isPureMusic 跟记录走（标记被清掉了），localSongs 也刷新，匹配窗口才不会还显示已标记。
                const updatedSong = { ...currentSong, isPureMusic: false };
                setCurrentSong(prev => isSamePlaybackSong(prev, currentSong) ? updatedSong : prev);
                setLyrics(bestMatch.lyrics);
                setActiveLocalLyricsSource('online');
                setCurrentLineIndex(-1);
                await loadLocalSongs();
                await persistLastPlaybackCache(updatedSong, playQueue);
                setStatusMsg({ type: 'success', text: t('status.bestLyricsMatched') || '' });
                return true;
            }

            if (isNavidromePlaybackSong(currentSong)) {
                const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
                if (!navidromeSong) {                        setStatusMsg({ type: 'error', text: t('status.bestLyricsMatchFailed') || '' });
                    return false;
                }

                const navidromeMetadata = getProviderSongMetadata(navidromeSong);
                const artistName = navidromeMetadata.artists.map(artist => artist.name).filter(Boolean).join(', ');
                const albumName = navidromeMetadata.album?.name || '';
                const bestMatch = await autoMatchBestLyric(navidromeSong.name, artistName, navidromeMetadata.durationMs, {
                    album: albumName,
                    preferredSource: settingsLyricSettings.preferredAlternativeLyricSource,
                });

                if (!bestMatch) {
                    setStatusMsg({ type: 'info', text: t('status.bestLyricsNotFound') || '' });
                    return false;
                }
                if ('isPureMusic' in bestMatch) {
                    setStatusMsg({ type: 'info', text: t('status.bestLyricsPureMusic') || '' });
                    return false;
                }

                const matchData: NavidromeMatchData = {
                    matchedLyrics: bestMatch.lyrics,
                    matchedLyricsSource: bestMatch.source,
                    matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
                    lyricsSource: 'online',
                    useOnlineLyrics: true,
                    matchedSongId: bestMatch.source === 'netease' || (bestMatch.source === 'amll' && bestMatch.matchedLyricsProviderPlatform === 'ncm')
                        ? bestMatch.id as number
                        : undefined,
                    matchedIsPureMusic: false,
                };
                await saveToCache(getNavidromeMatchCacheKey(navidromeSong), matchData);

                const updatedSong = {
                    ...currentSong,
                    matchedLyrics: bestMatch.lyrics,
                    matchedLyricsSource: bestMatch.source,
                    matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
                    matchedIsPureMusic: false,
                    lyricsSource: 'online' as const,
                    useOnlineLyrics: true,
                };
                setCurrentSong(prev => isSamePlaybackSong(prev, currentSong) ? updatedSong : prev);
                setLyrics(bestMatch.lyrics);
                setCurrentLineIndex(-1);
                await persistLastPlaybackCache(updatedSong, playQueue);
                setStatusMsg({ type: 'success', text: t('status.bestLyricsMatched') || '' });
                return true;
            }

            const currentSongMetadata = getProviderSongMetadata(currentSong);
            const artistName = currentSongMetadata.artists.map(artist => artist.name).filter(Boolean).join(', ');
            const albumName = currentSongMetadata.album?.name || '';
            const sourceRef = getPlaybackSourceRef(currentSong);
            const ownLyricsResult = await omni.getLyrics(currentSong);
            const ownLyricSource = getPlatformLyricSource(sourceRef.kind === 'online' ? sourceRef.providerId : null);
            const bestMatch = await autoMatchBestLyric(currentSong.name, artistName, currentSongMetadata.durationMs, {
                album: albumName,
                preferredSource: settingsLyricSettings.preferredAlternativeLyricSource,
                alternateArtist: () => omni.getAlternateArtistName(currentSong),
                providerCandidate: ownLyricSource
                    ? { providerId: ownLyricSource.id, song: currentSong, lyricsResult: ownLyricsResult }
                    : undefined,
            });

            if (!bestMatch) {
                setStatusMsg({ type: 'info', text: t('status.bestLyricsNotFound') || '' });
                return false;
            }
            if ('isPureMusic' in bestMatch) {                    setStatusMsg({ type: 'info', text: t('status.bestLyricsPureMusic') });
                return false;
            }

            const previousState = await loadOnlineLyricsState(currentSong);
            const usesOwnProviderLyrics = sourceRef.kind === 'online' && bestMatch.source === sourceRef.providerId;
            const nextState: OnlineLyricsState = {
                lyricsSource: 'online',
                importedLyrics: previousState?.importedLyrics ?? null,
                importedLyricsName: previousState?.importedLyricsName ?? null,
                hasOnlineOverride: !usesOwnProviderLyrics,
                onlineOverrideLyrics: usesOwnProviderLyrics ? null : bestMatch.lyrics,
                matchedSongId: bestMatch.id,
                matchedIsPureMusic: false,
                matchedLyricsSource: bestMatch.source,
                matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
            };
            await saveOnlineLyricsState(currentSong, nextState);

            const updatedSong = { ...currentSong, onlineLyricsState: nextState, isPureMusic: false };
            setCurrentSong(prev => isSamePlaybackSong(prev, currentSong) ? updatedSong : prev);
            setLyrics(bestMatch.lyrics);
            setCurrentLineIndex(-1);
            await persistLastPlaybackCache(updatedSong, playQueue);
            setStatusMsg({ type: 'success', text: t('status.bestLyricsMatched') || '' });
            return true;
        } catch (error) {
            console.error('[CommandPalette] Failed to auto-match best lyric:', error);
            setStatusMsg({ type: 'error', text: t('status.bestLyricsMatchFailed') || '' });
            return false;
        }
    }, [
        currentSong,
        loadLocalSongs,
        persistLastPlaybackCache,
        playQueue,
        resolveLatestLocalSongRecord,
        resolveLocalSongRecord,
        setCurrentLineIndex,
        setCurrentSong,
        setLyrics,
        setStatusMsg,
        t,
    ]);

    const handleLike = useCallback(async () => {
        if (!currentSong) return;

        if (isStagePlaybackSong(currentSong)) {
            setStatusMsg({ type: 'info', text: t('status.stageLikeUnavailable') || '' });
            return;
        }

        const localSong = resolveLocalSongRecord(currentSong);
        if (isLocalPlaybackSong(currentSong) && localSong) {
            const nextLiked = !isLocalSongLiked(currentSong);
            try {
                await setLocalSongFavorite(localSong, nextLiked);
                await loadLocalPlaylists();
                setStatusMsg({ type: 'success', text: nextLiked ? t('status.liked') : (t('status.unliked') || '') });
            } catch (error) {
                console.error('Failed to update local favorite playlist', error);
                setStatusMsg({ type: 'error', text: t('status.likeFailed') });
            }
            return;
        }

        if (isNavidromePlaybackSong(currentSong)) {
            const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
            if (!navidromeSong) return;

            const config = getNavidromeConfig();
            if (!config) {
                setStatusMsg({ type: 'error', text: t('navidrome.notConfigured') || '' });
                return;
            }

            const songId = navidromeSong.navidromeData.id;
            // What is shown is the starred set itself, so before a run it is what Navidrome holds.
            const starredBefore = starredNavidromeSongIds.has(songId);
            const showStarred = (starred: boolean) => setStarredNavidromeSongIds(prev => {
                if (prev.has(songId) === starred) return prev;
                const next = new Set(prev);
                if (starred) next.add(songId);
                else next.delete(songId);
                return next;
            });

            // The star and its message answer at once; the request goes out after, one at a time
            // for a song, and a press made meanwhile is sent when it is over (likePresses.ts).
            const press = navidromeStarPresses.press(songId, !starredBefore, async starred => {
                const success = starred
                    ? await navidromeApi.star(config, songId)
                    : await navidromeApi.unstar(config, songId);
                if (!success) throw new Error('Navidrome did not take the star');
            });
            showStarred(press.wanted);
            setStatusMsg({
                type: 'success',
                text: press.wanted ? t('status.liked') : (t('status.unliked') || ''),
            });
            if (!press.joined) {
                void press.settled.then(outcome => {
                    // The starred set may have been read from Navidrome again meanwhile, so what
                    // it took is written once more.
                    if (outcome.ok) return showStarred(outcome.liked);
                    // Back to what Navidrome holds: the last state it took in this run, or the
                    // one from before the first press where it took none.
                    const held = outcome.confirmed ?? starredBefore;
                    showStarred(held);
                    console.warn(`[Like] navidrome:${songId} put back: it shows ${held ? 'liked' : 'not liked'} again, which is what Navidrome holds`);
                    setStatusMsg({ type: 'error', text: t('status.likeFailed') || '' });
                });
            }
            return;
        }

        const sourceRef = getPlaybackSourceRef(currentSong);
        if (sourceRef.kind !== 'online') {
            setStatusMsg({ type: 'error', text: t('status.likeFailed') });
            return;
        }
        if (!omni.canLikeSong(currentSong)) {
            setStatusMsg({
                type: 'info',
                text: t('status.providerLikeUnavailable')
                    .replace('{{provider}}', omni.getProviderLabel(sourceRef.providerId)),
            });
            return;
        }
        try {
            // The heart and its message answer at once; omni sends the request after and shows
            // what the account holds again if it fails. Every press waits for the run's end (a
            // run may have been begun elsewhere, by the liked list's own removal), and the first
            // to hear of a failure says it: one failure, one message.
            const press = omni.pressSongLike(currentSong);
            setStatusMsg({ type: 'success', text: press.wanted ? t('status.liked') : t('status.unliked') || 'Removed from Liked' });
            void press.settled.then(outcome => {
                if (outcome.ok || failedLikeRunsSaid.has(press.settled)) return;
                failedLikeRunsSaid.add(press.settled);
                console.error('Like failed', outcome.error);
                setStatusMsg({ type: 'error', text: t('status.likeFailed') });
            });
        } catch (error) {
            console.error('Like failed', error);
            setStatusMsg({ type: 'error', text: t('status.likeFailed') });
        }
    }, [
        currentSong,
        isLocalSongLiked,
        starredNavidromeSongIds,
        loadLocalPlaylists,
        setStarredNavidromeSongIds,
        setStatusMsg,
        t,
    ]);

    // Wrapped so the callbacks this hook hands back keep one identity for the app's lifetime. They
    // are all invoked from events or effects, and their churn was what kept every build*Model memo
    // in App.tsx from ever holding - see useStableCallbacks.ts.
    return useStableActionSurface({
        localSongs,
        localPlaylists,
        isLyricMatchOpen,
        openLyricMatch,
        closeLyricMatch,
        loadLocalSongs,
        loadLocalPlaylists,
        onRefreshLocalSongs,
        getFavoriteLocalPlaylist,
        isLocalSongLiked,
        saveCurrentQueueAsLocalPlaylist,
        addCurrentSongToLocalPlaylist,
        createCurrentLocalPlaylist,
        addCurrentSongToOnlinePlaylist,
        createCurrentOnlinePlaylist,
        addCurrentSongToNavidromePlaylist,
        createCurrentNavidromePlaylist,
        resolveLocalMetadataUI,
        loadCurrentSongLyricPreview,
        handleLocalQueueAdd,
        onPlayLocalSong,
        onPlayNavidromeSong,
        onMatchNavidromeSong,
        handleUpdateLocalLyrics,
        handleChangeLyricsSource,
        handleImportOnlineLyrics,
        handleChangeOnlineLyricsSource,
        handleLyricMatchComplete,
        handleLyricMatchPureMusicMarkChanged,
        handleToggleCurrentSongPureMusicMark,
        handleNaviLyricMatchComplete,
        handleOnlineLyricMatchComplete,
        handleClearOnlineLyricsState,
        handleHomeMatchSong,
        handleAutoMatchBestLyricForCurrentSong,
        handleLike,
    });
}
