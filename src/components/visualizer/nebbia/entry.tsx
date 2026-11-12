import React from 'react';
import { QuickControlChip } from '../../shared/QuickControlChip';
import { defineVisualizer, type VisualizerQuickControlsProps } from '../definition';
import { nebbiaBackgroundConfig, nebbiaBeatEffectOnScreen, nebbiaShowsBackground } from './nebbiaBehind';
import NebbiaSettingsPanel, { NEBBIA_APPEAR_LABEL_KEYS, NEBBIA_FADE_LABEL_KEYS } from './NebbiaSettingsPanel';
import nebbiaTuning from './tuning';
import type { NebbiaTuning } from './types';
import { BEAT_EFFECT_IDS } from '../../../services/beatFx/beatEffects';

const VisualizerNebbia = React.lazy(() => import('./VisualizerNebbia'));

// src/components/visualizer/nebbia/entry.tsx
// Registers 雾笺 (Nebbia): writing lyrics with a fingertip on the fogged-up window of a bus on a rainy night.
// Each character is written stroke by stroke in its stroke order and wipes the fog clear onto the city
// outside; beads gather along the wipe, drops run down, the fog creeps back. Raindrops hit the glass with
// the vocal, and two spotlights from the street follow the character being sung.

// 播放页的两个小按钮按这几组常用搭配轮换（设置里可以随意组合；不是其中哪一组时显示「自定义」）
const APPEAR_PRESETS: { appear: NebbiaTuning['appear']; labelKey: string }[] = [
    { appear: ['write', 'fade'], labelKey: 'options.nebbiaAppearAuto' },
    { appear: ['write'], labelKey: NEBBIA_APPEAR_LABEL_KEYS.write },
    { appear: ['fade'], labelKey: NEBBIA_APPEAR_LABEL_KEYS.fade },
    { appear: ['fade', 'breath'], labelKey: NEBBIA_APPEAR_LABEL_KEYS.breath },
];
const FADE_PRESETS: { fade: NebbiaTuning['fade']; labelKey: string }[] = [
    { fade: ['fog'], labelKey: NEBBIA_FADE_LABEL_KEYS.fog },
    { fade: ['fingers'], labelKey: NEBBIA_FADE_LABEL_KEYS.fingers },
    { fade: ['fog', 'fingers'], labelKey: 'options.nebbiaFadeMix' },
];
/** 当前搭配在预设里的位置；不在里面是 -1。 */
const presetIndex = (presets: { labelKey: string }[], pick: (i: number) => readonly string[], on: readonly string[]) => (
    presets.findIndex((_, i) => pick(i).join() === on.join())
);

export default defineVisualizer({
    mode: 'nebbia',
    order: 29,
    labelKey: 'ui.visualizerNebbia',
    labelFallback: '雾笺',
    previewSeed: 'nebbia',
    previewStartOffset: 0,
    // 雾笺：一扇窗，雾上手指写的一笔，几颗水珠
    glyph: (
        <>
            <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
            <path d="M7 14c2-3.5 4-3.5 5 0s3 3 5-1" opacity="0.6" />
            <path d="M8 8v1.5M15.5 7.5v2" opacity="0.5" />
        </>
    ),
    command: {
        title: 'Visualizer: Nebbia',
        description: 'Switch to the Nebbia fogged-window writing',
        keywords: ['nebbia', 'rain window', 'fog', 'bus window', 'writing on glass', 'raindrops', '雾笺', '起雾', '玻璃写字', '公交车', '雨夜'],
    },
    // 画面自己画窗外的夜景时不要共用背景；窗外选了共用背景、或播放页透明时照常画它（nebbiaBehind.ts）。
    background: nebbiaBackgroundConfig,
    showsBackground: nebbiaShowsBackground,
    usesWordSegmentation: true,
    // 智能动感模式, 疏雨轻车: one effect, two parts, both off the htdemucs run (`source: 'stems'`).
    // - rain (雨点强度): the rain follows the vocal stem (analysis/vocalEnvelope.ts) - small drops as
    //   dense as the voice is loud, a big one on every sung onset; its strength scales the density and
    //   the big drops' size. Until the track is analysed it follows the 1-3.5 kHz band of the mix.
    // - bump (颠簸强度): the bus jolts on the kicks (nebbiaDrumBumps.ts) instead of at random;
    //   its strength scales the jolts. A drumless or not yet analysed track keeps the random ones.
    // 舞潮踏拍, off Beat This!' beats, the aquarium's own (nebbiaAquarium.ts): the jellyfish pulse, the seaweed
    // sways, a row of big bubbles rises from the sand (no random big bubbles while it is on) and the spotlight's pool swells on each beat, one strength each. Counted only while the
    // aquarium is chosen (drawn, or refracted in the drops on a see-through page), and 疏雨轻车 only while it is not - the aquarium has no rain on the glass and no bumps
    // (beatEffectOnScreen).
    beatEffects: [
        {
            id: BEAT_EFFECT_IDS.nebbiaDrizzleRide,
            nameKey: 'options.beatEffect_nebbiaDrizzleRide',
            descKey: 'options.beatEffect_nebbiaDrizzleRideDesc',
            source: 'stems',
            parts: [
                { key: 'rain', nameKey: 'options.beatEffectPart_nebbiaRain' },
                { key: 'bump', nameKey: 'options.beatEffectPart_nebbiaBump' },
            ],
        },
        {
            id: BEAT_EFFECT_IDS.nebbiaAquaBeat,
            nameKey: 'options.beatEffect_nebbiaAquaBeat',
            descKey: 'options.beatEffect_nebbiaAquaBeatDesc',
            source: 'beats',
            parts: [
                { key: 'jelly', nameKey: 'options.beatEffectPart_nebbiaJelly' },
                { key: 'weed', nameKey: 'options.beatEffectPart_nebbiaWeed' },
                { key: 'bubble', nameKey: 'options.beatEffectPart_nebbiaBubble' },
                { key: 'spot', nameKey: 'options.beatEffectPart_nebbiaSpot' },
            ],
        },
    ],
    beatEffectOnScreen: nebbiaBeatEffectOnScreen,
    // Its shaders compile in the background (cold, about a second on D3D11): at once when it is the saved
    // style, otherwise once the app is idle, so the first switch to it finds them in the GPU cache.
    prewarmWhenIdle: true,
    prewarm: () => {
        void import('./nebbiaShaderWarmup')
            .then(module => module.warmNebbiaShaders())
            .catch(error => console.warn('[Nebbia] shader warm-up did not load', error));
    },
    // Deliberately unkeyed on the seed: the runtime takes a track change in place (createNebbiaRuntime.ts).
    render: props => <VisualizerNebbia {...props} nebbiaTuning={nebbiaTuning.read(props.visualizerTunings)} />,
    renderSettingsPanel: props => <NebbiaSettingsPanel {...props} />,
    renderQuickControls: ({ tuning, onTuningChange, t }: VisualizerQuickControlsProps<NebbiaTuning>) => {
        const ai = presetIndex(APPEAR_PRESETS, i => APPEAR_PRESETS[i].appear, tuning.appear);
        const fi = presetIndex(FADE_PRESETS, i => FADE_PRESETS[i].fade, tuning.fade);
        const appear = t(ai >= 0 ? APPEAR_PRESETS[ai].labelKey : 'options.nebbiaCustom');
        const fade = t(fi >= 0 ? FADE_PRESETS[fi].labelKey : 'options.nebbiaCustom');
        return (
            <>
                <QuickControlChip
                    label={appear}
                    title={`${t('options.nebbiaAppear')}: ${appear}`}
                    onClick={() => onTuningChange({ appear: APPEAR_PRESETS[(ai + 1) % APPEAR_PRESETS.length].appear })}
                />
                <QuickControlChip
                    label={fade}
                    title={`${t('options.nebbiaFade')}: ${fade}`}
                    onClick={() => onTuningChange({ fade: FADE_PRESETS[(fi + 1) % FADE_PRESETS.length].fade })}
                />
            </>
        );
    },
});
