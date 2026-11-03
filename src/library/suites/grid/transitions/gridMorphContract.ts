// src/library/suites/grid/transitions/gridMorphContract.ts
// 卡片与「移形换影」（suites/grid/transitions 里的 CollectionMorphOverlay 等）之间的 DOM 契约。
//
// 转场靠 `getBoundingClientRect()` 直接读真实元素，而不是把矩形沿 React 树传下去 —— 这样
// 封面用的是用户正在看的那张 <img>，两边不会有时序或布局漂移。代价是这套握手完全建立在
// 属性名上：任何一侧单独改名都不会报错，只会让转场静默失效（没有 morph，没有报错）。所以
// 名字集中在这里，生产方（Grid3DSlider / GridView / ArtistGridView / 探索页的卡片 / 队列拼贴
// 放大的图块）和消费方（morph 探针）都从这一份取。suite 以外的卡片（探索页、队列拼贴）挂的那五个属性定义在
// components/collectionFlight（suite 以外不能 import suite），这里原样转出。

export {
    CARD_TITLE_ATTR,
    LATTICE_TILE_ATTR,
    LATTICE_WALL_ATTR,
    MORPH_SHADE_ATTR,
    MORPH_SOURCE_ATTR,
} from '../../../../components/collectionFlight';

/** 首页 3D 滑条卡片的序号（Grid3DSlider 写入）。 */
export const GRID3D_CARD_INDEX_ATTR = 'data-grid3d-index';

/** 详情网格卡片的稳定 id（GridView / ArtistGridView 写入）。 */
export const GRID_CARD_ITEM_ID_ATTR = 'data-folia-grid-item-id';

/** Where a cover flying into a page lands: the box that holds the page's own picture at that
 * place (GridView's stand-in card, ArtistGridView's round picture). One a page, with no
 * entrance of its own: at its place and size in the commit that mounts it. */
export const MORPH_TARGET_ATTR = 'data-folia-morph-target';

/** The box a card draws around its picture and title: its background, border and shadow
 * (PolaroidCard, the home slider's cards, GridView's stand-in). It flies with the cover. A card
 * with none (a bare picture) has no such element. */
export const MORPH_FRAME_ATTR = 'data-folia-morph-frame';

/** 活动中的详情网格的标记：带这个属性的元素（ActiveGridMarker 渲染的）的**父元素**就是
 * 当前那一层网格。出栈的旧网格在退出动画期间仍留在 DOM 里且带同样的卡片属性，靠它可以只量
 * 新网格。 */
export const ACTIVE_GRID_ATTR = 'data-folia-active-grid';

/** 正在退出的那一层的标记：同一个标记元素在它那一层开始退出时换成这个属性。返回时散开的
 * 就是这一层的卡片。 */
export const LEAVING_GRID_ATTR = 'data-folia-leaving-grid';

/** 歌手页 intro cluster（圆形头像与简介卡）的标记：它们不是可搬运的卡片。 */
export const ARTIST_INTRO_ATTR = 'data-folia-morph-intro';

/** 带这个属性值的元素要当作 intro cluster 排除。 */
export const ARTIST_INTRO_VALUE_AVATAR = 'avatar';
export const ARTIST_INTRO_VALUE_BIO = 'bio';
