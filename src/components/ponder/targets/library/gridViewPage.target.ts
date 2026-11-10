import { GRID_VIEW_GEOMETRY as G } from '../../surfaces/library/gridViewPage.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/library/gridViewPage.target.ts
// 锚点几何来自 gridViewPage.geometry，和 PonderGridViewPageSurface 共用同一组数。

const page = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.11, width: 0.74, height: 0.64, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'grid-view-page',
    labelKey: 'ponder.anchors.pages.gridView',
} satisfies PonderAnchorSource;

/** 页面里的一块区域：只提供几何，框不画出来 —— 合成界面已经把真实控件画在同一位置了。 */
const region = (
    from: string,
    rect: PonderRelativeRect,
    labelKey: string,
): PonderAnchorSource => ({ kind: 'relative', from, rect, role: 'region', labelKey });

const anchors = {
    page,
    back: region('page', G.back, 'ponder.anchors.gridView.back'),
    title: region('page', G.title, 'ponder.anchors.gridView.title'),
    cards: region('page', G.cards, 'ponder.anchors.gridView.cards'),
    card: region('cards', G.card, 'ponder.anchors.gridView.card'),
    info: region('page', G.info, 'ponder.anchors.gridView.info'),
    filter: region('page', G.filter, 'ponder.anchors.gridView.filter'),
} satisfies Record<string, PonderAnchorSource>;

export default {
    id: 'grid-view-page',
    titleKey: 'ponder.targets.gridViewPage',
    category: 'browsing',
    summaryKey: 'ponder.summaries.grid_view_page',
    hoverSelector: null,
    relatedTargetIds: ['player-bar', 'panel-slide'],
    scenes: [
        {
            id: 'grid-view-page-structure', titleKey: 'ponder.scenes.gridViewPageStructure', anchors,
            steps: [
                { kind: 'highlight', id: 'back', anchor: 'back', intensity: [0, 0.8], durationMs: 380, keyframe: true },
                { kind: 'caption', id: 'backCaption', textKey: 'ponder.captions.pages.gridViewBack', pointTo: { anchor: 'back' }, durationMs: 3300, withPrevious: true },
                { kind: 'pause', id: 'backRead' },
                { kind: 'highlight', id: 'title', anchor: 'title', intensity: [0, 0.8], durationMs: 380, keyframe: true },
                { kind: 'caption', id: 'titleCaption', textKey: 'ponder.captions.pages.gridViewTitle', pointTo: { anchor: 'title' }, durationMs: 3900, withPrevious: true },
                { kind: 'pause', id: 'titleRead' },
                { kind: 'highlight', id: 'cards', anchor: 'cards', intensity: [0, 0.65], durationMs: 420, keyframe: true },
                { kind: 'caption', id: 'cardsCaption', textKey: 'ponder.captions.pages.gridViewCards', pointTo: { anchor: 'cards' }, durationMs: 3900, withPrevious: true },
                { kind: 'pause', id: 'cardsRead' },
            ],
        },
        {
            id: 'grid-view-page-navigation', titleKey: 'ponder.scenes.gridViewPageNavigation', anchors,
            steps: [
                { kind: 'drag', id: 'pan', from: { anchor: 'cards', x: 0.72, y: 0.6 }, to: { anchor: 'cards', x: 0.35, y: 0.38 }, durationMs: 1050, keyframe: true },
                { kind: 'caption', id: 'panCaption', textKey: 'ponder.captions.pages.gridViewPan', pointTo: { anchor: 'cards' }, durationMs: 3600, withPrevious: true },
                { kind: 'pause', id: 'panRead' },
                { kind: 'keypress', id: 'arrows', keys: ['←', '↑', '↓', '→'], at: { anchor: 'cards', y: 0.12 }, durationMs: 1000, keyframe: true },
                { kind: 'surfaceState', id: 'focusResult', anchor: 'page', state: 'card-focused', durationMs: 520 },
                { kind: 'caption', id: 'focusCaption', textKey: 'ponder.captions.pages.gridViewFocus', pointTo: { anchor: 'card' }, durationMs: 3800, withPrevious: true },
                { kind: 'pause', id: 'focusRead' },
            ],
        },
        {
            id: 'grid-view-page-info', titleKey: 'ponder.scenes.gridViewPageInfo', anchors,
            steps: [
                { kind: 'cursor', id: 'openInfo', to: { anchor: 'title' }, press: 'tap', durationMs: 720, keyframe: true },
                { kind: 'surfaceState', id: 'infoResult', anchor: 'page', state: 'info-open', transition: 'slide-up', durationMs: 620 },
                { kind: 'caption', id: 'infoCaption', textKey: 'ponder.captions.pages.gridViewInfo', pointTo: { anchor: 'info' }, durationMs: 4800, withPrevious: true },
                { kind: 'pause', id: 'infoRead' },
            ],
        },
        {
            id: 'grid-view-page-filter', titleKey: 'ponder.scenes.gridViewPageFilter', anchors,
            steps: [
                { kind: 'keypress', id: 'filterKey', keys: ['Mod F'], at: { anchor: 'filter', y: 1, offset: { y: 8 } }, durationMs: 850, keyframe: true },
                { kind: 'surfaceState', id: 'filterResult', anchor: 'page', state: 'filter-open', transition: 'slide-up', durationMs: 560 },
                { kind: 'caption', id: 'filterCaption', textKey: 'ponder.captions.pages.gridViewFilter', pointTo: { anchor: 'filter' }, durationMs: 4700, withPrevious: true },
                { kind: 'pause', id: 'filterRead' },
            ],
        },
        {
            id: 'grid-view-page-activate', titleKey: 'ponder.scenes.gridViewPageActivate', anchors,
            steps: [
                { kind: 'cursor', id: 'activate', to: { anchor: 'card' }, press: 'tap', durationMs: 720, keyframe: true },
                { kind: 'caption', id: 'activateCaption', textKey: 'ponder.captions.pages.gridViewActivate', pointTo: { anchor: 'card' }, durationMs: 4500, withPrevious: true },
                { kind: 'pause', id: 'activateRead' },
                { kind: 'keypress', id: 'activateKeys', keys: ['Enter', 'Esc'], at: { anchor: 'card', y: 0.1 }, durationMs: 900, keyframe: true },
                { kind: 'caption', id: 'activateKeysCaption', textKey: 'ponder.captions.pages.gridViewKeys', pointTo: { anchor: 'card' }, durationMs: 3800, withPrevious: true },
                { kind: 'pause', id: 'activateKeysRead' },
            ],
        },
    ],
} satisfies PonderTargetDefinition;
