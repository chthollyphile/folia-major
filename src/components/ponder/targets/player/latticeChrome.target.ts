import { LATTICE_CHROME_GEOMETRY as G } from '../../surfaces/player/latticeChrome.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/player/latticeChrome.target.ts
// Lattice 里展开海报底部那条播放控制。
//
// 和 lattice-page 的分工：那个目标讲整面墙怎么走，这里只讲展开之后那条控制条。
// 收进来的两件事都是「看不出来、但一定会撞上」的：中间两个按钮和底栏槽位是同一份配置，
// 以及卡片滚出视口时底栏会自己顶上来 —— 后者不讲清楚，人会以为播放控制凭空消失了。

const page = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.10, width: 0.56, height: 0.66, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'lattice-chrome',
    labelKey: 'ponder.anchors.latticeChrome.card',
} satisfies PonderAnchorSource;

const region = (from: string, rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from, rect, role: 'region', labelKey }
);

const anchors = {
    page,
    card: region('page', G.card, 'ponder.anchors.latticeChrome.card'),
    chrome: region('card', G.chrome, 'ponder.anchors.latticeChrome.chrome'),
    play: region('chrome', G.play, 'ponder.anchors.latticeChrome.play'),
    prev: region('chrome', G.prev, 'ponder.anchors.latticeChrome.prev'),
    slotPrimary: region('chrome', G.slotPrimary, 'ponder.anchors.latticeChrome.slotPrimary'),
    slotSecondary: region('chrome', G.slotSecondary, 'ponder.anchors.latticeChrome.slotSecondary'),
    next: region('chrome', G.next, 'ponder.anchors.latticeChrome.next'),
    time: region('chrome', G.time, 'ponder.anchors.latticeChrome.time'),
    openPlayer: region('chrome', G.openPlayer, 'ponder.anchors.latticeChrome.openPlayer'),
    progress: region('chrome', G.progress, 'ponder.anchors.latticeChrome.progress'),
    bottomBar: region('page', G.bottomBar, 'ponder.anchors.latticeChrome.bottomBar'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：这条控制条上都有什么。 */
const layout: PonderSceneScript = {
    id: 'lattice-chrome-layout',
    titleKey: 'ponder.scenes.latticeChromeLayout',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markChrome', anchor: 'chrome', intensity: [0, 0.4], durationMs: 480, keyframe: true },
        {
            kind: 'caption', id: 'intro',
            textKey: 'ponder.captions.latticeChrome.intro',
            pointTo: { anchor: 'chrome' }, durationMs: 4800, withPrevious: true,
        },
        { kind: 'pause', id: 'readIntro' },

        { kind: 'highlight', id: 'dimChrome', anchor: 'chrome', intensity: [0.4, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markPlay', anchor: 'play', intensity: [0, 0.9], durationMs: 400, withPrevious: true },
        { kind: 'highlight', id: 'markProgress', anchor: 'progress', intensity: [0, 0.8], durationMs: 400, withPrevious: true },
        {
            kind: 'caption', id: 'playAndSeek',
            textKey: 'ponder.captions.latticeChrome.playAndSeek',
            pointTo: { anchor: 'play' }, durationMs: 5000, withPrevious: true,
        },
        { kind: 'pause', id: 'readPlay' },

        { kind: 'highlight', id: 'markOpen', anchor: 'openPlayer', intensity: [0, 0.9], durationMs: 400, keyframe: true },
        {
            kind: 'caption', id: 'openPlayer',
            textKey: 'ponder.captions.latticeChrome.openPlayer',
            pointTo: { anchor: 'openPlayer' }, durationMs: 4600, withPrevious: true,
        },
        { kind: 'pause', id: 'readOpen' },
    ],
};

/** 第二章：中间两个按钮和底栏槽位是同一份配置。 */
const sharedSlots: PonderSceneScript = {
    id: 'lattice-chrome-shared-slots',
    titleKey: 'ponder.scenes.latticeChromeSharedSlots',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markPrev', anchor: 'prev', intensity: [0, 0.7], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markNext', anchor: 'next', intensity: [0, 0.7], durationMs: 400, withPrevious: true },
        {
            kind: 'caption', id: 'ends',
            textKey: 'ponder.captions.latticeChrome.ends',
            pointTo: { anchor: 'prev' }, durationMs: 4600, withPrevious: true,
        },
        { kind: 'pause', id: 'readEnds' },

        { kind: 'highlight', id: 'markSlot1', anchor: 'slotPrimary', intensity: [0, 1], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markSlot2', anchor: 'slotSecondary', intensity: [0, 1], durationMs: 400, withPrevious: true },
        {
            kind: 'caption', id: 'shared',
            textKey: 'ponder.captions.latticeChrome.sharedSlots',
            pointTo: { anchor: 'slotPrimary' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readShared' },

        { kind: 'surfaceState', id: 'swapped', anchor: 'page', state: 'slots-swapped', durationMs: 520, keyframe: true },
        {
            kind: 'caption', id: 'swap',
            textKey: 'ponder.captions.latticeChrome.swap',
            pointTo: { anchor: 'slotPrimary' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readSwap' },
    ],
};

/** 第三章：卡片看不见时，底栏自己顶上来。 */
const bottomBarFallback: PonderSceneScript = {
    id: 'lattice-chrome-bottom-bar',
    titleKey: 'ponder.scenes.latticeChromeBottomBar',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markChrome', anchor: 'chrome', intensity: [0, 0.5], durationMs: 420, keyframe: true },
        {
            kind: 'caption', id: 'onlyWhenVisible',
            textKey: 'ponder.captions.latticeChrome.onlyWhenVisible',
            pointTo: { anchor: 'chrome' }, durationMs: 5000, withPrevious: true,
        },
        { kind: 'pause', id: 'readOnly' },

        { kind: 'drag', id: 'panAway', from: { anchor: 'card', x: 0.5, y: 0.3 }, to: { anchor: 'card', x: 0.2, y: 0.1 }, durationMs: 900, keyframe: true },
        // 卡片整个退场，高亮不会跟着走，显式熄掉。
        { kind: 'highlight', id: 'dimChrome', anchor: 'chrome', intensity: [0.5, 0], durationMs: 420, withPrevious: true },
        { kind: 'surfaceState', id: 'barAppears', anchor: 'page', state: 'bottom-bar-shown', transition: 'slide-up', durationMs: 560 },
        {
            kind: 'caption', id: 'barShows',
            textKey: 'ponder.captions.latticeChrome.barShows',
            pointTo: { anchor: 'bottomBar' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readBar' },
    ],
};

export default {
    id: 'lattice-chrome',
    titleKey: 'ponder.targets.latticeChrome',
    category: 'playback',
    summaryKey: 'ponder.summaries.lattice_chrome',
    hoverSelector: '[data-ponder="lattice-chrome"]',
    relatedTargetIds: ['lattice-page', 'player-bar'],
    scenes: [layout, sharedSlots, bottomBarFallback],
} satisfies PonderTargetDefinition;
