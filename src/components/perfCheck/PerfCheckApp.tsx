import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Gauge, X } from 'lucide-react';
import VisualizerRenderer from '../visualizer/VisualizerRenderer';
import { LyricRenderQualityGlobalContext } from '../visualizer/renderQuality/lyricRenderQualityPin';
import { DEFAULT_THEME } from '../../services/baseThemes';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { findLatestActiveLineIndex } from '../../utils/appPlaybackHelpers';
import { errorMessage } from '../../utils/errorText';
import { requestUncappedAnimationFrame, cancelUncappedAnimationFrame, setGlobalVisualizerFrameRate } from '../../utils/frameRateLimiter';
import { FIXTURE_SECONDS, buildFixtureLines, fixtureBands } from './perfCheckFixture';
import { PerfCheckCancelled, runPerfCheck, type PerfCheckProgress } from './perfCheckRunner';
import PerfCheckResults from './PerfCheckResults';
import { settingsLine } from './perfCheckText';
import type { PerfCheckReport, PerfCheckSettings } from './perfCheckTypes';

// src/components/perfCheck/PerfCheckApp.tsx
// The performance check's window (`?perfCheck=1`, opened by electron/perfCheck.cjs): a fixed, fairly
// heavy lyric style (凝彩, Pixi, which follows both the canvas resolution and the antialiasing
// setting) drawn full-window over a looped made-up lyric, while perfCheckRunner.ts steps through the
// settings and runs the GPU analysis beside it. The settings it tries stay in this window - the
// frame-rate cap is this window's own, the resolution and antialiasing go in through the context the
// OBS source pins them with - and reach the user's settings only through "apply", in the main window.

/** The reference style: heavy enough to show what the analysis costs, and it follows all three settings. */
const REFERENCE_STYLE = 'tempera';

const PerfCheckApp: React.FC = () => {
    const { t } = useTranslation();
    const current = useMemo<PerfCheckSettings>(() => {
        const state = useVisualizerSettingsStore.getState();
        return { frameRate: state.visualizerFrameRate, scale: state.lyricRenderQuality.scale, antialias: state.lyricRenderQuality.antialias };
    }, []);
    const [settings, setSettings] = useState<PerfCheckSettings>(current);
    const [progress, setProgress] = useState<PerfCheckProgress | null>(null);
    const [report, setReport] = useState<PerfCheckReport | null>(null);
    const [failed, setFailed] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    const lines = useMemo(() => buildFixtureLines(), []);
    const [lineIndex, setLineIndex] = useState(-1);
    const lineIndexRef = useRef(-1);
    const currentTime = useMotionValue(0);
    const audioPower = useMotionValue(0);
    const bass = useMotionValue(0);
    const lowMid = useMotionValue(0);
    const mid = useMotionValue(0);
    const vocal = useMotionValue(0);
    const treble = useMotionValue(0);
    const audioBands = useMemo(() => ({ bass, lowMid, mid, vocal, treble }), [bass, lowMid, mid, vocal, treble]);

    useEffect(() => {
        document.title = t('perfCheck.title');
        document.body.style.overflow = 'hidden';
        document.body.style.backgroundColor = '#000';
    }, [t]);

    // The song clock and band levels, every display frame (uncapped: the clock is not the picture).
    useEffect(() => {
        let handle = 0;
        const started = performance.now();
        const tick = (at: number) => {
            const time = ((at - started) / 1000) % FIXTURE_SECONDS;
            currentTime.set(time);
            const bands = fixtureBands(time);
            audioPower.set(bands.power);
            bass.set(bands.bass);
            lowMid.set(bands.lowMid);
            mid.set(bands.mid);
            vocal.set(bands.vocal);
            treble.set(bands.treble);
            const index = findLatestActiveLineIndex(lines, time);
            if (index !== lineIndexRef.current) {
                lineIndexRef.current = index;
                setLineIndex(index);
            }
            handle = requestUncappedAnimationFrame(tick);
        };
        handle = requestUncappedAnimationFrame(tick);
        return () => cancelUncappedAnimationFrame(handle);
    }, [audioPower, bass, currentTime, lines, lowMid, mid, treble, vocal]);

    const apply = useCallback((next: PerfCheckSettings) => {
        // This window's own cap, never stored: the main window keeps its own.
        setGlobalVisualizerFrameRate(next.frameRate);
        setSettings(next);
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        abortRef.current = controller;
        // This window's console does not reach the runtime log (first-party windows only): the main process writes these.
        const log = (text: string) => {
            console.info(`[PerfCheck] ${text}`);
            void window.electron?.logPerfCheck?.(text).catch(() => undefined);
        };
        log(`started from ${current.frameRate}/${current.scale}/${current.antialias}`);
        // The main window holds its picture and GPU analysis only while this measures: done or failed, it lets go.
        const finish = () => { void window.electron?.finishPerfCheck?.().catch(() => undefined); };
        runPerfCheck({ current, apply, onProgress: setProgress, signal: controller.signal })
            .then((result) => {
                finish();
                setReport(result);
                apply(result.steps[result.recommended].settings);
                const rows = result.steps.map((step, index) => (
                    `${index}: ${step.settings.frameRate}/${step.settings.scale}/${step.settings.antialias} picture ${step.picture.fps.toFixed(0)} fps`
                    + ` (1% ${step.picture.lowFps.toFixed(0)}), with analysis ${step.withAnalysis.fps.toFixed(0)} fps (1% ${step.withAnalysis.lowFps.toFixed(0)},`
                    + ` ${(step.withAnalysis.droppedShare * 100).toFixed(0)}% late), segment ${step.inference.segmentMs?.toFixed(0) ?? '-'} ms`
                    + ` (${step.inference.realtime?.toFixed(1) ?? '-'}x), beats ${step.inference.beatsMs?.toFixed(0) ?? '-'} ms${step.smooth ? ', smooth' : ''}`
                ));
                log(`done at ${result.refreshHz.toFixed(0)} Hz on ${REFERENCE_STYLE}, recommends step ${result.recommended}${result.gpuAnalysis ? '' : ', no GPU analysis'};`
                    + ` app ${result.memory.appMb?.toFixed(0) ?? '-'} MB (GPU process ${result.memory.gpuProcessMb?.toFixed(0) ?? '-'} MB), heap ${result.memory.heapMb?.toFixed(0) ?? '-'} MB, models ${result.memory.modelsMb.toFixed(0)} MB\n${rows.join('\n')}`);
            })
            .catch((error: unknown) => {
                // Cancelled: the window is closing (which ends the hold), or React remounted this in development.
                if (error instanceof PerfCheckCancelled) return;
                finish();
                console.warn('[PerfCheck] failed', error);
                log(`failed: ${errorMessage(error)}`);
                setFailed(true);
            });
        return () => controller.abort();
    }, [apply, current]);

    const close = () => {
        abortRef.current?.abort();
        window.close();
    };

    // Each step is two halves (lyrics alone, then with the analysis); the warm-up counts as one more.
    const done = !progress || progress.phase === 'warmup' ? 0 : 1 + progress.step * 2 + (progress.phase === 'analysis' ? 1 : 0);
    const total = progress ? 1 + progress.steps * 2 : 1;
    const phaseText = !progress || progress.phase === 'warmup'
        ? t('perfCheck.phaseWarmup')
        : t(progress.phase === 'picture' ? 'perfCheck.phasePicture' : 'perfCheck.phaseAnalysis');

    return (
        <div className="fixed inset-0 overflow-hidden bg-black" style={{ color: DEFAULT_THEME.primaryColor }}>
            <LyricRenderQualityGlobalContext.Provider value={{ scale: settings.scale, antialias: settings.antialias }}>
                <VisualizerRenderer
                    mode={REFERENCE_STYLE}
                    visualizerTunings={{}}
                    currentTime={currentTime}
                    duration={FIXTURE_SECONDS}
                    currentLineIndex={lineIndex}
                    lines={lines}
                    theme={DEFAULT_THEME}
                    isDaylight={false}
                    audioPower={audioPower}
                    audioBands={audioBands}
                    songTitle={t('perfCheck.songTitle')}
                    songArtist="Folia"
                    showText={true}
                    seed="perf-check"
                    paused={false}
                    isPlayerChromeHidden={true}
                />
            </LyricRenderQualityGlobalContext.Provider>
            {!report && (
                <div className="absolute left-4 top-4 z-50 flex w-[22rem] max-w-[calc(100%-2rem)] items-start gap-3 rounded-2xl bg-black/75 px-4 py-3 text-sm text-white shadow-xl backdrop-blur">
                    <Gauge className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
                    <div className="min-w-0 flex-1">
                        <div className="font-medium">{t('perfCheck.running')}</div>
                        {failed ? (
                            <div className="mt-1 text-white/70">{t('perfCheck.failed')}</div>
                        ) : (
                            <>
                                <div className="mt-1 text-white/80">{phaseText}</div>
                                {progress && progress.phase !== 'warmup' && (
                                    <div className="mt-0.5 text-xs text-white/55">
                                        {t('perfCheck.trying', { step: progress.step + 1, steps: progress.steps, settings: settingsLine(t, progress.settings) })}
                                    </div>
                                )}
                                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                                    <div className="h-full rounded-full bg-white/70 transition-[width] duration-500" style={{ width: `${Math.round((done / total) * 100)}%` }} />
                                </div>
                                <div className="mt-2 text-xs text-white/45">{t('perfCheck.keepWindow')}</div>
                            </>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={close}
                        className="rounded-full p-1 text-white/70 transition hover:bg-white/10 hover:text-white"
                        title={t(failed ? 'perfCheck.close' : 'perfCheck.cancel')}
                        aria-label={t(failed ? 'perfCheck.close' : 'perfCheck.cancel')}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}
            {report && <PerfCheckResults report={report} current={current} onPreview={apply} onClose={close} />}
        </div>
    );
};

export default PerfCheckApp;
