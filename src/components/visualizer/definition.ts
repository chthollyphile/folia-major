import React from 'react';
import { type MotionValue } from 'framer-motion';
import {
    type AudioBands,
    type CappellaAvatarImage,
    type CappellaEmojiImage,
    type CappellaTuning,
    type CadenzaTuning,
    type ClassicTuning,
    type FumeTuning,
    type Line,
    type PartitaTuning,
    type Theme,
    type TiltTuning,
    type VisualizerMode,
} from '../../types';

// src/components/visualizer/definition.ts
// Shared contracts for discoverable visualizer modes.
export type VisualizerTuningKind = 'none' | 'classic' | 'cadenza' | 'partita' | 'fume' | 'cappella' | 'tilt';

export interface VisualizerSharedProps {
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    lines: Line[];
    theme: Theme;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    showText?: boolean;
    songTitle?: string | null;
    coverUrl?: string | null;
    useCoverColorBg?: boolean;
    seed?: string | number;
    staticMode?: boolean;
    backgroundOpacity?: number;
    visualizerOpacity?: number;
    transparentBackground?: boolean;
    disableGeometricBackground?: boolean;
    disableVignette?: boolean;
    lyricsFontScale?: number;
    subtitleOverlayOpacity?: number;
    isPlayerChromeHidden?: boolean;
    hideTranslationSubtitle?: boolean;
    paused?: boolean;
    onBack?: () => void;
    isPreviewMode?: boolean;
    classicTuning?: ClassicTuning;
    cadenzaTuning?: CadenzaTuning;
    partitaTuning?: PartitaTuning;
    fumeTuning?: FumeTuning;
    cappellaTuning?: CappellaTuning;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    cappellaCustomAvatarImages?: CappellaAvatarImage[];
    tiltTuning?: TiltTuning;
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
    /** Mark slider drag start so onChange only updates draft. */
    onSliderPointerDown?: () => void;
    /** Commit draft values to persistent store on slider release. */
    onSliderCommit?: () => void;
}

export interface VisualizerSettingsResetProps {
    resetClassicTuning?: () => void;
    resetPartitaTuning?: () => void;
    resetFumeTuning?: () => void;
    resetCappellaTuning?: () => void;
    resetTiltTuning?: () => void;
    setDraftFumeTuning?: (tuning: FumeTuning) => void;
}

export interface VisualizerRegistryEntry {
    mode: VisualizerMode;
    order: number;
    labelKey: string;
    labelFallback: string;
    previewSeed: string;
    previewStartOffset: number;
    tuningKind: VisualizerTuningKind;
    render: (props: VisualizerSharedProps) => React.ReactElement;
    renderSettingsPanel?: (props: VisualizerSettingsPanelProps) => React.ReactNode;
    resetSettings?: (props: VisualizerSettingsResetProps) => void;
}

export interface VisualizerEntryModule {
    default: VisualizerRegistryEntry;
}

export const defineVisualizer = (entry: VisualizerRegistryEntry) => entry;
