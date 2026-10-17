import React from 'react';
import type { MotionValue } from 'framer-motion';
import type {
    AudioBands,
    MonetBackgroundImage,
    Theme,
    UrlBackgroundItem,
    VisualizerBackgroundMode,
} from '../../../types';
import type { VisualizerModeCommand } from '../definition';

// src/components/visualizer/backgrounds/definition.ts
// Shared contracts for discoverable visualizer background modes.

/** A background's tuning as the background config carries it, under the background's id. */
export interface BackgroundTuningSlot<T> {
    tuning?: T;
}

/** The actions of a background's tuning as the background actions carry them, under the background's id. */
export interface BackgroundTuningActionSlot<T> {
    onTuningChange?: (patch: Partial<T>) => void;
    onResetTuning?: () => void;
}

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
    // A background's tuning lies here under the background's id, as a BackgroundTuningSlot: its
    // tuning.ts adds that member (declare module), so this file lists no background's tuning.
    url?: {
        items?: UrlBackgroundItem[];
        selectedId?: string | null;
    };
}

export interface VisualizerBackgroundActions {
    onModeChange?: (mode: VisualizerBackgroundMode) => void;
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
    // The actions of a background's tuning lie here under the background's id, as a
    // BackgroundTuningActionSlot: its tuning.ts adds that member.
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
    /*
     * For a background that changes its colours in place (no `song` in its entry): how long it takes
     * to blend to new ones (useBlendedColors), the soft focus's length where the host plays transitions,
     * 0 or left out where it changes at once.
     */
    blendMs?: number;
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

/** 播放面板背景行里该模式专属的快捷参数，只放一到两个最常调的项。 */
export interface VisualizerBackgroundQuickControlsProps {
    config?: VisualizerBackgroundConfig;
    actions?: VisualizerBackgroundActions;
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
}

export interface VisualizerBackgroundRegistryEntry {
    mode: VisualizerBackgroundMode;
    order: number;
    labelKey: string;
    labelFallback: string;
    /*
     * The small line icon shown beside the background's name: the children of the 24x24 stroked
     * <svg> that modeGlyphs.tsx draws. A background without one (a mod's, say) gets the generic icon.
     */
    glyph?: React.ReactNode;
    /** The command that switches to this background (id `background-<mode>`). A background without one has no plain switch command. */
    command?: VisualizerModeCommand;
    /*
     * What the background draws of the song playing (its cover, its seed). Where these change, the
     * background changes as a whole: a new copy is mounted for the new song and, where the host plays
     * transitions, comes in with the soft focus while the old copy leaves drawing the old song
     * (styleTransition/VisualizerBackgroundTransition). A copy that loads something first (a cover to
     * decode, a picture to make) says when it is ready with useFirstFrameDrawn (styleTransition/firstFrame.ts).
     * Left out, the background does not change with the song, or changes what it draws in place.
     */
    song?: (props: VisualizerBackgroundRenderProps) => readonly unknown[];
    render: (props: VisualizerBackgroundRenderProps) => React.ReactNode;
    renderSettingsPanel?: (props: VisualizerBackgroundSettingsProps) => React.ReactNode;
    renderQuickControls?: (props: VisualizerBackgroundQuickControlsProps) => React.ReactNode;
    resetSettings?: (actions?: VisualizerBackgroundActions) => void;
    /*
     * True when this background draws beat FX under 智能动感模式, like the visualizer entries' flag of
     * the same name (../definition.ts); Latent's onset pulse follows the beats.
     */
    drawsBeatFx?: boolean;
}

export interface VisualizerBackgroundEntryModule {
    default: VisualizerBackgroundRegistryEntry;
}

export const defineVisualizerBackground = (entry: VisualizerBackgroundRegistryEntry) => entry;
