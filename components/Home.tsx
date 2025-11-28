

import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, User, Loader2, Disc, ArrowRight, ChevronRight } from 'lucide-react';
import { neteaseApi } from '../services/netease';
import { NeteaseUser, NeteasePlaylist, SongResult } from '../types';
import PlaylistView from './PlaylistView';
import { motion, AnimatePresence } from 'framer-motion';

interface HomeProps {
    onPlaySong: (song: SongResult, playlistCtx?: SongResult[]) => void;
    onQueueAddAndPlay: (song: SongResult) => void;
    onBackToPlayer: () => void;
    onRefreshUser: () => void;
    user: NeteaseUser | null;
    playlists: NeteasePlaylist[];
    currentTrack?: SongResult | null;
    isPlaying: boolean;
    selectedPlaylist: NeteasePlaylist | null;
    onSelectPlaylist: (playlist: NeteasePlaylist | null) => void;
}

const Home: React.FC<HomeProps> = ({
    onPlaySong,
    onQueueAddAndPlay,
    onBackToPlayer,
    onRefreshUser,
    user,
    playlists,
    currentTrack,
    isPlaying,
    selectedPlaylist,
    onSelectPlaylist
}) => {
    const { t } = useTranslation();

    // UI State
    const [searchQuery, setSearchQuery] = useState("");
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [focusedIndex, setFocusedIndex] = useState(() => {
        const saved = sessionStorage.getItem('folia_home_focused_index');
        return saved ? parseInt(saved, 10) : 0;
    });

    // Search State
    const [searchResults, setSearchResults] = useState<SongResult[] | null>(null);
    const [isSearching, setIsSearching] = useState(false);

    // Touch State
    const touchStartX = useRef(0);
    const touchEndX = useRef(0);

    // Wheel navigation debounce
    const wheelTimeout = useRef<any>(null);

    // Login QR
    const [qrCodeImg, setQrCodeImg] = useState<string>("");
    const [qrStatus, setQrStatus] = useState<string>("");
    const qrCheckInterval = useRef<any>(null);

    const initLogin = async () => {
        setShowLoginModal(true);
        setQrStatus(t('home.loadingQr'));
        try {
            const keyRes = await neteaseApi.getQrKey();
            const key = keyRes.data.unikey;

            const createRes = await neteaseApi.createQr(key);
            setQrCodeImg(createRes.data.qrimg);
            setQrStatus(t('home.scanQr'));

            if (qrCheckInterval.current) clearInterval(qrCheckInterval.current);
            qrCheckInterval.current = setInterval(async () => {
                try {
                    const checkRes = await neteaseApi.checkQr(key);
                    const code = checkRes.code;

                    if (code === 800) {
                        setQrStatus(t('home.qrExpired'));
                        clearInterval(qrCheckInterval.current);
                    } else if (code === 801) {
                        // Waiting
                    } else if (code === 802) {
                        setQrStatus(t('home.qrScanned'));
                    } else if (code === 803) {
                        setQrStatus(t('home.loginSuccess'));
                        clearInterval(qrCheckInterval.current);
                        if (checkRes.cookie) {
                            localStorage.setItem('netease_cookie', checkRes.cookie);
                        }
                        // Trigger parent refresh
                        setTimeout(async () => {
                            onRefreshUser();
                            setShowLoginModal(false);
                        }, 1000);
                    }
                } catch (e) {
                    console.error(e);
                }
            }, 3000);

        } catch (e) {
            setQrStatus(t('home.loginError'));
        }
    };

    const handleSearch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!searchQuery.trim()) return;

        setIsSearching(true);
        setSearchResults(null); // Clear previous results while loading

        try {
            const res = await neteaseApi.cloudSearch(searchQuery);
            if (res.result && res.result.songs) {
                setSearchResults(res.result.songs);
            } else {
                setSearchResults([]);
            }
        } catch (err) {
            console.error(err);
            setSearchResults([]);
        } finally {
            setIsSearching(false);
        }
    };

    useEffect(() => {
        return () => {
            if (qrCheckInterval.current) clearInterval(qrCheckInterval.current);
        };
    }, []);

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartX.current = e.targetTouches[0].clientX;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        touchEndX.current = e.targetTouches[0].clientX;
    };

    const handleTouchEnd = () => {
        if (!touchStartX.current || !touchEndX.current) return;
        const diff = touchStartX.current - touchEndX.current;

        // Threshold for swipe
        if (Math.abs(diff) > 50) {
            if (diff > 0) {
                // Swipe Left -> Next
                if (focusedIndex < playlists.length - 1) {
                    setFocusedIndex(prev => prev + 1);
                }
            } else {
                // Swipe Right -> Prev
                if (focusedIndex > 0) {
                    setFocusedIndex(prev => prev - 1);
                }
            }
        }
        // Reset
        touchStartX.current = 0;
        touchEndX.current = 0;
    };

    // Keyboard Navigation Handler
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only respond if not in search or modal
            if (showLoginModal || searchResults !== null) return;

            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (focusedIndex > 0) {
                    setFocusedIndex(prev => prev - 1);
                }
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (focusedIndex < playlists.length - 1) {
                    setFocusedIndex(prev => prev + 1);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [focusedIndex, playlists.length, showLoginModal, searchResults]);

    // Wheel Navigation Handler
    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();

        // Clear existing timeout
        if (wheelTimeout.current) {
            clearTimeout(wheelTimeout.current);
        }

        // Debounce wheel events (wait 150ms after last wheel event)
        wheelTimeout.current = setTimeout(() => {
            const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;

            // Threshold to avoid accidental triggers
            if (Math.abs(delta) > 20) {
                if (delta > 0) {
                    // Scroll right/down -> Next
                    if (focusedIndex < playlists.length - 1) {
                        setFocusedIndex(prev => prev + 1);
                    }
                } else {
                    // Scroll left/up -> Previous
                    if (focusedIndex > 0) {
                        setFocusedIndex(prev => prev - 1);
                    }
                }
            }
        }, 150);
    };

    // Cleanup wheel timeout
    useEffect(() => {
        return () => {
            if (wheelTimeout.current) {
                clearTimeout(wheelTimeout.current);
            }
        };
    }, []);

    // Persistence for Focused Index
    useEffect(() => {
        sessionStorage.setItem('folia_home_focused_index', focusedIndex.toString());
    }, [focusedIndex]);

    if (selectedPlaylist) {
        return (
            <PlaylistView
                playlist={selectedPlaylist}
                onBack={() => onSelectPlaylist(null)}
                onPlaySong={onPlaySong}
                onPlayAll={(songs) => {
                    if (songs.length > 0) onPlaySong(songs[0], songs);
                }}
            />
        );
    }

    return (
        <div
            className="relative w-full h-full flex flex-col font-sans overflow-hidden bg-black/20 pointer-events-auto backdrop-blur-sm overflow-y-auto custom-scrollbar"
            style={{ color: 'var(--text-primary)' }}
        >
            {/* Header */}
            <div className="w-full p-4 md:p-8 flex flex-col md:flex-row items-center justify-between z-20 relative gap-4">
                <div className="w-full md:w-auto flex items-center justify-between">
                    <h1 className="text-2xl font-bold tracking-tight opacity-90 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center" style={{ color: 'var(--text-primary)' }}>
                            <Disc size={16} />
                        </div>
                        Folia
                    </h1>
                </div>

                {/* Simple Search */}
                <form onSubmit={handleSearch} className="relative group w-full max-w-sm md:max-w-xs mx-auto md:mx-0">
                    {isSearching ? (
                        <Loader2
                            className="absolute left-3 top-1/2 w-4 h-4 animate-spin opacity-40"
                            style={{ marginTop: '-8px' }}
                        />
                    ) : (
                        <Search
                            className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40 w-4 h-4 cursor-pointer hover:opacity-100 transition-opacity"
                            onClick={() => handleSearch()}
                        />
                    )}
                    <input
                        type="text"
                        placeholder={t('home.searchDatabase')}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all placeholder:text-white/20"
                        style={{ color: 'var(--text-primary)' }}
                    />
                </form>

                {/* User / Login */}
                <div className="flex items-center gap-4">
                    {/* Login Button Removed (Duplicate) */}
                </div>
            </div>

            {/* Main Content Area - Carousel */}
            <div className="flex-1 flex flex-col items-center justify-center relative">
                {!user ? (
                    <div className="flex flex-col items-center justify-center space-y-6">
                        <div className="w-24 h-24 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center backdrop-blur-md">
                            <User size={40} className="opacity-20" />
                        </div>
                        <h2 className="text-3xl font-bold opacity-80">{t('home.welcomeBack')}</h2>
                        <p className="opacity-40 text-sm">{t('home.pleaseLogin')}</p>
                        <button
                            onClick={initLogin}
                            className="px-8 py-3 bg-white text-black rounded-full font-bold text-sm hover:scale-105 transition-transform"
                        >
                            {t('home.connectAccount')}
                        </button>
                    </div>
                ) : (
                    <div className="w-full h-full flex flex-col justify-center relative">

                        {/* Decorative Line Behind */}
                        <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-y-1/2 z-0" />

                        {/* Center Focus Decoration */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full border border-white/5 -z-10" />

                        {/* Carousel Container */}
                        <div
                            className="w-full h-[400px] relative flex items-center justify-center perspective-1000 touch-pan-y"
                            onTouchStart={handleTouchStart}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={handleTouchEnd}
                            onWheel={handleWheel}
                        >
                            {playlists.length > 0 ? (
                                playlists.map((pl, i) => {
                                    if (Math.abs(focusedIndex - i) > 4) return null;

                                    const distance = i - focusedIndex;
                                    const isActive = distance === 0;

                                    const scale = isActive ? 1.1 : 1 - Math.abs(distance) * 0.15;
                                    const opacity = isActive ? 1 : 0.6 - Math.abs(distance) * 0.15;
                                    const xOffset = distance * 240;
                                    const zIndex = 10 - Math.abs(distance);
                                    const rotateY = distance > 0 ? -15 : distance < 0 ? 15 : 0;

                                    return (
                                        <motion.div
                                            key={pl.id}
                                            className="absolute cursor-pointer"
                                            initial={false}
                                            animate={{
                                                x: xOffset,
                                                scale: scale,
                                                opacity: opacity,
                                                zIndex: zIndex,
                                                rotateY: rotateY,
                                                filter: isActive ? 'blur(0px)' : 'blur(2px)'
                                            }}
                                            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                                            onClick={() => {
                                                if (isActive) onSelectPlaylist(pl);
                                                else setFocusedIndex(i);
                                            }}
                                        >
                                            <div className={`w-56 h-56 md:w-64 md:h-64 rounded-2xl overflow-hidden shadow-2xl relative transition-all duration-300 ${isActive ? 'ring-2 ring-white/30' : ''}`}>
                                                <img src={pl.coverImgUrl?.replace('http:', 'https:')} alt={pl.name} className="w-full h-full object-cover pointer-events-none" />
                                                <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-0 hover:opacity-100 transition-opacity" />
                                            </div>
                                        </motion.div>
                                    );
                                })
                            ) : (
                                <div className="opacity-50 flex flex-col items-center gap-4">
                                    <Loader2 className="animate-spin" />
                                    <span>{t('home.loadingLibrary')}</span>
                                </div>
                            )}
                        </div>

                        {/* Active Playlist Title - Static Layer Below */}
                        {playlists.length > 0 && playlists[focusedIndex] && (
                            <motion.div
                                key={playlists[focusedIndex].id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3 }}
                                className="absolute bottom-24 left-0 right-0 text-center z-10 px-8 pointer-events-none"
                            >
                                <h3 className="font-bold text-2xl truncate max-w-xl mx-auto" style={{ color: 'var(--text-primary)' }}>
                                    {playlists[focusedIndex].name}
                                </h3>
                                <p className="text-xs opacity-50 font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>
                                    {playlists[focusedIndex].trackCount} {t('home.songs')} • ID: {playlists[focusedIndex].id}
                                </p>
                            </motion.div>
                        )}
                    </div>
                )}
            </div>

            {/* Search Results Overlay */}
            <AnimatePresence>
                {searchResults !== null && (
                    <motion.div
                        initial={{ opacity: 0, y: 50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 50 }}
                        className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex flex-col p-6 md:p-12 overflow-hidden"
                    >
                        <div className="flex items-center justify-between mb-8 max-w-4xl mx-auto w-full">
                            <h2 className="text-2xl font-bold flex items-center gap-2">
                                <Search size={24} />
                                <span className="opacity-80">{t('home.resultsFor')}</span>
                                <span className="italic">"{searchQuery}"</span>
                            </h2>
                            <button
                                onClick={() => setSearchResults(null)}
                                className="p-3 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
                            >
                                <ArrowRight className="rotate-180" size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar w-full">
                            {isSearching ? (
                                <div className="flex justify-center p-20"><Loader2 className="animate-spin w-10 h-10 opacity-50" /></div>
                            ) : searchResults.length === 0 ? (
                                <div className="text-center opacity-50 p-20 text-lg">{t('home.noResults')}</div>
                            ) : (
                                <div className="space-y-3 max-w-4xl mx-auto pb-20">
                                    {searchResults.map((track, i) => (
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: i * 0.03 }}
                                            key={track.id}
                                            onClick={() => {
                                                onQueueAddAndPlay(track);
                                                setSearchResults(null);
                                            }}
                                            className="flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer group transition-colors border border-transparent hover:border-white/10"
                                        >
                                            <div className="w-12 h-12 rounded-lg bg-zinc-800 overflow-hidden flex-shrink-0 shadow-lg relative">
                                                {(track.al?.picUrl || track.album?.picUrl) ? (
                                                    <img
                                                        src={(track.al?.picUrl || track.album?.picUrl || '').replace('http:', 'https:')}
                                                        className="w-full h-full object-cover"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center"><Disc size={20} className="opacity-20" /></div>
                                                )}
                                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Disc size={20} />
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold truncate text-base" style={{ color: 'var(--text-primary)' }}>{track.name}</div>
                                                <div className="text-xs opacity-50 truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                                                    {track.ar?.map(a => a.name).join(', ')} • {track.al?.name || track.album?.name}
                                                </div>
                                            </div>
                                            <div className="text-xs font-mono opacity-30">
                                                {((track.dt || track.duration) / 60000).toFixed(2).replace('.', ':')}
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Login Modal */}
            {showLoginModal && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xl p-4">
                    <div className="bg-zinc-900/90 border border-white/10 p-8 rounded-3xl max-w-sm w-full text-center relative shadow-2xl">
                        <button
                            onClick={() => {
                                setShowLoginModal(false);
                                if (qrCheckInterval.current) clearInterval(qrCheckInterval.current);
                            }}
                            className="absolute top-4 right-4 opacity-30 hover:opacity-100 rounded-full bg-white/5 p-1 transition-colors"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            ✕
                        </button>
                        <h3 className="text-lg font-bold mb-6" style={{ color: 'var(--text-primary)' }}>{t('home.loginTitle')}</h3>

                        <div className="relative inline-block bg-white p-2 rounded-xl mb-4 shadow-inner">
                            {qrCodeImg ? (
                                <img src={qrCodeImg} alt="QR Code" className="w-40 h-40" />
                            ) : (
                                <div className="w-40 h-40 flex items-center justify-center bg-gray-100 rounded-lg">
                                    <Loader2 className="animate-spin text-gray-400" size={24} />
                                </div>
                            )}
                        </div>

                        <p className={`text-xs font-medium mt-2 ${qrStatus.includes('Success') ? 'text-green-400' : 'opacity-60'}`} style={{ color: qrStatus.includes('Success') ? undefined : 'var(--text-secondary)' }}>
                            {qrStatus}
                        </p>

                        <p className="text-[10px] opacity-30 mt-6" style={{ color: 'var(--text-secondary)' }}>
                            {t('home.loginNote')}
                        </p>
                    </div>
                </div>
            )}

            {/* User Avatar - Back to Player */}
            {user && (
                <div className="absolute bottom-8 right-8 z-[100]">
                    <div
                        onClick={onBackToPlayer}
                        className="group relative w-12 h-12 cursor-pointer rounded-full border border-white/20 hover:border-white hover:scale-105 transition-all overflow-hidden shadow-lg"
                        title="Return to Player"
                    >
                        <img src={user.avatarUrl?.replace('http:', 'https:')} alt={user.nickname} className="w-full h-full object-cover" />

                        {/* Hover Overlay */}
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 backdrop-blur-[2px]">
                            <ChevronRight className="text-white" size={24} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Home;