import type { Line } from '../../../types';
import type { VisualizerSharedProps } from '../definition';
import { drawMotesLine } from './motesCanvas';
import { clearMotesMeasurementCache, prepareMotesLine, type MotesPreparedLine } from './motesLayout';
import { createMotesSpace, drawMotesSpace } from './motesSpace';
import type { MotesTuning } from './types';

// Owns a bounded raster cache and one cancellable canvas loop; continuous data never enters React.
export interface MotesRuntimeSnapshot extends VisualizerSharedProps {
    tuning: MotesTuning;
    fontFamily: string;
    fontWeight: number;
    reducedMotion: boolean;
    recentCompletedLine: Line | null;
    upcomingLine: Line | null;
}

export const createMotesRuntime = (
    canvas: HTMLCanvasElement,
    read: () => MotesRuntimeSnapshot,
) => {
    const context = canvas.getContext('2d');
    if (!context) return null;
    let alive = true;
    let frame: number | null = null;
    let width = 0;
    let height = 0;
    let textInset = 0;
    let textWidth = 0;
    let textHeight = 0;
    let dpr = 0;
    let cacheKey = '';
    let heldLines: Line[] | null = null;
    let heldAudioLevel = 0;
    const cache = new Map<Line, MotesPreparedLine>();
    const clock = read().currentTime;
    let spaceSeed = read().seed;
    let space = createMotesSpace(spaceSeed);

    const prepare = (line: Line, state: MotesRuntimeSnapshot) => {
        const held = cache.get(line);
        if (held) {
            cache.delete(line);
            cache.set(line, held);
            return held;
        }
        const value = prepareMotesLine(line, {
            width: textWidth, height: textHeight, fontFamily: state.fontFamily, fontWeight: state.fontWeight,
            fontScale: state.lyricsFontScale ?? 1, density: state.tuning.density, seed: state.seed,
        });
        cache.set(line, value);
        while (cache.size > 3) cache.delete(cache.keys().next().value!);
        return value;
    };

    const draw = () => {
        if (!alive || width <= 0 || height <= 0) return;
        const state = read();
        const key = `${width}|${height}|${state.fontFamily}|${state.fontWeight}|${state.lyricsFontScale ?? 1}|${state.tuning.density}|${state.seed ?? ''}`;
        if (key !== cacheKey || heldLines !== state.lines) {
            cache.clear();
            cacheKey = key;
            heldLines = state.lines;
        }
        context.clearRect(0, 0, width, height);
        if (state.showText === false) return;
        // Props can replace the clock before the old runtime's passive cleanup runs.
        const time = state.currentTime.get();
        const fixed = state.staticMode || state.isPreviewMode || state.reducedMotion;
        const active = state.lines[state.currentLineIndex];
        if (spaceSeed !== state.seed) {
            spaceSeed = state.seed;
            space = createMotesSpace(spaceSeed);
        }
        drawMotesSpace(context, space, {
            width, height, time, theme: state.theme, tuning: state.tuning,
            staticMode: Boolean(fixed),
            reducedMotion: state.reducedMotion || active?.renderHints?.lineTransitionMode === 'none',
        });
        if (!fixed && !state.paused) heldAudioLevel = Math.min(1, Math.max(0, state.audioPower.get() / 255));
        const options = {
            time, theme: state.theme, tuning: state.tuning,
            staticMode: Boolean(fixed), reducedMotion: state.reducedMotion,
            audioLevel: fixed ? 0 : heldAudioLevel,
        };
        const previous = active
            ? state.lines[state.currentLineIndex - 1]
            : state.recentCompletedLine;
        const exitStart = previous ? Math.min(previous.endTime, active?.startTime ?? previous.endTime) : 0;
        // The depth field fills the host, while the lyric keeps its own subtitle-safe viewport.
        context.save();
        context.translate(textInset, height * 0.12);
        if (!fixed && previous && time >= exitStart && time < exitStart + state.tuning.transition) {
            drawMotesLine(context, prepare(previous, state), { ...options, exitStart });
        }
        // A seek can update the clock just before the discrete line index; never paint stale words.
        if (active && (fixed || (time >= active.startTime && time <= active.endTime + state.tuning.transition))) {
            drawMotesLine(context, prepare(active, state), {
                ...options,
                ...(time >= active.endTime ? { exitStart: active.endTime } : {}),
            });
        }
        context.restore();
    };

    const hasVisibleLine = (state: MotesRuntimeSnapshot) => {
        const time = state.currentTime.get();
        const line = state.lines[state.currentLineIndex] ?? state.recentCompletedLine;
        return Boolean(line && time >= line.startTime && time < line.endTime + state.tuning.transition);
    };
    const shouldAnimate = () => {
        const state = read();
        return alive && width > 0 && height > 0 && !document.hidden && state.showText !== false && !state.paused
            && !state.staticMode && !state.isPreviewMode && !state.reducedMotion && hasVisibleLine(state);
    };
    const stop = () => {
        if (frame !== null) window.cancelAnimationFrame(frame);
        frame = null;
    };
    const loop = () => {
        frame = null;
        if (!shouldAnimate()) { draw(); return; }
        draw();
        frame = window.requestAnimationFrame(loop);
    };
    const update = () => {
        if (!alive) return;
        draw();
        if (shouldAnimate()) {
            if (frame === null) frame = window.requestAnimationFrame(loop);
        } else stop();
    };
    const resize = () => {
        if (!alive) return;
        const rect = canvas.getBoundingClientRect();
        const nextDpr = Math.min(2, window.devicePixelRatio || 1);
        if (rect.width === width && rect.height === height && dpr === nextDpr) return;
        width = rect.width;
        height = rect.height;
        textInset = Math.min(width * 0.08, Math.max(16, Math.min(32, width * 0.04)));
        textWidth = Math.max(0, width - textInset * 2);
        textHeight = height * 0.64;
        dpr = nextDpr;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        update();
    };
    const onTime = () => {
        const state = read();
        if (alive && width > 0 && height > 0 && state.showText !== false
            && frame === null && !document.hidden && !state.staticMode && !state.isPreviewMode && !state.reducedMotion
            && (state.paused || hasVisibleLine(state))) update();
    };
    const invalidateFonts = () => {
        if (!alive) return;
        clearMotesMeasurementCache();
        cache.clear();
        update();
    };
    const unsubscribe = clock.on('change', onTime);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', update);
    document.fonts?.addEventListener('loadingdone', invalidateFonts);
    void document.fonts?.ready.then(invalidateFonts);
    resize();

    return {
        update,
        dispose: () => {
            alive = false;
            stop();
            unsubscribe();
            observer.disconnect();
            window.removeEventListener('resize', resize);
            document.removeEventListener('visibilitychange', update);
            document.fonts?.removeEventListener('loadingdone', invalidateFonts);
            cache.clear();
        },
    };
};
