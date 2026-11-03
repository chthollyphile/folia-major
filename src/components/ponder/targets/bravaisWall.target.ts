import { BRAVAIS_PAGE_ASPECT, BRAVAIS_WALL_GEOMETRY as G } from '../surfaces/ponderBravaisGeometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../types/ponder';

// src/components/ponder/targets/bravaisWall.target.ts
// bravais 资料库的墙：页面教程。bravais 的首页、集合页、歌手页都把页面 scope 声明成它（data-ponder-page-scope）。
//
// 讲墙本身：无限墙怎么移动、翻牌换层、怎么认出磁贴的种类、点歌展开的聚焦卡、透光三档与进 Lattice 的翻牌交接。
// 缝（信息条）里的页签、二级切换、直达入口、打字过滤、工具格与账户归 bravais-seam，这里只一句话带过，
// 并在「本页可单独思索的组件」里指过去。
//
// 锚点几何来自 ponderBravaisGeometry —— PonderBravaisWallSurface 用的是同一组数。

const page = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.1, width: 0.74, height: 0.62, aspect: BRAVAIS_PAGE_ASPECT, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'bravais-wall',
    labelKey: 'ponder.anchors.bravaisWall.page',
} satisfies PonderAnchorSource;

/** 页面里的一块区域：只提供几何，框不画出来 —— 合成界面已经把真实控件画在同一位置了。 */
const region = (from: string, rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from, rect, role: 'region', labelKey }
);

const label = (name: string) => `ponder.anchors.bravaisWall.${name}`;

const anchors = {
    page,
    // 标签放到墙的下沿：上沿左端是整块合成界面自己的名字，两个标签会叠在一起。
    wall: { ...region('page', G.wall, label('wall')), labelPlacement: 'below' },
    seam: region('page', G.seam, label('seam')),
    pannedSeam: region('page', G.pannedSeam, label('seam')),
    seamTab: region('seam', G.seamTab, label('seamTab')),
    song: region('page', G.song, label('song')),
    collection: region('page', G.collection, label('collection')),
    artist: region('page', G.artist, label('artist')),
    special: region('page', G.special, label('special')),
    fm: region('page', G.fm, label('fm')),
    origin: region('page', G.origin, label('origin')),
    focusSong: region('page', G.focusSong, label('focusSong')),
    block: region('page', G.block, label('block')),
    focusCard: region('page', G.focusCard, label('focusCard')),
    focusPlay: region('focusCard', G.focusPlay, label('focusPlay')),
    focusQueue: region('focusCard', G.focusQueue, label('focusQueue')),
    focusEnter: region('focusCard', G.focusEnter, label('focusEnter')),
    window: region('page', G.window, label('window')),
    tools: region('page', G.tools, label('tools')),
    toolsPanel: region('page', G.toolsPanel, label('toolsPanel')),
    toolsLattice: region('toolsPanel', G.toolsLattice, label('toolsLattice')),
    toolsLook: region('toolsPanel', G.toolsLook, label('toolsLook')),
} satisfies Record<string, PonderAnchorSource>;

const caption = (key: string) => `ponder.captions.bravaisWall.${key}`;

/** 这一章讲的外观设置（叠页边、透光档、窗数）都在「主页与歌单 → Bravais 墙面」里。 */
const openBravaisSettings = {
    kind: 'openSettings',
    anchorId: 'bravaisSettings',
    labelKey: 'ponder.actions.openBravaisSettings',
} as const;

/** 第一章：墙、缝，以及换页签时的整墙出场与入场。 */
const structure: PonderSceneScript = {
    id: 'bravais-wall-structure',
    titleKey: 'ponder.scenes.bravaisWallStructure',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markWall', anchor: 'wall', intensity: [0, 0.3], durationMs: 480, keyframe: true },
        { kind: 'caption', id: 'intro', textKey: caption('intro'), pointTo: { anchor: 'wall' }, durationMs: 5600, withPrevious: true },
        { kind: 'pause', id: 'readIntro', dwellMs: 5100 },

        { kind: 'highlight', id: 'dimWall', anchor: 'wall', intensity: [0.3, 0], durationMs: 360, keyframe: true },
        { kind: 'highlight', id: 'markSeam', anchor: 'seam', intensity: [0, 0.8], durationMs: 400, withPrevious: true },
        { kind: 'caption', id: 'seam', textKey: caption('seam'), pointTo: { anchor: 'seam' }, durationMs: 4400, withPrevious: true },
        { kind: 'pause', id: 'readSeam', dwellMs: 4000 },

        { kind: 'highlight', id: 'dimSeam', anchor: 'seam', intensity: [0.8, 0], durationMs: 300, keyframe: true },
        { kind: 'cursor', id: 'pickTab', to: { anchor: 'seamTab' }, press: 'tap', durationMs: 760, withPrevious: true },
        { kind: 'surfaceState', id: 'wallOut', anchor: 'page', state: 'tab-out', durationMs: 340 },
        { kind: 'surfaceState', id: 'seamTab', anchor: 'page', state: 'tab-seam', durationMs: 340, withPrevious: true },
        { kind: 'caption', id: 'entrance', textKey: caption('entrance'), pointTo: { anchor: 'wall' }, durationMs: 5800, withPrevious: true },
        { kind: 'surfaceState', id: 'waveOne', anchor: 'page', state: 'tab-in-0', transition: 'zoom', durationMs: 380 },
        { kind: 'surfaceState', id: 'waveTwo', anchor: 'page', state: 'tab-in-1', transition: 'zoom', durationMs: 380 },
        { kind: 'surfaceState', id: 'waveThree', anchor: 'page', state: 'tab-in-2', transition: 'zoom', durationMs: 380 },
        { kind: 'pause', id: 'readEntrance', dwellMs: 4300 },
    ],
};

/** 第二章：拖动、滚轮，以及过滤时退成有限墙。 */
const pan: PonderSceneScript = {
    id: 'bravais-wall-pan',
    titleKey: 'ponder.scenes.bravaisWallPan',
    anchors,
    steps: [
        { kind: 'drag', id: 'dragWall', from: { anchor: 'wall', x: 0.74, y: 0.66 }, to: { anchor: 'wall', x: 0.69, y: 0.46 }, durationMs: 1000, keyframe: true },
        { kind: 'surfaceState', id: 'panned', anchor: 'page', state: 'wall-panned', durationMs: 900, withPrevious: true },
        { kind: 'caption', id: 'pan', textKey: caption('pan'), pointTo: { anchor: 'wall' }, durationMs: 6600, withPrevious: true },
        { kind: 'pause', id: 'readPan', dwellMs: 5600 },

        { kind: 'cursor', id: 'toWheel', to: { anchor: 'wall', x: 0.31, y: 0.5 }, durationMs: 620, keyframe: true },
        { kind: 'surfaceState', id: 'scrolled', anchor: 'page', state: 'wall-scrolled', durationMs: 900 },
        { kind: 'caption', id: 'wheel', textKey: caption('wheel'), pointTo: { anchor: 'wall' }, durationMs: 6400, withPrevious: true },
        { kind: 'pause', id: 'readWheel', dwellMs: 5500 },

        // 拖过、滚过之后缝已经跟着墙往左挪了一截，指它挪过去的位置。
        { kind: 'highlight', id: 'markSeam', anchor: 'pannedSeam', intensity: [0, 0.7], durationMs: 400, keyframe: true },
        { kind: 'caption', id: 'finite', textKey: caption('finite'), pointTo: { anchor: 'pannedSeam' }, durationMs: 6000, withPrevious: true },
        { kind: 'pause', id: 'readFinite', dwellMs: 5600 },
    ],
};

/** 第三章：歌曲、集合、歌手、特殊卡各长什么样。 */
const tiles: PonderSceneScript = {
    id: 'bravais-wall-tiles',
    titleKey: 'ponder.scenes.bravaisWallTiles',
    action: openBravaisSettings,
    anchors,
    steps: [
        { kind: 'highlight', id: 'markSong', anchor: 'song', intensity: [0, 0.9], durationMs: 400, keyframe: true },
        { kind: 'caption', id: 'song', textKey: caption('song'), pointTo: { anchor: 'song' }, durationMs: 3800, withPrevious: true },
        { kind: 'pause', id: 'readSong', dwellMs: 3400 },

        { kind: 'highlight', id: 'dimSong', anchor: 'song', intensity: [0.9, 0], durationMs: 300, keyframe: true },
        { kind: 'highlight', id: 'markCollection', anchor: 'collection', intensity: [0, 0.6], durationMs: 400, withPrevious: true },
        { kind: 'caption', id: 'collection', textKey: caption('collection'), pointTo: { anchor: 'collection' }, durationMs: 6600, withPrevious: true },
        { kind: 'pause', id: 'readCollection', dwellMs: 6200 },

        { kind: 'highlight', id: 'dimCollection', anchor: 'collection', intensity: [0.6, 0], durationMs: 300, keyframe: true },
        { kind: 'highlight', id: 'markArtist', anchor: 'artist', intensity: [0, 0.8], durationMs: 400, withPrevious: true },
        { kind: 'caption', id: 'artist', textKey: caption('artist'), pointTo: { anchor: 'artist' }, durationMs: 3800, withPrevious: true },
        { kind: 'pause', id: 'readArtist', dwellMs: 3400 },

        { kind: 'highlight', id: 'dimArtist', anchor: 'artist', intensity: [0.8, 0], durationMs: 300, keyframe: true },
        { kind: 'cursor', id: 'hoverArtist', to: { anchor: 'artist', x: 0.6, y: 0.5 }, durationMs: 700, withPrevious: true },
        { kind: 'surfaceState', id: 'artistColor', anchor: 'page', state: 'artist-color', durationMs: 420 },
        { kind: 'caption', id: 'artistHover', textKey: caption('artistHover'), pointTo: { anchor: 'artist' }, durationMs: 4400, withPrevious: true },
        { kind: 'pause', id: 'readArtistHover', dwellMs: 4000 },

        { kind: 'highlight', id: 'markSpecial', anchor: 'special', intensity: [0, 0.6], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markFm', anchor: 'fm', intensity: [0, 0.6], durationMs: 400, withPrevious: true },
        { kind: 'caption', id: 'special', textKey: caption('special'), pointTo: { anchor: 'special' }, durationMs: 7000, withPrevious: true },
        { kind: 'pause', id: 'readSpecial', dwellMs: 6600 },
    ],
};

/** 第四章：点集合原地翻成新层，返回从缝开始翻回去。 */
const open: PonderSceneScript = {
    id: 'bravais-wall-open',
    titleKey: 'ponder.scenes.bravaisWallOpen',
    anchors,
    steps: [
        { kind: 'cursor', id: 'openOrigin', to: { anchor: 'origin', x: 0.45, y: 0.5 }, press: 'tap', durationMs: 720, keyframe: true },
        { kind: 'surfaceState', id: 'ringZero', anchor: 'page', state: 'open-ring-0', durationMs: 360 },
        { kind: 'caption', id: 'open', textKey: caption('open'), pointTo: { anchor: 'origin' }, durationMs: 7200, withPrevious: true },
        { kind: 'surfaceState', id: 'ringOne', anchor: 'page', state: 'open-ring-1', durationMs: 320 },
        { kind: 'surfaceState', id: 'seamFlip', anchor: 'page', state: 'open-seam', durationMs: 320, withPrevious: true },
        { kind: 'surfaceState', id: 'ringTwo', anchor: 'page', state: 'open-ring-2', durationMs: 320 },
        { kind: 'surfaceState', id: 'ringThree', anchor: 'page', state: 'open-ring-3', durationMs: 320 },
        { kind: 'pause', id: 'readOpen', dwellMs: 5900 },

        { kind: 'highlight', id: 'markSeam', anchor: 'seam', intensity: [0, 0.6], durationMs: 360, keyframe: true },
        { kind: 'caption', id: 'openSeam', textKey: caption('openSeam'), pointTo: { anchor: 'seam' }, durationMs: 3400, withPrevious: true },
        { kind: 'pause', id: 'readOpenSeam', dwellMs: 3000 },

        { kind: 'highlight', id: 'dimSeam', anchor: 'seam', intensity: [0.6, 0], durationMs: 300, keyframe: true },
        { kind: 'keypress', id: 'escape', keys: ['Esc'], at: { anchor: 'wall', x: 0.5, y: 0.08 }, durationMs: 900, withPrevious: true },
        { kind: 'surfaceState', id: 'seamBack', anchor: 'page', state: 'back-seam', durationMs: 340 },
        { kind: 'surfaceState', id: 'backOne', anchor: 'page', state: 'back-ring-0', durationMs: 340, withPrevious: true },
        { kind: 'caption', id: 'back', textKey: caption('back'), pointTo: { anchor: 'origin' }, durationMs: 6400, withPrevious: true },
        { kind: 'surfaceState', id: 'backTwo', anchor: 'page', state: 'back-ring-1', durationMs: 320 },
        { kind: 'surfaceState', id: 'backThree', anchor: 'page', state: 'back-ring-2', durationMs: 320 },
        { kind: 'pause', id: 'readBack', dwellMs: 5500 },
    ],
};

/** 第五章：聚焦卡 —— 就地展开、块内让位、卡上的按钮、回来时保持展开。 */
const focus: PonderSceneScript = {
    id: 'bravais-wall-focus',
    titleKey: 'ponder.scenes.bravaisWallFocus',
    anchors,
    steps: [
        { kind: 'cursor', id: 'pickSong', to: { anchor: 'focusSong', x: 0.4, y: 0.4 }, press: 'tap', durationMs: 720, keyframe: true },
        { kind: 'surfaceState', id: 'expanded', anchor: 'page', state: 'focus-expanded', durationMs: 650 },
        { kind: 'highlight', id: 'markBlock', anchor: 'block', intensity: [0, 0.3], durationMs: 650, withPrevious: true },
        { kind: 'caption', id: 'expand', textKey: caption('expand'), pointTo: { anchor: 'focusCard' }, durationMs: 6400, withPrevious: true },
        { kind: 'pause', id: 'readExpand', dwellMs: 5800 },

        { kind: 'highlight', id: 'dimBlock', anchor: 'block', intensity: [0.3, 0], durationMs: 300, keyframe: true },
        { kind: 'cursor', id: 'pressQueue', to: { anchor: 'focusQueue' }, press: 'tap', durationMs: 700, withPrevious: true },
        { kind: 'surfaceState', id: 'queued', anchor: 'page', state: 'focus-queued', durationMs: 360 },
        { kind: 'caption', id: 'queue', textKey: caption('queue'), pointTo: { anchor: 'focusQueue' }, durationMs: 4200, withPrevious: true },
        { kind: 'pause', id: 'readQueue', dwellMs: 3800 },

        { kind: 'cursor', id: 'pressPlay', to: { anchor: 'focusPlay' }, press: 'tap', durationMs: 700, keyframe: true },
        { kind: 'surfaceState', id: 'playing', anchor: 'page', state: 'focus-playing', durationMs: 420 },
        { kind: 'caption', id: 'play', textKey: caption('play'), pointTo: { anchor: 'focusPlay' }, durationMs: 6400, withPrevious: true },
        { kind: 'pause', id: 'readPlay', dwellMs: 6000 },

        { kind: 'highlight', id: 'markEnter', anchor: 'focusEnter', intensity: [0, 0.9], durationMs: 400, keyframe: true },
        { kind: 'caption', id: 'current', textKey: caption('current'), pointTo: { anchor: 'focusEnter' }, durationMs: 5400, withPrevious: true },
        { kind: 'pause', id: 'readCurrent', dwellMs: 5000 },

        { kind: 'highlight', id: 'dimEnter', anchor: 'focusEnter', intensity: [0.9, 0], durationMs: 300, keyframe: true },
        { kind: 'caption', id: 'keep', textKey: caption('keep'), pointTo: { anchor: 'focusCard' }, durationMs: 6200, withPrevious: true },
        { kind: 'pause', id: 'readKeep', dwellMs: 5900 },

        { kind: 'keypress', id: 'keys', keys: ['←', '↑', '↓', '→', 'Enter', 'Esc'], at: { anchor: 'focusCard', y: 0.2 }, durationMs: 1400, keyframe: true },
        { kind: 'caption', id: 'keyboard', textKey: caption('keyboard'), pointTo: { anchor: 'focusCard' }, durationMs: 6000, withPrevious: true },
        { kind: 'pause', id: 'readKeyboard', dwellMs: 4600 },
    ],
};

/** 第六章：工具面板里的透光三档，以及前往 Lattice 的翻牌交接。 */
const look: PonderSceneScript = {
    id: 'bravais-wall-look',
    titleKey: 'ponder.scenes.bravaisWallLook',
    action: openBravaisSettings,
    anchors,
    steps: [
        { kind: 'cursor', id: 'openTools', to: { anchor: 'tools' }, press: 'tap', durationMs: 720, keyframe: true },
        { kind: 'surfaceState', id: 'toolsOpen', anchor: 'page', state: 'tools-open', durationMs: 420 },
        { kind: 'caption', id: 'tools', textKey: caption('tools'), pointTo: { anchor: 'toolsPanel' }, durationMs: 5000, withPrevious: true },
        { kind: 'pause', id: 'readTools', dwellMs: 4600 },

        { kind: 'cursor', id: 'lookPartial', to: { anchor: 'toolsLook', x: 0.7 }, press: 'tap', durationMs: 640, keyframe: true },
        { kind: 'surfaceState', id: 'windowsLook', anchor: 'page', state: 'look-windows', durationMs: 600 },
        { kind: 'caption', id: 'windows', textKey: caption('windows'), pointTo: { anchor: 'window' }, durationMs: 7000, withPrevious: true },
        { kind: 'pause', id: 'readWindows', dwellMs: 6400 },

        { kind: 'cursor', id: 'lookClear', to: { anchor: 'toolsLook', x: 0.72 }, press: 'tap', durationMs: 520, keyframe: true },
        { kind: 'surfaceState', id: 'clearLook', anchor: 'page', state: 'look-clear', durationMs: 600 },
        { kind: 'caption', id: 'clear', textKey: caption('clear'), pointTo: { anchor: 'wall' }, durationMs: 4600, withPrevious: true },
        { kind: 'pause', id: 'readClear', dwellMs: 4000 },

        { kind: 'cursor', id: 'lookSolid', to: { anchor: 'toolsLook', x: 0.7 }, press: 'tap', durationMs: 520, keyframe: true },
        { kind: 'surfaceState', id: 'solidLook', anchor: 'page', state: 'look-solid', durationMs: 600 },
        { kind: 'caption', id: 'solid', textKey: caption('solid'), pointTo: { anchor: 'wall' }, durationMs: 5200, withPrevious: true },
        { kind: 'pause', id: 'readSolid', dwellMs: 4600 },

        { kind: 'cursor', id: 'toLattice', to: { anchor: 'toolsLattice' }, press: 'tap', durationMs: 640, keyframe: true },
        { kind: 'surfaceState', id: 'handoff', anchor: 'page', state: 'lattice-handoff', durationMs: 760 },
        { kind: 'caption', id: 'lattice', textKey: caption('lattice'), pointTo: { anchor: 'wall' }, durationMs: 7600, withPrevious: true },
        { kind: 'pause', id: 'readLattice', dwellMs: 6900 },
    ],
};

export default {
    id: 'bravais-wall',
    titleKey: 'ponder.targets.bravaisWall',
    category: 'browsing',
    summaryKey: 'ponder.summaries.bravais_wall',
    hoverSelector: null,
    relatedTargetIds: ['bravais-seam', 'lattice-page'],
    scenes: [structure, pan, tiles, open, focus, look],
} satisfies PonderTargetDefinition;
