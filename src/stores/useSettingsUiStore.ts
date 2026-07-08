import { create } from 'zustand';
import type React from 'react';
import { DEFAULT_CADENZA_TUNING, DEFAULT_CAPPELLA_TUNING, DEFAULT_CLASSIC_TUNING, DEFAULT_CLADDAGH_TUNING, DEFAULT_FUME_TUNING, DEFAULT_MONET_BACKGROUND_TUNING, DEFAULT_MONET_TUNING, DEFAULT_PARTITA_TUNING, DEFAULT_TILT_TUNING, type CadenzaTuning, type CappellaAvatarImage, type CappellaAvatarSource, type CappellaEmojiImage, type CappellaTuning, type ClassicTuning, type CladdaghTuning, type FumeTuning, type LyricProviderSource, type MonetBackgroundImage, type MonetBackgroundLayout, type MonetBackgroundSource, type MonetBackgroundTuning, type MonetBackgroundWashColorMode, type MonetPortraitImage, type MonetPortraitSource, type MonetTuning, type PartitaTuning, type QueueAddBehavior, type StatusMessage, type StoredCappellaAvatarImage, type StoredCappellaEmojiImage, type StoredCustomLyricsFont, type StoredMonetBackgroundImage, type StoredMonetPortraitImage, type Theme, type TiltTuning, type UrlBackgroundItem, type VisualizerBackgroundMode, type VisualizerFrameRate, type VisualizerMode } from '../types';
import { DEFAULT_VISUALIZER_MODE, getVisualizerRegistryEntry, hasVisualizerMode } from '../components/visualizer/registry';
import { getLyricFilterError } from '../utils/lyrics/filtering';
import { buildStoredCappellaEmojiPack, clearCustomCappellaEmojiPack, isSupportedCappellaEmojiFile, saveCustomCappellaEmojiPack } from '../services/cappellaEmojiPack';
import { buildStoredCappellaAvatar, clearCustomCappellaAvatar, isSupportedCappellaAvatarFile, saveCustomCappellaAvatar } from '../services/cappellaAvatarPack';
import { clearUploadedLyricsFont, uploadAndRegisterLyricsFont } from '../services/customLyricsFont';
import { buildStoredMonetBackgroundImage, clearMonetBackgroundImage, isSupportedMonetBackgroundFile, saveMonetBackgroundImage } from '../services/monetBackgroundImage';
import { buildStoredMonetPortraitImage, clearMonetPortraitImage, isSupportedMonetPortraitFile, saveMonetPortraitImage } from '../services/monetPortraitImage';
import { parseVisualizerFrameRate, setGlobalVisualizerFrameRate, VISUALIZER_FRAME_RATE_STORAGE_KEY } from '../utils/frameRateLimiter';
import { sanitizeUrlBackgroundItem, sanitizeUrlBackgroundList } from '../utils/urlBackground';
import { getLyricProviderPreferenceLabel } from '../utils/lyrics/lyricSourceLabels';
import { applyAppLanguagePreference, readStoredAppLanguagePreference, type AppLanguagePreference } from '../i18n/config';
import { normalizeFontFamilyStack } from '../utils/fontStacks';

// src/stores/useSettingsUiStore.ts
// Shared settings state and actions used by App, Home, and SettingsModal.

export type StatusSetter = React.Dispatch<React.SetStateAction<StatusMessage | null>>;
export const CACHE_SIZE_KEY = 'folia_cache_size';
const ENABLE_MEDIA_CACHE_KEY = 'folia_enable_media_cache';
const LAST_SEEN_GUIDE_VERSION_STORAGE_KEY = 'folia_last_seen_guide_version';

export type AudioQuality = 'exhigh' | 'lossless' | 'hires';
export type SettingsModalInitialTab = 'help' | 'options';
export type SettingsSubviewId = 'appearance' | 'general' | 'playback' | 'integration' | 'storage' | 'desktop' | 'lab' | 'visualizer' | 'themePark' | 'lyricFilter';
export type SettingsModalState = {
    isOpen: boolean;
    initialTab: SettingsModalInitialTab;
    initialSubview?: SettingsSubviewId | null;
};

export const MINIMIZE_TO_TRAY_STORAGE_KEY = 'minimize_to_tray';
export const HIDE_TASKBAR_ICON_STORAGE_KEY = 'hide_taskbar_icon';
export const OPEN_PLAYER_ON_LAUNCH_STORAGE_KEY = 'open_player_on_launch';
export const SUBTITLE_OVERLAY_OPACITY_STORAGE_KEY = 'subtitle_overlay_opacity';
export const SHOW_SUBTITLE_TRANSLATION_STORAGE_KEY = 'show_subtitle_translation';
const LYRICS_FONT_FALLBACK_FAMILIES_STORAGE_KEY = 'lyrics_font_fallback_families';
const SUBTITLE_FONT_INHERITS_LYRICS_STORAGE_KEY = 'subtitle_font_inherits_lyrics';
const SUBTITLE_FONT_STYLE_STORAGE_KEY = 'subtitle_font_style';
const SUBTITLE_FONT_FAMILY_STORAGE_KEY = 'subtitle_font_family';
const SUBTITLE_FONT_FALLBACK_FAMILIES_STORAGE_KEY = 'subtitle_font_fallback_families';
export const VISUALIZER_OPACITY_STORAGE_KEY = 'visualizer_opacity';

const getStoredBoolean = (key: string, fallback: boolean) => {
    if (typeof window === 'undefined') {
        return fallback;
    }

    const saved = localStorage.getItem(key);
    return saved !== null ? saved === 'true' : fallback;
};

const setStoredBoolean = (key: string, value: boolean) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(key, String(value));
    }
};

const readStoredDisableHomeDynamicBackground = (): boolean => {
    if (typeof window === 'undefined') {
        return false;
    }

    const saved = localStorage.getItem('disable_home_dynamic_background');
    if (saved !== null) {
        return saved === 'true';
    }

    const legacySaved = localStorage.getItem('enable_home_dynamic_background');
    if (legacySaved !== null) {
        return legacySaved !== 'true';
    }

    return false;
};

const readStoredAudioQuality = (): AudioQuality => {
    if (typeof window === 'undefined') {
        return 'exhigh';
    }

    const saved = localStorage.getItem('default_audio_quality');
    return saved === 'lossless' || saved === 'hires' ? saved : 'exhigh';
};

const readStoredBackgroundOpacity = () => {
    if (typeof window === 'undefined') {
        return 0.75;
    }

    const saved = localStorage.getItem('background_opacity');
    const parsed = saved ? parseFloat(saved) : 0.75;
    return Number.isFinite(parsed) ? parsed : 0.75;
};

const readStoredSubtitleOverlayOpacity = () => {
    if (typeof window === 'undefined') {
        return 0.6;
    }

    const saved = localStorage.getItem(SUBTITLE_OVERLAY_OPACITY_STORAGE_KEY);
    const parsed = saved ? parseFloat(saved) : 0.6;
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0.2, parsed)) : 0.6;
};

const readStoredVisualizerOpacity = () => {
    if (typeof window === 'undefined') {
        return 1;
    }

    const saved = localStorage.getItem(VISUALIZER_OPACITY_STORAGE_KEY);
    const parsed = saved ? parseFloat(saved) : 1;
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0.2, parsed)) : 1;
};

const readStoredVisualizerMode = (): VisualizerMode => {
    if (typeof window === 'undefined') {
        return DEFAULT_VISUALIZER_MODE;
    }

    const saved = localStorage.getItem('visualizer_mode');
    if (saved === 'cadenza' || saved === 'cadenze') {
        return 'cadenza';
    }

    return hasVisualizerMode(saved) ? saved : DEFAULT_VISUALIZER_MODE;
};

const readStoredVisualizerFrameRate = (): VisualizerFrameRate => {
    if (typeof window === 'undefined') {
        return 'off';
    }

    return parseVisualizerFrameRate(localStorage.getItem(VISUALIZER_FRAME_RATE_STORAGE_KEY));
};

const clampClassicBreathingFloatMultiplier = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(2, Math.max(0, value));
};

const clampClassicWordSpacing = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(2, Math.max(0, value));
};

const readStoredClassicTuning = (): ClassicTuning => {
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
                parsed.wordSpacing ?? DEFAULT_CLASSIC_TUNING.wordSpacing,
                DEFAULT_CLASSIC_TUNING.wordSpacing,
            ),
        };
    } catch {
        return DEFAULT_CLASSIC_TUNING;
    }
};

const readStoredCadenzaTuning = (): CadenzaTuning => {
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

const clampPartitaStagger = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(180, Math.max(0, value));
};

const readStoredPartitaTuning = (): PartitaTuning => {
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

const clampFumeCameraSpeed = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.85, Math.max(0.55, value));
};

const clampFumeGlowIntensity = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.8, Math.max(0, value));
};

const clampFumeBackgroundObjectOpacity = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1, Math.max(0, value));
};

const clampFumeHeroScale = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.32, Math.max(0.82, value));
};

const clampFumeTextHoldRatio = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1, Math.max(0, value));
};

const resolveFumeCameraTrackingMode = (value: FumeTuning['cameraTrackingMode'] | undefined) => (
    value === 'stepped' || value === 'smooth'
        ? value
        : DEFAULT_FUME_TUNING.cameraTrackingMode
);

const readStoredFumeTuning = (): FumeTuning => {
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

const clampCladdaghFocusScaleRatio = (val: any, fallback: number = DEFAULT_CLADDAGH_TUNING.focusScaleRatio): number => {
    const parsed = typeof val === 'number' ? val : parseFloat(val);
    return Number.isFinite(parsed) ? Math.min(1.5, Math.max(0.0, parsed)) : fallback;
};

const clampCladdaghRadiusScale = (val: any, fallback: number = DEFAULT_CLADDAGH_TUNING.radiusScale): number => {
    const parsed = typeof val === 'number' ? val : parseFloat(val);
    return Number.isFinite(parsed) ? Math.min(1.5, Math.max(0.5, parsed)) : fallback;
};

const clampCladdaghEllipseTiltDeg = (val: any, fallback: number = DEFAULT_CLADDAGH_TUNING.ellipseTiltDeg): number => {
    const parsed = typeof val === 'number' ? val : parseFloat(val);
    return Number.isFinite(parsed) ? Math.min(60, Math.max(0, parsed)) : fallback;
};

const clampCladdaghLetterSpacingOffset = (val: any, fallback: number = DEFAULT_CLADDAGH_TUNING.letterSpacingOffset): number => {
    const parsed = typeof val === 'number' ? val : parseFloat(val);
    return Number.isFinite(parsed) ? Math.min(20, Math.max(-5, parsed)) : fallback;
};

const readStoredCladdaghTuning = (): CladdaghTuning => {
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

const resolveCappellaAvatarSource = (source: CappellaAvatarSource | undefined): CappellaAvatarSource => (
    source === 'builtin' || source === 'color' || source === 'cover' || source === 'custom'
        ? source
        : DEFAULT_CAPPELLA_TUNING.avatarSource
);

export const resolveStoredCappellaTuning = (parsed: Partial<CappellaTuning>): CappellaTuning => ({
    showEmoMessages: parsed.showEmoMessages ?? DEFAULT_CAPPELLA_TUNING.showEmoMessages,
    emojiPackSource: parsed.emojiPackSource === 'custom' ? 'custom' : 'builtin',
    avatarSource: resolveCappellaAvatarSource(parsed.avatarSource),
});

const readStoredCappellaTuning = (): CappellaTuning => {
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

const readStoredTiltTuning = (): TiltTuning => {
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

const resolveMonetBackgroundSource = (value: MonetBackgroundSource | undefined): MonetBackgroundSource => (
    value === 'uploaded-global' ? 'uploaded-global' : DEFAULT_MONET_BACKGROUND_TUNING.backgroundSource
);

const resolveMonetBackgroundLayout = (value: MonetBackgroundLayout | undefined): MonetBackgroundLayout => (
    value === 'full-overlay' || value === 'half-pane-gradient'
        ? value
        : DEFAULT_MONET_BACKGROUND_TUNING.backgroundLayout
);

const resolveMonetBackgroundWashColorMode = (
    value: MonetBackgroundWashColorMode | undefined,
): MonetBackgroundWashColorMode => (
    value === 'custom' ? 'custom' : DEFAULT_MONET_BACKGROUND_TUNING.backgroundWashColorMode
);

const clampMonetBackgroundBlur = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(60, Math.max(0, value));
};

const clampUnitInterval = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1, Math.max(0, value));
};

const clampMonetBackgroundSaturation = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(2, Math.max(0, value));
};

const clampMonetBackgroundOffsetX = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(40, Math.max(-40, value));
};

const clampMonetFontScale = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.5, Math.max(0.7, value));
};

const normalizeHexColor = (value: unknown, fallback: string) => {
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

const resolveMonetPortraitSource = (value: MonetPortraitSource | undefined): MonetPortraitSource => (
    value === 'custom' ? 'custom' : DEFAULT_MONET_TUNING.portraitSource
);

const readStoredVisualizerBackgroundMode = (): VisualizerBackgroundMode | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    const saved = localStorage.getItem('visualizer_background_mode');
    return saved === 'common' || saved === 'monet' || saved === 'url' || saved === 'sora' ? saved : null;
};

const readStoredUrlBackgroundList = (): UrlBackgroundItem[] => {
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

const readStoredUrlBackgroundSelectedId = (): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('url_background_selected_id') || null;
};

export const resolveVisualizerBackgroundMode = (
    storedMode: VisualizerBackgroundMode | null | undefined,
    visualizerMode: VisualizerMode,
): VisualizerBackgroundMode => storedMode ?? (visualizerMode === 'monet' ? 'monet' : 'common');

type StoredMonetBackgroundTuningInput = Partial<MonetBackgroundTuning> & {
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
});

type StoredMonetTuningInput = Partial<MonetTuning> & StoredMonetBackgroundTuningInput;
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
const readStoredMonetBackgroundTuning = (): MonetBackgroundTuning => {
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

const readStoredMonetTuning = (): MonetTuning => {
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

const readStoredLyricsFontStyle = (): Theme['fontStyle'] => {
    if (typeof window === 'undefined') {
        return 'sans';
    }

    const saved = localStorage.getItem('lyrics_font_style');
    return saved === 'serif' || saved === 'mono' ? saved : 'sans';
};

const readStoredLyricsFontScale = (): number => {
    if (typeof window === 'undefined') {
        return 1;
    }

    const saved = localStorage.getItem('lyrics_font_scale');
    if (!saved) return 1;

    const parsed = parseFloat(saved);
    if (!Number.isFinite(parsed)) return 1;

    return Math.min(1.4, Math.max(0.85, parsed));
};

const readStoredFontFamilyStack = (key: string): string[] => {
    if (typeof window === 'undefined') {
        return [];
    }

    const saved = localStorage.getItem(key);
    if (!saved) return [];

    try {
        const parsed = JSON.parse(saved) as unknown;
        if (Array.isArray(parsed)) {
            return normalizeFontFamilyStack(parsed.map(item => typeof item === 'string' ? item : ''));
        }

        if (typeof parsed === 'string') {
            return normalizeFontFamilyStack(parsed.split(','));
        }
    } catch {
        return normalizeFontFamilyStack(saved.split(','));
    }

    return [];
};

const readStoredSubtitleFontStyle = (): Theme['fontStyle'] => {
    if (typeof window === 'undefined') {
        return 'sans';
    }

    const saved = localStorage.getItem(SUBTITLE_FONT_STYLE_STORAGE_KEY);
    return saved === 'serif' || saved === 'mono' ? saved : 'sans';
};

const readStoredSubtitleFontFamily = (): string | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    return localStorage.getItem(SUBTITLE_FONT_FAMILY_STORAGE_KEY)?.trim() || null;
};

const storeFontFamilyStack = (key: string, families: string[]) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(normalizeFontFamilyStack(families)));
    }
};

export const resolveStoredCustomLyricsFont = (parsed: Partial<StoredCustomLyricsFont>): StoredCustomLyricsFont | null => {
    const family = parsed.family?.trim();
    if (!family) return null;

    const source = parsed.source === 'uploaded' ? 'uploaded' : 'system';
    const label = parsed.label?.trim() || family;

    if (source === 'uploaded') {
        const fontId = parsed.fontId?.trim();
        if (!fontId) return null;

        return {
            source,
            family,
            label,
            fontId,
        };
    }

    return {
        source,
        family,
        label,
    };
};

const readStoredCustomLyricsFont = (): StoredCustomLyricsFont | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    const saved = localStorage.getItem('lyrics_custom_font');
    if (!saved) return null;

    try {
        const parsed = JSON.parse(saved) as Partial<StoredCustomLyricsFont>;
        return resolveStoredCustomLyricsFont(parsed);
    } catch {
        return null;
    }
};

const readStoredLyricFilterPattern = (): string => {
    if (typeof window === 'undefined') {
        return '';
    }

    return localStorage.getItem('lyrics_filter_pattern')?.trim() || '';
};

const readStoredLoopMode = (): 'off' | 'all' | 'one' => {
    if (typeof window === 'undefined') {
        return 'off';
    }

    const saved = localStorage.getItem('player_loop_mode');
    return saved === 'all' || saved === 'one' ? saved : 'off';
};

const readStoredQueueAddBehavior = (): QueueAddBehavior => {
    if (typeof window === 'undefined') {
        return 'append';
    }

    const saved = localStorage.getItem('queue_add_behavior');
    return saved === 'next' ? 'next' : 'append';
};

const readStoredAudioOutputDeviceId = (): string => {
    if (typeof window === 'undefined') {
        return '';
    }

    return localStorage.getItem('audio_output_device_id') ?? '';
};

const readStoredHomeLayoutStyle = (): 'carousel' | 'grid' => {
    if (typeof window === 'undefined') {
        return 'grid';
    }

    const saved = localStorage.getItem('home_layout_style');
    if (saved === 'desktop') return 'grid';
    return saved === 'carousel' ? 'carousel' : 'grid';
};

const readStoredPreferredAlternativeLyricSource = (): LyricProviderSource => {
    if (typeof window === 'undefined') return 'netease';
    const saved = localStorage.getItem('preferred_alternative_lyric_source');
    return saved === 'qq' || saved === 'kugou' || saved === 'amll' ? saved : 'netease';
};

/**
 * Reads the stored card style for the Grid3D desktop home view from localStorage.
 * Returns 'image' (pure cover cover) or 'card' (Polaroid style with details).
 */
const readStoredGrid3dCardStyle = (): 'image' | 'card' => {
    if (typeof window === 'undefined') {
        return 'card';
    }

    const saved = localStorage.getItem('grid3d_card_style');
    return saved === 'image' ? 'image' : 'card';
};

const readStoredVolume = () => {
    if (typeof window === 'undefined') {
        return 1;
    }

    const saved = localStorage.getItem('player_volume');
    const parsed = saved !== null ? parseFloat(saved) : 1;
    return Number.isFinite(parsed) ? parsed : 1;
};

export type SettingsUiState = {
    statusSetter: StatusSetter | null;
    audioQuality: AudioQuality;
    useCoverColorBg: boolean;
    staticMode: boolean;
    disableHomeDynamicBackground: boolean;
    enableAlternativeLyricSources: boolean;
    autoUseBestLyric: boolean;
    preferredAlternativeLyricSource: LyricProviderSource;
    hidePlayerProgressBar: boolean;
    hidePlayerTranslationSubtitle: boolean;
    showSubtitleTranslation: boolean;
    hidePlayerRightPanelButton: boolean;
    transparentPlayerBackground: boolean;
    enablePlayerPageNativeBlur: boolean;
    autoHidePlayerChrome: boolean;
    disableVisualizerVignette: boolean;
    disableVisualizerGeometricBackground: boolean;
    minimizeToTray: boolean;
    hideTaskbarIcon: boolean;
    openPlayerOnLaunch: boolean;
    enableMediaCache: boolean;
    backgroundOpacity: number;
    subtitleOverlayOpacity: number;
    visualizerOpacity: number;
    visualizerBackgroundMode: VisualizerBackgroundMode | null;
    urlBackgroundList: UrlBackgroundItem[];
    urlBackgroundSelectedId: string | null;
    visualizerFrameRate: VisualizerFrameRate;
    isDaylight: boolean;
    visualizerMode: VisualizerMode;
    classicTuning: ClassicTuning;
    cadenzaTuning: CadenzaTuning;
    partitaTuning: PartitaTuning;
    fumeTuning: FumeTuning;
    claddaghTuning: CladdaghTuning;
    cappellaTuning: CappellaTuning;
    tiltTuning: TiltTuning;
    monetBackgroundTuning: MonetBackgroundTuning;
    monetTuning: MonetTuning;
    storedCappellaEmojiPack: StoredCappellaEmojiImage[];
    cappellaCustomEmojiImages: CappellaEmojiImage[];
    isLoadingCappellaCustomEmojiPack: boolean;
    storedCappellaAvatarPack: StoredCappellaAvatarImage[];
    cappellaCustomAvatarImages: CappellaAvatarImage[];
    isLoadingCappellaCustomAvatarPack: boolean;
    storedMonetBackgroundImage: StoredMonetBackgroundImage | null;
    monetBackgroundImage: MonetBackgroundImage | null;
    isLoadingMonetBackgroundImage: boolean;
    storedMonetPortraitImage: StoredMonetPortraitImage | null;
    monetPortraitImage: MonetPortraitImage | null;
    isLoadingMonetPortraitImage: boolean;
    appLanguagePreference: AppLanguagePreference;
    lyricsFontStyle: Theme['fontStyle'];
    lyricsFontScale: number;
    lyricsCustomFont: StoredCustomLyricsFont | null;
    lyricsFontFallbackFamilies: string[];
    subtitleFontInheritsLyrics: boolean;
    subtitleFontStyle: Theme['fontStyle'];
    subtitleFontFamily: string | null;
    subtitleFontFallbackFamilies: string[];
    lyricFilterPattern: string;
    showOpenPanelCloseButton: boolean;
    enableNowPlayingStage: boolean;
    queueAddBehavior: QueueAddBehavior;
    audioOutputDeviceId: string;
    volume: number;
    isMuted: boolean;
    loopMode: 'off' | 'all' | 'one';
    homeLayoutStyle: 'carousel' | 'grid';
    grid3dCardStyle: 'image' | 'card';
    activeGridViewCollection: any | null;
    setActiveGridViewCollection: (collection: any | null) => void;
    isSubSettingsViewOpen: boolean;
    settingsModalState: SettingsModalState;
    lastSeenGuideVersion: string | null;
    isUserGuideModalOpen: boolean;
    setLastSeenGuideVersion: (version: string) => void;
    setIsUserGuideModalOpen: (isOpen: boolean) => void;
    setStatusSetter: (setter: StatusSetter | null) => void;
    setAudioQuality: (quality: AudioQuality) => void;
    setTransparentPlayerBackgroundFromSystem: (enabled: boolean) => void;
    handleTogglePlayerPageNativeBlur: (enable: boolean) => void;
    setDesktopPreferenceSnapshot: (settings: { MINIMIZE_TO_TRAY?: unknown; HIDE_TASKBAR_ICON?: unknown; }) => void;
    setStoredCappellaEmojiPack: (pack: StoredCappellaEmojiImage[]) => void;
    setCappellaCustomEmojiImages: (images: CappellaEmojiImage[]) => void;
    setIsLoadingCappellaCustomEmojiPack: (loading: boolean) => void;
    setStoredCappellaAvatarPack: (pack: StoredCappellaAvatarImage[]) => void;
    setCappellaCustomAvatarImages: (images: CappellaAvatarImage[]) => void;
    setIsLoadingCappellaCustomAvatarPack: (loading: boolean) => void;
    setStoredMonetBackgroundImage: (image: StoredMonetBackgroundImage | null) => void;
    setMonetBackgroundImage: (image: MonetBackgroundImage | null) => void;
    setIsLoadingMonetBackgroundImage: (loading: boolean) => void;
    setStoredMonetPortraitImage: (image: StoredMonetPortraitImage | null) => void;
    setMonetPortraitImage: (image: MonetPortraitImage | null) => void;
    setIsLoadingMonetPortraitImage: (loading: boolean) => void;
    clearLyricsCustomFontAfterRestoreFailure: (message: StatusMessage) => void;
    setIsSubSettingsViewOpen: (open: boolean) => void;
    openSettings: (initialTab?: SettingsModalInitialTab, initialSubview?: SettingsSubviewId | null) => void;
    closeSettings: () => void;
    handleToggleCoverColorBg: (enable: boolean) => void;
    handleToggleStaticMode: (enable: boolean) => void;
    handleToggleDisableHomeDynamicBackground: (disable: boolean) => void;
    handleToggleAlternativeLyricSources: (enable: boolean) => void;
    handleToggleAutoUseBestLyric: (enable: boolean) => void;
    handleSetPreferredAlternativeLyricSource: (source: LyricProviderSource) => void;
    handleToggleHidePlayerProgressBar: (enable: boolean) => void;
    handleToggleHidePlayerTranslationSubtitle: (enable: boolean) => void;
    handleToggleShowSubtitleTranslation: (enable: boolean) => void;
    handleToggleHidePlayerRightPanelButton: (enable: boolean) => void;
    handleToggleTransparentPlayerBackground: (enable: boolean) => void;
    handleToggleAutoHidePlayerChrome: (enable: boolean) => void;
    handleToggleDisableVisualizerVignette: (disable: boolean) => void;
    handleToggleDisableVisualizerGeometricBackground: (disable: boolean) => void;
    handleToggleMinimizeToTray: (enable: boolean) => void;
    handleToggleHideTaskbarIcon: (enable: boolean) => void;
    handleToggleOpenPlayerOnLaunch: (enable: boolean) => void;
    handleToggleMediaCache: (enable: boolean) => void;
    handleSetBackgroundOpacity: (opacity: number) => void;
    handleSetSubtitleOverlayOpacity: (opacity: number) => void;
    handleSetVisualizerOpacity: (opacity: number) => void;
    handleSetVisualizerBackgroundMode: (mode: VisualizerBackgroundMode) => void;
    handleResetVisualizerBackgroundMode: () => void;
    handleAddUrlBackgroundItem: (item: UrlBackgroundItem) => void;
    handleUpdateUrlBackgroundItem: (id: string, patch: Partial<Omit<UrlBackgroundItem, 'id'>>) => void;
    handleDeleteUrlBackgroundItem: (id: string) => void;
    handleSetUrlBackgroundSelectedId: (id: string | null) => void;
    handleSetUrlBackgroundList: (items: UrlBackgroundItem[]) => void;
    handleSetVisualizerFrameRate: (frameRate: VisualizerFrameRate) => void;
    setDaylightPreference: (isDaylight: boolean) => void;
    handleSetVisualizerMode: (mode: VisualizerMode) => void;
    handleSetClassicTuning: (patch: Partial<ClassicTuning>) => void;
    handleResetClassicTuning: () => void;
    handleSetCadenzaTuning: (patch: Partial<CadenzaTuning>) => void;
    handleResetCadenzaTuning: () => void;
    handleSetPartitaTuning: (patch: Partial<PartitaTuning>) => void;
    handleResetPartitaTuning: () => void;
    handleSetFumeTuning: (patch: Partial<FumeTuning>) => void;
    handleResetFumeTuning: () => void;
    handleSetCladdaghTuning: (patch: Partial<CladdaghTuning>) => void;
    handleResetCladdaghTuning: () => void;
    handleSetCappellaTuning: (patch: Partial<CappellaTuning>) => void;
    handleResetCappellaTuning: () => void;
    handleSetTiltTuning: (patch: Partial<TiltTuning>) => void;
    handleResetTiltTuning: () => void;
    handleSetMonetBackgroundTuning: (patch: Partial<MonetBackgroundTuning>) => void;
    handleResetMonetBackgroundTuning: () => void;
    handleSetMonetTuning: (patch: Partial<MonetTuning>) => void;
    handleResetMonetTuning: () => void;
    handleUploadMonetBackgroundImage: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    handleClearMonetBackgroundImage: () => Promise<void>;
    handleUploadMonetPortraitImage: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    handleClearMonetPortraitImage: () => Promise<void>;
    handleImportCustomCappellaEmojiPack: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    handleClearCustomCappellaEmojiPack: () => Promise<void>;
    handleImportCustomCappellaAvatar: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    handleClearCustomCappellaAvatar: () => Promise<void>;
    handleSetLyricsFontStyle: (fontStyle: Theme['fontStyle']) => void;
    handleSetLyricsFontScale: (fontScale: number) => void;
    handleSetLyricsCustomFont: (font: StoredCustomLyricsFont | null) => void;
    handleUploadLyricsCustomFont: (file: File) => Promise<{ ok: boolean; error?: string; }>;
    handleSetLyricsFontFallbackFamilies: (families: string[]) => void;
    handleSetSubtitleFontInheritsLyrics: (inheritsLyrics: boolean) => void;
    handleSetSubtitleFontStyle: (fontStyle: Theme['fontStyle']) => void;
    handleSetSubtitleFontFamily: (fontFamily: string | null) => void;
    handleSetSubtitleFontFallbackFamilies: (families: string[]) => void;
    handleSetAppLanguagePreference: (preference: AppLanguagePreference) => Promise<void>;
    handleSetLyricFilterPattern: (pattern: string) => void;
    handleToggleOpenPanelCloseButton: (enable: boolean) => void;
    handleToggleNowPlayingStage: (enable: boolean) => void;
    handleSetQueueAddBehavior: (behavior: QueueAddBehavior) => void;
    handleSetAudioOutputDeviceId: (deviceId: string) => void;
    handleSetVolume: (val: number) => void;
    handleToggleMute: () => void;
    handleToggleLoopMode: () => void;
    handleSetHomeLayoutStyle: (style: 'carousel' | 'grid') => void;
    handleSetGrid3dCardStyle: (style: 'image' | 'card') => void;
};

const notify = (get: () => SettingsUiState, message: StatusMessage) => {
    get().statusSetter?.(message);
};

export const useSettingsUiStore = create<SettingsUiState>((set, get) => ({
    statusSetter: null,
    audioQuality: readStoredAudioQuality(),
    useCoverColorBg: getStoredBoolean('use_cover_color_bg', false),
    staticMode: getStoredBoolean('static_mode', false),
    disableHomeDynamicBackground: readStoredDisableHomeDynamicBackground(),
    enableAlternativeLyricSources: getStoredBoolean('enable_alternative_lyric_sources', true),
    autoUseBestLyric: getStoredBoolean('auto_use_best_lyric', true),
    preferredAlternativeLyricSource: readStoredPreferredAlternativeLyricSource(),
    hidePlayerProgressBar: getStoredBoolean('hide_player_progress_bar', false),
    hidePlayerTranslationSubtitle: getStoredBoolean('hide_player_translation_subtitle', false),
    showSubtitleTranslation: getStoredBoolean(SHOW_SUBTITLE_TRANSLATION_STORAGE_KEY, true),
    hidePlayerRightPanelButton: getStoredBoolean('hide_player_right_panel_button', false),
    transparentPlayerBackground: getStoredBoolean('transparent_player_background', false),
    enablePlayerPageNativeBlur: getStoredBoolean('enable_player_page_native_blur', false),
    autoHidePlayerChrome: getStoredBoolean('auto_hide_player_chrome', false),
    disableVisualizerVignette: getStoredBoolean('disable_visualizer_vignette', false),
    disableVisualizerGeometricBackground: getStoredBoolean('disable_visualizer_geometric_background', false),
    minimizeToTray: getStoredBoolean(MINIMIZE_TO_TRAY_STORAGE_KEY, false),
    hideTaskbarIcon: getStoredBoolean(HIDE_TASKBAR_ICON_STORAGE_KEY, false),
    openPlayerOnLaunch: getStoredBoolean(OPEN_PLAYER_ON_LAUNCH_STORAGE_KEY, false),
    enableMediaCache: getStoredBoolean(ENABLE_MEDIA_CACHE_KEY, false),
    backgroundOpacity: readStoredBackgroundOpacity(),
    subtitleOverlayOpacity: readStoredSubtitleOverlayOpacity(),
    visualizerOpacity: readStoredVisualizerOpacity(),
    visualizerBackgroundMode: readStoredVisualizerBackgroundMode(),
    urlBackgroundList: readStoredUrlBackgroundList(),
    urlBackgroundSelectedId: readStoredUrlBackgroundSelectedId(),
    visualizerFrameRate: readStoredVisualizerFrameRate(),
    isDaylight: getStoredBoolean('default_theme_daylight', false),
    visualizerMode: readStoredVisualizerMode(),
    classicTuning: readStoredClassicTuning(),
    cadenzaTuning: readStoredCadenzaTuning(),
    partitaTuning: readStoredPartitaTuning(),
    fumeTuning: readStoredFumeTuning(),
    claddaghTuning: readStoredCladdaghTuning(),
    cappellaTuning: readStoredCappellaTuning(),
    tiltTuning: readStoredTiltTuning(),
    monetBackgroundTuning: readStoredMonetBackgroundTuning(),
    monetTuning: readStoredMonetTuning(),
    storedCappellaEmojiPack: [],
    cappellaCustomEmojiImages: [],
    isLoadingCappellaCustomEmojiPack: true,
    storedCappellaAvatarPack: [],
    cappellaCustomAvatarImages: [],
    isLoadingCappellaCustomAvatarPack: true,
    storedMonetBackgroundImage: null,
    monetBackgroundImage: null,
    isLoadingMonetBackgroundImage: true,
    storedMonetPortraitImage: null,
    monetPortraitImage: null,
    isLoadingMonetPortraitImage: true,
    appLanguagePreference: readStoredAppLanguagePreference(),
    lyricsFontStyle: readStoredLyricsFontStyle(),
    lyricsFontScale: readStoredLyricsFontScale(),
    lyricsCustomFont: readStoredCustomLyricsFont(),
    lyricsFontFallbackFamilies: readStoredFontFamilyStack(LYRICS_FONT_FALLBACK_FAMILIES_STORAGE_KEY),
    subtitleFontInheritsLyrics: getStoredBoolean(SUBTITLE_FONT_INHERITS_LYRICS_STORAGE_KEY, true),
    subtitleFontStyle: readStoredSubtitleFontStyle(),
    subtitleFontFamily: readStoredSubtitleFontFamily(),
    subtitleFontFallbackFamilies: readStoredFontFamilyStack(SUBTITLE_FONT_FALLBACK_FAMILIES_STORAGE_KEY),
    lyricFilterPattern: readStoredLyricFilterPattern(),
    showOpenPanelCloseButton: getStoredBoolean('show_open_panel_close_button', true),
    enableNowPlayingStage: getStoredBoolean('enable_now_playing_stage', false),
    queueAddBehavior: readStoredQueueAddBehavior(),
    audioOutputDeviceId: readStoredAudioOutputDeviceId(),
    volume: readStoredVolume(),
    isMuted: getStoredBoolean('player_is_muted', false),
    loopMode: readStoredLoopMode(),
    homeLayoutStyle: readStoredHomeLayoutStyle(),
    grid3dCardStyle: readStoredGrid3dCardStyle(),
    activeGridViewCollection: null,
    setActiveGridViewCollection: (collection) => set({ activeGridViewCollection: collection }),
    isSubSettingsViewOpen: false,
    settingsModalState: {
        isOpen: false,
        initialTab: 'help',
        initialSubview: null,
    },
    lastSeenGuideVersion: typeof window !== 'undefined' ? localStorage.getItem(LAST_SEEN_GUIDE_VERSION_STORAGE_KEY) : null,
    isUserGuideModalOpen: false,
    setLastSeenGuideVersion: (version) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(LAST_SEEN_GUIDE_VERSION_STORAGE_KEY, version);
        }
        set({ lastSeenGuideVersion: version });
    },
    setIsUserGuideModalOpen: (isOpen) => set({ isUserGuideModalOpen: isOpen }),
    setStatusSetter: (setter) => set({ statusSetter: setter }),
    setAudioQuality: (quality) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('default_audio_quality', quality);
        }
        set({ audioQuality: quality });
    },
    setTransparentPlayerBackgroundFromSystem: (enabled) => {
        setStoredBoolean('transparent_player_background', enabled);
        set({ transparentPlayerBackground: enabled });
    },
    handleTogglePlayerPageNativeBlur: (enable) => {
        setStoredBoolean('enable_player_page_native_blur', enable);
        set({ enablePlayerPageNativeBlur: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('enable_player_page_native_blur', enable);
        }
    },
    handleToggleAutoHidePlayerChrome: (enabled: boolean) => {
        localStorage.setItem('auto_hide_player_chrome', enabled ? 'true' : 'false');
        set({ autoHidePlayerChrome: enabled });
    },
    setDesktopPreferenceSnapshot: (settings) => {
        const patch: Partial<SettingsUiState> = {};
        if (typeof settings.MINIMIZE_TO_TRAY === 'boolean') {
            patch.minimizeToTray = settings.MINIMIZE_TO_TRAY;
            setStoredBoolean(MINIMIZE_TO_TRAY_STORAGE_KEY, settings.MINIMIZE_TO_TRAY);
        }
        if (typeof settings.HIDE_TASKBAR_ICON === 'boolean') {
            patch.hideTaskbarIcon = settings.HIDE_TASKBAR_ICON;
            setStoredBoolean(HIDE_TASKBAR_ICON_STORAGE_KEY, settings.HIDE_TASKBAR_ICON);
        }
        set(patch);
    },
    setStoredCappellaEmojiPack: (pack) => set({ storedCappellaEmojiPack: pack }),
    setCappellaCustomEmojiImages: (images) => set({ cappellaCustomEmojiImages: images }),
    setIsLoadingCappellaCustomEmojiPack: (loading) => set({ isLoadingCappellaCustomEmojiPack: loading }),
    setStoredCappellaAvatarPack: (pack) => set({ storedCappellaAvatarPack: pack }),
    setCappellaCustomAvatarImages: (images) => set({ cappellaCustomAvatarImages: images }),
    setIsLoadingCappellaCustomAvatarPack: (loading) => set({ isLoadingCappellaCustomAvatarPack: loading }),
    setStoredMonetBackgroundImage: (image) => set({ storedMonetBackgroundImage: image }),
    setMonetBackgroundImage: (image) => set({ monetBackgroundImage: image }),
    setIsLoadingMonetBackgroundImage: (loading) => set({ isLoadingMonetBackgroundImage: loading }),
    setStoredMonetPortraitImage: (image) => set({ storedMonetPortraitImage: image }),
    setMonetPortraitImage: (image) => set({ monetPortraitImage: image }),
    setIsLoadingMonetPortraitImage: (loading) => set({ isLoadingMonetPortraitImage: loading }),
    clearLyricsCustomFontAfterRestoreFailure: (message) => {
        if (typeof window !== 'undefined') {
            localStorage.removeItem('lyrics_custom_font');
        }
        set({ lyricsCustomFont: null });
        notify(get, message);
    },
    setIsSubSettingsViewOpen: (open) => set({ isSubSettingsViewOpen: open }),
    openSettings: (initialTab = 'help', initialSubview = null) => set({
        settingsModalState: {
            isOpen: true,
            initialTab,
            initialSubview,
        },
    }),
    closeSettings: () => set(state => ({
        settingsModalState: {
            ...state.settingsModalState,
            isOpen: false,
        },
    })),
    handleToggleCoverColorBg: (enable) => {
        setStoredBoolean('use_cover_color_bg', enable);
        set({ useCoverColorBg: enable });
        notify(get, {
            type: 'info',
            text: enable ? '添加封面色彩' : '使用默认色彩',
        });
    },
    handleToggleStaticMode: (enable) => {
        setStoredBoolean('static_mode', enable);
        set({ staticMode: enable });
        notify(get, {
            type: 'info',
            text: enable ? '静态模式已开启' : '静态模式已关闭',
        });
    },
    handleToggleDisableHomeDynamicBackground: (disable) => {
        setStoredBoolean('disable_home_dynamic_background', disable);
        set({ disableHomeDynamicBackground: disable });
        notify(get, {
            type: 'info',
            text: disable ? '主页动态背景已关闭' : '主页动态背景已开启',
        });
    },
    handleToggleAlternativeLyricSources: (enable) => {
        setStoredBoolean('enable_alternative_lyric_sources', enable);
        set({ enableAlternativeLyricSources: enable });
        notify(get, {
            type: 'info',
            text: enable ? '更多歌词源已开启' : '更多歌词源已关闭',
        });
    },
    handleToggleAutoUseBestLyric: (enable) => {
        setStoredBoolean('auto_use_best_lyric', enable);
        set({ autoUseBestLyric: enable });
        notify(get, {
            type: 'info',
            text: enable ? '自动使用最佳歌词已开启' : '自动使用最佳歌词已关闭',
        });
    },
    handleSetPreferredAlternativeLyricSource: (source) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('preferred_alternative_lyric_source', source);
        }
        set({ preferredAlternativeLyricSource: source });
        notify(get, {
            type: 'info',
            text: `优先匹配歌词源已切换为${getLyricProviderPreferenceLabel(source)}`,
        });
    },
    handleToggleHidePlayerProgressBar: (enable) => {
        setStoredBoolean('hide_player_progress_bar', enable);
        set({ hidePlayerProgressBar: enable });
        notify(get, {
            type: 'info',
            text: enable ? '播放页底部控制条已隐藏' : '播放页底部控制条已显示',
        });
    },
    handleToggleHidePlayerTranslationSubtitle: (enable) => {
        setStoredBoolean('hide_player_translation_subtitle', enable);
        set({ hidePlayerTranslationSubtitle: enable });
        notify(get, {
            type: 'info',
            text: enable ? '底部字幕层已隐藏' : '底部字幕层已显示',
        });
    },
    handleToggleShowSubtitleTranslation: (enable) => {
        setStoredBoolean(SHOW_SUBTITLE_TRANSLATION_STORAGE_KEY, enable);
        set({ showSubtitleTranslation: enable });
        notify(get, {
            type: 'info',
            text: enable ? '字幕翻译已显示' : '字幕翻译已隐藏',
        });
    },
    handleToggleHidePlayerRightPanelButton: (enable) => {
        setStoredBoolean('hide_player_right_panel_button', enable);
        set({ hidePlayerRightPanelButton: enable });
        notify(get, {
            type: 'info',
            text: enable ? '播放页右侧按钮已隐藏' : '播放页右侧按钮已显示',
        });
    },
    handleToggleTransparentPlayerBackground: (enable) => {
        setStoredBoolean('transparent_player_background', enable);
        set({ transparentPlayerBackground: enable });
        notify(get, {
            type: 'info',
            text: enable ? '播放页透明背景已开启' : '播放页透明背景已关闭',
        });
    },
    handleToggleDisableVisualizerVignette: (disable) => {
        setStoredBoolean('disable_visualizer_vignette', disable);
        set({ disableVisualizerVignette: disable });
        notify(get, {
            type: 'info',
            text: disable ? '播放页暗角效果已关闭' : '播放页暗角效果已开启',
        });
    },
    handleToggleDisableVisualizerGeometricBackground: (disable) => {
        setStoredBoolean('disable_visualizer_geometric_background', disable);
        set({ disableVisualizerGeometricBackground: disable });
        notify(get, {
            type: 'info',
            text: disable ? '通用几何背景已隐藏' : '通用几何背景已显示',
        });
    },
    handleToggleMinimizeToTray: (enable) => {
        setStoredBoolean(MINIMIZE_TO_TRAY_STORAGE_KEY, enable);
        set({ minimizeToTray: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('MINIMIZE_TO_TRAY', enable);
        }
        notify(get, {
            type: 'info',
            text: enable ? '最小化将隐藏到托盘' : '最小化将保留在任务栏',
        });
    },
    handleToggleHideTaskbarIcon: (enable) => {
        setStoredBoolean(HIDE_TASKBAR_ICON_STORAGE_KEY, enable);
        set({ hideTaskbarIcon: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('HIDE_TASKBAR_ICON', enable);
        }
        notify(get, {
            type: 'info',
            text: enable ? '主窗口任务栏图标已隐藏' : '主窗口任务栏图标已恢复',
        });
    },
    handleToggleOpenPlayerOnLaunch: (enable) => {
        setStoredBoolean(OPEN_PLAYER_ON_LAUNCH_STORAGE_KEY, enable);
        set({ openPlayerOnLaunch: enable });
        notify(get, {
            type: 'info',
            text: enable ? '启动后将直接进入播放页' : '启动后将默认进入首页',
        });
    },
    handleToggleMediaCache: (enable) => {
        setStoredBoolean('enable_media_cache', enable);
        set({ enableMediaCache: enable });
    },
    handleSetBackgroundOpacity: (opacity) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('background_opacity', String(opacity));
        }
        set({ backgroundOpacity: opacity });
    },
    handleSetSubtitleOverlayOpacity: (opacity) => {
        const next = Math.min(1, Math.max(0.2, opacity));
        if (typeof window !== 'undefined') {
            localStorage.setItem(SUBTITLE_OVERLAY_OPACITY_STORAGE_KEY, String(next));
        }
        set({ subtitleOverlayOpacity: next });
    },
    handleSetVisualizerOpacity: (opacity) => {
        const next = Math.min(1, Math.max(0.2, opacity));
        if (typeof window !== 'undefined') {
            localStorage.setItem(VISUALIZER_OPACITY_STORAGE_KEY, String(next));
        }
        set({ visualizerOpacity: next });
    },
    handleSetVisualizerBackgroundMode: (mode) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('visualizer_background_mode', mode);
        }
        set({ visualizerBackgroundMode: mode });
    },
    handleResetVisualizerBackgroundMode: () => {
        if (typeof window !== 'undefined') {
            localStorage.removeItem('visualizer_background_mode');
        }
        set({ visualizerBackgroundMode: null });
    },
    handleAddUrlBackgroundItem: (item) => {
        const sanitized = sanitizeUrlBackgroundItem(item);
        if (!sanitized) return;
        const next = [...get().urlBackgroundList, sanitized];
        if (typeof window !== 'undefined') {
            localStorage.setItem('url_background_list', JSON.stringify(next));
        }
        set({ urlBackgroundList: next });
    },
    handleUpdateUrlBackgroundItem: (id, patch) => {
        const next = get().urlBackgroundList.map(item =>
            item.id === id ? sanitizeUrlBackgroundItem({ ...item, ...patch, id: item.id }) ?? item : item
        );
        if (typeof window !== 'undefined') {
            localStorage.setItem('url_background_list', JSON.stringify(next));
        }
        set({ urlBackgroundList: next });
    },
    handleDeleteUrlBackgroundItem: (id) => {
        const next = get().urlBackgroundList.filter(item => item.id !== id);
        if (typeof window !== 'undefined') {
            localStorage.setItem('url_background_list', JSON.stringify(next));
        }
        const selectedId = get().urlBackgroundSelectedId;
        if (selectedId === id) {
            const newSelectedId = next.length > 0 ? next[0].id : null;
            if (typeof window !== 'undefined') {
                if (newSelectedId) {
                    localStorage.setItem('url_background_selected_id', newSelectedId);
                } else {
                    localStorage.removeItem('url_background_selected_id');
                }
            }
            set({ urlBackgroundList: next, urlBackgroundSelectedId: newSelectedId });
        } else {
            set({ urlBackgroundList: next });
        }
    },
    handleSetUrlBackgroundSelectedId: (id) => {
        if (typeof window !== 'undefined') {
            if (id) {
                localStorage.setItem('url_background_selected_id', id);
            } else {
                localStorage.removeItem('url_background_selected_id');
            }
        }
        set({ urlBackgroundSelectedId: id });
    },
    handleSetUrlBackgroundList: (items) => {
        const next = sanitizeUrlBackgroundList(items);
        const selectedId = get().urlBackgroundSelectedId;
        const nextSelectedId = selectedId && next.some(item => item.id === selectedId) ? selectedId : null;
        if (typeof window !== 'undefined') {
            localStorage.setItem('url_background_list', JSON.stringify(next));
            if (nextSelectedId) {
                localStorage.setItem('url_background_selected_id', nextSelectedId);
            } else {
                localStorage.removeItem('url_background_selected_id');
            }
        }
        set({ urlBackgroundList: next, urlBackgroundSelectedId: nextSelectedId });
    },
    handleSetVisualizerFrameRate: (frameRate) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(VISUALIZER_FRAME_RATE_STORAGE_KEY, String(frameRate));
        }
        setGlobalVisualizerFrameRate(frameRate);
        set({ visualizerFrameRate: frameRate });
    },
    setDaylightPreference: (enabled) => {
        setStoredBoolean('default_theme_daylight', enabled);
        set({ isDaylight: enabled });
        if (typeof window !== 'undefined' && window.electron?.setNativeTheme) {
            void window.electron.setNativeTheme(enabled ? 'light' : 'dark');
        }
    },
    handleSetVisualizerMode: (mode) => {
        const entry = getVisualizerRegistryEntry(mode);
        if (typeof window !== 'undefined') {
            localStorage.setItem('visualizer_mode', mode);
        }
        set({ visualizerMode: mode });
        notify(get, {
            type: 'info',
            text: `已切换到${entry.labelFallback}歌词`,
        });
    },
    handleSetClassicTuning: (patch) => {
        const prev = get().classicTuning;
        const next = {
            enableWordRotation: patch.enableWordRotation ?? prev.enableWordRotation,
            breathingFloatMultiplier: clampClassicBreathingFloatMultiplier(
                patch.breathingFloatMultiplier ?? prev.breathingFloatMultiplier,
                prev.breathingFloatMultiplier,
            ),
            useLegacyLayout: patch.useLegacyLayout ?? prev.useLegacyLayout,
            wordSpacing: clampClassicWordSpacing(
                patch.wordSpacing ?? prev.wordSpacing,
                prev.wordSpacing ?? DEFAULT_CLASSIC_TUNING.wordSpacing!,
            ),
        };
        if (typeof window !== 'undefined') {
            localStorage.setItem('classic_tuning', JSON.stringify(next));
        }
        set({ classicTuning: next });
    },
    handleResetClassicTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('classic_tuning', JSON.stringify(DEFAULT_CLASSIC_TUNING));
        }
        set({ classicTuning: DEFAULT_CLASSIC_TUNING });
        notify(get, { type: 'info', text: '流光参数已重置' });
    },
    handleSetCadenzaTuning: (patch) => {
        const next = { ...get().cadenzaTuning, ...patch, beamIntensity: 0 };
        if (typeof window !== 'undefined') {
            localStorage.setItem('cadenza_tuning', JSON.stringify(next));
        }
        set({ cadenzaTuning: next });
    },
    handleResetCadenzaTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('cadenza_tuning', JSON.stringify(DEFAULT_CADENZA_TUNING));
        }
        set({ cadenzaTuning: DEFAULT_CADENZA_TUNING });
        notify(get, { type: 'info', text: '心象参数已重置' });
    },
    handleSetPartitaTuning: (patch) => {
        const prev = get().partitaTuning;
        const rawMin = clampPartitaStagger(patch.staggerMin ?? prev.staggerMin, prev.staggerMin);
        const rawMax = clampPartitaStagger(patch.staggerMax ?? prev.staggerMax, prev.staggerMax);
        const next = {
            showGuideLines: patch.showGuideLines ?? prev.showGuideLines,
            useSemanticLayout: patch.useSemanticLayout ?? prev.useSemanticLayout,
            staggerMin: Math.min(rawMin, rawMax),
            staggerMax: Math.max(rawMin, rawMax),
        };
        if (typeof window !== 'undefined') {
            localStorage.setItem('partita_tuning', JSON.stringify(next));
        }
        set({ partitaTuning: next });
    },
    handleResetPartitaTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('partita_tuning', JSON.stringify(DEFAULT_PARTITA_TUNING));
        }
        set({ partitaTuning: DEFAULT_PARTITA_TUNING });
        notify(get, { type: 'info', text: '云阶参数已重置' });
    },
    handleSetFumeTuning: (patch) => {
        const prev = get().fumeTuning;
        const next = {
            hidePrintSymbols: patch.hidePrintSymbols ?? prev.hidePrintSymbols,
            disableGeometricBackground: patch.disableGeometricBackground ?? prev.disableGeometricBackground,
            backgroundObjectOpacity: clampFumeBackgroundObjectOpacity(
                patch.backgroundObjectOpacity ?? prev.backgroundObjectOpacity,
                prev.backgroundObjectOpacity,
            ),
            textHoldRatio: clampFumeTextHoldRatio(patch.textHoldRatio ?? prev.textHoldRatio, prev.textHoldRatio),
            cameraTrackingMode: resolveFumeCameraTrackingMode(patch.cameraTrackingMode ?? prev.cameraTrackingMode),
            cameraSpeed: clampFumeCameraSpeed(patch.cameraSpeed ?? prev.cameraSpeed, prev.cameraSpeed),
            glowIntensity: clampFumeGlowIntensity(patch.glowIntensity ?? prev.glowIntensity, prev.glowIntensity),
            heroScale: clampFumeHeroScale(patch.heroScale ?? prev.heroScale, prev.heroScale),
        };
        if (typeof window !== 'undefined') {
            localStorage.setItem('fume_tuning', JSON.stringify(next));
        }
        set({ fumeTuning: next });
    },
    handleResetFumeTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('fume_tuning', JSON.stringify(DEFAULT_FUME_TUNING));
        }
        set({ fumeTuning: DEFAULT_FUME_TUNING });
        notify(get, { type: 'info', text: '浮名参数已重置' });
    },
    handleSetCladdaghTuning: (patch) => {
        const prev = get().claddaghTuning;
        const next = {
            focusScaleRatio: clampCladdaghFocusScaleRatio(patch.focusScaleRatio ?? prev.focusScaleRatio, prev.focusScaleRatio),
            radiusScale: clampCladdaghRadiusScale(patch.radiusScale ?? prev.radiusScale, prev.radiusScale),
            ellipseTiltDeg: clampCladdaghEllipseTiltDeg(patch.ellipseTiltDeg ?? prev.ellipseTiltDeg, prev.ellipseTiltDeg),
            showAxisLine: patch.showAxisLine ?? prev.showAxisLine,
            letterSpacingOffset: clampCladdaghLetterSpacingOffset(patch.letterSpacingOffset ?? prev.letterSpacingOffset, prev.letterSpacingOffset),
        };
        if (typeof window !== 'undefined') {
            localStorage.setItem('claddagh_tuning', JSON.stringify(next));
        }
        set({ claddaghTuning: next });
    },
    handleResetCladdaghTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('claddagh_tuning', JSON.stringify(DEFAULT_CLADDAGH_TUNING));
        }
        set({ claddaghTuning: DEFAULT_CLADDAGH_TUNING });
        notify(get, { type: 'info', text: '回环参数已重置' });
    },
    handleSetCappellaTuning: (patch) => {
        const requestedCustomWithoutPack = patch.emojiPackSource === 'custom' && get().storedCappellaEmojiPack.length === 0;
        if (requestedCustomWithoutPack) {
            notify(get, { type: 'info', text: '请先上传自定义表情包' });
        }

        const prev = get().cappellaTuning;
        const next = {
            showEmoMessages: patch.showEmoMessages ?? prev.showEmoMessages,
            emojiPackSource: patch.emojiPackSource === 'custom' && get().storedCappellaEmojiPack.length === 0
                ? 'builtin' as const
                : (patch.emojiPackSource ?? prev.emojiPackSource),
            avatarSource: resolveCappellaAvatarSource(patch.avatarSource ?? prev.avatarSource),
        };
        if (typeof window !== 'undefined') {
            localStorage.setItem('cappella_tuning', JSON.stringify(next));
        }
        set({ cappellaTuning: next });
    },
    handleResetCappellaTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('cappella_tuning', JSON.stringify(DEFAULT_CAPPELLA_TUNING));
        }
        set({ cappellaTuning: DEFAULT_CAPPELLA_TUNING });
        notify(get, { type: 'info', text: '群唱参数已重置' });
    },
    handleSetTiltTuning: (patch) => {
        const prev = get().tiltTuning;
        const next = {
            splitProbability: Math.min(1, Math.max(0, patch.splitProbability ?? prev.splitProbability)),
            tiltStyleProbability: Math.min(1, Math.max(0, patch.tiltStyleProbability ?? prev.tiltStyleProbability)),
            colorScheme: patch.colorScheme ?? prev.colorScheme,
        };
        if (typeof window !== 'undefined') {
            localStorage.setItem('tilt_tuning', JSON.stringify(next));
        }
        set({ tiltTuning: next });
    },
    handleResetTiltTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('tilt_tuning', JSON.stringify(DEFAULT_TILT_TUNING));
        }
        set({ tiltTuning: DEFAULT_TILT_TUNING });
        notify(get, { type: 'info', text: '倾诉参数已重置' });
    },
    handleSetMonetBackgroundTuning: (patch) => {
        const prev = get().monetBackgroundTuning;
        const next = resolveStoredMonetBackgroundTuning({
            ...prev,
            ...patch,
        });
        if (typeof window !== 'undefined') {
            localStorage.setItem('monet_background_tuning', JSON.stringify(next));
        }
        set({ monetBackgroundTuning: next });
    },
    handleResetMonetBackgroundTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('monet_background_tuning', JSON.stringify(DEFAULT_MONET_BACKGROUND_TUNING));
        }
        set({ monetBackgroundTuning: DEFAULT_MONET_BACKGROUND_TUNING });
        notify(get, { type: 'info', text: '莫奈背景参数已重置' });
    },
    handleSetMonetTuning: (patch) => {
        const prev = get().monetTuning;
        const next = resolveStoredMonetTuning({
            ...prev,
            ...patch,
        });
        if (typeof window !== 'undefined') {
            localStorage.setItem('monet_tuning', JSON.stringify(next));
        }
        set({ monetTuning: next });
    },
    handleResetMonetTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('monet_tuning', JSON.stringify(DEFAULT_MONET_TUNING));
        }
        set({ monetTuning: DEFAULT_MONET_TUNING });
        notify(get, { type: 'info', text: '莫奈参数已重置' });
    },
    handleUploadMonetBackgroundImage: async (files) => {
        const file = files[0];
        if (!file) {
            return { ok: false, error: '请选择图片文件。' };
        }

        if (!isSupportedMonetBackgroundFile(file)) {
            return { ok: false, error: '仅支持 png、jpg、jpeg、gif、webp、svg 图片。' };
        }

        const image = buildStoredMonetBackgroundImage(file);
        await saveMonetBackgroundImage(image);
        set({ storedMonetBackgroundImage: image });
        notify(get, { type: 'success', text: 'Monet 背景图已更新' });
        return { ok: true };
    },
    handleClearMonetBackgroundImage: async () => {
        await clearMonetBackgroundImage();
        const prev = get().monetBackgroundTuning;
        const nextTuning = prev.backgroundSource === 'uploaded-global'
            ? { ...prev, backgroundSource: 'cover-derived' as const }
            : prev;
        if (nextTuning !== prev && typeof window !== 'undefined') {
            localStorage.setItem('monet_background_tuning', JSON.stringify(nextTuning));
        }
        set({
            storedMonetBackgroundImage: null,
            monetBackgroundImage: null,
            monetBackgroundTuning: nextTuning,
        });
        notify(get, { type: 'info', text: 'Monet 背景图已清空' });
    },
    handleUploadMonetPortraitImage: async (files) => {
        const file = files[0];
        if (!file) {
            return { ok: false, error: '请选择图片文件。' };
        }

        if (!isSupportedMonetPortraitFile(file)) {
            return { ok: false, error: '仅支持 png、jpg、jpeg、gif、webp、svg 图片。' };
        }

        const image = buildStoredMonetPortraitImage(file);
        await saveMonetPortraitImage(image);
        set({ storedMonetPortraitImage: image });
        notify(get, { type: 'success', text: 'Monet 肖像图已更新' });
        return { ok: true };
    },
    handleClearMonetPortraitImage: async () => {
        await clearMonetPortraitImage();
        const prev = get().monetTuning;
        const nextTuning = prev.portraitSource === 'custom'
            ? { ...prev, portraitSource: 'cover' as const }
            : prev;
        if (nextTuning !== prev && typeof window !== 'undefined') {
            localStorage.setItem('monet_tuning', JSON.stringify(nextTuning));
        }
        set({
            storedMonetPortraitImage: null,
            monetPortraitImage: null,
            monetTuning: nextTuning,
        });
        notify(get, { type: 'info', text: 'Monet 肖像图已清空' });
    },
    handleImportCustomCappellaEmojiPack: async (files) => {
        if (files.length === 0) {
            return { ok: false, error: '请选择图片文件。' };
        }

        const storedCappellaEmojiPack = get().storedCappellaEmojiPack;

        if (!files.every(isSupportedCappellaEmojiFile)) {
            return { ok: false, error: '仅支持 png、jpg、jpeg、gif、webp、svg 图片。' };
        }

        const appendedPack = buildStoredCappellaEmojiPack(files);
        const storedPack = [...storedCappellaEmojiPack, ...appendedPack];
        await saveCustomCappellaEmojiPack(storedPack);
        set({ storedCappellaEmojiPack: storedPack });
        notify(get, {
            type: 'success',
            text: `已新增 ${appendedPack.length} 张群唱表情包，当前共 ${storedPack.length} 张`,
        });

        return { ok: true };
    },
    handleClearCustomCappellaEmojiPack: async () => {
        await clearCustomCappellaEmojiPack();
        const prev = get().cappellaTuning;
        const nextTuning = prev.emojiPackSource === 'custom'
            ? { ...prev, emojiPackSource: 'builtin' as const }
            : prev;
        if (nextTuning !== prev && typeof window !== 'undefined') {
            localStorage.setItem('cappella_tuning', JSON.stringify(nextTuning));
        }
        set({
            storedCappellaEmojiPack: [],
            cappellaTuning: nextTuning,
        });
        notify(get, { type: 'info', text: '自定义群唱表情包已清空' });
    },
    handleImportCustomCappellaAvatar: async (files) => {
        if (files.length === 0) {
            return { ok: false, error: '请选择图片文件。' };
        }

        const storedCappellaAvatarPack = get().storedCappellaAvatarPack;

        if (!files.every(isSupportedCappellaAvatarFile)) {
            return { ok: false, error: '仅支持 png、jpg、jpeg、gif、webp、svg 图片。' };
        }

        const builtPack = buildStoredCappellaAvatar(files);
        const storedPack = [...storedCappellaAvatarPack, ...builtPack];
        await saveCustomCappellaAvatar(storedPack);
        set({ storedCappellaAvatarPack: storedPack });
        notify(get, {
            type: 'success',
            text: `已新增 ${builtPack.length} 张自定义头像，当前共 ${storedPack.length} 张`,
        });

        return { ok: true };
    },
    handleClearCustomCappellaAvatar: async () => {
        await clearCustomCappellaAvatar();
        const prev = get().cappellaTuning;
        const nextTuning = prev.avatarSource === 'custom'
            ? { ...prev, avatarSource: 'builtin' as const }
            : prev;
        if (nextTuning !== prev && typeof window !== 'undefined') {
            localStorage.setItem('cappella_tuning', JSON.stringify(nextTuning));
        }
        set({
            storedCappellaAvatarPack: [],
            cappellaTuning: nextTuning,
        });
        notify(get, { type: 'info', text: '自定义头像已清空' });
    },
    handleSetLyricsFontStyle: (fontStyle) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('lyrics_font_style', fontStyle);
        }
        set({ lyricsFontStyle: fontStyle });
    },
    handleSetLyricsFontScale: (fontScale) => {
        const next = Math.min(1.4, Math.max(0.85, fontScale));
        if (typeof window !== 'undefined') {
            localStorage.setItem('lyrics_font_scale', String(next));
        }
        set({ lyricsFontScale: next });
    },
    handleSetLyricsCustomFont: (font) => {
        if (!font?.family?.trim()) {
            set({ lyricsCustomFont: null });
            if (typeof window !== 'undefined') {
                localStorage.removeItem('lyrics_custom_font');
            }
            void clearUploadedLyricsFont();
            return;
        }

        const next = resolveStoredCustomLyricsFont(font);
        if (!next) {
            set({ lyricsCustomFont: null });
            if (typeof window !== 'undefined') {
                localStorage.removeItem('lyrics_custom_font');
            }
            void clearUploadedLyricsFont();
            return;
        }

        if (next.source !== 'uploaded') {
            void clearUploadedLyricsFont();
        }

        set({ lyricsCustomFont: next });
        if (typeof window !== 'undefined') {
            localStorage.setItem('lyrics_custom_font', JSON.stringify(next));
        }
    },
    handleUploadLyricsCustomFont: async (file) => {
        try {
            const { meta } = await uploadAndRegisterLyricsFont(file);
            set({ lyricsCustomFont: meta });
            if (typeof window !== 'undefined') {
                localStorage.setItem('lyrics_custom_font', JSON.stringify(meta));
            }
            notify(get, {
                type: 'success',
                text: `已启用上传字体：${meta.label || meta.family}`,
            });

            return { ok: true };
        } catch (error) {
            const message = error instanceof Error && error.message
                ? error.message
                : '上传字体失败。';
            notify(get, { type: 'error', text: message });

            return { ok: false, error: message };
        }
    },
    handleSetLyricsFontFallbackFamilies: (families) => {
        const next = normalizeFontFamilyStack(families);
        storeFontFamilyStack(LYRICS_FONT_FALLBACK_FAMILIES_STORAGE_KEY, next);
        set({ lyricsFontFallbackFamilies: next });
    },
    handleSetSubtitleFontInheritsLyrics: (inheritsLyrics) => {
        setStoredBoolean(SUBTITLE_FONT_INHERITS_LYRICS_STORAGE_KEY, inheritsLyrics);
        set({ subtitleFontInheritsLyrics: inheritsLyrics });
    },
    handleSetSubtitleFontStyle: (fontStyle) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(SUBTITLE_FONT_STYLE_STORAGE_KEY, fontStyle);
        }
        set({ subtitleFontStyle: fontStyle });
    },
    handleSetSubtitleFontFamily: (fontFamily) => {
        const next = fontFamily?.trim() || null;
        if (typeof window !== 'undefined') {
            if (next) {
                localStorage.setItem(SUBTITLE_FONT_FAMILY_STORAGE_KEY, next);
            } else {
                localStorage.removeItem(SUBTITLE_FONT_FAMILY_STORAGE_KEY);
            }
        }
        set({ subtitleFontFamily: next });
    },
    handleSetSubtitleFontFallbackFamilies: (families) => {
        const next = normalizeFontFamilyStack(families);
        storeFontFamilyStack(SUBTITLE_FONT_FALLBACK_FAMILIES_STORAGE_KEY, next);
        set({ subtitleFontFallbackFamilies: next });
    },
    handleSetAppLanguagePreference: async (preference) => {
        await applyAppLanguagePreference(preference);
        set({ appLanguagePreference: preference });
        notify(get, {
            type: 'info',
            text: preference === 'system'
                ? '界面语言已切换为跟随系统'
                : `界面语言已切换为 ${preference === 'zh-CN' ? '简体中文' : 'English'}`,
        });
    },
    handleSetLyricFilterPattern: (pattern) => {
        const next = pattern.trim();
        set({ lyricFilterPattern: next });

        if (typeof window === 'undefined') {
            return;
        }

        if (next) {
            localStorage.setItem('lyrics_filter_pattern', next);
        } else {
            localStorage.removeItem('lyrics_filter_pattern');
        }
    },
    handleToggleOpenPanelCloseButton: (enable) => {
        setStoredBoolean('show_open_panel_close_button', enable);
        set({ showOpenPanelCloseButton: enable });
        notify(get, {
            type: 'info',
            text: enable ? '已显示面板关闭按钮' : '已隐藏面板关闭按钮',
        });
    },
    handleToggleNowPlayingStage: (enable) => {
        setStoredBoolean('enable_now_playing_stage', enable);
        set({ enableNowPlayingStage: enable });
        notify(get, {
            type: 'info',
            text: enable ? '舞台模式已启用' : '舞台模式已关闭',
        });
    },
    handleSetQueueAddBehavior: (behavior) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('queue_add_behavior', behavior);
        }
        set({ queueAddBehavior: behavior });
        notify(get, {
            type: 'info',
            text: behavior === 'next' ? '加入队列将插到下一首' : '加入队列将追加到末尾',
        });
    },
    handleSetAudioOutputDeviceId: (deviceId) => {
        set({ audioOutputDeviceId: deviceId });
        if (typeof window === 'undefined') {
            return;
        }

        if (deviceId) {
            localStorage.setItem('audio_output_device_id', deviceId);
        } else {
            localStorage.removeItem('audio_output_device_id');
        }
    },
    handleSetVolume: (val) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('player_volume', String(val));
        }
        set({ volume: val });
    },
    handleToggleMute: () => {
        const next = !get().isMuted;
        setStoredBoolean('player_is_muted', next);
        set({ isMuted: next });
    },
    handleToggleLoopMode: () => {
        const prev = get().loopMode;
        const next = prev === 'off'
            ? 'all'
            : prev === 'all'
                ? 'one'
                : 'off';
        if (typeof window !== 'undefined') {
            localStorage.setItem('player_loop_mode', next);
        }
        set({ loopMode: next });
    },
    handleSetHomeLayoutStyle: (style) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('home_layout_style', style);
        }
        set({ homeLayoutStyle: style });
        notify(get, {
            type: 'info',
            text: style === 'grid' ? '首页布局已切换为万象' : '首页布局已切换为经典',
        });
    },
    handleSetGrid3dCardStyle: (style) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('grid3d_card_style', style);
        }
        set({ grid3dCardStyle: style });
        notify(get, {
            type: 'info',
            text: style === 'image' ? '卡片样式已切换为纯图片封面' : '卡片样式已切换为拍立得卡片',
        });
    },
}));

export const selectSettingsUiSnapshot = (state: SettingsUiState) => ({
    audioQuality: state.audioQuality,
    setAudioQuality: state.setAudioQuality,
    useCoverColorBg: state.useCoverColorBg,
    staticMode: state.staticMode,
    disableHomeDynamicBackground: state.disableHomeDynamicBackground,
    hidePlayerProgressBar: state.hidePlayerProgressBar,
    hidePlayerTranslationSubtitle: state.hidePlayerTranslationSubtitle,
    showSubtitleTranslation: state.showSubtitleTranslation,
    hidePlayerRightPanelButton: state.hidePlayerRightPanelButton,
    transparentPlayerBackground: state.transparentPlayerBackground,
    autoHidePlayerChrome: state.autoHidePlayerChrome,
    disableVisualizerVignette: state.disableVisualizerVignette,
    disableVisualizerGeometricBackground: state.disableVisualizerGeometricBackground,
    minimizeToTray: state.minimizeToTray,
    hideTaskbarIcon: state.hideTaskbarIcon,
    openPlayerOnLaunch: state.openPlayerOnLaunch,
    enableMediaCache: state.enableMediaCache,
    backgroundOpacity: state.backgroundOpacity,
    subtitleOverlayOpacity: state.subtitleOverlayOpacity,
    visualizerOpacity: state.visualizerOpacity,
    visualizerBackgroundMode: state.visualizerBackgroundMode,
    urlBackgroundList: state.urlBackgroundList,
    urlBackgroundSelectedId: state.urlBackgroundSelectedId,
    visualizerFrameRate: state.visualizerFrameRate,
    isDaylight: state.isDaylight,
    lastSeenGuideVersion: state.lastSeenGuideVersion,
    isUserGuideModalOpen: state.isUserGuideModalOpen,
    visualizerMode: state.visualizerMode,
    homeLayoutStyle: state.homeLayoutStyle,
    handleSetHomeLayoutStyle: state.handleSetHomeLayoutStyle,
    grid3dCardStyle: state.grid3dCardStyle,
    handleSetGrid3dCardStyle: state.handleSetGrid3dCardStyle,
    activeGridViewCollection: state.activeGridViewCollection,
    setActiveGridViewCollection: state.setActiveGridViewCollection,
    classicTuning: state.classicTuning,
    cadenzaTuning: state.cadenzaTuning,
    partitaTuning: state.partitaTuning,
    fumeTuning: state.fumeTuning,
    claddaghTuning: state.claddaghTuning,
    cappellaTuning: state.cappellaTuning,
    tiltTuning: state.tiltTuning,
    monetBackgroundTuning: state.monetBackgroundTuning,
    monetTuning: state.monetTuning,
    cappellaCustomEmojiImages: state.cappellaCustomEmojiImages,
    isLoadingCappellaCustomEmojiPack: state.isLoadingCappellaCustomEmojiPack,
    cappellaCustomAvatarImages: state.cappellaCustomAvatarImages,
    isLoadingCappellaCustomAvatarPack: state.isLoadingCappellaCustomAvatarPack,
    monetBackgroundImage: state.monetBackgroundImage,
    isLoadingMonetBackgroundImage: state.isLoadingMonetBackgroundImage,
    monetPortraitImage: state.monetPortraitImage,
    isLoadingMonetPortraitImage: state.isLoadingMonetPortraitImage,
    appLanguagePreference: state.appLanguagePreference,
    lyricsFontStyle: state.lyricsFontStyle,
    lyricsFontScale: state.lyricsFontScale,
    lyricsCustomFontFamily: state.lyricsCustomFont?.family ?? null,
    lyricsCustomFontLabel: state.lyricsCustomFont?.label ?? null,
    lyricsFontFallbackFamilies: state.lyricsFontFallbackFamilies,
    subtitleFontInheritsLyrics: state.subtitleFontInheritsLyrics,
    subtitleFontStyle: state.subtitleFontStyle,
    subtitleFontFamily: state.subtitleFontFamily,
    subtitleFontFallbackFamilies: state.subtitleFontFallbackFamilies,
    lyricFilterPattern: state.lyricFilterPattern,
    lyricFilterPatternError: getLyricFilterError(state.lyricFilterPattern),
    showOpenPanelCloseButton: state.showOpenPanelCloseButton,
    enableNowPlayingStage: state.enableNowPlayingStage,
    queueAddBehavior: state.queueAddBehavior,
    audioOutputDeviceId: state.audioOutputDeviceId,
    loopMode: state.loopMode,
    handleToggleCoverColorBg: state.handleToggleCoverColorBg,
    handleToggleStaticMode: state.handleToggleStaticMode,
    handleToggleDisableHomeDynamicBackground: state.handleToggleDisableHomeDynamicBackground,
    handleToggleHidePlayerProgressBar: state.handleToggleHidePlayerProgressBar,
    handleToggleHidePlayerTranslationSubtitle: state.handleToggleHidePlayerTranslationSubtitle,
    handleToggleShowSubtitleTranslation: state.handleToggleShowSubtitleTranslation,
    handleToggleHidePlayerRightPanelButton: state.handleToggleHidePlayerRightPanelButton,
    handleToggleTransparentPlayerBackground: state.handleToggleTransparentPlayerBackground,
    enablePlayerPageNativeBlur: state.enablePlayerPageNativeBlur,
    handleTogglePlayerPageNativeBlur: state.handleTogglePlayerPageNativeBlur,
    handleToggleAutoHidePlayerChrome: state.handleToggleAutoHidePlayerChrome,
    handleToggleDisableVisualizerVignette: state.handleToggleDisableVisualizerVignette,
    handleToggleDisableVisualizerGeometricBackground: state.handleToggleDisableVisualizerGeometricBackground,
    handleToggleMinimizeToTray: state.handleToggleMinimizeToTray,
    handleToggleHideTaskbarIcon: state.handleToggleHideTaskbarIcon,
    handleToggleOpenPlayerOnLaunch: state.handleToggleOpenPlayerOnLaunch,
    handleToggleMediaCache: state.handleToggleMediaCache,
    handleSetBackgroundOpacity: state.handleSetBackgroundOpacity,
    handleSetSubtitleOverlayOpacity: state.handleSetSubtitleOverlayOpacity,
    handleSetVisualizerOpacity: state.handleSetVisualizerOpacity,
    handleSetVisualizerBackgroundMode: state.handleSetVisualizerBackgroundMode,
    handleResetVisualizerBackgroundMode: state.handleResetVisualizerBackgroundMode,
    handleAddUrlBackgroundItem: state.handleAddUrlBackgroundItem,
    handleUpdateUrlBackgroundItem: state.handleUpdateUrlBackgroundItem,
    handleDeleteUrlBackgroundItem: state.handleDeleteUrlBackgroundItem,
    handleSetUrlBackgroundSelectedId: state.handleSetUrlBackgroundSelectedId,
    handleSetUrlBackgroundList: state.handleSetUrlBackgroundList,
    handleSetVisualizerFrameRate: state.handleSetVisualizerFrameRate,
    setDaylightPreference: state.setDaylightPreference,
    setLastSeenGuideVersion: state.setLastSeenGuideVersion,
    setIsUserGuideModalOpen: state.setIsUserGuideModalOpen,
    handleSetVisualizerMode: state.handleSetVisualizerMode,
    handleSetClassicTuning: state.handleSetClassicTuning,
    handleResetClassicTuning: state.handleResetClassicTuning,
    handleSetCadenzaTuning: state.handleSetCadenzaTuning,
    handleResetCadenzaTuning: state.handleResetCadenzaTuning,
    handleSetPartitaTuning: state.handleSetPartitaTuning,
    handleResetPartitaTuning: state.handleResetPartitaTuning,
    handleSetFumeTuning: state.handleSetFumeTuning,
    handleResetFumeTuning: state.handleResetFumeTuning,
    handleSetCladdaghTuning: state.handleSetCladdaghTuning,
    handleResetCladdaghTuning: state.handleResetCladdaghTuning,
    handleSetCappellaTuning: state.handleSetCappellaTuning,
    handleResetCappellaTuning: state.handleResetCappellaTuning,
    handleSetTiltTuning: state.handleSetTiltTuning,
    handleResetTiltTuning: state.handleResetTiltTuning,
    handleSetMonetBackgroundTuning: state.handleSetMonetBackgroundTuning,
    handleResetMonetBackgroundTuning: state.handleResetMonetBackgroundTuning,
    handleSetMonetTuning: state.handleSetMonetTuning,
    handleResetMonetTuning: state.handleResetMonetTuning,
    handleUploadMonetBackgroundImage: state.handleUploadMonetBackgroundImage,
    handleClearMonetBackgroundImage: state.handleClearMonetBackgroundImage,
    handleUploadMonetPortraitImage: state.handleUploadMonetPortraitImage,
    handleClearMonetPortraitImage: state.handleClearMonetPortraitImage,
    handleImportCustomCappellaEmojiPack: state.handleImportCustomCappellaEmojiPack,
    handleClearCustomCappellaEmojiPack: state.handleClearCustomCappellaEmojiPack,
    handleImportCustomCappellaAvatar: state.handleImportCustomCappellaAvatar,
    handleClearCustomCappellaAvatar: state.handleClearCustomCappellaAvatar,
    handleSetLyricsFontStyle: state.handleSetLyricsFontStyle,
    handleSetLyricsFontScale: state.handleSetLyricsFontScale,
    handleSetLyricsCustomFont: state.handleSetLyricsCustomFont,
    handleUploadLyricsCustomFont: state.handleUploadLyricsCustomFont,
    handleSetLyricsFontFallbackFamilies: state.handleSetLyricsFontFallbackFamilies,
    handleSetSubtitleFontInheritsLyrics: state.handleSetSubtitleFontInheritsLyrics,
    handleSetSubtitleFontStyle: state.handleSetSubtitleFontStyle,
    handleSetSubtitleFontFamily: state.handleSetSubtitleFontFamily,
    handleSetSubtitleFontFallbackFamilies: state.handleSetSubtitleFontFallbackFamilies,
    handleSetAppLanguagePreference: state.handleSetAppLanguagePreference,
    handleSetLyricFilterPattern: state.handleSetLyricFilterPattern,
    handleToggleOpenPanelCloseButton: state.handleToggleOpenPanelCloseButton,
    handleToggleNowPlayingStage: state.handleToggleNowPlayingStage,
    handleSetQueueAddBehavior: state.handleSetQueueAddBehavior,
    handleSetAudioOutputDeviceId: state.handleSetAudioOutputDeviceId,
    volume: state.volume,
    isMuted: state.isMuted,
    handleSetVolume: state.handleSetVolume,
    handleToggleMute: state.handleToggleMute,
    handleToggleLoopMode: state.handleToggleLoopMode,
});

if (typeof window !== 'undefined' && window.electron?.setNativeTheme) {
    void window.electron.setNativeTheme(useSettingsUiStore.getState().isDaylight ? 'light' : 'dark');
}
