import { DEFAULT_TEMPERA_LAYER_IMAGE, DEFAULT_TEMPERA_TUNING, TEMPERA_MAX_LAYER_IMAGES, type TemperaLayerImage, type TemperaTuning } from '../../../types';
import { normalizeLyricRenderOverride } from '../../../utils/lyricRenderQuality';
import { defineVisualizerTuning, modNumber, MOD_SWITCH, modChoice, numberWithin, type StoredTuningFields } from '../tuningDefinition';

// src/components/visualizer/tempera/tuning.ts
// Tempera's tuning: its defaults, the settings store fields it lives in, where it is stored and
// how a stored value and a change are read, and the renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'temperaTuning', 'handleSetTemperaTuning', 'handleResetTemperaTuning', TemperaTuning> {}
}

const switchOr = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

/**
 * Placement records ride in the tuning, so they arrive from localStorage, sync and pasted
 * appearance codes alike. Every field is clamped rather than trusted; a bad scale would put a
 * user's artwork off screen with no way to find it again.
 */
const sanitizeLayerImages = (value: unknown): TemperaLayerImage[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap<TemperaLayerImage>(entry => {
        if (!entry || typeof entry !== 'object') return [];
        const record = entry as Partial<TemperaLayerImage>;
        if (typeof record.id !== 'string' || !record.id) return [];
        const align = record.align;
        const verticalAlign = record.verticalAlign;
        return [{
            id: record.id,
            name: typeof record.name === 'string' ? record.name : record.id,
            align: align === 'left' || align === 'center' || align === 'right' || align === 'free'
                ? align
                : DEFAULT_TEMPERA_LAYER_IMAGE.align,
            verticalAlign: verticalAlign === 'top'
                || verticalAlign === 'center'
                || verticalAlign === 'bottom'
                || verticalAlign === 'free'
                ? verticalAlign
                : DEFAULT_TEMPERA_LAYER_IMAGE.verticalAlign,
            scale: numberWithin(record.scale, DEFAULT_TEMPERA_LAYER_IMAGE.scale, 0.05, 2),
            opacity: numberWithin(record.opacity, DEFAULT_TEMPERA_LAYER_IMAGE.opacity, 0, 1),
        }];
    }).slice(0, TEMPERA_MAX_LAYER_IMAGES);
};

/** The tuning `values` ask for, with `base` where they say nothing or something that cannot be: every number inside its range. */
const resolve = (values: Partial<TemperaTuning>, base: TemperaTuning): TemperaTuning => ({
    // 分辨率与抗锯齿的覆盖（#929）：旧存档没有这项就是全跟随全局；只改一半的补丁保留另一半，不认识的值回到「跟随全局」。
    render: normalizeLyricRenderOverride({ ...base.render, ...(values.render ?? {}) }),
    cameraIntensity: numberWithin(values.cameraIntensity, base.cameraIntensity, 0, 2),
    glyphMotion: numberWithin(values.glyphMotion, base.glyphMotion, 0, 2),
    wholeLineLyrics: switchOr(values.wholeLineLyrics, base.wholeLineLyrics),
    glyphSettleStretch: numberWithin(values.glyphSettleStretch, base.glyphSettleStretch, 0, 1),
    depthOfField: numberWithin(values.depthOfField, base.depthOfField, 0, 2),
    depthPan: numberWithin(values.depthPan, base.depthPan, 0, 2),
    glyphDepth: numberWithin(values.glyphDepth, base.glyphDepth, 0, 2),
    colorMode: values.colorMode === 'duo' || values.colorMode === 'mono' || values.colorMode === 'gradient' ? values.colorMode : base.colorMode,
    textInversion: switchOr(values.textInversion, base.textInversion),
    layerImages: values.layerImages ? sanitizeLayerImages(values.layerImages) : base.layerImages,
    layerImageDepth: values.layerImageDepth === 'front' || values.layerImageDepth === 'back' ? values.layerImageDepth : base.layerImageDepth,
    layerImageFrequency: numberWithin(values.layerImageFrequency, base.layerImageFrequency, 0, 1),
    showBlocks: switchOr(values.showBlocks, base.showBlocks),
    showDecor: switchOr(values.showDecor, base.showDecor),
    showCornerMarks: switchOr(values.showCornerMarks, base.showCornerMarks),
    enableTransitions: switchOr(values.enableTransitions, base.enableTransitions),
    textureResolution: numberWithin(values.textureResolution, base.textureResolution, 0.5, 4),
    postProcessEnabled: switchOr(values.postProcessEnabled, base.postProcessEnabled),
    postProcessTextureCompression: switchOr(values.postProcessTextureCompression, base.postProcessTextureCompression),
    postProcessGrain: numberWithin(values.postProcessGrain, base.postProcessGrain, 0, 1),
    postProcessContrast: numberWithin(values.postProcessContrast, base.postProcessContrast, 0, 1),
    postProcessRgbShift: numberWithin(values.postProcessRgbShift, base.postProcessRgbShift, 0, 1),
    postProcessVignette: numberWithin(values.postProcessVignette, base.postProcessVignette, 0, 2),
    postProcessLensDistortion: numberWithin(values.postProcessLensDistortion, base.postProcessLensDistortion, 0, 2),
});

/** A stored tuning, or a part of one, as a whole valid tuning. */
export const resolveStoredTemperaTuning = (stored: Partial<TemperaTuning>): TemperaTuning => resolve(stored, DEFAULT_TEMPERA_TUNING);

export default defineVisualizerTuning<TemperaTuning>({
    mode: 'tempera',
    defaults: DEFAULT_TEMPERA_TUNING,
    // What mods may read and write (folium.visualizer.setTuning): the panel's own controls, without what the picture costs.
    modKeys: {
        cameraIntensity: modNumber(0, 2),
        glyphMotion: modNumber(0, 2),
        wholeLineLyrics: MOD_SWITCH,
        glyphSettleStretch: modNumber(0, 1),
        depthOfField: modNumber(0, 2),
        depthPan: modNumber(0, 2),
        glyphDepth: modNumber(0, 2),
        colorMode: modChoice(['duo', 'mono', 'gradient']),
        showBlocks: MOD_SWITCH,
        showDecor: MOD_SWITCH,
        showCornerMarks: MOD_SWITCH,
        textInversion: MOD_SWITCH,
        layerImageDepth: modChoice(['back', 'front']),
        layerImageFrequency: modNumber(0, 1),
        enableTransitions: MOD_SWITCH,
        postProcessEnabled: MOD_SWITCH,
        postProcessGrain: modNumber(0, 1),
        postProcessContrast: modNumber(0, 1),
        postProcessRgbShift: modNumber(0, 1),
        postProcessVignette: modNumber(0, 2),
        postProcessLensDistortion: modNumber(0, 2),
    },
    settingsKey: 'temperaTuning',
    settingsSetterKey: 'handleSetTemperaTuning',
    settingsResetterKey: 'handleResetTemperaTuning',
    storage: {
        key: 'tempera_tuning',
        read: resolveStoredTemperaTuning,
        merge: (held, patch) => resolve(patch, held),
        resetNotice: 'notifications.temperaReset',
    },
    // The renderer's resolution reallocates the Pixi backing surface: the sample stays on the saved
    // one while its slider moves and takes the new one once it is saved.
    // render（分辨率 / 抗锯齿覆盖，#929）不用这样留：那两行是下拉和分段按钮，选了就保存，没有拖动中的草稿；
    // 而且样式窗口的小图是预览，本来就不跟这两个设置，改了只有窗口后面正在播的画面跟着变。
    preview: (draft, saved) => ({ ...draft, textureResolution: saved.textureResolution }),
    apply: (props, tuning) => ({ ...props, temperaTuning: tuning }),
});
