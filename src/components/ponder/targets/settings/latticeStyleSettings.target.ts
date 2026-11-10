import { LATTICE_STYLE_GEOMETRY as G } from '../../surfaces/settings/appearanceSettings.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/settings/latticeStyleSettings.target.ts
// 设置 · 播放页 · 视图里管拼贴墙外观的那几行 —— Lattice 那面海报墙（以及 bravais 资料库墙）长什么样。
//
// 这一组是全设置里层层嵌套最深的一处：叠色关着时下面什么都没有，开了才有强度和
// 「自定义颜色」，再开自定义颜色才有取色器。不演一遍的话，看到的只是两个开关，
// 而「叠色强度在哪调」这个问题永远问不出答案。

const panel = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.12, width: 0.44, height: 0.54, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'lattice-style-settings',
    labelKey: 'ponder.anchors.latticeStyle.panel',
} satisfies PonderAnchorSource;

const region = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'panel', rect, role: 'region', labelKey }
);

const anchors = {
    panel,
    vignette: region(G.vignette, 'ponder.anchors.latticeStyle.vignette'),
    tint: region(G.tint, 'ponder.anchors.latticeStyle.tint'),
    customColor: region(G.customColor, 'ponder.anchors.latticeStyle.customColor'),
    picker: region(G.picker, 'ponder.anchors.latticeStyle.picker'),
    intensity: region(G.intensity, 'ponder.anchors.latticeStyle.intensity'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：暗角，以及打开叠色之后长出来的强度。 */
const tintBasics: PonderSceneScript = {
    id: 'lattice-style-tint',
    titleKey: 'ponder.scenes.latticeStyleTint',
    action: {
        kind: 'openSettings',
        anchorId: 'latticeSettings',
        labelKey: 'ponder.actions.openLatticeSettings',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markVignette', anchor: 'vignette', intensity: [0, 0.85], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'vignette',
            textKey: 'ponder.captions.gridStyle.latticeVignette',
            pointTo: { anchor: 'vignette' }, durationMs: 5400, withPrevious: true,
        },
        { kind: 'pause', id: 'readVignette' },

        { kind: 'highlight', id: 'dimVignette', anchor: 'vignette', intensity: [0.85, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markTint', anchor: 'tint', intensity: [0, 0.85], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'tint',
            textKey: 'ponder.captions.gridStyle.latticeTint',
            pointTo: { anchor: 'tint' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readTint' },

        { kind: 'cursor', id: 'turnOnTint', to: { anchor: 'tint', x: 0.93 }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'highlight', id: 'dimTint', anchor: 'tint', intensity: [0.85, 0], durationMs: 400, withPrevious: true },
        { kind: 'surfaceState', id: 'tintOpens', anchor: 'panel', state: 'tint-on', transition: 'slide-up', durationMs: 480 },
        {
            kind: 'caption', id: 'intensity',
            textKey: 'ponder.captions.gridStyle.latticeIntensity',
            pointTo: { anchor: 'intensity' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readIntensity' },
    ],
};

/** 第二章：再往里一层 —— 固定颜色和取色器。 */
const customColor: PonderSceneScript = {
    id: 'lattice-style-custom-color',
    titleKey: 'ponder.scenes.latticeStyleCustomColor',
    anchors,
    steps: [
        { kind: 'surfaceState', id: 'tintOpens', anchor: 'panel', state: 'tint-on', durationMs: 420, keyframe: true },
        { kind: 'highlight', id: 'markCustom', anchor: 'customColor', intensity: [0, 0.85], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'custom',
            textKey: 'ponder.captions.gridStyle.latticeCustomColor',
            pointTo: { anchor: 'customColor' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readCustom' },

        { kind: 'cursor', id: 'turnOnCustom', to: { anchor: 'customColor', x: 0.93 }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'highlight', id: 'dimCustom', anchor: 'customColor', intensity: [0.85, 0], durationMs: 400, withPrevious: true },
        { kind: 'surfaceState', id: 'pickerOpens', anchor: 'panel', state: 'custom-color-on', transition: 'slide-up', durationMs: 480 },
        {
            kind: 'caption', id: 'picker',
            textKey: 'ponder.captions.gridStyle.latticePicker',
            pointTo: { anchor: 'picker' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readPicker' },
    ],
};

export default {
    id: 'lattice-style-settings',
    titleKey: 'ponder.targets.latticeStyleSettings',
    category: 'appearance',
    summaryKey: 'ponder.summaries.lattice_style_settings',
    hoverSelector: '[data-settings-row="latticeSettings"]',
    relatedTargetIds: ['lattice-page', 'grid3d-card-style', 'grid-view-card-settings'],
    scenes: [tintBasics, customColor],
} satisfies PonderTargetDefinition;
