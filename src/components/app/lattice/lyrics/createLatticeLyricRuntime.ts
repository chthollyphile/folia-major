import { cubicBezier } from 'framer-motion';
import { loadPixi } from '../../../visualizer/loadPixi';
import { clearMonetMeasurementCaches, type MonetVisibleLineEntry } from '../../../visualizer/monet/monetLyricsModel';
import { MONET_SCROLL_SPRING, MONET_SCALE_SPRING, resolveMonetTone } from '../../../visualizer/monet/monetLyricMotion';
import { createLatticeRaster } from './latticeLyricRaster';
import { layoutLatticeLine, resolveLatticeTypography, resolveLatticeLongLineOffset } from './latticeLyricLayout';
import { createLatticeLineView, type LatticeLineView } from './latticeLyricScene';
import { createLatticeEdgeFilter } from './latticeLyricFilters';
import { createLatticeTimeline, stepLatticeSpring } from './latticeLyricTimeline';
import { createLatticeLyricFrameLoop } from './latticeLyricFrameLoop';
import type { LatticeLyricInput, LatticeLyricRuntime } from './types';

// src/components/app/lattice/lyrics/createLatticeLyricRuntime.ts
interface Track { view: LatticeLineView; y: number; vy: number; scale: number; vs: number;
    alpha: number; blur: number; fromAlpha: number; fromBlur: number; elapsed: number;
    status: MonetVisibleLineEntry['status']; offset: number; leaving: boolean; }
const ease = cubicBezier(0.32, 0.72, 0, 1);
let initialization: Promise<unknown> = Promise.resolve();

// Passing boolean `true` makes Pixi release module-global pools shared with the Player renderer.
const destroyApplication = (app: import('pixi.js').Application) => {
    app.destroy({ removeView: true }, { children: true });
};

/** Serializes creation so a canceled async mount cannot temporarily allocate a second WebGL context. */
export function createLatticeLyricRuntime(host: HTMLElement, initial: LatticeLyricInput,
    signal: AbortSignal, onError: (error: unknown) => void): Promise<LatticeLyricRuntime | null> {
    const pending = initialization.then(() => initialize(host, initial, signal, onError));
    initialization = pending.catch(() => undefined);
    return pending;
}

async function initialize(host: HTMLElement, initial: LatticeLyricInput, signal: AbortSignal,
    onError: (error: unknown) => void): Promise<LatticeLyricRuntime | null> {
    const pixi = await loadPixi();
    if (signal.aborted) return null;
    const app = new pixi.Application();
    try { await app.init({ preference: 'webgl', backgroundAlpha: 0, antialias: true,
        width: 1, height: 1, resolution: 2, autoDensity: true, autoStart: false, sharedTicker: false }); }
    catch (error) {
        if (app.renderer) destroyApplication(app);
        else { app.ticker?.destroy(); app.stage.destroy({ children: true }); }
        throw error;
    }
    if (signal.aborted) { destroyApplication(app); return null; }
    try { return attachRuntime(pixi, app, host, initial, onError); }
    catch (error) { destroyApplication(app); throw error; }
}

/** Attaches a successfully initialized renderer; failures above this boundary release the WebGL context. */
function attachRuntime(pixi: typeof import('pixi.js'), app: import('pixi.js').Application, host: HTMLElement,
    initial: LatticeLyricInput, onError: (error: unknown) => void): LatticeLyricRuntime {
    const raster = createLatticeRaster(pixi);
    let input = initial, width = 1, height = 1, destroyed = false;
    let typography = resolveLatticeTypography(input, width, height, raster.measure);
    const stage = new pixi.Container(); stage.sortableChildren = true; app.stage.addChild(stage);
    const edge = createLatticeEdgeFilter(pixi); stage.filters = [edge.filter];
    host.appendChild(app.canvas); app.canvas.setAttribute('aria-hidden', 'true');
    let timeline = createLatticeTimeline(input.lines), lastTime = input.currentTime.get();
    let lastEntries: MonetVisibleLineEntry[] | null = null;
    const tracks = new Map<string, Track>();
    const clear = () => { tracks.forEach(track => track.view.destroy()); tracks.clear(); lastEntries = null; };
    const refreshEntries = (entries: MonetVisibleLineEntry[]) => {
        for (const track of tracks.values()) {
            track.leaving = true; track.fromAlpha = track.alpha; track.fromBlur = track.blur; track.elapsed = 0;
        }
        for (const entry of entries) {
            let track = tracks.get(entry.key);
            if (!track) {
                const layout = layoutLatticeLine(entry.line, typography, Math.max(1, width - typography.padding * 2), raster.measure,
                    input.subtitleContentMode === 'romanization');
                const view = createLatticeLineView(pixi, raster, stage, entry, layout, typography, input);
                track = { view, y: height * 0.46 + (entry.offset >= 0 ? 34 : -34), vy: 0, scale: 0.7, vs: 0,
                    alpha: 0, blur: 5, fromAlpha: 0, fromBlur: 5, elapsed: 0, status: entry.status, offset: entry.offset, leaving: false };
                tracks.set(entry.key, track);
            }
            track.status = entry.status; track.offset = entry.offset; track.leaving = false;
        }
        // Rapid seeks must not accumulate fading copies of every visited line.
        for (const [key, track] of tracks) if (track.leaving && tracks.size > 5) { track.view.destroy(); tracks.delete(key); }
    };
    const draw = (delta: number) => {
        try {
            if (destroyed || width < 2 || height < 2) return false;
            const time = input.currentTime.get(), quiet = Boolean(input.reducedMotion || input.staticMode);
            if (time < lastTime || Math.abs(time - lastTime) > 0.75) clear();
            lastTime = time;
            const entries = timeline(time);
            if (entries !== lastEntries) { refreshEntries(entries); lastEntries = entries; }
            const anchor = entries.find(e => e.offset === 0);
            const anchorTrack = anchor ? tracks.get(anchor.key) : undefined;
            const room = Math.max(typography.lineHeight, height - typography.padding * 2);
            const activeHeight = anchorTrack ? Math.min(room, anchorTrack.status === 'active' ? anchorTrack.view.layout.height
                : Math.min(anchorTrack.view.layout.textHeight, typography.lineHeight * 2) * resolveMonetTone(anchorTrack.status, 0).scale) : 0;
            const anchorY = Math.max(typography.padding, height * 0.46 - activeHeight / 2);
            let moving = false;
            for (const [key, track] of tracks) {
                const tone = resolveMonetTone(track.status, track.offset);
                const contextHeight = Math.min(track.view.layout.textHeight, typography.lineHeight * 2);
                const gap = Math.max(18, typography.fontPx * 0.49);
                let targetY = track.offset < 0 ? anchorY - contextHeight * tone.scale - gap
                    : track.offset > 0 ? anchorY + activeHeight + gap : anchorY;
                if (track.offset === 0 && track.status === 'active') targetY -= resolveLatticeLongLineOffset(track.view.layout, time, room, typography.lineHeight);
                if (track.leaving) targetY += track.offset < 0 || track.status === 'passed' ? -38 : 38;
                const sy = stepLatticeSpring(track.y, track.vy, targetY, delta, MONET_SCROLL_SPRING);
                const ss = stepLatticeSpring(track.scale, track.vs, tone.scale, delta, MONET_SCALE_SPRING);
                track.y = quiet ? targetY : sy.value; track.vy = quiet ? 0 : sy.velocity;
                track.scale = quiet ? tone.scale : ss.value; track.vs = quiet ? 0 : ss.velocity;
                track.elapsed += delta;
                const targetAlpha = track.leaving ? 0 : tone.alpha;
                const fade = quiet ? 1 : ease(Math.min(1, track.elapsed / 0.28));
                const blurFade = quiet ? 1 : ease(Math.min(1, track.elapsed / 0.32));
                track.alpha = track.fromAlpha + (targetAlpha - track.fromAlpha) * fade;
                track.blur = track.fromBlur + (tone.blur - track.fromBlur) * blurFade;
                if (track.leaving && fade === 1) { track.view.destroy(); tracks.delete(key); continue; }
                moving ||= !quiet && (!sy.settled || !ss.settled || track.elapsed < 0.32);
                track.view.container.position.set(typography.padding, track.y);
                track.view.container.scale.set(track.scale); track.view.container.alpha = track.alpha;
                track.view.container.zIndex = track.status === 'active' ? 4 : track.status === 'waiting' ? 2 : 1;
                track.view.blur.strength = quiet ? 0 : track.blur;
                track.view.blur.enabled = !quiet && track.blur > 0.05;
                track.view.update(time, track.status, tone.baseAlpha, height, track.y, track.scale, quiet);
            }
            app.render();
            return moving;
        } catch (error) { onError(error); return false; }
    };
    const loop = createLatticeLyricFrameLoop(draw);
    let unsubscribe = input.currentTime.on('change', loop.wake);
    const runtime: LatticeLyricRuntime = {
        update(next) {
            if (destroyed) return;
            const rebuild = next.songKey !== input.songKey || next.lines !== input.lines || next.theme !== input.theme
                || next.subtitleTheme !== input.subtitleTheme || next.fontsEpoch !== input.fontsEpoch
                || next.keywordColoringEnabled !== input.keywordColoringEnabled || next.showSubtitleTranslation !== input.showSubtitleTranslation
                || next.hideTranslationSubtitle !== input.hideTranslationSubtitle || next.subtitleContentMode !== input.subtitleContentMode;
            if (next.currentTime !== input.currentTime) { unsubscribe(); unsubscribe = next.currentTime.on('change', loop.wake); }
            if (next.fontsEpoch !== input.fontsEpoch) { clearMonetMeasurementCaches(); raster.clearMeasureCache(); }
            input = next;
            if (rebuild) { clear(); timeline = createLatticeTimeline(input.lines); typography = resolveLatticeTypography(input, width, height, raster.measure); }
            loop.wake();
        },
        resize(w, h) {
            if (destroyed || (w === width && h === height)) return;
            width = w; height = h;
            app.renderer.resize(Math.max(1, width), Math.max(1, height));
            stage.filterArea = new pixi.Rectangle(0, 0, width, height);
            typography = resolveLatticeTypography(input, width, height, raster.measure);
            clear(); loop.wake();
        },
        setVisible(visible) { loop.setVisible(visible); },
        destroy() {
            if (destroyed) return;
            destroyed = true; unsubscribe(); loop.destroy(); clear(); edge.filter.destroy(); destroyApplication(app);
        },
    };
    return runtime;
}
