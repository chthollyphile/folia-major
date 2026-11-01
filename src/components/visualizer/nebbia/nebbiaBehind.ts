import type { VisualizerBackgroundConfig } from '../backgrounds/definition';
import type { VisualizerSharedProps } from '../definition';
import type { VisualizerTuningBundle } from '../tuningRegistry';
import { BEAT_EFFECT_IDS } from '../../../services/beatFx/beatEffects';
import nebbiaTuning from './tuning';
import type { NebbiaTuning } from './types';

// src/components/visualizer/nebbia/nebbiaBehind.ts
// 雾笺窗外是什么：自己画的雨夜街景，或者共用背景。设置里选了共用背景，或者播放页透明（共用背景卸掉、透出桌面）时，
// 雾笺不画窗外，画布带透明通道（nebbiaGl.ts 的 seeThrough）。

/**
 * 雾笺这一帧要不要透出后面：tuning 选了共用背景，或者播放页透明。样式小图（preview/LyricStylePicture.tsx）也把背景标成透明
 * 来表示「不画背景」，预览里不算播放页透明，小图照样是街景。
 */
export const nebbiaSeesThrough = (tuning: NebbiaTuning, background: VisualizerBackgroundConfig | undefined, isPreview = false) => (
    tuning.behind === 'backdrop' || (!isPreview && Boolean(background?.transparent))
);

/** entry.tsx 的 background：透出后面时照常画共用背景，画街景时不要（标成透明，背景层就什么都不画）。 */
export const nebbiaBackgroundConfig = (props: VisualizerSharedProps): VisualizerBackgroundConfig | undefined => (
    nebbiaSeesThrough(nebbiaTuning.read(props.visualizerTunings), props.background, props.isPreviewMode)
        ? props.background
        : { ...props.background, transparent: true }
);

/** entry.tsx 的 showsBackground：不算播放页透明（beatClockTargets.ts 自己算），只看窗外选没选共用背景。 */
export const nebbiaShowsBackground = (tunings: VisualizerTuningBundle) => (
    nebbiaSeesThrough(nebbiaTuning.read(tunings), undefined)
);

/**
 * entry.tsx 的 beatEffectOnScreen：「舞潮踏拍」只在窗外画水族箱时算（选了共用背景、播放页透明时窗外不画）；
 * 「疏雨轻车」的雨打在雨窗玻璃上、车只在不画水族箱时颠：画水族箱又是凝露玻璃时两样都没有，不算（不为它分离音轨）；
 * 播放页透明时透出后面，不画水族箱，车照旧颠。
 */
export const nebbiaBeatEffectOnScreen = (effectId: string, tunings: VisualizerTuningBundle, pageTransparent: boolean) => {
    const tuning = nebbiaTuning.read(tunings);
    const aquarium = tuning.behind === 'aquarium' && !pageTransparent;
    if (effectId === BEAT_EFFECT_IDS.nebbiaAquaBeat) return aquarium;
    if (effectId === BEAT_EFFECT_IDS.nebbiaDrizzleRide) return !aquarium || tuning.glass === 'rain';
    return true;
};
