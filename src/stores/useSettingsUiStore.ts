import { create } from 'zustand';
import type React from 'react';
import { DEFAULT_CADENZA_TUNING, DEFAULT_CAPPELLA_TUNING, DEFAULT_CLASSIC_TUNING, DEFAULT_CLADDAGH_TUNING, DEFAULT_DIORAMA_TUNING, DEFAULT_FUME_TUNING, DEFAULT_LATENT_BACKGROUND_TUNING, DEFAULT_MONET_BACKGROUND_TUNING, DEFAULT_MONET_TUNING, DEFAULT_NOMAND_BACKGROUND_TUNING, DEFAULT_PARTITA_TUNING, DEFAULT_PENDOLO_TUNING, DEFAULT_SONNET_TUNING, DEFAULT_TEMPERA_LAYER_IMAGE, DEFAULT_TEMPERA_TUNING, DEFAULT_TILT_TUNING, DIORAMA_PARTICLE_DENSITY_MAX, DIORAMA_PARTICLE_DENSITY_MIN, DIORAMA_PARTICLE_GLOW_INTENSITY_MAX, DIORAMA_PARTICLE_GLOW_INTENSITY_MIN, DIORAMA_PARTICLE_SIZE_MAX, DIORAMA_PARTICLE_SIZE_MIN, TEMPERA_MAX_LAYER_IMAGES, type CadenzaTuning, type CappellaAvatarImage, type CappellaAvatarSource, type CappellaEmojiImage, type CappellaTuning, type ClassicTuning, type CladdaghTuning, type DioramaTuning, type FumeTuning, type LatentBackgroundColorSource, type LatentBackgroundDisplayMode, type LatentBackgroundTuning, type LocalLyricsPriority, type LyricProviderSource, type MonetBackgroundImage, type MonetBackgroundLayout, type MonetBackgroundSource, type MonetBackgroundTuning, type MonetBackgroundWashColorMode, type MonetPortraitImage, type MonetPortraitSource, type MonetTuning, type NomandBackgroundDitheringType, type NomandBackgroundEffect, type NomandBackgroundSource, type NomandBackgroundTuning, type PartitaTuning, type PendoloTuning, type QueueAddBehavior, type SonnetTuning, type StatusMessage, type StoredCappellaAvatarImage, type StoredCappellaEmojiImage, type StoredCustomLyricsFont, type StoredMonetBackgroundImage, type StoredMonetPortraitImage, type SubtitleContentMode, type TemperaLayerImage, type TemperaTuning, type Theme, type TiltTuning, type UrlBackgroundItem, type VisualizerBackgroundMode, type VisualizerFrameRate, type VisualizerMode } from '../types';
import { DEFAULT_VISUALIZER_MODE, getVisualizerModeLabel, getVisualizerRegistryEntry, hasVisualizerMode } from '../components/visualizer/registry';
import { DEFAULT_VISUALIZER_BACKGROUND_MODE, hasVisualizerBackgroundMode } from '../components/visualizer/backgrounds/registry';
import { resolveDioramaMoteCircumference, resolveDioramaMoteRadial } from '../components/visualizer/diorama/dioramaMoteField';
import { getLyricFilterError } from '../utils/lyrics/filtering';
import { buildStoredCappellaEmojiPack, clearCustomCappellaEmojiPack, isSupportedCappellaEmojiFile, saveCustomCappellaEmojiPack } from '../services/cappellaEmojiPack';
import { buildStoredCappellaAvatar, clearCustomCappellaAvatar, isSupportedCappellaAvatarFile, saveCustomCappellaAvatar } from '../services/cappellaAvatarPack';
import { clearUploadedLyricsFont, uploadAndRegisterLyricsFont } from '../services/customLyricsFont';
import { buildStoredMonetBackgroundImage, clearMonetBackgroundImage, isSupportedMonetBackgroundFile, saveMonetBackgroundImage } from '../services/monetBackgroundImage';
import { buildStoredMonetPortraitImage, clearMonetPortraitImage, isSupportedMonetPortraitFile, saveMonetPortraitImage } from '../services/monetPortraitImage';
import { parseVisualizerFrameRate, setGlobalVisualizerFrameRate, VISUALIZER_FRAME_RATE_STORAGE_KEY } from '../utils/frameRateLimiter';
import { sanitizeUrlBackgroundItem, sanitizeUrlBackgroundList } from '../utils/urlBackground';
import { getLyricProviderPreferenceLabel } from '../utils/lyrics/lyricSourceLabels';
import { migratePreferredLyricSource } from '../utils/lyrics/sourcePriority';
import { applyAppLanguagePreference, readStoredAppLanguagePreference, type AppLanguagePreference } from '../i18n/config';
import { normalizeFontFamilyStack, normalizeFontWeight } from '../utils/fontStacks';
import i18n from '../i18n/config';
import { clampCrossfadeSeconds, CROSSFADE_DEFAULT_SEC } from '../services/automix/crossfadePlanner';
import { DEFAULT_TRANSITION_SETTINGS, isTransitionMode, type TransitionMode } from '../services/automix/transitionStrategy';
import { modelsPresent } from '../services/automix/modelAvailability';
import type { AudioQualityPreference } from '../types/onlineMusic';
import {
    normalizePinnedCommandIds,
    readPinnedCommandIds,
    writePinnedCommandIds,
    type PinnedCommandIds,
} from '../components/command-palette/pinnedCommandPreferences';
import {
    getAudioEqualizerCustomSlotIndex,
    isAudioEqualizerCustomSlotId,
    readStoredAudioEqualizerSettings,
    resolveAudioEqualizerSettings,
    writeStoredAudioEqualizerSettings,
    type AudioEqualizerModeId,
    type AudioEqualizerSettings,
} from '../utils/audioEqualizer';
import { AUDIO_SOUND_PRESETS } from '../utils/audioPresets';

// src/stores/useSettingsUiStore.ts
// Shared settings state and actions used by App, Home, and SettingsModal.

export type StatusSetter = React.Dispatch<React.SetStateAction<StatusMessage | null>>;
export const CACHE_SIZE_KEY = 'folia_cache_size';
export const ENABLE_MEDIA_CACHE_KEY = 'folia_enable_media_cache';
/** What the toggle used to write to, before it was corrected to the prefixed key above. */
export const LEGACY_ENABLE_MEDIA_CACHE_KEY = 'enable_media_cache';
export const MEDIA_CACHE_LIMIT_GB_KEY = 'folia_media_cache_limit_gb';
/** Gigabytes of cached audio to keep. Zero is the listener asking for no ceiling at all. */
export const DEFAULT_MEDIA_CACHE_LIMIT_GB = 5;
const AUTOMIX_ENABLED_KEY = 'folia_automix_enabled';
/** Set only by the reminder's own "don't remind me" button. Absent = still worth asking. */
export const AUTOMIX_MODEL_REMINDER_MUTED_KEY = 'folia_automix_model_reminder_muted';
const TRANSITION_MODE_KEY = 'folia_transition_mode';
const CROSSFADE_MAX_SEC_KEY = 'folia_crossfade_max_sec';
const TRANSITION_PERFORMANCE_KEY = 'folia_transition_performance';
const TRANSITION_ANIMATION_KEY = 'folia_transition_animation';
const LAST_SEEN_GUIDE_VERSION_STORAGE_KEY = 'folia_last_seen_guide_version';

export type AudioQuality = AudioQualityPreference;
export type SettingsModalInitialTab = 'help' | 'options';
export type SettingsSubviewId = 'appearance' | 'general' | 'playback' | 'integration' | 'storage' | 'desktop' | 'lab' | 'visualizer' | 'themePark' | 'lyricFilter' | 'globalLyricOffset';
export type VisualizerSettingsSection = 'common' | 'background' | 'visualizer' | 'subtitle';
export type SettingsModalState = {
    isOpen: boolean;
    initialTab: SettingsModalInitialTab;
    initialSubview?: SettingsSubviewId | null;
    initialVisualizerSection?: VisualizerSettingsSection | null;
};

export const MINIMIZE_TO_TRAY_STORAGE_KEY = 'minimize_to_tray';
export const VOICE_INPUT_PAUSE_STORAGE_KEY = 'voice_input_pause_enabled';
export const PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK_STORAGE_KEY = 'prevent_display_sleep_during_playback';
export const MOD_SYSTEM_ENABLED_STORAGE_KEY = 'mod_system_enabled';
export const SLEEP_TIMER_HOURS_STORAGE_KEY = 'sleep_timer_hours';
export const SLEEP_TIMER_MINUTES_STORAGE_KEY = 'sleep_timer_minutes';
export const GLOBAL_LYRIC_TIMELINE_OFFSET_STORAGE_KEY = 'global_lyric_timeline_offset_ms';
export const HIDE_TASKBAR_ICON_STORAGE_KEY = 'hide_taskbar_icon';
export const REMOTE_CONTROL_SKIP_TASKBAR_STORAGE_KEY = 'remote_control_skip_taskbar';
export const WALLPAPER_MODE_STORAGE_KEY = 'wallpaper_mode';
export const OPEN_PLAYER_ON_LAUNCH_STORAGE_KEY = 'open_player_on_launch';
export const SUBTITLE_OVERLAY_OPACITY_STORAGE_KEY = 'subtitle_overlay_opacity';
export const SUBTITLE_OVERLAY_BACKGROUND_STORAGE_KEY = 'subtitle_overlay_background';
export const SHOW_HARMONY_SUBTITLE_STORAGE_KEY = 'show_harmony_subtitle';
export const HARMONY_SUBTITLE_BACKGROUND_STORAGE_KEY = 'harmony_subtitle_background';
export const SHOW_SUBTITLE_TRANSLATION_STORAGE_KEY = 'show_subtitle_translation';
export const SUBTITLE_CONTENT_MODE_STORAGE_KEY = 'subtitle_content_mode';
export const FOLLOW_SYSTEM_THEME_STORAGE_KEY = 'follow_system_theme';
const LYRICS_FONT_FALLBACK_FAMILIES_STORAGE_KEY = 'lyrics_font_fallback_families';
const LYRICS_FONT_WEIGHT_STORAGE_KEY = 'lyrics_font_weight';
const SUBTITLE_FONT_INHERITS_LYRICS_STORAGE_KEY = 'subtitle_font_inherits_lyrics';
const SUBTITLE_FONT_SCALE_STORAGE_KEY = 'subtitle_font_scale';
const SUBTITLE_FONT_STYLE_STORAGE_KEY = 'subtitle_font_style';
const SUBTITLE_FONT_FAMILY_STORAGE_KEY = 'subtitle_font_family';
const SUBTITLE_FONT_FALLBACK_FAMILIES_STORAGE_KEY = 'subtitle_font_fallback_families';
const SUBTITLE_FONT_WEIGHT_STORAGE_KEY = 'subtitle_font_weight';
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

/**
 * Whether switching transitions on is worth interrupting for.
 *
 * Three ways to answer no, and they are three different reasons rather than one condition:
 *
 * - Not a desktop build. The browser cannot run either model no matter what it downloads, so a
 *   prompt there is an errand that does not exist - which is the same distinction the engine badge
 *   already draws between "a limit" and "something you can go and fix".
 * - The weights are already here. Asked of `modelsPresent()`, which the automix hook refreshes at
 *   startup, so a fresh launch with both files installed answers correctly without opening
 *   Settings first.
 * - The listener said not to ask again. That one is remembered rather than re-derived, because it
 *   is a preference and not a fact about the machine.
 *
 * Either model missing counts: the beat grid is what the crossfade mode reads for its alignment
 * too, so "I only use crossfade" is not a reason to be missing beat_this.
 */
export const shouldRemindAboutModels = (): boolean => {
    if (typeof window === 'undefined') return false;
    if (typeof window.electron?.separateStems !== 'function') return false;
    if (getStoredBoolean(AUTOMIX_MODEL_REMINDER_MUTED_KEY, false)) return false;
    const present = modelsPresent();
    return !present.beat_this || !present.htdemucs;
};

/**
 * Reads the media cache toggle, honouring the key its own setter used to write to.
 *
 * The setter wrote a bare 'enable_media_cache' while startup read the folia-prefixed key, so the
 * setting silently reverted to off on every restart. Anyone who switched it on has their real
 * preference sitting under the legacy key, and simply correcting the setter would throw that
 * away once more - so read it as a fallback and promote it to the canonical key.
 */
export const readStoredEnableMediaCache = (): boolean => {
    if (typeof window === 'undefined') {
        return false;
    }

    const canonical = localStorage.getItem(ENABLE_MEDIA_CACHE_KEY);
    if (canonical !== null) {
        return canonical === 'true';
    }

    const legacy = localStorage.getItem(LEGACY_ENABLE_MEDIA_CACHE_KEY);
    if (legacy === null) {
        return false;
    }

    localStorage.setItem(ENABLE_MEDIA_CACHE_KEY, legacy);
    return legacy === 'true';
};

export const readStoredMediaCacheLimitGb = (): number => {
    if (typeof window === 'undefined') {
        return DEFAULT_MEDIA_CACHE_LIMIT_GB;
    }

    const saved = localStorage.getItem(MEDIA_CACHE_LIMIT_GB_KEY);
    const parsed = saved === null ? NaN : Number(saved);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MEDIA_CACHE_LIMIT_GB;
};

const readStoredTransitionMode = (): TransitionMode => {
    if (typeof window === 'undefined') return DEFAULT_TRANSITION_SETTINGS.mode;
    const saved = localStorage.getItem(TRANSITION_MODE_KEY);
    return isTransitionMode(saved) ? saved : DEFAULT_TRANSITION_SETTINGS.mode;
};

const readStoredCrossfadeMaxSec = (): number => {
    if (typeof window === 'undefined') return CROSSFADE_DEFAULT_SEC;
    const saved = localStorage.getItem(CROSSFADE_MAX_SEC_KEY);
    return saved === null ? CROSSFADE_DEFAULT_SEC : clampCrossfadeSeconds(Number(saved));
};

export const readSystemThemeIsDaylight = (): boolean | null => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return null;
    }

    return window.matchMedia('(prefers-color-scheme: light)').matches;
};

export const readStoredSubtitleContentMode = (): SubtitleContentMode => {
    if (typeof window === 'undefined') {
        return 'translation';
    }
    const saved = localStorage.getItem(SUBTITLE_CONTENT_MODE_STORAGE_KEY);
    if (saved === 'translation' || saved === 'romanization' || saved === 'none') {
        return saved;
    }
    return getStoredBoolean(SHOW_SUBTITLE_TRANSLATION_STORAGE_KEY, true) ? 'translation' : 'none';
};

const getStoredString = (key: string, fallback: string) => {
    if (typeof window === 'undefined') {
        return fallback;
    }

    return localStorage.getItem(key) || fallback;
};

// OBS overlay theme mode for the copied web OBS URL (default 'builtin' — per-song follow):
//   'static'  – bake the current theme into cfg (the original behavior; frozen in OBS).
//   'builtin' – bake no theme; the overlay derives a per-song builtin palette from the cover.
//   'ai'      – like 'builtin', plus the overlay regenerates an AI theme per song (opt-in).
const readStoredWebObsThemeMode = (): 'static' | 'builtin' | 'ai' => {
    if (typeof window === 'undefined') return 'builtin';
    const value = localStorage.getItem('web_obs_theme_mode') || 'builtin';
    return value === 'static' || value === 'ai' ? value : 'builtin';
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

export const resolveStoredAudioQuality = (saved: string | null): AudioQuality => (
    saved === 'standard' || saved === 'lossless' || saved === 'hires' ? saved : 'high'
);

const readStoredAudioQuality = (): AudioQuality => {
    if (typeof window === 'undefined') {
        return 'high';
    }

    const saved = localStorage.getItem('default_audio_quality');
    const quality = resolveStoredAudioQuality(saved);
    if (saved === 'exhigh') {
        localStorage.setItem('default_audio_quality', 'high');
    }
    return quality;
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

// Device-local audio/visual latency compensation (Bluetooth headphones and the like). Deliberately
// NOT part of the synced visual config: the right value belongs to this machine's output path.
export const GLOBAL_LYRIC_TIMELINE_OFFSET_LIMIT_MS = 2000;

export const clampGlobalLyricTimelineOffsetMs = (value: number): number => {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.round(Math.min(GLOBAL_LYRIC_TIMELINE_OFFSET_LIMIT_MS, Math.max(-GLOBAL_LYRIC_TIMELINE_OFFSET_LIMIT_MS, value)));
};

const readStoredGlobalLyricTimelineOffsetMs = (): number => {
    if (typeof window === 'undefined') {
        return 0;
    }

    return clampGlobalLyricTimelineOffsetMs(Number(localStorage.getItem(GLOBAL_LYRIC_TIMELINE_OFFSET_STORAGE_KEY)));
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
                parsed.wordSpacing ?? DEFAULT_CLASSIC_TUNING.wordSpacing ?? 0.7,
                DEFAULT_CLASSIC_TUNING.wordSpacing ?? 0.7,
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

const resolvePendoloNumber = (value: unknown, fallback: number, min: number, max: number) => (
    typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : fallback
);

const readStoredPendoloTuning = (): PendoloTuning => {
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

const readStoredSonnetTuning = (): SonnetTuning => {
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

const clampUnit = (value: unknown, fallback: number) => (
    typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
);

/**
 * Placement records ride in the tuning, so they arrive from localStorage, sync and pasted
 * appearance codes alike. Every field is clamped rather than trusted; a bad scale would put a
 * user's artwork off screen with no way to find it again.
 */
const sanitizeTemperaLayerImages = (value: unknown): TemperaLayerImage[] => {
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

const readStoredTemperaTuning = (): TemperaTuning => {
    if (typeof window === 'undefined') return DEFAULT_TEMPERA_TUNING;
    const saved = localStorage.getItem('tempera_tuning');
    if (!saved) return DEFAULT_TEMPERA_TUNING;
    try {
        const parsed = JSON.parse(saved) as Partial<TemperaTuning>;
        return {
            cameraIntensity: resolvePendoloNumber(parsed.cameraIntensity, DEFAULT_TEMPERA_TUNING.cameraIntensity, 0, 2),
            glyphMotion: resolvePendoloNumber(parsed.glyphMotion, DEFAULT_TEMPERA_TUNING.glyphMotion, 0, 2),
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
        };
    } catch {
        return DEFAULT_TEMPERA_TUNING;
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

const readStoredDioramaTuning = (): DioramaTuning => {
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
    return hasVisualizerBackgroundMode(saved) ? saved : null;
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
    _visualizerMode: VisualizerMode,
): VisualizerBackgroundMode => storedMode ?? DEFAULT_VISUALIZER_BACKGROUND_MODE;

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
    backgroundDriftEnabled: parsed.backgroundDriftEnabled ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftEnabled,
    backgroundDriftStrength: clampUnitInterval(
        parsed.backgroundDriftStrength ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftStrength,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftStrength,
    ),
    backgroundStreaksEnabled: parsed.backgroundStreaksEnabled ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundStreaksEnabled,
});

const resolveNomandBackgroundSource = (value: NomandBackgroundSource | undefined): NomandBackgroundSource => (
    value === 'uploaded-global' ? 'uploaded-global' : DEFAULT_NOMAND_BACKGROUND_TUNING.imageSource
);

const resolveNomandDitheringType = (
    value: unknown,
): NomandBackgroundDitheringType => (
    value === '2x2' || value === '4x4' || value === '8x8'
        ? value
        : DEFAULT_NOMAND_BACKGROUND_TUNING.ditheringType
);

const resolveNomandBackgroundEffect = (value: unknown): NomandBackgroundEffect => (
    value === 'fluted-glass'
        || value === 'paper-texture'
        || value === 'halftone-dots'
        || value === 'lens-distortion'
        || value === 'dithering'
        ? value
        : DEFAULT_NOMAND_BACKGROUND_TUNING.effect
);

const clampNomandEffectValue = (value: unknown, fallback: number, min = 0, max = 1) => (
    Math.min(max, Math.max(min, typeof value === 'number' && Number.isFinite(value) ? value : fallback))
);

type StoredNomandBackgroundTuningInput = Omit<Partial<NomandBackgroundTuning>, 'ditheringType' | 'effect'> & {
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

const readStoredNomandBackgroundTuning = (): NomandBackgroundTuning => {
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

const resolveLatentDisplayMode = (value: unknown): LatentBackgroundDisplayMode => (
    value === 'dithering' || value === 'mesh' || value === 'both'
        ? value
        : DEFAULT_LATENT_BACKGROUND_TUNING.displayMode
);

const resolveLatentColorSource = (value: unknown): LatentBackgroundColorSource => (
    value === 'cover-only' ? 'cover-only' : DEFAULT_LATENT_BACKGROUND_TUNING.colorSource
);

const clampLatentNumber = (value: unknown, fallback: number, min: number, max: number) => (
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

const readStoredLatentBackgroundTuning = (): LatentBackgroundTuning => {
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

const readStoredFontScale = (key: string): number => {
    if (typeof window === 'undefined') {
        return 1;
    }

    const saved = localStorage.getItem(key);
    if (!saved) return 1;

    const parsed = parseFloat(saved);
    if (!Number.isFinite(parsed)) return 1;

    return Math.min(1.4, Math.max(0.85, parsed));
};

const readStoredFontWeight = (key: string): number | null => {
    if (typeof window === 'undefined') return null;

    const saved = localStorage.getItem(key);
    if (saved === null) return null;

    return normalizeFontWeight(Number(saved));
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
    if (saved === 'carousel' || saved === 'desktop') {
        localStorage.setItem('home_layout_style', 'grid');
    }
    return 'grid';
};

const PREFERRED_LYRIC_SOURCE_STORAGE_KEY_V2 = 'preferred_alternative_lyric_source_v2';
export const LOCAL_LYRICS_PRIORITY_STORAGE_KEY = 'local_lyrics_priority';

export const readStoredLocalLyricsPriority = (): LocalLyricsPriority => {
    if (typeof window === 'undefined') return 'local';
    return localStorage.getItem(LOCAL_LYRICS_PRIORITY_STORAGE_KEY) === 'online' ? 'online' : 'local';
};

const readStoredPreferredAlternativeLyricSource = (): LyricProviderSource => {
    if (typeof window === 'undefined') return 'qq';
    const versioned = localStorage.getItem(PREFERRED_LYRIC_SOURCE_STORAGE_KEY_V2);
    const legacy = localStorage.getItem('preferred_alternative_lyric_source');
    const migrated = migratePreferredLyricSource(versioned, legacy);
    if (versioned !== migrated) {
        localStorage.setItem(PREFERRED_LYRIC_SOURCE_STORAGE_KEY_V2, migrated);
    }
    return migrated;
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

const readStoredSleepTimerPart = (key: string, max: number): number => {
    if (typeof window === 'undefined') {
        return 0;
    }

    const saved = Number(localStorage.getItem(key));
    return Number.isInteger(saved) && saved >= 0 && saved <= max ? saved : 0;
};

const readStoredSleepTimerHours = () => readStoredSleepTimerPart(SLEEP_TIMER_HOURS_STORAGE_KEY, 999);

const readStoredSleepTimerMinutes = () => readStoredSleepTimerPart(SLEEP_TIMER_MINUTES_STORAGE_KEY, 59);

export type SettingsUiState = {
    statusSetter: StatusSetter | null;
    audioQuality: AudioQuality;
    useCoverColorBg: boolean;
    staticMode: boolean;
    disableHomeDynamicBackground: boolean;
    autoUseBestLyric: boolean;
    preferredAlternativeLyricSource: LyricProviderSource;
    localLyricsPriority: LocalLyricsPriority;
    hidePlayerProgressBar: boolean;
    hidePlayerTranslationSubtitle: boolean;
    showSubtitleTranslation: boolean;
    subtitleContentMode: SubtitleContentMode;
    hidePlayerRightPanelButton: boolean;
    alwaysShowPlayerBackButton: boolean;
    alwaysShowTrackSwitchButtons: boolean;
    alwaysShowMainWindowTitlebar: boolean;
    transparentPlayerBackground: boolean;
    enablePlayerPageNativeBlur: boolean;
    autoHidePlayerChrome: boolean;
    disableVisualizerVignette: boolean;
    disableVisualizerGeometricBackground: boolean;
    minimizeToTray: boolean;
    voiceInputPauseEnabled: boolean;
    preventDisplaySleepDuringPlayback: boolean;
    /**
     * Master switch for the experimental mod system. Off by default: while it is
     * off the main process loads no mod at all and the mod commands stay out of
     * the palette, so an unfinished apiVersion 1 is opt-in rather than ambient.
     */
    modSystemEnabled: boolean;
    sleepTimerEnabled: boolean;
    sleepTimerHours: number;
    sleepTimerMinutes: number;
    sleepTimerDeadlineMs: number | null;
    sleepTimerActivationId: number;
    hideTaskbarIcon: boolean;
    hideRemoteControlTaskbarIcon: boolean;
    wallpaperMode: boolean;
    openPlayerOnLaunch: boolean;
    enableMediaCache: boolean;
    /** Gigabytes of cached audio to keep before the oldest is dropped. Zero means no ceiling. */
    mediaCacheLimitGb: number;
    automixEnabled: boolean;
    /** Whether the "you have no weights yet" prompt is showing. See `handleToggleAutomix`. */
    isAutomixModelReminderOpen: boolean;
    /** Which strategy plans a song change once blending is on. */
    transitionMode: TransitionMode;
    /** Seconds. The crossfade mode's ceiling; automix computes its own and ignores this. */
    crossfadeMaxSec: number;
    /** Let the mix be heard. Only reachable with automix on, and only where stems exist. */
    transitionPerformance: boolean;
    /** Draw the mix while it runs. Automix only, and only for blends long enough to watch. */
    transitionAnimation: boolean;
    backgroundOpacity: number;
    subtitleOverlayOpacity: number;
    subtitleOverlayBackground: boolean;
    showHarmonySubtitle: boolean;
    harmonySubtitleBackground: boolean;
    visualizerOpacity: number;
    visualizerBackgroundMode: VisualizerBackgroundMode | null;
    urlBackgroundList: UrlBackgroundItem[];
    urlBackgroundSelectedId: string | null;
    visualizerFrameRate: VisualizerFrameRate;
    globalLyricTimelineOffsetMs: number;
    isDaylight: boolean;
    followSystemTheme: boolean;
    visualizerMode: VisualizerMode;
    randomVisualizerModePerSong: boolean;
    classicTuning: ClassicTuning;
    cadenzaTuning: CadenzaTuning;
    partitaTuning: PartitaTuning;
    fumeTuning: FumeTuning;
    claddaghTuning: CladdaghTuning;
    cappellaTuning: CappellaTuning;
    tiltTuning: TiltTuning;
    dioramaTuning: DioramaTuning;
    monetBackgroundTuning: MonetBackgroundTuning;
    nomandBackgroundTuning: NomandBackgroundTuning;
    latentBackgroundTuning: LatentBackgroundTuning;
    monetTuning: MonetTuning;
    pendoloTuning: PendoloTuning;
    sonnetTuning: SonnetTuning;
    temperaTuning: TemperaTuning;
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
    lyricsFontWeight: number | null;
    lyricsCustomFont: StoredCustomLyricsFont | null;
    lyricsFontFallbackFamilies: string[];
    subtitleFontInheritsLyrics: boolean;
    subtitleFontScale: number;
    subtitleFontStyle: Theme['fontStyle'];
    subtitleFontWeight: number | null;
    subtitleFontFamily: string | null;
    subtitleFontFallbackFamilies: string[];
    lyricFilterPattern: string;
    showOpenPanelCloseButton: boolean;
    enableNowPlayingStage: boolean;
    // PlayerCap lyrics source (third stage source) config. enablePlayerCapStage is Web-only (Electron uses stageStatus.source).
    enablePlayerCapStage: boolean;
    playerCapHost: string;
    playerCapPlayer: string;
    playerCapTimeBasis: 'timestamp' | 'play_time';
    playerCapSticky: boolean;
    // Theme mode baked into the copied web OBS URL (static burn-in vs per-song dynamic; see readStoredWebObsThemeMode).
    webObsThemeMode: 'static' | 'builtin' | 'ai';
    queueAddBehavior: QueueAddBehavior;
    audioOutputDeviceId: string;
    audioEqualizerSettings: AudioEqualizerSettings;
    isAudioEqualizerOpen: boolean;
    volume: number;
    isMuted: boolean;
    loopMode: 'off' | 'all' | 'one';
    homeLayoutStyle: 'carousel' | 'grid';
    grid3dCardStyle: 'image' | 'card';
    showHomeTabPlaylist: boolean;
    showHomeTabRadio: boolean;
    showHomeTabAlbums: boolean;
    showHomeTabLocal: boolean;
    pinnedCommandIds: PinnedCommandIds;
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
    setDesktopPreferenceSnapshot: (settings: { MINIMIZE_TO_TRAY?: unknown; HIDE_TASKBAR_ICON?: unknown; REMOTE_CONTROL_SKIP_TASKBAR?: unknown; VOICE_INPUT_PAUSE_ENABLED?: unknown; PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK?: unknown; MOD_SYSTEM_ENABLED?: unknown; wallpaper_mode?: unknown; }) => void;
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
    openSettings: (initialTab?: SettingsModalInitialTab, initialSubview?: SettingsSubviewId | null, initialVisualizerSection?: VisualizerSettingsSection | null) => void;
    closeSettings: () => void;
    handleToggleCoverColorBg: (enable: boolean) => void;
    handleToggleStaticMode: (enable: boolean) => void;
    handleToggleDisableHomeDynamicBackground: (disable: boolean) => void;
    handleToggleAutoUseBestLyric: (enable: boolean) => void;
    handleSetPreferredAlternativeLyricSource: (source: LyricProviderSource) => void;
    handleSetLocalLyricsPriority: (priority: LocalLyricsPriority) => void;
    handleToggleHidePlayerProgressBar: (enable: boolean) => void;
    handleToggleHidePlayerTranslationSubtitle: (enable: boolean) => void;
    handleToggleShowSubtitleTranslation: (enable: boolean) => void;
    handleSetSubtitleContentMode: (mode: SubtitleContentMode) => void;
    handleToggleHidePlayerRightPanelButton: (enable: boolean) => void;
    handleToggleAlwaysShowPlayerBackButton: (enable: boolean) => void;
    handleToggleAlwaysShowTrackSwitchButtons: (enable: boolean) => void;
    handleToggleAlwaysShowMainWindowTitlebar: (enable: boolean) => void;
    handleToggleTransparentPlayerBackground: (enable: boolean) => void;
    handleWallpaperTransparentRefused: () => void;
    handleToggleAutoHidePlayerChrome: (enable: boolean) => void;
    handleToggleDisableVisualizerVignette: (disable: boolean) => void;
    handleToggleDisableVisualizerGeometricBackground: (disable: boolean) => void;
    handleToggleMinimizeToTray: (enable: boolean) => void;
    handleToggleVoiceInputPause: (enable: boolean) => void;
    handleToggleModSystem: (enable: boolean) => void;
    handleTogglePreventDisplaySleepDuringPlayback: (enable: boolean) => void;
    handleToggleSleepTimer: (enable: boolean) => void;
    handleSetSleepTimerHours: (hours: number) => void;
    handleSetSleepTimerMinutes: (minutes: number) => void;
    handleToggleHideTaskbarIcon: (enable: boolean) => void;
    handleToggleHideRemoteControlTaskbarIcon: (enable: boolean) => void;
    handleToggleWallpaperMode: (enable: boolean) => void;
    handleToggleOpenPlayerOnLaunch: (enable: boolean) => void;
    handleToggleMediaCache: (enable: boolean) => void;
    handleSetMediaCacheLimitGb: (gigabytes: number) => void;
    handleToggleAutomix: (enable: boolean) => void;
    /** Closes the model prompt. `mute` is the listener choosing never to see it again. */
    dismissAutomixModelReminder: (mute: boolean) => void;
    handleSetTransitionMode: (mode: TransitionMode) => void;
    handleSetCrossfadeMaxSec: (seconds: number) => void;
    handleToggleTransitionPerformance: (enable: boolean) => void;
    handleToggleTransitionAnimation: (enable: boolean) => void;
    handleSetBackgroundOpacity: (opacity: number) => void;
    handleSetSubtitleOverlayOpacity: (opacity: number) => void;
    handleToggleSubtitleOverlayBackground: (enabled: boolean) => void;
    handleToggleShowHarmonySubtitle: (enabled: boolean) => void;
    handleToggleHarmonySubtitleBackground: (enabled: boolean) => void;
    handleSetVisualizerOpacity: (opacity: number) => void;
    handleSetVisualizerBackgroundMode: (mode: VisualizerBackgroundMode) => void;
    handleResetVisualizerBackgroundMode: () => void;
    handleAddUrlBackgroundItem: (item: UrlBackgroundItem) => void;
    handleUpdateUrlBackgroundItem: (id: string, patch: Partial<Omit<UrlBackgroundItem, 'id'>>) => void;
    handleDeleteUrlBackgroundItem: (id: string) => void;
    handleSetUrlBackgroundSelectedId: (id: string | null) => void;
    handleSetUrlBackgroundList: (items: UrlBackgroundItem[]) => void;
    handleSetVisualizerFrameRate: (frameRate: VisualizerFrameRate) => void;
    handleSetGlobalLyricTimelineOffsetMs: (offsetMs: number) => void;
    setDaylightPreference: (isDaylight: boolean) => void;
    setDaylightPreferenceFromSystem: (isDaylight: boolean) => void;
    setFollowSystemTheme: (enabled: boolean) => void;
    handleSetVisualizerMode: (mode: VisualizerMode, options?: { notify?: boolean }) => void;
    handleToggleRandomVisualizerModePerSong: (enable: boolean) => void;
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
    handleSetDioramaTuning: (patch: Partial<DioramaTuning>) => void;
    handleResetDioramaTuning: () => void;
    handleSetMonetBackgroundTuning: (patch: Partial<MonetBackgroundTuning>) => void;
    handleResetMonetBackgroundTuning: () => void;
    handleSetNomandBackgroundTuning: (patch: Partial<NomandBackgroundTuning>) => void;
    handleResetNomandBackgroundTuning: () => void;
    handleSetLatentBackgroundTuning: (patch: Partial<LatentBackgroundTuning>) => void;
    handleResetLatentBackgroundTuning: () => void;
    handleSetMonetTuning: (patch: Partial<MonetTuning>) => void;
    handleResetMonetTuning: () => void;
    handleSetPendoloTuning: (patch: Partial<PendoloTuning>) => void;
    handleResetPendoloTuning: () => void;
    handleSetSonnetTuning: (patch: Partial<SonnetTuning>) => void;
    handleResetSonnetTuning: () => void;
    handleSetTemperaTuning: (patch: Partial<TemperaTuning>) => void;
    handleResetTemperaTuning: () => void;
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
    handleSetLyricsFontWeight: (fontWeight: number | null) => void;
    handleSetLyricsCustomFont: (font: StoredCustomLyricsFont | null) => void;
    handleUploadLyricsCustomFont: (file: File) => Promise<{ ok: boolean; error?: string; }>;
    handleSetLyricsFontFallbackFamilies: (families: string[]) => void;
    handleSetSubtitleFontInheritsLyrics: (inheritsLyrics: boolean) => void;
    handleSetSubtitleFontScale: (fontScale: number) => void;
    handleSetSubtitleFontStyle: (fontStyle: Theme['fontStyle']) => void;
    handleSetSubtitleFontWeight: (fontWeight: number | null) => void;
    handleSetSubtitleFontFamily: (fontFamily: string | null) => void;
    handleSetSubtitleFontFallbackFamilies: (families: string[]) => void;
    handleSetAppLanguagePreference: (preference: AppLanguagePreference) => Promise<void>;
    handleSetLyricFilterPattern: (pattern: string) => void;
    handleToggleOpenPanelCloseButton: (enable: boolean) => void;
    handleToggleNowPlayingStage: (enable: boolean) => void;
    // Web stage-source tri-state mutually-exclusive selection: null disables, else one of 'now-playing' or 'playercap'. Electron uses stageStatus.source.
    setWebStageSource: (source: 'now-playing' | 'playercap' | null) => void;
    setPlayerCapHost: (host: string) => void;
    setPlayerCapPlayer: (player: string) => void;
    setPlayerCapTimeBasis: (basis: 'timestamp' | 'play_time') => void;
    setPlayerCapSticky: (sticky: boolean) => void;
    setWebObsThemeMode: (mode: 'static' | 'builtin' | 'ai') => void;
    handleSetQueueAddBehavior: (behavior: QueueAddBehavior) => void;
    handleSetAudioOutputDeviceId: (deviceId: string) => void;
    handleSetAudioEqualizerSettings: (settings: AudioEqualizerSettings) => void;
    handleApplyAudioSoundPreset: (modeId: AudioEqualizerModeId) => void;
    openAudioEqualizer: () => void;
    closeAudioEqualizer: () => void;
    handleSetVolume: (val: number) => void;
    handleToggleMute: () => void;
    handleToggleLoopMode: () => void;
    handleSetHomeLayoutStyle: (style: 'carousel' | 'grid') => void;
    handleSetGrid3dCardStyle: (style: 'image' | 'card') => void;
    handleToggleHomeTabPlaylist: (show: boolean) => void;
    handleToggleHomeTabRadio: (show: boolean) => void;
    handleToggleHomeTabAlbums: (show: boolean) => void;
    handleToggleHomeTabLocal: (show: boolean) => void;
    setPinnedCommandId: (slotIndex: number, commandId: string | null) => void;
};

const notify = (get: () => SettingsUiState, message: StatusMessage) => {
    get().statusSetter?.(message);
};

const initialFollowSystemTheme = getStoredBoolean(FOLLOW_SYSTEM_THEME_STORAGE_KEY, false);
const initialStoredDaylight = getStoredBoolean('default_theme_daylight', false);
const initialDaylight = initialFollowSystemTheme
    ? (readSystemThemeIsDaylight() ?? initialStoredDaylight)
    : initialStoredDaylight;

export const useSettingsUiStore = create<SettingsUiState>((set, get) => ({
    statusSetter: null,
    audioQuality: readStoredAudioQuality(),
    useCoverColorBg: getStoredBoolean('use_cover_color_bg', false),
    staticMode: getStoredBoolean('static_mode', false),
    disableHomeDynamicBackground: readStoredDisableHomeDynamicBackground(),
    autoUseBestLyric: getStoredBoolean('auto_use_best_lyric', true),
    preferredAlternativeLyricSource: readStoredPreferredAlternativeLyricSource(),
    localLyricsPriority: readStoredLocalLyricsPriority(),
    hidePlayerProgressBar: getStoredBoolean('hide_player_progress_bar', false),
    hidePlayerTranslationSubtitle: getStoredBoolean('hide_player_translation_subtitle', false),
    showSubtitleTranslation: readStoredSubtitleContentMode() !== 'none',
    subtitleContentMode: readStoredSubtitleContentMode(),
    hidePlayerRightPanelButton: getStoredBoolean('hide_player_right_panel_button', false),
    alwaysShowPlayerBackButton: getStoredBoolean('always_show_player_back_button', false),
    alwaysShowTrackSwitchButtons: getStoredBoolean('always_show_track_switch_buttons', false),
    alwaysShowMainWindowTitlebar: getStoredBoolean('always_show_main_window_titlebar', false),
    transparentPlayerBackground: getStoredBoolean('transparent_player_background', false),
    enablePlayerPageNativeBlur: getStoredBoolean('enable_player_page_native_blur', false),
    autoHidePlayerChrome: getStoredBoolean('auto_hide_player_chrome', false),
    disableVisualizerVignette: getStoredBoolean('disable_visualizer_vignette', false),
    disableVisualizerGeometricBackground: getStoredBoolean('disable_visualizer_geometric_background', false),
    minimizeToTray: getStoredBoolean(MINIMIZE_TO_TRAY_STORAGE_KEY, false),
    voiceInputPauseEnabled: getStoredBoolean(VOICE_INPUT_PAUSE_STORAGE_KEY, false),
    preventDisplaySleepDuringPlayback: getStoredBoolean(PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK_STORAGE_KEY, false),
    modSystemEnabled: getStoredBoolean(MOD_SYSTEM_ENABLED_STORAGE_KEY, false),
    // A sleep timer is a one-shot action. Persist its preferred duration, never an armed state.
    sleepTimerEnabled: false,
    sleepTimerHours: readStoredSleepTimerHours(),
    sleepTimerMinutes: readStoredSleepTimerMinutes(),
    sleepTimerDeadlineMs: null,
    sleepTimerActivationId: 0,
    hideTaskbarIcon: getStoredBoolean(HIDE_TASKBAR_ICON_STORAGE_KEY, false),
    hideRemoteControlTaskbarIcon: getStoredBoolean(REMOTE_CONTROL_SKIP_TASKBAR_STORAGE_KEY, false),
    wallpaperMode: getStoredBoolean(WALLPAPER_MODE_STORAGE_KEY, false),
    openPlayerOnLaunch: getStoredBoolean(OPEN_PLAYER_ON_LAUNCH_STORAGE_KEY, false),
    enableMediaCache: readStoredEnableMediaCache(),
    mediaCacheLimitGb: readStoredMediaCacheLimitGb(),
    automixEnabled: getStoredBoolean(AUTOMIX_ENABLED_KEY, false),
    isAutomixModelReminderOpen: false,
    transitionMode: readStoredTransitionMode(),
    crossfadeMaxSec: readStoredCrossfadeMaxSec(),
    transitionPerformance: getStoredBoolean(
        TRANSITION_PERFORMANCE_KEY, DEFAULT_TRANSITION_SETTINGS.performance,
    ),
    // Off by default: it draws over whatever the listener is already looking at, which is a
    // choice to make rather than one to arrive at after an update.
    transitionAnimation: getStoredBoolean(TRANSITION_ANIMATION_KEY, false),
    backgroundOpacity: readStoredBackgroundOpacity(),
    subtitleOverlayOpacity: readStoredSubtitleOverlayOpacity(),
    subtitleOverlayBackground: getStoredBoolean(SUBTITLE_OVERLAY_BACKGROUND_STORAGE_KEY, true),
    showHarmonySubtitle: getStoredBoolean(SHOW_HARMONY_SUBTITLE_STORAGE_KEY, true),
    harmonySubtitleBackground: getStoredBoolean(HARMONY_SUBTITLE_BACKGROUND_STORAGE_KEY, true),
    visualizerOpacity: readStoredVisualizerOpacity(),
    visualizerBackgroundMode: readStoredVisualizerBackgroundMode(),
    urlBackgroundList: readStoredUrlBackgroundList(),
    urlBackgroundSelectedId: readStoredUrlBackgroundSelectedId(),
    visualizerFrameRate: readStoredVisualizerFrameRate(),
    globalLyricTimelineOffsetMs: readStoredGlobalLyricTimelineOffsetMs(),
    followSystemTheme: initialFollowSystemTheme,
    isDaylight: initialDaylight,
    visualizerMode: readStoredVisualizerMode(),
    randomVisualizerModePerSong: getStoredBoolean('random_visualizer_mode_per_song', false),
    classicTuning: readStoredClassicTuning(),
    cadenzaTuning: readStoredCadenzaTuning(),
    partitaTuning: readStoredPartitaTuning(),
    fumeTuning: readStoredFumeTuning(),
    claddaghTuning: readStoredCladdaghTuning(),
    cappellaTuning: readStoredCappellaTuning(),
    tiltTuning: readStoredTiltTuning(),
    dioramaTuning: readStoredDioramaTuning(),
    monetBackgroundTuning: readStoredMonetBackgroundTuning(),
    nomandBackgroundTuning: readStoredNomandBackgroundTuning(),
    latentBackgroundTuning: readStoredLatentBackgroundTuning(),
    monetTuning: readStoredMonetTuning(),
    pendoloTuning: readStoredPendoloTuning(),
    sonnetTuning: readStoredSonnetTuning(),
    temperaTuning: readStoredTemperaTuning(),
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
    lyricsFontScale: readStoredFontScale('lyrics_font_scale'),
    lyricsFontWeight: readStoredFontWeight(LYRICS_FONT_WEIGHT_STORAGE_KEY),
    lyricsCustomFont: readStoredCustomLyricsFont(),
    lyricsFontFallbackFamilies: readStoredFontFamilyStack(LYRICS_FONT_FALLBACK_FAMILIES_STORAGE_KEY),
    subtitleFontInheritsLyrics: getStoredBoolean(SUBTITLE_FONT_INHERITS_LYRICS_STORAGE_KEY, true),
    subtitleFontScale: readStoredFontScale(SUBTITLE_FONT_SCALE_STORAGE_KEY),
    subtitleFontStyle: readStoredSubtitleFontStyle(),
    subtitleFontWeight: readStoredFontWeight(SUBTITLE_FONT_WEIGHT_STORAGE_KEY),
    subtitleFontFamily: readStoredSubtitleFontFamily(),
    subtitleFontFallbackFamilies: readStoredFontFamilyStack(SUBTITLE_FONT_FALLBACK_FAMILIES_STORAGE_KEY),
    lyricFilterPattern: readStoredLyricFilterPattern(),
    showOpenPanelCloseButton: getStoredBoolean('show_open_panel_close_button', true),
    enableNowPlayingStage: getStoredBoolean('enable_now_playing_stage', false),
    enablePlayerCapStage: getStoredBoolean('enable_playercap_stage', false),
    playerCapHost: getStoredString('playercap_host', 'localhost:8765'),
    playerCapPlayer: getStoredString('playercap_player', ''),
    playerCapTimeBasis: getStoredString('playercap_time_basis', 'play_time') === 'timestamp' ? 'timestamp' : 'play_time',
    playerCapSticky: getStoredBoolean('playercap_sticky', true),
    webObsThemeMode: readStoredWebObsThemeMode(),
    queueAddBehavior: readStoredQueueAddBehavior(),
    audioOutputDeviceId: readStoredAudioOutputDeviceId(),
    audioEqualizerSettings: readStoredAudioEqualizerSettings(),
    isAudioEqualizerOpen: false,
    volume: readStoredVolume(),
    isMuted: getStoredBoolean('player_is_muted', false),
    loopMode: readStoredLoopMode(),
    homeLayoutStyle: readStoredHomeLayoutStyle(),
    grid3dCardStyle: readStoredGrid3dCardStyle(),
    showHomeTabPlaylist: getStoredBoolean('show_home_tab_playlist', true),
    showHomeTabRadio: getStoredBoolean('show_home_tab_radio', true),
    showHomeTabAlbums: getStoredBoolean('show_home_tab_albums', true),
    showHomeTabLocal: getStoredBoolean('show_home_tab_local', true),
    pinnedCommandIds: readPinnedCommandIds(),
    isSubSettingsViewOpen: false,
    settingsModalState: {
        isOpen: false,
        initialTab: 'help',
        initialSubview: null,
        initialVisualizerSection: null,
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
        if (typeof settings.VOICE_INPUT_PAUSE_ENABLED === 'boolean') {
            patch.voiceInputPauseEnabled = settings.VOICE_INPUT_PAUSE_ENABLED;
            setStoredBoolean(VOICE_INPUT_PAUSE_STORAGE_KEY, settings.VOICE_INPUT_PAUSE_ENABLED);
        }
        if (typeof settings.PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK === 'boolean') {
            patch.preventDisplaySleepDuringPlayback = settings.PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK;
            setStoredBoolean(PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK_STORAGE_KEY, settings.PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK);
        }
        if (typeof settings.MOD_SYSTEM_ENABLED === 'boolean') {
            patch.modSystemEnabled = settings.MOD_SYSTEM_ENABLED;
            setStoredBoolean(MOD_SYSTEM_ENABLED_STORAGE_KEY, settings.MOD_SYSTEM_ENABLED);
        }
        if (typeof settings.HIDE_TASKBAR_ICON === 'boolean') {
            patch.hideTaskbarIcon = settings.HIDE_TASKBAR_ICON;
            setStoredBoolean(HIDE_TASKBAR_ICON_STORAGE_KEY, settings.HIDE_TASKBAR_ICON);
        }
        if (typeof settings.REMOTE_CONTROL_SKIP_TASKBAR === 'boolean') {
            patch.hideRemoteControlTaskbarIcon = settings.REMOTE_CONTROL_SKIP_TASKBAR;
            setStoredBoolean(REMOTE_CONTROL_SKIP_TASKBAR_STORAGE_KEY, settings.REMOTE_CONTROL_SKIP_TASKBAR);
        }
        if (typeof settings.wallpaper_mode === 'boolean') {
            patch.wallpaperMode = settings.wallpaper_mode;
            setStoredBoolean(WALLPAPER_MODE_STORAGE_KEY, settings.wallpaper_mode);
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
    openSettings: (initialTab = 'help', initialSubview = null, initialVisualizerSection = null) => set({
        settingsModalState: {
            isOpen: true,
            initialTab,
            initialSubview,
            initialVisualizerSection,
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
            text: i18n.t('notifications.' + (enable ? 'coverColorAdded' : 'coverColorDefault')),
        });
    },
    handleToggleStaticMode: (enable) => {
        setStoredBoolean('static_mode', enable);
        set({ staticMode: enable });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'staticModeOn' : 'staticModeOff')),
        });
    },
    handleToggleDisableHomeDynamicBackground: (disable) => {
        setStoredBoolean('disable_home_dynamic_background', disable);
        set({ disableHomeDynamicBackground: disable });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (disable ? 'homeBgDisabled' : 'homeBgEnabled')),
        });
    },
    handleToggleAutoUseBestLyric: (enable) => {
        setStoredBoolean('auto_use_best_lyric', enable);
        set({ autoUseBestLyric: enable });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'autoBestLyricOn' : 'autoBestLyricOff')),
        });
    },
    handleSetPreferredAlternativeLyricSource: (source) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(PREFERRED_LYRIC_SOURCE_STORAGE_KEY_V2, source);
        }
        set({ preferredAlternativeLyricSource: source });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.lyricSourceChanged', { source: getLyricProviderPreferenceLabel(source) }),
        });
    },
    handleSetLocalLyricsPriority: (priority) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(LOCAL_LYRICS_PRIORITY_STORAGE_KEY, priority);
        }
        set({ localLyricsPriority: priority });
    },
    handleToggleHidePlayerProgressBar: (enable) => {
        setStoredBoolean('hide_player_progress_bar', enable);
        set({ hidePlayerProgressBar: enable });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'progressBarHidden' : 'progressBarShown')),
        });
    },
    handleToggleAlwaysShowPlayerBackButton: (enable) => {
        setStoredBoolean('always_show_player_back_button', enable);
        set({ alwaysShowPlayerBackButton: enable });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'playerBackButtonAlwaysShown' : 'playerBackButtonAutoHidden')),
        });
    },
    handleToggleAlwaysShowTrackSwitchButtons: (enable) => {
        setStoredBoolean('always_show_track_switch_buttons', enable);
        set({ alwaysShowTrackSwitchButtons: enable });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'trackSwitchButtonsAlwaysShown' : 'trackSwitchButtonsAutoHidden')),
        });
    },
    handleToggleAlwaysShowMainWindowTitlebar: (enable) => {
        setStoredBoolean('always_show_main_window_titlebar', enable);
        set({ alwaysShowMainWindowTitlebar: enable });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'mainWindowTitlebarAlwaysShown' : 'mainWindowTitlebarAutoHidden')),
        });
    },
    handleToggleHidePlayerTranslationSubtitle: (enable) => {
        setStoredBoolean('hide_player_translation_subtitle', enable);
        set({ hidePlayerTranslationSubtitle: enable });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'subtitleHidden' : 'subtitleShown')),
        });
    },
    handleToggleShowSubtitleTranslation: (enable) => {
        setStoredBoolean(SHOW_SUBTITLE_TRANSLATION_STORAGE_KEY, enable);
        const subtitleContentMode: SubtitleContentMode = enable ? 'translation' : 'none';
        if (typeof window !== 'undefined') {
            localStorage.setItem(SUBTITLE_CONTENT_MODE_STORAGE_KEY, subtitleContentMode);
        }
        set({ showSubtitleTranslation: enable, subtitleContentMode });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'translationShown' : 'translationHidden')),
        });
    },
    handleSetSubtitleContentMode: (subtitleContentMode) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(SUBTITLE_CONTENT_MODE_STORAGE_KEY, subtitleContentMode);
        }
        const showSubtitleTranslation = subtitleContentMode !== 'none';
        setStoredBoolean(SHOW_SUBTITLE_TRANSLATION_STORAGE_KEY, showSubtitleTranslation);
        set({ subtitleContentMode, showSubtitleTranslation });
        notify(get, {
            type: 'info',
            text: i18n.t(`notifications.subtitleMode.${subtitleContentMode}`),
        });
    },
    handleToggleHidePlayerRightPanelButton: (enable) => {
        setStoredBoolean('hide_player_right_panel_button', enable);
        set({ hidePlayerRightPanelButton: enable });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'rightBtnHidden' : 'rightBtnShown')),
        });
    },
    handleToggleTransparentPlayerBackground: (enable) => {
        setStoredBoolean('transparent_player_background', enable);
        set({ transparentPlayerBackground: enable });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'transparentBgOn' : 'transparentBgOff')),
        });
    },
    // Main-process guard fired the refusal (classic Windows wallpaper mode cannot present a
    // transparent wallpaper window): surface why the toggle did not take effect.
    handleWallpaperTransparentRefused: () => {
        notify(get, {
            type: 'warning',
            text: i18n.t('notifications.transparentBgWallpaperUnsupported'),
        });
    },
    handleToggleDisableVisualizerVignette: (disable) => {
        setStoredBoolean('disable_visualizer_vignette', disable);
        set({ disableVisualizerVignette: disable });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (disable ? 'vignetteOff' : 'vignetteOn')),
        });
    },
    handleToggleDisableVisualizerGeometricBackground: (disable) => {
        setStoredBoolean('disable_visualizer_geometric_background', disable);
        set({ disableVisualizerGeometricBackground: disable });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (disable ? 'geometricBgHidden' : 'geometricBgShown')),
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
            text: i18n.t('notifications.' + (enable ? 'minimizeToTray' : 'minimizeToTaskbar')),
        });
    },
    handleToggleVoiceInputPause: (enable) => {
        setStoredBoolean(VOICE_INPUT_PAUSE_STORAGE_KEY, enable);
        set({ voiceInputPauseEnabled: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('VOICE_INPUT_PAUSE_ENABLED', enable);
        }
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'voiceInputPauseOn' : 'voiceInputPauseOff')),
        });
    },
    // The main process owns the authoritative value: it decides whether any mod
    // is loaded at all, so the switch is persisted there and only mirrored here.
    handleToggleModSystem: (enable) => {
        setStoredBoolean(MOD_SYSTEM_ENABLED_STORAGE_KEY, enable);
        set({ modSystemEnabled: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('MOD_SYSTEM_ENABLED', enable);
        }
    },
    handleTogglePreventDisplaySleepDuringPlayback: (enable) => {
        setStoredBoolean(PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK_STORAGE_KEY, enable);
        set({ preventDisplaySleepDuringPlayback: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK', enable);
        }
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'preventDisplaySleepOn' : 'preventDisplaySleepOff')),
        });
    },
    handleToggleSleepTimer: (enable) => {
        if (enable && get().sleepTimerHours === 0 && get().sleepTimerMinutes === 0) {
            notify(get, {
                type: 'error',
                text: i18n.t('commandPalette.sleepTimerDurationRequired'),
            });
            return;
        }
        set(state => ({
            sleepTimerEnabled: enable,
            // Every explicit activation starts a fresh countdown, even when its duration is unchanged.
            sleepTimerActivationId: enable
                ? state.sleepTimerActivationId + 1
                : state.sleepTimerActivationId,
        }));
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'sleepTimerOn' : 'sleepTimerOff')),
        });
    },
    handleSetSleepTimerHours: (hours) => {
        const clamped = Math.min(999, Math.max(0, Math.floor(hours) || 0));
        if (typeof window !== 'undefined') {
            localStorage.setItem(SLEEP_TIMER_HOURS_STORAGE_KEY, String(clamped));
        }
        set(state => ({
            sleepTimerHours: clamped,
            sleepTimerEnabled: clamped === 0 && state.sleepTimerMinutes === 0
                ? false
                : state.sleepTimerEnabled,
        }));
    },
    handleSetSleepTimerMinutes: (minutes) => {
        const clamped = Math.min(59, Math.max(0, Math.floor(minutes) || 0));
        if (typeof window !== 'undefined') {
            localStorage.setItem(SLEEP_TIMER_MINUTES_STORAGE_KEY, String(clamped));
        }
        set(state => ({
            sleepTimerMinutes: clamped,
            sleepTimerEnabled: state.sleepTimerHours === 0 && clamped === 0
                ? false
                : state.sleepTimerEnabled,
        }));
    },
    handleToggleHideTaskbarIcon: (enable) => {
        setStoredBoolean(HIDE_TASKBAR_ICON_STORAGE_KEY, enable);
        set({ hideTaskbarIcon: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('HIDE_TASKBAR_ICON', enable);
        }
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'taskbarHidden' : 'taskbarRestored')),
        });
    },
    handleToggleHideRemoteControlTaskbarIcon: (enable) => {
        setStoredBoolean(REMOTE_CONTROL_SKIP_TASKBAR_STORAGE_KEY, enable);
        set({ hideRemoteControlTaskbarIcon: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('REMOTE_CONTROL_SKIP_TASKBAR', enable);
        }
    },
    handleToggleWallpaperMode: (enable) => {
        setStoredBoolean(WALLPAPER_MODE_STORAGE_KEY, enable);
        set({ wallpaperMode: enable });
        if (window.electron?.saveSettings) {
            // The main process schedules a full relaunch after this IPC returns.
            void window.electron.saveSettings('wallpaper_mode', enable);
        }
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'wallpaperModeOn' : 'wallpaperModeOff')),
        });
    },
    handleToggleOpenPlayerOnLaunch: (enable) => {
        setStoredBoolean(OPEN_PLAYER_ON_LAUNCH_STORAGE_KEY, enable);
        set({ openPlayerOnLaunch: enable });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'openPlayerOnLaunch' : 'openHomeOnLaunch')),
        });
    },
    handleToggleMediaCache: (enable) => {
        setStoredBoolean(ENABLE_MEDIA_CACHE_KEY, enable);
        set({ enableMediaCache: enable });
    },
    handleSetMediaCacheLimitGb: (gigabytes) => {
        const next = Number.isFinite(gigabytes) && gigabytes >= 0 ? gigabytes : DEFAULT_MEDIA_CACHE_LIMIT_GB;
        if (typeof window !== 'undefined') {
            localStorage.setItem(MEDIA_CACHE_LIMIT_GB_KEY, String(next));
        }
        set({ mediaCacheLimitGb: next });
    },
    handleToggleAutomix: (enable) => {
        setStoredBoolean(AUTOMIX_ENABLED_KEY, enable);
        // Asked here rather than in the settings section because there are two switches - the
        // options page and the volume row - and a prompt wired to one of them is missing from the
        // one people actually reach mid-song.
        set({ automixEnabled: enable, isAutomixModelReminderOpen: enable && shouldRemindAboutModels() });
    },
    dismissAutomixModelReminder: (mute) => {
        if (mute) setStoredBoolean(AUTOMIX_MODEL_REMINDER_MUTED_KEY, true);
        set({ isAutomixModelReminderOpen: false });
    },
    handleSetTransitionMode: (mode) => {
        if (!isTransitionMode(mode)) return;
        if (typeof window !== 'undefined') {
            localStorage.setItem(TRANSITION_MODE_KEY, mode);
        }
        set({ transitionMode: mode });
    },
    handleSetCrossfadeMaxSec: (seconds) => {
        const next = clampCrossfadeSeconds(seconds);
        if (typeof window !== 'undefined') {
            localStorage.setItem(CROSSFADE_MAX_SEC_KEY, String(next));
        }
        set({ crossfadeMaxSec: next });
    },
    handleToggleTransitionPerformance: (enable) => {
        setStoredBoolean(TRANSITION_PERFORMANCE_KEY, enable);
        set({ transitionPerformance: enable });
    },
    handleToggleTransitionAnimation: (enable) => {
        setStoredBoolean(TRANSITION_ANIMATION_KEY, enable);
        set({ transitionAnimation: enable });
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
    handleToggleSubtitleOverlayBackground: (enabled) => {
        setStoredBoolean(SUBTITLE_OVERLAY_BACKGROUND_STORAGE_KEY, enabled);
        set({ subtitleOverlayBackground: enabled });
    },
    handleToggleShowHarmonySubtitle: (enabled) => {
        setStoredBoolean(SHOW_HARMONY_SUBTITLE_STORAGE_KEY, enabled);
        set({ showHarmonySubtitle: enabled });
    },
    handleToggleHarmonySubtitleBackground: (enabled) => {
        setStoredBoolean(HARMONY_SUBTITLE_BACKGROUND_STORAGE_KEY, enabled);
        set({ harmonySubtitleBackground: enabled });
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
    handleSetGlobalLyricTimelineOffsetMs: (offsetMs) => {
        const nextOffsetMs = clampGlobalLyricTimelineOffsetMs(offsetMs);
        if (typeof window !== 'undefined') {
            localStorage.setItem(GLOBAL_LYRIC_TIMELINE_OFFSET_STORAGE_KEY, String(nextOffsetMs));
        }
        set({ globalLyricTimelineOffsetMs: nextOffsetMs });
    },
    // System updates are kept separate from the manual setter so a user click can disable auto-follow.
    setDaylightPreferenceFromSystem: (enabled) => {
        if (!get().followSystemTheme) {
            return;
        }

        setStoredBoolean('default_theme_daylight', enabled);
        set({ isDaylight: enabled });
        if (typeof window !== 'undefined' && window.electron?.setNativeTheme) {
            void window.electron.setNativeTheme('system');
        }
    },
    setFollowSystemTheme: (enabled) => {
        setStoredBoolean(FOLLOW_SYSTEM_THEME_STORAGE_KEY, enabled);
        set({ followSystemTheme: enabled });

        if (typeof window !== 'undefined' && window.electron?.setNativeTheme) {
            void window.electron.setNativeTheme(enabled ? 'system' : (get().isDaylight ? 'light' : 'dark'));
        }

        if (enabled) {
            const systemThemeIsDaylight = readSystemThemeIsDaylight();
            if (systemThemeIsDaylight !== null) {
                get().setDaylightPreferenceFromSystem(systemThemeIsDaylight);
            }
        }
    },
    setDaylightPreference: (enabled) => {
        const wasFollowingSystem = get().followSystemTheme;
        if (wasFollowingSystem) {
            setStoredBoolean(FOLLOW_SYSTEM_THEME_STORAGE_KEY, false);
        }
        setStoredBoolean('default_theme_daylight', enabled);
        set({ isDaylight: enabled, ...(wasFollowingSystem ? { followSystemTheme: false } : {}) });
        if (typeof window !== 'undefined' && window.electron?.setNativeTheme) {
            void window.electron.setNativeTheme(enabled ? 'light' : 'dark');
        }
    },
    handleSetVisualizerMode: (mode, options) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('visualizer_mode', mode);
        }
        set({ visualizerMode: mode });
        if (options?.notify !== false) {
            notify(get, {
                type: 'info',
                text: i18n.t('notifications.visualizerSwitched', {
                    mode: getVisualizerModeLabel(mode, key => i18n.t(key)),
                }),
            });
        }
    },
    handleToggleRandomVisualizerModePerSong: (enable) => {
        setStoredBoolean('random_visualizer_mode_per_song', enable);
        set({ randomVisualizerModePerSong: enable });
        notify(get, {
            type: 'info',
            text: i18n.t(`status.randomVisualizerModePerSong${enable ? 'On' : 'Off'}`),
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
                patch.wordSpacing ?? prev.wordSpacing ?? DEFAULT_CLASSIC_TUNING.wordSpacing ?? 0.7,
                prev.wordSpacing ?? DEFAULT_CLASSIC_TUNING.wordSpacing ?? 0.7,
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
        notify(get, { type: 'info', text: i18n.t('notifications.classicReset') });
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
        notify(get, { type: 'info', text: i18n.t('notifications.cadenzaReset') });
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
        notify(get, { type: 'info', text: i18n.t('notifications.partitaReset') });
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
        notify(get, { type: 'info', text: i18n.t('notifications.fumeReset') });
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
        notify(get, { type: 'info', text: i18n.t('notifications.claddaghReset') });
    },
    handleSetPendoloTuning: (patch: Partial<PendoloTuning>) => {
        const prev = get().pendoloTuning;
        const next: PendoloTuning = {
            arcRadius: resolvePendoloNumber(patch.arcRadius, prev.arcRadius, 0.25, 0.80),
            arcAngleDeg: resolvePendoloNumber(patch.arcAngleDeg, prev.arcAngleDeg, 40, 160),
            wheelCenterX: resolvePendoloNumber(patch.wheelCenterX, prev.wheelCenterX, -0.30, 0.50),
            wheelCenterY: resolvePendoloNumber(patch.wheelCenterY, prev.wheelCenterY, 0.20, 0.80),
            tickSnappiness: resolvePendoloNumber(patch.tickSnappiness, prev.tickSnappiness, 0.5, 2.0),
            activeScale: resolvePendoloNumber(patch.activeScale, prev.activeScale, 1.00, 1.60),
            showGearDecor: patch.showGearDecor === 'none' || patch.showGearDecor === 'subtle' || patch.showGearDecor === 'full'
                ? patch.showGearDecor
                : prev.showGearDecor,
            showCenterGradient: typeof patch.showCenterGradient === 'boolean'
                ? patch.showCenterGradient
                : prev.showCenterGradient ?? DEFAULT_PENDOLO_TUNING.showCenterGradient,
            showCoverOnWatchFace: typeof patch.showCoverOnWatchFace === 'boolean'
                ? patch.showCoverOnWatchFace
                : prev.showCoverOnWatchFace ?? DEFAULT_PENDOLO_TUNING.showCoverOnWatchFace,
            enableLineGlow: typeof patch.enableLineGlow === 'boolean'
                ? patch.enableLineGlow
                : prev.enableLineGlow ?? DEFAULT_PENDOLO_TUNING.enableLineGlow,
        };
        if (typeof window !== 'undefined') {
            localStorage.setItem('pendolo_tuning', JSON.stringify(next));
        }
        set({ pendoloTuning: next });
    },
    handleResetPendoloTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('pendolo_tuning', JSON.stringify(DEFAULT_PENDOLO_TUNING));
        }
        set({ pendoloTuning: DEFAULT_PENDOLO_TUNING });
        notify(get, { type: 'info', text: i18n.t('notifications.pendoloReset') });
    },
    handleSetSonnetTuning: (patch: Partial<SonnetTuning>) => {
        const prev = get().sonnetTuning;
        const next: SonnetTuning = {
            cameraIntensity: resolvePendoloNumber(patch.cameraIntensity, prev.cameraIntensity, 0, 2),
            typographyMotion: resolvePendoloNumber(patch.typographyMotion, prev.typographyMotion, 0, 2),
            mgDensity: resolvePendoloNumber(patch.mgDensity, prev.mgDensity, 0, 2),
            showOnlyText: typeof patch.showOnlyText === 'boolean' ? patch.showOnlyText : prev.showOnlyText,
            showGuide: typeof patch.showGuide === 'boolean' ? patch.showGuide : prev.showGuide,
            showBackgroundMg: typeof patch.showBackgroundMg === 'boolean' ? patch.showBackgroundMg : prev.showBackgroundMg,
            showFixedGeo: typeof patch.showFixedGeo === 'boolean' ? patch.showFixedGeo : prev.showFixedGeo,
            showGiantDecorativeText: typeof patch.showGiantDecorativeText === 'boolean'
                ? patch.showGiantDecorativeText
                : prev.showGiantDecorativeText,
            showBackgroundDecor: typeof patch.showBackgroundDecor === 'boolean'
                ? patch.showBackgroundDecor
                : prev.showBackgroundDecor,
            enableTransitions: typeof patch.enableTransitions === 'boolean'
                ? patch.enableTransitions
                : prev.enableTransitions,
            outerFrameMode: patch.outerFrameMode === 'none'
                || patch.outerFrameMode === 'frame'
                || patch.outerFrameMode === 'full'
                ? patch.outerFrameMode
                : prev.outerFrameMode,
            textureResolution: resolvePendoloNumber(patch.textureResolution, prev.textureResolution, 0.5, 4),
            postProcessEnabled: typeof patch.postProcessEnabled === 'boolean'
                ? patch.postProcessEnabled
                : prev.postProcessEnabled,
            postProcessGrain: resolvePendoloNumber(patch.postProcessGrain, prev.postProcessGrain, 0, 1),
            postProcessContrast: resolvePendoloNumber(patch.postProcessContrast, prev.postProcessContrast, 0, 1),
            postProcessRgbShift: resolvePendoloNumber(patch.postProcessRgbShift, prev.postProcessRgbShift, 0, 1),
            postProcessHalftone: resolvePendoloNumber(patch.postProcessHalftone, prev.postProcessHalftone, 0, 1),
            postProcessVignette: resolvePendoloNumber(patch.postProcessVignette, prev.postProcessVignette, 0, 2),
            postProcessLensDistortion: resolvePendoloNumber(patch.postProcessLensDistortion, prev.postProcessLensDistortion, 0, 2),
            postProcessLensDispersion: resolvePendoloNumber(patch.postProcessLensDispersion, prev.postProcessLensDispersion, 0, 1),
        };
        if (typeof window !== 'undefined') localStorage.setItem('sonnet_tuning', JSON.stringify(next));
        set({ sonnetTuning: next });
    },
    handleResetSonnetTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('sonnet_tuning', JSON.stringify(DEFAULT_SONNET_TUNING));
        }
        set({ sonnetTuning: DEFAULT_SONNET_TUNING });
        notify(get, { type: 'info', text: i18n.t('notifications.sonnetReset') });
    },
    handleSetTemperaTuning: (patch: Partial<TemperaTuning>) => {
        const prev = get().temperaTuning;
        const next: TemperaTuning = {
            cameraIntensity: resolvePendoloNumber(patch.cameraIntensity, prev.cameraIntensity, 0, 2),
            glyphMotion: resolvePendoloNumber(patch.glyphMotion, prev.glyphMotion, 0, 2),
            glyphSettleStretch: resolvePendoloNumber(patch.glyphSettleStretch, prev.glyphSettleStretch, 0, 1),
            colorMode: patch.colorMode === 'duo' || patch.colorMode === 'mono' || patch.colorMode === 'gradient' ? patch.colorMode : prev.colorMode,
            textInversion: typeof patch.textInversion === 'boolean' ? patch.textInversion : prev.textInversion,
            layerImages: patch.layerImages ? sanitizeTemperaLayerImages(patch.layerImages) : prev.layerImages,
            layerImageDepth: patch.layerImageDepth === 'front' || patch.layerImageDepth === 'back' ? patch.layerImageDepth : prev.layerImageDepth,
            layerImageFrequency: patch.layerImageFrequency !== undefined ? clampUnit(patch.layerImageFrequency, prev.layerImageFrequency) : prev.layerImageFrequency,
            showBlocks: typeof patch.showBlocks === 'boolean' ? patch.showBlocks : prev.showBlocks,
            showDecor: typeof patch.showDecor === 'boolean' ? patch.showDecor : prev.showDecor,
            enableTransitions: typeof patch.enableTransitions === 'boolean'
                ? patch.enableTransitions
                : prev.enableTransitions,
            textureResolution: resolvePendoloNumber(patch.textureResolution, prev.textureResolution, 0.5, 4),
            postProcessEnabled: typeof patch.postProcessEnabled === 'boolean'
                ? patch.postProcessEnabled
                : prev.postProcessEnabled,
            postProcessTextureCompression: typeof patch.postProcessTextureCompression === 'boolean'
                ? patch.postProcessTextureCompression
                : prev.postProcessTextureCompression,
            postProcessGrain: resolvePendoloNumber(patch.postProcessGrain, prev.postProcessGrain, 0, 1),
            postProcessContrast: resolvePendoloNumber(patch.postProcessContrast, prev.postProcessContrast, 0, 1),
            postProcessRgbShift: resolvePendoloNumber(patch.postProcessRgbShift, prev.postProcessRgbShift, 0, 1),
            postProcessVignette: resolvePendoloNumber(patch.postProcessVignette, prev.postProcessVignette, 0, 2),
            postProcessLensDistortion: resolvePendoloNumber(patch.postProcessLensDistortion, prev.postProcessLensDistortion, 0, 2),
        };
        if (typeof window !== 'undefined') localStorage.setItem('tempera_tuning', JSON.stringify(next));
        set({ temperaTuning: next });
    },
    handleResetTemperaTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('tempera_tuning', JSON.stringify(DEFAULT_TEMPERA_TUNING));
        }
        set({ temperaTuning: DEFAULT_TEMPERA_TUNING });
        notify(get, { type: 'info', text: i18n.t('notifications.temperaReset') });
    },
    handleSetCappellaTuning: (patch) => {
        const requestedCustomWithoutPack = patch.emojiPackSource === 'custom' && get().storedCappellaEmojiPack.length === 0;
        if (requestedCustomWithoutPack) {
            notify(get, { type: 'info', text: i18n.t('notifications.uploadEmojiFirst') });
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
        notify(get, { type: 'info', text: i18n.t('notifications.cappellaReset') });
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
        notify(get, { type: 'info', text: i18n.t('notifications.tiltReset') });
    },
    handleSetDioramaTuning: (patch) => {
        const prev = get().dioramaTuning;
        const next = resolveStoredDioramaTuning({
            ...prev,
            ...patch,
            geometryVisibility: patch.geometryVisibility
                ? { ...prev.geometryVisibility, ...patch.geometryVisibility }
                : prev.geometryVisibility,
        });
        if (typeof window !== 'undefined') {
            localStorage.setItem('diorama_tuning', JSON.stringify(next));
        }
        set({ dioramaTuning: next });
    },
    handleResetDioramaTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('diorama_tuning', JSON.stringify(DEFAULT_DIORAMA_TUNING));
        }
        set({ dioramaTuning: DEFAULT_DIORAMA_TUNING });
        notify(get, { type: 'info', text: i18n.t('notifications.dioramaReset') });
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
        notify(get, { type: 'info', text: i18n.t('notifications.monetBgReset') });
    },
    handleSetNomandBackgroundTuning: (patch) => {
        const next = resolveStoredNomandBackgroundTuning({
            ...get().nomandBackgroundTuning,
            ...patch,
        });
        if (typeof window !== 'undefined') {
            localStorage.setItem('nomand_background_tuning', JSON.stringify(next));
        }
        set({ nomandBackgroundTuning: next });
    },
    handleResetNomandBackgroundTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('nomand_background_tuning', JSON.stringify(DEFAULT_NOMAND_BACKGROUND_TUNING));
        }
        set({ nomandBackgroundTuning: DEFAULT_NOMAND_BACKGROUND_TUNING });
        notify(get, { type: 'info', text: i18n.t('notifications.nomandBgReset') });
    },
    handleSetLatentBackgroundTuning: (patch) => {
        const next = resolveStoredLatentBackgroundTuning({
            ...get().latentBackgroundTuning,
            ...patch,
        });
        if (typeof window !== 'undefined') {
            localStorage.setItem('latent_background_tuning', JSON.stringify(next));
        }
        set({ latentBackgroundTuning: next });
    },
    handleResetLatentBackgroundTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('latent_background_tuning', JSON.stringify(DEFAULT_LATENT_BACKGROUND_TUNING));
        }
        set({ latentBackgroundTuning: DEFAULT_LATENT_BACKGROUND_TUNING });
        notify(get, { type: 'info', text: i18n.t('notifications.latentBgReset') });
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
        notify(get, { type: 'info', text: i18n.t('notifications.monetReset') });
    },
    handleUploadMonetBackgroundImage: async (files) => {
        const file = files[0];
        if (!file) {
            return { ok: false, error: i18n.t('notifications.selectImageFile') };
        }

        if (!isSupportedMonetBackgroundFile(file)) {
            return { ok: false, error: i18n.t('notifications.unsupportedImageFormat') };
        }

        const image = buildStoredMonetBackgroundImage(file);
        await saveMonetBackgroundImage(image);
        set({ storedMonetBackgroundImage: image });
        notify(get, { type: 'success', text: i18n.t('notifications.monetBgUpdated') });
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
        notify(get, { type: 'info', text: i18n.t('notifications.monetBgCleared') });
    },
    handleUploadMonetPortraitImage: async (files) => {
        const file = files[0];
        if (!file) {
            return { ok: false, error: i18n.t('notifications.selectImageFile') };
        }

        if (!isSupportedMonetPortraitFile(file)) {
            return { ok: false, error: i18n.t('notifications.unsupportedImageFormat') };
        }

        const image = buildStoredMonetPortraitImage(file);
        await saveMonetPortraitImage(image);
        set({ storedMonetPortraitImage: image });
        notify(get, { type: 'success', text: i18n.t('notifications.monetPortraitUpdated') });
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
        notify(get, { type: 'info', text: i18n.t('notifications.monetPortraitCleared') });
    },
    handleImportCustomCappellaEmojiPack: async (files) => {
        if (files.length === 0) {
            return { ok: false, error: i18n.t('notifications.selectImageFile') };
        }

        const storedCappellaEmojiPack = get().storedCappellaEmojiPack;

        if (!files.every(isSupportedCappellaEmojiFile)) {
            return { ok: false, error: i18n.t('notifications.unsupportedImageFormat') };
        }

        const appendedPack = buildStoredCappellaEmojiPack(files);
        const storedPack = [...storedCappellaEmojiPack, ...appendedPack];
        await saveCustomCappellaEmojiPack(storedPack);
        set({ storedCappellaEmojiPack: storedPack });
        notify(get, {
            type: 'success',
            text: i18n.t('notifications.emojiPackAdded', { added: appendedPack.length, total: storedPack.length }),
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
        notify(get, { type: 'info', text: i18n.t('notifications.emojiPackCleared') });
    },
    handleImportCustomCappellaAvatar: async (files) => {
        if (files.length === 0) {
            return { ok: false, error: i18n.t('notifications.selectImageFile') };
        }

        const storedCappellaAvatarPack = get().storedCappellaAvatarPack;

        if (!files.every(isSupportedCappellaAvatarFile)) {
            return { ok: false, error: i18n.t('notifications.unsupportedImageFormat') };
        }

        const builtPack = buildStoredCappellaAvatar(files);
        const storedPack = [...storedCappellaAvatarPack, ...builtPack];
        await saveCustomCappellaAvatar(storedPack);
        set({ storedCappellaAvatarPack: storedPack });
        notify(get, {
            type: 'success',
            text: i18n.t('notifications.avatarAdded', { added: builtPack.length, total: storedPack.length }),
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
        notify(get, { type: 'info', text: i18n.t('notifications.avatarCleared') });
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
    handleSetLyricsFontWeight: (fontWeight) => {
        const next = normalizeFontWeight(fontWeight);
        if (typeof window !== 'undefined') {
            if (next === null) localStorage.removeItem(LYRICS_FONT_WEIGHT_STORAGE_KEY);
            else localStorage.setItem(LYRICS_FONT_WEIGHT_STORAGE_KEY, String(next));
        }
        set({ lyricsFontWeight: next });
    },
    handleSetLyricsCustomFont: (font) => {
        if (!font?.family?.trim()) {
            set({ lyricsCustomFont: null, lyricsFontFallbackFamilies: [] });
            if (typeof window !== 'undefined') {
                localStorage.removeItem('lyrics_custom_font');
                localStorage.removeItem(LYRICS_FONT_FALLBACK_FAMILIES_STORAGE_KEY);
            }
            void clearUploadedLyricsFont();
            return;
        }

        const next = resolveStoredCustomLyricsFont(font);
        if (!next) {
            set({ lyricsCustomFont: null, lyricsFontFallbackFamilies: [] });
            if (typeof window !== 'undefined') {
                localStorage.removeItem('lyrics_custom_font');
                localStorage.removeItem(LYRICS_FONT_FALLBACK_FAMILIES_STORAGE_KEY);
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
                text: i18n.t('notifications.fontEnabled', { fontName: meta.label || meta.family }),
            });

            return { ok: true };
        } catch (error) {
            const message = error instanceof Error && error.message
                ? error.message
                : i18n.t('notifications.fontUploadFailed');
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
    handleSetSubtitleFontScale: (fontScale) => {
        const next = Math.min(1.4, Math.max(0.85, fontScale));
        if (typeof window !== 'undefined') {
            localStorage.setItem(SUBTITLE_FONT_SCALE_STORAGE_KEY, String(next));
        }
        set({ subtitleFontScale: next });
    },
    handleSetSubtitleFontStyle: (fontStyle) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(SUBTITLE_FONT_STYLE_STORAGE_KEY, fontStyle);
        }
        set({ subtitleFontStyle: fontStyle });
    },
    handleSetSubtitleFontWeight: (fontWeight) => {
        const next = normalizeFontWeight(fontWeight);
        if (typeof window !== 'undefined') {
            if (next === null) localStorage.removeItem(SUBTITLE_FONT_WEIGHT_STORAGE_KEY);
            else localStorage.setItem(SUBTITLE_FONT_WEIGHT_STORAGE_KEY, String(next));
        }
        set({ subtitleFontWeight: next });
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
        const getLanguageLabel = (pref: AppLanguagePreference): string => {
            switch (pref) {
                case 'zh-CN': return i18n.t('options.appLanguageZhCN', { lng: 'zh-CN' });
                case 'in': return i18n.t('options.appLanguageInID', { lng: 'in' });
                case 'en': return i18n.t('options.appLanguageEnUS', { lng: 'en' });
                default: return '';
            }
        };

        notify(get, {
            type: 'info',
            text: preference === 'system'
                ? i18n.t('notifications.langFollowSystem')
                : i18n.t('notifications.langManual', { language: getLanguageLabel(preference) }),
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
            text: i18n.t('notifications.' + (enable ? 'panelCloseBtnShown' : 'panelCloseBtnHidden')),
        });
    },
    setWebStageSource: (source) => {
        const wasEnabled = get().enableNowPlayingStage || get().enablePlayerCapStage;
        const enableNowPlaying = source === 'now-playing';
        const enablePlayerCap = source === 'playercap';
        setStoredBoolean('enable_now_playing_stage', enableNowPlaying);
        setStoredBoolean('enable_playercap_stage', enablePlayerCap);
        set({ enableNowPlayingStage: enableNowPlaying, enablePlayerCapStage: enablePlayerCap });
        const nowEnabled = enableNowPlaying || enablePlayerCap;
        // Only notify on the enable/disable transition; switching between the two sources is silent. On disable, the controller's stageSource→null reactive effect handles teardown automatically.
        if (wasEnabled !== nowEnabled) {
            notify(get, {
                type: 'info',
                text: i18n.t('notifications.' + (nowEnabled ? 'stageModeOn' : 'stageModeOff')),
            });
        }
    },
    setPlayerCapHost: (host) => {
        localStorage.setItem('playercap_host', host);
        set({ playerCapHost: host });
    },
    setPlayerCapPlayer: (player) => {
        localStorage.setItem('playercap_player', player);
        set({ playerCapPlayer: player });
    },
    setPlayerCapTimeBasis: (basis) => {
        localStorage.setItem('playercap_time_basis', basis);
        set({ playerCapTimeBasis: basis });
    },
    setPlayerCapSticky: (sticky) => {
        setStoredBoolean('playercap_sticky', sticky);
        set({ playerCapSticky: sticky });
    },
    handleToggleNowPlayingStage: (enable) => {
        setStoredBoolean('enable_now_playing_stage', enable);
        set({ enableNowPlayingStage: enable });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'stageModeOn' : 'stageModeOff')),
        });
    },
    setWebObsThemeMode: (mode) => {
        if (typeof window !== 'undefined') localStorage.setItem('web_obs_theme_mode', mode);
        set({ webObsThemeMode: mode });
    },
    handleSetQueueAddBehavior: (behavior) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('queue_add_behavior', behavior);
        }
        set({ queueAddBehavior: behavior });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (behavior === 'next' ? 'queueInsertNext' : 'queueAppend')),
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
    handleSetAudioEqualizerSettings: (settings) => {
        const resolved = resolveAudioEqualizerSettings(settings);
        writeStoredAudioEqualizerSettings(resolved);
        set({ audioEqualizerSettings: resolved });
    },
    // Applies a built-in sound preset or a saved custom slot, and turns processing on.
    handleApplyAudioSoundPreset: (modeId) => {
        const current = get().audioEqualizerSettings;
        const source = isAudioEqualizerCustomSlotId(modeId)
            ? current.customSlots[getAudioEqualizerCustomSlotIndex(modeId)]
            : AUDIO_SOUND_PRESETS[modeId];
        if (!source) {
            return;
        }

        const resolved = resolveAudioEqualizerSettings({
            ...current,
            enabled: true,
            preset: modeId,
            gains: [...source.gains],
            effects: { ...source.effects },
        });
        writeStoredAudioEqualizerSettings(resolved);
        set({ audioEqualizerSettings: resolved });
    },
    openAudioEqualizer: () => set({ isAudioEqualizerOpen: true }),
    closeAudioEqualizer: () => set({ isAudioEqualizerOpen: false }),
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
    handleSetHomeLayoutStyle: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('home_layout_style', 'grid');
        }
        set({ homeLayoutStyle: 'grid' });
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.homeLayoutGrid'),
        });
    },
    handleSetGrid3dCardStyle: (style) => {
        set({ grid3dCardStyle: style });
        if (typeof window !== 'undefined') localStorage.setItem('grid3d_card_style', style);
        notify(get, {
            type: 'info',
            text: i18n.t('notifications.' + (style === 'image' ? 'cardStyleImage' : 'cardStyleCard')),
        });
    },
    handleToggleHomeTabPlaylist: (show) => {
        set({ showHomeTabPlaylist: show });
        if (typeof window !== 'undefined') localStorage.setItem('show_home_tab_playlist', show.toString());
    },
    handleToggleHomeTabRadio: (show) => {
        set({ showHomeTabRadio: show });
        if (typeof window !== 'undefined') localStorage.setItem('show_home_tab_radio', show.toString());
    },
    handleToggleHomeTabAlbums: (show) => {
        set({ showHomeTabAlbums: show });
        if (typeof window !== 'undefined') localStorage.setItem('show_home_tab_albums', show.toString());
    },
    handleToggleHomeTabLocal: (show) => {
        set({ showHomeTabLocal: show });
        if (typeof window !== 'undefined') localStorage.setItem('show_home_tab_local', show.toString());
    },
    setPinnedCommandId: (slotIndex, commandId) => {
        if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= 3) {
            return;
        }
        const current = get().pinnedCommandIds;
        const next = normalizePinnedCommandIds(
            current.map((currentCommandId, index) => (
                index === slotIndex ? commandId : currentCommandId
            )),
        );
        writePinnedCommandIds(next);
        set({ pinnedCommandIds: next });
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
    subtitleContentMode: state.subtitleContentMode,
    hidePlayerRightPanelButton: state.hidePlayerRightPanelButton,
    alwaysShowPlayerBackButton: state.alwaysShowPlayerBackButton,
    alwaysShowTrackSwitchButtons: state.alwaysShowTrackSwitchButtons,
    alwaysShowMainWindowTitlebar: state.alwaysShowMainWindowTitlebar,
    transparentPlayerBackground: state.transparentPlayerBackground,
    autoHidePlayerChrome: state.autoHidePlayerChrome,
    disableVisualizerVignette: state.disableVisualizerVignette,
    disableVisualizerGeometricBackground: state.disableVisualizerGeometricBackground,
    minimizeToTray: state.minimizeToTray,
    voiceInputPauseEnabled: state.voiceInputPauseEnabled,
    preventDisplaySleepDuringPlayback: state.preventDisplaySleepDuringPlayback,
    modSystemEnabled: state.modSystemEnabled,
    sleepTimerEnabled: state.sleepTimerEnabled,
    sleepTimerHours: state.sleepTimerHours,
    sleepTimerMinutes: state.sleepTimerMinutes,
    sleepTimerDeadlineMs: state.sleepTimerDeadlineMs,
    handleToggleSleepTimer: state.handleToggleSleepTimer,
    handleSetSleepTimerHours: state.handleSetSleepTimerHours,
    handleSetSleepTimerMinutes: state.handleSetSleepTimerMinutes,
    hideTaskbarIcon: state.hideTaskbarIcon,
    hideRemoteControlTaskbarIcon: state.hideRemoteControlTaskbarIcon,
    wallpaperMode: state.wallpaperMode,
    handleToggleWallpaperMode: state.handleToggleWallpaperMode,
    openPlayerOnLaunch: state.openPlayerOnLaunch,
    enableMediaCache: state.enableMediaCache,
    mediaCacheLimitGb: state.mediaCacheLimitGb,
    backgroundOpacity: state.backgroundOpacity,
    subtitleOverlayOpacity: state.subtitleOverlayOpacity,
    subtitleOverlayBackground: state.subtitleOverlayBackground,
    showHarmonySubtitle: state.showHarmonySubtitle,
    harmonySubtitleBackground: state.harmonySubtitleBackground,
    visualizerOpacity: state.visualizerOpacity,
    visualizerBackgroundMode: state.visualizerBackgroundMode,
    urlBackgroundList: state.urlBackgroundList,
    urlBackgroundSelectedId: state.urlBackgroundSelectedId,
    visualizerFrameRate: state.visualizerFrameRate,
    globalLyricTimelineOffsetMs: state.globalLyricTimelineOffsetMs,
    isDaylight: state.isDaylight,
    followSystemTheme: state.followSystemTheme,
    lastSeenGuideVersion: state.lastSeenGuideVersion,
    isUserGuideModalOpen: state.isUserGuideModalOpen,
    visualizerMode: state.visualizerMode,
    randomVisualizerModePerSong: state.randomVisualizerModePerSong,
    homeLayoutStyle: state.homeLayoutStyle,
    handleSetHomeLayoutStyle: state.handleSetHomeLayoutStyle,
    grid3dCardStyle: state.grid3dCardStyle,
    handleSetGrid3dCardStyle: state.handleSetGrid3dCardStyle,
    classicTuning: state.classicTuning,
    cadenzaTuning: state.cadenzaTuning,
    partitaTuning: state.partitaTuning,
    fumeTuning: state.fumeTuning,
    claddaghTuning: state.claddaghTuning,
    cappellaTuning: state.cappellaTuning,
    tiltTuning: state.tiltTuning,
    dioramaTuning: state.dioramaTuning,
    monetBackgroundTuning: state.monetBackgroundTuning,
    nomandBackgroundTuning: state.nomandBackgroundTuning,
    latentBackgroundTuning: state.latentBackgroundTuning,
    monetTuning: state.monetTuning,
    pendoloTuning: state.pendoloTuning,
    sonnetTuning: state.sonnetTuning,
    temperaTuning: state.temperaTuning,
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
    lyricsFontWeight: state.lyricsFontWeight,
    lyricsCustomFontFamily: state.lyricsCustomFont?.family ?? null,
    lyricsCustomFontLabel: state.lyricsCustomFont?.label ?? null,
    lyricsFontFallbackFamilies: state.lyricsFontFallbackFamilies,
    subtitleFontInheritsLyrics: state.subtitleFontInheritsLyrics,
    subtitleFontScale: state.subtitleFontScale,
    subtitleFontStyle: state.subtitleFontStyle,
    subtitleFontWeight: state.subtitleFontWeight,
    subtitleFontFamily: state.subtitleFontFamily,
    subtitleFontFallbackFamilies: state.subtitleFontFallbackFamilies,
    lyricFilterPattern: state.lyricFilterPattern,
    lyricFilterPatternError: getLyricFilterError(state.lyricFilterPattern),
    showOpenPanelCloseButton: state.showOpenPanelCloseButton,
    enableNowPlayingStage: state.enableNowPlayingStage,
    enablePlayerCapStage: state.enablePlayerCapStage,
    playerCapHost: state.playerCapHost,
    playerCapPlayer: state.playerCapPlayer,
    playerCapTimeBasis: state.playerCapTimeBasis,
    playerCapSticky: state.playerCapSticky,
    webObsThemeMode: state.webObsThemeMode,
    queueAddBehavior: state.queueAddBehavior,
    audioOutputDeviceId: state.audioOutputDeviceId,
    loopMode: state.loopMode,
    handleToggleCoverColorBg: state.handleToggleCoverColorBg,
    handleToggleStaticMode: state.handleToggleStaticMode,
    handleToggleDisableHomeDynamicBackground: state.handleToggleDisableHomeDynamicBackground,
    handleToggleHidePlayerProgressBar: state.handleToggleHidePlayerProgressBar,
    handleToggleHidePlayerTranslationSubtitle: state.handleToggleHidePlayerTranslationSubtitle,
    handleToggleShowSubtitleTranslation: state.handleToggleShowSubtitleTranslation,
    handleSetSubtitleContentMode: state.handleSetSubtitleContentMode,
    handleToggleHidePlayerRightPanelButton: state.handleToggleHidePlayerRightPanelButton,
    handleToggleAlwaysShowPlayerBackButton: state.handleToggleAlwaysShowPlayerBackButton,
    handleToggleAlwaysShowTrackSwitchButtons: state.handleToggleAlwaysShowTrackSwitchButtons,
    handleToggleAlwaysShowMainWindowTitlebar: state.handleToggleAlwaysShowMainWindowTitlebar,
    handleToggleTransparentPlayerBackground: state.handleToggleTransparentPlayerBackground,
    enablePlayerPageNativeBlur: state.enablePlayerPageNativeBlur,
    handleTogglePlayerPageNativeBlur: state.handleTogglePlayerPageNativeBlur,
    handleToggleAutoHidePlayerChrome: state.handleToggleAutoHidePlayerChrome,
    handleToggleDisableVisualizerVignette: state.handleToggleDisableVisualizerVignette,
    handleToggleDisableVisualizerGeometricBackground: state.handleToggleDisableVisualizerGeometricBackground,
    handleToggleMinimizeToTray: state.handleToggleMinimizeToTray,
    handleToggleVoiceInputPause: state.handleToggleVoiceInputPause,
    handleToggleModSystem: state.handleToggleModSystem,
    handleTogglePreventDisplaySleepDuringPlayback: state.handleTogglePreventDisplaySleepDuringPlayback,
    handleToggleHideTaskbarIcon: state.handleToggleHideTaskbarIcon,
    handleToggleHideRemoteControlTaskbarIcon: state.handleToggleHideRemoteControlTaskbarIcon,
    handleToggleOpenPlayerOnLaunch: state.handleToggleOpenPlayerOnLaunch,
    handleToggleMediaCache: state.handleToggleMediaCache,
    handleSetMediaCacheLimitGb: state.handleSetMediaCacheLimitGb,
    handleSetBackgroundOpacity: state.handleSetBackgroundOpacity,
    handleSetSubtitleOverlayOpacity: state.handleSetSubtitleOverlayOpacity,
    handleToggleSubtitleOverlayBackground: state.handleToggleSubtitleOverlayBackground,
    handleToggleShowHarmonySubtitle: state.handleToggleShowHarmonySubtitle,
    handleToggleHarmonySubtitleBackground: state.handleToggleHarmonySubtitleBackground,
    handleSetVisualizerOpacity: state.handleSetVisualizerOpacity,
    handleSetVisualizerBackgroundMode: state.handleSetVisualizerBackgroundMode,
    handleResetVisualizerBackgroundMode: state.handleResetVisualizerBackgroundMode,
    handleAddUrlBackgroundItem: state.handleAddUrlBackgroundItem,
    handleUpdateUrlBackgroundItem: state.handleUpdateUrlBackgroundItem,
    handleDeleteUrlBackgroundItem: state.handleDeleteUrlBackgroundItem,
    handleSetUrlBackgroundSelectedId: state.handleSetUrlBackgroundSelectedId,
    handleSetUrlBackgroundList: state.handleSetUrlBackgroundList,
    handleSetVisualizerFrameRate: state.handleSetVisualizerFrameRate,
    handleSetGlobalLyricTimelineOffsetMs: state.handleSetGlobalLyricTimelineOffsetMs,
    setDaylightPreference: state.setDaylightPreference,
    setDaylightPreferenceFromSystem: state.setDaylightPreferenceFromSystem,
    setFollowSystemTheme: state.setFollowSystemTheme,
    setLastSeenGuideVersion: state.setLastSeenGuideVersion,
    setIsUserGuideModalOpen: state.setIsUserGuideModalOpen,
    handleSetVisualizerMode: state.handleSetVisualizerMode,
    handleToggleRandomVisualizerModePerSong: state.handleToggleRandomVisualizerModePerSong,
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
    handleSetDioramaTuning: state.handleSetDioramaTuning,
    handleResetDioramaTuning: state.handleResetDioramaTuning,
    handleSetMonetBackgroundTuning: state.handleSetMonetBackgroundTuning,
    handleResetMonetBackgroundTuning: state.handleResetMonetBackgroundTuning,
    handleSetNomandBackgroundTuning: state.handleSetNomandBackgroundTuning,
    handleResetNomandBackgroundTuning: state.handleResetNomandBackgroundTuning,
    handleSetLatentBackgroundTuning: state.handleSetLatentBackgroundTuning,
    handleResetLatentBackgroundTuning: state.handleResetLatentBackgroundTuning,
    handleSetMonetTuning: state.handleSetMonetTuning,
    handleResetMonetTuning: state.handleResetMonetTuning,
    handleSetPendoloTuning: state.handleSetPendoloTuning,
    handleResetPendoloTuning: state.handleResetPendoloTuning,
    handleSetSonnetTuning: state.handleSetSonnetTuning,
    handleResetSonnetTuning: state.handleResetSonnetTuning,
    handleSetTemperaTuning: state.handleSetTemperaTuning,
    handleResetTemperaTuning: state.handleResetTemperaTuning,
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
    handleSetLyricsFontWeight: state.handleSetLyricsFontWeight,
    handleSetLyricsCustomFont: state.handleSetLyricsCustomFont,
    handleUploadLyricsCustomFont: state.handleUploadLyricsCustomFont,
    handleSetLyricsFontFallbackFamilies: state.handleSetLyricsFontFallbackFamilies,
    handleSetSubtitleFontInheritsLyrics: state.handleSetSubtitleFontInheritsLyrics,
    handleSetSubtitleFontScale: state.handleSetSubtitleFontScale,
    handleSetSubtitleFontStyle: state.handleSetSubtitleFontStyle,
    handleSetSubtitleFontWeight: state.handleSetSubtitleFontWeight,
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
    const initialSettings = useSettingsUiStore.getState();
    void window.electron.setNativeTheme(
        initialSettings.followSystemTheme ? 'system' : (initialSettings.isDaylight ? 'light' : 'dark'),
    );
}
