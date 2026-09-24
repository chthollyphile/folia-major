// src/stores/useVisualizerSettingsStore.ts
// Visualizer and background settings: the active mode, the background mode and URL background
// list, opacity/frame-rate, and the fifteen per-mode tuning objects.
//
// Split out of useSettingsUiStore. Persistence (localStorage reads, clamping, defaults) lives in
// ./visualizerSettingsPersistence; this file owns the state and the actions only.

import { create } from 'zustand';
import { getVisualizerModeLabel } from '../components/visualizer/registry';
import { DEFAULT_CADENZA_TUNING, DEFAULT_CAPPELLA_TUNING, DEFAULT_CLADDAGH_TUNING, DEFAULT_CLASSIC_TUNING, DEFAULT_DIORAMA_TUNING, DEFAULT_FUME_TUNING, DEFAULT_LATENT_BACKGROUND_TUNING, DEFAULT_MONET_BACKGROUND_TUNING, DEFAULT_MONET_TUNING, DEFAULT_NOMAND_BACKGROUND_TUNING, DEFAULT_PARTITA_TUNING, DEFAULT_PENDOLO_TUNING, DEFAULT_SONNET_TUNING, DEFAULT_SORA_BACKGROUND_TUNING, DEFAULT_TEMPERA_TUNING, DEFAULT_TILT_TUNING, type CadenzaTuning, type CappellaTuning, type CladdaghTuning, type ClassicTuning, type DioramaTuning, type FumeTuning, type LatentBackgroundTuning, type MonetBackgroundTuning, type MonetTuning, type NomandBackgroundTuning, type PartitaTuning, type PendoloTuning, type SonnetTuning, type SoraBackgroundTuning, type TemperaTuning, type TiltTuning, type UrlBackgroundItem, type VisualizerBackgroundMode, type VisualizerFrameRate, type VisualizerMode } from '../types';
import { VISUALIZER_FRAME_RATE_STORAGE_KEY, setGlobalVisualizerFrameRate } from '../utils/frameRateLimiter';
import { sanitizeUrlBackgroundItem, sanitizeUrlBackgroundList } from '../utils/urlBackground';
import i18n from '../i18n/config';
import { buildStoredCappellaAvatar, clearCustomCappellaAvatar, isSupportedCappellaAvatarFile, saveCustomCappellaAvatar } from '../services/cappellaAvatarPack';
import { buildStoredCappellaEmojiPack, clearCustomCappellaEmojiPack, isSupportedCappellaEmojiFile, saveCustomCappellaEmojiPack } from '../services/cappellaEmojiPack';
import { buildStoredMonetBackgroundImage, clearMonetBackgroundImage, isSupportedMonetBackgroundFile, saveMonetBackgroundImage } from '../services/monetBackgroundImage';
import { buildStoredMonetPortraitImage, clearMonetPortraitImage, isSupportedMonetPortraitFile, saveMonetPortraitImage } from '../services/monetPortraitImage';
import { setStatusMessage } from './useStatusMessageStore';
import { VISUALIZER_OPACITY_STORAGE_KEY, clampCladdaghEllipseTiltDeg, clampCladdaghFocusScaleRatio, clampCladdaghLetterSpacingOffset, clampCladdaghRadiusScale, clampClassicBreathingFloatMultiplier, clampClassicWordSpacing, clampFumeBackgroundObjectOpacity, clampFumeCameraSpeed, clampFumeGlowIntensity, clampFumeHeroScale, clampFumeTextHoldRatio, clampPartitaStagger, clampUnit, readStoredBackgroundOpacity, readStoredCadenzaTuning, readStoredCappellaTuning, readStoredCladdaghTuning, readStoredClassicTuning, readStoredDioramaTuning, readStoredFumeTuning, readStoredLatentBackgroundTuning, readStoredMonetBackgroundTuning, readStoredMonetTuning, readStoredNomandBackgroundTuning, readStoredPartitaTuning, readStoredPendoloTuning, readStoredSonnetTuning, readStoredSoraBackgroundTuning, readStoredTemperaTuning, readStoredTiltTuning, readStoredUrlBackgroundList, readStoredUrlBackgroundSelectedId, readStoredVisualizerBackgroundMode, readStoredVisualizerFrameRate, readStoredVisualizerMode, readStoredVisualizerOpacity, resolveCappellaAvatarSource, resolveFumeCameraTrackingMode, resolvePendoloNumber, resolveStoredDioramaTuning, resolveStoredLatentBackgroundTuning, resolveStoredMonetBackgroundTuning, resolveStoredMonetTuning, resolveStoredNomandBackgroundTuning, resolveStoredSoraBackgroundTuning, sanitizeTemperaLayerImages } from './visualizerSettingsPersistence';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';
import { useVisualizerAssetStore } from './useVisualizerAssetStore';

export type VisualizerSettingsState = {
    disableVisualizerVignette: boolean;
    disableVisualizerGeometricBackground: boolean;
    backgroundOpacity: number;
    visualizerOpacity: number;
    visualizerBackgroundMode: VisualizerBackgroundMode | null;
    urlBackgroundList: UrlBackgroundItem[];
    urlBackgroundSelectedId: string | null;
    visualizerFrameRate: VisualizerFrameRate;
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
    soraBackgroundTuning: SoraBackgroundTuning;
    monetTuning: MonetTuning;
    pendoloTuning: PendoloTuning;
    sonnetTuning: SonnetTuning;
    temperaTuning: TemperaTuning;
    handleToggleDisableVisualizerVignette: (disable: boolean) => void;
    handleToggleDisableVisualizerGeometricBackground: (disable: boolean) => void;
    handleSetBackgroundOpacity: (opacity: number) => void;
    handleSetVisualizerOpacity: (opacity: number) => void;
    handleSetVisualizerBackgroundMode: (mode: VisualizerBackgroundMode) => void;
    handleResetVisualizerBackgroundMode: () => void;
    handleAddUrlBackgroundItem: (item: UrlBackgroundItem) => void;
    handleUpdateUrlBackgroundItem: (id: string, patch: Partial<Omit<UrlBackgroundItem, 'id'>>) => void;
    handleDeleteUrlBackgroundItem: (id: string) => void;
    handleSetUrlBackgroundSelectedId: (id: string | null) => void;
    handleSetUrlBackgroundList: (items: UrlBackgroundItem[]) => void;
    handleSetVisualizerFrameRate: (frameRate: VisualizerFrameRate) => void;
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
    handleSetSoraBackgroundTuning: (patch: Partial<SoraBackgroundTuning>) => void;
    handleResetSoraBackgroundTuning: () => void;
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
};

export const useVisualizerSettingsStore = create<VisualizerSettingsState>((set, get) => ({
    disableVisualizerVignette: getStoredBoolean('disable_visualizer_vignette', false),
    disableVisualizerGeometricBackground: getStoredBoolean('disable_visualizer_geometric_background', false),
    backgroundOpacity: readStoredBackgroundOpacity(),
    visualizerOpacity: readStoredVisualizerOpacity(),
    visualizerBackgroundMode: readStoredVisualizerBackgroundMode(),
    urlBackgroundList: readStoredUrlBackgroundList(),
    urlBackgroundSelectedId: readStoredUrlBackgroundSelectedId(),
    visualizerFrameRate: readStoredVisualizerFrameRate(),
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
    soraBackgroundTuning: readStoredSoraBackgroundTuning(),
    monetTuning: readStoredMonetTuning(),
    pendoloTuning: readStoredPendoloTuning(),
    sonnetTuning: readStoredSonnetTuning(),
    temperaTuning: readStoredTemperaTuning(),
    handleToggleDisableVisualizerVignette: (disable) => {
        setStoredBoolean('disable_visualizer_vignette', disable);
        set({ disableVisualizerVignette: disable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (disable ? 'vignetteOff' : 'vignetteOn')),
        });
    },
    handleToggleDisableVisualizerGeometricBackground: (disable) => {
        setStoredBoolean('disable_visualizer_geometric_background', disable);
        set({ disableVisualizerGeometricBackground: disable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (disable ? 'geometricBgHidden' : 'geometricBgShown')),
        });
    },
    handleSetBackgroundOpacity: (opacity) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('background_opacity', String(opacity));
        }
        set({ backgroundOpacity: opacity });
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
    handleSetVisualizerMode: (mode, options) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('visualizer_mode', mode);
        }
        set({ visualizerMode: mode });
        if (options?.notify !== false) {
            setStatusMessage({
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
        setStatusMessage({
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
        setStatusMessage({ type: 'info', text: i18n.t('notifications.classicReset') });
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
        setStatusMessage({ type: 'info', text: i18n.t('notifications.cadenzaReset') });
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
        setStatusMessage({ type: 'info', text: i18n.t('notifications.partitaReset') });
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
        setStatusMessage({ type: 'info', text: i18n.t('notifications.fumeReset') });
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
        setStatusMessage({ type: 'info', text: i18n.t('notifications.claddaghReset') });
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
        setStatusMessage({ type: 'info', text: i18n.t('notifications.pendoloReset') });
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
        setStatusMessage({ type: 'info', text: i18n.t('notifications.sonnetReset') });
    },
    handleSetTemperaTuning: (patch: Partial<TemperaTuning>) => {
        const prev = get().temperaTuning;
        const next: TemperaTuning = {
            cameraIntensity: resolvePendoloNumber(patch.cameraIntensity, prev.cameraIntensity, 0, 2),
            glyphMotion: resolvePendoloNumber(patch.glyphMotion, prev.glyphMotion, 0, 2),
            wholeLineLyrics: typeof patch.wholeLineLyrics === 'boolean'
                ? patch.wholeLineLyrics
                : prev.wholeLineLyrics,
            glyphSettleStretch: resolvePendoloNumber(patch.glyphSettleStretch, prev.glyphSettleStretch, 0, 1),
            colorMode: patch.colorMode === 'duo' || patch.colorMode === 'mono' || patch.colorMode === 'gradient' ? patch.colorMode : prev.colorMode,
            textInversion: typeof patch.textInversion === 'boolean' ? patch.textInversion : prev.textInversion,
            layerImages: patch.layerImages ? sanitizeTemperaLayerImages(patch.layerImages) : prev.layerImages,
            layerImageDepth: patch.layerImageDepth === 'front' || patch.layerImageDepth === 'back' ? patch.layerImageDepth : prev.layerImageDepth,
            layerImageFrequency: patch.layerImageFrequency !== undefined ? clampUnit(patch.layerImageFrequency, prev.layerImageFrequency) : prev.layerImageFrequency,
            showBlocks: typeof patch.showBlocks === 'boolean' ? patch.showBlocks : prev.showBlocks,
            showDecor: typeof patch.showDecor === 'boolean' ? patch.showDecor : prev.showDecor,
            showCornerMarks: typeof patch.showCornerMarks === 'boolean' ? patch.showCornerMarks : prev.showCornerMarks,
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
        setStatusMessage({ type: 'info', text: i18n.t('notifications.temperaReset') });
    },
    handleSetCappellaTuning: (patch) => {
        const requestedCustomWithoutPack = patch.emojiPackSource === 'custom' && useVisualizerAssetStore.getState().storedCappellaEmojiPack.length === 0;
        if (requestedCustomWithoutPack) {
            setStatusMessage({ type: 'info', text: i18n.t('notifications.uploadEmojiFirst') });
        }

        const prev = get().cappellaTuning;
        const next = {
            showEmoMessages: patch.showEmoMessages ?? prev.showEmoMessages,
            emojiPackSource: patch.emojiPackSource === 'custom' && useVisualizerAssetStore.getState().storedCappellaEmojiPack.length === 0
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
        setStatusMessage({ type: 'info', text: i18n.t('notifications.cappellaReset') });
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
        setStatusMessage({ type: 'info', text: i18n.t('notifications.tiltReset') });
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
        setStatusMessage({ type: 'info', text: i18n.t('notifications.dioramaReset') });
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
        setStatusMessage({ type: 'info', text: i18n.t('notifications.monetBgReset') });
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
        setStatusMessage({ type: 'info', text: i18n.t('notifications.nomandBgReset') });
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
        setStatusMessage({ type: 'info', text: i18n.t('notifications.latentBgReset') });
    },
    handleSetSoraBackgroundTuning: (patch) => {
        const next = resolveStoredSoraBackgroundTuning({
            ...get().soraBackgroundTuning,
            ...patch,
        });
        if (typeof window !== 'undefined') {
            localStorage.setItem('sora_background_tuning', JSON.stringify(next));
        }
        set({ soraBackgroundTuning: next });
    },
    handleResetSoraBackgroundTuning: () => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('sora_background_tuning', JSON.stringify(DEFAULT_SORA_BACKGROUND_TUNING));
        }
        set({ soraBackgroundTuning: DEFAULT_SORA_BACKGROUND_TUNING });
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
        setStatusMessage({ type: 'info', text: i18n.t('notifications.monetReset') });
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
        useVisualizerAssetStore.setState({ storedMonetBackgroundImage: image });
        setStatusMessage({ type: 'success', text: i18n.t('notifications.monetBgUpdated') });
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
            monetBackgroundTuning: nextTuning,
        });
        useVisualizerAssetStore.setState({
            storedMonetBackgroundImage: null,
            monetBackgroundImage: null,
        });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.monetBgCleared') });
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
        useVisualizerAssetStore.setState({ storedMonetPortraitImage: image });
        setStatusMessage({ type: 'success', text: i18n.t('notifications.monetPortraitUpdated') });
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
            monetTuning: nextTuning,
        });
        useVisualizerAssetStore.setState({
            storedMonetPortraitImage: null,
            monetPortraitImage: null,
        });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.monetPortraitCleared') });
    },
    handleImportCustomCappellaEmojiPack: async (files) => {
        if (files.length === 0) {
            return { ok: false, error: i18n.t('notifications.selectImageFile') };
        }

        const storedCappellaEmojiPack = useVisualizerAssetStore.getState().storedCappellaEmojiPack;

        if (!files.every(isSupportedCappellaEmojiFile)) {
            return { ok: false, error: i18n.t('notifications.unsupportedImageFormat') };
        }

        const appendedPack = buildStoredCappellaEmojiPack(files);
        const storedPack = [...storedCappellaEmojiPack, ...appendedPack];
        await saveCustomCappellaEmojiPack(storedPack);
        useVisualizerAssetStore.setState({ storedCappellaEmojiPack: storedPack });
        setStatusMessage({
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
            cappellaTuning: nextTuning,
        });
        useVisualizerAssetStore.setState({
            storedCappellaEmojiPack: [],
        });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.emojiPackCleared') });
    },
    handleImportCustomCappellaAvatar: async (files) => {
        if (files.length === 0) {
            return { ok: false, error: i18n.t('notifications.selectImageFile') };
        }

        const storedCappellaAvatarPack = useVisualizerAssetStore.getState().storedCappellaAvatarPack;

        if (!files.every(isSupportedCappellaAvatarFile)) {
            return { ok: false, error: i18n.t('notifications.unsupportedImageFormat') };
        }

        const builtPack = buildStoredCappellaAvatar(files);
        const storedPack = [...storedCappellaAvatarPack, ...builtPack];
        await saveCustomCappellaAvatar(storedPack);
        useVisualizerAssetStore.setState({ storedCappellaAvatarPack: storedPack });
        setStatusMessage({
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
            cappellaTuning: nextTuning,
        });
        useVisualizerAssetStore.setState({
            storedCappellaAvatarPack: [],
        });
        setStatusMessage({ type: 'info', text: i18n.t('notifications.avatarCleared') });
    },
}));

/**
 * The visualizer half of what selectSettingsUiSnapshot used to expose, kept as one grouped
 * selector for the settings surfaces that legitimately edit the whole domain at once.
 * Ordinary consumers should select the single field they need instead.
 */
export const selectVisualizerSettingsSnapshot = (state: VisualizerSettingsState) => ({
    backgroundOpacity: state.backgroundOpacity,
    cadenzaTuning: state.cadenzaTuning,
    cappellaTuning: state.cappellaTuning,
    claddaghTuning: state.claddaghTuning,
    classicTuning: state.classicTuning,
    dioramaTuning: state.dioramaTuning,
    disableVisualizerGeometricBackground: state.disableVisualizerGeometricBackground,
    disableVisualizerVignette: state.disableVisualizerVignette,
    fumeTuning: state.fumeTuning,
    handleAddUrlBackgroundItem: state.handleAddUrlBackgroundItem,
    handleClearCustomCappellaAvatar: state.handleClearCustomCappellaAvatar,
    handleClearCustomCappellaEmojiPack: state.handleClearCustomCappellaEmojiPack,
    handleClearMonetBackgroundImage: state.handleClearMonetBackgroundImage,
    handleClearMonetPortraitImage: state.handleClearMonetPortraitImage,
    handleDeleteUrlBackgroundItem: state.handleDeleteUrlBackgroundItem,
    handleImportCustomCappellaAvatar: state.handleImportCustomCappellaAvatar,
    handleImportCustomCappellaEmojiPack: state.handleImportCustomCappellaEmojiPack,
    handleResetCadenzaTuning: state.handleResetCadenzaTuning,
    handleResetCappellaTuning: state.handleResetCappellaTuning,
    handleResetCladdaghTuning: state.handleResetCladdaghTuning,
    handleResetClassicTuning: state.handleResetClassicTuning,
    handleResetDioramaTuning: state.handleResetDioramaTuning,
    handleResetFumeTuning: state.handleResetFumeTuning,
    handleResetLatentBackgroundTuning: state.handleResetLatentBackgroundTuning,
    handleResetMonetBackgroundTuning: state.handleResetMonetBackgroundTuning,
    handleResetMonetTuning: state.handleResetMonetTuning,
    handleResetNomandBackgroundTuning: state.handleResetNomandBackgroundTuning,
    handleResetPartitaTuning: state.handleResetPartitaTuning,
    handleResetPendoloTuning: state.handleResetPendoloTuning,
    handleResetSonnetTuning: state.handleResetSonnetTuning,
    handleResetSoraBackgroundTuning: state.handleResetSoraBackgroundTuning,
    handleResetTemperaTuning: state.handleResetTemperaTuning,
    handleResetTiltTuning: state.handleResetTiltTuning,
    handleResetVisualizerBackgroundMode: state.handleResetVisualizerBackgroundMode,
    handleSetBackgroundOpacity: state.handleSetBackgroundOpacity,
    handleSetCadenzaTuning: state.handleSetCadenzaTuning,
    handleSetCappellaTuning: state.handleSetCappellaTuning,
    handleSetCladdaghTuning: state.handleSetCladdaghTuning,
    handleSetClassicTuning: state.handleSetClassicTuning,
    handleSetDioramaTuning: state.handleSetDioramaTuning,
    handleSetFumeTuning: state.handleSetFumeTuning,
    handleSetLatentBackgroundTuning: state.handleSetLatentBackgroundTuning,
    handleSetMonetBackgroundTuning: state.handleSetMonetBackgroundTuning,
    handleSetMonetTuning: state.handleSetMonetTuning,
    handleSetNomandBackgroundTuning: state.handleSetNomandBackgroundTuning,
    handleSetPartitaTuning: state.handleSetPartitaTuning,
    handleSetPendoloTuning: state.handleSetPendoloTuning,
    handleSetSonnetTuning: state.handleSetSonnetTuning,
    handleSetSoraBackgroundTuning: state.handleSetSoraBackgroundTuning,
    handleSetTemperaTuning: state.handleSetTemperaTuning,
    handleSetTiltTuning: state.handleSetTiltTuning,
    handleSetUrlBackgroundList: state.handleSetUrlBackgroundList,
    handleSetUrlBackgroundSelectedId: state.handleSetUrlBackgroundSelectedId,
    handleSetVisualizerBackgroundMode: state.handleSetVisualizerBackgroundMode,
    handleSetVisualizerFrameRate: state.handleSetVisualizerFrameRate,
    handleSetVisualizerMode: state.handleSetVisualizerMode,
    handleSetVisualizerOpacity: state.handleSetVisualizerOpacity,
    handleToggleDisableVisualizerGeometricBackground: state.handleToggleDisableVisualizerGeometricBackground,
    handleToggleDisableVisualizerVignette: state.handleToggleDisableVisualizerVignette,
    handleToggleRandomVisualizerModePerSong: state.handleToggleRandomVisualizerModePerSong,
    handleUpdateUrlBackgroundItem: state.handleUpdateUrlBackgroundItem,
    handleUploadMonetBackgroundImage: state.handleUploadMonetBackgroundImage,
    handleUploadMonetPortraitImage: state.handleUploadMonetPortraitImage,
    latentBackgroundTuning: state.latentBackgroundTuning,
    monetBackgroundTuning: state.monetBackgroundTuning,
    monetTuning: state.monetTuning,
    nomandBackgroundTuning: state.nomandBackgroundTuning,
    partitaTuning: state.partitaTuning,
    pendoloTuning: state.pendoloTuning,
    randomVisualizerModePerSong: state.randomVisualizerModePerSong,
    sonnetTuning: state.sonnetTuning,
    soraBackgroundTuning: state.soraBackgroundTuning,
    temperaTuning: state.temperaTuning,
    tiltTuning: state.tiltTuning,
    urlBackgroundList: state.urlBackgroundList,
    urlBackgroundSelectedId: state.urlBackgroundSelectedId,
    visualizerBackgroundMode: state.visualizerBackgroundMode,
    visualizerFrameRate: state.visualizerFrameRate,
    visualizerMode: state.visualizerMode,
    visualizerOpacity: state.visualizerOpacity,
});

// Module-level handle for the assembly layer; an action needs no subscription.
export const handleSetVisualizerMode = (mode: VisualizerMode, options?: { notify?: boolean }) => (
    useVisualizerSettingsStore.getState().handleSetVisualizerMode(mode, options)
);
