import { AUDIO_EQUALIZER_GEOMETRY as G } from '../../surfaces/panel/audioEqualizer.geometry';
import { settingsPanel, settingsRegion } from '../settings/settingsSectionShared';
import type { PonderAnchorSource, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/panel/audioEqualizer.target.ts
// 控制页「音频效果器」那一格打开的窗口：十段均衡加一整条效果链。
//
// 单独成目标的理由只有一条，而且它会改用户的数据：**拖任何一根推子，都会把当前预设
// 静默换成自定义槽 1，并把值写进那个槽**。既没有确认，也没有任何提示 —— 想听听
// 「电台」再微调一下的人，微调的第一下就已经把自定义槽 1 里原来存的东西覆盖掉了。
//
// 复位那颗只清当前这个自定义槽，内置预设不可编辑，所以停在内置上时它是灰的。

const anchors = {
    panel: settingsPanel('audio-equalizer', 'ponder.anchors.audioEqualizer.panel', { top: 0.08, width: 0.62, height: 0.81 }),
    enable: settingsRegion(G.enable, 'ponder.anchors.audioEqualizer.enable'),
    presets: settingsRegion(G.presets, 'ponder.anchors.audioEqualizer.presets'),
    customSlots: settingsRegion(G.customSlots, 'ponder.anchors.audioEqualizer.customSlots'),
    reset: settingsRegion(G.reset, 'ponder.anchors.audioEqualizer.reset'),
    bands: settingsRegion(G.bands, 'ponder.anchors.audioEqualizer.bands'),
    bandFader: { kind: 'relative', from: 'bands', rect: G.bandFader, role: 'region', labelKey: 'ponder.anchors.audioEqualizer.bandFader' },
    effects: settingsRegion(G.effects, 'ponder.anchors.audioEqualizer.effects'),
    noiseBadge: { kind: 'relative', from: 'effects', rect: G.noiseBadge, role: 'region', labelKey: 'ponder.anchors.audioEqualizer.noiseBadge' },
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：右上角的开关、六个内置预设，和同一排里那两个自己的槽。 */
const presets: PonderSceneScript = {
    id: 'audio-equalizer-presets',
    titleKey: 'ponder.scenes.audioEqualizerPresets',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markEnable', anchor: 'enable', intensity: [0, 0.85], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'enable',
            textKey: 'ponder.captions.audioEqualizer.enable',
            pointTo: { anchor: 'enable' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readEnable' },

        { kind: 'highlight', id: 'dimEnable', anchor: 'enable', intensity: [0.85, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markPresets', anchor: 'presets', intensity: [0, 0.85], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'presets',
            textKey: 'ponder.captions.audioEqualizer.presets',
            pointTo: { anchor: 'presets' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readPresets' },

        { kind: 'highlight', id: 'dimPresets', anchor: 'presets', intensity: [0.85, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markSlots', anchor: 'customSlots', intensity: [0, 0.95], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'slots',
            textKey: 'ponder.captions.audioEqualizer.slots',
            pointTo: { anchor: 'customSlots' }, durationMs: 6200, withPrevious: true,
        },
        { kind: 'pause', id: 'readSlots' },
    ],
};

/** 第二章：拖一根推子就换槽并覆写。这一章是整个目标存在的理由。 */
const silentWrite: PonderSceneScript = {
    id: 'audio-equalizer-silent-write',
    titleKey: 'ponder.scenes.audioEqualizerSilentWrite',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markBands', anchor: 'bands', intensity: [0, 0.7], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'bands',
            textKey: 'ponder.captions.audioEqualizer.bands',
            pointTo: { anchor: 'bands' }, durationMs: 5600, withPrevious: true,
        },
        { kind: 'pause', id: 'readBands' },

        // 拖那一根，再让结果层把「选中的变成了自定义槽 1」换上来。
        // 只说不演的话，读者没法把自己拖的那一根和亮起来的那一颗连上。
        { kind: 'highlight', id: 'dimBands', anchor: 'bands', intensity: [0.7, 0], durationMs: 300, keyframe: true },
        {
            kind: 'drag', id: 'dragFader', withPrevious: true,
            from: { anchor: 'bandFader', y: 0.5 },
            to: { anchor: 'bandFader', y: 0.18 },
            durationMs: 900,
        },
        { kind: 'surfaceState', id: 'written', anchor: 'panel', state: 'custom-written', durationMs: 460 },
        {
            kind: 'caption', id: 'silent',
            textKey: 'ponder.captions.audioEqualizer.silent',
            pointTo: { anchor: 'customSlots' }, durationMs: 7600, withPrevious: true,
        },
        { kind: 'pause', id: 'readSilent' },

        { kind: 'highlight', id: 'markReset', anchor: 'reset', intensity: [0, 0.95], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'reset',
            textKey: 'ponder.captions.audioEqualizer.reset',
            pointTo: { anchor: 'reset' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readReset' },
    ],
};

/** 第三章：下半那一片效果推子，以及标题旁边那枚「会加噪」的徽章。 */
const effects: PonderSceneScript = {
    id: 'audio-equalizer-effects',
    titleKey: 'ponder.scenes.audioEqualizerEffects',
    anchors,
    steps: [
        { kind: 'highlight', id: 'markEffects', anchor: 'effects', intensity: [0, 0.8], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'effects',
            textKey: 'ponder.captions.audioEqualizer.effects',
            pointTo: { anchor: 'effects' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readEffects' },

        { kind: 'highlight', id: 'dimEffects', anchor: 'effects', intensity: [0.8, 0], durationMs: 380, keyframe: true },
        { kind: 'highlight', id: 'markBadge', anchor: 'noiseBadge', intensity: [0, 0.95], durationMs: 440, withPrevious: true },
        {
            kind: 'caption', id: 'noise',
            textKey: 'ponder.captions.audioEqualizer.noise',
            pointTo: { anchor: 'noiseBadge' }, durationMs: 7000, withPrevious: true,
        },
        { kind: 'pause', id: 'readNoise' },
    ],
};

export default {
    id: 'audio-equalizer',
    titleKey: 'ponder.targets.audioEqualizer',
    category: 'playback',
    summaryKey: 'ponder.summaries.audio_equalizer',
    // 入口那颗图标和展开的对话框都算它：用户可能指着任何一处问「这是什么」。
    hoverSelector: '[data-ponder="audio-equalizer"]',
    relatedTargetIds: ['panel-controls-tab', 'replay-gain-settings'],
    scenes: [presets, silentWrite, effects],
} satisfies PonderTargetDefinition;
