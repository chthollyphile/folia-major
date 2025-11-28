

import React, { useEffect, useState, useRef } from 'react';
import { Play, ChevronLeft, Disc } from 'lucide-react';
import { NeteasePlaylist, SongResult } from '../types';
import { neteaseApi } from '../services/netease';
import { saveToCache, getFromCache } from '../services/db';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';

interface PlaylistViewProps {
  playlist: NeteasePlaylist;
  onBack: () => void;
  onPlaySong: (song: SongResult, playlistCtx?: SongResult[]) => void;
  onPlayAll: (songs: SongResult[]) => void;
}

const PlaylistView: React.FC<PlaylistViewProps> = ({ playlist, onBack, onPlaySong, onPlayAll }) => {
  const { t } = useTranslation();
  const [tracks, setTracks] = useState<SongResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  
  // Scroll Ref
  const containerRef = useRef<HTMLDivElement>(null);
  
  const LIMIT = 50;
  const CACHE_KEY = `playlist_tracks_${playlist.id}`;

  const loadTracks = async (reset = false) => {
    if (loading || (!hasMore && !reset)) return;
    setLoading(true);

    try {
      const currentOffset = reset ? 0 : offset;
      
      if (reset) {
          const cached = await getFromCache<SongResult[]>(CACHE_KEY);
          if (cached && cached.length > 0) {
              setTracks(cached);
              setOffset(cached.length);
              setLoading(false);
              setHasMore(cached.length < playlist.trackCount);
              return;
          }
      }

      const res = await neteaseApi.getPlaylistTracks(playlist.id, LIMIT, currentOffset);
      
      if (res.songs && res.songs.length > 0) {
        const newTracks = res.songs;
        setTracks(prev => {
            const combined = reset ? newTracks : [...prev, ...newTracks];
            if (reset || combined.length > prev.length) {
                saveToCache(CACHE_KEY, combined);
            }
            return combined;
        });
        setOffset(currentOffset + newTracks.length);
        setHasMore(newTracks.length === LIMIT);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Failed to load tracks", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTracks(true);
  }, [playlist.id]);

  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}:${Number(seconds) < 10 ? '0' : ''}${seconds}`;
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-3xl font-sans"
      style={{ color: 'var(--text-primary)' }}
    >
      {/* Main Container - Scrollable on Mobile, Flex on Desktop */}
      <div 
        ref={containerRef}
        className="w-full h-full md:max-w-6xl md:h-[90vh] md:bg-black/20 md:rounded-3xl overflow-y-auto md:overflow-hidden flex flex-col md:flex-row relative custom-scrollbar"
      >
        
        {/* Close Button */}
        <button 
          onClick={onBack}
          className="fixed md:absolute top-6 left-6 z-30 w-10 h-10 rounded-full bg-black/20 hover:bg-white/10 flex items-center justify-center transition-colors backdrop-blur-md"
          style={{ color: 'var(--text-primary)' }}
        >
          <ChevronLeft size={20} />
        </button>

        {/* Left Panel: Cover & Meta (Static Layout) */}
        <div 
          className="w-full md:w-[400px] p-8 md:p-12 flex flex-col items-center md:items-start relative shrink-0 md:h-full md:overflow-y-auto custom-scrollbar"
        >
            {/* Album Art */}
            <div 
               className="w-48 h-48 md:w-64 md:h-64 rounded-2xl shadow-2xl overflow-hidden mb-6 relative mt-12 md:mt-0 mx-auto md:mx-0 bg-zinc-800"
            >
                <img src={playlist.coverImgUrl} alt={playlist.name} className="w-full h-full object-cover" />
            </div>

            <div className="text-center md:text-left space-y-2 w-full mb-6">
                <h1 className="text-2xl md:text-3xl font-bold line-clamp-2" style={{ color: 'var(--text-primary)' }}>{playlist.name}</h1>
                <div className="flex items-center justify-center md:justify-start gap-2 text-sm opacity-50" style={{ color: 'var(--text-secondary)' }}>
                   <div className="w-5 h-5 rounded-full overflow-hidden">
                       <img src={playlist.creator.avatarUrl} alt="avatar" className="w-full h-full" />
                   </div>
                   <span>{playlist.creator.nickname}</span>
                </div>
                <p className="text-xs mt-2 opacity-30" style={{ color: 'var(--text-secondary)' }}>{playlist.trackCount} {t('playlist.tracks')} • {playlist.playCount} {t('playlist.plays')}</p>
            </div>

            <div className="w-full">
                <button 
                    onClick={() => onPlayAll(tracks)}
                    className="w-full py-3.5 rounded-full font-bold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-xl hover:scale-105 transform duration-200"
                    style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
                >
                    <Play size={18} fill="currentColor" />
                    {t('playlist.playAll')}
                </button>
            </div>
        </div>

        {/* Right Panel: Tracks */}
        <div className="flex-1 md:h-full md:overflow-y-auto custom-scrollbar">
            <div className="p-4 md:p-8 pb-32 md:pb-8">
                {/* Desktop Sticky Header */}
                <div className="hidden md:flex sticky top-0 bg-transparent backdrop-blur-md z-10 border-b border-white/5 pb-2 mb-2 text-xs font-medium uppercase tracking-wide opacity-30" style={{ color: 'var(--text-secondary)' }}>
                    <div className="w-10 text-center">#</div>
                    <div className="flex-1 pl-4">{t('playlist.headerTitle')}</div>
                    <div className="w-16 text-right">{t('playlist.headerTime')}</div>
                </div>

                {tracks.map((track, idx) => (
                    <div 
                        key={track.id}
                        onClick={() => onPlaySong(track, tracks)}
                        className="group flex items-center py-3 px-2 rounded-xl hover:bg-white/5 cursor-pointer transition-colors"
                    >
                        <div className="w-8 md:w-10 text-center text-sm font-medium opacity-30 group-hover:opacity-100" style={{ color: 'var(--text-secondary)' }}>
                            {idx + 1}
                        </div>
                        
                        <div className="flex-1 min-w-0 pl-3 md:pl-4">
                            <div className="text-sm font-medium truncate opacity-90 group-hover:opacity-100" style={{ color: 'var(--text-primary)' }}>
                                {track.name}
                                {track.al?.name && <span className="ml-2 text-xs opacity-30 hidden md:inline-block font-normal" style={{ color: 'var(--text-secondary)' }}>{track.al.name}</span>}
                            </div>
                            <div className="text-xs truncate opacity-40 group-hover:opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                {track.ar?.map(a => a.name).join(', ')}
                            </div>
                        </div>
                        
                        <div className="w-12 md:w-16 text-right text-xs font-medium opacity-30 group-hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
                            {formatDuration(track.dt || track.duration)}
                        </div>
                    </div>
                ))}

                {hasMore && (
                    <button 
                        onClick={() => loadTracks(false)}
                        disabled={loading}
                        className="w-full py-6 mt-4 text-xs font-bold opacity-30 hover:opacity-100 uppercase tracking-wider transition-colors"
                        style={{ color: 'var(--text-secondary)' }}
                    >
                        {loading ? <Disc className="animate-spin mx-auto" /> : t('playlist.loadMore')}
                    </button>
                )}
            </div>
        </div>

      </div>
    </motion.div>
  );
};

export default PlaylistView;