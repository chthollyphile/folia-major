import React from 'react';
import { type MotionValue } from 'framer-motion';
import {
    type AudioBands,
    type CappellaAvatarImage,
    type CappellaEmojiImage,
    type CappellaTuning,
    type CadenzaTuning,
    type ClassicTuning,
    type CladdaghTuning,
    type DioramaTuning,
    type FumeTuning,
    type Line,
    type MonetPortraitImage,
    type MonetTuning,
    type PartitaTuning,
    type PendoloTuning,
    type SonnetTuning,
    type SubtitleContentMode,
    type TemperaTuning,
    type Theme,
    type TiltTuning,
    type VisualizerMode,
} from '../../types';
import type { VisualizerTuningBundle } from './tuningRegistry';
import type { VisualizerBackgroundConfig } from './backgrounds/definition';

// src/components/visualizer/definition.ts
// Shared contracts for discoverable visualizer modes.
export type VisualizerTuningKind = 'none' | 'classic' | 'cadenza' | 'partita' | 'fume' | 'claddagh' | 'cappella' | 'tilt' | 'monet' | 'diorama' | 'pendolo' | 'sonnet' | 'tempera';

export interface VisualizerSharedProps {
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    lines: Line[];
    theme: Theme;
    subtitleTheme?: Theme;
    isDaylight?: boolean;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    showText?: boolean;
    songTitle?: string | null;
    songArtist?: string | null;
    songAlbum?: string | null;
    coverUrl?: string | null;
    /**
     * Tempera canvas images shipped inline by the OBS overlay. That page is a separate browsing
     * context with no access to the app's IndexedDB, so when this is present the visualizer uses
     * it instead of reading the pool from storage.
     */
    temperaLayerImageAssets?: { id: string; name: string; url: string }[];
    seed?: string | number;
    staticMode?: boolean;
    backgroundStaticMode?: boolean;
    visualizerOpacity?: number;
    background?: VisualizerBackgroundConfig;
    lyricsFontScale?: number;
    subtitleFontScale?: number;
    subtitleOverlayOpacity?: number;
    subtitleOverlayBackground?: boolean;
    showHarmonySubtitle?: boolean;
    harmonySubtitleBackground?: boolean;
    isPlayerChromeHidden?: boolean;
    hideTranslationSubtitle?: boolean;
    showSubtitleTranslation?: boolean;
    subtitleContentMode?: SubtitleContentMode;
    paused?: boolean;
    onBack?: () => void;
    isPanelOpen?: boolean;
    alwaysShowBackButton?: boolean;
    onPlayerPanelGuideHotspotChange?: (isActive: boolean) => void;
    onLyricLineSeek?: (lyricTimeSec: number) => void;
    isPreviewMode?: boolean;
    visualizerTunings?: VisualizerTuningBundle;
    classicTuning?: ClassicTuning;
    cadenzaTuning?: CadenzaTuning;
    partitaTuning?: PartitaTuning;
    fumeTuning?: FumeTuning;
    claddaghTuning?: CladdaghTuning;
    onCladdaghTuningChange?: (patch: Partial<CladdaghTuning>) => void;
    cappellaTuning?: CappellaTuning;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    cappellaCustomAvatarImages?: CappellaAvatarImage[];
    tiltTuning?: TiltTuning;
    dioramaTuning?: DioramaTuning;
    monetTuning?: MonetTuning;
    monetPortraitImage?: MonetPortraitImage | null;
    onMonetTuningChange?: (patch: Partial<MonetTuning>) => void;
    pendoloTuning?: PendoloTuning;
    onPendoloTuningChange?: (patch: Partial<PendoloTuning>) => void;
    sonnetTuning?: SonnetTuning;
    onSonnetTuningChange?: (patch: Partial<SonnetTuning>) => void;
    temperaTuning?: TemperaTuning;
    onTemperaTuningChange?: (patch: Partial<TemperaTuning>) => void;
}

export interface VisualizerSettingsPanelProps {
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    controlCardBg: string;
    rangeInputClass: string;
    classicTuning?: ClassicTuning;
    onClassicTuningChange?: (patch: Partial<ClassicTuning>) => void;
    partitaTuning?: PartitaTuning;
    onPartitaTuningChange?: (patch: Partial<PartitaTuning>) => void;
    fumeTuning?: FumeTuning;
    onFumeTuningChange?: (patch: Partial<FumeTuning>) => void;
    claddaghTuning?: CladdaghTuning;
    onCladdaghTuningChange?: (patch: Partial<CladdaghTuning>) => void;
    cappellaTuning?: CappellaTuning;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    onCappellaTuningChange?: (patch: Partial<CappellaTuning>) => void;
    cappellaCustomEmojiCount?: number;
    hasCappellaCustomEmojiPack?: boolean;
    isCappellaCustomEmojiPackLoading?: boolean;
    onImportCappellaCustomEmojiPack?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearCappellaCustomEmojiPack?: () => Promise<void> | void;
    cappellaCustomAvatarImages?: CappellaAvatarImage[];
    onImportCappellaCustomAvatar?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearCappellaCustomAvatar?: () => Promise<void> | void;
    hasCappellaCustomAvatar?: boolean;
    isCappellaCustomAvatarLoading?: boolean;
    tiltTuning?: TiltTuning;
    onTiltTuningChange?: (patch: Partial<TiltTuning>) => void;
    dioramaTuning?: DioramaTuning;
    onDioramaTuningChange?: (patch: Partial<DioramaTuning>) => void;
    monetTuning?: MonetTuning;
    onMonetTuningChange?: (patch: Partial<MonetTuning>) => void;
    monetPortraitImage?: MonetPortraitImage | null;
    onUploadMonetPortraitImage?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearMonetPortraitImage?: () => Promise<void> | void;
    isLoadingMonetPortraitImage?: boolean;
    pendoloTuning?: PendoloTuning;
    onPendoloTuningChange?: (patch: Partial<PendoloTuning>) => void;
    sonnetTuning?: SonnetTuning;
    onSonnetTuningChange?: (patch: Partial<SonnetTuning>) => void;
    temperaTuning?: TemperaTuning;
    onTemperaTuningChange?: (patch: Partial<TemperaTuning>) => void;
    /** Mark slider drag start so onChange only updates draft. */
    onSliderPointerDown?: () => void;
    /** Commit draft values to persistent store on slider release. */
    onSliderCommit?: () => void;
}

export interface VisualizerSettingsResetProps {
    resetClassicTuning?: () => void;
    resetPartitaTuning?: () => void;
    resetFumeTuning?: () => void;
    resetCladdaghTuning?: () => void;
    resetCappellaTuning?: () => void;
    resetTiltTuning?: () => void;
    resetDioramaTuning?: () => void;
    resetMonetTuning?: () => void;
    resetPendoloTuning?: () => void;
    resetSonnetTuning?: () => void;
    resetTemperaTuning?: () => void;
    setDraftFumeTuning?: (tuning: FumeTuning) => void;
    setDraftCladdaghTuning?: (tuning: CladdaghTuning) => void;
    setDraftPendoloTuning?: (tuning: PendoloTuning) => void;
    setDraftSonnetTuning?: (tuning: SonnetTuning) => void;
    setDraftTemperaTuning?: (tuning: TemperaTuning) => void;
}

export interface VisualizerRegistryEntry {
    mode: VisualizerMode;
    order: number;
    labelKey: string;
    labelFallback: string;
    previewSeed: string;
    previewStartOffset: number;
    tuningKind: VisualizerTuningKind;
    /*
     * 各模式的 entry.tsx 把真正的 renderer 包成 React.lazy —— registry 用 eager glob 发现
     * entry，如果 entry 静态 import renderer，任何碰 visualizer 设置的模块都会连带拉进 13 个
     * renderer（183 个模块，含 three.js，而 three 只有 diorama 用）。契约不变：这里仍然是
     * props => ReactElement，lazy 组件照样满足。代价是调用方必须提供 Suspense 边界。
     */
    render: (props: VisualizerSharedProps) => React.ReactElement;
    renderSettingsPanel?: (props: VisualizerSettingsPanelProps) => React.ReactNode;
    resetSettings?: (props: VisualizerSettingsResetProps) => void;
}

export interface VisualizerEntryModule {
    default: VisualizerRegistryEntry;
}

export const defineVisualizer = (entry: VisualizerRegistryEntry) => entry;
