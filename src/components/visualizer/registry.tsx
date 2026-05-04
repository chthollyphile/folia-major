import React from 'react';
import { type MotionValue } from 'framer-motion';
import {
    DEFAULT_CADENZA_TUNING,
    type AudioBands,
    type CadenzaTuning,
    type FumeTuning,
    type Line,
    type PartitaTuning,
    type Theme,
    type VisualizerMode,
} from '../../types';
import Visualizer from './classic/Visualizer';
import VisualizerCadenza from './cadenza/VisualizerCadenza';
import VisualizerPartita from './partita/VisualizerPartita';
import VisualizerFume from './fume/VisualizerFume';
import VisualizerOverture from './overture/VisualizerOverture';

export type VisualizerTuningKind = 'none' | 'cadenza' | 'partita' | 'fume';

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

const renderOverture = ({
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
    <VisualizerOverture
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
    overture: {
        mode: 'overture',
        labelKey: 'ui.visualizerOverture',
        labelFallback: '序曲',
        previewSeed: 'overture',
        previewStartOffset: 0,
        tuningKind: 'none',
        render: renderOverture,
    },
};

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
