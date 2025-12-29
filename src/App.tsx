import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Play, Pause, Repeat, Repeat1, Settings2, CheckCircle2, AlertCircle, Sparkles, X } from 'lucide-react';
import { motion, AnimatePresence, useMotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { parseLRC } from './utils/lrcParser';
import { parseYRC } from './utils/yrcParser';
import { detectChorusLines } from './utils/chorusDetector';
import { generateThemeFromLyrics } from './services/gemini';
import { saveSessionData, getSessionData, getFromCache, saveToCache, clearCache, getCacheUsage, openDB, getLocalSongs } from './services/db';
import { getAudioFromLocalSong } from './services/localMusicService';
import Visualizer from './components/Visualizer';
import ProgressBar from './components/ProgressBar';
import FloatingPlayerControls from './components/FloatingPlayerControls';
import Home from './components/Home';
import AlbumView from './components/AlbumView';
import ArtistView from './components/ArtistView';
import UnifiedPanel from './components/UnifiedPanel';
import { LyricData, Theme, PlayerState, SongResult, NeteaseUser, NeteasePlaylist, LocalSong, UnifiedSong } from './types';
import { neteaseApi } from './services/netease';

// Default Theme
const DEFAULT_THEME: Theme = {
    name: "Midnight Default",
    backgroundColor: "#09090b", // zinc-950
    primaryColor: "#f4f4f5", // zinc-100
    accentColor: "#f4f4f5", // zinc-100
    secondaryColor: "#71717a", // zinc-500
    fontStyle: "sans",
    animationIntensity: "normal"
};

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

const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// 获取用户的所有playlist（支持分页）
const getAllUserPlaylists = async (uid: number): Promise<NeteasePlaylist[]> => {
    const allPlaylists: NeteasePlaylist[] = [];
    let offset = 0;
    const limit = 50; // 每次获取50个
    let hasMore = true;

    while (hasMore) {
        const plRes = await neteaseApi.getUserPlaylists(uid, limit, offset);
        if (plRes.playlist && plRes.playlist.length > 0) {
            allPlaylists.push(...plRes.playlist);
            // 如果返回的数量少于limit，说明已经获取完了
            hasMore = plRes.playlist.length === limit;
            offset += limit;
        } else {
            hasMore = false;
        }
    }

    return allPlaylists;
};

export default function App() {
    const { t } = useTranslation();

    // View State
    const [currentView, setCurrentView] = useState<'home' | 'player'>('home');

    // Player Data
    const [audioSrc, setAudioSrc] = useState<string | null>(null);
    const [currentSong, setCurrentSong] = useState<SongResult | null>(null);
    const [lyrics, setLyrics] = useState<LyricData | null>(null);
    const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
    const [cachedCoverUrl, setCachedCoverUrl] = useState<string | null>(null);

    // User & Library Data (Lifted from Home)
    const [user, setUser] = useState<NeteaseUser | null>(null);
    const [playlists, setPlaylists] = useState<NeteasePlaylist[]>([]);
    const [likedSongIds, setLikedSongIds] = useState<Set<number>>(new Set());
    const [selectedPlaylist, setSelectedPlaylist] = useState<NeteasePlaylist | null>(null);
    const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null);
    const [selectedArtistId, setSelectedArtistId] = useState<number | null>(null);

    // Queue
    const [playQueue, setPlayQueue] = useState<SongResult[]>([]);

    // UI State
    const [statusMsg, setStatusMsg] = useState<{ type: 'error' | 'success' | 'info', text: string; } | null>(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [panelTab, setPanelTab] = useState<'cover' | 'controls' | 'queue' | 'account' | 'local'>('cover');
    const [isGeneratingTheme, setIsGeneratingTheme] = useState(false);

    const [bgMode, setBgMode] = useState<'default' | 'ai'>('ai');
    const [aiTheme, setAiTheme] = useState<Theme | null>(null); // Store AI theme for bgMode switching
    const [isSyncing, setIsSyncing] = useState(false);
    const [cacheSize, setCacheSize] = useState<string>("0 B");
    const [audioQuality, setAudioQuality] = useState<'exhigh' | 'lossless' | 'hires'>(() => {
        const saved = localStorage.getItem('default_audio_quality');
        return (saved === 'lossless' || saved === 'hires') ? saved : 'exhigh';
    });

    // Player State
    const [playerState, setPlayerState] = useState<PlayerState>(PlayerState.IDLE);
    const currentTime = useMotionValue(0);
    const [duration, setDuration] = useState(0);
    const [currentLineIndex, setCurrentLineIndex] = useState(-1);
    const [loopMode, setLoopMode] = useState<'off' | 'all' | 'one'>('off');
    const [useCoverColorBg, setUseCoverColorBg] = useState(() => {
        const saved = localStorage.getItem('use_cover_color_bg');
        return saved !== null ? saved === 'true' : false;
    });

    const handleToggleCoverColorBg = (enable: boolean) => {
        setUseCoverColorBg(enable);
        localStorage.setItem('use_cover_color_bg', String(enable));
        setStatusMsg({
            type: 'info',
            text: enable ? '添加封面色彩' : '使用默认色彩'
        });
    };

    const [staticMode, setStaticMode] = useState(() => {
        const saved = localStorage.getItem('static_mode');
        return saved !== null ? saved === 'true' : false;
    });

    const handleToggleStaticMode = (enable: boolean) => {
        setStaticMode(enable);
        localStorage.setItem('static_mode', String(enable));
        setStatusMsg({
            type: 'info',
            text: enable ? '静态模式已开启' : '静态模式已关闭'
        });
    };

    const [enableMediaCache, setEnableMediaCache] = useState(() => {
        const saved = localStorage.getItem('enable_media_cache');
        return saved !== null ? saved === 'true' : false;
    });

    const handleToggleMediaCache = (enable: boolean) => {
        setEnableMediaCache(enable);
        localStorage.setItem('enable_media_cache', String(enable));
    };

    const [backgroundOpacity, setBackgroundOpacity] = useState(() => {
        const saved = localStorage.getItem('background_opacity');
        return saved ? parseFloat(saved) : 0.75;
    });

    const handleSetBackgroundOpacity = (opacity: number) => {
        setBackgroundOpacity(opacity);
        localStorage.setItem('background_opacity', String(opacity));
    };

    const [defaultThemeDaylight, setDefaultThemeDaylight] = useState(() => {
        const saved = localStorage.getItem('default_theme_daylight');
        return saved !== null ? saved === 'true' : false;
    });

    const isDaylight = defaultThemeDaylight; // Master switch for UI mode

    const handleToggleDaylight = (isLight: boolean) => {
        setDefaultThemeDaylight(isLight);
        localStorage.setItem('default_theme_daylight', String(isLight));

        // If we are in default mode, update background only (preserve AI text colors)
        if (bgMode === 'default') {
            const baseTheme = isLight ? DAYLIGHT_THEME : DEFAULT_THEME;
            if (aiTheme) {
                // Compose: AI colors + default background
                setTheme({
                    ...aiTheme,
                    backgroundColor: baseTheme.backgroundColor,
                });
            } else {
                setTheme(baseTheme);
            }
        }
    };

    // Apply Theme to Scrollbar globally
    useEffect(() => {
        const root = document.documentElement;
        if (isDaylight) {
            root.style.setProperty('--scrollbar-track', '#cccbcc');
            root.style.setProperty('--scrollbar-thumb', '#ecececff');
            root.style.setProperty('--scrollbar-thumb-hover', '#ffffffff');
        } else {
            root.style.setProperty('--scrollbar-track', '#18181b'); // zinc-900
            root.style.setProperty('--scrollbar-thumb', '#3f3f46'); // zinc-700
            root.style.setProperty('--scrollbar-thumb-hover', '#52525b'); // zinc-600
        }
    }, [isDaylight]);

    // Progress Bar State
    // Removed isDragging and sliderValue as they are handled by ProgressBar component

    // Audio Analysis State
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
    const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
    const blobUrlRef = useRef<string | null>(null);
    const queueScrollRef = useRef<HTMLDivElement>(null);
    const shouldAutoPlay = useRef(false);
    const currentSongRef = useRef<number | null>(null);
    const [isLyricsLoading, setIsLyricsLoading] = useState(false);

    // Local Music State
    const [localSongs, setLocalSongs] = useState<LocalSong[]>([]);
    const localFileBlobsRef = useRef<Map<string, string>>(new Map()); // id -> blob URL

    // Navigation Persistence State (Lifted from Home/LocalMusicView)
    const [homeViewTab, setHomeViewTab] = useState<'playlist' | 'local' | 'albums'>('playlist');
    const [focusedPlaylistIndex, setFocusedPlaylistIndex] = useState(0);
    const [focusedFavoriteAlbumIndex, setFocusedFavoriteAlbumIndex] = useState(0);
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

    // --- Initialization & User Data ---

    useEffect(() => {
        // Initialize History State
        window.history.replaceState({ view: 'home' }, '', '');

        const handlePopState = (event: PopStateEvent) => {
            const state = event.state;
            // If no state or home, go to home root
            if (!state || state.view === 'home') {
                setCurrentView('home');
                setSelectedPlaylist(null);
                setSelectedAlbumId(null);
                setSelectedArtistId(null);
            }
            // If player state
            else if (state.view === 'player') {
                setCurrentView('player');
                setSelectedPlaylist(null);
                setSelectedAlbumId(null);
                setSelectedArtistId(null);
            }
            // If playlist state
            else if (state.view === 'playlist') {
                setCurrentView('home');
                // When going back to playlist, clear upper layers
                setSelectedAlbumId(null);
                setSelectedArtistId(null);

                // If we have an ID (which we should for playlist state), ensure it's selected
                // But typically setSelectedPlaylist is persisted or we rely on it not being cleared if we just popped 'album'
                // However, if we popped 'player', we need to ensure playlist is active.
                if (state.id) {
                    // We need to find the playlist object to set it, but we only have ID here.
                    // The previous logic assumed setSelectedPlaylist(null) happened on home.
                    // Ideally we should refetch or find from cached playlists if needed, 
                    // but for now, we rely on the fact that if we popped back to playlist, 
                    // we likely didn't clear the active playlist state if we came from valid nav.
                    // But if we landed here from fresh load, we might be in trouble. 
                    // App.tsx currently doesn't fully support deep linking restoration for playlists without the object.
                    // For this bugfix (flash), we focus on NOT clearing things when going deeper.
                    // When going BACK to playlist, we just ensure overlay layers are gone.
                }
            }
            // If album state
            else if (state.view === 'album') {
                if (state.id) {
                    setSelectedAlbumId(state.id);
                    setCurrentView('home');
                    // Keep selectedPlaylist if it exists (background)
                    setSelectedArtistId(null); // Clear top layer
                } else {
                    setCurrentView('home');
                    setSelectedAlbumId(null);
                }
            }
            // If artist state
            else if (state.view === 'artist') {
                if (state.id) {
                    setSelectedArtistId(state.id);
                    setCurrentView('home');
                    // Keep album and playlist (background layers)
                } else {
                    setCurrentView('home');
                    setSelectedArtistId(null);
                }
            }
        };


        window.addEventListener('popstate', handlePopState);

        loadUserData();
        restoreSession();
        loadLocalSongs();

        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, []);

    // Helper for Navigation
    const navigateToPlayer = () => {
        if (currentView !== 'player') {
            window.history.pushState({ view: 'player' }, '', '#player');
            setCurrentView('player');
        }
    };

    const navigateToHome = () => {
        if (currentView !== 'home' || selectedPlaylist || selectedAlbumId) {
            // If we have history, back() is better to keep stack clean. 
            // But we can't always know.
            // Simple strategy: Push home if not there? No, builds stack.
            // Back is best if we know we pushed.
            window.history.back();
        }
    };

    const handlePlaylistSelect = (pl: NeteasePlaylist | null) => {
        if (pl) {
            window.history.pushState({ view: 'playlist', id: pl.id }, '', `#playlist/${pl.id}`);
            setSelectedPlaylist(pl);
            setSelectedAlbumId(null);
            setSelectedArtistId(null);
            setCurrentView('home');
        } else {
            // Go back
            window.history.back();
        }
    };

    const handleAlbumSelect = (id: number | null) => {
        if (id) {
            window.history.pushState({ view: 'album', id: id }, '', `#album/${id}`);
            setSelectedAlbumId(id);
            // Don't clear playlist - keep it as background
            // setSelectedPlaylist(null); 
            setSelectedArtistId(null);
            setCurrentView('home');
        } else {
            window.history.back();
        }
    };

    const handleArtistSelect = (id: number | null) => {
        if (id) {
            window.history.pushState({ view: 'artist', id: id }, '', `#artist/${id}`);
            setSelectedArtistId(id);
            // Don't clear album or playlist - keep them as background layers
            // setSelectedAlbumId(null);
            // setSelectedPlaylist(null);
            setCurrentView('home');
        } else {
            window.history.back();
        }
    };

    // Revoke blob URLs on unmount to prevent leaks
    useEffect(() => {
        return () => {
            if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        };
    }, []);

    useEffect(() => {
        if (isPanelOpen && panelTab === 'account') {
            updateCacheSize();
        }
    }, [isPanelOpen, panelTab]);

    const updateCacheSize = async () => {
        const size = await getCacheUsage();
        setCacheSize(formatBytes(size));
    };

    const handleClearCache = async () => {
        // Clear media cache only (audio/images/themes/lyrics)
        // Preserve user session data and playlist data
        const preserveKeys = ['user_profile', 'user_playlists', 'user_liked_songs', 'last_song', 'last_queue', 'last_theme'];

        // We need to preserve all keys starting with 'playlist_tracks_' or 'playlist_detail_'
        // Since clearCache accepts a preserve list, we need to get all cache keys from metadata_cache
        try {
            const db = await openDB();
            const tx = db.transaction(['metadata_cache'], 'readonly');
            const store = tx.objectStore('metadata_cache');
            const allKeys = await new Promise<string[]>((resolve, reject) => {
                const request = store.getAllKeys();
                request.onsuccess = () => resolve(request.result as string[]);
                request.onerror = () => reject(request.error);
            });

            // Filter keys to preserve: keep playlist data
            const playlistKeys = allKeys.filter(key =>
                key.startsWith('playlist_tracks_') || key.startsWith('playlist_detail_')
            );

            const finalPreserveKeys = [...preserveKeys, ...playlistKeys];
            await clearCache(finalPreserveKeys);
            updateCacheSize();
            setStatusMsg({ type: 'success', text: t('status.cacheCleared') });
        } catch (e) {
            console.error('Failed to clear cache:', e);
            setStatusMsg({ type: 'error', text: t('status.cacheCleared') });
        }
    };

    const loadUserData = async () => {
        const cachedUser = await getFromCache<NeteaseUser>('user_profile');
        const cachedPlaylists = await getFromCache<NeteasePlaylist[]>('user_playlists');
        const cachedLikedSongs = await getFromCache<number[]>('user_liked_songs');

        if (cachedUser) {
            setUser(cachedUser);
            if (cachedPlaylists) {
                setPlaylists(cachedPlaylists);
            } else {
                refreshUserData(cachedUser.userId);
            }

            if (cachedLikedSongs) {
                setLikedSongIds(new Set(cachedLikedSongs));
            }
        } else {
            refreshUserData();
        }
    };

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

                // Try to restore theme
                const cachedTheme = await getFromCache<Theme>(`theme_${lastSong.id}`);
                if (cachedTheme) {
                    setTheme(cachedTheme);
                    setAiTheme(cachedTheme); // Also store as aiTheme for bg mode switching
                    setBgMode('ai');
                } else {
                    // Try to restore last used AI theme
                    const lastTheme = await getFromCache<Theme>('last_theme');
                    if (lastTheme) {
                        console.log("[restoreSession] Using last_theme fallback");
                        setTheme({
                            ...lastTheme,
                            wordColors: [],
                            lyricsIcons: []
                        });
                        setAiTheme(lastTheme); // Store original AI theme
                        setBgMode('ai');
                    } else {
                        console.log("[restoreSession] No cached theme, resetting to default");
                        setTheme(prev => ({
                            ...prev,
                            wordColors: [],
                            lyricsIcons: []
                        }));
                        setBgMode('default');
                    }
                }

                // Try to restore cover
                const cachedCover = await getFromCache<Blob>(`cover_${lastSong.id}`);
                if (cachedCover) {
                    setCachedCoverUrl(URL.createObjectURL(cachedCover));
                } else {
                    setCachedCoverUrl(null);
                }

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

                                // Also restore local lyrics if available
                                if (songToRestore.hasLocalLyrics && songToRestore.localLyricsContent) {
                                    const localLyrics = parseLRC(
                                        songToRestore.localLyricsContent,
                                        songToRestore.localTranslationLyricsContent || ''
                                    );
                                    setLyrics(localLyrics);
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

    const refreshUserData = async (uid?: number) => {
        try {
            const res = await neteaseApi.getLoginStatus();
            if (res.data && res.data.profile) {
                const profile = res.data.profile;
                setUser(profile);
                await saveToCache('user_profile', profile);
                if (res.cookie) localStorage.setItem('netease_cookie', res.cookie);

                const targetUid = uid || profile.userId;
                const allPlaylists = await getAllUserPlaylists(targetUid);
                if (allPlaylists.length > 0) {
                    setPlaylists(allPlaylists);
                    await saveToCache('user_playlists', allPlaylists);
                }

                // Fetch Liked Songs List
                try {
                    const likeRes = await neteaseApi.getLikedSongs(targetUid);
                    if (likeRes.ids) {
                        setLikedSongIds(new Set(likeRes.ids));
                        await saveToCache('user_liked_songs', likeRes.ids);
                    }
                } catch (e) {
                    console.warn("Failed to fetch liked songs", e);
                }

                return true;
            }
        } catch (e) {
            console.log("Not logged in or offline");
        }
        return false;
    };

    const checkAndUpdatePlaylists = useCallback(async () => {
        if (!user) return;

        try {
            // 获取最新的歌单列表（获取所有分页）
            const newPlaylists = await getAllUserPlaylists(user.userId);
            if (!newPlaylists || newPlaylists.length === 0) return;

            // 从缓存中获取旧的歌单列表
            const cachedPlaylists = await getFromCache<NeteasePlaylist[]>('user_playlists');

            if (!cachedPlaylists) {
                // 如果没有缓存，直接保存新的歌单列表
                setPlaylists(newPlaylists);
                await saveToCache('user_playlists', newPlaylists);
                return;
            }

            // 创建旧歌单的映射表，以 id 为 key
            const cachedMap = new Map<number, NeteasePlaylist>();
            cachedPlaylists.forEach(pl => {
                cachedMap.set(pl.id, pl);
            });

            // 检查每个新歌单是否有变化
            const changedPlaylistIds: number[] = [];
            let likedSongsPlaylistChanged = false; // 标记"喜欢的音乐"歌单是否有变化

            newPlaylists.forEach((newPl, index) => {
                const oldPl = cachedMap.get(newPl.id);
                const isLikedSongsPlaylist = index === 0; // 第一个歌单是"喜欢的音乐"

                if (!oldPl) {
                    // 新歌单，标记为需要更新
                    changedPlaylistIds.push(newPl.id);
                    if (isLikedSongsPlaylist) {
                        likedSongsPlaylistChanged = true;
                    }
                } else {
                    // 检查 trackUpdateTime 和 updateTime 是否有变化
                    const trackTimeChanged = (newPl.trackUpdateTime || 0) !== (oldPl.trackUpdateTime || 0);
                    const updateTimeChanged = (newPl.updateTime || 0) !== (oldPl.updateTime || 0);

                    if (trackTimeChanged || updateTimeChanged) {
                        console.log(`[PlaylistSync] Playlist ${newPl.name} (ID: ${newPl.id}) changed. Reason:`, {
                            trackTimeChanged,
                            updateTimeChanged,
                            oldTrackTime: oldPl.trackUpdateTime,
                            newTrackTime: newPl.trackUpdateTime,
                            oldUpdateTime: oldPl.updateTime,
                            newUpdateTime: newPl.updateTime
                        });
                        changedPlaylistIds.push(newPl.id);
                        if (isLikedSongsPlaylist) {
                            likedSongsPlaylistChanged = true;
                        }
                    }
                }
            });

            // 检查是否有删除的歌单（在旧列表中但不在新列表中）
            const newPlaylistIds = new Set(newPlaylists.map(pl => pl.id));
            cachedPlaylists.forEach(oldPl => {
                if (!newPlaylistIds.has(oldPl.id)) {
                    // 歌单已删除，清除其缓存
                    changedPlaylistIds.push(oldPl.id);
                }
            });

            // 清除有变化的歌单的缓存
            if (changedPlaylistIds.length > 0) {
                console.log(`[PlaylistSync] 发现 ${changedPlaylistIds.length} 个歌单有变化，清除缓存:`, changedPlaylistIds);

                try {
                    const db = await openDB();
                    const tx = db.transaction(['metadata_cache'], 'readwrite');
                    const store = tx.objectStore('metadata_cache');

                    // 批量删除有变化的歌单缓存
                    const deletePromises = changedPlaylistIds.flatMap(playlistId => [
                        new Promise<void>((resolve, reject) => {
                            const req = store.delete(`playlist_tracks_${playlistId}`);
                            req.onsuccess = () => resolve();
                            req.onerror = () => reject(req.error);
                        }),
                        new Promise<void>((resolve, reject) => {
                            const req = store.delete(`playlist_detail_${playlistId}`);
                            req.onsuccess = () => resolve();
                            req.onerror = () => reject(req.error);
                        })
                    ]);

                    await Promise.all(deletePromises);
                    console.log(`[PlaylistSync] 已清除 ${changedPlaylistIds.length} 个歌单的缓存`);
                } catch (e) {
                    console.error("[PlaylistSync] 清除缓存失败", e);
                }
            }

            // 更新歌单列表缓存和状态
            setPlaylists(newPlaylists);
            await saveToCache('user_playlists', newPlaylists);

            // 如果"喜欢的音乐"歌单有变化，重新获取喜欢的歌曲列表
            if (likedSongsPlaylistChanged && newPlaylists.length > 0) {
                try {
                    console.log("[PlaylistSync] 检测到喜欢的音乐歌单更新，重新获取喜欢的歌曲列表");
                    const likeRes = await neteaseApi.getLikedSongs(user.userId);
                    if (likeRes.ids) {
                        setLikedSongIds(new Set(likeRes.ids));
                        await saveToCache('user_liked_songs', likeRes.ids);
                        console.log("[PlaylistSync] 已更新喜欢的歌曲列表，共", likeRes.ids.length, "首");
                    }
                } catch (e) {
                    console.warn("[PlaylistSync] 重新获取喜欢的歌曲列表失败", e);
                }
            }

        } catch (e) {
            console.error("[PlaylistSync] 检查歌单更新失败", e);
        }
    }, [user]);

    // 在返回主页时检查并更新歌单缓存
    const lastCheckTimeRef = useRef<number>(0);
    useEffect(() => {
        if (currentView === 'home' && user && !selectedPlaylist && !selectedAlbumId && !selectedArtistId) {
            // 防抖：至少间隔 10 秒才检查一次
            const now = Date.now();
            if (now - lastCheckTimeRef.current > 10000) {
                lastCheckTimeRef.current = now;
                checkAndUpdatePlaylists();
            }
        }
    }, [currentView, user, selectedPlaylist, selectedAlbumId, checkAndUpdatePlaylists]);

    const handleSyncData = async () => {
        if (!user) return;
        setIsSyncing(true);
        try {
            await refreshUserData(user.userId);
            // Optional: Clear playlist tracks cache to force refresh on view?
            // For now, we just refresh the playlist list.
            updateCacheSize();
            setStatusMsg({ type: 'success', text: t('status.dataSynced') });
        } catch (e) {
            setStatusMsg({ type: 'error', text: t('status.syncFailed') });
        } finally {
            setIsSyncing(false);
        }
    };

    const handleLogout = async () => {
        localStorage.removeItem('netease_cookie');
        await clearCache();
        setUser(null);
        setPlaylists([]);
        setStatusMsg({ type: 'info', text: t('status.loggedOut') });
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
        const needsLyricsMatch = !localSong.hasLocalLyrics && !localSong.matchedLyrics;
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

    // Helper function to generate consistent ID from LocalSong
    const getLocalSongId = (localSong: LocalSong): number => {
        // Extract numeric part from LocalSong.id (format: local_timestamp_random)
        // This ensures deterministic ID generation based on the original LocalSong.id
        const numericPart = parseInt(localSong.id.replace(/\D/g, ''));
        if (!isNaN(numericPart) && numericPart > 0) {
            return -Math.abs(numericPart);
        }
        // Fallback: use a hash of the ID string for deterministic ID
        // This ensures same LocalSong.id always produces same numeric ID
        let hash = 0;
        for (let i = 0; i < localSong.id.length; i++) {
            const char = localSong.id.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return -Math.abs(Math.abs(hash));
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

        // Use updated data, prioritizing embedded metadata and local lyrics
        const coverUrl = embeddedCoverUrl || updatedLocalSong.matchedCoverUrl || null;
        const matchedSong = matchedSongResult;

        // Prioritize local lyrics over online matched lyrics
        let lyrics: LyricData | null = null;
        if (updatedLocalSong.hasLocalLyrics && updatedLocalSong.localLyricsContent) {
            // Parse local LRC file content
            lyrics = parseLRC(
                updatedLocalSong.localLyricsContent,
                updatedLocalSong.localTranslationLyricsContent || ''
            );
            console.log('[App] Using local lyrics file');
        } else if (updatedLocalSong.matchedLyrics) {
            lyrics = updatedLocalSong.matchedLyrics;
            console.log('[App] Using online matched lyrics');
        }

        // Convert LocalSong to SongResult-like format for playback
        // Use a negative ID to distinguish local songs from cloud songs
        const localSongId = getLocalSongId(updatedLocalSong);

        // Determine metadata to display
        const displayTitle = updatedLocalSong.embeddedTitle || updatedLocalSong.title || updatedLocalSong.fileName;
        const displayArtist = updatedLocalSong.embeddedArtist || updatedLocalSong.artist;
        const displayAlbum = updatedLocalSong.embeddedAlbum || updatedLocalSong.album;

        const unifiedSong: SongResult = {
            id: localSongId,
            name: displayTitle,
            artists: displayArtist ? [{ id: 0, name: displayArtist }] : [],
            album: displayAlbum ? { id: 0, name: displayAlbum } : { id: 0, name: '' },
            duration: updatedLocalSong.duration,
            ar: displayArtist ? [{ id: 0, name: displayArtist }] : [],
            al: displayAlbum ? {
                id: 0,
                name: displayAlbum,
                picUrl: coverUrl || undefined
            } : coverUrl ? {
                id: 0,
                name: '',
                picUrl: coverUrl
            } : undefined,
            dt: updatedLocalSong.duration,
            isLocal: true,
            localData: updatedLocalSong
        } as UnifiedSong;

        // If we have matched song info, ONLY overwrite if we DON'T have embedded metadata
        // EXCEPT for lyrics, which we always want (handled above)
        if (matchedSong) {
            // Only use online name if we don't have embedded title AND don't have filename-parsed title (unlikely, but safe)
            // Actually, the requirement is: "prioritize embedded... if exists... otherwise use online"
            // But we also have filename parsed title. 
            // Logic: Embedded > Online > Filename? Or Embedded > Filename?
            // User said: "if exists these info (embedded), prefer use these info... instead of online info"

            // So:
            // Title: Embedded -> Matched -> Filename
            // Artist: Embedded -> Matched -> Filename
            // Album: Embedded -> Matched -> Filename
            // Cover: Embedded -> Matched

            if (!updatedLocalSong.embeddedTitle) {
                unifiedSong.name = matchedSong.name;
            }

            if (!updatedLocalSong.embeddedArtist) {
                unifiedSong.artists = matchedSong.artists || matchedSong.ar || unifiedSong.artists;
                unifiedSong.ar = matchedSong.ar || unifiedSong.ar;
            }

            if (!updatedLocalSong.embeddedAlbum) {
                unifiedSong.album = matchedSong.album || (matchedSong.al ? {
                    id: matchedSong.al.id,
                    name: matchedSong.al.name,
                    picUrl: matchedSong.al.picUrl
                } : unifiedSong.album);
                unifiedSong.al = matchedSong.al || unifiedSong.al;
            }

            // For cover, we already handled priority in `coverUrl` variable:
            // embeddedCoverUrl || updatedLocalSong.matchedCoverUrl
            // So just ensure unifiedSong uses `coverUrl` which is already correct.
            // However, we need to update the `al` or `album` object if we created it from matched song but want to override picture

            if (embeddedCoverUrl) {
                // If we used matched album info, we need to inject our local cover
                if (unifiedSong.album) unifiedSong.album.picUrl = embeddedCoverUrl;
                if (unifiedSong.al) unifiedSong.al.picUrl = embeddedCoverUrl;
            }
        }

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
        if (coverUrl) {
            try {
                const cachedCover = await getFromCache<Blob>(`cover_local_${updatedLocalSong.id}`);
                if (cachedCover) {
                    setCachedCoverUrl(URL.createObjectURL(cachedCover));
                } else {
                    // Fetch and cache cover
                    const response = await fetch(coverUrl, { mode: 'cors' });
                    const coverBlob = await response.blob();
                    await saveToCache(`cover_local_${updatedLocalSong.id}`, coverBlob);
                    setCachedCoverUrl(URL.createObjectURL(coverBlob));
                }
            } catch (e) {
                console.warn('Failed to cache cover:', e);
                setCachedCoverUrl(coverUrl);
            }
        } else {
            setCachedCoverUrl(null);
        }
        setAudioSrc(blobUrl);
        setIsLyricsLoading(false);

        // Set queue
        if (queue.length > 0) {
            // Convert entire queue using the same ID generation function
            const convertedQueue = queue.map(s => {
                // Use the same ID generation logic as current song
                const sId = getLocalSongId(s);
                // Basic conversion, we might miss matched metadata for others if not loaded, 
                // but usually we just need basic info for the queue list.
                // Ideally we should have matched info for all.
                // For now, use what we have.
                return {
                    id: sId,
                    name: s.title || s.fileName,
                    artists: s.artist ? [{ id: 0, name: s.artist }] : [],
                    album: s.album ? { id: 0, name: s.album } : { id: 0, name: '' },
                    duration: s.duration,
                    ar: s.artist ? [{ id: 0, name: s.artist }] : [],
                    al: s.album ? { id: 0, name: s.album, picUrl: s.matchedCoverUrl } : undefined,
                    dt: s.duration,
                    isLocal: true,
                    localData: s
                } as UnifiedSong;
            });

            // Ensure the current playing song has the CORRECT ID in the queue
            // Since we now use the same ID generation function, IDs should match correctly.
            // But we still check by ID first, then fallback to name+duration for safety.
            const finalQueue = convertedQueue.map(s => {
                // Match by ID first (most reliable)
                if (s.id === unifiedSong.id) {
                    return unifiedSong;
                }
                // Fallback: match by name and duration (for edge cases)
                if (s.name === unifiedSong.name && s.duration === unifiedSong.duration) {
                    return unifiedSong;
                }
                return s;
            });

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

            const source = ctx.createMediaElementSource(audioRef.current);
            source.connect(analyser);
            analyser.connect(ctx.destination);
            sourceRef.current = source;
        } catch (e) {
            console.error("Audio Context Setup Failed:", e);
        }
    };

    const playSong = async (song: SongResult, queue: SongResult[] = []) => {
        console.log("[App] playSong initiated:", song.name, song.id);

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
                        // Try cache first
                        try {
                            const cachedCover = await getFromCache<Blob>(`cover_local_${currentLocalData.id}`);
                            if (cachedCover) {
                                setCachedCoverUrl(URL.createObjectURL(cachedCover));
                            } else {
                                // Fetch and cache cover
                                const response = await fetch(currentLocalData.matchedCoverUrl, { mode: 'cors' });
                                const coverBlob = await response.blob();
                                await saveToCache(`cover_local_${currentLocalData.id}`, coverBlob);
                                setCachedCoverUrl(URL.createObjectURL(coverBlob));
                            }
                        } catch {
                            setCachedCoverUrl(currentLocalData.matchedCoverUrl);
                        }
                    } else {
                        setCachedCoverUrl(null);
                    }

                    // Lyrics
                    if (currentLocalData.hasLocalLyrics && currentLocalData.localLyricsContent) {
                        // Parse local existing lyrics
                        const parsed = parseLRC(currentLocalData.localLyricsContent, currentLocalData.localTranslationLyricsContent || "");
                        setLyrics(parsed);
                    } else if (currentLocalData.matchedLyrics) {
                        setLyrics(currentLocalData.matchedLyrics);
                    } else {
                        setLyrics(null);
                    }
                }

                setIsLyricsLoading(false);

                // Theme
                try {
                    const cachedTheme = await getFromCache<Theme>(`theme_${song.id}`);
                    if (cachedTheme) {
                        setTheme(cachedTheme);
                        setBgMode('ai');
                    } else {
                        // Default theme for local songs if no AI theme generated yet
                        setTheme(prev => ({
                            ...prev,
                            wordColors: [],
                            lyricsIcons: []
                        }));
                    }
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

        // 2. Load Cached Cover (Visual Feedback)
        const cachedCoverBlob = await getFromCache<Blob>(`cover_${song.id}`);
        if (cachedCoverBlob) {
            setCachedCoverUrl(URL.createObjectURL(cachedCoverBlob));
        }

        // 3. Audio Loading (Cache vs Network)
        let audioBlobUrl: string | null = null;
        try {
            // Check Audio Cache
            const cachedAudioBlob = await getFromCache<Blob>(`audio_${song.id}`);
            if (cachedAudioBlob) {
                console.log("[App] Playing from Cache");
                audioBlobUrl = URL.createObjectURL(cachedAudioBlob);
                blobUrlRef.current = audioBlobUrl;
                setAudioSrc(audioBlobUrl);
            } else {
                // Fetch URL from API
                const urlRes = await neteaseApi.getSongUrl(song.id, audioQuality);
                let url = urlRes.data?.[0]?.url;
                if (!url) {
                    console.warn("[App] Song URL is empty, likely unavailable");
                    setStatusMsg({ type: 'error', text: t('status.songUnavailable') });
                    setPlayerState(PlayerState.IDLE);
                    setIsLyricsLoading(false); // Stop loading if failed
                    return;
                }
                if (url && url.startsWith('http:')) {
                    url = url.replace('http:', 'https:');
                }
                setAudioSrc(url);
                // NOTE: We don't cache immediately. We cache when the song FINISHES playing.
            }
        } catch (e) {
            console.error("[App] Failed to fetch song URL:", e);
            setStatusMsg({ type: 'error', text: t('status.playbackError') });
            setIsLyricsLoading(false); // Stop loading if failed
            return;
        }

        // 4. Fetch Lyrics (Cache vs Network)
        try {
            const cachedLyrics = await getFromCache<LyricData>(`lyric_${song.id}`);
            if (cachedLyrics) {
                setLyrics(cachedLyrics);
                setIsLyricsLoading(false); // Cached lyrics ready immediately
            } else {
                const lyricRes = await neteaseApi.getLyric(song.id);
                const mainLrc = lyricRes.lrc?.lyric;
                const yrcLrc = lyricRes.yrc?.lyric || lyricRes.lrc?.yrc?.lyric;
                const ytlrc = lyricRes.ytlrc?.lyric || lyricRes.lrc?.ytlrc?.lyric;
                const tlyric = lyricRes.tlyric?.lyric || "";

                const transLrc = (yrcLrc && ytlrc) ? ytlrc : tlyric;

                let parsedLyrics = null;
                if (yrcLrc) {
                    parsedLyrics = parseYRC(yrcLrc, transLrc);
                } else if (mainLrc) {
                    parsedLyrics = parseLRC(mainLrc, transLrc);
                }

                if (parsedLyrics) {
                    // 1. Render immediately without chorus info to unblock UI
                    // But keep isLyricsLoading TRUE until chorus is done
                    setLyrics(parsedLyrics);

                    // 2. Schedule Chorus Detection
                    // Check pureMusic flag from API (it might be on lrc object or root)
                    const isPureMusic = lyricRes.pureMusic || lyricRes.lrc?.pureMusic;

                    if (!isPureMusic && mainLrc) {
                        const runChorusDetection = () => {
                            // Check if song changed while waiting
                            if (currentSongRef.current !== song.id) return;

                            try {
                                const chorusLines = detectChorusLines(mainLrc);
                                if (chorusLines.size > 0) {
                                    // Assign a stable random effect for each unique chorus line text
                                    const effectMap = new Map<string, 'bars' | 'circles' | 'beams'>();
                                    const effects: ('bars' | 'circles' | 'beams')[] = ['bars', 'circles', 'beams'];

                                    chorusLines.forEach(text => {
                                        const randomEffect = effects[Math.floor(Math.random() * effects.length)];
                                        effectMap.set(text, randomEffect);
                                    });

                                    // Clone and update lines
                                    // @ts-ignore
                                    const newLines = parsedLyrics.lines.map(line => {
                                        const text = line.fullText.trim();
                                        if (chorusLines.has(text)) {
                                            return {
                                                ...line,
                                                isChorus: true,
                                                chorusEffect: effectMap.get(text)
                                            };
                                        }
                                        return line;
                                    });

                                    // @ts-ignore
                                    const updatedLyrics = { ...parsedLyrics, lines: newLines };
                                    setLyrics(updatedLyrics);
                                    saveToCache(`lyric_${song.id}`, updatedLyrics);
                                } else {
                                    // No chorus found, but cache the lyrics anyway
                                    saveToCache(`lyric_${song.id}`, parsedLyrics);
                                }
                            } catch (err) {
                                console.warn("[App] Chorus detection failed", err);
                                // Ensure we cache even if detection fails
                                saveToCache(`lyric_${song.id}`, parsedLyrics);
                            } finally {
                                setIsLyricsLoading(false); // Done loading
                            }
                        };

                        // Use setTimeout(0) for immediate async execution to unblock main thread
                        // but prioritize it over idle callback for faster playback start
                        setTimeout(runChorusDetection, 0);
                    } else {
                        // Pure music or no lrc, just cache
                        saveToCache(`lyric_${song.id}`, parsedLyrics);
                        setIsLyricsLoading(false); // Done loading
                    }
                } else {
                    setLyrics(null);
                    setIsLyricsLoading(false); // No lyrics found
                }
            }
        } catch (e) {
            console.warn("[App] Lyric fetch failed", e);
            setLyrics(null);
            setIsLyricsLoading(false); // Failed
        }

        // 5. Handle Theme
        try {
            const cachedTheme = await getFromCache<Theme>(`theme_${song.id}`);
            if (cachedTheme) {
                setTheme(cachedTheme);
                setBgMode('ai');
            } else {
                setTheme(prev => ({
                    ...prev,
                    wordColors: [],
                    lyricsIcons: []
                }));
            }
        } catch (e) {
            console.warn("Theme load error", e);
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
        playSong(song, newQueue);
    };

    const handleNextTrack = useCallback(() => {
        if (!currentSong || playQueue.length === 0) return;

        const currentIndex = playQueue.findIndex(s => s.id === currentSong.id);
        let nextIndex = -1;

        if (currentIndex >= 0 && currentIndex < playQueue.length - 1) {
            nextIndex = currentIndex + 1;
        } else if (loopMode === 'all') {
            // Wrap around
            nextIndex = 0;
        }

        if (nextIndex >= 0) {
            playSong(playQueue[nextIndex], playQueue);
        } else {
            setPlayerState(PlayerState.IDLE);
        }
    }, [currentSong, playQueue, loopMode]);

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
            playSong(playQueue[prevIndex], playQueue);
        }
    }, [currentSong, playQueue, loopMode]);

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
        setStatusMsg({ type: 'success', text: t('status.queueShuffled') || 'Queue Shuffled' }); // assuming status key might exist or use fallback
    }, [playQueue, currentSong, t]);

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

    // AI Theme Generation
    const generateAITheme = async () => {
        if (!lyrics || isGeneratingTheme) return;
        setIsGeneratingTheme(true);
        setStatusMsg({ type: 'info', text: t('status.generatingTheme') });
        try {
            const allText = lyrics.lines.map(l => l.fullText).join("\n");

            // Determine preference based on current theme, assuming user wants to stick to similar brightness
            // We use the persistent setting for this preference now
            const themeMode = isDaylight ? 'light' : 'dark';

            const newTheme = await generateThemeFromLyrics(allText, themeMode);
            setTheme(newTheme);
            setAiTheme(newTheme); // Store AI theme for bgMode switching
            setBgMode('ai'); // Auto switch to AI bg when generated
            setStatusMsg({ type: 'success', text: t('status.themeApplied', { themeName: newTheme.name }) });

            // Persist Theme for this song
            if (currentSong) {
                saveToCache(`theme_${currentSong.id}`, newTheme);
            }
            // Save as last used AI theme
            saveToCache('last_theme', newTheme);
        } catch (err) {
            console.error(err);
            setStatusMsg({ type: 'error', text: t('status.themeGenerationFailed') });
        } finally {
            setIsGeneratingTheme(false);
        }
    };

    const handleResetTheme = () => {
        setTheme(isDaylight ? DAYLIGHT_THEME : DEFAULT_THEME);
        setAiTheme(null); // Clear stored AI theme
        setBgMode('default'); // Reset to default mode
    };

    const handleSetThemePreset = (preset: 'midnight' | 'daylight') => {
        const isLight = preset === 'daylight';
        handleToggleDaylight(isLight);
        setStatusMsg({ type: 'success', text: `默认主题: ${isLight ? 'Daylight' : 'Midnight'} Default` });
        // NOTE: We don't force 'ai' mode here anymore, we just switch the default preference.
        // If the user wants to use this as a base for AI, they can generate AI theme afterwards.
    };

    const handleBgModeChange = (mode: 'default' | 'ai') => {
        setBgMode(mode);

        if (mode === 'default') {
            // When switching to default mode, preserve current AI theme if it exists
            const isCurrentThemeAI = theme.name !== DEFAULT_THEME.name && theme.name !== DAYLIGHT_THEME.name;
            if (isCurrentThemeAI && !aiTheme) {
                setAiTheme(theme);
            }
            // Apply default background color only, keep AI text colors
            const baseTheme = isDaylight ? DAYLIGHT_THEME : DEFAULT_THEME;
            const currentAiTheme = aiTheme || (isCurrentThemeAI ? theme : null);
            if (currentAiTheme) {
                setTheme({
                    ...currentAiTheme,
                    backgroundColor: baseTheme.backgroundColor,
                });
            } else {
                setTheme(baseTheme);
            }
        } else {
            // When switching to AI mode, restore the full AI theme
            if (aiTheme) {
                setTheme(aiTheme);
            }
            // If no AI theme stored, keep current theme (which might already be AI)
        }
    };

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

    const handleManualMatchOnline = async () => {
        if (!currentSong || !((currentSong as any).isLocal || currentSong.id < 0)) return;
        const localData = (currentSong as any).localData as LocalSong;
        if (!localData) return;

        setStatusMsg({ type: 'info', text: 'Matching online...' });
        try {
            const { matchLyrics } = await import('./services/localMusicService');
            // Force search
            const matchedLyrics = await matchLyrics(localData);

            if (matchedLyrics) {
                // Determine matched song details? matchLyrics updates localData internally in service?
                // Yes, lines 281-292 in localMusicService.ts updates song and saves it.

                // So we just need to reload
                await loadLocalSongs();
                const updatedList = await getLocalSongs();
                const found = updatedList.find(s => s.id === localData.id);
                if (found) {
                    onPlayLocalSong(found, localSongs);
                    setStatusMsg({ type: 'success', text: 'Match successful' });
                }
            } else {
                setStatusMsg({ type: 'error', text: 'No match found' });
            }
        } catch (e) {
            setStatusMsg({ type: 'error', text: 'Match failed' });
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
                                            }
                                        }
                                    }
                                }
                            }}
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
                            playSong(song, ctx);
                            // We don't need to close AlbumView here explicitly if we rely on currentView check?
                            // But keeping it open in state allows returning to it.
                            // So we don't call handleAlbumSelect(null) here?
                            // Original code called handleAlbumSelect(null) inside onPlaySong prop!
                            // Wait, previous code:
                            /* 
                            onPlaySong={(song, ctx) => {
                                playSong(song, ctx);
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
                            playSong(songs[0], songs);
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
                            playSong(song, ctx);
                            // Keep consistency with AlbumView behavior in original code?
                            // Original code for Artist:
                            /*
                             onPlaySong={(song, ctx) => {
                                playSong(song, ctx);
                                handleArtistSelect(null);
                             }}
                            */
                            // Wait, lookup lines 1965-1970 in original:
                            /*
                             onPlaySong={(song, ctx) => {
                                 playSong(song, ctx);
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
                                // Auto-play when seeking (e.g. from timeline lyric dots)
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
                currentView === 'player' && (
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
                        onGenerateAITheme={generateAITheme}
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
                    />
                )
            }
        </div >
    );
}
