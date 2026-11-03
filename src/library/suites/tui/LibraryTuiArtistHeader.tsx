import React from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryCollectionDescriptor } from '../../core/collection/collection.contract';
import type { LibraryArtistCapabilities, LibraryArtistSnapshot } from '../../core/artist/artist.contract';

// src/library/suites/tui/LibraryTuiArtistHeader.tsx
// TUI 歌手页的状态栏：返回、歌手名（与别名）、来源、热门歌曲与专辑数、加载状态（加载中 / 专辑分页中 / 分页失败可续 /
// 加载失败可重试）、重新加载、「加入热门歌曲」、编辑本地歌手，可展开的简介，以及当前筛选。按钮只在 suite 声明了、
// 且 core 说这个歌手支持时出现（调用方传 offers）；文案沿用网格歌手页与集合页已有的条目，两套 UI 对同一状态说同一句话。

type LibraryTuiArtistHeaderProps = {
    collection: LibraryCollectionDescriptor;
    snapshot: LibraryArtistSnapshot | null;
    capabilities: LibraryArtistCapabilities;
    offers: (action: keyof LibraryArtistCapabilities) => boolean;
    query: string;
    shownAlbumCount: number;
    isBioExpanded: boolean;
    accentColor: string;
    onToggleBio: () => void;
    onBack: () => void;
    onReload: () => void;
    onRetryAlbums: () => void;
    onEnqueueScope: () => void;
    onEditEntity: () => void;
};

const sourceLabel = (collection: LibraryCollectionDescriptor, t: (key: string, options?: Record<string, unknown>) => string) => {
    if (collection.source === 'online') return t('libraryTui.sourceOnline', { provider: collection.providerId });
    return collection.source === 'local' ? t('libraryTui.sourceLocal') : t('libraryTui.sourceNavidrome');
};

const LibraryTuiArtistHeader: React.FC<LibraryTuiArtistHeaderProps> = ({
    collection,
    snapshot,
    capabilities,
    offers,
    query,
    shownAlbumCount,
    isBioExpanded,
    accentColor,
    onToggleBio,
    onBack,
    onReload,
    onRetryAlbums,
    onEnqueueScope,
    onEditEntity,
}) => {
    const { t } = useTranslation();
    const detail = snapshot?.detail ?? null;
    const status = snapshot?.status ?? 'idle';
    const isLoading = status === 'idle' || status === 'loading';
    const albumSync = snapshot?.albumSync ?? { state: 'none' as const };
    // 被暂停的分页（资源刚被复用、ensure 马上会续上）按「还在加载」显示。
    const albumsLoading = albumSync.state === 'syncing' || (albumSync.state === 'interrupted' && albumSync.reason === 'paused');
    const albumsFailed = albumSync.state === 'interrupted' && albumSync.reason === 'failed';
    const albumCount = snapshot?.albums.length ?? 0;
    const description = detail?.description?.trim() ?? '';
    const alias = detail?.aliases?.[0];

    return (
        <header className="shrink-0 border-b border-current/15 px-4 py-2 text-[13px]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <button type="button" onClick={onBack} className="opacity-70 hover:opacity-100" data-tui-back>
                    {`[← ${t('libraryTui.back')}]`}
                </button>
                <span className="font-bold" style={{ color: accentColor }} data-tui-title>{detail?.name || collection.name}</span>
                {alias && <span className="opacity-50">{alias}</span>}
                <span className="opacity-50">{`${t('navidrome.artists') || 'Artists'} · ${sourceLabel(collection, t)}`}</span>
                {detail && (
                    <span className="tabular-nums opacity-70" data-tui-artist-counts>
                        {t('libraryTui.artistCounts', { songs: snapshot?.topSongs.length ?? 0, albums: albumCount })}
                    </span>
                )}
                {isLoading && <span className="opacity-50" data-tui-status="loading">{t('playlist.loading')}</span>}
                {status === 'ready' && albumsLoading && (
                    <span className="opacity-70" data-tui-status="syncing">{t('libraryTui.artistAlbumsLoading')}</span>
                )}
                {status === 'error' && (
                    <button type="button" data-tui-retry="reload" onClick={onReload} className="underline decoration-dotted">
                        {`[${t('ui.retry')}]`}
                    </button>
                )}
                {status === 'ready' && albumsFailed && offers('resume-sync') && (
                    <button
                        type="button"
                        data-tui-retry="albums"
                        onClick={onRetryAlbums}
                        className="underline decoration-dotted"
                    >
                        {`${t('libraryTui.artistAlbumsInterrupted')} · [${t('ui.retry')}]`}
                    </button>
                )}
                {status !== 'error' && offers('reload') && (
                    <button
                        type="button"
                        data-tui-action="reload"
                        onClick={onReload}
                        disabled={!capabilities.reload.enabled}
                        className="opacity-70 hover:opacity-100 disabled:opacity-30"
                    >
                        {`[${t('playlist.reload')}]`}
                    </button>
                )}
                {offers('enqueue-scope') && (
                    <button
                        type="button"
                        data-tui-action="enqueue-top-songs"
                        onClick={onEnqueueScope}
                        disabled={!capabilities['enqueue-scope'].enabled}
                        className="opacity-70 hover:opacity-100 disabled:opacity-30"
                    >
                        {`[${t('artistGrid.addTopSongsToQueue')}]`}
                    </button>
                )}
                {offers('edit-entity') && (
                    <button
                        type="button"
                        data-tui-action="edit-entity"
                        onClick={onEditEntity}
                        className="opacity-70 hover:opacity-100"
                    >
                        {`[${t('libraryTui.artistEdit')}]`}
                    </button>
                )}
            </div>
            {description && (
                <div className="mt-1 flex items-start gap-2 opacity-70" data-tui-bio={isBioExpanded ? 'expanded' : 'collapsed'}>
                    <p className={isBioExpanded
                        ? 'max-h-40 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words custom-scrollbar'
                        : 'min-w-0 flex-1 truncate'}
                    >
                        {isBioExpanded ? description : description.replace(/\s+/g, ' ')}
                    </p>
                    <button type="button" onClick={onToggleBio} className="shrink-0 opacity-70 hover:opacity-100" data-tui-bio-toggle>
                        {`[${t(isBioExpanded ? 'libraryTui.bioLess' : 'libraryTui.bioMore')}]`}
                    </button>
                </div>
            )}
            <div className="mt-1 flex items-center gap-3 opacity-70">
                <span data-tui-filter>{query ? t('libraryTui.filter', { query }) : t('libraryTui.filterHint')}</span>
                {query && (
                    <span className="tabular-nums opacity-70">{t('libraryTui.homeShown', { shown: shownAlbumCount, total: albumCount })}</span>
                )}
            </div>
        </header>
    );
};

export default LibraryTuiArtistHeader;
