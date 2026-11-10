import { LIBRARY_WATCH_GEOMETRY as G } from '../../surfaces/settings/playbackSettings.geometry';
import { settingsPanel, settingsRegion } from './settingsSectionShared';
import type { PonderAnchorSource, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/settings/localLibraryWatch.target.ts
// 设置 · 存储里的「本地文件夹监视」。
//
// 值得单独讲的是那张列表：开关打开之后才展开，每一行的图标有两种 —— 正常的眼睛，
// 和警告的三角。后者意味着这个文件夹的监视已经失效（路径没了、权限没了），
// 而失效之后扫描只是静静地不再发生，界面上不会有任何别的提示。

const anchors = {
    panel: settingsPanel('library-watch-settings', 'ponder.anchors.libraryWatch.panel', { top: 0.18, width: 0.4, height: 0.48 }),
    enable: settingsRegion(G.enable, 'ponder.anchors.libraryWatch.enable'),
    roots: settingsRegion(G.roots, 'ponder.anchors.libraryWatch.roots'),
    recheck: settingsRegion(G.recheck, 'ponder.anchors.libraryWatch.recheck'),
} satisfies Record<string, PonderAnchorSource>;

const watching: PonderSceneScript = {
    id: 'local-library-watch-roots',
    titleKey: 'ponder.scenes.localLibraryWatchRoots',
    action: {
        kind: 'openSettings',
        anchorId: 'localLibraryWatch',
        labelKey: 'ponder.actions.openLibraryWatch',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markEnable', anchor: 'enable', intensity: [0, 0.85], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'enable',
            textKey: 'ponder.captions.libraryWatch.enable',
            pointTo: { anchor: 'enable' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readEnable' },

        { kind: 'cursor', id: 'turnOn', to: { anchor: 'enable', x: 0.93 }, press: 'tap', durationMs: 620, keyframe: true },
        { kind: 'highlight', id: 'dimEnable', anchor: 'enable', intensity: [0.85, 0], durationMs: 400, withPrevious: true },
        { kind: 'surfaceState', id: 'expand', anchor: 'panel', state: 'watch-on', transition: 'slide-up', durationMs: 500 },
        {
            kind: 'caption', id: 'roots',
            textKey: 'ponder.captions.libraryWatch.roots',
            pointTo: { anchor: 'roots' }, durationMs: 6600, withPrevious: true,
        },
        { kind: 'pause', id: 'readRoots' },

        { kind: 'highlight', id: 'markWarning', anchor: 'roots', intensity: [0, 0.85], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'warning',
            textKey: 'ponder.captions.libraryWatch.warning',
            pointTo: { anchor: 'roots' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readWarning' },

        { kind: 'highlight', id: 'dimRoots', anchor: 'roots', intensity: [0.85, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markRecheck', anchor: 'recheck', intensity: [0, 0.9], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'recheck',
            textKey: 'ponder.captions.libraryWatch.recheck',
            pointTo: { anchor: 'recheck' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readRecheck' },
    ],
};

export default {
    id: 'local-library-watch',
    titleKey: 'ponder.targets.localLibraryWatch',
    category: 'browsing',
    summaryKey: 'ponder.summaries.local_library_watch',
    hoverSelector: '[data-settings-anchor="localLibraryWatch"]',
    relatedTargetIds: ['local-folder-actions', 'settings-page'],
    scenes: [watching],
} satisfies PonderTargetDefinition;
