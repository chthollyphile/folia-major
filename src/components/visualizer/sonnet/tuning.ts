import { DEFAULT_SONNET_TUNING, type SonnetTuning } from '../../../types';
import { normalizeLyricRenderOverride } from '../../../utils/lyricRenderQuality';
import { defineVisualizerTuning, modNumber, MOD_SWITCH, modChoice, numberWithin, type StoredTuningFields } from '../tuningDefinition';

// src/components/visualizer/sonnet/tuning.ts
// Sonnet's tuning: its defaults, the settings store fields it lives in, where it is stored and
// how a stored value and a change are read, and the renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'sonnetTuning', 'handleSetSonnetTuning', 'handleResetSonnetTuning', SonnetTuning> {}
}

const switchOr = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

/** The tuning `values` ask for, with `base` where they say nothing or something that cannot be: every number inside its range. */
const resolve = (values: Partial<SonnetTuning>, base: SonnetTuning): SonnetTuning => ({
    // 分辨率与抗锯齿的覆盖（#929）：旧存档没有这项就是全跟随全局；只改一半的补丁保留另一半，不认识的值回到「跟随全局」。
    render: normalizeLyricRenderOverride({ ...base.render, ...(values.render ?? {}) }),
    cameraIntensity: numberWithin(values.cameraIntensity, base.cameraIntensity, 0, 2),
    typographyMotion: numberWithin(values.typographyMotion, base.typographyMotion, 0, 2),
    mgDensity: numberWithin(values.mgDensity, base.mgDensity, 0, 2),
    showOnlyText: switchOr(values.showOnlyText, base.showOnlyText),
    showGuide: switchOr(values.showGuide, base.showGuide),
    showBackgroundMg: switchOr(values.showBackgroundMg, base.showBackgroundMg),
    showFixedGeo: switchOr(values.showFixedGeo, base.showFixedGeo),
    showGiantDecorativeText: switchOr(values.showGiantDecorativeText, base.showGiantDecorativeText),
    showBackgroundDecor: switchOr(values.showBackgroundDecor, base.showBackgroundDecor),
    enableTransitions: switchOr(values.enableTransitions, base.enableTransitions),
    outerFrameMode: values.outerFrameMode === 'none'
        || values.outerFrameMode === 'frame'
        || values.outerFrameMode === 'full'
        ? values.outerFrameMode
        : base.outerFrameMode,
    textureResolution: numberWithin(values.textureResolution, base.textureResolution, 0.5, 4),
    postProcessEnabled: switchOr(values.postProcessEnabled, base.postProcessEnabled),
    postProcessGrain: numberWithin(values.postProcessGrain, base.postProcessGrain, 0, 1),
    postProcessContrast: numberWithin(values.postProcessContrast, base.postProcessContrast, 0, 1),
    postProcessRgbShift: numberWithin(values.postProcessRgbShift, base.postProcessRgbShift, 0, 1),
    postProcessHalftone: numberWithin(values.postProcessHalftone, base.postProcessHalftone, 0, 1),
    postProcessVignette: numberWithin(values.postProcessVignette, base.postProcessVignette, 0, 2),
    postProcessLensDistortion: numberWithin(values.postProcessLensDistortion, base.postProcessLensDistortion, 0, 2),
    postProcessLensDispersion: numberWithin(values.postProcessLensDispersion, base.postProcessLensDispersion, 0, 1),
});

export default defineVisualizerTuning<SonnetTuning>({
    mode: 'sonnet',
    defaults: DEFAULT_SONNET_TUNING,
    // What mods may read and write (folium.visualizer.setTuning): the panel's own controls, without what the picture costs.
    modKeys: {
        cameraIntensity: modNumber(0, 2),
        typographyMotion: modNumber(0, 2),
        mgDensity: modNumber(0, 2),
        showOnlyText: MOD_SWITCH,
        showGuide: MOD_SWITCH,
        showBackgroundMg: MOD_SWITCH,
        showFixedGeo: MOD_SWITCH,
        showGiantDecorativeText: MOD_SWITCH,
        showBackgroundDecor: MOD_SWITCH,
        enableTransitions: MOD_SWITCH,
        outerFrameMode: modChoice(['none', 'frame', 'full']),
        postProcessEnabled: MOD_SWITCH,
        postProcessGrain: modNumber(0, 1),
        postProcessContrast: modNumber(0, 1),
        postProcessRgbShift: modNumber(0, 1),
        postProcessHalftone: modNumber(0, 1),
        postProcessVignette: modNumber(0, 2),
        postProcessLensDistortion: modNumber(0, 2),
        postProcessLensDispersion: modNumber(0, 1),
    },
    settingsKey: 'sonnetTuning',
    settingsSetterKey: 'handleSetSonnetTuning',
    settingsResetterKey: 'handleResetSonnetTuning',
    storage: {
        key: 'sonnet_tuning',
        read: (stored: Partial<SonnetTuning>) => resolve(stored, DEFAULT_SONNET_TUNING),
        merge: (held, patch) => resolve(patch, held),
        resetNotice: 'notifications.sonnetReset',
    },
    apply: (props, tuning) => ({ ...props, sonnetTuning: tuning }),
});
