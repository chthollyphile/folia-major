import { GRID_GEOMETRY as G } from '../../surfaces/library/gridPage.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/library/gridPage.target.ts
// 锚点几何来自 gridPage.geometry，和 PonderGridPageSurface 共用同一组数。

const page = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.12, width: 0.72, height: 0.62, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'grid-page',
    labelKey: 'ponder.anchors.pages.grid',
} satisfies PonderAnchorSource;

/** 页面里的一块区域：只提供几何，框不画出来 —— 合成界面已经把真实控件画在同一位置了。 */
const region = (
    rect: PonderRelativeRect,
    labelKey: string,
): PonderAnchorSource => ({ kind: 'relative', from: 'page', rect, role: 'region', labelKey });

const gridAnchors = {
    page,
    help: region(G.help, 'ponder.anchors.grid.help'),
    tabs: region(G.tabs, 'ponder.anchors.grid.tabs'),
    search: region(G.search, 'ponder.anchors.grid.search'),
    map: region(G.map, 'ponder.anchors.grid.map'),
    sourceActions: region(G.sourceActions, 'ponder.anchors.grid.sourceActions'),
    shelf: region(G.shelf, 'ponder.anchors.grid.shelf'),
    focusedCard: region(G.focusedCard, 'ponder.anchors.grid.focusedCard'),
    focusedCopy: region(G.focusedCopy, 'ponder.anchors.grid.focusedCopy'),
} satisfies Record<string, PonderAnchorSource>;

export default {
    id: 'grid-page',
    titleKey: 'ponder.targets.gridPage',
    category: 'browsing',
    summaryKey: 'ponder.summaries.grid_page',
    hoverSelector: null,
    relatedTargetIds: ['player-bar', 'panel-slide'],
    scenes: [
        {
            id: 'grid-page-structure', titleKey: 'ponder.scenes.gridPageStructure', anchors: gridAnchors,
            steps: [
                { kind: 'highlight', id: 'helpHighlight', anchor: 'help', intensity: [0, 0.8], durationMs: 420, keyframe: true },
                { kind: 'caption', id: 'helpCaption', textKey: 'ponder.captions.pages.gridHelp', pointTo: { anchor: 'help' }, durationMs: 3600, withPrevious: true },
                { kind: 'pause', id: 'helpRead' },
                { kind: 'highlight', id: 'tabsHighlight', anchor: 'tabs', intensity: [0, 0.8], durationMs: 420, keyframe: true },
                { kind: 'caption', id: 'tabsCaption', textKey: 'ponder.captions.pages.gridTabs', pointTo: { anchor: 'tabs' }, durationMs: 3800, withPrevious: true },
                { kind: 'pause', id: 'tabsRead' },
                { kind: 'highlight', id: 'searchHighlight', anchor: 'search', intensity: [0, 0.8], durationMs: 420, keyframe: true },
                { kind: 'caption', id: 'searchCaption', textKey: 'ponder.captions.pages.gridSearchBox', pointTo: { anchor: 'search' }, durationMs: 4000, withPrevious: true },
                { kind: 'pause', id: 'searchRead' },
            ],
        },
        {
            id: 'grid-page-tabs', titleKey: 'ponder.scenes.gridPageTabs', anchors: gridAnchors,
            steps: [
                { kind: 'cursor', id: 'pickTab', from: { anchor: 'tabs', x: 0.18 }, to: { anchor: 'tabs', x: 0.62 }, press: 'tap', durationMs: 850, keyframe: true },
                { kind: 'surfaceState', id: 'tabResult', anchor: 'page', state: 'tab-switched', durationMs: 520 },
                { kind: 'caption', id: 'tabResultCaption', textKey: 'ponder.captions.pages.gridTabResult', pointTo: { anchor: 'tabs' }, durationMs: 3800, withPrevious: true },
                { kind: 'pause', id: 'tabResultRead' },
                { kind: 'highlight', id: 'actionsHighlight', anchor: 'sourceActions', intensity: [0, 0.8], durationMs: 420, keyframe: true },
                { kind: 'caption', id: 'actionsCaption', textKey: 'ponder.captions.pages.gridSourceActions', pointTo: { anchor: 'sourceActions' }, durationMs: 4000, withPrevious: true },
                { kind: 'pause', id: 'actionsRead' },
            ],
        },
        {
            id: 'grid-page-cards', titleKey: 'ponder.scenes.gridPageCards', anchors: gridAnchors,
            steps: [
                { kind: 'drag', id: 'dragShelf', from: { anchor: 'shelf', x: 0.72 }, to: { anchor: 'shelf', x: 0.3 }, durationMs: 1100, keyframe: true },
                { kind: 'caption', id: 'moveCaption', textKey: 'ponder.captions.pages.gridCardMove', pointTo: { anchor: 'shelf' }, durationMs: 3800, withPrevious: true },
                { kind: 'pause', id: 'moveRead' },
                { kind: 'cursor', id: 'openFocused', to: { anchor: 'focusedCard' }, press: 'tap', durationMs: 680, keyframe: true },
                { kind: 'surfaceState', id: 'collectionResult', anchor: 'page', state: 'collection-open', transition: 'zoom', durationMs: 620 },
                { kind: 'caption', id: 'openCaption', textKey: 'ponder.captions.pages.gridCardOpen', pointTo: { anchor: 'focusedCard' }, durationMs: 4200, withPrevious: true },
                { kind: 'pause', id: 'openRead' },
            ],
        },
        {
            id: 'grid-page-map', titleKey: 'ponder.scenes.gridPageMap', anchors: gridAnchors,
            steps: [
                { kind: 'cursor', id: 'openMap', to: { anchor: 'map' }, press: 'tap', durationMs: 720, keyframe: true },
                { kind: 'surfaceState', id: 'mapResult', anchor: 'page', state: 'map-open', transition: 'zoom', durationMs: 620 },
                { kind: 'caption', id: 'mapCaption', textKey: 'ponder.captions.pages.gridMap', pointTo: { anchor: 'map' }, durationMs: 4200, withPrevious: true },
                { kind: 'pause', id: 'mapRead' },
            ],
        },
        {
            id: 'grid-page-search', titleKey: 'ponder.scenes.gridPageSearch', anchors: gridAnchors,
            steps: [
                { kind: 'cursor', id: 'focusSearch', to: { anchor: 'search', x: 0.65 }, press: 'tap', durationMs: 620, keyframe: true },
                { kind: 'keypress', id: 'typeSearch', keys: ['歌名', 'Enter'], at: { anchor: 'search', y: 1, offset: { y: 10 } }, durationMs: 900 },
                { kind: 'surfaceState', id: 'searchResult', anchor: 'page', state: 'search-open', transition: 'slide-up', durationMs: 620 },
                { kind: 'caption', id: 'searchResultCaption', textKey: 'ponder.captions.pages.gridSearchResult', pointTo: { anchor: 'search' }, durationMs: 4300, withPrevious: true },
                { kind: 'pause', id: 'searchResultRead' },
            ],
        },
        {
            id: 'grid-page-keyboard', titleKey: 'ponder.scenes.gridPageKeyboard', anchors: gridAnchors,
            steps: [
                { kind: 'keypress', id: 'cardKeys', keys: ['←', '→', 'Enter'], at: { anchor: 'shelf', y: 0.12 }, durationMs: 1200, keyframe: true },
                { kind: 'caption', id: 'cardKeysCaption', textKey: 'ponder.captions.pages.gridCardKeys', pointTo: { anchor: 'shelf' }, durationMs: 3900, withPrevious: true },
                { kind: 'pause', id: 'cardKeysRead' },
                { kind: 'keypress', id: 'pageKeys', keys: ['Mod K', 'Mod B', 'Mod G'], at: 'bottom', durationMs: 1300, keyframe: true },
                { kind: 'surfaceState', id: 'commandResult', anchor: 'page', state: 'command-open', transition: 'slide-up', durationMs: 520, withPrevious: true },
                { kind: 'caption', id: 'pageKeysCaption', textKey: 'ponder.captions.pages.gridPageKeys', pointTo: { anchor: 'page' }, durationMs: 4700, withPrevious: true },
                { kind: 'pause', id: 'pageKeysRead' },
            ],
        },
    ],
} satisfies PonderTargetDefinition;
