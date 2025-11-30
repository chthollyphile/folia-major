import React, { useEffect, useState, useRef } from 'react';
import { Play, ChevronLeft, Disc, Loader2 } from 'lucide-react';
import { NeteasePlaylist, SongResult } from '../types';
import { neteaseApi } from '../services/netease';
import { saveToCache, getFromCache } from '../services/db';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { formatSongName } from '../utils/songNameFormatter';

interface PlaylistViewProps {
  playlist: NeteasePlaylist;
  onBack: () => void;
  onPlaySong: (song: SongResult, playlistCtx?: SongResult[]) => void;
  onPlayAll: (songs: SongResult[]) => void;
  onSelectAlbum: (albumId: number) => void;
}

const PlaylistView: React.FC<PlaylistViewProps> = ({ playlist, onBack, onPlaySong, onPlayAll, onSelectAlbum }) => {
  const { t } = useTranslation();
  const [tracks, setTracks] = useState<SongResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  // Scroll Ref
  const containerRef = useRef<HTMLDivElement>(null);

  const INITIAL_LIMIT = 150;
  const BATCH_LIMIT = 1000;
  const CACHE_KEY = `playlist_tracks_${playlist.id}`;

  const loadTracks = async (reset = false) => {
    if (loading || (!hasMore && !reset)) return;
    setLoading(true);

    try {
      const currentOffset = reset ? 0 : offset;
      const targetTime = playlist.trackUpdateTime || playlist.updateTime || 0;

      if (reset) {
        const cached = await getFromCache<{ tracks: SongResult[], snapshotTime: number; } | SongResult[]>(CACHE_KEY);

        let cachedTracks: SongResult[] = [];
        let cachedTime = 0;

        if (Array.isArray(cached)) {
          // Old format migration
          cachedTracks = cached;
        } else if (cached && cached.tracks) {
          cachedTracks = cached.tracks;
          cachedTime = cached.snapshotTime;
        }

        // Check if cache is valid and fresh
        if (cachedTracks.length > 0 && targetTime > 0 && cachedTime === targetTime) {
          // console.log("[Playlist] Cache hit and fresh", { cachedTime, targetTime });
          setTracks(cachedTracks);
          setOffset(cachedTracks.length);
          setLoading(false);
          setHasMore(cachedTracks.length < playlist.trackCount);
          return;
        }

        console.log("[Playlist] Cache miss or stale, fetching fresh...", { cachedTime, targetTime });

        // Fetch first chunk immediately
        const res = await neteaseApi.getPlaylistTracks(playlist.id, INITIAL_LIMIT, 0);
        if (res.songs && res.songs.length > 0) {
          const initialTracks = res.songs;
          setTracks(initialTracks);
          setOffset(initialTracks.length);

          // Determine if we need more
          const needsMore = initialTracks.length < playlist.trackCount;
          setHasMore(needsMore);

          // Save partial result immediately
          saveToCache(CACHE_KEY, { tracks: initialTracks, snapshotTime: targetTime });

          // Trigger background sync for the rest
          if (needsMore) {
            fetchRemainingTracks(initialTracks, targetTime);
          }
        } else {
          setHasMore(false);
          setTracks([]);
        }
      } else {
        // Manual Load More (fallback)
        const res = await neteaseApi.getPlaylistTracks(playlist.id, BATCH_LIMIT, currentOffset);
        if (res.songs && res.songs.length > 0) {
          setTracks(prev => {
            const combined = [...prev, ...res.songs];
            saveToCache(CACHE_KEY, { tracks: combined, snapshotTime: targetTime });
            return combined;
          });
          setOffset(currentOffset + res.songs.length);
          setHasMore(res.songs.length === BATCH_LIMIT);
        } else {
          setHasMore(false);
        }
      }
    } catch (error) {
      console.error("Failed to load tracks", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRemainingTracks = async (initialTracks: SongResult[], targetTime: number) => {
    console.log("[Playlist] Starting background sync for remaining tracks...");
    let currentTracks = [...initialTracks];
    let currentOffset = initialTracks.length;
    let fetching = true;

    // Safety break
    let safetyCount = 0;
    const MAX_LOOPS = 50;

    while (fetching && currentTracks.length < playlist.trackCount && safetyCount < MAX_LOOPS) {
      safetyCount++;
      try {
        await new Promise(r => setTimeout(r, 100));

        const res = await neteaseApi.getPlaylistTracks(playlist.id, BATCH_LIMIT, currentOffset);
        if (res.songs && res.songs.length > 0) {
          const newChunk = res.songs;
          currentTracks = [...currentTracks, ...newChunk];
          currentOffset += newChunk.length;

          setTracks([...currentTracks]);

          // Update cache
          saveToCache(CACHE_KEY, { tracks: currentTracks, snapshotTime: targetTime });

          if (newChunk.length < BATCH_LIMIT) {
            fetching = false;
          }
        } else {
          fetching = false;
        }
      } catch (e) {
        console.error("[Playlist] Background sync failed", e);
        fetching = false;
      }
    }
    setHasMore(false);
    console.log("[Playlist] Background sync complete");
  };

  useEffect(() => {
    loadTracks(true);
  }, [playlist.id]);


  // Scroll Persistence
  const hasRestoredScroll = useRef(false);
  const canSaveScroll = useRef(false); // Prevent overwriting before restore

  useEffect(() => {
    if (tracks.length === 0 || hasRestoredScroll.current) return;

    // Try restoring from last played index first (User Preference)
    const lastPlayedIndex = sessionStorage.getItem(`folia_playlist_last_index_${playlist.id}`);
    if (lastPlayedIndex) {
      const idx = parseInt(lastPlayedIndex, 10);
      setTimeout(() => {
        const el = document.getElementById(`track-${playlist.id}-${idx}`);
        if (el) {
          el.scrollIntoView({ block: 'center' });
          hasRestoredScroll.current = true;
          canSaveScroll.current = true;
          return;
        }
      }, 100);
    }

    // Fallback to scroll position
    const savedScroll = sessionStorage.getItem(`folia_scroll_playlist_${playlist.id}`);

    if (savedScroll) {
      setTimeout(() => {
        if (window.innerWidth >= 768) {
          const rightPanel = containerRef.current?.querySelector('.md\\:overflow-y-auto');
          if (rightPanel) {
            rightPanel.scrollTop = parseInt(savedScroll, 10);
            hasRestoredScroll.current = true;
          }
        } else {
          if (containerRef.current) {
            containerRef.current.scrollTop = parseInt(savedScroll, 10);
            hasRestoredScroll.current = true;
          }
        }
        // Enable saving after attempt
        canSaveScroll.current = true;
      }, 100);
    } else {
      // No saved scroll, enable saving immediately
      canSaveScroll.current = true;
    }
  }, [playlist.id, tracks.length]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!canSaveScroll.current) return;
    const target = e.currentTarget;
    sessionStorage.setItem(`folia_scroll_playlist_${playlist.id}`, target.scrollTop.toString());
  };

  const handlePlaySongWrapper = (song: SongResult, index: number) => {
    sessionStorage.setItem(`folia_playlist_last_index_${playlist.id}`, index.toString());
    onPlaySong(song, tracks);
  };

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
        onScroll={(e) => { if (window.innerWidth < 768) handleScroll(e); }}
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
            <img src={playlist.coverImgUrl?.replace('http:', 'https:')} alt={playlist.name} className="w-full h-full object-cover" />
          </div>

          <div className="text-center md:text-left space-y-2 w-full mb-6">
            <h1 className="text-2xl md:text-3xl font-bold line-clamp-2" style={{ color: 'var(--text-primary)' }}>{playlist.name}</h1>
            <div className="flex items-center justify-center md:justify-start gap-2 text-sm opacity-50" style={{ color: 'var(--text-secondary)' }}>
              <div className="w-5 h-5 rounded-full overflow-hidden">
                <img src={playlist.creator.avatarUrl?.replace('http:', 'https:')} alt="avatar" className="w-full h-full" />
              </div>
              <span>{playlist.creator.nickname}</span>
            </div>
            <div className="text-xs mt-2 opacity-30" style={{ color: 'var(--text-secondary)' }}>{playlist.trackCount} {t('playlist.tracks')} • {playlist.playCount} {t('playlist.plays')}</div>

            {playlist.description && (
              <div className="mt-4 text-xs opacity-60 line-clamp-4 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {playlist.description}
              </div>
            )}
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
        <div
          className="flex-1 md:h-full md:overflow-y-auto custom-scrollbar"
          onScroll={(e) => { if (window.innerWidth >= 768) handleScroll(e); }}
        >
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
                id={`track-${playlist.id}-${idx}`}
                onClick={() => handlePlaySongWrapper(track, idx)}
                className="group flex items-center py-3 px-2 rounded-xl hover:bg-white/5 cursor-pointer transition-colors"
              >
                <div className="w-8 md:w-10 text-center text-sm font-medium opacity-30 group-hover:opacity-100" style={{ color: 'var(--text-secondary)' }}>
                  {idx + 1}
                </div>

                <div className="flex-1 min-w-0 pl-3 md:pl-4">
                  <div className="text-sm font-medium opacity-90 group-hover:opacity-100" style={{ color: 'var(--text-primary)' }}>
                    {formatSongName(track)}
                  </div>
                  <div className="text-xs truncate opacity-40 group-hover:opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    {track.ar?.map(a => a.name).join(', ')}
                    {(track.al?.name || track.album?.name) && (
                      <>
                        <span className="mx-1.5">•</span>
                        <span
                          className="cursor-pointer hover:opacity-100 hover:underline transition-all"
                          onClick={(e) => {
                            e.stopPropagation();
                            const albumId = track.al?.id || track.album?.id;
                            if (albumId) {
                              onSelectAlbum(albumId);
                            }
                          }}
                        >
                          {track.al?.name || track.album?.name}
                        </span>
                      </>
                    )}
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
                {loading ? (
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="animate-spin" size={16} />
                    <span>{t('playlist.loading')}...</span>
                  </div>
                ) : t('playlist.loadMore')}
              </button>
            )}
          </div>
        </div>

      </div>
    </motion.div>
  );
};

export default PlaylistView;