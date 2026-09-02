import { DEFAULT_CADENZA_TUNING, DEFAULT_CAPPELLA_TUNING, DEFAULT_CLADDAGH_TUNING, DEFAULT_CLASSIC_TUNING, DEFAULT_DIORAMA_TUNING, DEFAULT_FUME_TUNING, DEFAULT_LATENT_BACKGROUND_TUNING, DEFAULT_MONET_BACKGROUND_TUNING, DEFAULT_MONET_TUNING, DEFAULT_NOMAND_BACKGROUND_TUNING, DEFAULT_PARTITA_TUNING, DEFAULT_PENDOLO_TUNING, DEFAULT_SONNET_TUNING, DEFAULT_TEMPERA_LAYER_IMAGE, DEFAULT_TEMPERA_TUNING, DEFAULT_TILT_TUNING, DIORAMA_PARTICLE_DENSITY_MAX, DIORAMA_PARTICLE_DENSITY_MIN, DIORAMA_PARTICLE_GLOW_INTENSITY_MAX, DIORAMA_PARTICLE_GLOW_INTENSITY_MIN, DIORAMA_PARTICLE_SIZE_MAX, DIORAMA_PARTICLE_SIZE_MIN, TEMPERA_MAX_LAYER_IMAGES, type CadenzaTuning, type CappellaAvatarSource, type CappellaTuning, type ClassicTuning, type CladdaghTuning, type DioramaTuning, type FumeTuning, type LatentBackgroundColorSource, type LatentBackgroundDisplayMode, type LatentBackgroundTuning, type MonetBackgroundLayout, type MonetBackgroundSource, type MonetBackgroundTuning, type MonetBackgroundWashColorMode, type MonetPortraitSource, type MonetTuning, type NomandBackgroundDitheringType, type NomandBackgroundEffect, type NomandBackgroundSource, type NomandBackgroundTuning, type PartitaTuning, type PendoloTuning, type SonnetTuning, type TemperaLayerImage, type TemperaTuning, type TiltTuning, type UrlBackgroundItem, type VisualizerBackgroundMode, type VisualizerFrameRate, type VisualizerMode } from '../types';
// 只做字符串校验，走 types/visualizerModes 而不是 registry：后者的 eager glob 会把 13 个
// renderer（含 three.js）拉进来，而这里读的只是一个 localStorage 字符串。
// mod 模式在启动时本来就看不到——bootstrap.tsx 的 restoreStoredModVisualizer 在 mods 注册完
// 之后专门补一次，行为不变。
import {
    DEFAULT_VISUALIZER_BACKGROUND_MODE,
    DEFAULT_VISUALIZER_MODE,
    isBuiltinVisualizerBackgroundMode,
    isBuiltinVisualizerMode,
} from '../types/visualizerModes';
import { resolveDioramaMoteCircumference, resolveDioramaMoteRadial } from '../components/visualizer/diorama/dioramaMoteField';
import { parseVisualizerFrameRate, VISUALIZER_FRAME_RATE_STORAGE_KEY } from '../utils/frameRateLimiter';
import { sanitizeUrlBackgroundList } from '../utils/urlBackground';

export const VISUALIZER_OPACITY_STORAGE_KEY = 'visualizer_opacity';

// src/stores/visualizerSettingsPersistence.ts
// localStorage read/clamp/resolve helpers for every visualizer and background setting.
//
// Moved verbatim out of useSettingsUiStore so the visualizer domain can own its own store
// without either file importing the other. Storage keys and clamping behaviour are unchanged —
// this module is the persistence half of that domain, nothing more.

export const readStoredBackgroundOpacity = () => {
    if (typeof window === 'undefined') {
        return 0.75;
    }

    const saved = localStorage.getItem('background_opacity');
    const parsed = saved ? parseFloat(saved) : 0.75;
    return Number.isFinite(parsed) ? parsed : 0.75;
};

export const readStoredVisualizerOpacity = () => {
    if (typeof window === 'undefined') {
        return 1;
    }

    const saved = localStorage.getItem(VISUALIZER_OPACITY_STORAGE_KEY);
    const parsed = saved ? parseFloat(saved) : 1;
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0.2, parsed)) : 1;
};

export const readStoredVisualizerMode = (): VisualizerMode => {
    if (typeof window === 'undefined') {
        return DEFAULT_VISUALIZER_MODE;
    }

    const saved = localStorage.getItem('visualizer_mode');
    if (saved === 'cadenza' || saved === 'cadenze') {
        return 'cadenza';
    }

    return isBuiltinVisualizerMode(saved) ? saved : DEFAULT_VISUALIZER_MODE;
};

export const readStoredVisualizerFrameRate = (): VisualizerFrameRate => {
    if (typeof window === 'undefined') {
        return 'off';
    }

    return parseVisualizerFrameRate(localStorage.getItem(VISUALIZER_FRAME_RATE_STORAGE_KEY));
};

export const clampClassicBreathingFloatMultiplier = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(2, Math.max(0, value));
};

export const clampClassicWordSpacing = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(2, Math.max(0, value));
};

export const readStoredClassicTuning = (): ClassicTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_CLASSIC_TUNING;
    }

    const saved = localStorage.getItem('classic_tuning');
    if (!saved) return DEFAULT_CLASSIC_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<ClassicTuning>;
        return {
            enableWordRotation: parsed.enableWordRotation ?? DEFAULT_CLASSIC_TUNING.enableWordRotation,
            breathingFloatMultiplier: clampClassicBreathingFloatMultiplier(
                parsed.breathingFloatMultiplier ?? DEFAULT_CLASSIC_TUNING.breathingFloatMultiplier,
                DEFAULT_CLASSIC_TUNING.breathingFloatMultiplier,
            ),
            useLegacyLayout: parsed.useLegacyLayout ?? DEFAULT_CLASSIC_TUNING.useLegacyLayout,
            wordSpacing: clampClassicWordSpacing(
                parsed.wordSpacing ?? DEFAULT_CLASSIC_TUNING.wordSpacing ?? 0.7,
                DEFAULT_CLASSIC_TUNING.wordSpacing ?? 0.7,
            ),
        };
    } catch {
        return DEFAULT_CLASSIC_TUNING;
    }
};

export const readStoredCadenzaTuning = (): CadenzaTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_CADENZA_TUNING;
    }

    const saved = localStorage.getItem('cadenza_tuning') ?? localStorage.getItem('cadenze_tuning');
    if (!saved) return DEFAULT_CADENZA_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<CadenzaTuning>;
        return {
            ...DEFAULT_CADENZA_TUNING,
            ...parsed,
            beamIntensity: 0,
        };
    } catch {
        return DEFAULT_CADENZA_TUNING;
    }
};

export const clampPartitaStagger = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(180, Math.max(0, value));
};

export const readStoredPartitaTuning = (): PartitaTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_PARTITA_TUNING;
    }

    const saved = localStorage.getItem('partita_tuning');
    if (!saved) return DEFAULT_PARTITA_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<PartitaTuning>;
        const rawMin = clampPartitaStagger(parsed.staggerMin ?? DEFAULT_PARTITA_TUNING.staggerMin, DEFAULT_PARTITA_TUNING.staggerMin);
        const rawMax = clampPartitaStagger(parsed.staggerMax ?? DEFAULT_PARTITA_TUNING.staggerMax, DEFAULT_PARTITA_TUNING.staggerMax);

        return {
            showGuideLines: parsed.showGuideLines ?? DEFAULT_PARTITA_TUNING.showGuideLines,
            useSemanticLayout: parsed.useSemanticLayout ?? DEFAULT_PARTITA_TUNING.useSemanticLayout,
            staggerMin: Math.min(rawMin, rawMax),
            staggerMax: Math.max(rawMin, rawMax),
        };
    } catch {
        return DEFAULT_PARTITA_TUNING;
    }
};

export const clampFumeCameraSpeed = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.85, Math.max(0.55, value));
};

export const clampFumeGlowIntensity = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.8, Math.max(0, value));
};

export const clampFumeBackgroundObjectOpacity = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1, Math.max(0, value));
};

export const clampFumeHeroScale = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.32, Math.max(0.82, value));
};

export const clampFumeTextHoldRatio = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1, Math.max(0, value));
};

export const resolveFumeCameraTrackingMode = (value: FumeTuning['cameraTrackingMode'] | undefined) => (
    value === 'stepped' || value === 'smooth'
        ? value
        : DEFAULT_FUME_TUNING.cameraTrackingMode
);

export const readStoredFumeTuning = (): FumeTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_FUME_TUNING;
    }

    const saved = localStorage.getItem('fume_tuning');
    if (!saved) return DEFAULT_FUME_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<FumeTuning> & { textHoldStyle?: 'standard' | 'dimmed'; };
        const migratedTextHoldRatio = parsed.textHoldStyle === 'dimmed'
            ? 0.5
            : DEFAULT_FUME_TUNING.textHoldRatio;
        return {
            hidePrintSymbols: parsed.hidePrintSymbols ?? DEFAULT_FUME_TUNING.hidePrintSymbols,
            disableGeometricBackground: parsed.disableGeometricBackground ?? DEFAULT_FUME_TUNING.disableGeometricBackground,
            backgroundObjectOpacity: clampFumeBackgroundObjectOpacity(
                parsed.backgroundObjectOpacity ?? DEFAULT_FUME_TUNING.backgroundObjectOpacity,
                DEFAULT_FUME_TUNING.backgroundObjectOpacity,
            ),
            textHoldRatio: clampFumeTextHoldRatio(parsed.textHoldRatio ?? migratedTextHoldRatio, DEFAULT_FUME_TUNING.textHoldRatio),
            cameraTrackingMode: resolveFumeCameraTrackingMode(parsed.cameraTrackingMode),
            cameraSpeed: clampFumeCameraSpeed(parsed.cameraSpeed ?? DEFAULT_FUME_TUNING.cameraSpeed, DEFAULT_FUME_TUNING.cameraSpeed),
            glowIntensity: clampFumeGlowIntensity(parsed.glowIntensity ?? DEFAULT_FUME_TUNING.glowIntensity, DEFAULT_FUME_TUNING.glowIntensity),
            heroScale: clampFumeHeroScale(parsed.heroScale ?? DEFAULT_FUME_TUNING.heroScale, DEFAULT_FUME_TUNING.heroScale),
        };
    } catch {
        return DEFAULT_FUME_TUNING;
    }
};

export const clampCladdaghFocusScaleRatio = (val: any, fallback: number = DEFAULT_CLADDAGH_TUNING.focusScaleRatio): number => {
    const parsed = typeof val === 'number' ? val : parseFloat(val);
    return Number.isFinite(parsed) ? Math.min(1.5, Math.max(0.0, parsed)) : fallback;
};

export const clampCladdaghRadiusScale = (val: any, fallback: number = DEFAULT_CLADDAGH_TUNING.radiusScale): number => {
    const parsed = typeof val === 'number' ? val : parseFloat(val);
    return Number.isFinite(parsed) ? Math.min(1.5, Math.max(0.5, parsed)) : fallback;
};

export const clampCladdaghEllipseTiltDeg = (val: any, fallback: number = DEFAULT_CLADDAGH_TUNING.ellipseTiltDeg): number => {
    const parsed = typeof val === 'number' ? val : parseFloat(val);
    return Number.isFinite(parsed) ? Math.min(60, Math.max(0, parsed)) : fallback;
};

export const clampCladdaghLetterSpacingOffset = (val: any, fallback: number = DEFAULT_CLADDAGH_TUNING.letterSpacingOffset): number => {
    const parsed = typeof val === 'number' ? val : parseFloat(val);
    return Number.isFinite(parsed) ? Math.min(20, Math.max(-5, parsed)) : fallback;
};

export const readStoredCladdaghTuning = (): CladdaghTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_CLADDAGH_TUNING;
    }

    const saved = localStorage.getItem('claddagh_tuning');
    if (!saved) return DEFAULT_CLADDAGH_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<CladdaghTuning>;
        return {
            focusScaleRatio: clampCladdaghFocusScaleRatio(parsed.focusScaleRatio, DEFAULT_CLADDAGH_TUNING.focusScaleRatio),
            radiusScale: clampCladdaghRadiusScale(parsed.radiusScale, DEFAULT_CLADDAGH_TUNING.radiusScale),
            ellipseTiltDeg: clampCladdaghEllipseTiltDeg(parsed.ellipseTiltDeg, DEFAULT_CLADDAGH_TUNING.ellipseTiltDeg),
            showAxisLine: typeof parsed.showAxisLine === 'boolean' ? parsed.showAxisLine : DEFAULT_CLADDAGH_TUNING.showAxisLine,
            letterSpacingOffset: clampCladdaghLetterSpacingOffset(parsed.letterSpacingOffset, DEFAULT_CLADDAGH_TUNING.letterSpacingOffset),
        };
    } catch {
        return DEFAULT_CLADDAGH_TUNING;
    }
};

export const resolvePendoloNumber = (value: unknown, fallback: number, min: number, max: number) => (
    typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : fallback
);

export const readStoredPendoloTuning = (): PendoloTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_PENDOLO_TUNING;
    }

    const saved = localStorage.getItem('pendolo_tuning');
    if (!saved) return DEFAULT_PENDOLO_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<PendoloTuning>;
        return {
            arcRadius: resolvePendoloNumber(parsed.arcRadius, DEFAULT_PENDOLO_TUNING.arcRadius, 0.25, 0.80),
            arcAngleDeg: resolvePendoloNumber(parsed.arcAngleDeg, DEFAULT_PENDOLO_TUNING.arcAngleDeg, 40, 160),
            wheelCenterX: resolvePendoloNumber(parsed.wheelCenterX, DEFAULT_PENDOLO_TUNING.wheelCenterX, -0.30, 0.50),
            wheelCenterY: resolvePendoloNumber(parsed.wheelCenterY, DEFAULT_PENDOLO_TUNING.wheelCenterY, 0.20, 0.80),
            tickSnappiness: resolvePendoloNumber(parsed.tickSnappiness, DEFAULT_PENDOLO_TUNING.tickSnappiness, 0.5, 2.0),
            activeScale: resolvePendoloNumber(parsed.activeScale, DEFAULT_PENDOLO_TUNING.activeScale, 1.00, 1.60),
            showGearDecor: parsed.showGearDecor === 'none' || parsed.showGearDecor === 'full' ? parsed.showGearDecor : 'subtle',
            showCenterGradient: typeof parsed.showCenterGradient === 'boolean'
                ? parsed.showCenterGradient
                : DEFAULT_PENDOLO_TUNING.showCenterGradient,
            showCoverOnWatchFace: typeof parsed.showCoverOnWatchFace === 'boolean'
                ? parsed.showCoverOnWatchFace
                : DEFAULT_PENDOLO_TUNING.showCoverOnWatchFace,
            enableLineGlow: typeof parsed.enableLineGlow === 'boolean'
                ? parsed.enableLineGlow
                : DEFAULT_PENDOLO_TUNING.enableLineGlow,
        };
    } catch {
        return DEFAULT_PENDOLO_TUNING;
    }
};

export const readStoredSonnetTuning = (): SonnetTuning => {
    if (typeof window === 'undefined') return DEFAULT_SONNET_TUNING;
    const saved = localStorage.getItem('sonnet_tuning');
    if (!saved) return DEFAULT_SONNET_TUNING;
    try {
        const parsed = JSON.parse(saved) as Partial<SonnetTuning>;
        return {
            cameraIntensity: resolvePendoloNumber(parsed.cameraIntensity, DEFAULT_SONNET_TUNING.cameraIntensity, 0, 2),
            typographyMotion: resolvePendoloNumber(parsed.typographyMotion, DEFAULT_SONNET_TUNING.typographyMotion, 0, 2),
            mgDensity: resolvePendoloNumber(parsed.mgDensity, DEFAULT_SONNET_TUNING.mgDensity, 0, 2),
            showOnlyText: typeof parsed.showOnlyText === 'boolean'
                ? parsed.showOnlyText
                : DEFAULT_SONNET_TUNING.showOnlyText,
            showGuide: typeof parsed.showGuide === 'boolean'
                ? parsed.showGuide
                : DEFAULT_SONNET_TUNING.showGuide,
            showBackgroundMg: typeof parsed.showBackgroundMg === 'boolean'
                ? parsed.showBackgroundMg
                : DEFAULT_SONNET_TUNING.showBackgroundMg,
            showFixedGeo: typeof parsed.showFixedGeo === 'boolean'
                ? parsed.showFixedGeo
                : DEFAULT_SONNET_TUNING.showFixedGeo,
            showGiantDecorativeText: typeof parsed.showGiantDecorativeText === 'boolean'
                ? parsed.showGiantDecorativeText
                : DEFAULT_SONNET_TUNING.showGiantDecorativeText,
            showBackgroundDecor: typeof parsed.showBackgroundDecor === 'boolean'
                ? parsed.showBackgroundDecor
                : DEFAULT_SONNET_TUNING.showBackgroundDecor,
            enableTransitions: typeof parsed.enableTransitions === 'boolean'
                ? parsed.enableTransitions
                : DEFAULT_SONNET_TUNING.enableTransitions,
            outerFrameMode: parsed.outerFrameMode === 'none'
                || parsed.outerFrameMode === 'frame'
                || parsed.outerFrameMode === 'full'
                ? parsed.outerFrameMode
                : DEFAULT_SONNET_TUNING.outerFrameMode,
            textureResolution: resolvePendoloNumber(parsed.textureResolution, DEFAULT_SONNET_TUNING.textureResolution, 0.5, 4),
            postProcessEnabled: typeof parsed.postProcessEnabled === 'boolean'
                ? parsed.postProcessEnabled
                : DEFAULT_SONNET_TUNING.postProcessEnabled,
            postProcessGrain: resolvePendoloNumber(parsed.postProcessGrain, DEFAULT_SONNET_TUNING.postProcessGrain, 0, 1),
            postProcessContrast: resolvePendoloNumber(parsed.postProcessContrast, DEFAULT_SONNET_TUNING.postProcessContrast, 0, 1),
            postProcessRgbShift: resolvePendoloNumber(parsed.postProcessRgbShift, DEFAULT_SONNET_TUNING.postProcessRgbShift, 0, 1),
            postProcessHalftone: resolvePendoloNumber(parsed.postProcessHalftone, DEFAULT_SONNET_TUNING.postProcessHalftone, 0, 1),
            postProcessVignette: resolvePendoloNumber(parsed.postProcessVignette, DEFAULT_SONNET_TUNING.postProcessVignette, 0, 2),
            postProcessLensDistortion: resolvePendoloNumber(parsed.postProcessLensDistortion, DEFAULT_SONNET_TUNING.postProcessLensDistortion, 0, 2),
            postProcessLensDispersion: resolvePendoloNumber(parsed.postProcessLensDispersion, DEFAULT_SONNET_TUNING.postProcessLensDispersion, 0, 1),
        };
    } catch {
        return DEFAULT_SONNET_TUNING;
    }
};

export const clampUnit = (value: unknown, fallback: number) => (
    typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
);

/**
 * Placement records ride in the tuning, so they arrive from localStorage, sync and pasted
 * appearance codes alike. Every field is clamped rather than trusted; a bad scale would put a
 * user's artwork off screen with no way to find it again.
 */
export const sanitizeTemperaLayerImages = (value: unknown): TemperaLayerImage[] => {
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
            scale: typeof record.scale === 'number' && Number.isFinite(record.scale)
                ? Math.min(2, Math.max(0.05, record.scale))
                : DEFAULT_TEMPERA_LAYER_IMAGE.scale,
            opacity: clampUnit(record.opacity, DEFAULT_TEMPERA_LAYER_IMAGE.opacity),
        }];
    }).slice(0, TEMPERA_MAX_LAYER_IMAGES);
};

export const resolveStoredTemperaTuning = (parsed: Partial<TemperaTuning>): TemperaTuning => ({
    cameraIntensity: resolvePendoloNumber(parsed.cameraIntensity, DEFAULT_TEMPERA_TUNING.cameraIntensity, 0, 2),
    glyphMotion: resolvePendoloNumber(parsed.glyphMotion, DEFAULT_TEMPERA_TUNING.glyphMotion, 0, 2),
    wholeLineLyrics: typeof parsed.wholeLineLyrics === 'boolean'
        ? parsed.wholeLineLyrics
        : DEFAULT_TEMPERA_TUNING.wholeLineLyrics,
    glyphSettleStretch: resolvePendoloNumber(parsed.glyphSettleStretch, DEFAULT_TEMPERA_TUNING.glyphSettleStretch, 0, 1),
    colorMode: parsed.colorMode === 'mono' || parsed.colorMode === 'gradient' ? parsed.colorMode : DEFAULT_TEMPERA_TUNING.colorMode,
    textInversion: typeof parsed.textInversion === 'boolean' ? parsed.textInversion : DEFAULT_TEMPERA_TUNING.textInversion,
    layerImages: sanitizeTemperaLayerImages(parsed.layerImages),
    layerImageDepth: parsed.layerImageDepth === 'front' ? 'front' : 'back',
    layerImageFrequency: clampUnit(parsed.layerImageFrequency, DEFAULT_TEMPERA_TUNING.layerImageFrequency),
    showBlocks: typeof parsed.showBlocks === 'boolean'
        ? parsed.showBlocks
        : DEFAULT_TEMPERA_TUNING.showBlocks,
    showDecor: typeof parsed.showDecor === 'boolean'
        ? parsed.showDecor
        : DEFAULT_TEMPERA_TUNING.showDecor,
    enableTransitions: typeof parsed.enableTransitions === 'boolean'
        ? parsed.enableTransitions
        : DEFAULT_TEMPERA_TUNING.enableTransitions,
    textureResolution: resolvePendoloNumber(parsed.textureResolution, DEFAULT_TEMPERA_TUNING.textureResolution, 0.5, 4),
    postProcessEnabled: typeof parsed.postProcessEnabled === 'boolean'
        ? parsed.postProcessEnabled
        : DEFAULT_TEMPERA_TUNING.postProcessEnabled,
    postProcessTextureCompression: typeof parsed.postProcessTextureCompression === 'boolean'
        ? parsed.postProcessTextureCompression
        : DEFAULT_TEMPERA_TUNING.postProcessTextureCompression,
    postProcessGrain: resolvePendoloNumber(parsed.postProcessGrain, DEFAULT_TEMPERA_TUNING.postProcessGrain, 0, 1),
    postProcessContrast: resolvePendoloNumber(parsed.postProcessContrast, DEFAULT_TEMPERA_TUNING.postProcessContrast, 0, 1),
    postProcessRgbShift: resolvePendoloNumber(parsed.postProcessRgbShift, DEFAULT_TEMPERA_TUNING.postProcessRgbShift, 0, 1),
    postProcessVignette: resolvePendoloNumber(parsed.postProcessVignette, DEFAULT_TEMPERA_TUNING.postProcessVignette, 0, 2),
    postProcessLensDistortion: resolvePendoloNumber(parsed.postProcessLensDistortion, DEFAULT_TEMPERA_TUNING.postProcessLensDistortion, 0, 2),
});

export const readStoredTemperaTuning = (): TemperaTuning => {
    if (typeof window === 'undefined') return DEFAULT_TEMPERA_TUNING;
    const saved = localStorage.getItem('tempera_tuning');
    if (!saved) return DEFAULT_TEMPERA_TUNING;
    try {
        return resolveStoredTemperaTuning(JSON.parse(saved) as Partial<TemperaTuning>);
    } catch {
        return DEFAULT_TEMPERA_TUNING;
    }
};

export const resolveCappellaAvatarSource = (source: CappellaAvatarSource | undefined): CappellaAvatarSource => (
    source === 'builtin' || source === 'color' || source === 'cover' || source === 'custom'
        ? source
        : DEFAULT_CAPPELLA_TUNING.avatarSource
);

export const resolveStoredCappellaTuning = (parsed: Partial<CappellaTuning>): CappellaTuning => ({
    showEmoMessages: parsed.showEmoMessages ?? DEFAULT_CAPPELLA_TUNING.showEmoMessages,
    emojiPackSource: parsed.emojiPackSource === 'custom' ? 'custom' : 'builtin',
    avatarSource: resolveCappellaAvatarSource(parsed.avatarSource),
});

export const readStoredCappellaTuning = (): CappellaTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_CAPPELLA_TUNING;
    }

    const saved = localStorage.getItem('cappella_tuning');
    if (!saved) return DEFAULT_CAPPELLA_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<CappellaTuning>;
        return resolveStoredCappellaTuning(parsed);
    } catch {
        return DEFAULT_CAPPELLA_TUNING;
    }
};

export const readStoredTiltTuning = (): TiltTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_TILT_TUNING;
    }

    const saved = localStorage.getItem('tilt_tuning');
    if (!saved) return DEFAULT_TILT_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<TiltTuning>;
        return {
            splitProbability: Math.min(1, Math.max(0, parsed.splitProbability ?? DEFAULT_TILT_TUNING.splitProbability)),
            tiltStyleProbability: Math.min(1, Math.max(0, parsed.tiltStyleProbability ?? DEFAULT_TILT_TUNING.tiltStyleProbability)),
            colorScheme: parsed.colorScheme ?? DEFAULT_TILT_TUNING.colorScheme,
        };
    } catch {
        return DEFAULT_TILT_TUNING;
    }
};

export const resolveStoredDioramaTuning = (parsed: Partial<DioramaTuning>): DioramaTuning => ({
    cameraSpeed: Math.min(1.85, Math.max(0.55, parsed.cameraSpeed ?? DEFAULT_DIORAMA_TUNING.cameraSpeed)),
    motionAmount: Math.min(1.6, Math.max(0.4, parsed.motionAmount ?? DEFAULT_DIORAMA_TUNING.motionAmount)),
    audioReactivity: Math.min(1.5, Math.max(0, parsed.audioReactivity ?? DEFAULT_DIORAMA_TUNING.audioReactivity)),
    geometryVisibility: {
        enabled: parsed.geometryVisibility?.enabled ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.enabled,
        mode: parsed.geometryVisibility?.mode ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.mode,
        strands: parsed.geometryVisibility?.strands ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.strands,
        blobs: parsed.geometryVisibility?.blobs ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.blobs,
        ribbons: parsed.geometryVisibility?.ribbons ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.ribbons,
        rings: parsed.geometryVisibility?.rings ?? DEFAULT_DIORAMA_TUNING.geometryVisibility.rings,
    },
    particleDensity: Math.round(Math.min(
        DIORAMA_PARTICLE_DENSITY_MAX,
        Math.max(DIORAMA_PARTICLE_DENSITY_MIN, parsed.particleDensity ?? DEFAULT_DIORAMA_TUNING.particleDensity),
    )),
    particleScale: Math.min(
        DIORAMA_PARTICLE_SIZE_MAX,
        Math.max(DIORAMA_PARTICLE_SIZE_MIN, parsed.particleScale ?? DEFAULT_DIORAMA_TUNING.particleScale),
    ),
    particleGlowEnabled: parsed.particleGlowEnabled ?? DEFAULT_DIORAMA_TUNING.particleGlowEnabled,
    particleGlowIntensity: Math.min(
        DIORAMA_PARTICLE_GLOW_INTENSITY_MAX,
        Math.max(
            DIORAMA_PARTICLE_GLOW_INTENSITY_MIN,
            parsed.particleGlowIntensity ?? DEFAULT_DIORAMA_TUNING.particleGlowIntensity,
        ),
    ),
    showParticles: parsed.showParticles ?? DEFAULT_DIORAMA_TUNING.showParticles,
    backgroundParticleCircumference: resolveDioramaMoteCircumference(
        parsed.backgroundParticleCircumference ?? DEFAULT_DIORAMA_TUNING.backgroundParticleCircumference,
    ),
    backgroundParticleRadial: resolveDioramaMoteRadial(
        parsed.backgroundParticleRadial ?? DEFAULT_DIORAMA_TUNING.backgroundParticleRadial,
    ),
    glowEnabled: parsed.glowEnabled ?? DEFAULT_DIORAMA_TUNING.glowEnabled,
    glowIntensity: Math.min(1.5, Math.max(0.1, parsed.glowIntensity ?? DEFAULT_DIORAMA_TUNING.glowIntensity)),
    soulEnabled: parsed.soulEnabled ?? DEFAULT_DIORAMA_TUNING.soulEnabled,
    soulIntensity: Math.min(1.5, Math.max(0.1, parsed.soulIntensity ?? DEFAULT_DIORAMA_TUNING.soulIntensity)),
    soulActiveEnabled: parsed.soulActiveEnabled ?? DEFAULT_DIORAMA_TUNING.soulActiveEnabled,
    gradientEnabled: parsed.gradientEnabled ?? DEFAULT_DIORAMA_TUNING.gradientEnabled,
    gradientIntensity: Math.min(1.5, Math.max(0.1, parsed.gradientIntensity ?? DEFAULT_DIORAMA_TUNING.gradientIntensity)),
    keywordColoringEnabled: parsed.keywordColoringEnabled ?? DEFAULT_DIORAMA_TUNING.keywordColoringEnabled,
});

export const readStoredDioramaTuning = (): DioramaTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_DIORAMA_TUNING;
    }

    const saved = localStorage.getItem('diorama_tuning');
    if (!saved) return DEFAULT_DIORAMA_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<DioramaTuning>;
        return resolveStoredDioramaTuning(parsed);
    } catch {
        return DEFAULT_DIORAMA_TUNING;
    }
};

export const resolveMonetBackgroundSource = (value: MonetBackgroundSource | undefined): MonetBackgroundSource => (
    value === 'uploaded-global' ? 'uploaded-global' : DEFAULT_MONET_BACKGROUND_TUNING.backgroundSource
);

export const resolveMonetBackgroundLayout = (value: MonetBackgroundLayout | undefined): MonetBackgroundLayout => (
    value === 'full-overlay' || value === 'half-pane-gradient'
        ? value
        : DEFAULT_MONET_BACKGROUND_TUNING.backgroundLayout
);

export const resolveMonetBackgroundWashColorMode = (
    value: MonetBackgroundWashColorMode | undefined,
): MonetBackgroundWashColorMode => (
    value === 'custom' ? 'custom' : DEFAULT_MONET_BACKGROUND_TUNING.backgroundWashColorMode
);

export const clampMonetBackgroundBlur = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(60, Math.max(0, value));
};

export const clampUnitInterval = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1, Math.max(0, value));
};

export const clampMonetBackgroundSaturation = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(2, Math.max(0, value));
};

export const clampMonetBackgroundOffsetX = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(40, Math.max(-40, value));
};

export const clampMonetFontScale = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.5, Math.max(0.7, value));
};

export const normalizeHexColor = (value: unknown, fallback: string) => {
    if (typeof value !== 'string') {
        return fallback;
    }

    const trimmed = value.trim();
    const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
    if (!/^[0-9a-fA-F]{6}$/.test(withoutHash)) {
        return fallback;
    }

    return `#${withoutHash.toLowerCase()}`;
};

export const resolveMonetPortraitSource = (value: MonetPortraitSource | undefined): MonetPortraitSource => (
    value === 'custom' ? 'custom' : DEFAULT_MONET_TUNING.portraitSource
);

export const readStoredVisualizerBackgroundMode = (): VisualizerBackgroundMode | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    const saved = localStorage.getItem('visualizer_background_mode');
    return isBuiltinVisualizerBackgroundMode(saved) ? saved : null;
};

export const readStoredUrlBackgroundList = (): UrlBackgroundItem[] => {
    if (typeof window === 'undefined') return [];
    try {
        const saved = localStorage.getItem('url_background_list');
        if (!saved) return [];
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return [];
        return sanitizeUrlBackgroundList(parsed);
    } catch {
        return [];
    }
};

export const readStoredUrlBackgroundSelectedId = (): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('url_background_selected_id') || null;
};

export const resolveVisualizerBackgroundMode = (
    storedMode: VisualizerBackgroundMode | null | undefined,
    _visualizerMode: VisualizerMode,
): VisualizerBackgroundMode => storedMode ?? DEFAULT_VISUALIZER_BACKGROUND_MODE;

export type StoredMonetBackgroundTuningInput = Partial<MonetBackgroundTuning> & {
    backgroundCropMode?: unknown;
    coverPaneRatio?: unknown;
    lyricsFocusScale?: unknown;
};

export const resolveStoredMonetBackgroundTuning = (parsed: StoredMonetBackgroundTuningInput): MonetBackgroundTuning => ({
    backgroundSource: resolveMonetBackgroundSource(parsed.backgroundSource),
    backgroundLayout: resolveMonetBackgroundLayout(parsed.backgroundLayout),
    backgroundBlurPx: clampMonetBackgroundBlur(
        parsed.backgroundBlurPx ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundBlurPx,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundBlurPx,
    ),
    backgroundOverlayOpacity: clampUnitInterval(
        parsed.backgroundOverlayOpacity ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundOverlayOpacity,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundOverlayOpacity,
    ),
    backgroundGrayscale: clampUnitInterval(
        parsed.backgroundGrayscale ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundGrayscale,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundGrayscale,
    ),
    backgroundSaturation: clampMonetBackgroundSaturation(
        parsed.backgroundSaturation ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundSaturation,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundSaturation,
    ),
    backgroundWash: clampUnitInterval(
        parsed.backgroundWash ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundWash,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundWash,
    ),
    backgroundHalfPaneOffsetX: clampMonetBackgroundOffsetX(
        parsed.backgroundHalfPaneOffsetX ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundHalfPaneOffsetX,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundHalfPaneOffsetX,
    ),
    backgroundWashColorMode: resolveMonetBackgroundWashColorMode(parsed.backgroundWashColorMode),
    backgroundWashCustomColor: normalizeHexColor(
        parsed.backgroundWashCustomColor,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundWashCustomColor,
    ),
    backgroundDriftEnabled: parsed.backgroundDriftEnabled ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftEnabled,
    backgroundDriftStrength: clampUnitInterval(
        parsed.backgroundDriftStrength ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftStrength,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftStrength,
    ),
    backgroundStreaksEnabled: parsed.backgroundStreaksEnabled ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundStreaksEnabled,
});

export const resolveNomandBackgroundSource = (value: NomandBackgroundSource | undefined): NomandBackgroundSource => (
    value === 'uploaded-global' ? 'uploaded-global' : DEFAULT_NOMAND_BACKGROUND_TUNING.imageSource
);

export const resolveNomandDitheringType = (
    value: unknown,
): NomandBackgroundDitheringType => (
    value === '2x2' || value === '4x4' || value === '8x8'
        ? value
        : DEFAULT_NOMAND_BACKGROUND_TUNING.ditheringType
);

export const resolveNomandBackgroundEffect = (value: unknown): NomandBackgroundEffect => (
    value === 'fluted-glass'
        || value === 'paper-texture'
        || value === 'halftone-dots'
        || value === 'lens-distortion'
        || value === 'dithering'
        ? value
        : DEFAULT_NOMAND_BACKGROUND_TUNING.effect
);

export const clampNomandEffectValue = (value: unknown, fallback: number, min = 0, max = 1) => (
    Math.min(max, Math.max(min, typeof value === 'number' && Number.isFinite(value) ? value : fallback))
);

export type StoredNomandBackgroundTuningInput = Omit<Partial<NomandBackgroundTuning>, 'ditheringType' | 'effect'> & {
    ditheringType?: unknown;
    effect?: unknown;
};

export const resolveStoredNomandBackgroundTuning = (
    parsed: StoredNomandBackgroundTuningInput,
): NomandBackgroundTuning => ({
    imageSource: resolveNomandBackgroundSource(parsed.imageSource),
    effect: resolveNomandBackgroundEffect(parsed.effect),
    ditheringType: resolveNomandDitheringType(parsed.ditheringType),
    size: Math.min(20, Math.max(0.5, Number.isFinite(parsed.size) ? parsed.size! : DEFAULT_NOMAND_BACKGROUND_TUNING.size)),
    colorSteps: Math.min(7, Math.max(1, Math.round(Number.isFinite(parsed.colorSteps) ? parsed.colorSteps! : DEFAULT_NOMAND_BACKGROUND_TUNING.colorSteps))),
    originalColors: parsed.originalColors ?? DEFAULT_NOMAND_BACKGROUND_TUNING.originalColors,
    inverted: parsed.inverted ?? DEFAULT_NOMAND_BACKGROUND_TUNING.inverted,
    flutedGlassSize: clampNomandEffectValue(
        parsed.flutedGlassSize,
        DEFAULT_NOMAND_BACKGROUND_TUNING.flutedGlassSize,
        0.1,
    ),
    flutedGlassDistortion: clampNomandEffectValue(
        parsed.flutedGlassDistortion,
        DEFAULT_NOMAND_BACKGROUND_TUNING.flutedGlassDistortion,
    ),
    flutedGlassBlur: clampNomandEffectValue(
        parsed.flutedGlassBlur,
        DEFAULT_NOMAND_BACKGROUND_TUNING.flutedGlassBlur,
    ),
    paperTextureContrast: clampNomandEffectValue(
        parsed.paperTextureContrast,
        DEFAULT_NOMAND_BACKGROUND_TUNING.paperTextureContrast,
    ),
    paperTextureRoughness: clampNomandEffectValue(
        parsed.paperTextureRoughness,
        DEFAULT_NOMAND_BACKGROUND_TUNING.paperTextureRoughness,
    ),
    paperTextureFiber: clampNomandEffectValue(
        parsed.paperTextureFiber,
        DEFAULT_NOMAND_BACKGROUND_TUNING.paperTextureFiber,
    ),
    halftoneDotsSize: clampNomandEffectValue(
        parsed.halftoneDotsSize,
        DEFAULT_NOMAND_BACKGROUND_TUNING.halftoneDotsSize,
        0.1,
    ),
    halftoneDotsRadius: clampNomandEffectValue(
        parsed.halftoneDotsRadius,
        DEFAULT_NOMAND_BACKGROUND_TUNING.halftoneDotsRadius,
        0.1,
        2,
    ),
    halftoneDotsContrast: clampNomandEffectValue(
        parsed.halftoneDotsContrast,
        DEFAULT_NOMAND_BACKGROUND_TUNING.halftoneDotsContrast,
    ),
    halftoneDotsOriginalColors: parsed.halftoneDotsOriginalColors ?? DEFAULT_NOMAND_BACKGROUND_TUNING.halftoneDotsOriginalColors,
    halftoneDotsInverted: parsed.halftoneDotsInverted ?? DEFAULT_NOMAND_BACKGROUND_TUNING.halftoneDotsInverted,
    lensDistortionSpread: clampNomandEffectValue(
        parsed.lensDistortionSpread,
        DEFAULT_NOMAND_BACKGROUND_TUNING.lensDistortionSpread,
    ),
    lensDistortionBulge: clampNomandEffectValue(
        parsed.lensDistortionBulge,
        DEFAULT_NOMAND_BACKGROUND_TUNING.lensDistortionBulge,
        -1,
        1,
    ),
    lensDistortionDispersion: clampNomandEffectValue(
        parsed.lensDistortionDispersion,
        DEFAULT_NOMAND_BACKGROUND_TUNING.lensDistortionDispersion,
    ),
    overlayEnabled: typeof parsed.overlayEnabled === 'boolean'
        ? parsed.overlayEnabled
        : DEFAULT_NOMAND_BACKGROUND_TUNING.overlayEnabled,
    overlayOpacity: Math.min(1, Math.max(0,
        Number.isFinite(parsed.overlayOpacity)
            ? parsed.overlayOpacity!
            : DEFAULT_NOMAND_BACKGROUND_TUNING.overlayOpacity
    )),
});

export const readStoredNomandBackgroundTuning = (): NomandBackgroundTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_NOMAND_BACKGROUND_TUNING;
    }

    const saved = localStorage.getItem('nomand_background_tuning');
    if (!saved) return DEFAULT_NOMAND_BACKGROUND_TUNING;

    try {
        return resolveStoredNomandBackgroundTuning(JSON.parse(saved) as Partial<NomandBackgroundTuning>);
    } catch {
        return DEFAULT_NOMAND_BACKGROUND_TUNING;
    }
};

export const resolveLatentDisplayMode = (value: unknown): LatentBackgroundDisplayMode => (
    value === 'dithering' || value === 'mesh' || value === 'both'
        ? value
        : DEFAULT_LATENT_BACKGROUND_TUNING.displayMode
);

export const resolveLatentColorSource = (value: unknown): LatentBackgroundColorSource => (
    value === 'cover-only' ? 'cover-only' : DEFAULT_LATENT_BACKGROUND_TUNING.colorSource
);

export const clampLatentNumber = (value: unknown, fallback: number, min: number, max: number) => (
    Math.min(max, Math.max(min, typeof value === 'number' && Number.isFinite(value) ? value : fallback))
);

export const resolveStoredLatentBackgroundTuning = (
    parsed: Partial<LatentBackgroundTuning>,
): LatentBackgroundTuning => ({
    displayMode: resolveLatentDisplayMode(parsed.displayMode),
    colorSource: resolveLatentColorSource(parsed.colorSource),
    dynamicOnlyInPlayer: typeof parsed.dynamicOnlyInPlayer === 'boolean'
        ? parsed.dynamicOnlyInPlayer
        : DEFAULT_LATENT_BACKGROUND_TUNING.dynamicOnlyInPlayer,
    enhancedBeatResponse: typeof parsed.enhancedBeatResponse === 'boolean'
        ? parsed.enhancedBeatResponse
        : DEFAULT_LATENT_BACKGROUND_TUNING.enhancedBeatResponse,
    ditheringSpeed: clampLatentNumber(parsed.ditheringSpeed, DEFAULT_LATENT_BACKGROUND_TUNING.ditheringSpeed, 0, 2),
    ditheringAudioSpeed: clampLatentNumber(parsed.ditheringAudioSpeed, DEFAULT_LATENT_BACKGROUND_TUNING.ditheringAudioSpeed, 0, 2),
    ditheringSize: clampLatentNumber(parsed.ditheringSize, DEFAULT_LATENT_BACKGROUND_TUNING.ditheringSize, 0.5, 8),
    ditheringOpacity: clampLatentNumber(parsed.ditheringOpacity, DEFAULT_LATENT_BACKGROUND_TUNING.ditheringOpacity, 0, 1),
    meshSpeed: clampLatentNumber(parsed.meshSpeed, DEFAULT_LATENT_BACKGROUND_TUNING.meshSpeed, 0, 2),
    meshAudioSpeed: clampLatentNumber(parsed.meshAudioSpeed, DEFAULT_LATENT_BACKGROUND_TUNING.meshAudioSpeed, 0, 2),
    meshDistortion: clampLatentNumber(parsed.meshDistortion, DEFAULT_LATENT_BACKGROUND_TUNING.meshDistortion, 0, 2),
    meshSwirl: clampLatentNumber(parsed.meshSwirl, DEFAULT_LATENT_BACKGROUND_TUNING.meshSwirl, 0, 1),
    overlayEnabled: typeof parsed.overlayEnabled === 'boolean'
        ? parsed.overlayEnabled
        : DEFAULT_LATENT_BACKGROUND_TUNING.overlayEnabled,
    overlayOpacity: clampLatentNumber(parsed.overlayOpacity, DEFAULT_LATENT_BACKGROUND_TUNING.overlayOpacity, 0, 1),
});

export const readStoredLatentBackgroundTuning = (): LatentBackgroundTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_LATENT_BACKGROUND_TUNING;
    }

    const saved = localStorage.getItem('latent_background_tuning');
    if (!saved) return DEFAULT_LATENT_BACKGROUND_TUNING;

    try {
        return resolveStoredLatentBackgroundTuning(JSON.parse(saved) as Partial<LatentBackgroundTuning>);
    } catch {
        return DEFAULT_LATENT_BACKGROUND_TUNING;
    }
};

export type StoredMonetTuningInput = Partial<MonetTuning> & StoredMonetBackgroundTuningInput;
export const resolveStoredMonetTuning = (parsed: StoredMonetTuningInput): MonetTuning => ({
    keywordColoringEnabled: parsed.keywordColoringEnabled ?? DEFAULT_MONET_TUNING.keywordColoringEnabled,
    showDescription: parsed.showDescription ?? DEFAULT_MONET_TUNING.showDescription,
    audioStyle: parsed.audioStyle === 'line' ? 'line' : DEFAULT_MONET_TUNING.audioStyle,
    fontScale: clampMonetFontScale(
        parsed.fontScale ?? DEFAULT_MONET_TUNING.fontScale,
        DEFAULT_MONET_TUNING.fontScale,
    ),
    portraitSource: resolveMonetPortraitSource(parsed.portraitSource),
    portraitOffsetX: typeof parsed.portraitOffsetX === 'number'
        ? Math.min(0, Math.max(-150, parsed.portraitOffsetX))
        : (DEFAULT_MONET_TUNING.portraitOffsetX ?? 0),
    portraitStyle: parsed.portraitStyle === 'rectangular' ? 'rectangular' : DEFAULT_MONET_TUNING.portraitStyle,
    showPortraitDragHanger: parsed.showPortraitDragHanger ?? DEFAULT_MONET_TUNING.showPortraitDragHanger,
});
export const readStoredMonetBackgroundTuning = (): MonetBackgroundTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_MONET_BACKGROUND_TUNING;
    }

    const saved = localStorage.getItem('monet_background_tuning') ?? localStorage.getItem('monet_tuning');
    if (!saved) return DEFAULT_MONET_BACKGROUND_TUNING;

    try {
        const parsed = JSON.parse(saved) as StoredMonetBackgroundTuningInput;
        return resolveStoredMonetBackgroundTuning(parsed);
    } catch {
        return DEFAULT_MONET_BACKGROUND_TUNING;
    }
};

export const readStoredMonetTuning = (): MonetTuning => {
    if (typeof window === 'undefined') {
        return DEFAULT_MONET_TUNING;
    }

    const saved = localStorage.getItem('monet_tuning');
    if (!saved) return DEFAULT_MONET_TUNING;

    try {
        const parsed = JSON.parse(saved) as StoredMonetTuningInput;
        return resolveStoredMonetTuning(parsed);
    } catch {
        return DEFAULT_MONET_TUNING;
    }
};
