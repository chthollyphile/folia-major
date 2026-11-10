import { REPLAY_GAIN_GEOMETRY as G } from '../../surfaces/settings/playbackSettings.geometry';
import { settingsPanel, settingsRegion } from './settingsSectionShared';
import type { PonderAnchorSource, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/settings/replayGainSettings.target.ts
// 设置 · 播放控制 · 声音与设备里的 ReplayGain 那一行（音频增益）。
//
// 值得单独讲的理由不是这三个选项难懂，而是它在应用里有两处入口：这里，和控制面板
// 来源页上那一小块同名控件。两处读写的是 usePlaybackStore 上同一个 replayGainMode，
// 改一处两处都变 —— 而界面上没有任何地方提过另一处的存在。
//
// 来源页那一处还多一行这首歌自己的 T / A 分贝：模式选好了却没生效，多半是这首歌
// 压根没带增益标签，而只有那一行看得出来。

const anchors = {
    panel: settingsPanel('replay-gain-settings', 'ponder.anchors.replayGain.panel', { top: 0.3, width: 0.42, height: 0.24 }),
    modeOff: settingsRegion(G.modeOff, 'ponder.anchors.replayGain.modeOff'),
    modeTrack: settingsRegion(G.modeTrack, 'ponder.anchors.replayGain.modeTrack'),
    modeAlbum: settingsRegion(G.modeAlbum, 'ponder.anchors.replayGain.modeAlbum'),
    panelTab: settingsRegion(G.panelTab, 'ponder.anchors.replayGain.panelTab'),
    panelSummary: { kind: 'relative', from: 'panelTab', rect: G.panelSummary, role: 'region', labelKey: 'ponder.anchors.replayGain.panelSummary' },
    panelModes: { kind: 'relative', from: 'panelTab', rect: G.panelModes, role: 'region', labelKey: 'ponder.anchors.replayGain.panelModes' },
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：三个选项各是什么。 */
const modes: PonderSceneScript = {
    id: 'replay-gain-modes',
    titleKey: 'ponder.scenes.replayGainModes',
    action: {
        kind: 'openSettings',
        anchorId: 'replayGainSettings',
        labelKey: 'ponder.actions.openReplayGain',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markOff', anchor: 'modeOff', intensity: [0, 0.85], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'off',
            textKey: 'ponder.captions.replayGain.off',
            pointTo: { anchor: 'modeOff' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readOff' },

        { kind: 'highlight', id: 'dimOff', anchor: 'modeOff', intensity: [0.85, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markTrack', anchor: 'modeTrack', intensity: [0, 0.85], durationMs: 440, withPrevious: true },
        { kind: 'highlight', id: 'markAlbum', anchor: 'modeAlbum', intensity: [0, 0.85], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'trackAlbum',
            textKey: 'ponder.captions.replayGain.trackAlbum',
            pointTo: { anchor: 'modeAlbum' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readTrackAlbum' },
    ],
};

/** 第二章：来源页上那一处是同一个值，而且它还看得出这首歌有没有增益标签。 */
const mirrored: PonderSceneScript = {
    id: 'replay-gain-mirrored',
    titleKey: 'ponder.scenes.replayGainMirrored',
    anchors,
    steps: [
        { kind: 'surfaceState', id: 'showPanel', anchor: 'panel', state: 'panel-mirror', transition: 'fade', durationMs: 520, keyframe: true },
        { kind: 'highlight', id: 'markPanelModes', anchor: 'panelModes', intensity: [0, 0.9], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'sameValue',
            textKey: 'ponder.captions.replayGain.sameValue',
            pointTo: { anchor: 'panelModes' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readSameValue' },

        { kind: 'highlight', id: 'dimPanelModes', anchor: 'panelModes', intensity: [0.9, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markSummary', anchor: 'panelSummary', intensity: [0, 0.95], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'summary',
            textKey: 'ponder.captions.replayGain.summary',
            pointTo: { anchor: 'panelSummary' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readSummary' },
    ],
};

export default {
    id: 'replay-gain-settings',
    titleKey: 'ponder.targets.replayGainSettings',
    category: 'playback',
    summaryKey: 'ponder.summaries.replay_gain_settings',
    hoverSelector: '[data-settings-row="replayGainSettings"]',
    relatedTargetIds: ['panel-source-tab', 'transition-settings'],
    scenes: [modes, mirrored],
} satisfies PonderTargetDefinition;
