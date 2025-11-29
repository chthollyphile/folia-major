// DEPRECATED, use components/Home.tsx instead

import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, User, LogOut, Loader2, Disc, RefreshCw, ArrowRight, Zap } from 'lucide-react';
import { neteaseApi } from '../services/netease';
import { saveToCache, getFromCache, clearCache } from '../services/db';
import { NeteaseUser, NeteasePlaylist, SongResult } from '../types';
import PlaylistView from './PlaylistView';
import { motion, AnimatePresence } from 'framer-motion';

interface HomeProps {
  onPlaySong: (song: SongResult, playlistCtx?: SongResult[]) => void;
  onBackToPlayer: () => void;
  currentTrack?: SongResult | null;
  isPlaying: boolean;
}

const Home: React.FC<HomeProps> = ({ onPlaySong, onBackToPlayer, currentTrack, isPlaying }) => {
  const { t } = useTranslation();

  // Data State
  const [user, setUser] = useState<NeteaseUser | null>(null);
  const [playlists, setPlaylists] = useState<NeteasePlaylist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<NeteasePlaylist | null>(null);

  // UI State
  const [searchQuery, setSearchQuery] = useState("");
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [loading, setLoading] = useState(false);

  // Login QR
  const [qrCodeImg, setQrCodeImg] = useState<string>("");
  const [qrStatus, setQrStatus] = useState<string>("");
  const qrCheckInterval = useRef<any>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const cachedUser = await getFromCache<NeteaseUser>('user_profile');
    const cachedPlaylists = await getFromCache<NeteasePlaylist[]>('user_playlists');

    if (cachedUser) {
      setUser(cachedUser);
      if (cachedPlaylists) {
        setPlaylists(cachedPlaylists);
      } else {
        await fetchPlaylists(cachedUser.userId);
      }
      setLoading(false);
      checkLoginStatus(false);
    } else {
      await checkLoginStatus(true);
      setLoading(false);
    }
  };

  const checkLoginStatus = async (shouldFetchPlaylists = true) => {
    try {
      const res = await neteaseApi.getLoginStatus();
      if (res.data && res.data.profile) {
        const profile = res.data.profile;
        setUser(profile);
        await saveToCache('user_profile', profile);

        if (res.cookie) {
          localStorage.setItem('netease_cookie', res.cookie);
        }

        if (shouldFetchPlaylists) {
          await fetchPlaylists(profile.userId);
        }
      }
    } catch (e) {
      console.log("Not logged in or offline");
    }
  };

  const fetchPlaylists = async (uid: number) => {
    try {
      const res = await neteaseApi.getUserPlaylists(uid);
      if (res.playlist) {
        setPlaylists(res.playlist);
        await saveToCache('user_playlists', res.playlist);
      }
    } catch (e) {
      console.error("Failed to fetch playlists", e);
    }
  };

  const refreshData = async () => {
    if (!user) return;
    setLoading(true);
    await checkLoginStatus(true);
    setLoading(false);
    setShowUserMenu(false);
  };

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
            setTimeout(async () => {
              await checkLoginStatus(true);
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

  const handleLogout = async () => {
    localStorage.removeItem('netease_cookie');
    await clearCache();
    setUser(null);
    setPlaylists([]);
    setShowUserMenu(false);
  };

  useEffect(() => {
    return () => {
      if (qrCheckInterval.current) clearInterval(qrCheckInterval.current);
    };
  }, []);

  if (selectedPlaylist) {
    return (
      <PlaylistView
        playlist={selectedPlaylist}
        onBack={() => setSelectedPlaylist(null)}
        onPlaySong={onPlaySong}
        onPlayAll={(songs) => {
          if (songs.length > 0) onPlaySong(songs[0], songs);
        }}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative w-full h-full text-white flex flex-col font-sans overflow-hidden bg-transparent"
    >
      {/* Background Gradient Overlay to make text readable over visualizer */}
      <div className="absolute inset-0 bg-gradient-to-br from-black/80 via-black/40 to-transparent pointer-events-none -z-10" />

      {/* Header / Search */}
      <div className="w-full p-8 flex items-center justify-between z-10">
        <div className="flex flex-col">
          <h1 className="text-4xl font-black italic tracking-tighter uppercase flex items-center gap-2" style={{ textShadow: '0 0 20px rgba(255,255,255,0.3)' }}>
            FLUO <span className="text-xs not-italic font-mono bg-white text-black px-1 rounded-sm ml-2">BETA</span>
          </h1>
          <span className="text-[10px] font-mono tracking-[0.3em] text-white/50 uppercase">Kinetic Lyric System</span>
        </div>

        <div className="relative group w-full max-w-sm mx-8">
          <input
            type="text"
            placeholder="SEARCH DATABASE..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-transparent border-b-2 border-white/20 py-2 pl-8 pr-4 font-mono text-sm focus:outline-none focus:border-white transition-all placeholder:text-white/30"
          />
          <Search className="absolute left-0 top-2 text-white/50 w-4 h-4" />
        </div>

        {/* User Profile / Login */}
        <div className="flex items-center gap-4">
          {!user && (
            <button
              onClick={initLogin}
              className="flex items-center gap-2 px-4 py-2 border border-white/20 hover:bg-white hover:text-black transition-colors text-xs font-bold uppercase tracking-wider"
            >
              <User size={14} />
              Login
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-8 pb-32">
        {!user ? (
          <div className="flex flex-col items-center justify-center h-[60vh] space-y-8">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.8, ease: "circOut" }}
              className="relative"
            >
              <div className="absolute -inset-10 border border-white/10 rounded-full animate-[spin_10s_linear_infinite]" />
              <div className="absolute -inset-20 border border-dashed border-white/5 rounded-full animate-[spin_20s_linear_infinite_reverse]" />
              <h2 className="text-8xl font-black uppercase tracking-tighter text-center leading-none">
                SYSTEM<br />OFFLINE
              </h2>
            </motion.div>
            <p className="text-white/60 font-mono text-xs uppercase tracking-widest bg-black/40 px-4 py-2">
              {t('home.loginPrompt')}
            </p>
            <button
              onClick={initLogin}
              className="group relative px-10 py-4 border border-white bg-transparent hover:bg-white transition-colors overflow-hidden"
            >
              <span className="relative z-10 text-sm font-bold uppercase tracking-widest group-hover:text-black flex items-center gap-2">
                Initialize Session <ArrowRight size={14} />
              </span>
            </button>
          </div>
        ) : (
          <div className="space-y-12">
            <section>
              <div className="flex items-center gap-4 mb-8">
                <h2 className="text-4xl font-black uppercase tracking-tighter">Library</h2>
                <div className="h-px flex-1 bg-white/20" />
                <div className="font-mono text-xs text-white/50">{playlists.length} SETS FOUND</div>
              </div>

              <motion.div
                initial="hidden"
                animate="show"
                variants={{
                  hidden: { opacity: 0 },
                  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
                }}
                className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6"
              >
                {playlists.map(pl => (
                  <motion.div
                    key={pl.id}
                    variants={{
                      hidden: { y: 20, opacity: 0 },
                      show: { y: 0, opacity: 1 }
                    }}
                    onClick={() => setSelectedPlaylist(pl)}
                    className="group cursor-pointer relative"
                  >
                    <div className="aspect-square relative overflow-hidden bg-zinc-900 border border-white/10 group-hover:border-white/50 transition-colors">
                      <img
                        src={pl.coverImgUrl?.replace('http:', 'https:')}
                        loading="lazy"
                        alt={pl.name}
                        className="w-full h-full object-cover opacity-70 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700 grayscale group-hover:grayscale-0"
                      />
                      {/* Overlay Text on Hover */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        <div className="w-16 h-16 rounded-full border border-white flex items-center justify-center bg-black/50 backdrop-blur-sm">
                          <Disc className="animate-[spin_3s_linear_infinite]" />
                        </div>
                      </div>
                      {/* Corner Accents */}
                      <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>

                    <div className="mt-3">
                      <h3 className="font-bold text-lg leading-tight uppercase truncate group-hover:text-blue-400 transition-colors">{pl.name}</h3>
                      <p className="text-[10px] font-mono text-white/50 uppercase tracking-widest mt-1">
                        {pl.trackCount} TRACKS // ID: {pl.id}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            </section>
          </div>
        )}
      </div>

      {/* Login Modal */}
      {showLoginModal && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
          <div className="bg-black border border-white/20 p-10 max-w-sm w-full text-center relative shadow-[0_0_50px_rgba(255,255,255,0.1)]">
            <button
              onClick={() => {
                setShowLoginModal(false);
                if (qrCheckInterval.current) clearInterval(qrCheckInterval.current);
              }}
              className="absolute top-4 right-4 text-white/50 hover:text-white"
            >
              ✕
            </button>
            <h3 className="text-2xl font-black uppercase tracking-widest mb-8">{t('home.loginTitle')}</h3>

            <div className="relative inline-block border-2 border-white p-2 mb-4">
              {qrCodeImg ? (
                <img src={qrCodeImg} alt="QR Code" className="w-48 h-48 filter contrast-125" />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center bg-zinc-900">
                  <Loader2 className="animate-spin text-white" size={32} />
                </div>
              )}
              <div className="absolute -bottom-2 -right-2 w-4 h-4 bg-white" />
              <div className="absolute -top-2 -left-2 w-4 h-4 bg-white" />
            </div>

            <p className={`font-mono text-xs uppercase tracking-widest ${qrStatus.includes('Success') ? 'text-green-400' : 'text-white/60'}`}>
              {qrStatus}
            </p>

            <p className="text-[10px] text-white/40 mt-8 uppercase font-mono border-t border-white/10 pt-4">
              {t('home.loginNote')}
            </p>
          </div>
        </div>
      )}

      {/* User Menu Trigger */}
      <div className="absolute bottom-8 right-8 z-[100]">
        {user && (
          <div className="relative group">
            <AnimatePresence>
              {showUserMenu && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="absolute bottom-full right-0 mb-4 w-56 bg-black/90 border border-white/20 backdrop-blur-xl"
                >
                  <div className="p-4 border-b border-white/10">
                    <div className="font-bold text-sm uppercase tracking-wider truncate">{user.nickname}</div>
                    <div className="text-[10px] font-mono text-white/40 mt-1">UUID: {user.userId}</div>
                  </div>
                  <button
                    onClick={refreshData}
                    className="w-full text-left px-4 py-3 text-xs font-bold uppercase hover:bg-white hover:text-black transition-colors flex items-center gap-2"
                  >
                    <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                    Sync Data
                  </button>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-3 text-xs font-bold uppercase hover:bg-red-600 hover:text-white text-red-400 transition-colors flex items-center gap-2"
                  >
                    <LogOut size={12} />
                    Terminate Session
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div
              onClick={() => setShowUserMenu(!showUserMenu)}
              className={`w-12 h-12 cursor-pointer border hover:border-white transition-all overflow-hidden relative
                    ${showUserMenu ? 'border-white' : 'border-white/20'}`}
            >
              <img src={user.avatarUrl?.replace('http:', 'https:')} alt={user.nickname} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all" />
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default Home;