import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, TextField } from '../ui';
import { ArrowLeft, Check, ChevronDown, Play, Plus, RefreshCw, Search, X } from 'lucide-react';
import type { Theme, UnifiedSong } from '../../types';
import type { ProviderCollection } from '../../types/onlineMusic';
import { useLxWorkspaceStore, type LxWorkspaceTab } from '../../stores/useLxWorkspaceStore';
import { omni } from '../../services/onlineMusic/omni';
import { lxBrowse } from '../../services/onlineMusic/lxmusic/lxFacade';
import { lxSourceStore } from '../../services/onlineMusic/lxmusic/lxSourceStore';
import { getLxPreferences } from '../../services/onlineMusic/lxmusic/lxPreferences';
import {
    LX_PUBLIC_PLATFORMS,
    type LxApiChart,
    type LxApiRadioProgram,
    type LxPublicPlatform,
} from '../../services/onlineMusic/lxmusic/lxFacade';
import { LxTrackList } from './LxTrackList';
import { LxMinePanel } from './LxMinePanel';
import {
    addSongToLxPlaylist,
    createLxSavedPlaylist,
    getLxSavedPlaylists,
    subscribeLxSavedPlaylists,
} from '../../services/onlineMusic/lxmusic/lxSavedPlaylists';
import { ensureSquareCollections, getSquareCollections, subscribeSquareCollections } from '../../services/onlineMusic/lxmusic/lxSquareCollections';
import { LxSourcePanel } from './LxSourcePanel';
import { errorText, formatCount, formatDate, platformBadge } from './lxUi';
import './lxWorkspace.css';

// src/components/lxmusic/LxWorkspace.tsx
// 洛雪工作台：照洛雪移动端的「歌单」页重排。
//   头部一行标题 + 音源入口，下面一条分段胶囊（歌单 / 电台 / 专辑 / 榜单 / 本地 / 搜索），
//   平台不再单独占一排按钮：头部挂一个「当前平台」胶囊，点开在整页之上浮一层选四家，
//   换平台就换这一页的内容。
//   歌单、专辑、电台都是封面网格，点开是曲目表；榜单左榜右歌；搜索四家一起搜。

const PILLS: ReadonlyArray<{ key: LxWorkspaceTab; label: string }> = [
    { key: 'playlist', label: '歌单' },
    { key: 'radio', label: '电台' },
    { key: 'album', label: '专辑' },
    { key: 'chart', label: '榜单' },
    { key: 'mine', label: '我的' },
    { key: 'local', label: '本地' },
    { key: 'search', label: '搜索' },
];

/** 这两页不分平台，平台按钮跟着藏起来。 */
const GLOBAL_TABS: ReadonlyArray<LxWorkspaceTab> = ['mine', 'search', 'local', 'source'];

/** 浮层里每家一句「这页能读到什么」：省得点进去才发现这家没有电台或新碟。 */
const PLATFORM_HINTS: Record<LxPublicPlatform, string> = {
    wy: '歌单 · 新碟 · 电台',
    tx: '歌单 · 新碟（没有电台）',
    kg: '歌单 · 新碟（没有电台）',
    kw: '只有歌单广场',
};

// 一页 30：酷狗的歌单广场接口固定每页 30 条，页大小对不上的话翻页会漏歌。
const PAGE_SIZE = 30;
const TRACK_PAGE_SIZE = 60;
/** 搜索时每个平台各取多少（四家交替，一屏大概 4 倍条数）。 */
const SEARCH_PAGE_SIZE = 24;

type DetailView = {
    kind: 'playlist' | 'album';
    platform: LxPublicPlatform;
    id: string;
    title: string;
    subtitle?: string;
    coverUrl?: string;
};

type LxWorkspaceProps = {
    theme: Theme;
    isDaylight: boolean;
    onClose: () => void;
    onPlayTrack: (track: UnifiedSong) => void;
    onAddToQueue: (track: UnifiedSong) => void;
};

const platformOfCollection = (collection: ProviderCollection, fallback: LxPublicPlatform): LxPublicPlatform => {
    const raw = collection.providerData?.platform;
    if (raw === 'wy' || raw === 'kg' || raw === 'kw' || raw === 'tx') return raw;
    return fallback;
};

export const LxWorkspace: React.FC<LxWorkspaceProps> = ({ theme, isDaylight, onClose, onPlayTrack, onAddToQueue }) => {
    const tab = useLxWorkspaceStore((state) => state.tab);
    const setTab = useLxWorkspaceStore((state) => state.setTab);

    const [platform, setPlatform] = useState<LxPublicPlatform>('wy');
    // 平台选择的浮层开关：展开时遮住整页，点空白处或按 Esc 收起。
    const [platformSheetOpen, setPlatformSheetOpen] = useState(false);
    // 回调里读当前平台：请求回来时若用户已经换了平台，就别把旧结果写进去。
    const platformRef = useRef(platform);
    platformRef.current = platform;
    const tabRef = useRef(tab);
    tabRef.current = tab;

    // 换页签就收起平台浮层：切到「我的 / 搜索 / 本地」时那一层本来就没有意义。
    useEffect(() => {
        setPlatformSheetOpen(false);
    }, [tab]);

    useEffect(() => {
        if (!platformSheetOpen) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setPlatformSheetOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [platformSheetOpen]);

    // 音源变动后重算「能不能放」的提示（store 不是响应式的，用一个计数逼一次重渲染）。
    const [, bumpSourceTick] = useState(0);
    const sourceCount = lxSourceStore.getSources().filter((source) => source.enabled).length;
    const handleSourceChanged = useCallback(() => bumpSourceTick((prev) => prev + 1), []);
    const [refreshTick, setRefreshTick] = useState(0);

    // 播放回执：播放器在浮层底下，点完不给一句反馈会以为没反应。
    const [playHint, setPlayHint] = useState<string | null>(null);
    const playHintTimer = useRef<number | null>(null);
    const showHint = useCallback((text: string, durationMs = 2600) => {
        setPlayHint(text);
        if (playHintTimer.current) window.clearTimeout(playHintTimer.current);
        playHintTimer.current = window.setTimeout(() => setPlayHint(null), durationMs);
    }, []);
    const handlePlay = useCallback((song: UnifiedSong) => {
        // 播放一律先走导入的音源；只有「一个音源都没有、且连公开直链兜底也关了」才拦下来。
        const hasSources = lxSourceStore.canResolveAny('musicUrl');
        if (!hasSources && !getLxPreferences().allowPublicFallback) {
            showHint('还没有可用的音源，且已关闭公开直链兜底，先去右上角「音源」导入一个', 3600);
            return;
        }
        onPlayTrack(song);
        showHint(hasSources ? `正在播放 · ${song.name}` : `未导入音源，尝试公开直链 · ${song.name}`);
    }, [onPlayTrack, showHint]);

    // 「收进列表」：点曲目行的书签按钮先弹这一层，选一个已有列表，或直接输名字新建一个。
    const savedPlaylists = useSyncExternalStore(subscribeLxSavedPlaylists, getLxSavedPlaylists, getLxSavedPlaylists);
    const [saveSong, setSaveSong] = useState<UnifiedSong | null>(null);
    const [saveName, setSaveName] = useState('');
    const handleSaveSong = useCallback((song: UnifiedSong) => {
        setSaveName('');
        setSaveSong(song);
    }, []);
    const addToExisting = useCallback((playlistId: string, playlistName: string) => {
        if (!saveSong) return;
        const ok = addSongToLxPlaylist(playlistId, saveSong);
        setSaveSong(null);
        showHint(ok ? `已收进「${playlistName}」` : `「${playlistName}」里已经有这首了`);
    }, [saveSong, showHint]);
    const createAndSave = useCallback(() => {
        if (!saveSong) return;
        const created = createLxSavedPlaylist(saveName);
        if (!created) {
            showHint('先给列表起个名字；如果已经建满 60 个，删一个再建。', 3400);
            return;
        }
        addSongToLxPlaylist(created.id, saveSong);
        setSaveSong(null);
        setSaveName('');
        showHint(`已新建「${created.name}」并收进去，之后在「我的」里能打开它`);
    }, [saveName, saveSong, showHint]);

    useEffect(() => () => {
        if (playHintTimer.current) window.clearTimeout(playHintTimer.current);
    }, []);

    // 歌单 / 专辑 / 电台 共用一个列表状态
    const [collections, setCollections] = useState<ProviderCollection[]>([]);    const [programs, setPrograms] = useState<LxApiRadioProgram[]>([]);
    const [browseLoading, setBrowseLoading] = useState(false);
    const [browseHasMore, setBrowseHasMore] = useState(false);
    const [browseOffset, setBrowseOffset] = useState(0);
    const [browseError, setBrowseError] = useState<string | null>(null);

    // 歌单 / 专辑里的曲目
    const [detail, setDetail] = useState<DetailView | null>(null);
    const [detailSongs, setDetailSongs] = useState<UnifiedSong[]>([]);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailHasMore, setDetailHasMore] = useState(false);
    const [detailOffset, setDetailOffset] = useState(0);
    const [detailError, setDetailError] = useState<string | null>(null);

    // 榜单
    const [charts, setCharts] = useState<LxApiChart[]>([]);
    const [chartId, setChartId] = useState<string | null>(null);
    const [chartSongs, setChartSongs] = useState<UnifiedSong[]>([]);
    const [chartLoading, setChartLoading] = useState(false);
    const [chartError, setChartError] = useState<string | null>(null);

    // 搜索
    const [query, setQuery] = useState('');
    const [submittedQuery, setSubmittedQuery] = useState('');
    const [searchSongs, setSearchSongs] = useState<UnifiedSong[]>([]);
    const [searchOffset, setSearchOffset] = useState(0);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchHasMore, setSearchHasMore] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);

    // ------------------------------------------------------------ 歌单 / 专辑 / 电台

    const loadBrowse = useCallback(async (targetPlatform: LxPublicPlatform, targetTab: LxWorkspaceTab, offset: number, append: boolean) => {
        setBrowseLoading(true);
        if (!append) setBrowseError(null);
        try {
            if (targetTab === 'radio') {
                const page = await lxBrowse.radioPrograms(targetPlatform, PAGE_SIZE, offset);
                if (platformRef.current !== targetPlatform || tabRef.current !== targetTab) return;
                setPrograms((prev) => (append ? [...prev, ...page.items] : page.items));
                setBrowseOffset(offset + page.items.length);
                setBrowseHasMore(page.hasMore);
                return;
            }
            const page = targetTab === 'album'
                ? await lxBrowse.albumSquare(targetPlatform, PAGE_SIZE, offset)
                : await lxBrowse.playlistSquare(targetPlatform, PAGE_SIZE, offset);
            if (platformRef.current !== targetPlatform || tabRef.current !== targetTab) return;
            const items = page.items.map(lxBrowse.toCollection);
            setCollections((prev) => (append ? [...prev, ...items] : items));
            setBrowseOffset(offset + page.items.length);
            setBrowseHasMore(page.hasMore);
        } catch (error) {
            if (platformRef.current !== targetPlatform) return;
            setBrowseError(`${targetTab === 'album' ? '专辑' : targetTab === 'radio' ? '电台' : '歌单'}读取失败：${errorText(error)}`);
        } finally {
            setBrowseLoading(false);
        }
    }, []);

    useEffect(() => {
        if (tab !== 'playlist' && tab !== 'album' && tab !== 'radio') return;
        setCollections([]);
        setPrograms([]);
        setBrowseOffset(0);
        setBrowseHasMore(false);
        void loadBrowse(platform, tab, 0, false);
    }, [tab, platform, refreshTick, loadBrowse]);

    // 「全部」：歌单页默认四家混排（和洛雪官方桌面版一样，一屏能看到各家），
    // 点了具体平台才只看那一家。混排的名单来自首页也在用的那份广场快照。
    const [squareAll, setSquareAll] = useState(true);
    const squareCollections = useSyncExternalStore(subscribeSquareCollections, getSquareCollections, getSquareCollections);
    const lastSquareRefresh = useRef(refreshTick);
    useEffect(() => {
        if (tab !== 'playlist' || !squareAll) return;
        const force = refreshTick !== lastSquareRefresh.current;
        lastSquareRefresh.current = refreshTick;
        void ensureSquareCollections(force);
    }, [tab, squareAll, refreshTick]);

    // ------------------------------------------------------------ 榜单

    useEffect(() => {
        if (tab !== 'chart') return undefined;
        // 首页榜单列表点进来时会在 store 里留一个目标：先把平台切到那一家，
        // 下一轮（platform 变了）再落到那个榜，别被这里默认的第一个榜顶掉。
        const pending = useLxWorkspaceStore.getState().pendingChart;
        if (pending && pending.platform !== platform) {
            setPlatform(pending.platform);
            return undefined;
        }
        let cancelled = false;
        setChartError(null);
        setCharts([]);
        setChartId(null);
        setChartSongs([]);
        void lxBrowse.charts(platform)
            .then((list) => {
                if (cancelled) return;
                setCharts(list);
                // 目标榜 id 不一定还在（平台会调表），找不到就退回第一个。
                const wanted = pending && pending.platform === platform
                    ? list.find((chart) => chart.id === pending.chartId)?.id ?? list[0]?.id ?? null
                    : list[0]?.id ?? null;
                setChartId(wanted);
                if (pending && pending.platform === platform) useLxWorkspaceStore.getState().clearPendingChart();
                if (list.length === 0) setChartError('这个平台没有可读的榜单。');
            })
            .catch((error) => {
                if (!cancelled) setChartError(`榜单读取失败：${errorText(error)}`);
            });
        return () => { cancelled = true; };
    }, [tab, platform, refreshTick]);

    useEffect(() => {
        if (tab !== 'chart' || !chartId) return undefined;
        let cancelled = false;
        setChartLoading(true);
        setChartSongs([]);
        setChartError(null);
        void lxBrowse.chartTracks(platform, chartId, TRACK_PAGE_SIZE, 0)
            .then((page) => {
                if (cancelled) return;
                setChartSongs(page.items.map(lxBrowse.toSong));
            })
            .catch((error) => {
                if (!cancelled) setChartError(`榜单曲目读取失败：${errorText(error)}`);
            })
            .finally(() => { if (!cancelled) setChartLoading(false); });
        return () => { cancelled = true; };
    }, [tab, platform, chartId]);

    // ------------------------------------------------------------ 曲目表

    const openCollection = useCallback(async (view: DetailView) => {
        setDetail(view);
        setDetailSongs([]);
        setDetailHasMore(false);
        setDetailOffset(0);
        setDetailError(null);
        setDetailLoading(true);
        try {
            const page = view.kind === 'album'
                ? await lxBrowse.albumTracks(view.platform, view.id, TRACK_PAGE_SIZE, 0)
                : await lxBrowse.playlistTracks(view.platform, view.id, TRACK_PAGE_SIZE, 0);
            setDetailSongs(page.items.map(lxBrowse.toSong));
            setDetailOffset(page.items.length);
            setDetailHasMore(page.hasMore);
        } catch (error) {
            setDetailError(`曲目读取失败：${errorText(error)}`);
        } finally {
            setDetailLoading(false);
        }
    }, []);

    const openPlaylistCard = useCallback((collection: ProviderCollection) => {
        const owner = platformOfCollection(collection, platform);
        // 卡片 id 是带平台前缀的 `wy:123`；调接口要用原生 id（providerData 里留着）。
        const nativeId = typeof collection.providerData?.nativeId === 'string'
            ? collection.providerData.nativeId
            : String(collection.id);
        const kind = collection.type === 'album' ? 'album' : 'playlist';
        void openCollection({
            kind,
            platform: owner,
            id: nativeId,
            title: collection.name,
            subtitle: [collection.creator?.nickname, formatDate(collection.updatedAt)].filter(Boolean).join(' · '),
            coverUrl: collection.coverUrl,
        });
    }, [openCollection, platform]);

    const loadMoreDetail = useCallback(async () => {
        if (!detail || detailLoading) return;
        setDetailLoading(true);
        try {
            const page = detail.kind === 'album'
                ? await lxBrowse.albumTracks(detail.platform, detail.id, TRACK_PAGE_SIZE, detailOffset)
                : await lxBrowse.playlistTracks(detail.platform, detail.id, TRACK_PAGE_SIZE, detailOffset);
            setDetailSongs((prev) => [...prev, ...page.items.map(lxBrowse.toSong)]);
            setDetailOffset((prev) => prev + page.items.length);
            setDetailHasMore(page.hasMore);
        } catch (error) {
            setDetailError(`曲目读取失败：${errorText(error)}`);
        } finally {
            setDetailLoading(false);
        }
    }, [detail, detailLoading, detailOffset]);

    // ------------------------------------------------------------ 搜索

    const runSearch = useCallback(async (keyword: string, append: boolean) => {
        const trimmed = keyword.trim();
        if (!trimmed) return;
        setSearchLoading(true);
        if (!append) setSearchError(null);
        const offset = append ? searchOffset : 0;
        try {
            // limit 是「每个平台各取多少」，所以一页最多 4 倍条数。
            const page = await omni.searchProviderSongs('lxmusic', trimmed, { limit: SEARCH_PAGE_SIZE, offset });
            if (!page) {
                setSearchError('搜索没有返回结果。');
                return;
            }
            setSubmittedQuery(trimmed);
            setSearchSongs((prev) => (append ? [...prev, ...page.items] : page.items));
            setSearchHasMore(page.hasMore);
            setSearchOffset(append ? page.nextOffset : SEARCH_PAGE_SIZE);
        } catch (error) {
            setSearchError(`搜索失败：${errorText(error)}`);
        } finally {
            setSearchLoading(false);
        }
    }, [searchOffset]);

    // ------------------------------------------------------------ 渲染片段

    // 酷我 / 酷狗有公开的免费直链（付费 / 独家曲目才需要音源），网易云与 QQ 只能靠导入的音源。
    const hasFreeDirect = (target: string): boolean => target === 'kw' || target === 'kg';

    // 跨平台兜底之后，「这一家没有音源」不再等于放不了：只要还有任意一个音源就行。
    const hasAnySource = lxSourceStore.canResolveAny('musicUrl');
    const canPlayOn = (target: string): boolean => hasFreeDirect(target) || hasAnySource;

    const showPlatformRow = !GLOBAL_TABS.includes(tab);
    // 「全部平台」只在歌单广场有意义（四家混排）；其余页签一律落在具体某一家。
    const squareActive = tab === 'playlist' && squareAll;
    const currentPlatform = LX_PUBLIC_PLATFORMS.find((item) => item.key === platform) ?? LX_PUBLIC_PLATFORMS[0];
    const platformTriggerLabel = squareActive ? '全部平台' : currentPlatform.label;

    const platformTrigger = showPlatformRow ? (
        <Button
            type="button"
            className="lx-platform-trigger"
            aria-haspopup="dialog"
            aria-expanded={platformSheetOpen}
            title="切换平台"
            onClick={() => setPlatformSheetOpen((prev) => !prev)}
        >
            <span
                className="lx-platform-mark"
                style={{ background: squareActive ? 'linear-gradient(135deg,#a3a3a3,#525252)' : currentPlatform.color }}
            >
                {squareActive ? '全' : currentPlatform.label.slice(0, 1)}
            </span>
            <span className="lx-platform-trigger-label">{platformTriggerLabel}</span>
            <ChevronDown size={13} className="lx-platform-trigger-caret" data-open={platformSheetOpen} />
        </Button>
    ) : null;

    // 浮层：点空白处收起，面板贴右上角，不参与页面排版，也就不会把卡片流往下推。
    const platformSheet = showPlatformRow && platformSheetOpen ? (
        <div className="lx-platform-layer" role="presentation" onClick={() => setPlatformSheetOpen(false)}>
            <div
                className="lx-platform-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="选择平台"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="lx-platform-sheet-head">
                    <span>选择平台</span>
                    <Button type="button" className="lx-icon-btn" onClick={() => setPlatformSheetOpen(false)} aria-label="关闭">
                        <X size={14} />
                    </Button>
                </div>
                <div className="lx-platform-list">
                    {tab === 'playlist' ? (
                        <Button
                            type="button"
                            className="lx-platform-option"
                            data-active={squareActive}
                            onClick={() => {
                                if (!squareActive) {
                                    setSquareAll(true);
                                    setDetail(null);
                                }
                                setPlatformSheetOpen(false);
                            }}
                        >
                            <span className="lx-platform-mark" style={{ background: 'linear-gradient(135deg,#a3a3a3,#525252)' }}>全</span>
                            <span className="lx-platform-option-text">
                                <b>全部平台</b>
                                <em>四家混排，洛雪默认那屏</em>
                            </span>
                            {squareActive ? <Check size={15} /> : null}
                        </Button>
                    ) : null}
                    {LX_PUBLIC_PLATFORMS.map((item) => {
                        const active = platform === item.key && !squareActive;
                        return (
                            <Button
                                key={item.key}
                                type="button"
                                className="lx-platform-option"
                                data-active={active}
                                style={{ '--lx-platform-color': item.color } as React.CSSProperties}
                                onClick={() => {
                                    if (tab === 'playlist') setSquareAll(false);
                                    if (platform !== item.key) {
                                        setPlatform(item.key);
                                        setDetail(null);
                                    }
                                    setPlatformSheetOpen(false);
                                }}
                            >
                                <span className="lx-platform-mark" style={{ background: item.color }}>{item.label.slice(0, 1)}</span>
                                <span className="lx-platform-option-text">
                                    <b>{item.label}</b>
                                    <em>{PLATFORM_HINTS[item.key]}</em>
                                </span>
                                {active ? <Check size={15} /> : null}
                            </Button>
                        );
                    })}
                </div>
            </div>
        </div>
    ) : null;

    const renderCard = (collection: ProviderCollection) => {
        const count = formatCount(collection.playCount);
        const meta = [collection.creator?.nickname, formatDate(collection.updatedAt)].filter(Boolean).join(' · ');
        return (
            <Button type="button" key={String(collection.id)} className="lx-card" onClick={() => openPlaylistCard(collection)}>
                <div className="lx-cover">
                    {collection.coverUrl
                        ? <img src={collection.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                        : <span>{collection.name.slice(0, 1)}</span>}
                    {count ? <span className="lx-cover-count"><Play size={9} />{count}</span> : null}
                </div>
                <div className="lx-card-title">{collection.name}</div>
                {meta ? <div className="lx-card-meta">{meta}</div> : null}
            </Button>
        );
    };

    const renderProgram = (program: LxApiRadioProgram) => (
        <Button
            type="button"
            key={program.id}
            className="lx-card"
            onClick={() => handlePlay(lxBrowse.toSong(program.song))}
        >
            <div className="lx-cover">
                {program.coverUrl
                    ? <img src={program.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    : <span>{program.name.slice(0, 1)}</span>}
                <span className="lx-cover-count">电台</span>
            </div>
            <div className="lx-card-title">{program.name}</div>
            {program.djName ? <div className="lx-card-meta">{program.djName}</div> : null}
        </Button>
    );

    /** 空状态按「这一页 × 这一家」说清楚，别拿同一句话糊过去。 */
    const emptyText = (): string => {
        if (tab === 'playlist' && squareAll) {
            return '四家的歌单广场都没取到。先点右上角刷新一次；还空着就点到某一家单独看。';
        }
        if (tab === 'radio') {
            return platform === 'wy'
                ? '网易云暂时没返回电台节目。'
                : `${platformBadge(platform).label}没有公开的电台接口，换到网易云看看。`;
        }
        if (tab === 'album') {
            return platform === 'wy' || platform === 'kg'
                ? '这家暂时没返回新碟，稍后再试。'
                : `${platformBadge(platform).label}没有公开的新碟列表，换到网易云或酷狗看看。`;
        }
        return '这个平台暂时没有返回歌单，换一家看看。';
    };

    const renderBrowseTab = () => {
        if (detail) {
            return (
                <>
                    <div className="lx-detail-head">
                        <div className="lx-cover lx-detail-cover">
                            {detail.coverUrl
                                ? <img src={detail.coverUrl} alt="" referrerPolicy="no-referrer" />
                                : <span>{detail.title.slice(0, 1)}</span>}
                        </div>
                        <div className="lx-detail-text">
                            <div className="lx-detail-kind">
                                {detail.kind === 'album' ? '专辑' : '歌单'} · {platformBadge(detail.platform).label}
                            </div>
                            <div className="lx-detail-title">{detail.title}</div>
                            <div className="lx-detail-sub">{detail.subtitle || `${detailSongs.length} 首`}</div>
                        </div>
                    </div>
                    <div className="lx-detail-actions">
                        <Button
                            type="button"
                            className="lx-btn lx-btn-play"
                            disabled={detailSongs.length === 0}
                            onClick={() => {
                                const [first, ...rest] = detailSongs;
                                rest.forEach((song) => onAddToQueue(song));
                                if (first) handlePlay(first);
                            }}
                        >
                            <Play size={13} fill="currentColor" />播放全部
                        </Button>
                        <Button type="button" className="lx-btn-ghost" onClick={() => setDetail(null)}>返回列表</Button>
                    </div>
                    {!canPlayOn(detail.platform) ? (
                        <div className="lx-notice" data-kind="warn">
                            还没有可用的音源，这些歌点开会放不出来。去右上角「音源」导入一个。
                        </div>
                    ) : null}
                    {detailError ? <div className="lx-notice" data-kind="warn">{detailError}</div> : null}
                    {detailLoading && detailSongs.length === 0 ? (
                        <p className="lx-empty">正在读取曲目…</p>
                    ) : detailSongs.length === 0 ? (
                        <p className="lx-empty">没有读到曲目。</p>
                    ) : (
                        <LxTrackList songs={detailSongs} onPlay={handlePlay} onQueue={onAddToQueue} onSave={handleSaveSong} />
                    )}
                    {detailHasMore ? (
                        <div className="lx-more">
                            <Button type="button" className="lx-btn-ghost" disabled={detailLoading} onClick={() => void loadMoreDetail()}>
                                {detailLoading ? '加载中…' : '加载更多'}
                            </Button>
                        </div>
                    ) : null}
                </>
            );
        }

        const allMode = tab === 'playlist' && squareAll;
        const shownCollections = allMode ? squareCollections : collections;
        const empty = tab === 'radio' ? programs.length === 0 : shownCollections.length === 0;
        const busy = browseLoading || allMode;
        return (
            <>
                {browseError ? <div className="lx-notice" data-kind="warn">{browseError}</div> : null}
                {busy && empty ? (
                    <p className="lx-empty">正在读取{tab === 'album' ? '新碟' : tab === 'radio' ? '电台' : '歌单'}…</p>
                ) : empty ? (
                    <p className="lx-empty">{emptyText()}</p>
                ) : (
                    <div className="lx-grid">
                        {tab === 'radio' ? programs.map(renderProgram) : shownCollections.map(renderCard)}
                    </div>
                )}
                {browseHasMore && !allMode ? (
                    <div className="lx-more">
                        <Button
                            type="button"
                            className="lx-btn-ghost"
                            disabled={browseLoading}
                            onClick={() => void loadBrowse(platform, tab, browseOffset, true)}
                        >
                            {browseLoading ? '加载中…' : '加载更多'}
                        </Button>
                    </div>
                ) : null}
            </>
        );
    };

    const renderChartTab = () => {
        const activeChart = charts.find((chart) => chart.id === chartId);
        return (
            <>
                {chartError ? <div className="lx-notice" data-kind="warn">{chartError}</div> : null}
                <div className="lx-chart-layout">
                    <div className="lx-chart-rail">
                        {charts.map((chart) => (
                            <Button
                                key={chart.id}
                                type="button"
                                className="lx-chart-item"
                                data-active={chart.id === chartId}
                                onClick={() => setChartId(chart.id)}
                            >
                                {chart.name}
                            </Button>
                        ))}
                    </div>
                    <div>
                        {activeChart ? (
                            <div className="lx-chart-title">
                                {platformBadge(platform).label} · {activeChart.name}
                            </div>
                        ) : null}
                        {chartLoading && chartSongs.length === 0 ? (
                            <p className="lx-empty">正在读取榜单…</p>
                        ) : chartSongs.length === 0 ? (
                            <p className="lx-empty">这个榜暂时没有曲目。</p>
                        ) : (
                            <LxTrackList songs={chartSongs} onPlay={handlePlay} onQueue={onAddToQueue} onSave={handleSaveSong} />
                        )}
                    </div>
                </div>
            </>
        );
    };

    const renderSearchTab = () => (
        <>
            <div className="lx-search-row">
                <TextField
                    className="lx-input"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') void runSearch(query, false); }}
                    placeholder="搜歌名 / 歌手 / 专辑（四家一起搜）"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
                <Button type="button" className="lx-btn" disabled={searchLoading || !query.trim()} onClick={() => void runSearch(query, false)}>
                    {searchLoading ? '搜索中…' : '搜索'}
                </Button>
            </div>
            {searchError ? <div className="lx-notice" data-kind="warn">{searchError}</div> : null}
            {searchSongs.length === 0 ? (
                <p className="lx-empty">
                    {submittedQuery ? `没搜到「${submittedQuery}」。` : '输入关键词，网易云 / QQ / 酷狗 / 酷我的结果会一起列出来。'}
                </p>
            ) : (
                <>
                    <div className="lx-result-head">「{submittedQuery}」的结果 · {searchSongs.length} 首</div>
                    <LxTrackList songs={searchSongs} onPlay={handlePlay} onQueue={onAddToQueue} onSave={handleSaveSong} />
                </>
            )}
            {searchHasMore ? (
                <div className="lx-more">
                    <Button type="button" className="lx-btn-ghost" disabled={searchLoading} onClick={() => void runSearch(submittedQuery, true)}>
                        {searchLoading ? '加载中…' : '加载更多'}
                    </Button>
                </div>
            ) : null}
        </>
    );

    const renderLocalTab = () => (
        <div className="lx-blank">
            <Search size={26} strokeWidth={1.4} />
            <p className="lx-blank-title">本地音乐不在这儿</p>
            <p className="lx-blank-text">
                洛雪的「本地」读的是手机里的音频文件；这个 App 的本地曲库在自己那一页。
                这里先留个说明，等本地扫描接进洛雪再补上。
            </p>
            <Button type="button" className="lx-btn-ghost" onClick={onClose}>回到 Folia</Button>
        </div>
    );

    return (
        <div
            className="lx-root"
            data-daylight={isDaylight ? 'true' : 'false'}
            style={{
                color: theme.primaryColor,
                '--lx-accent': theme.accentColor || '#e11d48',
            } as React.CSSProperties}
            role="dialog"
            aria-modal="true"
            aria-label="洛雪"
        >
            <header className="lx-header">
                <div className="lx-head-bar">
                    <Button type="button" className="lx-icon-btn" onClick={onClose} aria-label="关闭洛雪">
                        <ArrowLeft size={18} />
                    </Button>
                    <div className="lx-head-title">
                        <span className="lx-brand">洛雪</span>
                        <span className="lx-brand-sub">LX MUSIC</span>
                    </div>
                    <div style={{ flex: '1 1 auto' }} />
                    {platformTrigger}
                    <Button
                        type="button"
                        className="lx-source-btn"
                        data-active={tab === 'source'}
                        onClick={() => setTab('source')}
                        aria-label="音源"
                    >
                        <Plus size={13} />
                        音源{sourceCount > 0 ? <b>{sourceCount}</b> : null}
                    </Button>
                    <Button
                        type="button"
                        className="lx-icon-btn"
                        aria-label="刷新"
                        title="刷新"
                        onClick={() => {
                            setDetail(null);
                            setRefreshTick((prev) => prev + 1);
                        }}
                    >
                        <RefreshCw size={15} />
                    </Button>
                </div>

                <nav className="lx-seg" aria-label="洛雪页签">
                    {PILLS.map((item) => (
                        <Button
                            key={item.key}
                            type="button"
                            className="lx-seg-item"
                            data-active={tab === item.key}
                            onClick={() => {
                                if (tab === item.key) return;
                                setDetail(null);
                                setTab(item.key);
                            }}
                        >
                            {item.label}
                        </Button>
                    ))}
                </nav>
            </header>

            {platformSheet}

            <div className="lx-body">
                {tab === 'playlist' || tab === 'album' || tab === 'radio' ? renderBrowseTab() : null}
                {tab === 'chart' ? renderChartTab() : null}
                {tab === 'mine' ? <LxMinePanel onPlay={handlePlay} onQueue={onAddToQueue} onNotice={showHint} /> : null}
                {tab === 'search' ? renderSearchTab() : null}
                {tab === 'local' ? renderLocalTab() : null}
                {tab === 'source' ? <LxSourcePanel onChanged={handleSourceChanged} /> : null}
            </div>

            {saveSong ? (
                <div className="lx-save-layer" role="dialog" aria-modal="true" aria-label="收进收藏列表">
                    <div className="lx-save-card">
                        <div className="lx-save-head">
                            <span>收进收藏列表</span>
                            <Button type="button" className="lx-icon-btn" onClick={() => setSaveSong(null)} aria-label="关闭">
                                <X size={15} />
                            </Button>
                        </div>
                        <div className="lx-card-meta">{saveSong.name}</div>
                        {savedPlaylists.length > 0 ? (
                            <div className="lx-chips">
                                {savedPlaylists.map((playlist) => (
                                    <Button
                                        key={playlist.id}
                                        type="button"
                                        className="lx-btn-ghost"
                                        onClick={() => addToExisting(playlist.id, playlist.name)}
                                    >
                                        {playlist.name} · {playlist.songs.length}
                                    </Button>
                                ))}
                            </div>
                        ) : (
                            <div className="lx-card-meta">还没有列表，起个名字就建一个。</div>
                        )}
                        <div className="lx-search-row">
                            <TextField
                                className="lx-input"
                                value={saveName}
                                onChange={(event) => setSaveName(event.target.value)}
                                onKeyDown={(event) => { if (event.key === 'Enter') createAndSave(); }}
                                placeholder="新建一个列表（例如「下次接着听」）"
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                            />
                            <Button type="button" className="lx-btn" disabled={!saveName.trim()} onClick={createAndSave}>
                                新建并收进去
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}

            {playHint ? <div className="lx-toast" role="status">{playHint}</div> : null}
        </div>
    );
};

export default LxWorkspace;
