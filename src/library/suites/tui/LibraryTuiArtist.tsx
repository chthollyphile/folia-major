import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useIsPresent } from 'framer-motion';
import { List, useListRef } from 'react-window';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import type { LibraryArtistSurfaceProps } from '../../core/suite/suite.contract';
import type { LibraryArtistAlbum } from '../../core/artist/artist.contract';
import { useArtistResourceState } from '../../core/artist/useArtistResourceState';
import { useArtistView } from '../../core/artist/useArtistView';
import { useLibraryArtistSurfaceRegistration } from '../../core/artist/useLibraryArtistSurfaceRegistration';
import { artistAlbumEntryKey, artistSongEntryKey } from '../../core/artist/artistSurface';
import { resolveTrackAlbumLink, resolveTrackArtistLinks, type TrackArtistLink } from '../../core/shared/trackLinks';
import { canResolveSongCatalogRef } from '../../../services/onlineMusic/catalogRefs';
import { useGridCommandFilter } from '../../../hooks/useGridCommandFilter';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { colorWithAlpha } from '../../../components/visualizer/colorMix';
import LibraryTuiArtistHeader from './LibraryTuiArtistHeader';
import {
    LIBRARY_TUI_ARTIST_ALBUM_COLUMNS,
    LIBRARY_TUI_ARTIST_ROW_HEIGHT,
    LIBRARY_TUI_ARTIST_SONG_COLUMNS,
    LibraryTuiArtistAlbumRow,
    LibraryTuiArtistSongRow,
    type LibraryTuiArtistAlbumRowProps,
} from './LibraryTuiArtistRows';
import { useLibraryTuiArtistFocus } from './useLibraryTuiArtistFocus';
import { useLibraryTuiArtistKeyboard } from './useLibraryTuiArtistKeyboard';

// src/library/suites/tui/LibraryTuiArtist.tsx
// 歌手页的 TUI renderer（P4.3）：状态栏（名字、可展开的简介、数量、状态与重试）、热门歌曲与专辑两栏（Tab 切换）。
// 数据是宿主持有的歌手资源（与网格订阅同一个，换 suite 不重新请求）；筛选词与焦点在浏览会话里（与网格共用），
// 能力与动作来自 core（useArtistView：声明 ∩ 能力），并向命令面板注册同一个 artist surface。
// 编辑本地歌手打开宿主挂载的实体对话框（z-[120]/[140]，在 TUI 之上）。这里不引用网格、六边形视口或转场的任何实现。

const NO_SONGS: SongResult[] = [];
const NO_ALBUMS: LibraryArtistAlbum[] = [];

/** 状态到文案：idle / loading → 加载中；ready 但没有详情 → 空态；error → 集合页同一句「加载失败」。 */
const useArtistStatusText = (props: Pick<LibraryArtistSurfaceProps, 'collection'>, snapshot: ReturnType<typeof useArtistResourceState>['snapshot']) => {
    const { t } = useTranslation();
    const status = snapshot?.status ?? 'idle';
    if (status === 'idle' || status === 'loading') return t('playlist.loading');
    if (status === 'error') {
        return t('playlist.loadFailed', {
            error: snapshot?.error === 'source-unavailable' ? t('search.sourceNavidrome') : (props.collection.name || ''),
        });
    }
    if (!snapshot?.detail) return t('home.loadingLibrary');
    return null;
};

const LibraryTuiArtist: React.FC<LibraryArtistSurfaceProps> = ({
    collection,
    resource,
    playback,
    theme,
    isDaylight,
    isInteractive,
    declaredActions,
    onEditEntity,
    onBack,
    onDone,
    onOpenAlbum,
    onOpenArtist,
}) => {
    const { t } = useTranslation();
    const isPresent = useIsPresent();
    const isActive = isInteractive && isPresent;
    const rootRef = useRef<HTMLDivElement>(null);
    const albumsRegionRef = useRef<HTMLDivElement>(null);
    const albumListRef = useListRef(null);
    const [isBioExpanded, setIsBioExpanded] = useState(false);

    const { snapshot } = useArtistResourceState(resource);
    const view = useArtistView({
        collection,
        resource,
        snapshot,
        playback,
        declaredActions,
        onEditEntity,
        onOpenAlbum,
        setStatus: setStatusMessage,
    });
    const { actions, offers } = view;
    const statusText = useArtistStatusText({ collection }, snapshot);
    const showPanes = statusText === null;

    // 筛选框贴在页面根上；会话里已有筛选时首次可交互就把它带出来（与网格一致）。
    const isFiltering = useGridCommandFilter({
        isInteractive: isActive,
        port: view.queryPort,
        anchorRef: rootRef,
        reopenIfFiltered: true,
    });
    useLibraryArtistSurfaceRegistration({ isInteractive: isActive, getState: view.surfaceState, run: view.runSurface });

    const songs = showPanes ? view.topSongs : NO_SONGS;
    const albums = showPanes ? view.shownAlbums : NO_ALBUMS;
    const songKeys = useMemo(() => songs.map(artistSongEntryKey), [songs]);
    const albumKeys = useMemo(() => albums.map(artistAlbumEntryKey), [albums]);
    const focus = useLibraryTuiArtistFocus(view.sessionKey, songKeys, albumKeys);

    const canPlay = offers('play');
    const canEnqueue = offers('enqueue');
    const canOpenAlbum = offers('open-album');
    const canOpenArtist = offers('open-artist');

    const playSongAt = (row: number) => {
        const song = songs[row];
        if (!song || !canPlay) return;
        focus.focusRow('songs', row);
        focus.persistFocus(songKeys[row]);
        actions.playSong(song);
    };
    const enqueueSongAt = (row: number) => {
        const song = songs[row];
        if (song && canEnqueue) actions.enqueueSong(song);
    };
    const openAlbumAt = (row: number) => {
        const album = albums[row];
        if (!album || !canOpenAlbum) return;
        focus.focusRow('albums', row);
        // 压入下一层之前把焦点写回会话：返回时回到这张专辑。
        focus.persistFocus(albumKeys[row]);
        actions.openAlbum(album);
    };
    // 歌曲行上的歌手 / 专辑链接：打开嵌套的歌手页 / 专辑（与网格卡片上的链接同一条规则，core/shared/trackLinks）。
    const openSongArtist = (row: number, link: TrackArtistLink) => {
        const song = songs[row];
        if (!song || link.targetId === undefined) return;
        focus.persistFocus(songKeys[row]);
        onOpenArtist(link.targetId, { ...link.artist }, song);
    };
    const openSongAlbum = (row: number, song: SongResult) => {
        const link = resolveTrackAlbumLink(song, canResolveSongCatalogRef);
        if (!link) return;
        focus.persistFocus(songKeys[row]);
        onOpenAlbum(link.targetId, { ...link.album }, song);
    };

    useLibraryTuiArtistKeyboard({
        isActive,
        isFiltering,
        rowCount: focus.rowCount,
        pageSize: Math.max(1, Math.floor((albumsRegionRef.current?.clientHeight ?? 400) / LIBRARY_TUI_ARTIST_ROW_HEIGHT) - 1),
        moveFocus: focus.moveFocus,
        onTogglePane: focus.togglePane,
        onActivateFocused: () => (focus.pane === 'songs' ? playSongAt(focus.songRow) : openAlbumAt(focus.albumRow)),
        onEnqueueFocused: () => {
            if (focus.pane === 'songs') enqueueSongAt(focus.songRow);
        },
        onPlayScope: () => {
            if (offers('play-scope')) actions.playScope();
        },
        onEnqueueScope: () => {
            if (offers('enqueue-scope')) actions.enqueueScope();
        },
        // 歌曲栏里的 Alt+Enter / Alt+Shift+Enter：打开焦点歌曲的专辑 / 第一个能打开的歌手（与集合视图同一组键）。
        onOpenAlbumFocused: () => {
            const song = focus.pane === 'songs' ? songs[focus.songRow] : undefined;
            if (song && canOpenAlbum) openSongAlbum(focus.songRow, song);
        },
        onOpenArtistFocused: () => {
            const song = focus.pane === 'songs' ? songs[focus.songRow] : undefined;
            const link = song && canOpenArtist
                ? resolveTrackArtistLinks(song, canResolveSongCatalogRef).find(candidate => candidate.targetId !== undefined)
                : undefined;
            if (link) openSongArtist(focus.songRow, link);
        },
        // 与集合视图一致的阶梯：先收起展开的简介，再撤掉筛选，最后离开。
        onEscape: () => (isBioExpanded ? setIsBioExpanded(false) : view.query ? view.setQuery('') : onBack()),
    });

    // 等 react-window 量好视口再定位：刚挂载（例如从网格切过来）时列表还没有高度。
    useEffect(() => {
        if (focus.albumRow < 0) return;
        const frame = window.requestAnimationFrame(() => {
            albumListRef.current?.scrollToRow({ index: focus.albumRow, align: 'smart', behavior: 'instant' });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [albumListRef, focus.albumRow, albums.length]);

    const accentColor = theme.accentColor || 'currentColor';
    const accentBackground = colorWithAlpha(accentColor, isDaylight ? 0.16 : 0.22);
    const dimBackground = colorWithAlpha(accentColor, isDaylight ? 0.07 : 0.1);
    const albumRowProps = useMemo<LibraryTuiArtistAlbumRowProps>(() => ({
        albums,
        entryKeys: albumKeys,
        focusedRow: focus.albumRow,
        accentBackground: focus.pane === 'albums' ? accentBackground : dimBackground,
        accentColor,
        onFocusRow: row => focus.focusRow('albums', row),
        onOpenRow: canOpenAlbum ? openAlbumAt : undefined,
    // openAlbumAt 每次渲染都是新函数，但它只读当前的焦点与视图。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [accentBackground, accentColor, albumKeys, albums, canOpenAlbum, dimBackground, focus.albumRow, focus.focusRow, focus.pane]);

    const paneTitle = (pane: 'songs' | 'albums', label: string, count: number) => (
        <div
            className="shrink-0 border-b border-current/10 px-4 py-1 text-[11px] uppercase tracking-wider"
            style={{ opacity: focus.pane === pane ? 0.9 : 0.45, color: focus.pane === pane ? accentColor : undefined }}
            data-tui-pane={pane}
            aria-current={focus.pane === pane || undefined}
        >
            {`${focus.pane === pane ? '▸ ' : '  '}${label} (${count})`}
        </div>
    );

    // 顶上让出桌面版自绘标题栏的拖拽区（h-8），与 TUI 集合视图、首页的 pt-8 一致。
    return (
        <div
            ref={rootRef}
            data-library-renderer="tui"
            data-ponder-page-scope="none"
            data-library-surface="artist"
            className="fixed inset-0 z-[110] flex flex-col overflow-hidden pt-8 font-mono"
            style={{ backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)' }}
        >
            <LibraryTuiArtistHeader
                collection={collection}
                snapshot={snapshot}
                capabilities={view.capabilities}
                offers={offers}
                query={view.query}
                shownAlbumCount={view.shownAlbums.length}
                isBioExpanded={isBioExpanded}
                accentColor={accentColor}
                onToggleBio={() => setIsBioExpanded(expanded => !expanded)}
                // [← Back] = 完成（宿主清会话与布局记录）；Esc 阶梯的最后一步走 onBack，离开但保留。
                onBack={onDone}
                onReload={actions.reload}
                onRetryAlbums={actions.retryAlbums}
                onEnqueueScope={() => void actions.enqueueScope()}
                onEditEntity={actions.editEntity}
            />
            {!showPanes ? (
                <div className="px-4 py-6 text-[13px] opacity-50" data-tui-empty>{statusText}</div>
            ) : (
                <>
                    {paneTitle('songs', t('libraryTui.artistSongsPane'), songs.length)}
                    <div className={`grid shrink-0 ${LIBRARY_TUI_ARTIST_SONG_COLUMNS} gap-x-3 px-4 py-0.5 text-[11px] uppercase tracking-wider opacity-35`}>
                        <span />
                        <span>{t('libraryTui.columnIndex')}</span>
                        <span>{t('libraryTui.columnTitle')}</span>
                        <span>{t('libraryTui.columnArtist')}</span>
                        <span>{t('libraryTui.columnAlbum')}</span>
                        <span>{t('libraryTui.columnTime')}</span>
                        <span />
                    </div>
                    <div role="listbox" aria-label={t('libraryTui.artistSongsPane')} className="shrink-0" data-tui-artist-songs>
                        {songs.length === 0 ? (
                            <div className="px-4 py-2 text-[13px] opacity-50">{t('home.loadingLibrary')}</div>
                        ) : songs.map((song, row) => {
                            const albumLink = canOpenAlbum ? resolveTrackAlbumLink(song, canResolveSongCatalogRef) : null;
                            return (
                                <LibraryTuiArtistSongRow
                                    key={songKeys[row]}
                                    song={song}
                                    index={row}
                                    entryKey={songKeys[row]}
                                    isFocused={row === focus.songRow}
                                    accentBackground={focus.pane === 'songs' ? accentBackground : dimBackground}
                                    accentColor={accentColor}
                                    enqueueLabel={t('libraryTui.enqueue')}
                                    unavailableLabel={t('status.songUnavailableTag')}
                                    videoLabel={t('status.songVideoTag')}
                                    artistLinks={resolveTrackArtistLinks(song, canResolveSongCatalogRef)}
                                    onOpenArtist={canOpenArtist ? link => openSongArtist(row, link) : undefined}
                                    onOpenAlbum={albumLink ? () => openSongAlbum(row, song) : undefined}
                                    onFocus={() => focus.focusRow('songs', row)}
                                    onPlay={() => playSongAt(row)}
                                    onEnqueue={canEnqueue ? () => enqueueSongAt(row) : undefined}
                                />
                            );
                        })}
                    </div>
                    {paneTitle('albums', t('libraryTui.artistAlbumsPane'), albums.length)}
                    <div className={`grid shrink-0 ${LIBRARY_TUI_ARTIST_ALBUM_COLUMNS} gap-x-3 px-4 py-0.5 text-[11px] uppercase tracking-wider opacity-35`}>
                        <span />
                        <span>{t('libraryTui.columnIndex')}</span>
                        <span>{t('libraryTui.columnName')}</span>
                        <span>{t('libraryTui.columnYear')}</span>
                    </div>
                    <div
                        ref={albumsRegionRef}
                        role="listbox"
                        aria-label={t('libraryTui.artistAlbumsPane')}
                        className="relative min-h-0 flex-1"
                        data-tui-artist-albums
                    >
                        {albums.length === 0 ? (
                            <div className="px-4 py-2 text-[13px] opacity-50">
                                {view.isFilterActive ? t('home.gridSearchNoResults') : t('home.loadingLibrary')}
                            </div>
                        ) : (
                            <List
                                listRef={albumListRef}
                                rowCount={albums.length}
                                rowHeight={LIBRARY_TUI_ARTIST_ROW_HEIGHT}
                                rowComponent={LibraryTuiArtistAlbumRow}
                                rowProps={albumRowProps}
                                overscanCount={6}
                                className="custom-scrollbar"
                                style={{ height: '100%', width: '100%' }}
                            />
                        )}
                    </div>
                </>
            )}
            <footer className="shrink-0 border-t border-current/10 px-4 py-1.5 text-[11px] opacity-50">
                {t('libraryTui.artistHints')}
                {(canOpenAlbum || canOpenArtist) && ` · ${t('libraryTui.hintOpenLinks')}`}
            </footer>
        </div>
    );
};

export default LibraryTuiArtist;
