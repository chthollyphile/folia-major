import React, { useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Disc, Loader2, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HomeViewTab, Theme, UnifiedSong } from '../types';
import { formatSongName } from '../utils/songNameFormatter';
import { useSearchNavigationStore } from '../stores/useSearchNavigationStore';
import { useShallow } from 'zustand/react/shallow';

const toSafeRemoteUrl = (url: string | null | undefined): string | undefined => {
    if (!url) {
        return undefined;
    }

    if (url.startsWith('http:') && url.includes('music.126.net')) {
        return url.replace('http:', 'https:');
    }

    return url;
};

interface SearchResultsOverlayProps {
    theme: Theme;
    isDaylight: boolean;
    onClose: () => void;
    onSubmitSearch: () => void;
    onLoadMore: () => void;
    onPlayTrack: (track: UnifiedSong) => void;
    onSelectArtist: (track: UnifiedSong, artistName: string, artistId?: number) => void;
    onSelectAlbum: (track: UnifiedSong, albumName: string, albumId?: number) => void;
}

const SearchResultCover: React.FC<{ track: UnifiedSong; }> = ({ track }) => {
    const [src, setSrc] = React.useState<string | undefined>(undefined);

    useEffect(() => {
        let objectUrl: string | undefined;

        if (track.isLocal && track.localData) {
            const localSong = track.localData;
            if (localSong.useOnlineCover !== false && localSong.matchedCoverUrl) {
                setSrc(toSafeRemoteUrl(localSong.matchedCoverUrl));
            } else if (localSong.embeddedCover) {
                objectUrl = URL.createObjectURL(localSong.embeddedCover);
                setSrc(objectUrl);
            } else {
                setSrc(undefined);
            }
        } else {
            const remoteUrl = track.al?.picUrl || track.album?.picUrl;
            setSrc(toSafeRemoteUrl(remoteUrl));
        }

        return () => {
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [track]);

    if (!src) {
        return <div className="w-full h-full flex items-center justify-center"><Disc size={20} className="opacity-20" /></div>;
    }

    return <img src={src} className="w-full h-full object-cover" loading="lazy" />;
};

const getPlaceholder = (sourceTab: HomeViewTab, t: ReturnType<typeof useTranslation>['t']) => {
    if (sourceTab === 'local') {
        return t('home.searchLocal');
    }
    if (sourceTab === 'navidrome') {
        return t('home.searchNavidrome');
    }
    return t('home.searchDatabase');
};

const SearchResultsOverlay: React.FC<SearchResultsOverlayProps> = ({
    theme,
    isDaylight,
    onClose,
    onSubmitSearch,
    onLoadMore,
    onPlayTrack,
    onSelectArtist,
    onSelectAlbum,
}) => {
    const { t } = useTranslation();
    const {
        searchQuery,
        searchSourceTab,
        searchResults,
        isSearchOpen,
        isSearching,
        isLoadingMore,
        hasMore,
        scrollTop,
        setSearchQuery,
        setSearchScrollTop,
    } = useSearchNavigationStore(useShallow(state => ({
        searchQuery: state.searchQuery,
        searchSourceTab: state.searchSourceTab,
        searchResults: state.searchResults,
        isSearchOpen: state.isSearchOpen,
        isSearching: state.isSearching,
        isLoadingMore: state.isLoadingMore,
        hasMore: state.hasMore,
        scrollTop: state.scrollTop,
        setSearchQuery: state.setSearchQuery,
        setSearchScrollTop: state.setSearchScrollTop,
    })));
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const closeButtonClass = isDaylight
        ? 'bg-black/5 text-black/60 hover:bg-black/10 hover:text-black'
        : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white';
    const resultItemBg = isDaylight ? 'bg-black/5 hover:bg-black/10' : 'bg-white/5 hover:bg-white/10';

    useEffect(() => {
        if (!isSearchOpen || !scrollContainerRef.current) {
            return;
        }

        scrollContainerRef.current.scrollTop = scrollTop;
    }, [isSearchOpen, scrollTop, searchResults]);

    const placeholder = useMemo(() => getPlaceholder(searchSourceTab, t), [searchSourceTab, t]);

    return (
        <AnimatePresence>
            {isSearchOpen && (
                <motion.div
                    initial={{ opacity: 0, y: 50 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 50 }}
                    className={`fixed inset-0 z-50 ${isDaylight ? 'bg-white/95' : 'bg-black/90'} backdrop-blur-xl flex flex-col p-6 md:p-12 overflow-hidden`}
                    style={{ color: theme.primaryColor }}
                >
                    <div className="flex items-center gap-4 mb-8 max-w-4xl mx-auto w-full">
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                onSubmitSearch();
                            }}
                            className={`relative flex-1 ${isDaylight ? 'bg-black/5' : 'bg-white/5'} border border-white/10 rounded-full`}
                        >
                            {isSearching ? (
                                <Loader2
                                    className="absolute left-4 top-1/2 w-4 h-4 animate-spin opacity-40"
                                    style={{ marginTop: '-8px' }}
                                />
                            ) : (
                                <Search
                                    className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40 w-4 h-4 cursor-pointer hover:opacity-100 transition-opacity"
                                    onClick={onSubmitSearch}
                                />
                            )}
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                placeholder={placeholder}
                                className="w-full bg-transparent rounded-full py-3 pl-11 pr-4 text-sm focus:outline-none"
                                style={{ color: 'var(--text-primary)' }}
                            />
                        </form>
                        <button
                            onClick={onClose}
                            className={`rounded-full p-3 transition-colors ${closeButtonClass}`}
                            aria-label={t('ui.backToHome')}
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <div
                        ref={scrollContainerRef}
                        className="flex-1 overflow-y-auto custom-scrollbar w-full"
                        onScroll={(event) => setSearchScrollTop(event.currentTarget.scrollTop)}
                    >
                        {isSearching ? (
                            <div className="flex justify-center p-20"><Loader2 className="animate-spin w-10 h-10 opacity-50" /></div>
                        ) : !searchResults || searchResults.length === 0 ? (
                            <div className="text-center opacity-50 p-20 text-lg">{t('home.noResults')}</div>
                        ) : (
                            <div className="space-y-3 max-w-4xl mx-auto pb-20">
                                {searchResults.map((track, index) => (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: Math.min(index, 10) * 0.03 }}
                                        key={`${track.id}-${index}`}
                                        onClick={() => onPlayTrack(track)}
                                        className={`flex items-center gap-4 p-4 rounded-xl ${resultItemBg} cursor-pointer group transition-colors border border-transparent hover:border-white/10`}
                                    >
                                        <div className="w-12 h-12 rounded-lg bg-zinc-800 overflow-hidden flex-shrink-0 shadow-lg relative">
                                            <SearchResultCover track={track} />
                                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Disc size={20} />
                                            </div>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
                                                {formatSongName(track)}
                                            </div>
                                            <div className="text-xs opacity-50 truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                                                {track.ar?.map((artist, artistIndex) => (
                                                    <React.Fragment key={`${artist.id}-${artistIndex}`}>
                                                        {artistIndex > 0 && ', '}
                                                        <span
                                                            className="cursor-pointer hover:underline hover:opacity-100 transition-opacity"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                onSelectArtist(track, artist.name, artist.id);
                                                            }}
                                                        >
                                                            {artist.name}
                                                        </span>
                                                    </React.Fragment>
                                                ))} {' '}•{' '}
                                                <span
                                                    className="cursor-pointer hover:opacity-100 hover:underline transition-all"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        const albumName = track.al?.name || track.album?.name || '';
                                                        const albumId = track.al?.id || track.album?.id;
                                                        if (albumName) {
                                                            onSelectAlbum(track, albumName, albumId);
                                                        }
                                                    }}
                                                >
                                                    {track.al?.name || track.album?.name}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-xs font-mono opacity-30">
                                            {((track.dt || track.duration) / 60000).toFixed(2).replace('.', ':')}
                                        </div>
                                    </motion.div>
                                ))}
                                {hasMore && (
                                    <div className="flex justify-center pt-6">
                                        <button
                                            type="button"
                                            onClick={onLoadMore}
                                            disabled={isLoadingMore}
                                            className={`px-5 py-2 rounded-full border transition-colors ${isDaylight ? 'border-black/10 bg-black/5 hover:bg-black/10' : 'border-white/10 bg-white/5 hover:bg-white/10'} disabled:opacity-60`}
                                        >
                                            {isLoadingMore ? (t('localMusic.searching') || '搜索中...') : (t('home.loadMore') || '加载更多')}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default SearchResultsOverlay;
