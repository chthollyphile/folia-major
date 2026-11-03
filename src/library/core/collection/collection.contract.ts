import type { LocalLibraryGroup } from '../../../types';
import type {
    OnlineProviderId,
    ProviderArtistSummary,
    ProviderCollection,
    ProviderUser,
} from '../../../types/onlineMusic';

// src/library/core/collection/collection.contract.ts
// 集合描述的契约：首页、搜索、播放器面板打开集合时交给导航栈和集合视图的那份数据。
// 原先定义在 components/app/home/gridViewCollectionAdapters.ts，store 为了拿类型不得不反向依赖组件目录；
// 放到 types 之后，组件、store、Library Core 都从这里取；R1 起随 Library Core 归到 core（原 src/types/libraryCollection.ts，现 core/collection/collection.contract.ts）。

export type GridViewCollectionSource = 'online' | 'local' | 'navidrome';

/**
 * 根集合从哪里打开（导航栈的 origin）：首页卡片、搜索结果、播放器面板。返回到底时落回这里；
 * 'home' 时网格的反向移形换影可以落回首页那张卡。原定义在 stores/useCollectionNavigationStore（那里仍转出）。
 */
export type CollectionNavigationOrigin = 'home' | 'search' | 'player';
export type NavidromeGridViewCollectionType = 'album' | 'playlist' | 'artist' | 'random' | 'favorites';

export interface BaseGridViewCollectionDescriptor {
    source: GridViewCollectionSource;
    id: string | number;
    name: string;
    type: string;
    coverUrl?: string;
    description?: string;
    trackCount?: number;
    albumCount?: number;
    isOwned?: boolean;
    artists?: ProviderArtistSummary[];
    aliases?: string[];
    publishedAt?: number;
    publisher?: string;
    playCount?: number;
    updatedAt?: number;
    tracksUpdatedAt?: number;
    isLiked?: boolean;
    providerData?: ProviderCollection['providerData'];
    creator?: ProviderUser;
    albumArtist?: string;
    albumYear?: number;
    albumGenre?: string;
    albumDuration?: number;
    albumCompany?: string;
    albumPublishTime?: number;
}

export interface LocalGridViewCollectionDescriptor extends BaseGridViewCollectionDescriptor {
    source: 'local';
    type: LocalLibraryGroup['type'];
    id: string;
    songIds: string[];
    entityId?: string;
    playlistId?: string;
    isVirtual?: boolean;
    /**
     * 由集合里的歌推出来的自动封面（宿主在交给集合层的描述上写；没有时为 null）。设了自定义集合封面时 coverUrl 是那张，
     * 这里仍是自动的：画曲目本身（专辑墙）的地方用它，集合封面不影响集合里的歌。没写（undefined）时就是 coverUrl。
     */
    automaticCoverUrl?: string | null;
}

export interface NavidromeGridViewCollectionDescriptor extends BaseGridViewCollectionDescriptor {
    source: 'navidrome';
    type: NavidromeGridViewCollectionType;
    id: string;
    editable?: boolean;
}

export interface OnlineGridViewCollectionDescriptor extends BaseGridViewCollectionDescriptor {
    source: 'online';
    providerId: OnlineProviderId;
    raw?: any;
}

export type GridViewCollectionDescriptor =
    | OnlineGridViewCollectionDescriptor
    | LocalGridViewCollectionDescriptor
    | NavidromeGridViewCollectionDescriptor;

/** 与渲染形态无关的名字；新代码用它，旧的 GridView* 名字保留作兼容。 */
export type LibraryCollectionDescriptor = GridViewCollectionDescriptor;

/**
 * 集合导航栈的快照：根集合从哪里打开，以及从根到当前层的每一层（可能有重复的集合，规则见 core/collection/collectionNavigation）。
 * 原定义在 stores/useCollectionNavigationStore（那里仍转出）；纯规则要用它，所以放在契约里。
 */
export type CollectionNavigationSnapshot = {
    origin: CollectionNavigationOrigin;
    stack: GridViewCollectionDescriptor[];
};

/** 判定集合身份需要的最少字段：在线集合必须带 provider。 */
export type LibraryCollectionIdentity =
    | Pick<OnlineGridViewCollectionDescriptor, 'source' | 'providerId' | 'type' | 'id'>
    | Pick<LocalGridViewCollectionDescriptor | NavidromeGridViewCollectionDescriptor, 'source' | 'type' | 'id'>;
