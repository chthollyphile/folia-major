import type { CollectionLoadError, CollectionLoadStatus, CollectionSyncState } from '../../core/shared/resource.contract';
import type { LibraryMutationResult } from '../../core/collection/mutations/mutations.contract';
import type { CollectionSyncCounts } from '../../core/collection/collectionProgress';
import type { BravaisSeamStatus, BravaisSeamSync } from './bravaisSeamModels';

// src/library/suites/bravais/bravaisCollectionStatus.ts
// 集合层的状态投影（设计稿 §10.6），纯规则：加载中、后台补页、补页中断（续传）、错误（重试）、空、过滤无结果——
// 错误与「本来就空」分开（文案、图标、动作都不同）；动作结果的判别式翻成缝底状态行的提示（busy 不提示）。
// 文案由调用方注入（surface 用 i18n），这里只决定「哪一种」。另有补页期间无限拼贴的循环周期（B6 遗留的整面翻牌）。

export type CollectionStatusInput = {
    /** 资源快照的状态；还没有快照时为 null（当作加载中）。 */
    status: CollectionLoadStatus | null;
    error: CollectionLoadError | null;
    sync: CollectionSyncState;
    /** 资源里已取得的曲目数、上游总数（拿不到时 undefined）。 */
    loadedCount: number;
    totalCount: number | undefined;
    /** 层上的条目数（全量）、过滤命中数、过滤是否生效。 */
    itemCount: number;
    matchCount: number;
    isFilterActive: boolean;
};

export type CollectionStatusLabels = {
    loading: string;
    notPublic: string;
    loadFailed: (message: string) => string;
    empty: string;
    noMatch: string;
    retry: string;
    clearFilter: string;
    syncProgress: (counts: CollectionSyncCounts | null) => string;
    syncInterrupted: (counts: CollectionSyncCounts | null) => string;
    syncFailedHint: (message: string) => string;
};

export type CollectionStatusHandlers = {
    reload?: () => void;
    clearFilter: () => void;
    resumeSync: () => void;
};

export type CollectionStatusProjection = {
    status?: BravaisSeamStatus;
    sync?: BravaisSeamSync;
    /** 首屏加载中（空画框轻微呼吸）；错误不呼吸。 */
    loading: boolean;
};

const isLoadingStatus = (status: CollectionLoadStatus | null) => status === null || status === 'idle' || status === 'loading';

export const projectCollectionStatus = (
    input: CollectionStatusInput,
    labels: CollectionStatusLabels,
    handlers: CollectionStatusHandlers,
    counts: CollectionSyncCounts | null,
): CollectionStatusProjection => {
    const loading = isLoadingStatus(input.status) && input.itemCount === 0 && !input.error;
    let status: BravaisSeamStatus | undefined;
    if (input.error && !input.isFilterActive) {
        status = {
            tone: 'error',
            text: input.error.kind === 'not-public' ? labels.notPublic : labels.loadFailed(input.error.message),
            action: handlers.reload ? { id: 'retry', label: labels.retry, run: handlers.reload } : undefined,
        };
    } else if (loading) {
        status = { tone: 'loading', text: labels.loading };
    } else if (input.isFilterActive && input.matchCount === 0) {
        status = { tone: 'no-match', text: labels.noMatch, action: { id: 'clear-filter', label: labels.clearFilter, run: handlers.clearFilter } };
    } else if (input.itemCount === 0 && !isLoadingStatus(input.status)) {
        status = { tone: 'empty', text: labels.empty };
    }

    let sync: BravaisSeamSync | undefined;
    if (input.sync.status === 'syncing') {
        sync = { state: 'syncing', label: labels.syncProgress(counts) };
    } else if (input.sync.status === 'interrupted') {
        sync = {
            state: 'interrupted',
            label: labels.syncInterrupted(counts),
            title: labels.syncFailedHint(input.sync.message),
            onResume: handlers.resumeSync,
        };
    }
    return { status, sync, loading };
};

/**
 * 后台补页期间无限拼贴的循环周期（B6 遗留：周期跟着条目数变，每来一页屏内大部分 slot 换内容、整面翻一次）。
 * 补页进行中或中断时按上游总数算周期：已取得的条目位置不变，还没到的位置是墙面，新页只让这些 slot 翻牌；
 * 补页结束后回到条目数（上游总数与实际条目数不同时——去重、不可播放被跳过——在结束那一刻整面对齐一次）。
 */
export const resolveWallPeriodCount = ({
    itemCount,
    totalCount,
    sync,
}: {
    itemCount: number;
    totalCount: number | undefined;
    sync: CollectionSyncState;
}): number => {
    if (sync.status === 'none' || typeof totalCount !== 'number' || !Number.isFinite(totalCount)) return itemCount;
    return Math.max(itemCount, Math.floor(totalCount));
};

export type MutationNoticeLabels = {
    limitReached: string;
    dislikeFailed: string;
    failed: string;
    stale: string;
    unsupported: string;
};

/**
 * 动作结果 → 缝底状态行的提示（设计稿 §10.6）：ok 与 busy 不提示；每日推荐的「不喜欢」失败与次数用完用网格同一句话；
 * 其余失败带上控制器给的原因。
 */
export const describeMutationResult = (
    result: LibraryMutationResult,
    labels: MutationNoticeLabels,
    { isDailyRemoval = false }: { isDailyRemoval?: boolean } = {},
): { text: string; tone: 'info' | 'error' } | null => {
    if (result.ok || result.reason === 'busy') return null;
    switch (result.reason) {
        case 'limit-reached': return { text: labels.limitReached, tone: 'info' };
        case 'stale': return { text: labels.stale, tone: 'info' };
        case 'unsupported': return { text: labels.unsupported, tone: 'info' };
        default:
            if (isDailyRemoval) return { text: labels.dislikeFailed, tone: 'error' };
            return { text: result.message ? `${labels.failed} · ${result.message}` : labels.failed, tone: 'error' };
    }
};
