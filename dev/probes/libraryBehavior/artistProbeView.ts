import { ArtistGridInfoCutInPanel } from '../../../src/library/suites/grid/artist/ArtistGridInfoCutInPanel';
import { SidePanelList } from '../../../src/components/shared/SidePanelList';
import { GridListSearchButton } from '../../../src/components/shared/GridListSearchButton';
import { listLibrarySuites, resolveLibrarySurface } from '../../../src/library/registry';
import { getLibraryBrowseSession } from '../../../src/library/core/shared/useLibraryBrowseSessionStore';
import { artistAlbumEntryKey, artistSessionKey, artistSongEntryKey } from '../../../src/library/core/artist/artistSurface';
import { PolaroidCard } from '../../../src/library/suites/grid/shared/PolaroidCard';
import type { SongResult } from '../../../src/types';
import { getPlaybackSongKey } from '../../../src/utils/appPlaybackGuards';
import { isSongUnavailable } from '../../../src/services/onlineMusic/songAvailability';
import type { LibraryArtistResource, LibraryArtistSnapshot } from '../../../src/library/core/artist/artist.contract';
import type { LibraryCollectionDescriptor } from '../../../src/library/core/collection/collection.contract';
import { artistAlbumLink, filterArtistAlbums } from '../../../src/library/core/artist/artistModel';
import { findPresentComponent, findPresentComponents, firstHostElement, propsOf, type ProbeFiber } from '../homeBehavior/reactFiberProbe';
import type { ProbeArtistAlbum, ProbeArtistView } from './probeApi';

// dev/probes/libraryBehavior/artistProbeView.ts
// 歌手页的语义视图（`__libraryProbe.artist()`）与几个歌手页动作。P4.1 起歌手数据在宿主持有的歌手资源里：
// artist() 找到在场（不在退场中）的歌手页 surface——任何一套 suite 的（registry 里各 suite 解析出的 artist 组件，
// lazy 组件按 elementType 认）——读宿主交给它的资源（`resource` prop）的快照，再按浏览会话里的筛选词
// （P4.2 起歌手页的 query 在会话里，键是资源的 key）用 core 的 filterArtistAlbums 算出「当前显示的专辑」，
// 专辑的链接提示用 core 的 artistAlbumLink（网格专辑卡带的就是它）。网格的面板开合仍从组件树上读（TUI 没有这两个
// 面板，恒为 false）。签名与 P4.0 相同，status 多了 error。

/** 歌手页 surface 上探针要读的两个 prop（宿主交给任何 suite 的同一份契约输入）。 */
type ArtistViewProps = { collection?: LibraryCollectionDescriptor; resource?: LibraryArtistResource | null };

/** 在场（不在退场中）的歌手页 surface 实例，不论哪套 suite 渲染。 */
const artistFiber = (): ProbeFiber | null => {
    const components = [...new Set(listLibrarySuites().map(suite => resolveLibrarySurface('artist', suite.id).component))];
    return components.flatMap(component => findPresentComponents(component))[0] ?? null;
};

/** 在场歌手页的资源（宿主持有的那一个）。 */
export const presentArtistResource = (): LibraryArtistResource | null => (
    propsOf<ArtistViewProps>(artistFiber())?.resource ?? null
);

const statusOf = (snapshot: LibraryArtistSnapshot): ProbeArtistView['status'] => {
    if (snapshot.status === 'idle' || snapshot.status === 'loading') return 'loading';
    if (snapshot.status === 'error') return 'error';
    if (!snapshot.detail) return 'empty';
    const sync = snapshot.albumSync;
    if (sync.state === 'syncing' || (sync.state === 'interrupted' && sync.reason === 'paused')) return 'syncing';
    if (sync.state === 'interrupted') return 'interrupted';
    return 'ready';
};

/** 当前在场歌手页的语义视图；没有歌手页时为 null。 */
export const readArtistView = (): ProbeArtistView | null => {
    const fiber = artistFiber();
    if (!fiber) return null;
    const props = propsOf<ArtistViewProps>(fiber);
    const collection = props?.collection;
    const snapshot = props?.resource?.getSnapshot() ?? null;
    const query = collection ? getLibraryBrowseSession(artistSessionKey(collection, props?.resource)).query : '';
    const detail = snapshot?.status === 'ready' ? snapshot.detail : null;
    const songs = detail ? snapshot!.topSongs : [];
    // 网格只在有详情时摆卡片；专辑按当前筛选。
    const shownAlbums = detail ? filterArtistAlbums(snapshot!.albums, query ?? '') : [];
    const albums: ProbeArtistAlbum[] = shownAlbums.map(album => {
        const link = artistAlbumLink(album, {
            source: collection?.source ?? 'online',
            providerId: collection?.source === 'online' ? collection.providerId : undefined,
        });
        return {
            id: String(link.id),
            name: String(link.name ?? ''),
            link: { source: link.source, providerId: link.providerId, type: link.type },
        };
    });

    const cutIn = propsOf<{ isOpen: boolean }>(findPresentComponent(ArtistGridInfoCutInPanel, fiber));
    const sidePanel = propsOf<{ isOpen: boolean }>(findPresentComponent(SidePanelList, fiber));

    return {
        name: collection?.name ?? '',
        status: snapshot ? statusOf(snapshot) : 'loading',
        detail: detail
            ? { name: detail.name, cover: detail.coverUrl ?? null, hasBio: Boolean(detail.description) }
            : null,
        topSongIds: songs.map(getPlaybackSongKey),
        playableTopSongIds: songs.filter(song => !isSongUnavailable(song)).map(getPlaybackSongKey),
        albumIds: albums.map(album => album.id),
        albums,
        query,
        panels: { sidePanel: Boolean(sidePanel?.isOpen), cutIn: Boolean(cutIn?.isOpen) },
    };
};

/** 让在场歌手页的资源从头重新加载（与错误态的重试同一个入口）；没有歌手页时返回 false。 */
export const reloadArtist = (): boolean => {
    const resource = presentArtistResource();
    if (!resource) return false;
    resource.reload();
    return true;
};

type GridItemLike = {
    id: string | number;
    rawCollection?: Record<string, unknown> & { id: string | number; name?: string };
};

type SidePanelProps = {
    items: GridItemLike[];
    renderItem: (item: GridItemLike, index: number, style: Record<string, unknown>) => { props: { onClick?: () => void } };
};

/**
 * 打开歌手页上的一张专辑。网格：与点专辑侧栏那一行同一个回调（先把相机挪过去，320ms 后压栈）。TUI：双击那一行
 * （专辑列表是窗口化的，行不在 DOM 里时退回 surface 收到的 onOpenAlbum，链接提示用 core 的 artistAlbumLink——
 * 与 TUI 自己打开专辑时交给宿主的同一份）。
 */
export const openArtistAlbum = (albumId: string): boolean => {
    const fiber = artistFiber();
    if (!fiber) return false;
    const panel = propsOf<SidePanelProps>(findPresentComponent(SidePanelList, fiber));
    if (!panel) {
        const row = firstHostElement(fiber)?.querySelector<HTMLElement>(`[data-library-entry="${CSS.escape(artistAlbumEntryKey({ id: albumId }))}"]`);
        if (row) {
            row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            return true;
        }
        const props = propsOf<ArtistViewProps & { onOpenAlbum?: (id: string | number, album?: unknown) => void }>(fiber);
        const album = props?.resource?.getSnapshot().albums.find(candidate => String(candidate.id) === albumId);
        if (!album || !props?.collection || !props.onOpenAlbum) return false;
        const link = artistAlbumLink(album, {
            source: props.collection.source,
            providerId: props.collection.source === 'online' ? props.collection.providerId : undefined,
        });
        props.onOpenAlbum(link.id, link);
        return true;
    }
    const index = panel.items.findIndex(item => String(item.rawCollection?.id ?? item.id) === albumId);
    if (index < 0) return false;
    const row = panel.renderItem(panel.items[index], index, {});
    if (!row.props.onClick) return false;
    row.props.onClick();
    return true;
};

/** 浏览会话里在场歌手页的语义焦点（条目键 song:… / album:…）；没有歌手页时为 null。 */
export const readArtistFocus = (): string | null => {
    const props = propsOf<ArtistViewProps>(artistFiber());
    if (!props?.collection) return null;
    return getLibraryBrowseSession(artistSessionKey(props.collection, props.resource)).focusedEntryKey;
};

/** 网格歌手页此刻聚焦的那张卡的条目键（头像 / 简介卡或不是网格时为 null）。 */
export const readArtistGridFocus = (): string | null => {
    const focused = findPresentComponents(PolaroidCard, artistFiber())
        .map(card => propsOf<{ isFocused?: boolean; item?: { rawTrack?: SongResult; rawCollection?: { id: string | number } } }>(card))
        .find(props => props?.isFocused);
    if (!focused?.item) return null;
    if (focused.item.rawTrack) return artistSongEntryKey(focused.item.rawTrack);
    if (focused.item.rawCollection) return artistAlbumEntryKey(focused.item.rawCollection);
    return null;
};

/** 打开网格歌手页的专辑侧栏或信息面板（侧栏按钮的回调；标题是一个可点的按钮）；TUI 没有这两个面板，返回 false。 */
export const openArtistPanel = (panel: 'side' | 'cut-in'): boolean => {
    const fiber = artistFiber();
    if (!fiber) return false;
    if (panel === 'side') {
        const button = propsOf<{ onOpenList: () => void }>(findPresentComponent(GridListSearchButton, fiber));
        if (!button) return false;
        button.onOpenList();
        return true;
    }
    const title = firstHostElement(fiber)?.querySelector<HTMLButtonElement>('button[aria-expanded]');
    if (!title) return false;
    title.click();
    return true;
};
