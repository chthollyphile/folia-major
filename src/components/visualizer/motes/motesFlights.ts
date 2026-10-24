import type { MotesPreparedLine } from './motesLayout';

// Most glyph samples hold the readable stroke; a sparse subset wanders until its word is reached.
export interface MotesFlightFrame {
    time: number;
    prepared: MotesPreparedLine;
    distance: number;
    margin: number;
}

// lift is the remaining dispersed amount: 1 before the cue and 0 once the grain has assembled.
export interface MotesFlightOffset { x: number; y: number; lift: number; sparkle: number; wordTimed?: boolean }

const unit = (value: number) => Math.max(0, Math.min(1, value));
const smoother = (value: number) => value * value * value * (value * (value * 6 - 15) + 10);
const seededFraction = (seed: number) => {
    const value = Math.sin(seed) * 43758.5453;
    return value - Math.floor(value);
};
const driftingNoise = (time: number, seed: number) => {
    const step = Math.floor(time);
    const blend = smoother(time - step);
    const from = seededFraction(seed + step * 73.7);
    const to = seededFraction(seed + (step + 1) * 73.7);
    return (from + (to - from) * blend) * 2 - 1;
};

// All work stays inside the existing bounded glyph field and the host's single canvas loop.
export const createMotesFlightFrame = (prepared: MotesPreparedLine, time: number, strength: number): MotesFlightFrame | null => {
    const { width, height, fontPx, line } = prepared;
    if (!Number.isFinite(time) || !Number.isFinite(line.startTime) || !Number.isFinite(line.endTime)
        || time < line.startTime || time >= line.endTime || !Number.isFinite(strength) || strength <= 0
        || !line.words.length || !prepared.x.length || !Number.isFinite(width) || !Number.isFinite(height)
        || !Number.isFinite(fontPx) || width <= 12 || height <= 12 || fontPx <= 0) return null;
    return {
        time, prepared,
        distance: Math.min(28, fontPx * 0.6 * Math.min(2, strength)),
        margin: Math.max(4, prepared.particleSize),
    };
};

// A seek resolves dispersed/assembling/formed samples directly; no launch queue or companion grains.
export const resolveMotesFlight = (
    frame: MotesFlightFrame | null, index: number, anchorX: number, anchorY: number, offset: MotesFlightOffset,
) => {
    offset.x = 0; offset.y = 0; offset.lift = 0; offset.sparkle = 0; offset.wordTimed = false;
    if (!frame || !Number.isFinite(anchorX) || !Number.isFinite(anchorY)) return;
    const { prepared, time } = frame;
    const glyph = prepared.timings[prepared.glyphIndices[index]];
    const word = glyph?.wordIndex === undefined ? null : prepared.line.words[glyph.wordIndex];
    // Keep line-only lyrics and unmatched or malformed timing readable instead of inventing a cue.
    if (!word || !Number.isFinite(word.startTime) || !Number.isFinite(word.endTime) || word.endTime <= word.startTime) return;
    const start = Math.max(prepared.line.startTime, word.startTime);
    const end = Math.min(prepared.line.endTime, word.endTime);
    if (end <= start) return;
    offset.wordTimed = true;
    // Keep at least 90% of the actual samples in the stroke, including incomplete groups.
    // Mark timing first so the anchored majority also bypasses whole-line entrance scatter.
    if (index % 10 !== 7 || index >= Math.floor(prepared.x.length / 10) * 10) return;
    const duration = Math.min(0.55, (end - start) * 0.65);
    if (time >= start + duration) return;
    const phase = Number.isFinite(prepared.phases[index]) ? prepared.phases[index] : 0;
    const seed = (index + 1) * 127.1 + phase * 311.7;
    const reach = seededFraction(seed);
    const delay = Math.min(0.09, duration * 0.2) * seededFraction(seed + 71.3);
    const remaining = 1 - smoother(unit((time - start - delay) / (duration - delay)));
    const distance = Math.max(0, Math.min(frame.distance, anchorX - frame.margin,
        prepared.width - frame.margin - anchorX, anchorY - frame.margin, prepared.height - frame.margin - anchorY));
    const angle = phase + index * 2.399963229728653;
    const radius = 0.4 + reach * 0.22;
    // Low-frequency seeded noise changes drift gradually without circling the glyph or changing paths on seek.
    const clock = time - prepared.line.startTime;
    const driftX = driftingNoise(clock * 0.37, seed + 193.7) * 0.24;
    const driftY = driftingNoise(clock * 0.31, seed + 317.9) * 0.24;
    offset.x = (Math.cos(angle) * radius + driftX) * distance * remaining;
    offset.y = (Math.sin(angle) * radius + driftY) * distance * remaining;
    offset.lift = remaining;
    // Independent gentle peaks make waiting grains glint; the word cue fades them back into the stroke.
    offset.sparkle = remaining * (0.5 + 0.5 * Math.sin(clock * (1.4 + reach * 0.5) + seed)) ** 4;
};
