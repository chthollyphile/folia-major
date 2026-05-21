import React from 'react';
import { type MotionValue } from 'framer-motion';
import {
    type AudioBands,
    type CappellaEmojiImage,
    type CappellaTuning,
    type CadenzaTuning,
    type FumeTuning,
    type Line,
    type PartitaTuning,
    type Theme,
    type VisualizerMode,
} from '../../types';

// src/components/visualizer/definition.ts
// Shared contracts for discoverable visualizer modes.
export type VisualizerTuningKind = 'none' | 'cadenza' | 'partita' | 'fume' | 'cappella';

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
    lyricsFontScale?: number;
    isPlayerChromeHidden?: boolean;
    hideTranslationSubtitle?: boolean;
    paused?: boolean;
    onBack?: () => void;
    isPreviewMode?: boolean;
    cadenzaTuning?: CadenzaTuning;
    partitaTuning?: PartitaTuning;
    fumeTuning?: FumeTuning;
    cappellaTuning?: CappellaTuning;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
}

export interface VisualizerSettingsPanelProps {
    t: (key: string) => string;
    isDaylight: boolean;
    controlCardBg: string;
    rangeInputClass: string;
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
}

export interface VisualizerSettingsResetProps {
    resetPartitaTuning?: () => void;
    resetFumeTuning?: () => void;
    resetCappellaTuning?: () => void;
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
