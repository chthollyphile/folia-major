import { IMPORT_EXPORT_GEOMETRY as G } from '../../surfaces/settings/importExport.geometry';
import { settingsPanel, settingsRegion } from './settingsSectionShared';
import type { PonderAnchorSource, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/settings/importExportSettings.target.ts
// 设置 · 存储与备份里的「备份与导入」。
//
// 名字最容易让人想歪：它导的只有 buildVisualSettingsConfig 那一套 —— 配色主题、
// 歌词动画与各渲染器的调参、字幕与字体、背景、曲目卡片（以及 bravais 墙的集合叠页边、信息条材质与墙后画面的几个开关）。歌单、本地曲库、播放设置、
// 快捷键、账号一样都不在里面。当成整机备份用，出事时才发现只恢复回来一套配色。
//
// 另一半是导入：它不照单全收，先弹一个逐项对照框（ImportConfirmDialog），按组列出
// 「原值 → 新值」逐条勾。其中一截是配置里根本没提、却会被连带改掉的衍生改动 ——
// 接受别人的配色会把「偏好自定义主题」顶掉，接受一个系统字体会把你上传的字体文件删掉。

const anchors = {
    panel: settingsPanel('import-export-settings', 'ponder.anchors.importExport.panel', { top: 0.2, width: 0.46, height: 0.5 }),
    copy: settingsRegion(G.copy, 'ponder.anchors.importExport.copy'),
    themeChips: settingsRegion(G.themeChips, 'ponder.anchors.importExport.themeChips'),
    textarea: settingsRegion(G.textarea, 'ponder.anchors.importExport.textarea'),
    exportButtons: settingsRegion(G.exportButtons, 'ponder.anchors.importExport.exportButtons'),
    importButton: settingsRegion(G.importButton, 'ponder.anchors.importExport.importButton'),
    dialog: settingsRegion(G.dialog, 'ponder.anchors.importExport.dialog'),
    dialogGroups: { kind: 'relative', from: 'dialog', rect: G.dialogGroups, role: 'region', labelKey: 'ponder.anchors.importExport.dialogGroups' },
    dialogDerived: { kind: 'relative', from: 'dialog', rect: G.dialogDerived, role: 'region', labelKey: 'ponder.anchors.importExport.dialogDerived' },
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：它到底备份了什么 —— 以及没有备份什么。 */
const whatItCarries: PonderSceneScript = {
    id: 'import-export-scope',
    titleKey: 'ponder.scenes.importExportScope',
    action: {
        kind: 'openSettings',
        anchorId: 'importExportTitle',
        labelKey: 'ponder.actions.openImportExport',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markCopy', anchor: 'copy', intensity: [0, 0.8], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'scope',
            textKey: 'ponder.captions.importExport.scope',
            pointTo: { anchor: 'copy' }, durationMs: 7400, withPrevious: true,
        },
        { kind: 'pause', id: 'readScope' },

        {
            kind: 'caption', id: 'notBackup',
            textKey: 'ponder.captions.importExport.notBackup',
            pointTo: { anchor: 'panel' }, durationMs: 7000, keyframe: true,
        },
        { kind: 'pause', id: 'readNotBackup' },
    ],
};

/** 第二章：导出的形状 —— 先选带哪个主题，按钮把短码复制进剪贴板。 */
const exporting: PonderSceneScript = {
    id: 'import-export-export',
    titleKey: 'ponder.scenes.importExportExport',
    anchors,
    steps: [
        { kind: 'highlight', id: 'dimCopy', anchor: 'copy', intensity: [0.8, 0], durationMs: 300, keyframe: true },
        { kind: 'highlight', id: 'markChips', anchor: 'themeChips', intensity: [0, 0.9], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'themeChoice',
            textKey: 'ponder.captions.importExport.themeChoice',
            pointTo: { anchor: 'themeChips' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readThemeChoice' },

        { kind: 'highlight', id: 'dimChips', anchor: 'themeChips', intensity: [0.9, 0], durationMs: 380, keyframe: true },
        { kind: 'cursor', id: 'pressExport', to: { anchor: 'exportButtons', x: 0.25 }, press: 'tap', durationMs: 640, withPrevious: true },
        { kind: 'highlight', id: 'markButtons', anchor: 'exportButtons', intensity: [0, 0.9], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'clipboard',
            textKey: 'ponder.captions.importExport.clipboard',
            pointTo: { anchor: 'exportButtons' }, durationMs: 6600, withPrevious: true,
        },
        { kind: 'pause', id: 'readClipboard' },

        { kind: 'highlight', id: 'dimButtons', anchor: 'exportButtons', intensity: [0.9, 0], durationMs: 360, keyframe: true },
        { kind: 'highlight', id: 'markTextarea', anchor: 'textarea', intensity: [0, 0.85], durationMs: 420, withPrevious: true },
        {
            kind: 'caption', id: 'paste',
            textKey: 'ponder.captions.importExport.paste',
            pointTo: { anchor: 'textarea' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readPaste' },
    ],
};

/** 第三章：导入不是照单全收 —— 逐项对照框，以及勾不掉的那几条。 */
const confirming: PonderSceneScript = {
    id: 'import-export-confirm',
    titleKey: 'ponder.scenes.importExportConfirm',
    anchors,
    steps: [
        { kind: 'cursor', id: 'pressImport', to: { anchor: 'importButton' }, press: 'tap', durationMs: 660, keyframe: true },
        { kind: 'surfaceState', id: 'dialogOpens', anchor: 'panel', state: 'import-plan', transition: 'zoom', durationMs: 560 },
        {
            kind: 'caption', id: 'plan',
            textKey: 'ponder.captions.importExport.plan',
            pointTo: { anchor: 'dialogGroups' }, durationMs: 7200, withPrevious: true,
        },
        { kind: 'pause', id: 'readPlan' },

        { kind: 'highlight', id: 'markDerived', anchor: 'dialogDerived', intensity: [0, 0.95], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'derived',
            textKey: 'ponder.captions.importExport.derived',
            pointTo: { anchor: 'dialogDerived' }, durationMs: 7600, withPrevious: true,
        },
        { kind: 'pause', id: 'readDerived' },
    ],
};

export default {
    id: 'import-export-settings',
    titleKey: 'ponder.targets.importExportSettings',
    category: 'appearance',
    summaryKey: 'ponder.summaries.import_export_settings',
    hoverSelector: '[data-settings-anchor="importExportTitle"]',
    relatedTargetIds: ['theme-settings', 'lyrics-animation-settings'],
    scenes: [whatItCarries, exporting, confirming],
} satisfies PonderTargetDefinition;
