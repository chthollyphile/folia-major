import { GRID3D_CARD_STYLE_GEOMETRY as G } from '../../surfaces/settings/appearanceSettings.geometry';
import { isGridLibraryActive } from '../../../../library/app/gridLibraryActive';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/settings/grid3dCardStyle.target.ts
// 设置 · 主页与歌单 · 主页里的「歌单卡片样式」。
//
// 只有两个选项，但它换掉的是首页最显眼的那一整排东西 —— 而选项名（「纯图片封面」
// 「拍立得卡片」）在不切过去看一眼的情况下很难对上具体长什么样。这一章就是替人切那一眼。

const panel = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.26, width: 0.46, height: 0.28, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'grid3d-card-style',
    labelKey: 'ponder.anchors.grid3dCardStyle.panel',
} satisfies PonderAnchorSource;

const region = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'panel', rect, role: 'region', labelKey }
);

const anchors = {
    panel,
    optionImage: region(G.optionImage, 'ponder.anchors.grid3dCardStyle.image'),
    optionCard: region(G.optionCard, 'ponder.anchors.grid3dCardStyle.card'),
} satisfies Record<string, PonderAnchorSource>;

const styles: PonderSceneScript = {
    id: 'grid3d-card-style-options',
    titleKey: 'ponder.scenes.grid3dCardStyleOptions',
    action: {
        kind: 'openSettings',
        anchorId: 'grid3dCardStyle',
        labelKey: 'ponder.actions.openGrid3dCardStyle',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markImage', anchor: 'optionImage', intensity: [0, 0.85], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'image',
            textKey: 'ponder.captions.gridStyle.grid3dImage',
            pointTo: { anchor: 'optionImage' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readImage' },

        { kind: 'highlight', id: 'dimImage', anchor: 'optionImage', intensity: [0.85, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markCard', anchor: 'optionCard', intensity: [0, 0.85], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'card',
            textKey: 'ponder.captions.gridStyle.grid3dCard',
            pointTo: { anchor: 'optionCard' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readCard' },
    ],
};

export default {
    id: 'grid3d-card-style',
    titleKey: 'ponder.targets.grid3dCardStyle',
    category: 'appearance',
    summaryKey: 'ponder.summaries.grid3d_card_style',
    hoverSelector: '[data-settings-row="grid3dCardStyle"]',
    // 只有网格界面有这一行（设置页同一个谓词），别的资料库界面下无处可讲。
    isAvailable: isGridLibraryActive,
    relatedTargetIds: ['grid-view-card-settings', 'lattice-style-settings', 'settings-page'],
    scenes: [styles],
} satisfies PonderTargetDefinition;
