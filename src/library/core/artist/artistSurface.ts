import type { SongResult } from '../../../types';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import type {
    LibraryArtistAlbum,
    LibraryArtistCapabilities,
    LibraryArtistSnapshot,
    LibraryArtistSurfaceActionId,
} from './artist.contract';
import type { LibraryCapability, LibraryCapabilityReason } from '../shared/capability.contract';
import type { LibraryCollectionDescriptor } from '../collection/collection.contract';
import type { LibraryArtistActionId, LibraryDeclaredActions } from '../suite/suite.contract';
import { collectionKey } from '../collection/collectionIdentity';

// src/library/core/artist/artistSurface.ts
// 歌手页的纯规则（P4.2）：浏览会话的键与条目键、每个语义动作此刻的能力、命令面板发布哪些动作。
// 能力只从歌手资源的快照与描述推出（加上调用方数好的「可播放 / 可入队的热门歌曲」条数——可不可播放要问
// provider，属于 service，由绑定层注入），两套 suite 对同一个歌手得到同一份答案，再各按自己的声明过滤。

/**
 * 歌手页浏览会话（筛选词、看到哪一项）的键：歌手资源的 key，也就是宿主导航栈里那一层的 collectionKey。
 * 本地歌手的描述 id 会在 catalog 就绪后被改写，所以优先用资源的 key；没有资源时退回描述的 collectionKey。
 */
export const artistSessionKey = (
    collection: LibraryCollectionDescriptor,
    resource?: { readonly key: string } | null,
): string => resource?.key || collectionKey(collection);

/** 热门歌曲在会话里的条目键（与 suite 无关：网格的歌曲卡、TUI 的歌曲行认同一个键）。 */
export const artistSongEntryKey = (song: SongResult): string => `song:${getPlaybackSongKey(song)}`;

/** 专辑在会话里的条目键。 */
export const artistAlbumEntryKey = (album: Pick<LibraryArtistAlbum, 'id'>): string => `album:${String(album.id)}`;

/** 条目键属于哪一栏（热门歌曲 / 专辑）；认不出的键返回 null。 */
export const artistEntryPane = (entryKey: string | null | undefined): 'songs' | 'albums' | null => {
    if (!entryKey) return null;
    if (entryKey.startsWith('song:')) return 'songs';
    if (entryKey.startsWith('album:')) return 'albums';
    return null;
};

/** 能力规则的输入。 */
export type ArtistCapabilityInputs = {
    collection: Pick<LibraryCollectionDescriptor, 'source'> & { readonly entityId?: string };
    snapshot: LibraryArtistSnapshot | null;
    /** 热门歌曲里可播放的条数（不可播放的不进队列）。 */
    playableTopSongCount: number;
    /** 「加入热门歌曲」实际会交给队列的条数（可播放且按播放键去重）。 */
    queueableTopSongCount: number;
};

const capability = (supported: boolean, enabled: boolean, reason?: LibraryCapabilityReason): LibraryCapability => {
    const isEnabled = supported && enabled;
    return {
        supported,
        enabled: isEnabled,
        pending: false,
        ...(isEnabled ? {} : { reason: supported ? reason : 'unsupported' }),
    };
};

/**
 * 歌手页每个语义动作此刻的能力（对照 core/suite/suite.contract 的 LibraryArtistActionId 表）：
 * - play / enqueue / play-scope：有可播放的热门歌曲；enqueue-scope：有可入队的热门歌曲；
 * - filter：总是可用（只筛专辑名）；
 * - reload：在线 / Navidrome 歌手（本地歌手由 catalog 同步派生，没有可重新拉取的）或任何加载失败的歌手，加载中不可用；
 * - resume-sync：专辑分页失败中断时才有；
 * - edit-entity：本地歌手且描述带实体 id（宿主的实体编辑对话框）；
 * - open-album：有专辑；open-artist：有热门歌曲（歌曲上的歌手 / 专辑链接）。
 */
export const resolveArtistCapabilities = ({
    collection,
    snapshot,
    playableTopSongCount,
    queueableTopSongCount,
}: ArtistCapabilityInputs): LibraryArtistCapabilities => {
    const status = snapshot?.status ?? 'idle';
    const isLoading = status === 'idle' || status === 'loading';
    const emptyReason: LibraryCapabilityReason = isLoading ? 'loading' : 'empty';
    const albumSync = snapshot?.albumSync;
    const albumsFailed = albumSync?.state === 'interrupted' && albumSync.reason === 'failed';
    const hasPlayable = playableTopSongCount > 0;
    return {
        play: capability(true, hasPlayable, emptyReason),
        enqueue: capability(true, hasPlayable, emptyReason),
        'play-scope': capability(true, hasPlayable, emptyReason),
        'enqueue-scope': capability(true, queueableTopSongCount > 0, emptyReason),
        filter: capability(true, true),
        reload: capability(collection.source !== 'local' || status === 'error', !isLoading, 'loading'),
        'resume-sync': capability(albumsFailed, albumsFailed),
        'edit-entity': capability(collection.source === 'local' && Boolean(collection.entityId), true),
        'open-album': capability(true, (snapshot?.albums.length ?? 0) > 0, emptyReason),
        'open-artist': capability(true, (snapshot?.topSongs.length ?? 0) > 0, emptyReason),
    };
};

/** 命令面板动作 → 歌手页语义动作（suite 在 entry 的 artist 声明里列的那套）。 */
export const ARTIST_SURFACE_ACTION_SOURCES: Readonly<Record<LibraryArtistSurfaceActionId, LibraryArtistActionId>> = {
    'play-top-songs': 'play-scope',
    'enqueue-top-songs': 'enqueue-scope',
    reload: 'reload',
    'retry-albums': 'resume-sync',
    'edit-entity': 'edit-entity',
};

const ARTIST_SURFACE_ACTION_ORDER = Object.keys(ARTIST_SURFACE_ACTION_SOURCES) as LibraryArtistSurfaceActionId[];

/**
 * 命令面板此刻可用的歌手页动作（固定顺序）：能力 enabled ∩ suite 的声明。不给声明（单测、直接挂组件）时不过滤。
 */
export const resolveArtistSurfaceActions = (
    capabilities: LibraryArtistCapabilities,
    declared?: LibraryDeclaredActions,
): LibraryArtistSurfaceActionId[] => ARTIST_SURFACE_ACTION_ORDER.filter(action => {
    const source = ARTIST_SURFACE_ACTION_SOURCES[action];
    return capabilities[source].enabled && (!declared || declared.actions.includes(source));
});

/**
 * suite 自己的入口（按钮、键位）出不出现：声明了、且这个歌手支持（不看 enabled——加载中的动作仍然出现，只是不可用）。
 */
export const resolveOfferedArtistActions = (
    declared: LibraryDeclaredActions,
    capabilities: LibraryArtistCapabilities,
): LibraryArtistActionId[] => (Object.keys(capabilities) as LibraryArtistActionId[])
    .filter(action => capabilities[action].supported && declared.actions.includes(action));
