import { LYRICS_SOURCE_GEOMETRY as G } from '../../surfaces/settings/playbackSettings.geometry';
import { settingsPanel, settingsRegion } from './settingsSectionShared';
import type { PonderAnchorSource, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/settings/lyricsSettings.target.ts
// 设置 · 歌词里的「歌词来源」和「时间与过滤」。
//
// 两处会让人困惑：
// 1. 「自动择优」开着时会去检索几家的歌词并优先用逐字的那份 —— 它会盖掉你在来源页
//    手动选的那一份，而两处离得很远，手动选完发现没生效的人不会想到来这儿。
// 2. 这里的「全局时间轴偏移」和来源页那个 ±250ms 的单曲偏移同名、不同作用域，
//    而且是**相加**的。

const anchors = {
    panel: settingsPanel('lyrics-source-settings', 'ponder.anchors.lyricsSource.panel', { top: 0.16, width: 0.42, height: 0.5 }),
    autoBest: settingsRegion(G.autoBest, 'ponder.anchors.lyricsSource.autoBest'),
    priorityLocal: settingsRegion(G.priorityLocal, 'ponder.anchors.lyricsSource.priorityLocal'),
    priorityOnline: settingsRegion(G.priorityOnline, 'ponder.anchors.lyricsSource.priorityOnline'),
    globalOffset: settingsRegion(G.globalOffset, 'ponder.anchors.lyricsSource.globalOffset'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：歌词从哪来，以及自动择优会盖掉什么。 */
const source: PonderSceneScript = {
    id: 'lyrics-settings-source',
    titleKey: 'ponder.scenes.lyricsSettingsSource',
    action: {
        kind: 'openSettings',
        anchorId: 'lyrics',
        labelKey: 'ponder.actions.openLyricsSettings',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markAuto', anchor: 'autoBest', intensity: [0, 0.85], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'autoBest',
            textKey: 'ponder.captions.lyricsSource.autoBest',
            pointTo: { anchor: 'autoBest' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readAutoBest' },

        { kind: 'highlight', id: 'dimAuto', anchor: 'autoBest', intensity: [0.85, 0], durationMs: 400, keyframe: true },
        { kind: 'highlight', id: 'markLocal', anchor: 'priorityLocal', intensity: [0, 0.7], durationMs: 440, withPrevious: true },
        { kind: 'highlight', id: 'markOnline', anchor: 'priorityOnline', intensity: [0, 0.7], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'priority',
            textKey: 'ponder.captions.lyricsSource.priority',
            pointTo: { anchor: 'priorityLocal' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readPriority' },
    ],
};

/** 第二章：两个同名的偏移量。 */
const offsets: PonderSceneScript = {
    id: 'lyrics-settings-offset',
    titleKey: 'ponder.scenes.lyricsSettingsOffset',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markOffset', anchor: 'globalOffset', intensity: [0, 0.9], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'global',
            textKey: 'ponder.captions.lyricsSource.globalOffset',
            pointTo: { anchor: 'globalOffset' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readGlobal' },

        {
            kind: 'caption', id: 'sum',
            textKey: 'ponder.captions.lyricsSource.offsetSum',
            pointTo: { anchor: 'globalOffset' }, durationMs: 6800, keyframe: true,
        },
        { kind: 'pause', id: 'readSum' },
    ],
};

export default {
    id: 'lyrics-settings',
    titleKey: 'ponder.targets.lyricsSettings',
    category: 'playback',
    summaryKey: 'ponder.summaries.lyrics_settings',
    hoverSelector: '[data-settings-anchor="lyrics"], [data-settings-anchor="lyricAdjust"]',
    relatedTargetIds: ['panel-source-tab', 'lyrics-animation-settings'],
    scenes: [source, offsets],
} satisfies PonderTargetDefinition;
