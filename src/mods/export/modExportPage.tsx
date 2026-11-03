import React, { Suspense, useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motionValue, type MotionValue } from 'framer-motion';
import '@/index.css';
import './modExportPage.css';
import { DEFAULT_THEME } from '@/services/baseThemes';
import { getVisualizerRegistryEntry, hasVisualizerMode } from '@/components/visualizer/registry';
import { applyVisualizerTuning, type VisualizerTuningBundle } from '@/components/visualizer/tuningRegistry';
import { LyricRenderQualityPinContext } from '@/components/visualizer/renderQuality/lyricRenderQualityPin';
import { DEFAULT_LYRIC_RENDER_QUALITY } from '@/utils/lyricRenderQuality';
import { reconcileFoliumClients } from '../runtime/clientLoader';
import { waitForExportMode } from './exportStart';
import { hydrateFoliumParamsForExport } from '../params/paramStore';
import type { ModRuntimeInfo } from '../types';
import type { AudioBands, Line, Theme, VisualizerMode } from '@/types';
import { NO_LYRIC_LINES } from '@/utils/lyrics/noLyricLines';

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
    /** `duration`: the exported song's length in seconds (absent or 0 when unknown). */
    songMeta: { title?: string; artist?: string; duration?: number } | null;
    startSec?: number;
    backgroundMode?: 'none' | 'theme';
    transparent?: boolean;
    /**
     * Loaded mods with a client entry, injected by the export service. This
     * window runs without a preload, so there is no mod bridge to ask - the
     * clients have to arrive with the config and activate here (in the
     * 'export' context) or a mod visualizerMode would silently fall back to a
     * builtin one.
     */
    modClients?: ModRuntimeInfo[];
    /** Folium parameter values (settings, tunings) the user sees in the app. */
    foliumParams?: Record<string, Record<string, unknown>>;
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

    // Async on purpose: the injected mod clients are imported and activated
    // here, and the export service awaits this call, so the mode requested by
    // the snapshot is registered before the first frame is rendered. Param
    // values land first so the first frame already uses the user's settings.
    // The wait is for every client, with no cap of this window's own, and then
    // for the requested style's own mod if that one is slow and still starting.
    // When the style is a mod's and is not there once that start has ended, the
    // answer says so and the export service stops there (exportStart.ts).
    const configure = useCallback(async (nextConfig: ExportPageConfig): Promise<{ ok: boolean; error?: string }> => {
        hydrateFoliumParamsForExport(nextConfig.foliumParams ?? {});
        if (nextConfig.modClients?.length) {
            await reconcileFoliumClients(nextConfig.modClients, 'export');
        }
        const problem = await waitForExportMode(nextConfig.visualizerMode);
        if (problem) {
            return { ok: false, error: problem };
        }
        linesRef.current = nextConfig.lyricData?.lines ?? [];
        setConfig(nextConfig);
        applyLineIndex(Number(nextConfig.startSec ?? 0));
        return { ok: true };
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
    const lines = config?.lyricData?.lines ?? NO_LYRIC_LINES;
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
        duration: Number(config?.songMeta?.duration) || 0,
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
                <LyricRenderQualityPinContext.Provider value={DEFAULT_LYRIC_RENDER_QUALITY}>
                    {/* 导出固定按 1×、各样式默认的抗锯齿画：不跟「性能与动效」的挡位和样式自己的覆盖。 */}
                    <Suspense fallback={null}>{entry.render(resolvedVisualizerProps)}</Suspense>
                </LyricRenderQualityPinContext.Provider>
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