import { LYRICS_ANIMATION_SETTINGS_GEOMETRY as G } from '../../surfaces/settings/settingsSections.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/settings/lyricsAnimationSettings.target.ts
// 设置 · 外观里的「歌词动画」那一组。
//
// 单独成一个目标而不是并进 settings-page：那一章讲的是「设置怎么分组、怎么搜」，
// 而这里要回答的是一个具体问题 —— 换歌词动画到底在哪儿换。这两件事的读者不是同一批人。
//
// 这一组只有一行：通往歌词样式窗口的入口。几何来自 settingsSections.geometry，
// 和 settingsSections.surface.tsx 画的是同一组数。

const panel = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.28, width: 0.46, height: 0.30, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'lyrics-animation-settings',
    labelKey: 'ponder.anchors.lyricsAnimation.panel',
} satisfies PonderAnchorSource;

const region = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'panel', rect, role: 'region', labelKey }
);

const anchors = {
    panel,
    entry: region(G.entry, 'ponder.anchors.lyricsAnimation.entry'),
} satisfies Record<string, PonderAnchorSource>;

/** 换歌词动画的入口在哪，点开是什么。 */
const entryPoint: PonderSceneScript = {
    id: 'lyrics-animation-entry',
    titleKey: 'ponder.scenes.lyricsAnimationEntry',
    action: {
        kind: 'openSettings',
        anchorId: 'lyricsRenderer',
        labelKey: 'ponder.actions.openLyricsAnimation',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markEntry', anchor: 'entry', intensity: [0, 0.8], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'where',
            textKey: 'ponder.captions.lyricsAnimation.where',
            pointTo: { anchor: 'entry' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readWhere' },

        { kind: 'cursor', id: 'openPlayground', to: { anchor: 'entry' }, press: 'tap', durationMs: 660, keyframe: true },
        // 高亮是骨架层画的，歌词样式窗口盖上来它不会跟着走，得显式熄掉。
        { kind: 'highlight', id: 'dimEntry', anchor: 'entry', intensity: [0.8, 0], durationMs: 420, withPrevious: true },
        { kind: 'surfaceState', id: 'playgroundOpens', anchor: 'panel', state: 'playground-open', transition: 'zoom', durationMs: 560 },
        {
            kind: 'caption', id: 'playground',
            textKey: 'ponder.captions.lyricsAnimation.playground',
            pointTo: { anchor: 'panel' }, durationMs: 5800, withPrevious: true,
        },
        { kind: 'pause', id: 'readPlayground' },

        {
            kind: 'caption', id: 'sections',
            textKey: 'ponder.captions.lyricsAnimation.playgroundSections',
            pointTo: { anchor: 'panel' }, durationMs: 6000, keyframe: true,
        },
        { kind: 'pause', id: 'readSections' },
    ],
};

export default {
    id: 'lyrics-animation-settings',
    titleKey: 'ponder.targets.lyricsAnimationSettings',
    category: 'appearance',
    summaryKey: 'ponder.summaries.lyrics_animation_settings',
    hoverSelector: '[data-settings-anchor="lyricsRenderer"]',
    relatedTargetIds: ['settings-page', 'theme-settings'],
    scenes: [entryPoint],
} satisfies PonderTargetDefinition;
