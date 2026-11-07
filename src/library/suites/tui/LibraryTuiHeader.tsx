import React from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryCollectionDescriptor } from '../../core/collection/collection.contract';
import type { CollectionResourceSnapshot } from '../../core/shared/resource.contract';
import type { LibraryCapability } from '../../core/shared/capability.contract';
import type { CollectionMutationSnapshot } from '../../core/collection/mutations/mutations.contract';
import { resolveCollectionSyncCounts } from '../../core/collection/collectionProgress';

// src/library/suites/tui/LibraryTuiHeader.tsx
// TUI 的状态栏：返回、集合名（改名后显示新名字）、订阅星标、来源、加载进度（中断时可续传）、重新拉取、
// 改名 / 删除集合，每日推荐的日期，以及当前筛选。变更类的按钮只在 suite 声明了、且变更控制器说这个集合
// 支持时出现（调用方算好 show* 传进来），进行中的状态读控制器快照。
// 文案沿用网格已有的 playlist.* / options.* / home.* 条目，两个 renderer 对同一状态说同一句话。

/** 变更控制器在状态栏上的那部分：显示与否由调用方按「声明 ∩ 能力」决定。 */
export type LibraryTuiHeaderMutations = {
    snapshot: CollectionMutationSnapshot;
    showSubscribe: boolean;
    showRename: boolean;
    showDelete: boolean;
    showDailyDate: boolean;
    onToggleSubscribe: () => void;
    onRename: () => void;
    onDelete: () => void;
    onDailyDate: (date: string, afresh?: boolean) => void;
};

type LibraryTuiHeaderProps = {
    collection: LibraryCollectionDescriptor;
    /** 显示的名字：改名成功、宿主描述还没跟上时是新名字。 */
    title: string;
    snapshot: CollectionResourceSnapshot | null;
    mutations: LibraryTuiHeaderMutations;
    query: string;
    scopeCount: number;
    reload: LibraryCapability;
    accentColor: string;
    onBack: () => void;
    onReload: () => void;
    onResumeSync: () => void;
};

const sourceLabel = (collection: LibraryCollectionDescriptor, t: (key: string, options?: Record<string, unknown>) => string) => {
    if (collection.source === 'online') return t('libraryTui.sourceOnline', { provider: collection.providerId });
    return collection.source === 'local' ? t('libraryTui.sourceLocal') : t('libraryTui.sourceNavidrome');
};

const LibraryTuiHeader: React.FC<LibraryTuiHeaderProps> = ({
    collection,
    title,
    snapshot,
    mutations,
    query,
    scopeCount,
    reload,
    accentColor,
    onBack,
    onReload,
    onResumeSync,
}) => {
    const { t } = useTranslation();
    const loaded = snapshot?.tracks.length ?? 0;
    const total = snapshot?.detail?.trackCount ?? collection.trackCount;
    const counts = resolveCollectionSyncCounts(loaded, total);
    const sync = snapshot?.sync ?? { status: 'none' as const };
    const isLoading = !snapshot || snapshot.status === 'idle' || snapshot.status === 'loading';
    const mutation = mutations.snapshot;
    const isAlbum = mutation.branches.isOnlineAlbum;
    const subscribeTitle = mutation.subscribed
        ? t(isAlbum ? 'options.unsubscribeAlbum' : 'options.unsubscribePlaylist')
        : t(isAlbum ? 'options.subscribeAlbum' : 'options.subscribePlaylist');
    const deleteLabel = mutation.branches.isLocalFolderCollection ? t('localMusic.delete') : t('localMusic.deletePlaylist');

    return (
        <header className="shrink-0 border-b border-current/15 px-4 py-2 text-[13px]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <button type="button" onClick={onBack} className="opacity-70 hover:opacity-100" data-tui-back>
                    {`[← ${t('libraryTui.back')}]`}
                </button>
                <span className="font-bold" style={{ color: accentColor }} data-tui-title>{title}</span>
                {mutations.showSubscribe && (
                    <button
                        type="button"
                        data-tui-subscribe={mutation.subscribing ? 'pending' : mutation.subscribed ? 'on' : 'off'}
                        onClick={mutations.onToggleSubscribe}
                        disabled={mutation.subscribing}
                        title={subscribeTitle}
                        aria-label={subscribeTitle}
                        aria-pressed={Boolean(mutation.subscribed)}
                        className="hover:opacity-100 disabled:opacity-40"
                        style={{ color: mutation.subscribed ? accentColor : undefined, opacity: mutation.subscribed ? 1 : 0.7 }}
                    >
                        {mutation.subscribing ? '[…]' : mutation.subscribed ? '[★]' : '[☆]'}
                    </button>
                )}
                <span className="opacity-50">{sourceLabel(collection, t)}</span>
                <span className="tabular-nums opacity-70">
                    {counts ? t('libraryTui.loadedOfTotal', counts) : t('libraryTui.loaded', { loaded: loaded.toLocaleString() })}
                </span>
                {sync.status === 'syncing' && (
                    <span className="opacity-70" data-tui-sync="syncing">
                        {counts ? t('playlist.syncProgress', counts) : t('playlist.loading')}
                    </span>
                )}
                {sync.status === 'interrupted' && (
                    <button
                        type="button"
                        data-tui-sync="interrupted"
                        onClick={onResumeSync}
                        title={t('playlist.syncFailedHint', { error: sync.message })}
                        className="underline decoration-dotted"
                    >
                        {`${counts ? t('playlist.syncInterruptedProgress', counts) : t('playlist.syncInterrupted')} · ${t('ui.retry')}`}
                    </button>
                )}
                {reload.supported && (
                    <button
                        type="button"
                        onClick={onReload}
                        disabled={!reload.enabled}
                        className="opacity-70 hover:opacity-100 disabled:opacity-30"
                    >
                        {`[${t('playlist.reload')}]`}
                    </button>
                )}
                {mutations.showRename && (
                    <button
                        type="button"
                        data-tui-action="rename"
                        onClick={mutations.onRename}
                        disabled={mutation.sourceActionPending}
                        className="opacity-70 hover:opacity-100 disabled:opacity-30"
                    >
                        {`[${t('libraryTui.rename')}]`}
                    </button>
                )}
                {mutations.showDelete && (
                    <button
                        type="button"
                        data-tui-action="delete-collection"
                        onClick={mutations.onDelete}
                        disabled={mutation.sourceActionPending}
                        className="text-red-500 opacity-80 hover:opacity-100 disabled:opacity-30"
                    >
                        {`[${deleteLabel}]`}
                    </button>
                )}
                {isLoading && <span className="opacity-50">{t('playlist.loading')}</span>}
            </div>
            {mutations.showDailyDate && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1" role="group" aria-label={t('home.recommendationDate')} data-tui-daily-date>
                    <span className="opacity-50">{`${t('home.recommendationDate')}:`}</span>
                    {['', ...mutation.dailyHistoryDates].map(date => {
                        const isCurrent = date === mutation.dailyDate;
                        return (
                            <button
                                key={date || 'today'}
                                type="button"
                                aria-pressed={isCurrent}
                                disabled={isLoading || isCurrent}
                                onClick={() => mutations.onDailyDate(date)}
                                className="tabular-nums disabled:cursor-default"
                                style={{ color: isCurrent ? accentColor : undefined, opacity: isCurrent ? 1 : 0.6 }}
                            >
                                {`[${date || t('home.todayRecommendations')}]`}
                            </button>
                        );
                    })}
                    <button
                        type="button"
                        onClick={() => mutations.onDailyDate('', true)}
                        disabled={isLoading || Boolean(mutation.dailyDate)}
                        title={t('home.refreshRecommendations')}
                        aria-label={t('home.refreshRecommendations')}
                        className="opacity-70 hover:opacity-100 disabled:opacity-30"
                    >
                        [↻]
                    </button>
                </div>
            )}
            <div className="mt-1 flex items-center gap-3 opacity-70">
                <span data-tui-filter>{query ? t('libraryTui.filter', { query }) : t('libraryTui.filterHint')}</span>
                <span className="tabular-nums opacity-70">{t('libraryTui.scope', { count: scopeCount })}</span>
            </div>
        </header>
    );
};

export default LibraryTuiHeader;
