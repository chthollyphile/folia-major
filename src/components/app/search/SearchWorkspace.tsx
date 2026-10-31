import React, { useCallback, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Theme, UnifiedSong } from '../../../types';
import type { MediaId, OmniCollection } from '../../../types/onlineMusic';
import {
    getSearchKinds,
    type SearchKind,
    type SearchSource,
    useSearchNavigationStore,
} from '../../../stores/useSearchNavigationStore';
import SearchResultsList from './SearchResultsList';
import SearchComposition from './SearchComposition';
import SearchTabs, { useSearchSourceLabel } from './SearchTabs';
import { useCollectionNavigationStore } from '../../../stores/useCollectionNavigationStore';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { collectToScratchpad } from '../../../stores/useScratchpadStore';
import { canOpenPlaylistPickerFor, openAddSongsToPlaylist } from '../../../stores/useAddToPlaylistStore';
import './search.css';

// src/components/app/search/SearchWorkspace.tsx
// 搜索页：搜索框、来源（当前在线平台 / 本地 / Navidrome）、种类（单曲 / 专辑 / 歌单，在线平台搜得到几种就有几种），
// 结果是一张列表；底下压着一幅随种类换站位的至上主义构图（SearchComposition）。
// 单曲行尾悬停出现的「加入速记簿」「收藏到歌单」直接交给速记簿与应用的歌单选择器（与资料库卡片上的同一对），
// 速记簿里这一组的出处是「搜索「词」」。

type SearchWorkspaceProps = {
    theme: Theme;
    isDaylight: boolean;
    onClose: () => void;
    onSubmitSearch: (source?: SearchSource, kind?: SearchKind) => void;
    onLoadMore: () => void;
    onPlayTrack: (track: UnifiedSong) => void;
    onAddTrackToQueue: (track: UnifiedSong) => void;
    onOpenArtist: (track: UnifiedSong, artistName: string, artistId?: MediaId, entityId?: string) => void;
    onOpenAlbum: (track: UnifiedSong, albumName: string, albumId?: MediaId, entityId?: string) => void;
    /** 打开搜到的一张专辑或一个歌单。 */
    onOpenCollection: (collection: OmniCollection) => void;
    /**
     * 渲染前把结果重新套上当前的展示数据（本地曲目的歌手 / 专辑实体）。store 里的结果是提交那一刻的快照，
     * 本地曲库的实体目录在导入后要晚一拍才加载完，那之前搜到的行没有专辑、歌手链接是灰的；
     * 不在这里按当前目录重算，它们会一直停在那个状态，直到重新搜索。
     */
    resolveTrackDisplay?: (track: UnifiedSong) => UnifiedSong;
};

const PLACEHOLDER_KEYS: Record<SearchKind, string> = {
    song: 'search.placeholder',
    album: 'search.placeholderAlbum',
    playlist: 'search.placeholderPlaylist',
};

const SearchWorkspace: React.FC<SearchWorkspaceProps> = ({
    theme,
    isDaylight,
    onClose,
    onSubmitSearch,
    onLoadMore,
    onPlayTrack,
    onAddTrackToQueue,
    onOpenArtist,
    onOpenAlbum,
    onOpenCollection,
    resolveTrackDisplay,
}) => {
    const { t } = useTranslation();
    const {
        searchQuery,
        submittedQuery,
        searchSourceTab,
        searchKind,
        searchResults,
        collectionResults,
        resultTotal,
        isSearchOpen,
        isSearching,
        isLoadingMore,
        searchError,
        hasMore,
        scrollTop,
        setSearchQuery,
        setSearchScrollTop,
    } = useSearchNavigationStore(useShallow(state => ({
        searchQuery: state.searchQuery,
        submittedQuery: state.submittedQuery,
        searchSourceTab: state.searchSourceTab,
        searchKind: state.searchKind,
        searchResults: state.searchResults,
        collectionResults: state.collectionResults,
        resultTotal: state.resultTotal,
        isSearchOpen: state.isSearchOpen,
        isSearching: state.isSearching,
        isLoadingMore: state.isLoadingMore,
        searchError: state.searchError,
        hasMore: state.hasMore,
        scrollTop: state.scrollTop,
        setSearchQuery: state.setSearchQuery,
        setSearchScrollTop: state.setSearchScrollTop,
    })));
    const results = useMemo(() => {
        const raw = searchResults || [];
        return resolveTrackDisplay ? raw.map(resolveTrackDisplay) : raw;
    }, [resolveTrackDisplay, searchResults]);
    const collections = collectionResults || [];
    const isCollectionKind = searchKind !== 'song';
    const resultCount = isCollectionKind ? collections.length : results.length;
    const activeOnlineProviderId = useOnlineProviderAccountStore(state => state.activeProviderId);
    const sources = useMemo<SearchSource[]>(() => [activeOnlineProviderId, 'local', 'navidrome'], [activeOnlineProviderId]);
    const kinds = useMemo(() => getSearchKinds(searchSourceTab), [searchSourceTab]);
    const hasCollection = useCollectionNavigationStore(state => Boolean(state.snapshot?.stack.length));
    const getSourceLabel = useSearchSourceLabel();
    const collectTrack = useCallback((track: UnifiedSong) => {
        collectToScratchpad([track], submittedQuery.trim() ? { label: t('scratchpad.originSearch', { query: submittedQuery.trim() }) } : undefined);
    }, [submittedQuery, t]);
    const saveTrackToPlaylist = useCallback((track: UnifiedSong) => {
        if (canOpenPlaylistPickerFor(track)) openAddSongsToPlaylist([track]);
    }, []);
    const paperColor = isDaylight ? 'rgba(250,250,250,0.96)' : 'rgba(8,8,10,0.94)';
    const countLabel = resultTotal !== null && resultTotal >= resultCount
        ? String(resultTotal)
        : `${resultCount}${hasMore ? '+' : ''}`;

    useEffect(() => {
        if (!isSearchOpen || hasCollection) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [hasCollection, isSearchOpen, onClose]);

    return (
        <AnimatePresence>
            {isSearchOpen && (
                <motion.section
                    initial={{ opacity: 0, y: 28 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 28 }}
                    className={`search-workspace fixed inset-0 flex flex-col overflow-hidden px-4 py-5 sm:px-8 sm:py-7 ${
                        hasCollection ? 'z-[5]' : 'z-50'
                    }`}
                    style={{
                        color: theme.primaryColor,
                        backgroundColor: paperColor,
                        backdropFilter: 'blur(24px)',
                        '--search-ink': theme.primaryColor,
                        '--search-accent': theme.accentColor,
                        '--search-paper': isDaylight ? '#fafafa' : '#08080a',
                    } as React.CSSProperties}
                >
                    <SearchComposition kind={searchKind} query={submittedQuery} />

                    <header className="mx-auto flex w-full max-w-5xl shrink-0 flex-col gap-5">
                        <div className="flex items-center gap-4">
                            <form
                                className="search-field flex-1"
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    onSubmitSearch();
                                }}
                            >
                                <span className={`search-field-mark ${isSearching ? 'is-busy' : ''}`} aria-hidden="true" />
                                <input
                                    value={searchQuery}
                                    onChange={event => setSearchQuery(event.target.value)}
                                    placeholder={t(PLACEHOLDER_KEYS[searchKind])}
                                    autoFocus
                                />
                            </form>
                            <button
                                type="button"
                                onClick={onClose}
                                className="search-close"
                                aria-label={t('ui.backToHome')}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <SearchTabs
                            sources={sources}
                            source={searchSourceTab}
                            kinds={kinds}
                            kind={searchKind}
                            onSelectSource={source => onSubmitSearch(source)}
                            onSelectKind={kind => onSubmitSearch(searchSourceTab, kind)}
                        />

                        <div className="search-meta">
                            <span>{getSourceLabel(searchSourceTab)}</span>
                            {!isSearching && resultCount > 0 && (
                                <span>{t('search.resultCount', { n: countLabel })}</span>
                            )}
                        </div>
                    </header>

                    <div className="search-plane mx-auto mt-3 min-h-0 w-full max-w-5xl flex-1">
                        {isSearching ? (
                            <div className="flex h-full items-center justify-center">
                                <div className="search-loader" role="status" aria-label={t('localMusic.searching')}>
                                    <i />
                                    <i />
                                    <i />
                                </div>
                            </div>
                        ) : searchError && resultCount === 0 ? (
                            <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
                                <div className="search-void" aria-hidden="true" />
                                <p className="text-sm font-semibold opacity-70">{t('search.error')}</p>
                                <button
                                    type="button"
                                    onClick={() => onSubmitSearch()}
                                    className="search-flat-button"
                                >
                                    {t('search.retry')}
                                </button>
                            </div>
                        ) : resultCount === 0 ? (
                            <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
                                <div className="search-void" aria-hidden="true" />
                                <p className="text-sm font-semibold opacity-60">{t('home.noResults')}</p>
                            </div>
                        ) : (
                            <div className="flex h-full flex-col">
                                <div className="min-h-0 flex-1">
                                    <SearchResultsList
                                        tracks={isCollectionKind ? undefined : results}
                                        collections={isCollectionKind ? collections : undefined}
                                        revealKey={`${searchSourceTab}:${searchKind}:${submittedQuery}`}
                                        scrollTop={scrollTop}
                                        onScrollTopChange={setSearchScrollTop}
                                        onPlayTrack={onPlayTrack}
                                        onAddTrackToQueue={onAddTrackToQueue}
                                        onCollectTrack={collectTrack}
                                        canSaveTrackToPlaylist={canOpenPlaylistPickerFor}
                                        onSaveTrackToPlaylist={saveTrackToPlaylist}
                                        onOpenArtist={onOpenArtist}
                                        onOpenAlbum={onOpenAlbum}
                                        onOpenCollection={onOpenCollection}
                                    />
                                </div>
                                {searchError ? (
                                    <div className="flex shrink-0 items-center justify-center gap-4 py-3 text-sm">
                                        <span className="opacity-60">{t('search.error')}</span>
                                        <button
                                            type="button"
                                            disabled={isLoadingMore}
                                            onClick={onLoadMore}
                                            className="search-flat-button"
                                        >
                                            {t('search.retry')}
                                        </button>
                                    </div>
                                ) : hasMore && (
                                    <div className="flex shrink-0 justify-center py-3">
                                        <button
                                            type="button"
                                            disabled={isLoadingMore}
                                            onClick={onLoadMore}
                                            className="search-flat-button"
                                        >
                                            {isLoadingMore ? t('localMusic.searching') : t('home.loadMore')}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </motion.section>
            )}
        </AnimatePresence>
    );
};

export default SearchWorkspace;
