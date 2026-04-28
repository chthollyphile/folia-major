import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { useMotionValue } from 'framer-motion';
import '../../../src/i18n/config';
import '../../../src/index.css';
import VisualizerRenderer from '../../../src/components/visualizer/VisualizerRenderer';
import { VISUALIZER_REGISTRY } from '../../../src/components/visualizer/registry';
import { applyDetectedChorusEffects } from '../../../src/utils/lyrics/chorusEffects';
import { detectTimedLyricFormat } from '../../../src/utils/lyrics/formatDetection';
import { parseLyricsByFormat } from '../../../src/utils/lyrics/parserCore';
import { getLineRenderEndTime } from '../../../src/utils/lyrics/renderHints';
import { type Line, type LyricData, type Theme, type VisualizerMode } from '../../../src/types';

interface VisualizerBenchmarkFixture {
    name: string;
    source: string;
    benchmarkWindow: {
        startSeconds: number;
        endSeconds: number;
        description: string;
    };
    lrc: string;
    tlyric: string;
}

interface BenchmarkState {
    ready: boolean;
    done: boolean;
    mode: VisualizerMode;
    fixtureName: string;
    benchmarkWindow: VisualizerBenchmarkFixture['benchmarkWindow'];
    durationSeconds: number;
    playbackStartSeconds: number;
    playbackEndSeconds: number;
    currentTime: number;
    currentLineIndex: number;
    activeLineChanges: number;
    frameCount: number;
    droppedFrames: number;
    longFrames: number;
    fps: number;
    longTasks: Array<{ startTime: number; duration: number; name: string }>;
    domNodeCount: number;
    jsHeapUsedSize?: number;
    jsHeapTotalSize?: number;
}

declare global {
    interface Window {
        __FOLIA_VISUALIZER_BENCHMARK_FIXTURE__?: VisualizerBenchmarkFixture;
        __foliaVisualizerBenchmark?: () => BenchmarkState;
    }
}

const VALID_MODES = new Set<VisualizerMode>(VISUALIZER_REGISTRY.map(entry => entry.mode));

const BENCHMARK_THEME: Theme = {
    name: 'Visualizer Benchmark',
    backgroundColor: '#09090b',
    primaryColor: '#f4f4f5',
    accentColor: '#38bdf8',
    secondaryColor: '#a1a1aa',
    fontStyle: 'sans',
    animationIntensity: 'normal',
};

const parseNumberParam = (params: URLSearchParams, key: string, fallback: number) => {
    const parsed = Number(params.get(key));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const findCurrentLineIndex = (lines: Line[], time: number) => {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (!line || time < line.startTime) {
            continue;
        }

        if (time <= getLineRenderEndTime(line)) {
            return index;
        }
    }

    return -1;
};

const getBenchmarkFixture = () => {
    const fixture = window.__FOLIA_VISUALIZER_BENCHMARK_FIXTURE__;
    if (!fixture?.lrc) {
        throw new Error('Missing visualizer benchmark fixture. Inject window.__FOLIA_VISUALIZER_BENCHMARK_FIXTURE__ before loading this page.');
    }
    return fixture;
};

const parseFixtureLyrics = (fixture: VisualizerBenchmarkFixture): LyricData => {
    const format = detectTimedLyricFormat(fixture.lrc);
    const parsed = parseLyricsByFormat(format, fixture.lrc, fixture.tlyric);
    return applyDetectedChorusEffects(parsed, fixture.lrc);
};

const VisualizerBenchmarkApp: React.FC = () => {
    const params = new URLSearchParams(window.location.search);
    const requestedMode = params.get('mode') as VisualizerMode | null;
    const mode = requestedMode && VALID_MODES.has(requestedMode) ? requestedMode : 'classic';
    const speed = parseNumberParam(params, 'speed', 1);
    const fixture = useMemo(getBenchmarkFixture, []);
    const playbackStartSeconds = fixture.benchmarkWindow.startSeconds;
    const playbackEndSeconds = fixture.benchmarkWindow.endSeconds;

    const currentTime = useMotionValue(playbackStartSeconds);
    const audioPower = useMotionValue(0);
    const bass = useMotionValue(0);
    const lowMid = useMotionValue(0);
    const mid = useMotionValue(0);
    const vocal = useMotionValue(0);
    const treble = useMotionValue(0);
    const [renderTime, setRenderTime] = useState(playbackStartSeconds);
    const stateRef = useRef<BenchmarkState | null>(null);
    const lastLineIndexRef = useRef(-1);
    const activeLineChangesRef = useRef(0);
    const longTasksRef = useRef<BenchmarkState['longTasks']>([]);
    const frameStatsRef = useRef({
        startedAt: 0,
        lastFrameAt: 0,
        frameCount: 0,
        droppedFrames: 0,
        longFrames: 0,
    });

    const lyricData = useMemo(() => parseFixtureLyrics(fixture), [fixture]);
    const durationSeconds = Math.max(0, playbackEndSeconds - playbackStartSeconds);

    const currentLineIndex = useMemo(
        () => findCurrentLineIndex(lyricData.lines, renderTime),
        [lyricData.lines, renderTime],
    );

    useEffect(() => {
        const observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                longTasksRef.current.push({
                    startTime: entry.startTime,
                    duration: entry.duration,
                    name: entry.name,
                });
            }
        });

        try {
            observer.observe({ entryTypes: ['longtask'] });
        } catch {
            // Some browsers can disable longtask entries; the rest of the benchmark still works.
        }

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        let animationFrame = 0;
        const startedAt = performance.now();
        frameStatsRef.current.startedAt = startedAt;
        frameStatsRef.current.lastFrameAt = startedAt;

        const tick = (now: number) => {
            const stats = frameStatsRef.current;
            const delta = now - stats.lastFrameAt;
            stats.lastFrameAt = now;
            stats.frameCount += 1;

            if (delta > 1000 / 30) {
                stats.droppedFrames += 1;
            }
            if (delta > 50) {
                stats.longFrames += 1;
            }

            const elapsedSeconds = ((now - startedAt) / 1000) * speed;
            const nextTime = Math.min(playbackStartSeconds + elapsedSeconds, playbackEndSeconds);
            currentTime.set(nextTime);
            setRenderTime(nextTime);

            const energy = 0.45 + Math.sin(nextTime * 3.1) * 0.25 + Math.sin(nextTime * 0.47) * 0.12;
            audioPower.set(Math.max(0, Math.min(1, energy)));
            bass.set(0.35 + Math.sin(nextTime * 1.9) * 0.2);
            lowMid.set(0.38 + Math.sin(nextTime * 2.4 + 0.8) * 0.2);
            mid.set(0.42 + Math.sin(nextTime * 3.2 + 1.7) * 0.18);
            vocal.set(0.52 + Math.sin(nextTime * 2.8 + 2.6) * 0.22);
            treble.set(0.34 + Math.sin(nextTime * 4.1 + 3.2) * 0.16);

            if (nextTime < playbackEndSeconds) {
                animationFrame = requestAnimationFrame(tick);
            }
        };

        animationFrame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(animationFrame);
    }, [audioPower, bass, currentTime, lowMid, mid, playbackEndSeconds, playbackStartSeconds, speed, treble, vocal]);

    useEffect(() => {
        if (currentLineIndex !== lastLineIndexRef.current) {
            activeLineChangesRef.current += 1;
            lastLineIndexRef.current = currentLineIndex;
        }
    }, [currentLineIndex]);

    useEffect(() => {
        window.__foliaVisualizerBenchmark = () => {
            const stats = frameStatsRef.current;
            const elapsedSeconds = Math.max((performance.now() - stats.startedAt) / 1000, 0.001);
            const memory = (performance as Performance & {
                memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number };
            }).memory;

            stateRef.current = {
                ready: true,
                done: renderTime >= playbackEndSeconds,
                mode,
                fixtureName: fixture.name,
                benchmarkWindow: fixture.benchmarkWindow,
                durationSeconds,
                playbackStartSeconds,
                playbackEndSeconds,
                currentTime: renderTime,
                currentLineIndex,
                activeLineChanges: activeLineChangesRef.current,
                frameCount: stats.frameCount,
                droppedFrames: stats.droppedFrames,
                longFrames: stats.longFrames,
                fps: stats.frameCount / elapsedSeconds,
                longTasks: longTasksRef.current.slice(),
                domNodeCount: document.querySelectorAll('*').length,
                jsHeapUsedSize: memory?.usedJSHeapSize,
                jsHeapTotalSize: memory?.totalJSHeapSize,
            };

            return stateRef.current;
        };

        return () => {
            delete window.__foliaVisualizerBenchmark;
        };
    }, [currentLineIndex, durationSeconds, fixture.benchmarkWindow, fixture.name, mode, playbackEndSeconds, playbackStartSeconds, renderTime]);

    return (
        <div className="h-screen w-screen overflow-hidden" style={{ backgroundColor: BENCHMARK_THEME.backgroundColor }}>
            <VisualizerRenderer
                mode={mode}
                currentTime={currentTime}
                currentLineIndex={currentLineIndex}
                lines={lyricData.lines}
                theme={BENCHMARK_THEME}
                audioPower={audioPower}
                audioBands={{ bass, lowMid, mid, vocal, treble }}
                showText
                seed={`${fixture.name}-${mode}`}
                staticMode={false}
                backgroundOpacity={1}
                lyricsFontScale={1}
            />
        </div>
    );
};

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Could not find root element to mount visualizer benchmark');
}

ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
        <VisualizerBenchmarkApp />
    </React.StrictMode>,
);
