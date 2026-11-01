import type { BravaisLayerEntries, BravaisLayerWall, BravaisSeamAlbum, BravaisSeamArtist, BravaisSeamCollection, BravaisSeamFilter } from './bravaisSeamModels';
import type { BravaisHomeLayer, BravaisHomeSeam } from './bravaisHomeModels';
import type { LibraryHomeSpecialKind } from '../../core/home/homeSpecialCards';
import type { BravaisLayerShape } from './bravaisWallShape';

// src/library/suites/bravais/bravaisLayer.ts
// bravais 的层描述（设计稿 §8.1）：surface 把 core binding 的数据投影成它，推进 bravaisStageStore，stage 只读它画墙。
// 层描述里只有已投影的展示数据和回调——没有资源对象、没有控制器：stage 不知道数据从哪来，也不直接改任何东西。
// 回调的参数一律是条目 key（BravaisItem.key），surface 自己把 key 映射回曲目 / 卡片。

/** 磁贴上的内容种类（设计稿 §6；'wall' 留白由 stage 自己画，不出现在条目里）。 */
export type BravaisItemKind = 'track' | 'playlist' | 'album' | 'artist' | 'folder' | 'feed';

/** 专辑墙上曲目封面的画法（bravaisAlbumWall）：整面墙拼成一张封面，或从封面上切下来的碎片。 */
export type BravaisCoverArt = { mode: 'mosaic' | 'shard'; url: string };

/** 墙上一张磁贴的内容。 */
export type BravaisItem = {
    /** 层内唯一的 key：集合是条目键（core 的 entryKey），首页卡片是 `card:<id>`。翻牌按它判断「内容变了没有」。 */
    key: string;
    kind: BravaisItemKind;
    title: string;
    subtitle: string;
    coverUrl?: string;
    /** 专辑墙（has-album-wall）上这首的封面画法；没有就照常画整张封面。 */
    coverArt?: BravaisCoverArt;
    /** 徽标文字：集合层是条目序号（01、02…），首页与歌手页是种类（歌单 / 专辑…），集合带曲目数（「歌单 · 124」）。 */
    badge: string;
    /**
     * 集合的曲目数（已翻译的「N 首」，设计稿 §7.7）：只有集合（专辑 / 歌单 / 文件夹 / 每日推荐）有，而且只在曲目数已知时给；
     * 它进磁贴的可访问名，标签上写的是「种类 · N」；给了它，副标题里就不再重复曲目数。
     */
    trackCountLabel?: string;
    /** 歌曲的播放键（getPlaybackSongKey）：与正在播放的那首比较。 */
    playbackKey?: string;
    /** 聚焦卡上的专辑 / 歌手链接与时长（只有歌曲有）。 */
    album?: string;
    artists?: readonly string[];
    durationLabel?: string;
    /** 不可播放（灰显）。 */
    unavailable?: boolean;
    /** B9 首页：歌单类卡片可隐藏（右上角眼睛按钮）；hidden 是它此刻在隐藏表里（管理隐藏视图里显示）。 */
    hideable?: boolean;
    hidden?: boolean;
    /** B9 首页：批量模式里被选中（带勾、不灰）。 */
    selected?: boolean;
    /** B9 首页：灰度 + 半透明（批量模式里没选中的、管理隐藏视图里已隐藏的）。 */
    dimmed?: boolean;
    /** B9 首页：点了直接播放、不进新层（私人 FM）：stage 不记起点。 */
    direct?: boolean;
    /**
     * 首页的特殊集合（我喜欢的音乐、私人 FM、全部歌曲…，判定在 core 的 resolveLibraryHomeSpecial）：左上角的类型标签
     * 换成强调色底 + 小图标（BravaisTile）。普通卡片没有。
     */
    special?: LibraryHomeSpecialKind;
};

/** 首页缝里的页签（只有首页层有）。 */
export type BravaisSeamTab = {
    key: string;
    label: string;
    active: boolean;
    disabled: boolean;
};

/** 缝里画什么（设计稿 §5「内容」）。文案都是已翻译的。 */
export type BravaisSeamModel = {
    /** 竖排主标题。 */
    title: string;
    /** 面包屑最后一级（首页为「书库」）。 */
    crumb: string;
    /** 元数据行：曲目数、来源等。 */
    meta: string;
    /** 状态行（加载中、错误、空、本页签还没有墙面）；没有就不显示。 */
    status?: string;
    tabs?: readonly BravaisSeamTab[];
    onSelectTab?: (key: string) => void;
    /** 播放 / 加入当前范围；没声明或不可用时不给。 */
    onPlayScope?: () => void;
    onEnqueueScope?: () => void;
    /**
     * 这面墙的「当前页过滤」输入位（设计稿 §7.6）：首页各页签、集合、歌手页、目录面板都有；suite 没声明过滤时不给。
     * 完整信息条、面板与首页窄缝把它画成缝自己的输入框（BravaisSeamFilterField）。
     */
    filter?: BravaisSeamFilter;
    /** B7 集合页：收藏星标、补页进度、状态与结果提示、日期步进、「⋯ 更多」、表单态（见 bravaisSeamModels）。 */
    collection?: BravaisSeamCollection;
    /** B9 首页：二级切换、工具按钮、「⋯」、管理隐藏、扫描进度、搜索、账户位（见 bravaisHomeModels）。 */
    home?: BravaisHomeSeam;
    /** B8 歌手页：头像、别名、简介与统计（ArtistGridView 的信息）。 */
    artist?: BravaisSeamArtist;
    /** 专辑页：封面、歌手、年份与元信息（左边钉住的专辑海报，见 bravaisAlbumModel）。只有专辑类型的集合有。 */
    album?: BravaisSeamAlbum;
    /** B8：播放 / 加入当前范围的按钮文案（歌手页是「播放热门」「加入热门歌曲」）；不给就是「播放全部」「加入队列」。 */
    scopeLabels?: { play: string; enqueue: string };
};

export type BravaisLayerSurface = 'home' | 'collection' | 'artist';

/**
 * 「定位正在播放」（app/playing-song-locator）里这一层被问时要的：问它用的页键（与网格的集合页同一个），列表此刻全不全，
 * 过滤开着时怎么清掉。回答由 stage 做（useBravaisLocate）。
 */
export type BravaisLayerLocate = {
    pageKey: string;
    isFiltered: boolean;
    cardsStillArriving: boolean;
    hasReadFailed: boolean;
    clearFilter: () => void;
};

/** 一层墙的描述。 */
export type BravaisLayer = {
    /** 层身份：首页是 `home:<页签>`，集合是会话键（collectionKey）。换了就是换层。 */
    key: string;
    /** 布局记忆与 layout.forget 用的会话键（首页为 'home'）。 */
    sessionKey: string;
    surface: BravaisLayerSurface;
    /** B6 只有无限拼贴；有限拼贴（过滤、搜索）在 B7 接上。 */
    mode: 'infinite' | 'finite';
    items: readonly BravaisItem[];
    seam: BravaisSeamModel;
    /** surface 自己的 isInteractive（首页在集合层打开时为 false）。 */
    isInteractive: boolean;
    /** 会话里记着的焦点条目（进入时如果没有起点磁贴，键盘焦点落在它上面）。 */
    focusedEntryKey: string | null;
    /** 正在播放的那首在这一层里的条目 key（没有就是 null）。 */
    nowPlayingKey: string | null;
    /** 已在播放队列里的条目 key（聚焦卡显示「✓ 已在队列」）。 */
    queuedKeys: ReadonlySet<string>;
    /** 打开一个非歌曲条目（歌单 / 专辑卡）：push 下一层。 */
    onOpenItem?: (key: string) => void;
    onPlayItem?: (key: string) => void;
    onEnqueueItem?: (key: string) => void;
    /**
     * 歌曲卡片上悬浮才出现的两颗（BravaisTileQuickActions）：收进速记簿、收藏到歌单（应用的歌单选择器，含「我喜欢」）。
     * 能不能做由 surface 判定（suite 声明 ∩ 宿主端口 ∩ 这首的来源）；不给就没有那颗。
     */
    canCollectItem?: (key: string) => boolean;
    onCollectItem?: (key: string) => void;
    canSaveItemToPlaylist?: (key: string) => boolean;
    onSaveItemToPlaylist?: (key: string) => void;
    /** 聚焦卡上的专辑 / 歌手链接；能不能打开由 surface 判定（canOpen*）。 */
    canOpenAlbum?: (key: string) => boolean;
    onOpenAlbum?: (key: string) => void;
    canOpenArtist?: (key: string, index: number) => boolean;
    onOpenArtist?: (key: string, index: number) => void;
    /** 键盘焦点换到了这一项（低频、离散）：surface 记下，离开时按会话的代写回。 */
    onFocusEntry?: (key: string | null) => void;
    /** Esc 阶梯的最后一步（离开但保留）。首页没有。 */
    onBack?: () => void;
    /** 缝里的返回按钮（完成：宿主清会话、忘布局）。首页没有。 */
    onDone?: () => void;
    /**
     * B11 面包屑点击跳层（宿主的 LibraryCollectionNavigation.onPopTo）：depth = 保留的层数，按导航栈里的位置算。
     * 调用方不跑 beforeBack、也不先关面板（导航层走浏览器历史，越过面板记录）。首页没有。
     */
    onPopTo?: (depth: number) => void;
    /** B7：墙的内容规则（无限拼贴的循环周期、有限拼贴的规划条目数、过滤身份、加载呼吸）。 */
    wall?: BravaisLayerWall;
    /** B7：列表面板与条目动作（聚焦卡「⋯」、Esc 阶梯的过滤词一级）。 */
    entries?: BravaisLayerEntries;
    /** 集合页参与「定位正在播放」；首页、歌手页没有（与网格相同）。 */
    locate?: BravaisLayerLocate;
    /** B9：首页的目录树面板、批量模式、眼睛按钮与 F6 切页签（见 bravaisHomeModels）。 */
    home?: BravaisHomeLayer;
    /**
     * 墙的形状（bravaisWallShape）：不给就是 wall 的块；探索页签给它的 section 排法，墙按网格探索拼贴的样子铺。
     * 换形状时整墙先在旧形状上出场，再在新形状上入场。
     */
    shape?: BravaisLayerShape;
};

