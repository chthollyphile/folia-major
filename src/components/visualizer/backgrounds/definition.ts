import React from 'react';
import type { MotionValue } from 'framer-motion';
import type {
    AudioBands,
    MonetBackgroundImage,
    MonetBackgroundTuning,
    NomandBackgroundTuning,
    Theme,
    UrlBackgroundItem,
    VisualizerBackgroundMode,
} from '../../../types';

// src/components/visualizer/backgrounds/definition.ts
// Shared contracts for discoverable visualizer background modes.

export interface VisualizerBackgroundConfig {
    mode?: VisualizerBackgroundMode | null;
    transparent?: boolean;
    common?: {
        useCoverColorBg?: boolean;
        opacity?: number;
        disableGeometricBackground?: boolean;
        disableVignette?: boolean;
    };
    customImage?: MonetBackgroundImage | null;
    monet?: {
        tuning?: MonetBackgroundTuning;
    };
    nomand?: {
        tuning?: NomandBackgroundTuning;
    };
    url?: {
        items?: UrlBackgroundItem[];
        selectedId?: string | null;
    };
}

export interface VisualizerBackgroundActions {
    onModeChange?: (mode: VisualizerBackgroundMode) => void;
    onResetMode?: () => void;
    onResetAll?: () => void;
    common?: {
        onCoverColorChange?: (enabled: boolean) => void;
        onOpacityChange?: (opacity: number) => void;
        onDisableGeometricChange?: (disabled: boolean) => void;
        onDisableVignetteChange?: (disabled: boolean) => void;
    };
    customImage?: {
        onUpload?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
        onClear?: () => Promise<void> | void;
        isLoading?: boolean;
    };
    monet?: {
        onTuningChange?: (patch: Partial<MonetBackgroundTuning>) => void;
        onResetTuning?: () => void;
    };
    nomand?: {
        onTuningChange?: (patch: Partial<NomandBackgroundTuning>) => void;
        onResetTuning?: () => void;
    };
    url?: {
        onAdd?: (item: UrlBackgroundItem) => void;
        onUpdate?: (id: string, patch: Partial<Omit<UrlBackgroundItem, 'id'>>) => void;
        onDelete?: (id: string) => void;
        onSelect?: (id: string | null) => void;
    };
}

export interface VisualizerBackgroundRenderProps {
    config?: VisualizerBackgroundConfig;
    theme: Theme;
    isDaylight: boolean;
    coverUrl?: string | null;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    seed?: string | number;
    staticMode: boolean;
    paused: boolean;
}

export interface VisualizerBackgroundSettingsProps {
    config?: VisualizerBackgroundConfig;
    actions?: VisualizerBackgroundActions;
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    controlCardBg: string;
    rangeInputClass: string;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

export interface VisualizerBackgroundRegistryEntry {
    mode: VisualizerBackgroundMode;
    order: number;
    labelKey: string;
    labelFallback: string;
    render: (props: VisualizerBackgroundRenderProps) => React.ReactNode;
    renderSettingsPanel?: (props: VisualizerBackgroundSettingsProps) => React.ReactNode;
}

export interface VisualizerBackgroundEntryModule {
    default: VisualizerBackgroundRegistryEntry;
}

export const defineVisualizerBackground = (entry: VisualizerBackgroundRegistryEntry) => entry;
