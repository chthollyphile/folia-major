import { LATTICE_GEOMETRY as G } from '../../surfaces/player/latticePage.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/player/latticePage.target.ts
// 锚点几何来自 latticePage.geometry —— PonderLatticePageSurface 用的是同一组数，
// 两边各写一份百分比的做法会让高亮落在真实元素旁边。

const page = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.11, width: 0.74, height: 0.64, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'lattice-page',
    labelKey: 'ponder.anchors.pages.lattice',
} satisfies PonderAnchorSource;

/** 页面里的一块区域：只提供几何，框不画出来 —— 合成界面已经把真实控件画在同一位置了。 */
const region = (
    from: string,
    rect: PonderRelativeRect,
    labelKey: string,
): PonderAnchorSource => ({ kind: 'relative', from, rect, role: 'region', labelKey });

const anchors = {
    page,
    back: region('page', G.back, 'ponder.anchors.lattice.back'),
    wall: region('page', G.wall, 'ponder.anchors.lattice.wall'),
    poster: region('wall', G.poster, 'ponder.anchors.lattice.poster'),
    // 平移之后焦点海报挪了位，字幕的指向线要指向挪过去的那张。
    pannedPoster: region('wall', G.pannedPoster, 'ponder.anchors.lattice.poster'),
    expanded: region('page', G.expanded, 'ponder.anchors.lattice.expanded'),
    chrome: region('expanded', G.chrome, 'ponder.anchors.lattice.chrome'),
    tools: region('page', G.tools, 'ponder.anchors.lattice.tools'),
    toolsPanel: region('page', G.toolsPanel, 'ponder.anchors.lattice.toolsPanel'),
} satisfies Record<string, PonderAnchorSource>;

export default {
    id: 'lattice-page',
    titleKey: 'ponder.targets.latticePage',
    category: 'playback',
    summaryKey: 'ponder.summaries.lattice_page',
    hoverSelector: null,
    relatedTargetIds: ['player-bar'],
    scenes: [
        {
            id: 'lattice-page-structure', titleKey: 'ponder.scenes.latticePageStructure', anchors,
            steps: [
                { kind: 'highlight', id: 'wallHighlight', anchor: 'wall', intensity: [0, 0.7], durationMs: 480, keyframe: true },
                { kind: 'caption', id: 'wallCaption', textKey: 'ponder.captions.pages.latticeWall', pointTo: { anchor: 'wall' }, durationMs: 4300, withPrevious: true },
                { kind: 'pause', id: 'wallRead' },
                { kind: 'highlight', id: 'backHighlight', anchor: 'back', intensity: [0, 0.8], durationMs: 380, keyframe: true },
                { kind: 'caption', id: 'backCaption', textKey: 'ponder.captions.pages.latticeBack', pointTo: { anchor: 'back' }, durationMs: 3400, withPrevious: true },
                { kind: 'pause', id: 'backRead' },
            ],
        },
        {
            id: 'lattice-page-navigation', titleKey: 'ponder.scenes.latticePageNavigation', anchors,
            steps: [
                { kind: 'drag', id: 'panWall', from: { anchor: 'wall', x: 0.72, y: 0.55 }, to: { anchor: 'wall', x: 0.34, y: 0.42 }, durationMs: 1100, keyframe: true },
                { kind: 'surfaceState', id: 'panResult', anchor: 'page', state: 'wall-panned', durationMs: 650 },
                { kind: 'caption', id: 'panCaption', textKey: 'ponder.captions.pages.latticePan', pointTo: { anchor: 'wall' }, durationMs: 4000, withPrevious: true },
                { kind: 'pause', id: 'panRead' },
                { kind: 'keypress', id: 'focusKeys', keys: ['←', '↑', '↓', '→'], at: { anchor: 'wall', y: 0.12 }, durationMs: 1100, keyframe: true },
                { kind: 'surfaceState', id: 'focusResult', anchor: 'page', state: 'poster-focused', durationMs: 520 },
                { kind: 'caption', id: 'focusCaption', textKey: 'ponder.captions.pages.latticeFocusKeys', pointTo: { anchor: 'pannedPoster' }, durationMs: 4000, withPrevious: true },
                { kind: 'pause', id: 'focusRead' },
            ],
        },
        {
            id: 'lattice-page-poster', titleKey: 'ponder.scenes.latticePagePoster', anchors,
            steps: [
                { kind: 'cursor', id: 'openPoster', to: { anchor: 'poster' }, press: 'tap', durationMs: 720, keyframe: true },
                { kind: 'surfaceState', id: 'expandedResult', anchor: 'page', state: 'poster-expanded', transition: 'zoom', durationMs: 650 },
                { kind: 'caption', id: 'expandedCaption', textKey: 'ponder.captions.pages.latticePosterOpen', pointTo: { anchor: 'expanded' }, durationMs: 4300, withPrevious: true },
                { kind: 'pause', id: 'expandedRead' },
                { kind: 'highlight', id: 'chromeHighlight', anchor: 'chrome', intensity: [0, 0.85], durationMs: 420, keyframe: true },
                { kind: 'caption', id: 'chromeCaption', textKey: 'ponder.captions.pages.latticeChrome', pointTo: { anchor: 'chrome' }, durationMs: 4500, withPrevious: true },
                { kind: 'pause', id: 'chromeRead' },
            ],
        },
        {
            id: 'lattice-page-tools', titleKey: 'ponder.scenes.latticePageTools', anchors,
            steps: [
                { kind: 'cursor', id: 'openTools', to: { anchor: 'tools' }, press: 'tap', durationMs: 720, keyframe: true },
                { kind: 'surfaceState', id: 'toolsResult', anchor: 'page', state: 'tools-open', transition: 'slide-up', durationMs: 560 },
                { kind: 'caption', id: 'toolsCaption', textKey: 'ponder.captions.pages.latticeTools', pointTo: { anchor: 'toolsPanel' }, durationMs: 4700, withPrevious: true },
                { kind: 'pause', id: 'toolsRead' },
                { kind: 'cursor', id: 'lightsToggle', to: { anchor: 'toolsPanel', x: 0.5, y: 0.74 }, press: 'tap', durationMs: 620, keyframe: true },
                { kind: 'surfaceState', id: 'lightsResult', anchor: 'page', state: 'lights-off', durationMs: 560 },
                { kind: 'caption', id: 'lightsCaption', textKey: 'ponder.captions.pages.latticeLights', pointTo: { anchor: 'wall' }, durationMs: 3800, withPrevious: true },
                { kind: 'pause', id: 'lightsRead' },
            ],
        },
        {
            id: 'lattice-page-keyboard', titleKey: 'ponder.scenes.latticePageKeyboard', anchors,
            steps: [
                { kind: 'keypress', id: 'posterKeys', keys: ['Enter', 'Space', 'Esc'], at: { anchor: 'poster', y: 0.15 }, durationMs: 1200, keyframe: true },
                { kind: 'caption', id: 'posterKeysCaption', textKey: 'ponder.captions.pages.latticePosterKeys', pointTo: { anchor: 'poster' }, durationMs: 4300, withPrevious: true },
                { kind: 'pause', id: 'posterKeysRead' },
                { kind: 'keypress', id: 'latticeKeys', keys: [': C', 'Mod P', 'Mod B', 'Mod K'], at: 'bottom', durationMs: 1300, keyframe: true },
                { kind: 'surfaceState', id: 'commandResult', anchor: 'page', state: 'command-open', transition: 'slide-up', durationMs: 520, withPrevious: true },
                { kind: 'caption', id: 'latticeKeysCaption', textKey: 'ponder.captions.pages.latticePageKeys', pointTo: { anchor: 'page' }, durationMs: 4800, withPrevious: true },
                { kind: 'pause', id: 'latticeKeysRead' },
            ],
        },
    ],
} satisfies PonderTargetDefinition;
