import type { Theme } from '../../../types';
import type { MotesTuning } from './types';
import type { MotesPreparedLine } from './motesLayout';
import { resolveMotesMaterial } from './motesMaterial';
import { createMotesFlightFrame, resolveMotesFlight } from './motesFlights';

// Time-addressable particle motion: a seek paints the same frame without replaying a simulation.
export const MOTES_GLYPH_ORBIT_PERIOD = 4.8;

interface MotesPhaseOptions {
    time: number;
    startTime: number;
    endTime: number;
    transition: number;
    exitStart?: number;
    staticMode?: boolean;
    reducedMotion?: boolean;
    instant?: boolean;
}

const unit = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
    const t = unit(value);
    return t * t * (3 - 2 * t);
};

export const resolveMotesPhase = ({
    time, startTime, endTime, transition, exitStart, staticMode = false, reducedMotion = false, instant = false,
}: MotesPhaseOptions) => {
    if (staticMode) return { assembly: 1, scatter: 0, opacity: 1 };
    if (time < startTime) return { assembly: 0, scatter: 1, opacity: 0 };
    if (reducedMotion) return { assembly: 1, scatter: 0, opacity: exitStart !== undefined && time >= exitStart ? 0 : 1 };
    const duration = Math.max(0, endTime - startTime);
    const transitionTime = Number.isFinite(transition) ? Math.max(0.15, Math.min(0.8, transition)) : 0.45;
    // Short phrases become readable early; renderEndTime is never borrowed for assembly.
    const enterTime = Math.min(transitionTime, duration * 0.28);
    const assembly = instant || enterTime <= 0 ? 1 : smooth((time - startTime) / enterTime);
    const exit = exitStart === undefined ? 0 : smooth((time - exitStart) / transitionTime);
    return { assembly, scatter: Math.max(1 - assembly, exit), opacity: (0.25 + assembly * 0.75) * (1 - exit) };
};

export interface MotesDrawOptions {
    time: number;
    theme: Pick<Theme, 'primaryColor' | 'accentColor'>;
    tuning: MotesTuning;
    staticMode?: boolean;
    reducedMotion?: boolean;
    audioLevel?: number;
    exitStart?: number;
    opacity?: number;
}

// The host clears the canvas, allowing an outgoing and an incoming sentence to share one frame.
export const drawMotesLine = (
    context: CanvasRenderingContext2D,
    prepared: MotesPreparedLine,
    { time, theme, tuning, staticMode = false, reducedMotion = false, audioLevel = 0, exitStart, opacity = 1 }: MotesDrawOptions,
) => {
    const reduced = reducedMotion || prepared.line.renderHints?.lineTransitionMode === 'none';
    const phase = resolveMotesPhase({
        time, startTime: prepared.line.startTime, endTime: prepared.line.endTime,
        transition: tuning.transition, exitStart, staticMode, reducedMotion: reduced,
        instant: prepared.line.renderHints?.wordRevealMode === 'instant',
    });
    const alpha = phase.opacity * unit(opacity);
    if (alpha <= 0 || prepared.x.length === 0) return;
    const scatter = phase.scatter * (Number.isFinite(tuning.scatter) ? Math.max(0, Math.min(2, tuning.scatter)) : 1);
    const audio = staticMode || reduced ? 0 : unit(Number.isFinite(audioLevel) ? audioLevel : 0);
    const size = prepared.particleSize * (1 + audio * unit(tuning.audioResponse) * 0.4);
    const drift = staticMode || reduced ? 0 : unit(Number.isFinite(tuning.drift) ? tuning.drift : 0.6);
    const settledDrift = drift * phase.assembly * (1 - phase.scatter);
    const clock = Number.isFinite(time) ? time : 0;
    const motionStrength = settledDrift / 0.6;
    const orbitRange = Math.min(1, prepared.fontPx * 0.02) * Math.min(1, motionStrength);
    const orbitScale = Math.PI * 2 / Math.max(1, prepared.fontPx * 3);
    const orbitClock = clock * Math.PI * 2 / MOTES_GLYPH_ORBIT_PERIOD;
    const flightFrame = createMotesFlightFrame(prepared, clock, drift / 0.6);
    const flight = { x: 0, y: 0, lift: 0, sparkle: 0, wordTimed: false };
    const material = resolveMotesMaterial(context, theme.primaryColor, theme.accentColor || theme.primaryColor);
    context.save();
    context.fillStyle = theme.primaryColor;
    // Two cached materials, no per-particle paths, gradients, shadows or temporary objects.
    for (let highlighted = 0; highlighted <= 1; highlighted += 1) {
        context.fillStyle = highlighted ? theme.accentColor || theme.primaryColor : theme.primaryColor;
        const grain = highlighted ? material?.accent : material?.primary;
        for (let index = 0; index < prepared.x.length; index += 1) {
            const glyph = prepared.timings[prepared.glyphIndices[index]];
            const word = glyph?.wordIndex === undefined ? null : prepared.line.words[glyph.wordIndex];
            const active = !staticMode && Boolean(word && time >= word.startTime && time < word.endTime);
            if (Number(active) !== highlighted) continue;
            resolveMotesFlight(flightFrame, index, prepared.x[index], prepared.y[index], flight);
            // Word timing owns entrance formation; retain the whole-line scatter only for exit or fallback.
            const pointScatter = flight.wordTimed && exitStart === undefined ? 0 : scatter;
            const scatterWave = Math.sin(clock * 1.8 + prepared.phases[index]) * 9 * pointScatter;
            const seedPhase = prepared.phases[index];
            // Each grain also moves inside its stroke. Low-coverage edges get a smaller orbit.
            const localPhase = (prepared.x[index] + prepared.y[index] * 0.35) * orbitScale - orbitClock;
            const radius = orbitRange * (0.3 + prepared.alpha[index] * 0.7);
            const x = prepared.x[index] + prepared.scatterX[index] * pointScatter + scatterWave
                + Math.cos(localPhase) * radius * 0.55 + flight.x;
            const y = prepared.y[index] + prepared.scatterY[index] * pointScatter + scatterWave * 0.55
                + Math.sin(localPhase) * radius + flight.y;
            // Only the sparse waiting grains glint; one original sample still means one draw.
            const moteSize = size * (0.95 + Math.sin(seedPhase) * 0.05) * (1 + flight.sparkle * 0.35);
            context.globalAlpha = alpha * prepared.alpha[index] * (1 - flight.lift * 0.5 + flight.sparkle * 0.5);
            if (grain) context.drawImage(grain, x - moteSize / 2, y - moteSize / 2, moteSize, moteSize);
            else context.fillRect(x - moteSize / 2, y - moteSize / 2, moteSize, moteSize);
        }
    }
    context.restore();
};
