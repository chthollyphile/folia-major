import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { LyricParserFactory } from '../utils/lyrics/LyricParserFactory';
import { getFromCache, getFromCacheWithMigration, getLocalSongs } from '../services/db';
import { getCachedAudioBlob } from '../services/audioCache';
import { getCachedCoverUrl } from '../services/coverCache';
import { ensureLocalSongEmbeddedCover, getAudioFromLocalSong } from '../services/localMusicService';
import { getOnlineSongCacheKey, isCloudSong, neteaseApi } from '../services/netease';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import { hydrateNavidromeLyricPayload, resolvePreferredNavidromeLyrics } from '../utils/appNavidromeLyrics';
import { hasRenderableLyrics } from '../utils/appPlaybackHelpers';
import { isLocalPlaybackSong, isNavidromePlaybackSong, isStagePlaybackSong } from '../utils/appPlaybackGuards';
import { isPureMusicLyricText } from '../utils/lyrics/pureMusic';
import { migrateLyricDataRenderHints } from '../utils/lyrics/renderHints';
import { processNeteaseLyrics } from '../utils/lyrics/neteaseProcessing';
import type { LyricData, LocalSong, SongResult, StatusMessage } from '../types';
import type { NavidromeSong } from '../types/navidrome';

// src/hooks/useSessionRestoreController.ts

type SetState<T> = Dispatch<SetStateAction<T>>;

type UseSessionRestoreControllerParams = {
    audioQuality: string;
    userId?: number;
    blobUrlRef: MutableRefObject<string | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
    setCurrentSong: SetState<SongResult | null>;
    setPlayQueue: SetState<SongResult[]>;
    setCachedCoverUrl: SetState<string | null>;
    setAudioSrc: SetState<string | null>;
    setLyrics: (nextLyrics: LyricData | null) => void;
    setStatusMsg: SetState<StatusMessage | null>;
    restoreCachedThemeForSong: (songId: number, options?: {
        allowLastUsedFallback?: boolean;
        preserveCurrentOnMiss?: boolean;
    }) => Promise<'legacy' | 'dual' | 'fallback-dual' | 'restored' | 'none'>;
    persistLastPlaybackCache: (song: SongResult | null, queue: SongResult[]) => Promise<void>;
    clearPersistedStagePlaybackCache: () => Promise<void>;
    loadLocalSongs: () => Promise<void>;
    loadLocalPlaylists: () => Promise<void>;
};

// Restores the main playback session without pushing more boot logic into App.tsx.
export function useSessionRestoreController({
    audioQuality,
    userId,
    blobUrlRef,
    currentOnlineAudioUrlFetchedAtRef,
    setCurrentSong,
    setPlayQueue,
    setCachedCoverUrl,
    setAudioSrc,
    setLyrics,
    setStatusMsg,
    restoreCachedThemeForSong,
    persistLastPlaybackCache,
    clearPersistedStagePlaybackCache,
    loadLocalSongs,
    loadLocalPlaylists,
}: UseSessionRestoreControllerParams) {
    const hasInitializedRef = useRef(false);

    useEffect(() => {
        if (hasInitializedRef.current) {
            return;
        }
        hasInitializedRef.current = true;

        const restoreSession = async () => {
            try {
                const lastSong = await getFromCache<SongResult>('last_song');
                const lastQueue = await getFromCache<SongResult[]>('last_queue');

                if (isStagePlaybackSong(lastSong) || lastQueue?.some(song => isStagePlaybackSong(song))) {
                    await clearPersistedStagePlaybackCache();
                    return;
                }

                if (!lastSong) {
                    return;
                }

                console.log('[Session] Restoring last song:', lastSong.name);
                setCurrentSong(lastSong);
                setPlayQueue(lastQueue && lastQueue.length > 0 ? lastQueue : [lastSong]);

                const restoredThemeKind = await restoreCachedThemeForSong(lastSong.id, {
                    allowLastUsedFallback: true,
                    preserveCurrentOnMiss: false,
                });
                if (restoredThemeKind === 'fallback-dual') {
                    console.log('[restoreSession] Using last_dual_theme fallback');
                } else if (restoredThemeKind === 'none') {
                    console.log('[restoreSession] No cached theme, resetting to default');
                }

                setCachedCoverUrl(await getCachedCoverUrl(getOnlineSongCacheKey('cover', lastSong)));

                try {
                    if (isNavidromePlaybackSong(lastSong)) {
                        const navidromeSongToRestore = (lastSong as unknown as SongResult & { navidromeData?: NavidromeSong }).navidromeData;
                        const config = getNavidromeConfig();
                        const navidromeId = navidromeSongToRestore?.navidromeData?.id;

                        if (!navidromeSongToRestore || !config || !navidromeId) {
                            console.warn('[restoreSession] Navidrome song could not be restored');
                            return;
                        }

                        setAudioSrc(navidromeApi.getStreamUrl(config, navidromeId));
                        const restoredCoverUrl = lastSong.al?.picUrl || lastSong.album?.picUrl || navidromeSongToRestore.navidromeData.coverArtUrl;
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

                        const restoredSong = { ...lastSong, navidromeData: navidromeSongToRestore } as SongResult;
                        setCurrentSong(restoredSong);
                        void persistLastPlaybackCache(restoredSong, lastQueue || [restoredSong]);
                        return;
                    }

                    if (isLocalPlaybackSong(lastSong)) {
                        console.log('[restoreSession] Detected local song, attempting to restore from file handles...');
                        const localData = (lastSong as SongResult & { localData?: LocalSong }).localData;
                        let songToRestore: LocalSong | undefined;
                        const songs = await getLocalSongs();

                        if (localData?.id) {
                            songToRestore = songs.find(song => song.id === localData.id);
                        }

                        if (!songToRestore) {
                            songToRestore = songs.find(song =>
                                (song.title || song.fileName) === lastSong.name &&
                                Math.abs(song.duration - lastSong.duration) < 1000,
                            );
                        }

                        if (!songToRestore) {
                            console.warn('[restoreSession] Could not find local song in library');
                            setStatusMsg({
                                type: 'info',
                                text: '上次播放的本地歌曲已不在曲库中',
                            });
                            return;
                        }

                        const blobUrl = await getAudioFromLocalSong(songToRestore);
                        if (!blobUrl) {
                            console.warn('[restoreSession] Local song file not accessible - needs resync');
                            setStatusMsg({
                                type: 'info',
                                text: '本地歌曲文件需要重新授权访问，请从本地音乐列表重新选择播放',
                            });
                            return;
                        }

                        songToRestore = await ensureLocalSongEmbeddedCover(songToRestore);
                        if (blobUrlRef.current) {
                            URL.revokeObjectURL(blobUrlRef.current);
                        }
                        blobUrlRef.current = blobUrl;
                        currentOnlineAudioUrlFetchedAtRef.current = null;
                        setAudioSrc(blobUrl);
                        console.log('[restoreSession] Successfully restored local song audio');

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

                        if (songToRestore.embeddedCover) {
                            setCachedCoverUrl(URL.createObjectURL(songToRestore.embeddedCover));
                        } else if (songToRestore.matchedCoverUrl) {
                            setCachedCoverUrl(songToRestore.matchedCoverUrl);
                        }
                        return;
                    }

                    const cachedAudio = await getCachedAudioBlob(getOnlineSongCacheKey('audio', lastSong));
                    if (cachedAudio) {
                        const blobUrl = URL.createObjectURL(cachedAudio);
                        if (blobUrlRef.current) {
                            URL.revokeObjectURL(blobUrlRef.current);
                        }
                        blobUrlRef.current = blobUrl;
                        currentOnlineAudioUrlFetchedAtRef.current = null;
                        setAudioSrc(blobUrl);
                    } else {
                        const urlRes = await neteaseApi.getSongUrl(lastSong.id, audioQuality);
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
                        getOnlineSongCacheKey('lyric', lastSong),
                        migrateLyricDataRenderHints,
                    );
                    if (cachedLyrics) {
                        const cachedText = cachedLyrics.lines.map(line => line.fullText).join('\n');
                        setCurrentSong(prev => prev?.id === lastSong.id ? { ...prev, isPureMusic: isPureMusicLyricText(cachedText) } : prev);
                        setLyrics(cachedLyrics);
                    } else {
                        const lyricRes = isCloudSong(lastSong) && userId
                            ? await neteaseApi.getCloudLyric(userId, lastSong.id)
                            : await neteaseApi.getLyric(lastSong.id);
                        const processed = await processNeteaseLyrics(neteaseApi.getProcessedLyricPayload(lyricRes));

                        setCurrentSong(prev => prev?.id === lastSong.id ? { ...prev, isPureMusic: processed.isPureMusic } : prev);
                        setLyrics(processed.lyrics);
                    }
                } catch (error) {
                    console.warn('Failed to restore audio/lyrics for last session', error);
                }
            } catch (error) {
                console.error('Session restore failed', error);
            }
        };

        void restoreSession();
        void loadLocalSongs();
        void loadLocalPlaylists();
    }, []);
}
