import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Repeat, Repeat1, Settings2, CheckCircle2, AlertCircle, Sparkles, X, ListMusic, User as UserIcon, LogOut, RefreshCw, Disc, SlidersHorizontal, LayoutGrid, Home as HomeIcon, RotateCcw, Trash2, HardDrive, Heart } from 'lucide-react';
import { motion, AnimatePresence, useMotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { parseLRC } from './utils/lrcParser';
import { parseYRC } from './utils/yrcParser';
import { generateThemeFromLyrics } from './services/gemini';
import { saveSessionData, getSessionData, getFromCache, saveToCache, clearCache, getCacheUsage } from './services/db';
import Visualizer from './components/Visualizer';
import ProgressBar from './components/ProgressBar';
import Home from './components/Home';
import AlbumView from './components/AlbumView';
import { LyricData, Theme, PlayerState, SongResult, NeteaseUser, NeteasePlaylist } from './types';
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

    // Queue
    const [playQueue, setPlayQueue] = useState<SongResult[]>([]);

    // UI State
    const [statusMsg, setStatusMsg] = useState<{ type: 'error' | 'success' | 'info', text: string; } | null>(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [panelTab, setPanelTab] = useState<'cover' | 'controls' | 'queue' | 'account'>('cover');
    const [isGeneratingTheme, setIsGeneratingTheme] = useState(false);
    const [isControlsHovered, setIsControlsHovered] = useState(false);
    const [bgMode, setBgMode] = useState<'default' | 'ai'>('ai');
    const [isSyncing, setIsSyncing] = useState(false);
    const [cacheSize, setCacheSize] = useState<string>("0 B");

    // Player State
    const [playerState, setPlayerState] = useState<PlayerState>(PlayerState.IDLE);
    const currentTime = useMotionValue(0);
    const [duration, setDuration] = useState(0);
    const [currentLineIndex, setCurrentLineIndex] = useState(-1);
    const [loopMode, setLoopMode] = useState<'off' | 'all' | 'one'>('off');

    // Progress Bar State
    // Removed isDragging and sliderValue as they are handled by ProgressBar component

    // Audio Analysis State
    const audioPower = useMotionValue(0);

    // Refs
    const audioRef = useRef<HTMLAudioElement>(null);
    const animationFrameRef = useRef<number>(0);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
    const blobUrlRef = useRef<string | null>(null);
    const queueScrollRef = useRef<HTMLDivElement>(null);

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
            }
            // If player state
            else if (state.view === 'player') {
                setCurrentView('player');
                setSelectedPlaylist(null);
                setSelectedAlbumId(null);
            }
            // If playlist state
            else if (state.view === 'playlist') {
                setCurrentView('home');
                // Note: We assume popping back TO playlist isn't common flow from Player,
                // usually it's Home -> Playlist -> Back(Home).
                // If we support deeply nested history, we'd need to restore the specific ID.
                // For now, simpler logic: if we pop to 'playlist', we might need the ID, 
                // but usually we pop FROM playlist TO home.
                setSelectedAlbumId(null); // Ensure album is deselected
            }
            // If album state
            else if (state.view === 'album') {
                setCurrentView('home');
                setSelectedPlaylist(null); // Ensure playlist is deselected
            }
        };

        window.addEventListener('popstate', handlePopState);

        loadUserData();
        restoreSession();

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
            setSelectedAlbumId(null); // Deselect album when selecting playlist
        } else {
            // Go back
            window.history.back();
        }
    };

    const handleAlbumSelect = (id: number) => {
        setSelectedAlbumId(id);
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

        // Auto-scroll to current song in queue
        if (isPanelOpen && panelTab === 'queue' && currentSong) {
            // Small timeout to allow render
            setTimeout(() => {
                const activeEl = queueScrollRef.current?.querySelector('[data-active="true"]');
                if (activeEl) {
                    activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }
            }, 100);
        }
    }, [isPanelOpen, panelTab, currentSong]);

    const updateCacheSize = async () => {
        const size = await getCacheUsage();
        setCacheSize(formatBytes(size));
    };

    const handleClearCache = async () => {
        // Clear media cache only (audio/images/themes/lyrics)
        // Preserve user session data (user_profile, user_playlists, etc)
        const preserveKeys = ['user_profile', 'user_playlists', 'last_song', 'last_queue'];

        const db = await getCacheUsage().then(() => { /* dummy call to ensure db is open if needed, but better to impl logic in db.ts */ });

        // Since we don't have a selective clear in db.ts yet, we iterate and delete manually or add a feature.
        // Let's modify db.ts to support this properly or do a quick implementation here?
        // Actually, let's modify the clearCache function in db.ts or just clear specific keys.
        // The current clearCache clears everything. 

        // Better approach: Clear by prefix or type if possible, but our keys vary (audio_*, cover_*, theme_*, lyric_*).
        // So we should clear everything EXCEPT the preserve list.

        await clearCache(preserveKeys);
        updateCacheSize();
        setStatusMsg({ type: 'success', text: t('status.cacheCleared') });
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
                    // Try cache first for audio
                    const cachedAudio = await getFromCache<Blob>(`audio_${lastSong.id}`);
                    if (cachedAudio) {
                        const blobUrl = URL.createObjectURL(cachedAudio);
                        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
                        blobUrlRef.current = blobUrl;
                        setAudioSrc(blobUrl);
                    } else {
                        const urlRes = await neteaseApi.getSongUrl(lastSong.id);
                        let url = urlRes.data?.[0]?.url;
                        if (url) {
                            if (url.startsWith('http:')) {
                                url = url.replace('http:', 'https:');
                            }
                            setAudioSrc(url);
                        }
                    }

                    // Try cache first for lyrics
                    const cachedLyrics = await getFromCache<LyricData>(`lyric_${lastSong.id}`);
                    if (cachedLyrics) {
                        setLyrics(cachedLyrics);
                    } else {
                        const lyricRes = await neteaseApi.getLyric(lastSong.id);
                        const mainLrc = lyricRes.lrc?.lyric;
                        const yrcLrc = lyricRes.yrc?.lyric || lyricRes.lrc?.yrc?.lyric;
                        const transLrc = lyricRes.tlyric?.lyric || "";

                        let parsed: LyricData | null = null;
                        if (yrcLrc) {
                            parsed = parseYRC(yrcLrc, transLrc);
                        } else if (mainLrc) {
                            parsed = parseLRC(mainLrc, transLrc);
                        }
                        setLyrics(parsed);
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
                const plRes = await neteaseApi.getUserPlaylists(targetUid);
                if (plRes.playlist) {
                    setPlaylists(plRes.playlist);
                    await saveToCache('user_playlists', plRes.playlist);
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

        // 0. Instant UI Feedback
        setLyrics(null);
        setCurrentSong(song);
        setCachedCoverUrl(null);

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
                const urlRes = await neteaseApi.getSongUrl(song.id);
                let url = urlRes.data?.[0]?.url;
                if (!url) throw new Error("No URL found");
                if (url && url.startsWith('http:')) {
                    url = url.replace('http:', 'https:');
                }
                setAudioSrc(url);
                // NOTE: We don't cache immediately. We cache when the song FINISHES playing.
            }
        } catch (e) {
            console.error("[App] Failed to fetch song URL:", e);
            setStatusMsg({ type: 'error', text: t('status.playbackError') });
            return;
        }

        // 4. Fetch Lyrics (Cache vs Network)
        try {
            const cachedLyrics = await getFromCache<LyricData>(`lyric_${song.id}`);
            if (cachedLyrics) {
                setLyrics(cachedLyrics);
            } else {
                const lyricRes = await neteaseApi.getLyric(song.id);
                const mainLrc = lyricRes.lrc?.lyric;
                const yrcLrc = lyricRes.yrc?.lyric || lyricRes.lrc?.yrc?.lyric;
                const transLrc = lyricRes.tlyric?.lyric || "";

                let parsedLyrics = null;
                if (yrcLrc) {
                    parsedLyrics = parseYRC(yrcLrc, transLrc);
                } else if (mainLrc) {
                    parsedLyrics = parseLRC(mainLrc, transLrc);
                }

                if (parsedLyrics) {
                    setLyrics(parsedLyrics);
                    // Cache Lyrics Immediately
                    saveToCache(`lyric_${song.id}`, parsedLyrics);
                } else {
                    setLyrics(null);
                }
            }
        } catch (e) {
            console.warn("[App] Lyric fetch failed", e);
            setLyrics(null);
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
        }
    }, [audioSrc]);

    // Sync Logic & Audio Power
    const updateLoop = useCallback(() => {
        // 1. Audio Power / Visualizer Data
        if (playerState === PlayerState.PLAYING && audioRef.current && !audioRef.current.paused && analyserRef.current) {
            const bufferLength = analyserRef.current.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyserRef.current.getByteFrequencyData(dataArray);

            const startIndex = 2; // ~40Hz
            const endIndex = 8;   // ~160Hz
            let sum = 0;
            for (let i = startIndex; i <= endIndex; i++) {
                sum += dataArray[i];
            }
            const rawAverage = sum / (endIndex - startIndex + 1);
            const normalized = rawAverage / 255;
            const boosted = Math.pow(normalized, 3) * 255;
            audioPower.set(boosted);
        } else {
            // Idle Animation (Breathing effect for PV background)
            const time = Date.now() / 2000;
            const breath = (Math.sin(time) + 1) * 20;
            audioPower.set(breath);
        }

        // 2. Playback Time & Lyrics Sync
        if (playerState === PlayerState.PLAYING && audioRef.current && !audioRef.current.paused) {
            const time = audioRef.current.currentTime;
            currentTime.set(time);

            if (lyrics) {
                let foundIndex = -1;
                if (currentLineIndex !== -1 &&
                    lyrics.lines[currentLineIndex] &&
                    time >= lyrics.lines[currentLineIndex].startTime &&
                    time <= lyrics.lines[currentLineIndex].endTime) {
                    foundIndex = currentLineIndex;
                } else {
                    foundIndex = lyrics.lines.findIndex(l => time >= l.startTime && time <= l.endTime);
                }
                if (foundIndex !== -1 && foundIndex !== currentLineIndex) {
                    setCurrentLineIndex(foundIndex);
                }
            }
        }

        animationFrameRef.current = requestAnimationFrame(updateLoop);
    }, [lyrics, currentLineIndex, audioPower, playerState]);

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
            const newTheme = await generateThemeFromLyrics(allText);
            setTheme(newTheme);
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
        setTheme(DEFAULT_THEME);
        // We don't change bgMode here strictly, but usually default theme implies default BG
        // If the user wants to keep AI text colors but default bg, they use the toggle.
        // If they want to FULLY reset, we reset the theme object.
    };

    const togglePlay = (e?: React.MouseEvent | KeyboardEvent) => {
        e?.stopPropagation();
        if (audioRef.current) {
            if (playerState === PlayerState.PLAYING) {
                audioRef.current.pause();
                setPlayerState(PlayerState.PAUSED);
            } else {
                audioRef.current.play();
                setPlayerState(PlayerState.PLAYING);
            }
        }
    };

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (currentView !== 'player') return;

            // Ignore if typing in an input (though we don't have many inputs yet)
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    togglePlay(e);
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    if (audioRef.current) {
                        audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
                    }
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    if (audioRef.current) {
                        audioRef.current.currentTime = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + 5);
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentView, playerState]);

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

    // Control Bar logic
    const showExpandedControls = isControlsHovered || (playerState !== PlayerState.PLAYING && currentView !== 'home');

    const handlePlayerBarClick = () => {
        if (currentView === 'home') {
            navigateToPlayer();
        }
    };

    const handleLike = async () => {
        if (!currentSong) return;

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

    const handleContainerClick = () => {
        if (isPanelOpen) setIsPanelOpen(false);
    };

    // Define dynamic style for theme variables
    const appStyle = {
        '--bg-color': bgMode === 'ai' ? theme.backgroundColor : DEFAULT_THEME.backgroundColor,
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
                    showText={currentView === 'player'}
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
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* --- ALBUM VIEW (Overlay) --- */}
            <AnimatePresence>
                {selectedAlbumId && (
                    <AlbumView
                        albumId={selectedAlbumId}
                        onBack={() => setSelectedAlbumId(null)}
                        onPlaySong={(song, ctx) => {
                            playSong(song, ctx);
                            setSelectedAlbumId(null);
                        }}
                        onPlayAll={(songs) => {
                            playSong(songs[0], songs);
                            setSelectedAlbumId(null);
                        }}
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
                        className="absolute top-0 left-1/2 z-[70] px-6 py-3 bg-white/10 backdrop-blur-md rounded-full text-white font-medium text-sm shadow-xl flex items-center gap-3 pointer-events-none"
                    >
                        {statusMsg.type === 'error' ? <AlertCircle size={18} className="text-red-400" /> :
                            statusMsg.type === 'success' ? <CheckCircle2 size={18} className="text-green-400" /> :
                                <Sparkles size={18} className="text-blue-400" />}
                        {statusMsg.text}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* --- GLOBAL CONTROLS (Floating Glass Pill) --- */}
            {currentSong && (
                <div
                    className={`absolute bottom-8 left-1/2 -translate-x-1/2 z-[60] w-full flex justify-center transition-all duration-300 pointer-events-none
               ${currentView === 'home' ? 'max-w-[calc(100vw-120px)] md:max-w-lg' : 'max-w-lg px-4'}`}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Wrapper for hover detection - Pointer events auto to capture hover */}
                    <div
                        className="pointer-events-auto w-full flex justify-center"
                        onMouseEnter={() => setIsControlsHovered(true)}
                        onMouseLeave={() => setIsControlsHovered(false)}
                    >
                        <motion.div
                            layout
                            onClick={handlePlayerBarClick}
                            className={`backdrop-blur-3xl shadow-2xl overflow-hidden cursor-pointer rounded-full relative transition-colors duration-300
                        ${showExpandedControls ? 'p-3 bg-black/40 w-full' : 'px-4 py-2 bg-black/20 hover:bg-black/30 w-[80%] md:w-[60%]'}`}
                        >
                            <motion.div layout className="w-full">
                                {showExpandedControls ? (
                                    <div className="flex items-center gap-4 w-full">
                                        <button
                                            onClick={togglePlay}
                                            disabled={!audioSrc}
                                            className="w-12 h-12 rounded-full bg-[var(--text-primary)] text-black flex items-center justify-center hover:scale-105 transition-transform shrink-0 shadow-lg border-none"
                                            style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
                                        >
                                            {playerState === PlayerState.PLAYING ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
                                        </button>

                                        <div className="flex-1 flex flex-col justify-center gap-2 min-w-0 px-2">
                                            {/* Title Row */}
                                            <div className="text-center text-sm font-bold truncate px-2" style={{ color: 'var(--text-primary)' }}>
                                                {currentSong?.name || t('ui.noTrack')}
                                            </div>

                                            {/* Time & Bar Row */}
                                            <div className="w-full px-2">
                                                <ProgressBar
                                                    currentTime={currentTime}
                                                    duration={duration}
                                                    onSeek={(time) => {
                                                        if (audioRef.current) audioRef.current.currentTime = time;
                                                    }}
                                                    primaryColor="var(--text-primary)"
                                                    secondaryColor="var(--text-secondary)"
                                                />
                                            </div>
                                        </div>

                                        <button
                                            onClick={toggleLoop}
                                            className={`p-2 rounded-full transition-colors ${loopMode !== 'off' ? 'bg-white/20' : 'opacity-40 hover:opacity-100'}`}
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            {loopMode === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
                                        </button>
                                    </div>
                                ) : (
                                    // Collapsed View
                                    // Collapsed View
                                    <div className="flex items-center w-full justify-center h-8 px-4">
                                        <ProgressBar
                                            currentTime={currentTime}
                                            duration={duration}
                                            onSeek={(time) => {
                                                if (audioRef.current) audioRef.current.currentTime = time;
                                            }}
                                            primaryColor="var(--text-primary)"
                                            secondaryColor="var(--text-secondary)"
                                        />
                                    </div>
                                )}
                            </motion.div>
                        </motion.div>
                    </div>
                </div>
            )}

            {/* --- UNIFIED PANEL (Player View Only) --- */}
            {currentView === 'player' && (
                <div
                    className="absolute bottom-8 right-0 z-[60] flex flex-col items-end gap-4 pointer-events-none"
                    onClick={(e) => e.stopPropagation()} // Prevent closing when clicking on the panel wrapper
                >
                    <div className="pointer-events-auto pr-4 md:pr-8 pb-16 md:pb-0">
                        <AnimatePresence>
                            {isPanelOpen && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.9, originY: 1, originX: 1 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    className="w-80 bg-black/40 backdrop-blur-3xl rounded-3xl shadow-2xl flex flex-col mb-2 overflow-hidden"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    <div className="p-5 flex flex-col h-full">
                                        {/* Top: Cover Art (Fixed at top as requested) */}
                                        <div
                                            onClick={() => {
                                                setIsPanelOpen(false);
                                                navigateToHome();
                                            }}
                                            className="w-full aspect-square rounded-2xl overflow-hidden shadow-lg relative mb-4 bg-zinc-900 flex items-center justify-center group cursor-pointer"
                                        >
                                            {coverUrl ? (
                                                <img src={coverUrl} alt="Art" className="w-full h-full object-cover" />
                                            ) : (
                                                <Disc size={40} className="text-white/20" />
                                            )}
                                            {/* Overlay to switch visual */}
                                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-[2px]">
                                                <HomeIcon className="text-white" size={32} />
                                            </div>
                                        </div>

                                        {/* Tab Switcher (Below Cover) */}
                                        <div className="flex bg-white/5 p-1 rounded-xl mb-4">
                                            {[
                                                { id: 'cover', label: t('panel.cover'), icon: Disc },
                                                { id: 'controls', label: t('panel.controls'), icon: SlidersHorizontal },
                                                { id: 'queue', label: t('panel.playlist'), icon: ListMusic },
                                                { id: 'account', label: t('panel.account'), icon: UserIcon }
                                            ].map((tab) => (
                                                <button
                                                    key={tab.id}
                                                    onClick={() => setPanelTab(tab.id as any)}
                                                    className={`flex-1 py-2 flex items-center justify-center transition-all rounded-lg
                                            ${panelTab === tab.id ? 'bg-white/10 shadow-sm' : 'opacity-40 hover:opacity-100'}`}
                                                    title={tab.label}
                                                    style={{ color: 'var(--text-primary)' }}
                                                >
                                                    <tab.icon size={16} />
                                                </button>
                                            ))}
                                        </div>

                                        {/* Tab Content */}
                                        <div className={`flex-1 overflow-hidden ${panelTab === 'cover' ? '' : 'min-h-[120px]'}`} style={{ color: 'var(--text-primary)' }}>
                                            {/* --- COVER TAB --- */}
                                            {panelTab === 'cover' && (
                                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center text-center space-y-4 mt-4">
                                                    <div className="space-y-1">
                                                        <h2 className="text-2xl font-bold line-clamp-2">{currentSong?.name || t('ui.noTrack')}</h2>
                                                        <div className="text-sm opacity-60 space-y-1">
                                                            <div className="font-medium">{currentSong?.ar?.map(a => a.name).join(', ')}</div>
                                                            <div
                                                                className="opacity-60 cursor-pointer hover:opacity-100 hover:underline transition-all"
                                                                onClick={() => {
                                                                    if (currentSong?.al?.id || currentSong?.album?.id) {
                                                                        handleAlbumSelect(currentSong?.al?.id || currentSong?.album?.id);
                                                                        setIsPanelOpen(false);
                                                                    }
                                                                }}
                                                            >
                                                                {currentSong?.al?.name || currentSong?.album?.name}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            )}
                                            {/* --- PLAYBACK CONTROLS TAB --- */}
                                            {panelTab === 'controls' && (
                                                <motion.div
                                                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                                                    className="space-y-4"
                                                >
                                                    {/* Action Buttons: Loop, Like, AI (Compact) */}
                                                    <div className="grid grid-cols-3 gap-3">
                                                        <button
                                                            onClick={toggleLoop}
                                                            className={`h-12 rounded-xl flex items-center justify-center transition-colors
                                                    ${loopMode !== 'off' ? 'bg-white text-black' : 'bg-white/5 hover:bg-white/10'}`}
                                                        >
                                                            {loopMode === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
                                                        </button>

                                                        <button
                                                            onClick={handleLike}
                                                            className={`h-12 rounded-xl flex items-center justify-center transition-colors
                                                    ${currentSong && likedSongIds.has(currentSong.id) ? 'bg-red-500/20 text-red-500' : 'bg-white/5 hover:bg-white/10'}`}
                                                        >
                                                            <Heart size={20} fill={currentSong && likedSongIds.has(currentSong.id) ? "currentColor" : "none"} />
                                                        </button>

                                                        <button
                                                            onClick={generateAITheme}
                                                            disabled={isGeneratingTheme || !lyrics}
                                                            className={`h-12 rounded-xl flex items-center justify-center transition-colors
                                                    ${isGeneratingTheme ? 'bg-blue-500/20 text-blue-300' : 'bg-white/5 hover:bg-white/10'}`}
                                                        >
                                                            <Sparkles size={20} className={isGeneratingTheme ? "animate-pulse" : ""} />
                                                        </button>
                                                    </div>

                                                    {/* Appearance Intensity */}
                                                    <div className="pt-2 border-t border-white/5">
                                                        <label className="text-[10px] font-bold opacity-40 uppercase tracking-widest block mb-2">{t('ui.animationIntensity')}</label>
                                                        <div className="flex bg-black/20 p-1 rounded-xl mb-3">
                                                            {['calm', 'normal', 'chaotic'].map((mode) => (
                                                                <button
                                                                    key={mode}
                                                                    onClick={() => setTheme({ ...theme, animationIntensity: mode as any })}
                                                                    className={`flex-1 py-1.5 text-[10px] font-medium capitalize rounded-lg transition-all
                                                                ${theme.animationIntensity === mode ? 'bg-white/20 shadow-sm' : 'opacity-40 hover:opacity-100'}`}
                                                                >
                                                                    {t(`animation.${mode}`)}
                                                                </button>
                                                            ))}
                                                        </div>

                                                        {/* Background Mode Select */}
                                                        <label className="text-[10px] font-bold opacity-40 uppercase tracking-widest block mb-2">{t('ui.background')}</label>
                                                        <div className="flex bg-black/20 p-1 rounded-xl">
                                                            <button
                                                                onClick={() => setBgMode('default')}
                                                                className={`flex-1 py-1.5 flex items-center justify-center gap-2 text-[10px] font-medium rounded-lg transition-all
                                                        ${bgMode === 'default' ? 'bg-white/20 shadow-sm' : 'opacity-40 hover:opacity-100'}`}
                                                            >
                                                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: DEFAULT_THEME.backgroundColor }}></div>
                                                                {t('ui.default')}
                                                            </button>
                                                            <button
                                                                onClick={() => setBgMode('ai')}
                                                                className={`flex-1 py-1.5 flex items-center justify-center gap-2 text-[10px] font-medium rounded-lg transition-all
                                                        ${bgMode === 'ai' ? 'bg-white/20 shadow-sm' : 'opacity-40 hover:opacity-100'}`}
                                                            >
                                                                <div className="w-3 h-3 rounded-full border border-white/20" style={{ backgroundColor: theme.backgroundColor }}></div>
                                                                {t('ui.aiTheme')}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Theme Name Display & Reset */}
                                                    <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-bold truncate max-w-[120px]">
                                                                {theme.name === DEFAULT_THEME.name ? "Default Night" : theme.name}
                                                            </span>
                                                            {theme.name !== DEFAULT_THEME.name && (
                                                                <button
                                                                    onClick={handleResetTheme}
                                                                    className="p-1 rounded-full hover:bg-white/10 transition-colors"
                                                                    title={t('ui.resetToDefaultTheme')}
                                                                >
                                                                    <RotateCcw size={12} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            )}

                                            {/* --- QUEUE TAB --- */}
                                            {panelTab === 'queue' && (
                                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full max-h-[200px]">
                                                    <div ref={queueScrollRef} className="flex-1 overflow-y-auto custom-scrollbar -mx-2 px-2 space-y-1">
                                                        {playQueue.map((s, i) => (
                                                            <div
                                                                key={`${s.id}-${i}`}
                                                                onClick={() => playSong(s, playQueue)}
                                                                data-active={currentSong?.id === s.id}
                                                                className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors
                                                        ${currentSong?.id === s.id ? 'bg-white/20' : 'hover:bg-white/5'}`}
                                                            >
                                                                <div className={`w-1 h-6 rounded-full ${currentSong?.id === s.id ? 'bg-white' : 'bg-transparent'}`} />
                                                                <div className="min-w-0">
                                                                    <div className="text-xs font-medium truncate">{s.name}</div>
                                                                    <div className="text-[10px] opacity-40 truncate">{s.ar?.map(a => a.name).join(', ')}</div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </motion.div>
                                            )}

                                            {/* --- ACCOUNT TAB --- */}
                                            {panelTab === 'account' && (
                                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col justify-start h-full">
                                                    {user ? (
                                                        <div className="flex flex-col gap-4">
                                                            <div className="flex items-center gap-3 bg-white/5 p-3 rounded-xl">
                                                                <div className="w-10 h-10 rounded-full overflow-hidden">
                                                                    <img src={user.avatarUrl?.replace('http:', 'https:')} className="w-full h-full object-cover" />
                                                                </div>
                                                                <div>
                                                                    <h3 className="font-bold text-sm">{user.nickname}</h3>
                                                                    <span className="text-[10px] font-mono opacity-40">ID: {user.userId}</span>
                                                                </div>
                                                            </div>

                                                            <div className="space-y-2 mt-auto">
                                                                {/* Cache Management Section */}
                                                                <div className="bg-white/5 p-3 rounded-xl mb-2">
                                                                    <div className="flex items-center justify-between mb-2">
                                                                        <div className="flex items-center gap-2 opacity-60">
                                                                            <HardDrive size={12} />
                                                                            <span className="text-[10px] font-bold uppercase tracking-wide">{t('account.storage')}</span>
                                                                        </div>
                                                                        <span className="text-[10px] font-mono">{cacheSize}</span>
                                                                    </div>
                                                                    <button
                                                                        onClick={handleClearCache}
                                                                        className="w-full py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-300 rounded-lg flex items-center justify-center gap-2 text-[10px] font-bold transition-colors"
                                                                    >
                                                                        <Trash2 size={12} />
                                                                        {t('account.clearCache')}
                                                                    </button>
                                                                </div>

                                                                <button
                                                                    onClick={handleSyncData}
                                                                    disabled={isSyncing}
                                                                    className="w-full py-2 bg-white/5 hover:bg-white/10 rounded-lg flex items-center justify-center gap-2 text-xs font-bold opacity-80 transition-colors disabled:opacity-50"
                                                                >
                                                                    <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
                                                                    {isSyncing ? t('account.syncing') : t('account.syncData')}
                                                                </button>
                                                                <button
                                                                    onClick={handleLogout}
                                                                    className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg flex items-center justify-center gap-2 text-xs font-bold transition-colors"
                                                                >
                                                                    <LogOut size={14} />
                                                                    {t('account.logout')}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col items-center justify-center h-full gap-2 text-center opacity-50">
                                                            <p>{t('account.guestMode')}</p>
                                                            <button
                                                                onClick={() => { setIsPanelOpen(false); navigateToHome(); }}
                                                                className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full text-xs font-bold"
                                                            >
                                                                {t('account.loginOnHome')}
                                                            </button>
                                                        </div>
                                                    )}
                                                </motion.div>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Toggle Button - Optimized for Mobile (Half hidden to right) */}
                    <div className="pointer-events-auto fixed bottom-8 right-0 z-[60] pr-4 md:pr-8 group">
                        <button
                            onClick={() => setIsPanelOpen(!isPanelOpen)}
                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg backdrop-blur-md transform
                    translate-x-1/2 opacity-60 hover:translate-x-0 hover:opacity-100 md:translate-x-0 md:opacity-100 md:hover:scale-105 border-none
                    ${isPanelOpen ? 'bg-white text-black translate-x-0 opacity-100' : 'bg-black/40 text-white'}`}
                        >
                            {isPanelOpen ? <X size={20} /> : <Settings2 size={20} />}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}