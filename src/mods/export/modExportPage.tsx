import React, { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motionValue, type MotionValue } from 'framer-motion';
import '@/index.css';
import './modExportPage.css';
import { DEFAULT_THEME } from '@/services/baseThemes';
import { getVisualizerRegistryEntry, hasVisualizerMode } from '@/components/visualizer/registry';
import { applyVisualizerTuning, type VisualizerTuningBundle } from '@/components/visualizer/tuningRegistry';
import { registerModVisualizers, type ModVisualizerDescriptor } from '../modVisualizers';
import type { AudioBands, Line, Theme, VisualizerMode } from '@/types';

// src/mods/export/modExportPage.tsx
// Standalone hidden renderer for mod video export. It drives a chosen
// visualizer on a synthetic clock (no real audio): the main process steps
// time forward through window.__foliaModExport.renderFrame and captures the
// transparent window after every frame has settled.

interface ExportPageConfig {
    lyricData: { lines: Line[] } | null;
    visualizerMode: string;
    visualizerTunings?: VisualizerTuningBundle | null;
    theme: Theme | null;
    songMeta: { title?: string; artist?: string } | null;
    startSec?: number;
    backgroundMode?: 'none' | 'theme';
    transparent?: boolean;
    /**
     * Mod-contributed visualizer modes, injected by the export service. This
     * window runs without a preload, so there is no mod bridge to ask - the
     * descriptors have to arrive with the config or a `mod:` visualizerMode
     * would silently fall back to a builtin one.
     */
    modVisualizers?: ModVisualizerDescriptor[];
}

const STATIC_AUDIO_BANDS: AudioBands = {
    bass: motionValue(0),
    lowMid: motionValue(0),
    mid: motionValue(0),
    vocal: motionValue(0),
    treble: motionValue(0),
};

/*
 * Finds the active line index for a timestamp: the last line whose
 * [startTime, endTime) window contains t, or -1 outside any line.
 */
const findActiveLineIndex = (lines: Line[], tSec: number): number => {
    let low = 0;
    let high = lines.length - 1;
    let candidate = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const line = lines[mid];
        if (tSec < line.startTime) {
            high = mid - 1;
        } else if (tSec >= line.endTime) {
            low = mid + 1;
        } else {
            candidate = mid;
            high = mid - 1;
        }
    }
    // Lines are expected sorted; the binary search above returns the first
    // line containing t. A final linear guard keeps safety for unsorted data.
    if (candidate >= 0) {
        return candidate;
    }
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (line && tSec >= line.startTime && tSec < line.endTime) {
            return index;
        }
    }
    return -1;
};

const ModExportPage: React.FC = () => {
    const [config, setConfig] = useState<ExportPageConfig | null>(null);
    const [currentLineIndex, setCurrentLineIndex] = useState(-1);
    const currentTimeRef = useRef<MotionValue<number>>(motionValue(0));
    const audioPowerRef = useRef<MotionValue<number>>(motionValue(0));
    const linesRef = useRef<Line[]>([]);

    const applyLineIndex = useCallback((tSec: number) => {
        const nextIndex = findActiveLineIndex(linesRef.current, tSec);
        setCurrentLineIndex((previous) => (previous === nextIndex ? previous : nextIndex));
    }, []);

    const renderFrame = useCallback(async (tSec: number) => {
        currentTimeRef.current.set(tSec);
        applyLineIndex(tSec);
        // One animation frame is enough: RAF-driven engines (particles, pixi,
        // canvas loops) advance one step, then capturePage forces the
        // compositor to produce the resulting frame synchronously. Waiting for
        // extra settle frames only multiplies export time.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }, [applyLineIndex]);

    // Async on purpose: the injected mod visualizer modules are imported here,
    // and the export service awaits this call, so the mode requested by the
    // snapshot is registered before the first frame is rendered.
    const configure = useCallback(async (nextConfig: ExportPageConfig) => {
        if (nextConfig.modVisualizers?.length) {
            await registerModVisualizers(nextConfig.modVisualizers);
        }
        linesRef.current = nextConfig.lyricData?.lines ?? [];
        setConfig(nextConfig);
        applyLineIndex(Number(nextConfig.startSec ?? 0));
    }, [applyLineIndex]);

    const frameApiRef = useRef({ renderFrame, configure });
    frameApiRef.current.renderFrame = renderFrame;
    frameApiRef.current.configure = configure;

    React.useEffect(() => {
        (window as any).__foliaModExport = {
            renderFrame: (tSec: number) => frameApiRef.current.renderFrame(tSec),
            configure: (nextConfig: ExportPageConfig) => frameApiRef.current.configure(nextConfig),
            dispose: () => {},
        };
        return () => {
            delete (window as any).__foliaModExport;
        };
    }, []);

    const mode = config?.visualizerMode ?? 'classic';
    const effectiveMode: VisualizerMode = hasVisualizerMode(mode) ? mode : 'classic';
    const entry = getVisualizerRegistryEntry(effectiveMode);
    const lines = config?.lyricData?.lines ?? [];
    const theme = config?.theme ?? DEFAULT_THEME;
    // 'theme' fills the container with the song theme background color for an
    // opaque, platform-independent export; 'none' keeps the container fully
    // transparent so lyric text composites over the alpha channel.
    const containerBackground = config?.backgroundMode === 'theme'
        ? (theme.backgroundColor ?? '#09090b')
        : 'transparent';

    // Reuse the song's live visualizer tuning so the exported clip reproduces
    // the on-screen animation instead of falling back to per-mode defaults.
    // `applyVisualizerTuning` mirrors what VisualizerRenderer does in-app.
    const resolvedVisualizerProps = applyVisualizerTuning(effectiveMode, {
        currentTime: currentTimeRef.current,
        currentLineIndex,
        lines,
        theme,
        audioPower: audioPowerRef.current,
        audioBands: STATIC_AUDIO_BANDS,
        showText: true,
        songTitle: config?.songMeta?.title ?? null,
        songArtist: config?.songMeta?.artist ?? null,
        paused: false,
        visualizerOpacity: 1,
        // 'theme' mode keeps the default background renderer; 'none'
        // must pass transparent so the shell does not paint the
        // default opaque theme gradient into the captured frames.
        // `common.disableGeometricBackground` also kills the geometric
        // layer baked into some modes (e.g. fume) that reads the same
        // flag directly instead of going through the shell renderer.
        background: config?.backgroundMode === 'theme'
            ? undefined
            : {
                transparent: true,
                common: { disableGeometricBackground: true, disableVignette: true },
            },
    }, config?.visualizerTunings ?? undefined);

    return (
        <div
            className="w-screen h-screen flex items-center justify-center overflow-hidden relative"
            style={{ backgroundColor: containerBackground }}
        >
            {config ? (
                entry.render(resolvedVisualizerProps)
            ) : (
                <div />
            )}
        </div>
    );
};

const rootElement = document.getElementById('mod-export-root');
if (rootElement) {
    createRoot(rootElement).render(<ModExportPage />);
}