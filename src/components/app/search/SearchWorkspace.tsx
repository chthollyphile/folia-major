import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Clock3, Loader2, Music, Search, User, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useCarouselDragScroll } from '../../../hooks/useCarouselDragScroll';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import type { Theme, UnifiedSong } from '../../../types';
import type { MediaId, OnlineSearchSuggestion } from '../../../types/onlineMusic';
import {
    type SearchSource,
    useSearchNavigationStore,
} from '../../../stores/useSearchNavigationStore';
import { useCollectionNavigationStore } from '../../../stores/useCollectionNavigationStore';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { omni } from '../../../services/onlineMusic/omni';
import SearchResultsList from './SearchResultsList';
import { collectionKey, createOnlineGridViewCollection, type GridViewCollectionDescriptor } from '../home/gridViewCollectionAdapters';

// src/components/app/search/SearchWorkspace.tsx
// 搜索工作台。结果按渠道分行（单曲/歌单/专辑），查询词做标题——官方音乐 App 的搜索页结构。
// 三件细化都在这一个文件里：smartbox 输入联想（下拉）、搜索历史（localStorage）、
// 类型搜索的集合卡。联想与集合卡都走 omni（在线数据只走 omni 的铁律），
// provider 没实现对应方法就静默降级为没有那一件。

const SEARCH_HISTORY_KEY = 'folia.search-history';
const SEARCH_HISTORY_LIMIT = 8;
/** 输入联想与集合卡的防抖：短到跟手，长到不打爆 smartbox。 */
const SUGGESTION_DEBOUNCE_MS = 250;
/** blur 后留一小段时间，让历史/联想项的 onMouseDown 先于面板消失。 */
const HISTORY_BLUR_DELAY_MS = 120;

const readSearchHistory = (): string[] => {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
};

const writeSearchHistory = (entries: string[]): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(entries.slice(0, SEARCH_HISTORY_LIMIT)));
    } catch {
        // localStorage 写不进去（隐私模式/配额）就只活在本组件 state 里，不解释。
    }
};

/**
 * 为不透明色表示加上 alpha 通道。主题背景色通常是
 * hex（#rgb / #rrggbb），也可能已经是 rgba()（那时原样返回）。
 * 搞不定就返回原值：搞坏了背景色比不加透明更原话。
 */
const withAlpha = (color: string, alpha: number): string => {
    const value = color.trim();
    if (value.startsWith('rgba') || value.startsWith('hsla')) return value;
    const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
    if (!match) return value;
    const hex = match[1];
    const full = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

type SearchWorkspaceProps = {
    theme: Theme;
    isDaylight: boolean;
    onClose: () => void;
    onSubmitSearch: (source?: SearchSource) => void;
    onLoadMore: () => void;
    onPlayTrack: (track: UnifiedSong) => void;
    onAddTrackToQueue: (track: UnifiedSong) => void;
    onOpenArtist: (track: UnifiedSong, artistName: string, artistId?: MediaId, entityId?: string) => void;
    onOpenAlbum: (track: UnifiedSong, albumName: string, albumId?: MediaId, entityId?: string) => void;
    onOpenCollection: (collection: GridViewCollectionDescriptor) => void;
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
}) => {
    const { t } = useTranslation();
    const {
        searchQuery,
        searchSourceTab,
        searchResults,
        isSearchOpen,
        isSearching,
        isLoadingMore,
        searchError,
        hasMore,
        setSearchQuery,
    } = useSearchNavigationStore(useShallow(state => ({
        searchQuery: state.searchQuery,
        searchSourceTab: state.searchSourceTab,
        searchResults: state.searchResults,
        isSearchOpen: state.isSearchOpen,
        isSearching: state.isSearching,
        isLoadingMore: state.isLoadingMore,
        searchError: state.searchError,
        hasMore: state.hasMore,
        setSearchQuery: state.setSearchQuery,
    })));
    const results = searchResults || [];
    const activeOnlineProviderId = useOnlineProviderAccountStore(state => state.activeProviderId);
    const sources = useMemo<SearchSource[]>(() => [activeOnlineProviderId, 'local', 'navidrome'], [activeOnlineProviderId]);
    const hasCollection = useCollectionNavigationStore(state => Boolean(state.snapshot?.stack.length));
    const getSourceLabel = (source: SearchSource) => {
        if (source === 'local') return t('search.sourceLocal');
        if (source === 'navidrome') return t('search.sourceNavidrome');
        return omni.getProviderLabel(source);
    };

    const [suggestions, setSuggestions] = useState<OnlineSearchSuggestion[]>([]);
    const [suggestionsVisible, setSuggestionsVisible] = useState(false);
    const [activeSuggestion, setActiveSuggestion] = useState(-1);
    const [collections, setCollections] = useState<GridViewCollectionDescriptor[]>([]);
    const [history, setHistory] = useState<string[]>(() => readSearchHistory());
    /** 失焦后关历史/联想的延迟句柄：Escape 或点 X 关掉工作台时组件会卸载，
        没有句柄的话这个 120ms 定时器仍会 fire 到已卸载组件上。 */
    const blurDismissTimerRef = useRef<number | null>(null);
    useEffect(() => () => {
        if (blurDismissTimerRef.current) window.clearTimeout(blurDismissTimerRef.current);
    }, []);
    const [isHistoryVisible, setIsHistoryVisible] = useState(false);

    const isOnlineTab = searchSourceTab !== 'local' && searchSourceTab !== 'navidrome';

    // 渠道式结果：查询标题 + 单曲/歌单/专辑三行横滑卡（官方音乐 App 搜索页的结构）。
    // 上一版整屏拍立得 surface 被用户否了（多个网格混在一起像万花筒），分行 + 标签才看得清「搜了什么」。
    const songResults = results;
    const playlistResults = useMemo(() => collections.filter(c => c.type === 'playlist'), [collections]);
    const albumResults = useMemo(() => collections.filter(c => c.type === 'album'), [collections]);

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

    // 输入联想 + 类型搜索集合卡：同一次防抖里取，provider 没实现就各自空。
    useEffect(() => {
        if (!isSearchOpen || !isOnlineTab || searchQuery.trim().length === 0) {
            setSuggestions([]);
            setCollections([]);
            setActiveSuggestion(-1);
            return;
        }

        const timer = window.setTimeout(() => {
            const query = searchQuery.trim();
            void omni.searchSmartboxSuggestions(searchSourceTab, query)
                .then(items => setSuggestions(items))
                .catch(() => setSuggestions([]));
            void omni.searchProviderCollections(searchSourceTab, query, { limit: 12, offset: 0 })
                .then(page => setCollections(page.items.map(item => createOnlineGridViewCollection(item, searchSourceTab))))
                .catch(() => setCollections([]));
        }, SUGGESTION_DEBOUNCE_MS);
        setActiveSuggestion(-1);
        return () => window.clearTimeout(timer);
    }, [isOnlineTab, isSearchOpen, searchQuery, searchSourceTab]);

    // 歌曲长列表的滚动位置：搜索词变化时归零，否则新结果会停在旧偏移上看着像空列表。
    const [songListScrollTop, setSongListScrollTop] = useState(0);
    useEffect(() => {
        setSongListScrollTop(0);
    }, [searchQuery]);

    // 三个结果横条各要一个独立的拖拽状态：共用一个 anchor 时，从歌单条滑到专辑条还没松手，
    // 另一个条会被带着滚。
    const carouselDrag0 = useCarouselDragScroll();
    const carouselDrag1 = useCarouselDragScroll();
    const carouselDrag2 = useCarouselDragScroll();
    // 主题背景色可能是 #rgb / #rrggbb / rgb() / rgba()。给不透明色加透明通道用；
    // 已经是 rgba 的按原样返回，避免二次包装成非法值。
    const calm = useReducedMotionFor('transitionOverlay');
    const recordSearchHistory = useCallback((value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        setHistory(previous => {
            const next = [trimmed, ...previous.filter(entry => entry !== trimmed)].slice(0, SEARCH_HISTORY_LIMIT);
            writeSearchHistory(next);
            return next;
        });
    }, []);

    const clearSearchHistory = useCallback(() => {
        setHistory([]);
        writeSearchHistory([]);
    }, []);

    const runSearch = useCallback((source?: SearchSource) => {
        // 提交就把联想与历史收掉：否则结果都出来了，输入框下面还挂着一列联想词，
        // 用户得再点一下空白处才消失。
        setSuggestionsVisible(false);
        setActiveSuggestion(-1);
        if (!source && searchQuery.trim()) {
            recordSearchHistory(searchQuery);
        }
        onSubmitSearch(source);
    }, [onSubmitSearch, recordSearchHistory, searchQuery]);

    const pickSuggestion = useCallback((suggestion: OnlineSearchSuggestion) => {
        setSuggestions([]);
        setActiveSuggestion(-1);
        setSearchQuery(suggestion.value);
        recordSearchHistory(suggestion.value);
        onSubmitSearch();
    }, [onSubmitSearch, recordSearchHistory, setSearchQuery]);

    const pickHistoryEntry = useCallback((value: string) => {
        setSearchQuery(value);
        onSubmitSearch();
    }, [onSubmitSearch, setSearchQuery]);

    return (
        <AnimatePresence>
            {isSearchOpen && (
                <motion.section
                    // 入场减速到达、退出比入场快：同一距离用同一时长会让人觉得「退出去真慢」。
                    // 位移收小到 12px：28px 的滑移在满屏浮层上像抽屉而不是浮层。
                    initial={calm ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.99 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={calm ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.995 }}
                    transition={
                        calm
                            ? { duration: 0 }
                            : { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }
                    }
                    className={`fixed inset-0 flex flex-col overflow-hidden px-3 py-4 sm:px-6 sm:py-6 ${
                        hasCollection ? 'z-[5]' : 'z-50'
                    }`}
                    style={{
                        color: theme.primaryColor,
                        // 主题背景色 + 透明度：硬编码深灰会让搜索台在你换的任何主题里都像一块
                        // 贴上去的补丁。 daylight 用更高不透明度压住后面的内容保证可读性。
                        backgroundColor: withAlpha(theme.backgroundColor, isDaylight ? 0.96 : 0.92),
                        backdropFilter: 'blur(24px)',
                    }}
                >
                    <header className="mx-auto flex w-full max-w-5xl shrink-0 flex-col gap-3">
                        <div className="flex items-center gap-3">
                            <form
                                className={`relative flex-1 rounded-2xl border ${
                                    isDaylight ? 'border-black/10 bg-black/[0.04]' : 'border-white/10 bg-white/[0.05]'
                                }`}
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    runSearch();
                                }}
                            >
                                {isSearching ? (
                                    <Loader2 className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin opacity-50" />
                                ) : (
                                    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 opacity-45" />
                                )}
                                <input
                                    value={searchQuery}
                                    onChange={event => setSearchQuery(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (suggestions.length === 0) return;
                                        if (event.key === 'ArrowDown') {
                                            event.preventDefault();
                                            setActiveSuggestion(previous => (previous + 1) % suggestions.length);
                                            return;
                                        }
                                        if (event.key === 'ArrowUp') {
                                            event.preventDefault();
                                            setActiveSuggestion(previous => (previous <= 0 ? suggestions.length - 1 : previous - 1));
                                            return;
                                        }
                                        if (event.key === 'Enter' && activeSuggestion >= 0) {
                                            event.preventDefault();
                                            pickSuggestion(suggestions[activeSuggestion]);
                                        }
                                    }}
                                    onFocus={() => { setIsHistoryVisible(true); setSuggestionsVisible(true); }}
                                    onBlur={() => {
                                        // 点别处先清掉上一个，别让连续 blur 叠出多个定时器。
                                        if (blurDismissTimerRef.current) window.clearTimeout(blurDismissTimerRef.current);
                                        blurDismissTimerRef.current = window.setTimeout(() => {
                                            blurDismissTimerRef.current = null;
                                            setIsHistoryVisible(false);
                                            setSuggestionsVisible(false);
                                        }, HISTORY_BLUR_DELAY_MS);
                                    }}
                                    placeholder={t('search.placeholder')}
                                    className="w-full bg-transparent py-3.5 pl-11 pr-4 text-sm outline-none"
                                    autoFocus
                                />

                                {searchQuery.trim().length === 0 && isHistoryVisible && history.length > 0 && (
                                    <div
                                        className={`absolute left-0 right-0 top-full z-10 mt-2 rounded-2xl border p-2 ${
                                            isDaylight ? 'border-black/10 bg-white shadow-lg' : 'border-white/10 bg-[#141418] shadow-xl'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between px-2 pb-1">
                                            <span className="flex items-center gap-1.5 text-xs opacity-55">
                                                <Clock3 size={13} />
                                                {t('search.history')}
                                            </span>
                                            <button
                                                type="button"
                                                onMouseDown={event => event.preventDefault()}
                                                onClick={clearSearchHistory}
                                                className="text-xs opacity-55 transition-opacity hover:opacity-90"
                                            >
                                                {t('search.clearHistory')}
                                            </button>
                                        </div>
                                        <div className="flex flex-col">
                                            {history.map(entry => (
                                                <button
                                                    key={entry}
                                                    type="button"
                                                    onMouseDown={event => event.preventDefault()}
                                                    onClick={() => pickHistoryEntry(entry)}
                                                    className="rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-black/5"
                                                >
                                                    {entry}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {suggestionsVisible && searchQuery.trim().length > 0 && suggestions.length > 0 && (
                                    <div
                                        className={`absolute left-0 right-0 top-full z-10 mt-2 rounded-2xl border p-2 ${
                                            isDaylight ? 'border-black/10 bg-white shadow-lg' : 'border-white/10 bg-[#141418] shadow-xl'
                                        }`}
                                    >
                                        <div className="flex flex-col">
                                            {suggestions.map((suggestion, index) => (
                                                <button
                                                    key={`${suggestion.kind}:${suggestion.value}:${index}`}
                                                    type="button"
                                                    onMouseDown={event => event.preventDefault()}
                                                    onMouseEnter={() => setActiveSuggestion(index)}
                                                    onClick={() => pickSuggestion(suggestion)}
                                                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                                                        index === activeSuggestion ? (isDaylight ? 'bg-black/10' : 'bg-white/10') : (isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5')
                                                    }`}
                                                >
                                                    {suggestion.kind === 'singer'
                                                        ? <User size={15} className="shrink-0 opacity-55" />
                                                        : <Music size={15} className="shrink-0 opacity-55" />}
                                                    <span className="truncate">{suggestion.value}</span>
                                                    {suggestion.detail && (
                                                        <span className="truncate text-xs opacity-50">{suggestion.detail}</span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </form>
                            <button
                                type="button"
                                onClick={onClose}
                                className={`rounded-full p-3 ${
                                    isDaylight ? 'bg-black/5 hover:bg-black/10' : 'bg-white/10 hover:bg-white/15'
                                }`}
                                aria-label={t('ui.backToHome')}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <nav className="flex gap-2 overflow-x-auto pb-1">
                            {sources.map(source => (
                                <button
                                    type="button"
                                    key={source}
                                    onClick={() => {
                                        if (source !== searchSourceTab) {
                                            runSearch(source);
                                        }
                                    }}
                                    className={`rounded-full px-4 py-2 text-xs font-medium transition-colors ${
                                        source === searchSourceTab
                                            ? 'shadow-sm'
                                            : isDaylight
                                                ? 'bg-black/5 text-black/60 hover:bg-black/10'
                                                : 'bg-white/5 text-white/60 hover:bg-white/10'
                                    }`}
                                    style={source === searchSourceTab ? {
                                        backgroundColor: theme.accentColor,
                                        color: theme.backgroundColor,
                                    } : undefined}
                                >
                                    {getSourceLabel(source)}
                                </button>
                            ))}
                        </nav>
                    </header>

                    {/* 搜索中的细进度条：只在「已经有结果、正在刷新」时出现。
                        比把正文换成大转圈温和得多——用户还看得见上一批结果，同时知道在刷新。 */}
                    {isSearching && results.length > 0 && (
                        <div className="mx-auto w-full max-w-5xl px-1">
                            <div className="h-0.5 w-full overflow-hidden rounded-full bg-current/10">
                                <div className="h-full w-1/3 animate-[searchSweep_1.1s_ease-in-out_infinite] rounded-full bg-current/50" />
                            </div>
                        </div>
                    )}

                    <div className="mx-auto mt-3 min-h-0 w-full max-w-5xl flex-1 select-none overflow-y-auto overscroll-contain">
                        {searchError && results.length === 0 && !isSearching ? (
                            <div className="flex h-full flex-col items-center justify-center gap-3 text-center opacity-65">
                                <AlertCircle size={32} />
                                <p>{t('search.error')}</p>
                                <button
                                    type="button"
                                    onClick={() => runSearch()}
                                    className="rounded-full border border-current/15 px-4 py-2 text-sm"
                                >
                                    {t('search.retry')}
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-6 pb-8">
                                <h2 className="truncate text-lg font-semibold">
                                    {searchQuery.trim() || t('search.placeholder')}
                                </h2>
                                {isSearching && results.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center gap-3 py-16 opacity-65">
                                        <Loader2 className="h-6 w-6 animate-spin opacity-60" />
                                        <p className="text-sm">{t('search.searching')}</p>
                                    </div>
                                ) : (
                                    <>
                                        {songResults.length > 0 && (
                                            <section>
                                                <h3 className="mb-2 text-sm font-medium opacity-60">{t('search.songs')}</h3>
                                                {/* 歌曲结果用虚拟长列表，不再是一条横着拖的小卡条：
                                                    一屏放得下几十行、上下直接滚，行高固定不抖动。 */}
                                                <div className="h-[clamp(18rem,52vh,34rem)]">
                                                    <SearchResultsList
                                                        tracks={songResults}
                                                        scrollScope={searchQuery}
                                                        scrollTop={songListScrollTop}
                                                        onScrollTopChange={setSongListScrollTop}
                                                        isDaylight={isDaylight}
                                                        onPlayTrack={(track) => {
                                                            // playSong 会把视图切到播放器页，但工作台是盖在视图上的
                                                            // overlay——不关掉它，看到的还停在搜索页。播放+关层=落地歌词页。
                                                            onPlayTrack(track);
                                                            onClose();
                                                        }}
                                                        onAddTrackToQueue={onAddTrackToQueue}
                                                        onOpenArtist={onOpenArtist}
                                                        onOpenAlbum={onOpenAlbum}
                                                    />
                                                </div>
                                                {hasMore && (
                                                    <div className="flex justify-center pt-1">
                                                        <button
                                                            type="button"
                                                            disabled={isLoadingMore}
                                                            onClick={onLoadMore}
                                                            className={`rounded-full border px-5 py-2 text-sm disabled:opacity-50 ${
                                                                isDaylight
                                                                    ? 'border-black/10 bg-black/5 hover:bg-black/10'
                                                                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                                                            }`}
                                                        >
                                                            {isLoadingMore ? t('localMusic.searching') : t('home.loadMore')}
                                                        </button>
                                                    </div>
                                                )}
                                            </section>
                                        )}
                                        {playlistResults.length > 0 && (
                                            <section>
                                                <h3 className="mb-2 text-sm font-medium opacity-60">{t('search.playlist')}</h3>
                                                <div
                                                    className="flex gap-3 overflow-x-auto pb-2 select-none [touch-action:pan-x]"
                                                    {...carouselDrag1}
                                                >
                                                    {playlistResults.map(collection => (
                                                        <button
                                                            key={collectionKey(collection)}
                                                            type="button"
                                                            onClick={() => onOpenCollection(collection)}
                                                            className={`w-[8.5rem] shrink-0 overflow-hidden rounded-2xl border p-2 text-left transition-colors ${
                                                                isDaylight ? 'border-black/10 bg-black/[0.04] hover:bg-black/[0.08]' : 'border-white/10 bg-white/[0.05] hover:bg-white/[0.09]'
                                                            }`}
                                                        >
                                                            {collection.coverUrl ? (
                                                                <img
                                                                    src={collection.coverUrl}
                                                                    alt=""
                                                                    loading="lazy"
                                                                    className="aspect-square w-full rounded-xl object-cover"
                                                                />
                                                            ) : (
                                                                <div className={`aspect-square w-full rounded-xl ${
                                                                    isDaylight ? 'bg-black/10' : 'bg-white/10'
                                                                }`} />
                                                            )}
                                                            <p className="mt-2 line-clamp-2 text-xs font-medium leading-snug">{collection.name}</p>
                                                            <p className="truncate text-[11px] opacity-50">
                                                                {collection.trackCount ? `${collection.trackCount} ${t('playlist.tracks')}` : ''}
                                                            </p>
                                                        </button>
                                                    ))}
                                                </div>
                                            </section>
                                        )}
                                        {albumResults.length > 0 && (
                                            <section>
                                                <h3 className="mb-2 text-sm font-medium opacity-60">{t('search.album')}</h3>
                                                <div
                                                    className="flex gap-3 overflow-x-auto pb-2 select-none [touch-action:pan-x]"
                                                    {...carouselDrag2}
                                                >
                                                    {albumResults.map(collection => (
                                                        <button
                                                            key={collectionKey(collection)}
                                                            type="button"
                                                            onClick={() => onOpenCollection(collection)}
                                                            className={`w-[8.5rem] shrink-0 overflow-hidden rounded-2xl border p-2 text-left transition-colors ${
                                                                isDaylight ? 'border-black/10 bg-black/[0.04] hover:bg-black/[0.08]' : 'border-white/10 bg-white/[0.05] hover:bg-white/[0.09]'
                                                            }`}
                                                        >
                                                            {collection.coverUrl ? (
                                                                <img
                                                                    src={collection.coverUrl}
                                                                    alt=""
                                                                    loading="lazy"
                                                                    className="aspect-square w-full rounded-xl object-cover"
                                                                />
                                                            ) : (
                                                                <div className={`aspect-square w-full rounded-xl ${
                                                                    isDaylight ? 'bg-black/10' : 'bg-white/10'
                                                                }`} />
                                                            )}
                                                            <p className="mt-2 line-clamp-2 text-xs font-medium leading-snug">{collection.name}</p>
                                                            <p className="truncate text-[11px] opacity-50">
                                                                {collection.description || collection.artists?.map(a => a.name).join(', ') || ''}
                                                            </p>
                                                        </button>
                                                    ))}
                                                </div>
                                            </section>
                                        )}
                                        {songResults.length === 0 && playlistResults.length === 0 && albumResults.length === 0 && (
                                            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                                                <p className="text-sm opacity-60">
                                                    {searchError ? t('search.error') : t('home.noResults')}
                                                </p>
                                                {/* 空结果是最容易卡住用户的地方：给一条能照做的下一步，
                                                    而不是让他对着一句「没有」猜。 */}
                                                {!searchError && (
                                                    <p className="max-w-sm text-xs opacity-40">
                                                        {t('search.noResultsHint')}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </>
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
