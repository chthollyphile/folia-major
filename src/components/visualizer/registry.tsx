import React from 'react';
import { type MotionValue } from 'framer-motion';
import {
    DEFAULT_CADENZA_TUNING,
    type AudioBands,
    type CadenzaTuning,
    type FumeTuning,
    type LyraTuning,
    type Line,
    type PartitaTuning,
    type Theme,
    type VisualizerMode,
} from '../../types';
import Visualizer from './classic/Visualizer';
import VisualizerCadenza from './cadenza/VisualizerCadenza';
import VisualizerPartita from './partita/VisualizerPartita';
import VisualizerFume from './fume/VisualizerFume';
import VisualizerLyra from './lyra/VisualizerLyra';

// Central mode registry.
// The rest of the app should ask this file "how do I render/label/configure mode X?"
// instead of hardcoding mode branches in multiple places.
export type VisualizerTuningKind = 'none' | 'cadenza' | 'partita' | 'fume' | 'lyra';

export interface VisualizerSharedProps {
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    lines: Line[];
    theme: Theme;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    showText?: boolean;
    coverUrl?: string | null;
    useCoverColorBg?: boolean;
    seed?: string | number;
    staticMode?: boolean;
    backgroundOpacity?: number;
    lyricsFontScale?: number;
    onBack?: () => void;
    cadenzaTuning?: CadenzaTuning;
    partitaTuning?: PartitaTuning;
    fumeTuning?: FumeTuning;
    lyraTuning?: LyraTuning;
}

export interface VisualizerRegistryEntry {
    mode: VisualizerMode;
    labelKey: string;
    labelFallback: string;
    previewSeed: string;
    previewStartOffset: number;
    tuningKind: VisualizerTuningKind;
    render: (props: VisualizerSharedProps) => React.ReactElement;
}

// These wrappers are intentionally thin.
// If a mode needs prop adaptation, do it here so callers can keep passing one shared prop shape.
const renderClassic = ({
    currentTime,
    currentLineIndex,
    lines,
    theme,
    audioPower,
    audioBands,
    showText,
    coverUrl,
    useCoverColorBg,
    seed,
    staticMode,
    backgroundOpacity,
    lyricsFontScale,
    onBack,
}: VisualizerSharedProps) => (
    <Visualizer
        currentTime={currentTime}
        currentLineIndex={currentLineIndex}
        lines={lines}
        theme={theme}
        audioPower={audioPower}
        audioBands={audioBands}
        showText={showText}
        coverUrl={coverUrl}
        useCoverColorBg={useCoverColorBg}
        seed={seed}
        staticMode={staticMode}
        backgroundOpacity={backgroundOpacity}
        lyricsFontScale={lyricsFontScale}
        onBack={onBack}
    />
);

const renderCadenza = ({
    currentTime,
    currentLineIndex,
    lines,
    theme,
    audioPower,
    audioBands,
    showText,
    coverUrl,
    useCoverColorBg,
    seed,
    staticMode,
    backgroundOpacity,
    lyricsFontScale = 1,
    onBack,
    cadenzaTuning = DEFAULT_CADENZA_TUNING,
}: VisualizerSharedProps) => (
    <VisualizerCadenza
        currentTime={currentTime}
        currentLineIndex={currentLineIndex}
        lines={lines}
        theme={theme}
        audioPower={audioPower}
        audioBands={audioBands}
        showText={showText}
        coverUrl={coverUrl}
        useCoverColorBg={useCoverColorBg}
        seed={seed}
        staticMode={staticMode}
        backgroundOpacity={backgroundOpacity}
        // Cadenza has its own fontScale inside tuning, so multiply the global lyric scale in here once.
        cadenzaTuning={{
            ...cadenzaTuning,
            fontScale: cadenzaTuning.fontScale * lyricsFontScale,
        }}
        lyricsFontScale={lyricsFontScale}
        onBack={onBack}
    />
);

const renderPartita = ({
    currentTime,
    currentLineIndex,
    lines,
    theme,
    audioPower,
    audioBands,
    showText,
    coverUrl,
    useCoverColorBg,
    seed,
    staticMode,
    backgroundOpacity,
    lyricsFontScale,
    onBack,
    partitaTuning,
}: VisualizerSharedProps) => (
    <VisualizerPartita
        currentTime={currentTime}
        currentLineIndex={currentLineIndex}
        lines={lines}
        theme={theme}
        audioPower={audioPower}
        audioBands={audioBands}
        showText={showText}
        coverUrl={coverUrl}
        useCoverColorBg={useCoverColorBg}
        seed={seed}
        staticMode={staticMode}
        backgroundOpacity={backgroundOpacity}
        partitaTuning={partitaTuning}
        lyricsFontScale={lyricsFontScale}
        onBack={onBack}
    />
);

const renderFume = ({
    currentTime,
    currentLineIndex,
    lines,
    theme,
    audioPower,
    audioBands,
    showText,
    coverUrl,
    useCoverColorBg,
    seed,
    staticMode,
    backgroundOpacity,
    lyricsFontScale,
    onBack,
    fumeTuning,
}: VisualizerSharedProps) => (
    <VisualizerFume
        currentTime={currentTime}
        currentLineIndex={currentLineIndex}
        lines={lines}
        theme={theme}
        audioPower={audioPower}
        audioBands={audioBands}
        showText={showText}
        coverUrl={coverUrl}
        useCoverColorBg={useCoverColorBg}
        seed={seed}
        staticMode={staticMode}
        backgroundOpacity={backgroundOpacity}
        lyricsFontScale={lyricsFontScale}
        fumeTuning={fumeTuning}
        onBack={onBack}
    />
);

const renderLyra = ({
    currentTime,
    currentLineIndex,
    lines,
    theme,
    audioPower,
    audioBands,
    showText,
    coverUrl,
    useCoverColorBg,
    seed,
    staticMode,
    backgroundOpacity,
    lyricsFontScale,
    onBack,
    lyraTuning,
}: VisualizerSharedProps) => (
    <VisualizerLyra
        currentTime={currentTime}
        currentLineIndex={currentLineIndex}
        lines={lines}
        theme={theme}
        audioPower={audioPower}
        audioBands={audioBands}
        showText={showText}
        coverUrl={coverUrl}
        useCoverColorBg={useCoverColorBg}
        seed={seed}
        staticMode={staticMode}
        backgroundOpacity={backgroundOpacity}
        lyricsFontScale={lyricsFontScale}
        lyraTuning={lyraTuning}
        onBack={onBack}
    />
);

const VISUALIZER_REGISTRY_BY_MODE: Record<VisualizerMode, VisualizerRegistryEntry> = {
    classic: {
        mode: 'classic',
        labelKey: 'ui.visualizerClassic',
        labelFallback: '流光',
        previewSeed: 'classic',
        previewStartOffset: 0,
        tuningKind: 'none',
        render: renderClassic,
    },
    cadenza: {
        mode: 'cadenza',
        labelKey: 'ui.visualizerCadenze',
        labelFallback: '心象',
        previewSeed: 'cadenza',
        previewStartOffset: 0,
        tuningKind: 'cadenza',
        render: renderCadenza,
    },
    partita: {
        mode: 'partita',
        labelKey: 'ui.visualizerPartita',
        labelFallback: '云阶',
        previewSeed: 'partita',
        previewStartOffset: 0,
        tuningKind: 'partita',
        render: renderPartita,
    },
    fume: {
        mode: 'fume',
        labelKey: 'ui.visualizerFume',
        labelFallback: '浮名',
        previewSeed: 'fume',
        previewStartOffset: 18.4,
        tuningKind: 'fume',
        render: renderFume,
    },
    lyra: {
        mode: 'lyra',
        labelKey: 'ui.visualizerLyra',
        labelFallback: 'Lyra',
        previewSeed: 'lyra',
        previewStartOffset: 18.4,
        tuningKind: 'lyra',
        render: renderLyra,
    },
};

// Array form is mostly for UI, map form is mostly for rendering and lookup.
export const VISUALIZER_REGISTRY = Object.values(VISUALIZER_REGISTRY_BY_MODE);

export const getVisualizerRegistryEntry = (mode: VisualizerMode) => VISUALIZER_REGISTRY_BY_MODE[mode];

export const getVisualizerModeLabel = (mode: VisualizerMode, t: (key: string) => string) => {
    const entry = getVisualizerRegistryEntry(mode);
    const translated = t(entry.labelKey);
    return !translated || translated === entry.labelKey ? entry.labelFallback : translated;
};

export const getVisualizerPreviewStartOffset = (mode: VisualizerMode, loopDuration: number) => {
    if (loopDuration <= 0) {
        return 0;
    }

    return getVisualizerRegistryEntry(mode).previewStartOffset % loopDuration;
};

export const getVisualizerScopedSeed = (mode: VisualizerMode, scope: string) =>
    `${scope}-${getVisualizerRegistryEntry(mode).previewSeed}`;
