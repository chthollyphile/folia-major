import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Repeat, Repeat1, Settings2, CheckCircle2, AlertCircle, Sparkles, X } from 'lucide-react';
import { motion, AnimatePresence, useMotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { parseLRC } from './utils/lrcParser';
import { parseYRC } from './utils/yrcParser';
import { detectChorusLines } from './utils/chorusDetector';
import { saveSessionData, getSessionData, getFromCache, saveToCache, getLocalSongs } from './services/db';
import { getCachedCoverUrl, loadCachedOrFetchCover } from './services/coverCache';
import { getAudioFromLocalSong } from './services/localMusicService';
import { loadOnlineSongAudioSource, loadOnlineSongLyrics } from './services/onlinePlayback';
import { buildLocalQueue, buildNavidromeQueue, buildUnifiedLocalSong, buildUnifiedNavidromeSong } from './services/playbackAdapters';
import { getPrefetchedData, prefetchNearbySongs, invalidateAndRefetch } from './services/prefetchService';
import Visualizer from './components/Visualizer';
import ProgressBar from './components/ProgressBar';
import FloatingPlayerControls from './components/FloatingPlayerControls';
import Home from './components/Home';
import AlbumView from './components/AlbumView';
import ArtistView from './components/ArtistView';
import UnifiedPanel from './components/UnifiedPanel';
import LyricMatchModal from './components/LyricMatchModal';
import NaviLyricMatchModal, { NavidromeMatchData } from './components/NaviLyricMatchModal';
import { LyricData, Theme, PlayerState, SongResult, LocalSong } from './types';
import { NavidromeSong } from './types/navidrome';
import { neteaseApi } from './services/netease';
import { navidromeApi, getNavidromeConfig } from './services/navidromeService';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useNeteaseLibrary } from './hooks/useNeteaseLibrary';
import { useAppPreferences } from './hooks/useAppPreferences';
import { useThemeController } from './hooks/useThemeController';

// Default Theme
// 午夜墨染
const DEFAULT_THEME: Theme = {
    name: "Midnight Default",
    backgroundColor: "#09090b", // zinc-950
    primaryColor: "#f4f4f5", // zinc-100
    accentColor: "#f4f4f5", // zinc-100
    secondaryColor: "#71717a", // zinc-500
    fontStyle: "sans",
    animationIntensity: "normal"
};

// 日光素白
const DAYLIGHT_THEME: Theme = {
    name: "Daylight Default",
    backgroundColor: "#f5f5f4", // stone-100 (Pearl White-ish)
    primaryColor: "#1c1917", // stone-900
    accentColor: "#ea580c", // orange-600
    secondaryColor: "#78716c", // stone-500
    fontStyle: "sans",
    animationIntensity: "normal"
};

const formatTime = (time: number) => {
    if (isNaN(time)) return "00:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export default function App() {
    const { t } = useTranslation();

    // Player Data
    const [audioSrc, setAudioSrc] = useState<string | null>(null);
    const [currentSong, setCurrentSong] = useState<SongResult | null>(null);
    const [lyrics, setLyrics] = useState<LyricData | null>(null);
    const [cachedCoverUrl, setCachedCoverUrl] = useState<string | null>(null);

    // Queue
    const [playQueue, setPlayQueue] = useState<SongResult[]>([]);

    // UI State
    const [statusMsg, setStatusMsg] = useState<{ type: 'error' | 'success' | 'info', text: string; } | null>(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [panelTab, setPanelTab] = useState<'cover' | 'controls' | 'queue' | 'account' | 'local' | 'navi'>('cover');

    // Player State
    const [playerState, setPlayerState] = useState<PlayerState>(PlayerState.IDLE);
    const currentTime = useMotionValue(0);
    const [duration, setDuration] = useState(0);
    const [currentLineIndex, setCurrentLineIndex] = useState(-1);
    const [loopMode, setLoopMode] = useState<'off' | 'all' | 'one'>('off');
    const [isFmMode, setIsFmMode] = useState(false);

    // Progress Bar State
    // Removed isDragging and sliderValue as they are handled by ProgressBar component

    // Audio Analysis State
    const audioPower = useMotionValue(0);
    const audioBands = {
        bass: useMotionValue(0),
        lowMid: useMotionValue(0),
        mid: useMotionValue(0),
        vocal: useMotionValue(0),
        treble: useMotionValue(0)
    };

    // Refs
    const audioRef = useRef<HTMLAudioElement>(null);
    const animationFrameRef = useRef<number>(0);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
    const blobUrlRef = useRef<string | null>(null);
    const queueScrollRef = useRef<HTMLDivElement>(null);
    const shouldAutoPlay = useRef(false);
    const currentSongRef = useRef<number | null>(null);
    const volumePreviewFrameRef = useRef<number | null>(null);
    const pendingVolumePreviewRef = useRef<number | null>(null);
    const [isLyricsLoading, setIsLyricsLoading] = useState(false);

    // Local Music State
    const [localSongs, setLocalSongs] = useState<LocalSong[]>([]);
    const localFileBlobsRef = useRef<Map<string, string>>(new Map()); // id -> blob URL

    // Navigation Persistence State (Lifted from Home/LocalMusicView)
    const [homeViewTab, setHomeViewTab] = useState<'playlist' | 'local' | 'albums' | 'navidrome' | 'radio'>('playlist');
    const [focusedPlaylistIndex, setFocusedPlaylistIndex] = useState(0);
    const [focusedFavoriteAlbumIndex, setFocusedFavoriteAlbumIndex] = useState(0);
    const [focusedRadioIndex, setFocusedRadioIndex] = useState(0);
    const [navidromeFocusedAlbumIndex, setNavidromeFocusedAlbumIndex] = useState(0);
    const [localMusicState, setLocalMusicState] = useState<{
        activeRow: 0 | 1;
        selectedGroup: { type: 'folder' | 'album', name: string, songs: LocalSong[], coverUrl?: string; } | null;
        focusedFolderIndex: number;
        focusedAlbumIndex: number;
    }>({
        activeRow: 0,
        selectedGroup: null,
        focusedFolderIndex: 0,
        focusedAlbumIndex: 0
    });

    // Preferences and Theme
    // Manages user preferences for audio quality, theme settings, 
    // and related actions like toggling cover color backgrounds and static mode,
    // as well as setting daylight mode preference
    const {
        audioQuality,
        setAudioQuality,
        useCoverColorBg,
        staticMode,
        enableMediaCache,
        backgroundOpacity,
        isDaylight,
        handleToggleCoverColorBg,
        handleToggleStaticMode,
        handleToggleMediaCache,
        handleSetBackgroundOpacity,
        setDaylightPreference,
        volume,
        isMuted,
        handleSetVolume,
        handleToggleMute,
    } = useAppPreferences(setStatusMsg);

    const handlePreviewVolume = useCallback((val: number) => {
        pendingVolumePreviewRef.current = val;

        if (volumePreviewFrameRef.current !== null) {
            return;
        }

        volumePreviewFrameRef.current = requestAnimationFrame(() => {
            volumePreviewFrameRef.current = null;
            const nextVolume = pendingVolumePreviewRef.current;
            if (audioRef.current && nextVolume !== null) {
                audioRef.current.volume = nextVolume;
            }
        });
    }, []);

    // Theme Controller
    // manages current theme, daylight mode, and related actions like generating AI themes 
    // and restoring cached themes for songs
    const {
        theme,
        setTheme,
        bgMode,
        isGeneratingTheme,
        handleToggleDaylight,
        handleBgModeChange,
        handleResetTheme,
        handleSetThemePreset,
        restoreCachedThemeForSong,
        generateAITheme,
    } = useThemeController({
        defaultTheme: DEFAULT_THEME,
        daylightTheme: DAYLIGHT_THEME,
        isDaylight,
        setDaylightPreference,
        setStatusMsg,
        t,
    });

    // Navigation and Library Hooks
    // manages current view, selected items, and navigation functions across the app
    const {
        currentView,
        selectedPlaylist,
        selectedAlbumId,
        selectedArtistId,
        navigateToPlayer,
        navigateToHome,
        handlePlaylistSelect,
        handleAlbumSelect,
        handleArtistSelect,
    } = useAppNavigation();

    // Netease Library Hook
    // manages user data, playlists, liked songs, and related actions
    const {
        user,
        playlists,
        likedSongIds,
        isSyncing,
        cacheSize,
        refreshUserData,
        updateCacheSize,
        handleClearCache,
        handleSyncData,
        handleLogout,
        setLikedSongIds,
    } = useNeteaseLibrary({
        currentView,
        selectedPlaylist,
        selectedAlbumId,
        selectedArtistId,
        setStatusMsg,
        t,
    });

    // --- Initialization ---

    useEffect(() => {
        restoreSession();
        loadLocalSongs();
    }, []);

    // Revoke blob URLs on unmount to prevent leaks
    useEffect(() => {
        return () => {
            if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
            if (volumePreviewFrameRef.current !== null) {
                cancelAnimationFrame(volumePreviewFrameRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (isPanelOpen && panelTab === 'account') {
            updateCacheSize();
        }
    }, [isPanelOpen, panelTab]);

    const restoreSession = async () => {
        try {
            const lastSong = await getFromCache<SongResult>('last_song');
            const lastQueue = await getFromCache<SongResult[]>('last_queue');

            if (lastSong) {
                console.log("[Session] Restoring last song:", lastSong.name);
                setCurrentSong(lastSong);
                if (lastQueue && lastQueue.length > 0) {
                    setPlayQueue(lastQueue);
                } else {
                    setPlayQueue([lastSong]);
                }

                const restoredThemeKind = await restoreCachedThemeForSong(lastSong.id, { allowLastUsedFallback: true });
                if (restoredThemeKind === 'fallback-dual') {
                    console.log("[restoreSession] Using last_dual_theme fallback");
                } else if (restoredThemeKind === 'none') {
                    console.log("[restoreSession] No cached theme, resetting to default");
                }

                // Try to restore cover
                setCachedCoverUrl(await getCachedCoverUrl(`cover_${lastSong.id}`));

                // Load resources silently (without auto-playing)
                try {
                    // Check if this is a local song
                    const isLocalSong = (lastSong as any).isLocal || lastSong.id < 0;

                    if (isLocalSong) {
                        // For local songs, we need to try to restore from localSongs list
                        // FileSystemFileHandle cannot be serialized to IndexedDB
                        console.log("[restoreSession] Detected local song, attempting to restore from file handles...");

                        // Wait for localSongs to be loaded (loadLocalSongs runs in parallel)
                        // We'll try to match by name and duration
                        const localData = (lastSong as any).localData;
                        let songToRestore: LocalSong | undefined;

                        // Load local songs if not already loaded
                        const songs = await getLocalSongs();

                        if (localData?.id) {
                            // Try to find by original local ID
                            songToRestore = songs.find(s => s.id === localData.id);
                        }

                        if (!songToRestore) {
                            // Fallback: match by name and duration
                            songToRestore = songs.find(s =>
                                (s.title || s.fileName) === lastSong.name &&
                                Math.abs(s.duration - lastSong.duration) < 1000
                            );
                        }

                        if (songToRestore) {
                            // Try to get audio from the file handle
                            const blobUrl = await getAudioFromLocalSong(songToRestore);
                            if (blobUrl) {
                                if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
                                blobUrlRef.current = blobUrl;
                                setAudioSrc(blobUrl);
                                console.log("[restoreSession] Successfully restored local song audio");

                                // Also restore lyrics using lyricsSource priority
                                const source = songToRestore.lyricsSource;
                                if (source === 'online' && songToRestore.matchedLyrics) {
                                    setLyrics(songToRestore.matchedLyrics);
                                } else if (source === 'embedded' && songToRestore.embeddedLyricsContent) {
                                    setLyrics(parseLRC(songToRestore.embeddedLyricsContent, ''));
                                } else if (source === 'local' && songToRestore.localLyricsContent) {
                                    setLyrics(parseLRC(songToRestore.localLyricsContent, songToRestore.localTranslationLyricsContent || ''));
                                } else if (songToRestore.hasLocalLyrics && songToRestore.localLyricsContent) {
                                    setLyrics(parseLRC(songToRestore.localLyricsContent, songToRestore.localTranslationLyricsContent || ''));
                                } else if (songToRestore.hasEmbeddedLyrics && songToRestore.embeddedLyricsContent) {
                                    setLyrics(parseLRC(songToRestore.embeddedLyricsContent, ''));
                                } else if (songToRestore.matchedLyrics) {
                                    setLyrics(songToRestore.matchedLyrics);
                                }

                                // Restore cover
                                if (songToRestore.embeddedCover) {
                                    setCachedCoverUrl(URL.createObjectURL(songToRestore.embeddedCover));
                                } else if (songToRestore.matchedCoverUrl) {
                                    setCachedCoverUrl(songToRestore.matchedCoverUrl);
                                }
                            } else {
                                // File handle is no longer valid (permission revoked or file moved)
                                console.warn("[restoreSession] Local song file not accessible - needs resync");
                                setStatusMsg({
                                    type: 'info',
                                    text: '本地歌曲文件需要重新授权访问，请从本地音乐列表重新选择播放'
                                });
                            }
                        } else {
                            // TODO: NEED INVESTIGATION, meow~
                            // This case happens when try to restore a navidrome song, it fails to find the song from server or local storage.
                            // dosen't cause any critical issue, just can't restore the last played song's audio and lyrics, but it will show a warning toast in screen every time open the app, which is annoying! need to investigate why it happens and how to fix it.
                            console.warn("[restoreSession] Could not find local song in library");
                            setStatusMsg({
                                type: 'info',
                                text: '上次播放的本地歌曲已不在曲库中'
                            });
                        }
                    } else {
                        // Cloud song - original logic
                        const cachedAudio = await getFromCache<Blob>(`audio_${lastSong.id}`);
                        if (cachedAudio) {
                            const blobUrl = URL.createObjectURL(cachedAudio);
                            if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
                            blobUrlRef.current = blobUrl;
                            setAudioSrc(blobUrl);
                        } else {
                            const urlRes = await neteaseApi.getSongUrl(lastSong.id, audioQuality);
                            let url = urlRes.data?.[0]?.url;
                            if (url) {
                                if (url.startsWith('http:')) {
                                    url = url.replace('http:', 'https:');
                                }
                                setAudioSrc(url);
                            }
                        }

                        // Try cache first for lyrics (cloud songs only)
                        const cachedLyrics = await getFromCache<LyricData>(`lyric_${lastSong.id}`);
                        if (cachedLyrics) {
                            setLyrics(cachedLyrics);
                        } else {
                            const lyricRes = await neteaseApi.getLyric(lastSong.id);
                            const yrcLrc = lyricRes.yrc?.lyric || lyricRes.lrc?.yrc?.lyric;
                            const mainLrc = lyricRes.lrc?.lyric;
                            const ytlrc = lyricRes.ytlrc?.lyric || lyricRes.lrc?.ytlrc?.lyric;
                            const tlyric = lyricRes.tlyric?.lyric || "";

                            // Use ytlrc for YRC if available, otherwise fallback to tlyric.
                            // For standard LRC, use tlyric.
                            const transLrc = (yrcLrc && ytlrc) ? ytlrc : tlyric;

                            let parsed: LyricData | null = null;
                            if (yrcLrc) {
                                parsed = parseYRC(yrcLrc, transLrc);
                            } else if (mainLrc) {
                                parsed = parseLRC(mainLrc, transLrc);
                            }

                            // Chorus Detection
                            // Find the most repeated lines (after trimming) and mark them as chorus lines, assign a random effect for each unique chorus line text
                            // Not the best way to determine if a line is a chorus, better than nothing, 
                            // since the real chourus detection requires very heavy audio analysis or ML model, 
                            // which btw is not impossible to implement, but it will introduce a lot overhead, the uesr will have to wait for
                            // a long time before see any lyrics if we do that. Not really worth it.
                            if (parsed && !lyricRes.pureMusic && !lyricRes.lrc?.pureMusic && mainLrc) {
                                const chorusLines = detectChorusLines(mainLrc);
                                if (chorusLines.size > 0) {
                                    // Assign a stable random effect for each unique chorus line text
                                    const effectMap = new Map<string, 'bars' | 'circles' | 'beams'>();
                                    const effects: ('bars' | 'circles' | 'beams')[] = ['bars', 'circles', 'beams'];

                                    chorusLines.forEach(text => {
                                        const randomEffect = effects[Math.floor(Math.random() * effects.length)];
                                        effectMap.set(text, randomEffect);
                                    });

                                    parsed.lines.forEach(line => {
                                        const text = line.fullText.trim();
                                        if (chorusLines.has(text)) {
                                            line.isChorus = true;
                                            line.chorusEffect = effectMap.get(text);
                                        }
                                    });
                                }
                            }

                            setLyrics(parsed);
                        }
                    }
                } catch (e) {
                    console.warn("Failed to restore audio/lyrics for last session", e);
                }
            }
        } catch (e) {
            console.error("Session restore failed", e);
        }
    };

    // --- Local Music Functions ---

    const loadLocalSongs = async () => {
        try {
            const songs = await getLocalSongs();
            setLocalSongs(songs);
        } catch (error) {
            console.error('Failed to load local songs:', error);
        }
    };

    const onRefreshLocalSongs = async () => {
        await loadLocalSongs();
    };

    const handleLocalSongMatch = async (localSong: LocalSong): Promise<{ updatedLocalSong: LocalSong, matchedSongResult: SongResult | null; }> => {
        let updatedLocalSong = localSong;
        let matchedSongResult: SongResult | null = null;

        // Only match online if: no local lyrics AND (no matched lyrics OR no matched cover) AND auto-match is enabled
        const needsLyricsMatch = !localSong.hasLocalLyrics && !localSong.hasEmbeddedLyrics && !localSong.matchedLyrics;
        const needsCoverMatch = !localSong.embeddedCover && !localSong.matchedCoverUrl;
        if ((needsLyricsMatch || needsCoverMatch) && !localSong.noAutoMatch) {
            setStatusMsg({ type: 'info', text: '正在匹配歌词和封面...' });
            try {
                const { matchLyrics } = await import('./services/localMusicService');
                const matchedLyrics = await matchLyrics(localSong);

                if (matchedLyrics) {
                    // Reload local song to get updated data from DB
                    const updatedSongs = await getLocalSongs();
                    const found = updatedSongs.find(s => s.id === localSong.id);

                    if (found) {
                        updatedLocalSong = found;

                        // Get full matched song details for UI
                        if (found.matchedSongId) {
                            try {
                                const searchRes = await neteaseApi.cloudSearch(
                                    localSong.artist
                                        ? `${localSong.artist} ${localSong.title}`
                                        : localSong.title || localSong.fileName
                                );
                                if (searchRes.result?.songs) {
                                    matchedSongResult = searchRes.result.songs.find(s => s.id === found.matchedSongId) || searchRes.result.songs[0];
                                }
                            } catch (e) {
                                console.warn('Failed to get matched song details:', e);
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn('Auto-match failed:', error);
            }
            // Refresh local songs list in App state
            await loadLocalSongs();
        }

        return { updatedLocalSong, matchedSongResult };
    };

    const onPlayLocalSong = async (localSong: LocalSong, queue: LocalSong[] = []) => {
        // Get audio blob from fileHandle first
        const blobUrl = await getAudioFromLocalSong(localSong);
        if (!blobUrl) {
            setStatusMsg({
                type: 'error',
                text: '无法访问文件，请重新导入文件夹'
            });
            return;
        }

        // Auto-match lyrics and cover if not already matched
        const { updatedLocalSong, matchedSongResult } = await handleLocalSongMatch(localSong);

        // Create Blob URL for embedded cover if available
        let embeddedCoverUrl: string | null = null;
        if (updatedLocalSong.embeddedCover) {
            embeddedCoverUrl = URL.createObjectURL(updatedLocalSong.embeddedCover);
        }

        // Use updated data, respecting user's online data preferences
        // If user explicitly chose to use online data (useOnline* flags), override default priority
        const preferOnlineCover = updatedLocalSong.useOnlineCover === true;
        const preferOnlineLyrics = updatedLocalSong.lyricsSource === 'online';
        const preferOnlineMetadata = updatedLocalSong.useOnlineMetadata === true;

        // Cover priority: default is Embedded > Online, but useOnlineCover reverses it
        const coverUrl = preferOnlineCover
            ? (updatedLocalSong.matchedCoverUrl || embeddedCoverUrl || null)
            : (embeddedCoverUrl || updatedLocalSong.matchedCoverUrl || null);
        const matchedSong = matchedSongResult;

        // Lyrics priority: uses lyricsSource if set, otherwise default local > embedded > online
        let lyrics: LyricData | null = null;
        const source = updatedLocalSong.lyricsSource;
        if (source === 'online' && updatedLocalSong.matchedLyrics) {
            lyrics = updatedLocalSong.matchedLyrics;
            console.log('[App] Using online matched lyrics (user preference)');
        } else if (source === 'embedded' && updatedLocalSong.embeddedLyricsContent) {
            lyrics = parseLRC(updatedLocalSong.embeddedLyricsContent, '');
            console.log('[App] Using embedded lyrics (user preference)');
        } else if (source === 'local' && updatedLocalSong.localLyricsContent) {
            lyrics = parseLRC(updatedLocalSong.localLyricsContent, updatedLocalSong.localTranslationLyricsContent || '');
            console.log('[App] Using local lyrics file (user preference)');
        } else if (!source) {
            // Default priority: local > embedded > online
            if (updatedLocalSong.hasLocalLyrics && updatedLocalSong.localLyricsContent) {
                lyrics = parseLRC(updatedLocalSong.localLyricsContent, updatedLocalSong.localTranslationLyricsContent || '');
                console.log('[App] Using local lyrics file (default)');
            } else if (updatedLocalSong.hasEmbeddedLyrics && updatedLocalSong.embeddedLyricsContent) {
                lyrics = parseLRC(updatedLocalSong.embeddedLyricsContent, '');
                console.log('[App] Using embedded lyrics (default)');
            } else if (updatedLocalSong.matchedLyrics) {
                lyrics = updatedLocalSong.matchedLyrics;
                console.log('[App] Using online matched lyrics (default fallback)');
            }
        }

        const unifiedSong = buildUnifiedLocalSong({
            localSong: updatedLocalSong,
            matchedSong,
            coverUrl,
            preferOnlineMetadata,
        });

        // Store blob URL reference
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
        }
        blobUrlRef.current = blobUrl;

        // Enable autoplay
        shouldAutoPlay.current = true;
        currentSongRef.current = unifiedSong.id;

        // Set UI state
        setLyrics(lyrics);
        setCurrentLineIndex(-1);
        currentTime.set(0); // Reset currentTime to prevent stale playback position
        setCurrentSong(unifiedSong);
        // Cache cover if available
        setCachedCoverUrl(await loadCachedOrFetchCover(`cover_local_${updatedLocalSong.id}`, coverUrl));
        setAudioSrc(blobUrl);
        setIsLyricsLoading(false);

        // Set queue
        if (queue.length > 0) {
            const finalQueue = buildLocalQueue(queue, unifiedSong);
            setPlayQueue(finalQueue);
            saveToCache('last_queue', finalQueue);
        } else {
            setPlayQueue([unifiedSong]);
            saveToCache('last_queue', [unifiedSong]);
        }

        saveToCache('last_song', unifiedSong);

        // Navigate to player
        navigateToPlayer();
        setPlayerState(PlayerState.IDLE);
        setStatusMsg({ type: 'success', text: '本地音乐已加载' });
    };

    // --- Navidrome Playback ---
    const onPlayNavidromeSong = async (navidromeSong: NavidromeSong, queue: NavidromeSong[] = []) => {
        const config = getNavidromeConfig();
        if (!config) {
            setStatusMsg({ type: 'error', text: 'Navidrome not configured' });
            return;
        }

        setIsLyricsLoading(true);
        setStatusMsg({ type: 'info', text: t('status.loadingSong') || '加载歌曲中...' });

        try {
            // Get streaming URL using navidromeData.id
            const navidromeId = navidromeSong.navidromeData.id;
            const streamUrl = navidromeApi.getStreamUrl(config, navidromeId);

            // Fetch match data if available
            const matchData = await getFromCache<NavidromeMatchData>(`navidrome_match_${navidromeId}`);

            let lyrics: LyricData | null = null;
            let coverUrl: string | undefined;

            if (matchData) {
                if (matchData.lyricsSource === 'online' && matchData.matchedLyrics) {
                    lyrics = matchData.matchedLyrics;
                    console.log('[App] Using manually matched OpenSubsonic online lyrics');
                }
                if (matchData.useOnlineCover && matchData.matchedCoverUrl) {
                    coverUrl = matchData.matchedCoverUrl;
                }
            }

            // Try to get lyrics from Navidrome first
            // The navidrome API doesn't support lyric with translation, or synced lyrics, making it hard for us to provide a good lyric display experience.
            // In best senario, we can implement a middleware to provide Folia's cached-lyric file directly from user's navidrome server, but that requires users to self-host an additional service, which is not ideal for user experience. So for now, we will just try to fetch the standard lyrics from navidrome, and if the lyrics is in LRC format and has time tags, we will parse it and display it as synced lyrics, otherwise we will just display it as unsynced plain text lyrics. It's not perfect, but it's better than nothing. We will also provide an option for users to manually match lyrics from Netease if they want better lyric experience, and we will save the matched lyrics in cache for future use.
            const artistName = navidromeSong.ar?.[0]?.name || navidromeSong.artists?.[0]?.name || '';

            // 1. Try OpenSubsonic structured lyrics (getLyricsBySongId)
            if (!lyrics) {
                try {
                    const structuredLyrics = await navidromeApi.getLyricsBySongId(config, navidromeId);
                    if (structuredLyrics && structuredLyrics.length > 0) {
                        const firstStruct = structuredLyrics[0];
                        if (firstStruct.line && firstStruct.line.length > 0) {
                            let lrcContent = '';
                            firstStruct.line.forEach(l => {
                                const totalMs = l.start || 0;
                                const minutes = Math.floor(totalMs / 60000);
                                const seconds = Math.floor((totalMs % 60000) / 1000);
                                const ms = totalMs % 1000;
                                const mm = minutes.toString().padStart(2, '0');
                                const ss = seconds.toString().padStart(2, '0');
                                const xx = Math.floor(ms / 10).toString().padStart(2, '0');
                                lrcContent += `[${mm}:${ss}.${xx}]${l.value || ''}\n`;
                            });
                            lyrics = parseLRC(lrcContent, '');
                            console.log('[App] Using OpenSubsonic structured lyrics');
                        }
                    }
                } catch (e) {
                    console.warn('[App] Failed to fetch OpenSubsonic structured lyrics:', e);
                }

                // 2. Fallback to standard Subsonic lyrics
                // This breaks the visualizer, maybe better just don't support it if the lyrics is not in structured format.
                // 看到这里你会发现注释大部分都是英文写的，这是因为 Linux 下的输入法不太好用，而且对于 LLM 来说英文更节省token,大概是这样，反正你能看懂就好。
                // 题外话，不用 Windows 并非因为 Linux 更好用（虽然我个人确实更喜欢 Linux），而是因为在开发的早期，Windows下的LFN,以及目录反斜杠等问题导致
                // 本来就不太可靠的大型语言模型 agent 经常发生错误编辑，破坏掉整个代码库，你能想象吗？
                if (!lyrics) {
                    const lyricsFromNavidrome = await navidromeApi.getLyrics(config, artistName, navidromeSong.name);
                    if (lyricsFromNavidrome) {
                        lyrics = parseLRC(lyricsFromNavidrome, '');
                        console.log('[App] Using standard Navidrome lyrics');
                    }
                }
            }

            // If no lyrics from Navidrome, try Netease (Auto Match)
            let isAutoMatched = false;
            let autoMatchedLyrics: LyricData | null = null;
            if (!lyrics && !matchData?.noAutoMatch) {
                try {
                    const artistName = navidromeSong.artists?.[0]?.name || navidromeSong.ar?.[0]?.name || '';
                    const searchQuery = `${navidromeSong.name} ${artistName}`.trim();
                    const searchRes = await neteaseApi.cloudSearch(searchQuery, 1);

                    if (searchRes.result?.songs?.length > 0) {
                        const matchedSong = searchRes.result.songs[0];
                        const lyricRes = await neteaseApi.getLyric(matchedSong.id);

                        const mainLrc = lyricRes.lrc?.lyric;
                        const tlyric = lyricRes.tlyric?.lyric || "";

                        if (mainLrc) {
                            lyrics = parseLRC(mainLrc, tlyric);
                            autoMatchedLyrics = lyrics;
                            isAutoMatched = true;
                            console.log('[App] Using Netease lyrics for Navidrome song');
                        }
                    }
                } catch (e) {
                    console.warn('[App] Failed to fetch Netease lyrics for Navidrome song:', e);
                }
            }

            // Attach match properties for NaviTab logic
            if (isAutoMatched) {
                (navidromeSong as any).matchedLyrics = autoMatchedLyrics;
                (navidromeSong as any).useOnlineLyrics = true;
                (navidromeSong as any).lyricsSource = 'online';
            } else {
                (navidromeSong as any).matchedLyrics = matchData?.matchedLyrics;
                (navidromeSong as any).useOnlineLyrics = matchData?.useOnlineLyrics;
                (navidromeSong as any).lyricsSource = matchData?.lyricsSource;
            }

            // Get cover art URL
            if (!coverUrl) {
                coverUrl = navidromeSong.album?.picUrl || navidromeSong.al?.picUrl ||
                    navidromeApi.getCoverArtUrl(config, navidromeId);
            }

            // Create unified song for playback
            const unifiedSong = buildUnifiedNavidromeSong(navidromeSong, {
                coverUrl,
                useOnlineMetadata: matchData?.useOnlineMetadata,
                matchedArtists: matchData?.matchedArtists,
                matchedAlbumName: matchData?.matchedAlbumName,
            });

            // Enable autoplay
            shouldAutoPlay.current = true;
            currentSongRef.current = unifiedSong.id;

            // Set UI state
            setLyrics(lyrics);
            setCurrentLineIndex(-1);
            currentTime.set(0);
            setCurrentSong(unifiedSong);
            setCachedCoverUrl(coverUrl);
            setAudioSrc(streamUrl);
            setIsLyricsLoading(false);

            // Set queue
            if (queue.length > 0) {
                const finalQueue = buildNavidromeQueue(queue, unifiedSong);
                setPlayQueue(finalQueue);
                saveToCache('last_queue', finalQueue);
            } else {
                setPlayQueue([unifiedSong]);
                saveToCache('last_queue', [unifiedSong]);
            }

            saveToCache('last_song', unifiedSong);

            // Navigate to player
            navigateToPlayer();
            setPlayerState(PlayerState.IDLE);
            setStatusMsg({ type: 'success', text: 'Navidrome 歌曲已加载' });
        } catch (e) {
            console.error('[App] Failed to play Navidrome song:', e);
            setStatusMsg({ type: 'error', text: '播放失败' });
            setIsLyricsLoading(false);
        }
    };

    // --- Navidrome Lyric Matching ---
    const onMatchNavidromeSong = async (navidromeSong: NavidromeSong) => {
        // This opens the lyric matching modal for Navidrome songs
        // For now, we'll use a similar approach to local song matching
        // The actual matching will be handled when playing the song
        setStatusMsg({ type: 'info', text: t('navidrome.fetchingLyrics') || '正在匹配歌词...' });
    };

    // --- Effects ---

    // Toast Auto-Dismiss
    useEffect(() => {
        if (statusMsg) {
            const timer = setTimeout(() => {
                setStatusMsg(null);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [statusMsg]);

    // Audio Analyzer Setup
    // TODO: LOW PRIORITY::
    // Currently if a song contains rapidly changing audio, the analyzer can't keep up and causes a weird frame-skip-like effect on the gemotries(they seem to be static, like too slow to keep up), but this dosen't causes real visual stutter or audio issues, just the GeometricBackground is not responsive to the audio changes.
    // Very likely caused by
    //             analyser.smoothingTimeConstant = 0.6;
    // What do you think? Lowering the smoothingTimeConstant can make the analyzer more responsive, but it will also make it more jittery and less smooth, which might not look good for the visualizer. It's a trade-off between responsiveness and visual quality. We can experiment with different values to find a good balance. Maybe we can even make it dynamic based on the song's audio characteristics, but that might be overkill for now.
    const setupAudioAnalyzer = () => {
        if (!audioRef.current || sourceRef.current) return;
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContextClass();
            audioContextRef.current = ctx;

            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.6;
            analyserRef.current = analyser;

            const gainNode = ctx.createGain();
            gainNodeRef.current = gainNode;

            const source = ctx.createMediaElementSource(audioRef.current);
            source.connect(gainNode);
            gainNode.connect(analyser);
            analyser.connect(ctx.destination);
            sourceRef.current = source;
        } catch (e) {
            console.error("Audio Context Setup Failed:", e);
        }
    };

    const playSong = async (song: SongResult, queue: SongResult[] = [], isFmCall: boolean = false) => {
        console.log("[App] playSong initiated:", song.name, song.id, "isFm:", isFmCall);
        setIsFmMode(isFmCall);
        if (isFmCall && !isFmMode) {
            // Only auto-open panel when first entering FM mode
            setPanelTab('queue');
            setIsPanelOpen(true);
        }

        // Enable autoplay for user-initiated song changes
        shouldAutoPlay.current = true;
        currentSongRef.current = song.id;

        // 0. Instant UI Feedback
        setLyrics(null);
        setCurrentLineIndex(-1);
        currentTime.set(0); // Reset currentTime to prevent stale playback position
        setCurrentSong(song);
        setCachedCoverUrl(null);
        setAudioSrc(null);
        setIsLyricsLoading(true); // Start loading lyrics

        // Revoke old blob
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
        }

        // 1. Queue Management
        let newQueue = playQueue;
        if (queue.length > 0) {
            setPlayQueue(queue);
            newQueue = queue;
        } else if (playQueue.length === 0) {
            setPlayQueue([song]);
            newQueue = [song];
        }

        // Save for next reload
        saveToCache('last_song', song);
        saveToCache('last_queue', newQueue);

        // Navigate to Player with History
        navigateToPlayer();
        setPlayerState(PlayerState.IDLE);
        setStatusMsg({ type: 'info', text: t('status.loadingSong') });

        // Check if it is a local song
        // We check for isLocal flag OR negative ID (legacy check)
        const isLocal = (song as any).isLocal || song.id < 0;

        if (isLocal) {
            console.log("[App] Playing Local Song");

            // 2. Load Local Audio
            let blobUrl: string | null = null;
            let currentLocalData = (song as any).localData;

            // Try to get blob from localData if available
            if (currentLocalData) {
                blobUrl = await getAudioFromLocalSong(currentLocalData);
            }
            // If not in song object (e.g. from queue restoration), try to find in localSongs list
            else {
                // Try to match by name/duration as fallback
                const found = localSongs.find(ls =>
                    (ls.title || ls.fileName) === song.name &&
                    Math.abs(ls.duration - song.duration) < 1000
                );
                if (found) {
                    currentLocalData = found;
                    blobUrl = await getAudioFromLocalSong(found);
                }
            }

            if (blobUrl) {
                blobUrlRef.current = blobUrl;
                setAudioSrc(blobUrl);

                // 3. Auto-Match & Load Local Lyrics & Cover
                if (currentLocalData) {
                    const { updatedLocalSong, matchedSongResult } = await handleLocalSongMatch(currentLocalData);

                    if (currentSongRef.current !== song.id) return;

                    // Update localData reference
                    currentLocalData = updatedLocalSong;

                    // Update SongResult metadata if match found
                    if (matchedSongResult) {
                        const updatedSong = { ...song };
                        updatedSong.name = matchedSongResult.name;
                        updatedSong.artists = matchedSongResult.artists || matchedSongResult.ar || updatedSong.artists;
                        updatedSong.album = matchedSongResult.album || (matchedSongResult.al ? {
                            id: matchedSongResult.al.id,
                            name: matchedSongResult.al.name,
                            picUrl: matchedSongResult.al.picUrl
                        } : updatedSong.album);
                        updatedSong.ar = matchedSongResult.ar || updatedSong.ar;
                        updatedSong.al = matchedSongResult.al || updatedSong.al;
                        (updatedSong as any).localData = updatedLocalSong;

                        setCurrentSong(updatedSong);
                        // Update in queue as well? Ideally yes, but might be complex to find index.
                        // For now, updating currentSong is enough for player view.
                    }

                    // Cover
                    if (currentLocalData.matchedCoverUrl) {
                        const resolvedCoverUrl = await loadCachedOrFetchCover(`cover_local_${currentLocalData.id}`, currentLocalData.matchedCoverUrl);
                        if (currentSongRef.current !== song.id) return;
                        setCachedCoverUrl(resolvedCoverUrl);
                    } else {
                        setCachedCoverUrl(null);
                    }

                    // Lyrics - use lyricsSource priority chain
                    const lyricsSource = currentLocalData.lyricsSource;
                    if (lyricsSource === 'online' && currentLocalData.matchedLyrics) {
                        setLyrics(currentLocalData.matchedLyrics);
                    } else if (lyricsSource === 'embedded' && currentLocalData.embeddedLyricsContent) {
                        setLyrics(parseLRC(currentLocalData.embeddedLyricsContent, ''));
                    } else if (lyricsSource === 'local' && currentLocalData.localLyricsContent) {
                        setLyrics(parseLRC(currentLocalData.localLyricsContent, currentLocalData.localTranslationLyricsContent || ''));
                    } else if (currentLocalData.hasLocalLyrics && currentLocalData.localLyricsContent) {
                        const parsed = parseLRC(currentLocalData.localLyricsContent, currentLocalData.localTranslationLyricsContent || "");
                        setLyrics(parsed);
                    } else if (currentLocalData.hasEmbeddedLyrics && currentLocalData.embeddedLyricsContent) {
                        setLyrics(parseLRC(currentLocalData.embeddedLyricsContent, ''));
                    } else if (currentLocalData.matchedLyrics) {
                        setLyrics(currentLocalData.matchedLyrics);
                    } else {
                        setLyrics(null);
                    }
                }

                setIsLyricsLoading(false);

                // Theme
                try {
                    await restoreCachedThemeForSong(song.id);
                    if (currentSongRef.current !== song.id) return;
                } catch (e) {
                    console.warn("Theme load error", e);
                }

                return; // EXIT for local songs
            } else {
                setStatusMsg({ type: 'error', text: '无法播放本地文件 (文件可能已移动或权限丢失)' });
                setIsLyricsLoading(false);
                return;
            }
        }

        // --- ONLINE SONG LOGIC BELOW ---

        // Check prefetch cache for this song (with quality validation)
        const prefetched = getPrefetchedData(song.id, audioQuality);

        // 2. Load Cached Cover (Visual Feedback)
        const cachedCoverUrl = await getCachedCoverUrl(`cover_${song.id}`);
        if (currentSongRef.current !== song.id) return;
        if (cachedCoverUrl) {
            setCachedCoverUrl(cachedCoverUrl);
        } else if (prefetched?.coverUrl) {
            // Use prefetched cover URL as fallback
            setCachedCoverUrl(prefetched.coverUrl);
        }

        // 3. Audio Loading (Prefetch Cache vs IndexedDB vs Network)
        try {
            const audioResult = await loadOnlineSongAudioSource(song.id, audioQuality, prefetched);
            if (currentSongRef.current !== song.id) return;
            if (audioResult.kind === 'unavailable') {
                console.warn("[App] Song URL is empty, likely unavailable");
                setStatusMsg({ type: 'error', text: t('status.songUnavailable') });
                setPlayerState(PlayerState.IDLE);
                setIsLyricsLoading(false);
                return;
            }

            if (audioResult.blobUrl) {
                blobUrlRef.current = audioResult.blobUrl;
            }
            setAudioSrc(audioResult.audioSrc);
        } catch (e) {
            console.error("[App] Failed to fetch song URL:", e);
            setStatusMsg({ type: 'error', text: t('status.playbackError') });
            setIsLyricsLoading(false); // Stop loading if failed
            return;
        }

        // 4. Fetch Lyrics (Prefetch Cache vs IndexedDB vs Network)
        try {
            await loadOnlineSongLyrics(song.id, prefetched, {
                isCurrent: () => currentSongRef.current === song.id,
                onLyrics: (resolvedLyrics) => setLyrics(resolvedLyrics),
                onDone: () => setIsLyricsLoading(false),
            });
        } catch (e) {
            console.warn("[App] Lyric fetch failed", e);
            setLyrics(null);
            setIsLyricsLoading(false); // Failed
        }

        // 5. Handle Theme
        try {
            await restoreCachedThemeForSong(song.id);
            if (currentSongRef.current !== song.id) return;
        } catch (e) {
            console.warn("Theme load error", e);
        }

        // 6. Trigger prefetch for nearby songs in queue
        if (newQueue.length > 1) {
            prefetchNearbySongs(song.id, newQueue, audioQuality);
        }
    };

    const cacheSongAssets = async () => {
        if (!currentSong || !audioSrc || audioSrc.startsWith('blob:')) return;

        // Don't re-cache if already in cache
        const existing = await getFromCache(`audio_${currentSong.id}`);
        if (existing) return;

        if (!enableMediaCache) return;

        console.log("[Cache] Caching fully played song:", currentSong.name);

        // 1. Cache Audio
        try {
            const response = await fetch(audioSrc);
            const blob = await response.blob();
            await saveToCache(`audio_${currentSong.id}`, blob);
            console.log("[Cache] Audio saved");
        } catch (e) {
            console.error("[Cache] Failed to download audio for cache", e);
        }

        // 2. Cache Cover
        const coverUrl = getCoverUrl();
        if (coverUrl) {
            try {
                // Netease images might need proxy handling due to CORS? 
                // Usually images are fine, but if it fails we catch it.
                const response = await fetch(coverUrl, { mode: 'cors' });
                const blob = await response.blob();
                await saveToCache(`cover_${currentSong.id}`, blob);
                console.log("[Cache] Cover saved");
            } catch (e) {
                console.error("[Cache] Failed to download cover for cache", e);
            }
        }

        // Update usage if panel is open
        if (isPanelOpen && panelTab === 'account') updateCacheSize();
    };

    const handleQueueAddAndPlay = (song: SongResult) => {
        // Check if song exists in queue
        const existingIndex = playQueue.findIndex(s => s.id === song.id);

        let newQueue = [...playQueue];

        if (existingIndex === -1) {
            // Add to end if not present (or after current song? Let's just append)
            newQueue.push(song);
        }

        // Play this song, updating the queue state
        playSong(song, newQueue, false);
    };

    const handleNextTrack = useCallback(async () => {
        if (!currentSong || playQueue.length === 0) return;

        const currentIndex = playQueue.findIndex(s => s.id === currentSong.id);

        // --- FM Mode Auto-fetch ---
        if (isFmMode && currentIndex >= playQueue.length - 2) {
            try {
                const fmRes = await neteaseApi.getPersonalFm();
                if (fmRes.data && fmRes.data.length > 0) {
                    const newQueue = [...playQueue, ...fmRes.data];
                    setPlayQueue(newQueue);
                    playSong(newQueue[currentIndex + 1], newQueue, true);
                    return;
                }
            } catch (e) {
                console.error("Failed to fetch FM tracks", e);
            }
        }

        let nextIndex = -1;

        if (currentIndex >= 0 && currentIndex < playQueue.length - 1) {
            nextIndex = currentIndex + 1;
        } else if (loopMode === 'all') {
            // Wrap around
            nextIndex = 0;
        }

        if (nextIndex >= 0) {
            playSong(playQueue[nextIndex], playQueue, isFmMode);
        } else {
            setPlayerState(PlayerState.IDLE);
        }
    }, [currentSong, playQueue, loopMode, isFmMode]);

    const handlePrevTrack = useCallback(() => {
        if (!currentSong || playQueue.length === 0) return;

        const currentIndex = playQueue.findIndex(s => s.id === currentSong.id);
        let prevIndex = -1;

        if (currentIndex > 0) {
            prevIndex = currentIndex - 1;
        } else if (loopMode === 'all') {
            prevIndex = playQueue.length - 1;
        }

        if (prevIndex >= 0) {
            playSong(playQueue[prevIndex], playQueue, isFmMode);
        }
    }, [currentSong, playQueue, loopMode, isFmMode]);

    const handleFmTrash = async () => {
        if (currentSong && isFmMode) {
            try {
                await neteaseApi.fmTrash(currentSong.id);
            } catch (e) { }
            // Skip immediately
            handleNextTrack();
        }
    };

    const shuffleQueue = useCallback(() => {
        if (!playQueue || playQueue.length <= 1) return;

        // 1. Identify current song
        const currentId = currentSong?.id;

        // 2. Separate current song from others
        let songsToShuffle: SongResult[] = [];
        let firstSong: SongResult | null = null;

        if (currentId) {
            firstSong = playQueue.find(s => s.id === currentId) || null;
            songsToShuffle = playQueue.filter(s => s.id !== currentId);
        } else {
            songsToShuffle = [...playQueue];
        }

        // 3. Fisher-Yates Shuffle
        for (let i = songsToShuffle.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [songsToShuffle[i], songsToShuffle[j]] = [songsToShuffle[j], songsToShuffle[i]];
        }

        // 4. Reconstruct queue: Current song first (if exists), then shuffled songs
        const newQueue = firstSong ? [firstSong, ...songsToShuffle] : songsToShuffle;

        setPlayQueue(newQueue);
        setStatusMsg({ type: 'success', text: t('status.queueShuffled') || 'Queue Shuffled' });

        // 5. Re-prefetch based on new queue order
        if (currentId && newQueue.length > 1) {
            invalidateAndRefetch(currentId, newQueue, audioQuality);
        }
    }, [playQueue, currentSong, t, audioQuality]);

    // Volume & Mute Sync
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume;
            audioRef.current.muted = isMuted;
        }
    }, [volume, isMuted]);

    // ReplayGain Effect
    useEffect(() => {
        if (!currentSong || !gainNodeRef.current || !audioContextRef.current) return;
        
        let replayGainDb = 0;
        if ((currentSong as any).isLocal && (currentSong as any).localData) {
            const localData = (currentSong as any).localData;
            replayGainDb = typeof localData.replayGain === 'number' ? localData.replayGain : 0;
        }

        const linearGain = Math.pow(10, replayGainDb / 20);
        
        try {
            gainNodeRef.current.gain.setTargetAtTime(
                linearGain, 
                audioContextRef.current.currentTime, 
                0.1
            );
            console.log(`[AudioContext] ReplayGain set to ${replayGainDb}dB (Linear: ${linearGain.toFixed(2)})`);
        } catch (e) {
            console.warn('[AudioContext] Failed to apply ReplayGain', e);
        }
    }, [currentSong]);

    // Media Session API Integration
    useEffect(() => {
        if (!currentSong) {
            if ('mediaSession' in navigator) {
                navigator.mediaSession.metadata = null;
                navigator.mediaSession.playbackState = 'none';
            }
            return;
        }

        if ('mediaSession' in navigator) {
            const artistName = currentSong.ar?.map(a => a.name).join(', ') ||
                currentSong.artists?.map(a => a.name).join(', ') ||
                t('ui.unknownArtist');
            const albumName = currentSong.al?.name || currentSong.album?.name || '';

            // Determine cover URL (prioritize cached blob, then network url)
            const cover = cachedCoverUrl || currentSong.al?.picUrl || currentSong.album?.picUrl || '';

            navigator.mediaSession.metadata = new MediaMetadata({
                title: currentSong.name,
                artist: artistName,
                album: albumName,
                artwork: cover ? [
                    { src: cover, sizes: '512x512', type: 'image/jpeg' }
                ] : []
            });

            navigator.mediaSession.playbackState = playerState === PlayerState.PLAYING ? 'playing' : 'paused';

            // Action Handlers
            navigator.mediaSession.setActionHandler('play', async () => {
                if (audioRef.current) {
                    try {
                        setupAudioAnalyzer();
                        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
                            audioContextRef.current.resume();
                        }
                        await audioRef.current.play();
                        setPlayerState(PlayerState.PLAYING);
                    } catch (e) {
                        console.error("MediaSession play failed", e);
                    }
                }
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                if (audioRef.current) {
                    audioRef.current.pause();
                    setPlayerState(PlayerState.PAUSED);
                }
            });
            navigator.mediaSession.setActionHandler('previoustrack', handlePrevTrack);
            navigator.mediaSession.setActionHandler('nexttrack', handleNextTrack);
        }
    }, [currentSong, playerState, cachedCoverUrl, handleNextTrack, handlePrevTrack, t]);


    useEffect(() => {
        if (audioSrc && audioRef.current) {
            // Only play if shouldAutoPlay is true AND lyrics are not loading
            if (shouldAutoPlay.current && !isLyricsLoading) {
                const playPromise = audioRef.current.play();
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            setPlayerState(PlayerState.PLAYING);
                            setupAudioAnalyzer();
                        })
                        .catch(e => {
                            if (e.name === 'NotAllowedError') {
                                setStatusMsg({ type: 'info', text: t('status.clickToPlay') });
                                setPlayerState(PlayerState.PAUSED);
                            }
                        });
                }
            } else if (!shouldAutoPlay.current) {
                // If we're not auto-playing (e.g. restore session), just set state to paused
                setPlayerState(PlayerState.PAUSED);
            }
        }
    }, [audioSrc, isLyricsLoading]);

    // Ref to track currentLineIndex inside animation loop (avoid callback recreation)
    const currentLineIndexRef = useRef(currentLineIndex);
    currentLineIndexRef.current = currentLineIndex;

    // Sync Logic & Audio Power
    const updateLoop = useCallback(() => {
        // 1. Audio Power / Visualizer Data
        if (playerState === PlayerState.PLAYING && audioRef.current && !audioRef.current.paused && analyserRef.current) {
            const bufferLength = analyserRef.current.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyserRef.current.getByteFrequencyData(dataArray);

            // Helper to get average energy of a frequency range
            // fftSize 2048 -> bin size ~21.5Hz (44100/2048)
            const getEnergy = (minHz: number, maxHz: number): number => {
                const start = Math.floor(minHz / 21.5);
                const end = Math.floor(maxHz / 21.5);
                let sum = 0;
                for (let i = start; i <= end; i++) {
                    sum += dataArray[i];
                }
                const count = end - start + 1;
                return count > 0 ? sum / count : 0;
            };

            // Calculate bands
            const bass = getEnergy(20, 150);       // Circles
            const lowMid = getEnergy(150, 400);    // Squares
            const mid = getEnergy(400, 1200);      // Triangles
            const vocal = getEnergy(1000, 3500);   // Icons (Vocal range)
            const treble = getEnergy(3500, 12000); // Crosses

            // Apply sensitivity and update
            const process = (val: number, boost: number = 2) => {
                const norm = val / 255;
                return Math.pow(norm, boost) * 255;
            };

            // Main audio power (keep for legacy compatibility)
            // Use bass + low mid for main pulse
            audioPower.set(process((bass + lowMid) / 2, 3));

            // Set individual bands
            audioBands.bass.set(process(bass, 1.8)); // slightly more sensitive bass
            audioBands.lowMid.set(process(lowMid, 2));
            audioBands.mid.set(process(mid, 2));
            audioBands.vocal.set(process(vocal, 1.5)); // Vocal sensitive
            audioBands.treble.set(process(treble, 2));

        } else {
            // Idle Animation (Breathing effect for PV background)
            const time = Date.now() / 2000;
            const breath = (Math.sin(time) + 1) * 20;
            audioPower.set(breath);

            // Idle state for bands
            audioBands.bass.set(breath);
            audioBands.lowMid.set(breath);
            audioBands.mid.set(breath);
            audioBands.vocal.set(breath);
            audioBands.treble.set(breath);
        }

        // 2. Playback Time & Lyrics Sync
        if (playerState === PlayerState.PLAYING && audioRef.current && !audioRef.current.paused) {
            const time = audioRef.current.currentTime;
            currentTime.set(time);

            if (lyrics) {
                let foundIndex = -1;
                if (currentLineIndexRef.current !== -1 &&
                    lyrics.lines[currentLineIndexRef.current] &&
                    time >= lyrics.lines[currentLineIndexRef.current].startTime &&
                    time <= lyrics.lines[currentLineIndexRef.current].endTime) {
                    foundIndex = currentLineIndexRef.current;
                } else {
                    foundIndex = lyrics.lines.findIndex(l => time >= l.startTime && time <= l.endTime);
                }
                // Update currentLineIndex whenever it changes, including when moving to -1 (no active lyric)
                if (foundIndex !== currentLineIndexRef.current) {
                    setCurrentLineIndex(foundIndex);
                }
            }
        }

        animationFrameRef.current = requestAnimationFrame(updateLoop);
    }, [lyrics, audioPower, playerState]);

    useEffect(() => {
        animationFrameRef.current = requestAnimationFrame(updateLoop);
        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [updateLoop]);

    const togglePlay = (e?: React.MouseEvent | KeyboardEvent) => {
        e?.stopPropagation();
        if (audioRef.current) {
            if (playerState === PlayerState.PLAYING) {
                audioRef.current.pause();
                setPlayerState(PlayerState.PAUSED);
            } else {
                // Ensure audio context is set up and resumed
                setupAudioAnalyzer();
                if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
                    audioContextRef.current.resume();
                }

                audioRef.current.play();
                setPlayerState(PlayerState.PLAYING);
            }
        }
    };

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if typing in an input (though we don't have many inputs yet)
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            switch (e.code) {
                case 'Space':
                    // Space key works in both home and player views if there's a current song
                    if (currentSong && audioSrc) {
                        e.preventDefault();
                        togglePlay(e);
                    }
                    break;
                case 'ArrowLeft':
                    // Arrow keys only work in player view
                    if (currentView !== 'player') return;
                    e.preventDefault();
                    if (audioRef.current) {
                        audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
                    }
                    break;
                case 'ArrowRight':
                    // Arrow keys only work in player view
                    if (currentView !== 'player') return;
                    e.preventDefault();
                    if (audioRef.current) {
                        audioRef.current.currentTime = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + 5);
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentView, playerState, currentSong, audioSrc]);

    const toggleLoop = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        setLoopMode(prev => {
            if (prev === 'off') return 'all';
            if (prev === 'all') return 'one';
            return 'off';
        });
    };

    const getCoverUrl = () => {
        if (cachedCoverUrl) return cachedCoverUrl;
        let url = null;
        if (currentSong?.al?.picUrl) url = currentSong.al.picUrl;
        else if (currentSong?.album?.picUrl) url = currentSong.album.picUrl;

        if (url && url.startsWith('http:')) {
            return url.replace('http:', 'https:');
        }
        return url;
    };

    const coverUrl = getCoverUrl();

    const handleLike = async () => {
        if (!currentSong) return;

        // Check if local song
        if ((currentSong as any).isLocal || currentSong.id < 0) {
            setStatusMsg({ type: 'info', text: '本地音乐无法添加到"我喜欢的音乐"' });
            return;
        }

        const isLiked = likedSongIds.has(currentSong.id);
        const newStatus = !isLiked;

        try {
            await neteaseApi.likeSong(currentSong.id, newStatus);

            // Update local state immediately
            setLikedSongIds(prev => {
                const next = new Set(prev);
                if (newStatus) next.add(currentSong.id);
                else next.delete(currentSong.id);

                // Update cache
                saveToCache('user_liked_songs', Array.from(next));

                return next;
            });

            setStatusMsg({ type: 'success', text: newStatus ? t('status.liked') : t('status.unliked') || "Removed from Liked" });
        } catch (e) {
            console.error("Like failed", e);
            setStatusMsg({ type: 'error', text: t('status.likeFailed') });
        }
    };

    const handleUpdateLocalLyrics = async (content: string, isTranslation: boolean) => {
        if (!currentSong || !((currentSong as any).isLocal || currentSong.id < 0)) return;

        const localData = (currentSong as any).localData as LocalSong;
        if (!localData) return;

        const updatedLocalSong = { ...localData };
        if (isTranslation) {
            updatedLocalSong.hasLocalTranslationLyrics = true;
            updatedLocalSong.localTranslationLyricsContent = content;
        } else {
            updatedLocalSong.hasLocalLyrics = true;
            updatedLocalSong.localLyricsContent = content;
        }

        // Save to DB
        try {
            const { saveLocalSong } = await import('./services/db');
            await saveLocalSong(updatedLocalSong);

            // Re-run onPlayLocalSong to handle everything (parsing, merging) properly
            onPlayLocalSong(updatedLocalSong, localSongs);

            setStatusMsg({ type: 'success', text: isTranslation ? 'Translation lyrics updated' : 'Lyrics updated' });
        } catch (e) {
            console.error("Failed to save local lyrics", e);
            setStatusMsg({ type: 'error', text: 'Failed to save lyrics' });
        }
    };

    const handleChangeLyricsSource = async (source: 'local' | 'embedded' | 'online') => {
        if (!currentSong || !((currentSong as any).isLocal || currentSong.id < 0)) return;

        const localData = (currentSong as any).localData as LocalSong;
        if (!localData) return;

        const updatedLocalSong = { ...localData };
        updatedLocalSong.lyricsSource = source;

        // Save to DB
        try {
            const { saveLocalSong } = await import('./services/db');
            await saveLocalSong(updatedLocalSong);

            // Parse and apply lyrics from the selected source
            let newLyrics: LyricData | null = null;
            if (source === 'local' && updatedLocalSong.localLyricsContent) {
                newLyrics = parseLRC(updatedLocalSong.localLyricsContent, updatedLocalSong.localTranslationLyricsContent || '');
            } else if (source === 'embedded' && updatedLocalSong.embeddedLyricsContent) {
                newLyrics = parseLRC(updatedLocalSong.embeddedLyricsContent, '');
            } else if (source === 'online' && updatedLocalSong.matchedLyrics) {
                newLyrics = updatedLocalSong.matchedLyrics;
            }
            setLyrics(newLyrics);
            setCurrentLineIndex(-1);

            // Update current song's localData reference
            const updatedSong = { ...currentSong };
            (updatedSong as any).localData = updatedLocalSong;
            setCurrentSong(updatedSong);

            // Refresh local songs list
            await loadLocalSongs();

            setStatusMsg({ type: 'success', text: '歌词来源已切换' });
        } catch (e) {
            console.error("Failed to save lyrics source", e);
            setStatusMsg({ type: 'error', text: 'Failed to save lyrics source' });
        }
    };

    const [showLyricMatchModal, setShowLyricMatchModal] = useState(false);
    const [showNaviLyricMatchModal, setShowNaviLyricMatchModal] = useState(false);

    const handleManualMatchOnline = () => {
        setIsPanelOpen(false);
        if (currentSong && (currentSong as any).isNavidrome) {
            setShowNaviLyricMatchModal(true);
            return;
        }

        if (!currentSong || !((currentSong as any).isLocal || currentSong.id < 0)) return;
        const localData = (currentSong as any).localData as LocalSong;
        if (!localData) return;
        setShowLyricMatchModal(true);
    };

    const handleLyricMatchComplete = async () => {
        setShowLyricMatchModal(false);
        if (!currentSong || !((currentSong as any).isLocal || currentSong.id < 0)) return;
        const localData = (currentSong as any).localData as LocalSong;
        if (!localData) return;

        await loadLocalSongs();
        const updatedList = await getLocalSongs();
        const found = updatedList.find(s => s.id === localData.id);
        if (found) {
            onPlayLocalSong(found, localSongs);
            setStatusMsg({ type: 'success', text: 'Match successful' });
        }
    };

    const handleNaviLyricMatchComplete = async () => {
        setShowNaviLyricMatchModal(false);
        if (currentSong && (currentSong as any).isNavidrome) {
            onPlayNavidromeSong((currentSong as any).navidromeData, playQueue);
            setStatusMsg({ type: 'success', text: 'Match successful' });
        }
    };

    const handleContainerClick = () => {
        if (isPanelOpen) setIsPanelOpen(false);
    };

    // Define dynamic style for theme variables
    const appStyle = {
        '--bg-color': bgMode === 'ai' ? theme.backgroundColor : (isDaylight ? DAYLIGHT_THEME.backgroundColor : DEFAULT_THEME.backgroundColor),
        '--text-primary': theme.primaryColor,
        '--text-secondary': theme.secondaryColor,
        '--text-accent': theme.accentColor,
        backgroundColor: 'var(--bg-color)',
        color: 'var(--text-primary)'
    } as React.CSSProperties;

    return (
        <div
            className="fixed inset-0 w-full h-full flex flex-col overflow-hidden font-sans transition-colors duration-500"
            style={appStyle}
        >
            <audio
                ref={audioRef}
                src={audioSrc || undefined}
                crossOrigin="anonymous"
                loop={loopMode === 'one'}
                onEnded={() => {
                    // Cache if playing fully
                    if (audioSrc && !audioSrc.startsWith('blob:') && currentSong) {
                        cacheSongAssets();
                    }

                    // If single loop is active, native loop handles it.
                    // If not, we handle queue logic.
                    if (loopMode !== 'one') handleNextTrack();
                }}
                onLoadedMetadata={(e) => {
                    setDuration(e.currentTarget.duration);
                    currentTime.set(0); // Ensure currentTime is reset when new audio loads
                }}
                onError={(e) => {
                    if (audioSrc) {
                        setStatusMsg({ type: 'error', text: t('status.playbackError') });
                        // If blob failed, maybe try reloading with network? 
                        // For simplicity, just skip.
                        setTimeout(handleNextTrack, 2000);
                    }
                }}
            />

            {/* --- VISUALIZER (Background Layer & Main Click Target) --- */}
            <div
                className="absolute inset-0 z-0"
                onClick={handleContainerClick}
            >
                <Visualizer
                    currentTime={currentTime}
                    currentLineIndex={currentLineIndex}
                    lines={lyrics?.lines || []}
                    theme={{ ...theme, backgroundColor: String(appStyle['--bg-color']) }} // Pass effective bg color
                    audioPower={audioPower}
                    audioBands={audioBands}
                    coverUrl={getCoverUrl()}
                    showText={currentView === 'player'}
                    useCoverColorBg={useCoverColorBg}
                    seed={currentSong?.id}
                    staticMode={staticMode}
                    backgroundOpacity={backgroundOpacity}
                />
            </div>

            {/* --- HOME VIEW (Overlay) --- */}
            <AnimatePresence>
                {currentView === 'home' && (
                    <motion.div
                        className="absolute inset-0 z-50"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.5, ease: "easeInOut" }}
                    >
                        <Home
                            onPlaySong={playSong}
                            onQueueAddAndPlay={handleQueueAddAndPlay}
                            onBackToPlayer={navigateToPlayer}
                            onRefreshUser={() => refreshUserData()}
                            user={user}
                            playlists={playlists}
                            currentTrack={currentSong}
                            isPlaying={playerState === PlayerState.PLAYING}
                            selectedPlaylist={selectedPlaylist}
                            onSelectPlaylist={handlePlaylistSelect}
                            onSelectAlbum={handleAlbumSelect}
                            onSelectArtist={handleArtistSelect}
                            localSongs={localSongs}
                            onRefreshLocalSongs={onRefreshLocalSongs}
                            onPlayLocalSong={onPlayLocalSong}
                            viewTab={homeViewTab}
                            setViewTab={setHomeViewTab}
                            focusedPlaylistIndex={focusedPlaylistIndex}
                            setFocusedPlaylistIndex={setFocusedPlaylistIndex}
                            focusedFavoriteAlbumIndex={focusedFavoriteAlbumIndex}
                            setFocusedFavoriteAlbumIndex={setFocusedFavoriteAlbumIndex}
                            focusedRadioIndex={focusedRadioIndex}
                            setFocusedRadioIndex={setFocusedRadioIndex}
                            localMusicState={localMusicState}
                            setLocalMusicState={setLocalMusicState}
                            staticMode={staticMode}
                            onToggleStaticMode={handleToggleStaticMode}
                            enableMediaCache={enableMediaCache}
                            onToggleMediaCache={handleToggleMediaCache}
                            theme={theme}
                            isDaylight={isDaylight}
                            backgroundOpacity={backgroundOpacity}
                            setBackgroundOpacity={handleSetBackgroundOpacity}
                            onSetThemePreset={handleSetThemePreset}
                            onMatchSong={async (song) => {
                                await loadLocalSongs();

                                // If the matched song is currently playing, update the cover
                                if (currentSong && ((currentSong as any).isLocal || currentSong.id < 0)) {
                                    const currentLocalData = (currentSong as any).localData as LocalSong | undefined;
                                    if (currentLocalData && currentLocalData.id === song.id) {
                                        // Reload the song from DB to get updated metadata
                                        const updatedSongs = await getLocalSongs();
                                        const updatedSong = updatedSongs.find(s => s.id === song.id);

                                        if (updatedSong) {
                                            // Update currentSong's localData
                                            const updatedCurrentSong = { ...currentSong };
                                            (updatedCurrentSong as any).localData = updatedSong;

                                            // Update cover URL in currentSong
                                            if (updatedSong.matchedCoverUrl) {
                                                const coverUrl = updatedSong.matchedCoverUrl;
                                                if (updatedCurrentSong.al) {
                                                    updatedCurrentSong.al.picUrl = coverUrl;
                                                } else {
                                                    updatedCurrentSong.al = {
                                                        id: 0,
                                                        name: '',
                                                        picUrl: coverUrl
                                                    };
                                                }
                                            } else {
                                                if (updatedCurrentSong.al) {
                                                    updatedCurrentSong.al.picUrl = undefined;
                                                }
                                            }

                                            setCurrentSong(updatedCurrentSong);

                                            // Update cached cover URL
                                            if (updatedSong.matchedCoverUrl) {
                                                try {
                                                    // Cache was already cleared in LyricMatchModal, so fetch and cache new cover
                                                    const response = await fetch(updatedSong.matchedCoverUrl, { mode: 'cors' });
                                                    const coverBlob = await response.blob();
                                                    await saveToCache(`cover_local_${updatedSong.id}`, coverBlob);
                                                    setCachedCoverUrl(URL.createObjectURL(coverBlob));
                                                } catch (e) {
                                                    console.warn('Failed to cache updated cover:', e);
                                                    setCachedCoverUrl(updatedSong.matchedCoverUrl);
                                                }
                                            } else {
                                                setCachedCoverUrl(null);
                                            }

                                            // Update lyrics if available
                                            if (updatedSong.matchedLyrics) {
                                                setLyrics(updatedSong.matchedLyrics);
                                            } else {
                                                setLyrics(null);
                                            }
                                        }
                                    }
                                }
                            }}
                            onPlayNavidromeSong={onPlayNavidromeSong}
                            onMatchNavidromeSong={onMatchNavidromeSong}
                            navidromeFocusedAlbumIndex={navidromeFocusedAlbumIndex}
                            setNavidromeFocusedAlbumIndex={setNavidromeFocusedAlbumIndex}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* --- ALBUM VIEW (Overlay) --- */}
            <AnimatePresence>
                {selectedAlbumId && currentView === 'home' && (
                    <AlbumView
                        albumId={selectedAlbumId}
                        onBack={() => handleAlbumSelect(null)}
                        onPlaySong={(song, ctx) => {
                            playSong(song, ctx, false);
                            // We don't need to close AlbumView here explicitly if we rely on currentView check?
                            // But keeping it open in state allows returning to it.
                            // So we don't call handleAlbumSelect(null) here?
                            // Original code called handleAlbumSelect(null) inside onPlaySong prop!
                            // Wait, previous code:
                            /* 
                            onPlaySong={(song, ctx) => {
                                playSong(song, ctx, false);
                                handleAlbumSelect(null);
                            }}
                            */
                            // If we call handleAlbumSelect(null), it calls history.back().
                            // That removes the album state.
                            // Maybe we SHOULDN'T remove it if we want to come back?
                            // But if we seek strict "close on play", then yes.
                            // The user didn't ask to change "close on play" behavior for Album, but complained about stacking.
                            // However, my previous analysis said rendering guard solves the "covering player" issue.
                            // If I keep AlbumView open in state, but hidden by currentView='player', then 'Back' from player goes to Home(AlbumView).
                            // That seems nicer.
                            // BUT, the original code had: `handleAlbumSelect(null)`.
                            // So it was INTIONALLY closing the album view.
                            // I should preserve that unless I have a reason to change.
                            // Wait, handleAlbumSelect(null) calls history.back().
                            // If I'm in AlbumView, playing a song navigates to Player.
                            // If I ALSO history.back(), I might mess up the history stack (Play navigates forward? or just view switch?)
                            // navigateToPlayer pushes state.
                            // So: Album -> Play: push(Player).
                            // AND reset AlbumId?
                            // If I reset AlbumId, do I need to manipulate history?
                            // `handleAlbumSelect(null)` calls `history.back()`.
                            // So: Album -> Play -> (Back trigger) -> Home.
                            // Then push(Player) -> Player.
                            // History: Home -> Player.
                            // This means "Back" from Player goes to Home (root), not Album.
                            // This seems to be the INTENDED behavior of the current app.
                            // So I will keep passing `handleAlbumSelect(null)`.
                        }}
                        onPlayAll={(songs) => {
                            playSong(songs[0], songs, false);
                        }}
                        onSelectArtist={handleArtistSelect}
                        theme={theme}
                        isDaylight={isDaylight}
                    />
                )}
            </AnimatePresence>

            {/* --- ARTIST VIEW (Overlay) --- */}
            <AnimatePresence>
                {selectedArtistId && currentView === 'home' && (
                    <ArtistView
                        artistId={selectedArtistId}
                        onBack={() => handleArtistSelect(null)}
                        onPlaySong={(song, ctx) => {
                            playSong(song, ctx, false);
                            // Keep consistency with AlbumView behavior in original code?
                            // Original code for Artist:
                            /*
                             onPlaySong={(song, ctx) => {
                                playSong(song, ctx, false);
                                handleArtistSelect(null);
                             }}
                            */
                            // Wait, lookup lines 1965-1970 in original:
                            /*
                             onPlaySong={(song, ctx) => {
                                 playSong(song, ctx, false);
                                 // Do we close artist view? 
                                 // Keep consistency with AlbumView
                                 handleArtistSelect(null);
                             }}
                            */
                            // Yes, it was closing it.
                        }}
                        onSelectAlbum={handleAlbumSelect}
                        theme={theme}
                        isDaylight={isDaylight}
                    />
                )}
            </AnimatePresence>

            {/* --- STATUS TOAST --- */}
            <AnimatePresence>
                {statusMsg && (
                    <motion.div
                        initial={{ opacity: 0, y: -20, x: "-50%" }}
                        animate={{ opacity: 1, y: 30, x: "-50%" }}
                        exit={{ opacity: 0, y: -20, x: "-50%" }}
                        className={`absolute top-0 left-1/2 z-[70] px-6 py-3 backdrop-blur-md rounded-full font-medium text-sm shadow-xl flex items-center gap-3 pointer-events-none ${isDaylight ? 'bg-white/70 text-zinc-800 border border-black/5' : 'bg-white/10 text-white'}`}
                    >
                        {statusMsg.type === 'error' ? <AlertCircle size={18} className={isDaylight ? "text-red-500" : "text-red-400"} /> :
                            statusMsg.type === 'success' ? <CheckCircle2 size={18} className={isDaylight ? "text-green-600" : "text-green-400"} /> :
                                <Sparkles size={18} className={isDaylight ? "text-blue-600" : "text-blue-400"} />}
                        {statusMsg.text}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* --- GLOBAL CONTROLS (Floating Glass Pill) --- */}
            {
                currentSong && (
                    <FloatingPlayerControls
                        currentSong={currentSong}
                        playerState={playerState}
                        currentTime={currentTime}
                        duration={duration}
                        loopMode={loopMode}
                        currentView={currentView}
                        audioSrc={audioSrc}
                        lyrics={lyrics}
                        onSeek={(time) => {
                            if (audioRef.current) {
                                audioRef.current.currentTime = time;
                                if (audioRef.current.paused) {
                                    audioRef.current.play();
                                    setPlayerState(PlayerState.PLAYING);
                                }
                            }
                        }}
                        onTogglePlay={togglePlay}
                        onToggleLoop={toggleLoop}
                        onNavigateToPlayer={navigateToPlayer}
                        noTrackText={t('ui.noTrack')}
                        primaryColor="var(--text-primary)"
                        secondaryColor="var(--text-secondary)"
                        theme={theme}
                        isDaylight={isDaylight}
                    />
                )
            }

            {/* --- UNIFIED PANEL (Player View Only) --- */}
            {
                currentView === 'player' && !showLyricMatchModal && (
                    <UnifiedPanel
                        isOpen={isPanelOpen}
                        currentTab={panelTab}
                        onTabChange={setPanelTab}
                        onToggle={() => setIsPanelOpen(!isPanelOpen)}
                        onNavigateHome={navigateToHome}
                        coverUrl={coverUrl}
                        currentSong={currentSong}
                        onAlbumSelect={handleAlbumSelect}
                        onSelectArtist={handleArtistSelect}
                        loopMode={loopMode}
                        onToggleLoop={toggleLoop}
                        onLike={handleLike}
                        isLiked={currentSong ? likedSongIds.has(currentSong.id) : false}
                        onGenerateAITheme={() => generateAITheme(lyrics, currentSong)}
                        isGeneratingTheme={isGeneratingTheme}
                        hasLyrics={!!lyrics}
                        theme={theme}
                        onThemeChange={setTheme}
                        bgMode={bgMode}
                        onBgModeChange={handleBgModeChange}
                        onResetTheme={handleResetTheme}
                        defaultTheme={DEFAULT_THEME}
                        daylightTheme={DAYLIGHT_THEME}
                        playQueue={playQueue}
                        onPlaySong={playSong}
                        queueScrollRef={queueScrollRef}
                        onShuffle={shuffleQueue}
                        user={user}
                        onLogout={handleLogout}
                        audioQuality={audioQuality}
                        onAudioQualityChange={setAudioQuality}
                        cacheSize={cacheSize}
                        onClearCache={handleClearCache}
                        onSyncData={handleSyncData}
                        isSyncing={isSyncing}
                        useCoverColorBg={useCoverColorBg}
                        onToggleCoverColorBg={handleToggleCoverColorBg}
                        isDaylight={isDaylight}
                        onToggleDaylight={() => handleToggleDaylight(!isDaylight)}
                        onMatchOnline={handleManualMatchOnline}
                        onUpdateLocalLyrics={handleUpdateLocalLyrics}
                        onChangeLyricsSource={handleChangeLyricsSource}
                        isFmMode={isFmMode}
                        onFmTrash={handleFmTrash}
                        onNextTrack={handleNextTrack}
                        onPrevTrack={handlePrevTrack}
                        playerState={playerState}
                        onTogglePlay={togglePlay}
                        volume={volume}
                        isMuted={isMuted}
                        onVolumePreview={handlePreviewVolume}
                        onVolumeChange={handleSetVolume}
                        onToggleMute={handleToggleMute}
                    />
                )
            }

            {/* --- LYRIC MATCH MODAL (Player View) --- */}
            {showLyricMatchModal && currentSong && !((currentSong as any).isNavidrome) && ((currentSong as any).isLocal || currentSong.id < 0) && (currentSong as any).localData && (
                <LyricMatchModal
                    song={(currentSong as any).localData as LocalSong}
                    onClose={() => setShowLyricMatchModal(false)}
                    onMatch={handleLyricMatchComplete}
                    isDaylight={isDaylight}
                />
            )}

            {showNaviLyricMatchModal && currentSong && (currentSong as any).isNavidrome && (
                <NaviLyricMatchModal
                    song={(currentSong as any).navidromeData}
                    onClose={() => setShowNaviLyricMatchModal(false)}
                    onMatch={handleNaviLyricMatchComplete}
                    isDaylight={isDaylight}
                />
            )}
        </div >
    );
}
