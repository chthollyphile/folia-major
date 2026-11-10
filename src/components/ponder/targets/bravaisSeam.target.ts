import {
    BRAVAIS_EDGE_TAB,
    BRAVAIS_HOME_DOCK as D,
    BRAVAIS_HOME_DOCK_STAGE,
    BRAVAIS_HOME_SEAM_GEOMETRY as H,
    BRAVAIS_PANEL_GEOMETRY as P,
    BRAVAIS_PANEL_LINKED_TILE,
    BRAVAIS_SEAM_PAGE_RECT,
    BRAVAIS_SEAM_WIDTHS,
    BRAVAIS_SEARCH_SEAM_GEOMETRY as S,
    BRAVAIS_SPINE_GEOMETRY as SP,
    BRAVAIS_STRIP_GEOMETRY as G,
    BRAVAIS_TOOLS_GEOMETRY as T,
    BRAVAIS_WALL_GAP_X,
    BRAVAIS_WALL_RIGHT,
    bravaisSeamRect,
    bravaisWallTileRect,
} from '../surfaces/ponderBravaisSeamGeometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../types/ponder';

// src/components/ponder/targets/bravaisSeam.target.ts
// bravais 资料库中间那道缝（信息条）。和 bravais-wall 的分工：那一篇讲墙本身（平移、翻牌换层、磁贴、聚焦卡、透光），
// 这一篇只讲缝里的东西 —— 三档开合、集合 / 歌手页的信息条、首页窄缝（页签、二级切换、直达、账户、工具格）、
// 当前页过滤与搜索的区分，以及右下角那颗墙面工具。
//
// 收进来的都是「看不出来、但一定会撞上」的：标题本身是收起按钮、折叠藏在「⋯ 更多」最后一项、
// 二级切换只有选中项写字、在墙上打字就是过滤而放大镜才是联网搜索。
//
// 指针停在缝上（任何一档，包括折叠后侧边那枚标签）长按 G 进这里。墙上其它地方归 bravais-wall。

/** 页面里的一块区域：只提供几何，框不画出来 —— 合成界面已经把真实控件画在同一位置了。 */
const region = (from: string, rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from, rect, role: 'region', labelKey }
);

const label = (key: string) => `ponder.anchors.bravaisSeam.${key}`;

/** 集合 / 歌手页：300px 的完整信息条，以及书脊、折叠、列表面板几档。 */
const stripAnchors = {
    page: {
        kind: 'synthetic',
        rect: BRAVAIS_SEAM_PAGE_RECT,
        role: 'surface',
        surfaceKind: 'bravais-seam-strip',
        labelKey: label('collectionPage'),
    },
    strip: region('page', bravaisSeamRect('full'), label('strip')),
    crumbs: region('strip', G.crumbs, label('crumbs')),
    title: region('strip', G.title, label('title')),
    about: region('strip', G.about, label('about')),
    actions: region('strip', G.actions, label('actions')),
    list: region('strip', G.list, label('list')),
    more: region('strip', G.more, label('more')),
    menuFold: region('strip', G.menuFold, label('menuFold')),
    spine: region('page', bravaisSeamRect('spine'), label('spine')),
    spineTitle: region('spine', SP.title, label('spineTitle')),
    edgeTab: region('page', BRAVAIS_EDGE_TAB, label('edgeTab')),
    panel: region('page', bravaisSeamRect('panel'), label('panel')),
    hoverRow: region('panel', P.hoverRow, label('hoverRow')),
    linkedTile: region(
        'page',
        bravaisWallTileRect(BRAVAIS_WALL_RIGHT[BRAVAIS_PANEL_LINKED_TILE.index], BRAVAIS_PANEL_LINKED_TILE.side, BRAVAIS_SEAM_WIDTHS.panel),
        label('linkedTile'),
    ),
} satisfies Record<string, PonderAnchorSource>;

/** 首页：120px 的窄缝，以及搜索态、右下角的工具面板。 */
const homeAnchors = {
    page: {
        kind: 'synthetic',
        rect: BRAVAIS_SEAM_PAGE_RECT,
        role: 'surface',
        surfaceKind: 'bravais-seam-home',
        labelKey: label('homePage'),
    },
    homeSeam: region('page', bravaisSeamRect('home'), label('homeSeam')),
    tabs: region('homeSeam', H.tabs, label('tabs')),
    tabLocal: region('homeSeam', H.tab[3], label('tabLocal')),
    sections: region('homeSeam', H.sections, label('sections')),
    shortcuts: region('homeSeam', H.shortcuts, label('shortcuts')),
    account: region('homeSeam', D.account, label('account')),
    tools: region('homeSeam', D.tools, label('tools')),
    searchTool: region('homeSeam', D.search, label('searchTool')),
    homeMore: region('homeSeam', D.more, label('homeMore')),
    menuPopup: region('homeSeam', H.menuPopup, label('menuPopup')),
    stageRow: region('homeSeam', BRAVAIS_HOME_DOCK_STAGE.stageRow, label('stageRow')),
    filter: region('homeSeam', H.filter, label('filter')),
    /** 缝右边那半面墙（打字落在墙上）。 */
    wall: region('page', { left: 0.5 + BRAVAIS_SEAM_WIDTHS.home / 2 + BRAVAIS_WALL_GAP_X, right: 0, top: 0, bottom: 0 }, label('wall')),
    searchSeam: region('page', bravaisSeamRect('full'), label('searchSeam')),
    searchBox: region('searchSeam', S.box, label('searchBox')),
    toolsButton: region('page', T.button, label('toolsButton')),
    toolsPanel: region('page', T.panel, label('toolsPanel')),
    toolsQuick: region('toolsPanel', T.quick, label('toolsQuick')),
    toolsVolume: region('toolsPanel', T.volume, label('toolsVolume')),
    toolsAppearance: region('toolsPanel', T.appearance, label('toolsAppearance')),
} satisfies Record<string, PonderAnchorSource>;

const caption = (key: string) => `ponder.captions.bravaisSeam.${key}`;

/** 第一章：三档开合。标题区域本身就是「收起」，「折叠」在「⋯ 更多」的最后一项。 */
const levels: PonderSceneScript = {
    id: 'bravais-seam-levels',
    titleKey: 'ponder.scenes.bravaisSeamLevels',
    anchors: stripAnchors,
    steps: [
        { kind: 'highlight', id: 'markStrip', anchor: 'strip', intensity: [0, 0.45], durationMs: 480, keyframe: true },
        { kind: 'caption', id: 'intro', textKey: caption('levelsIntro'), pointTo: { anchor: 'strip' }, durationMs: 5000, withPrevious: true },
        { kind: 'pause', id: 'readIntro' },

        { kind: 'highlight', id: 'dimStrip', anchor: 'strip', intensity: [0.45, 0], durationMs: 300, keyframe: true },
        { kind: 'cursor', id: 'tapTitle', to: { anchor: 'title' }, press: 'tap', durationMs: 720, withPrevious: true },
        { kind: 'surfaceState', id: 'toSpine', anchor: 'page', state: 'spine', durationMs: 560 },
        { kind: 'caption', id: 'spine', textKey: caption('levelsSpine'), pointTo: { anchor: 'spineTitle' }, durationMs: 5400, withPrevious: true },
        { kind: 'pause', id: 'readSpine' },

        { kind: 'cursor', id: 'tapSpineTitle', to: { anchor: 'spineTitle' }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'surfaceState', id: 'backToStrip', anchor: 'page', state: 'strip-again', durationMs: 520 },
        { kind: 'cursor', id: 'openMore', to: { anchor: 'more' }, press: 'tap', durationMs: 620 },
        { kind: 'surfaceState', id: 'moreOpen', anchor: 'page', state: 'strip-more', durationMs: 380 },
        { kind: 'caption', id: 'fold', textKey: caption('levelsFold'), pointTo: { anchor: 'menuFold' }, durationMs: 4800, withPrevious: true },
        { kind: 'pause', id: 'readFold' },

        { kind: 'cursor', id: 'tapFold', to: { anchor: 'menuFold' }, press: 'tap', durationMs: 600, keyframe: true },
        { kind: 'surfaceState', id: 'folded', anchor: 'page', state: 'hidden', durationMs: 600 },
        { kind: 'caption', id: 'hidden', textKey: caption('levelsHidden'), pointTo: { anchor: 'edgeTab' }, durationMs: 5200, withPrevious: true },
        { kind: 'pause', id: 'readHidden' },

        { kind: 'caption', id: 'global', textKey: caption('levelsGlobal'), durationMs: 5400, keyframe: true },
        { kind: 'pause', id: 'readGlobal' },
    ],
};

/** 第二章：集合 / 歌手页的完整信息条，和它加宽成的列表面板。 */
const collection: PonderSceneScript = {
    id: 'bravais-seam-collection',
    titleKey: 'ponder.scenes.bravaisSeamCollection',
    anchors: stripAnchors,
    steps: [
        { kind: 'highlight', id: 'markCrumbs', anchor: 'crumbs', intensity: [0, 0.8], durationMs: 400, keyframe: true },
        { kind: 'caption', id: 'crumbs', textKey: caption('collectionCrumbs'), pointTo: { anchor: 'crumbs' }, durationMs: 5200, withPrevious: true },
        { kind: 'pause', id: 'readCrumbs' },

        { kind: 'highlight', id: 'dimCrumbs', anchor: 'crumbs', intensity: [0.8, 0], durationMs: 300, keyframe: true },
        { kind: 'highlight', id: 'markAbout', anchor: 'about', intensity: [0, 0.8], durationMs: 400, withPrevious: true },
        { kind: 'caption', id: 'about', textKey: caption('collectionAbout'), pointTo: { anchor: 'about' }, durationMs: 5600, withPrevious: true },
        { kind: 'pause', id: 'readAbout' },

        { kind: 'highlight', id: 'dimAbout', anchor: 'about', intensity: [0.8, 0], durationMs: 300, keyframe: true },
        { kind: 'highlight', id: 'markActions', anchor: 'actions', intensity: [0, 0.8], durationMs: 400, withPrevious: true },
        { kind: 'caption', id: 'actions', textKey: caption('collectionActions'), pointTo: { anchor: 'actions' }, durationMs: 4800, withPrevious: true },
        { kind: 'pause', id: 'readActions' },

        { kind: 'highlight', id: 'dimActions', anchor: 'actions', intensity: [0.8, 0], durationMs: 300, keyframe: true },
        { kind: 'cursor', id: 'tapList', to: { anchor: 'list' }, press: 'tap', durationMs: 680, withPrevious: true },
        { kind: 'surfaceState', id: 'listOpen', anchor: 'page', state: 'list-panel', durationMs: 600 },
        { kind: 'cursor', id: 'hoverRow', to: { anchor: 'hoverRow', x: 0.4 }, durationMs: 520 },
        { kind: 'highlight', id: 'markLinked', anchor: 'linkedTile', intensity: [0, 0.7], durationMs: 400, withPrevious: true },
        { kind: 'caption', id: 'list', textKey: caption('collectionList'), pointTo: { anchor: 'linkedTile' }, durationMs: 6000, withPrevious: true },
        { kind: 'pause', id: 'readList' },
    ],
};

/** 第三章：首页窄缝的导航 —— 竖排页签、二级切换、直达入口。 */
const homeNavigation: PonderSceneScript = {
    id: 'bravais-seam-home-navigation',
    titleKey: 'ponder.scenes.bravaisSeamHomeNavigation',
    anchors: homeAnchors,
    steps: [
        { kind: 'highlight', id: 'markTabs', anchor: 'tabs', intensity: [0, 0.7], durationMs: 420, keyframe: true },
        { kind: 'caption', id: 'tabs', textKey: caption('homeTabs'), pointTo: { anchor: 'tabs' }, durationMs: 5000, withPrevious: true },
        { kind: 'pause', id: 'readTabs' },

        { kind: 'highlight', id: 'dimTabs', anchor: 'tabs', intensity: [0.7, 0], durationMs: 300, keyframe: true },
        { kind: 'cursor', id: 'tapLocal', to: { anchor: 'tabLocal' }, press: 'tap', durationMs: 700, withPrevious: true },
        { kind: 'surfaceState', id: 'localShown', anchor: 'page', state: 'home-local', transition: 'zoom', durationMs: 620 },
        { kind: 'keypress', id: 'cycleKeys', keys: ['F6', 'Shift F6'], at: { anchor: 'wall', y: 0.14 }, durationMs: 1200, withPrevious: true },
        { kind: 'caption', id: 'flip', textKey: caption('homeFlip'), pointTo: { anchor: 'tabLocal' }, durationMs: 4800, withPrevious: true },
        { kind: 'pause', id: 'readFlip' },

        { kind: 'highlight', id: 'markSections', anchor: 'sections', intensity: [0, 0.8], durationMs: 400, keyframe: true },
        { kind: 'caption', id: 'sections', textKey: caption('homeSections'), pointTo: { anchor: 'sections' }, durationMs: 5800, withPrevious: true },
        { kind: 'pause', id: 'readSections' },

        { kind: 'highlight', id: 'dimSections', anchor: 'sections', intensity: [0.8, 0], durationMs: 300, keyframe: true },
        { kind: 'highlight', id: 'markShortcuts', anchor: 'shortcuts', intensity: [0, 0.8], durationMs: 400, withPrevious: true },
        { kind: 'caption', id: 'shortcuts', textKey: caption('homeShortcuts'), pointTo: { anchor: 'shortcuts' }, durationMs: 5800, withPrevious: true },
        { kind: 'pause', id: 'readShortcuts' },
    ],
};

/** 第四章：首页窄缝底部 —— 账户入口、工具格、「⋯」菜单，以及舞台开着时多出来的那一行。 */
const homeDock: PonderSceneScript = {
    id: 'bravais-seam-home-dock',
    titleKey: 'ponder.scenes.bravaisSeamHomeDock',
    anchors: homeAnchors,
    steps: [
        { kind: 'highlight', id: 'markAccount', anchor: 'account', intensity: [0, 0.8], durationMs: 400, keyframe: true },
        { kind: 'caption', id: 'account', textKey: caption('dockAccount'), pointTo: { anchor: 'account' }, durationMs: 4600, withPrevious: true },
        { kind: 'pause', id: 'readAccount' },

        { kind: 'highlight', id: 'dimAccount', anchor: 'account', intensity: [0.8, 0], durationMs: 300, keyframe: true },
        { kind: 'highlight', id: 'markTools', anchor: 'tools', intensity: [0, 0.75], durationMs: 400, withPrevious: true },
        { kind: 'caption', id: 'tools', textKey: caption('dockTools'), pointTo: { anchor: 'tools' }, durationMs: 4800, withPrevious: true },
        { kind: 'pause', id: 'readTools' },

        { kind: 'highlight', id: 'dimTools', anchor: 'tools', intensity: [0.75, 0], durationMs: 300, keyframe: true },
        { kind: 'cursor', id: 'tapMore', to: { anchor: 'homeMore' }, press: 'tap', durationMs: 640, withPrevious: true },
        { kind: 'surfaceState', id: 'menuShown', anchor: 'page', state: 'menu-open', durationMs: 420 },
        { kind: 'caption', id: 'menu', textKey: caption('dockMenu'), pointTo: { anchor: 'menuPopup' }, durationMs: 5800, withPrevious: true },
        { kind: 'pause', id: 'readMenu' },

        { kind: 'surfaceState', id: 'stageShown', anchor: 'page', state: 'stage-on', durationMs: 560, keyframe: true },
        { kind: 'caption', id: 'stage', textKey: caption('dockStage'), pointTo: { anchor: 'stageRow' }, durationMs: 4800, withPrevious: true },
        { kind: 'pause', id: 'readStage' },
    ],
};

/** 第五章：在墙上打字是过滤当前页；放大镜才是联网搜索。两者的入口、样子、语义都不同。 */
const filterAndSearch: PonderSceneScript = {
    id: 'bravais-seam-filter',
    titleKey: 'ponder.scenes.bravaisSeamFilter',
    anchors: homeAnchors,
    steps: [
        { kind: 'keypress', id: 'typeOnWall', keys: ['L', 'O', 'V', 'E'], at: { anchor: 'wall', y: 0.18 }, durationMs: 1200, keyframe: true },
        { kind: 'surfaceState', id: 'filtering', anchor: 'page', state: 'filtering', durationMs: 600 },
        { kind: 'caption', id: 'type', textKey: caption('filterType'), pointTo: { anchor: 'filter' }, durationMs: 5800, withPrevious: true },
        { kind: 'pause', id: 'readType' },

        { kind: 'keypress', id: 'filterKeys', keys: ['Esc', '↓', 'Enter'], at: { anchor: 'wall', y: 0.18 }, durationMs: 1200, keyframe: true },
        { kind: 'caption', id: 'keys', textKey: caption('filterKeys'), pointTo: { anchor: 'filter' }, durationMs: 5400, withPrevious: true },
        { kind: 'pause', id: 'readKeys' },

        { kind: 'cursor', id: 'tapSearch', to: { anchor: 'searchTool' }, press: 'tap', durationMs: 700, keyframe: true },
        { kind: 'surfaceState', id: 'searchOpen', anchor: 'page', state: 'search-open', durationMs: 620 },
        { kind: 'caption', id: 'search', textKey: caption('filterSearch'), pointTo: { anchor: 'searchBox' }, durationMs: 5800, withPrevious: true },
        { kind: 'pause', id: 'readSearch' },
    ],
};

/** 第六章：右下角那颗墙面工具（与 Lattice 同一颗）。透光本身怎么回事归 bravais-wall 讲，这里只说它在哪。 */
const tools: PonderSceneScript = {
    id: 'bravais-seam-tools',
    titleKey: 'ponder.scenes.bravaisSeamTools',
    anchors: homeAnchors,
    steps: [
        { kind: 'cursor', id: 'openTools', to: { anchor: 'toolsButton' }, press: 'tap', durationMs: 720, keyframe: true },
        { kind: 'surfaceState', id: 'toolsShown', anchor: 'page', state: 'tools-open', transition: 'slide-up', durationMs: 520 },
        { kind: 'caption', id: 'quick', textKey: caption('toolsQuick'), pointTo: { anchor: 'toolsQuick' }, durationMs: 5600, withPrevious: true },
        { kind: 'pause', id: 'readQuick' },

        { kind: 'highlight', id: 'markVolume', anchor: 'toolsVolume', intensity: [0, 0.8], durationMs: 400, keyframe: true },
        { kind: 'caption', id: 'volume', textKey: caption('toolsVolume'), pointTo: { anchor: 'toolsVolume' }, durationMs: 4200, withPrevious: true },
        { kind: 'pause', id: 'readVolume' },

        { kind: 'highlight', id: 'dimVolume', anchor: 'toolsVolume', intensity: [0.8, 0], durationMs: 300, keyframe: true },
        { kind: 'highlight', id: 'markAppearance', anchor: 'toolsAppearance', intensity: [0, 0.75], durationMs: 400, withPrevious: true },
        { kind: 'caption', id: 'appearance', textKey: caption('toolsAppearance'), pointTo: { anchor: 'toolsAppearance' }, durationMs: 5600, withPrevious: true },
        { kind: 'pause', id: 'readAppearance' },
    ],
};

export default {
    id: 'bravais-seam',
    titleKey: 'ponder.targets.bravaisSeam',
    category: 'browsing',
    summaryKey: 'ponder.summaries.bravais_seam',
    // 缝本身（任何一档、任何内容）与折叠后侧边那枚标签。都是 bravais 自己挂的属性，不为教程另加标记。
    hoverSelector: '[data-bravais-seam], [data-bravais-seam-tab]',
    relatedTargetIds: ['bravais-wall'],
    scenes: [levels, collection, homeNavigation, homeDock, filterAndSearch, tools],
} satisfies PonderTargetDefinition;
