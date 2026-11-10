import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryArtistSnapshot } from '../../core/artist/artist.contract';
import type { LibraryArtistActionId, LibraryArtistSurfaceProps } from '../../core/suite/suite.contract';
import type { ArtistView } from '../../core/artist/useArtistView';
import { projectArtistStatus, resolveArtistWallPeriod } from './bravaisArtistModel';
import type { BravaisLayerEntries, BravaisLayerWall, BravaisSeamArtist, BravaisSeamCollection, BravaisSeamFilter, BravaisSeamMenuItem } from './bravaisSeamModels';
import type { useBravaisMutationNotice } from './useBravaisMutationNotice';

// src/library/suites/bravais/useBravaisArtistSeam.ts
// 歌手页在缝与墙上的投影（设计稿 §10.4 / §10.6）：缝里的「关于艺术家」（头像、名字、别名、简介、统计附注）、过滤输入位（只筛专辑名）、
// 专辑分页进度 / 续页、状态行（加载、错误 + 重试、空、过滤无结果）、「⋯ 更多」（重新拉取、编辑本地歌手实体）与缝底的
// 提示；墙的内容规则（专辑分页期间的循环周期、有限拼贴的规划条目数、过滤身份、首屏呼吸）；列表面板。
// 缝里的集合块（BravaisSeamCollection）与集合页同一套组件，所以这里产出同一个形状。入口只在「声明 ∩ 能力」时出现。
// 回调一律经 latest ref 读最新的视图与动作，层描述只在显示的东西变了时换身份。

type Notice = ReturnType<typeof useBravaisMutationNotice>;

export type BravaisArtistSeamInput = {
    collection: LibraryArtistSurfaceProps['collection'];
    snapshot: LibraryArtistSnapshot | null;
    view: ArtistView;
    /** 墙上实际显示的专辑数（按提交了的过滤词）。 */
    shownAlbumCount: number;
    /** 会话里的过滤词与墙用的过滤词（防抖、组词按住之后）。 */
    query: string;
    committedQuery: string;
    setQuery: (query: string) => void;
    notice: Notice;
};

export const useBravaisArtistSeam = (input: BravaisArtistSeamInput) => {
    const { t } = useTranslation();
    const latest = useRef(input);
    latest.current = input;
    const { collection, snapshot, view, notice } = input;
    const { offers, capabilities } = view;
    const declares = (action: LibraryArtistActionId) => offers(action);
    const detail = snapshot?.status === 'ready' ? snapshot.detail : null;
    const albumTotal = typeof detail?.albumCount === 'number' && detail.albumCount > 0 ? detail.albumCount : undefined;
    const albumSync = snapshot?.albumSync ?? { state: 'none' as const };
    const isFilterActive = input.committedQuery.trim().length > 0;
    const topSongCount = snapshot?.topSongs.length ?? 0;
    const albumCount = snapshot?.albums.length ?? 0;

    // 状态行与专辑分页（错误与空分开；分页失败时整行是「续页」）。
    const projection = projectArtistStatus(
        { snapshot, albumTotal, shownAlbumCount: input.shownAlbumCount, isFilterActive },
        {
            loading: t('playlist.loading'),
            loadFailed: error => t('playlist.loadFailed', {
                error: error === 'source-unavailable' ? t('search.sourceNavidrome') : (collection.name || ''),
            }),
            empty: t('home.loadingLibrary'),
            noMatch: t('libraryBravaisArtist.noMatchingAlbums'),
            retry: t('ui.retry'),
            clearFilter: t('libraryBravaisCollection.clearFilter'),
            albumsSyncing: (loaded, total) => (total
                ? t('libraryBravaisArtist.albumsSyncing', { loaded, total })
                : t('libraryBravaisArtist.albumsSyncingOpen', { loaded })),
            albumsInterrupted: loaded => t('libraryBravaisArtist.albumsInterrupted', { loaded }),
        },
        {
            reload: capabilities.reload.supported && declares('reload') ? () => latest.current.view.actions.reload() : undefined,
            retryAlbums: declares('resume-sync') ? () => latest.current.view.actions.retryAlbums() : undefined,
            clearFilter: () => latest.current.setQuery(''),
        },
    );
    const status = projection.status;
    const sync = projection.sync;

    // 「⋯ 更多」：重新拉取（在线 / Navidrome）、编辑本地歌手实体（宿主对话框）。
    const reloadEnabled = capabilities.reload.enabled;
    const menu = useMemo<BravaisSeamMenuItem[]>(() => {
        const items: BravaisSeamMenuItem[] = [];
        if (declares('reload')) {
            items.push({ id: 'reload', label: t('playlist.reload'), disabled: !reloadEnabled, run: () => latest.current.view.actions.reload() });
        }
        if (declares('edit-entity')) {
            items.push({
                id: 'edit-entity',
                label: t('localMusic.entityInfo', { kind: t('localMusic.artistLabel') }),
                run: () => latest.current.view.actions.editEntity(),
            });
        }
        return items;
        // declares 每次渲染新建，按它背后的 offers 比较。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [offers, reloadEnabled, t]);

    const matchLabel = t('libraryBravaisArtist.albumMatchCount', { matches: input.shownAlbumCount, total: albumCount });
    // 缝里的过滤输入位（只筛专辑名，core 约定；占位文字照实说「过滤专辑」）。
    const filter = useMemo<BravaisSeamFilter | undefined>(() => (offers('filter') ? {
        query: input.query,
        placeholder: t('libraryBravaisArtist.filterPlaceholder'),
        matchLabel,
        clearLabel: t('libraryBravaisCollection.clearFilter'),
        setQuery: (query: string) => latest.current.setQuery(query),
    } : undefined), [input.query, matchLabel, offers, t]);

    const seamCollection = useMemo<BravaisSeamCollection>(() => ({
        sync,
        status,
        notice: notice.notice,
        menu,
        moreLabel: t('libraryBravaisCollection.more'),
        listLabel: t('libraryBravaisCollection.list'),
        form: null,
    // status / sync 是每次渲染新算的小对象：按它们的文案比较，免得层描述白换身份。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [menu, notice.notice, status?.tone, status?.text, sync?.state, sync?.label, t]);

    // 统计只有一行：「N 首歌 · M 张专辑」（详情里的总数；专辑数没有就用上游总数或已载的条数）。热门歌曲契约里固定 10 首，
    // 不是信息，不显示。书脊与元数据行用的也是它，完整信息条里它作为「关于艺术家」的附注，元数据行不再重复。
    const detailTrackCount = typeof detail?.trackCount === 'number' && detail.trackCount > 0 ? detail.trackCount : 0;
    const statsAlbumCount = albumTotal ?? albumCount;
    const stats = [
        detailTrackCount > 0 ? t('libraryBravaisArtist.songCount', { count: detailTrackCount }) : '',
        statsAlbumCount > 0 || detailTrackCount === 0 ? t('libraryBravaisArtist.albumCount', { count: statsAlbumCount }) : '',
    ].filter(Boolean).join(' · ');

    // 缝里的「关于艺术家」（ArtistGridView 的头像、简介、统计，加上别名）。
    const seamArtist = useMemo<BravaisSeamArtist | undefined>(() => {
        if (!detail) return undefined;
        const aliases = (detail.aliases ?? []).map(alias => alias.trim()).filter(Boolean);
        return {
            name: detail.name,
            coverUrl: detail.coverUrl || undefined,
            aliases: aliases.length > 0 ? t('libraryBravaisArtist.aliases', { names: aliases.join(' / ') }) : undefined,
            description: detail.description?.trim() || undefined,
            stats: stats || undefined,
        };
    }, [detail, stats, t]);

    // 墙的内容规则：专辑分页期间的循环周期（新页只翻新 slot）、有限拼贴的规划条目数、过滤身份、首屏呼吸。
    const periodCount = resolveArtistWallPeriod({ topSongCount, albumCount, albumTotal, albumSync });
    const wall = useMemo<BravaisLayerWall>(() => ({
        periodCount,
        planCount: periodCount,
        filterKey: isFilterActive ? input.committedQuery : '',
        loading: projection.loading,
    }), [input.committedQuery, isFilterActive, periodCount, projection.loading]);

    // 列表面板（热门歌曲与专辑按墙上的顺序）；没有条目动作（歌手页的条目不进「⋯」）。
    const hasQuery = Boolean(input.query);
    const entries = useMemo<BravaisLayerEntries>(() => ({
        hasPanel: true,
        panelTitle: t('libraryBravaisArtist.panelTitle'),
        listCrumb: t('libraryBravaisCollection.listCrumb'),
        hasQuery,
        clearQuery: () => latest.current.setQuery(''),
        hasForm: false,
    }), [hasQuery, t]);

    // 元数据行：统计那一行（过滤中是专辑的「匹配 / 总数」）。
    const meta = isFilterActive ? matchLabel : stats;

    return { seamCollection, seamArtist, filter, wall, entries, meta, isFilterActive };
};
