import { Line, Word as WordType } from '../../../types';
import { type GraphemeTiming } from '../../../utils/lyrics/graphemeTiming';
import { getLineTransitionTiming } from '../../../utils/lyrics/renderHints';
import { colorWithAlpha } from '../../../utils/colorMix';
import type { ResolvedLineRenderTiming } from './cadenzaTypes';

// src/components/visualizer/cadenza/cadenzaEnvelopes.ts
// 按播放时间算每个词 / 整行的状态与包络：waiting/active/passed、glow 强度、正文混色、入场离场、passed 漂移。

const graphemeSegmenter = typeof Intl !== 'undefined'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

export const splitGraphemes = (text: string) => {
    if (!text) return [] as string[];
    if (graphemeSegmenter) {
        return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
    }
    return Array.from(text);
};

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const easeOutCubic = (value: number) => 1 - Math.pow(1 - clamp(value, 0, 1), 3);
const easeInOutQuad = (value: number) => {
    const normalized = clamp(value, 0, 1);
    return normalized < 0.5
        ? 2 * normalized * normalized
        : 1 - Math.pow(-2 * normalized + 2, 2) / 2;
};
export const ACTIVE_PULSE_FREQUENCY = 10;

export const isCJK = (text: string) => /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(text);

export const getWordStatus = (time: number, lineTiming: ResolvedLineRenderTiming, word: WordType) => {
    const lookahead = lineTiming.wordRevealMode === 'fast'
        ? 0.045
        : lineTiming.wordRevealMode === 'instant'
            ? 0
            : 0.18;
    const activeEndTime = lineTiming.wordRevealMode === 'instant'
        ? lineTiming.lineRenderEndTime
        : word.endTime;

    if (time >= word.startTime - lookahead && time <= activeEndTime) {
        return 'active' as const;
    }
    if (time > activeEndTime) {
        return 'passed' as const;
    }
    return 'waiting' as const;
};

export const getWordProgress = (time: number, wordRevealMode: ResolvedLineRenderTiming['wordRevealMode'], word: WordType) => {
    if (wordRevealMode === 'instant') {
        return time < word.startTime ? 0 : 1;
    }

    const minDuration = wordRevealMode === 'fast' ? 0.045 : 0.01;
    const duration = Math.max(word.endTime - word.startTime, minDuration);
    return clamp((time - word.startTime) / duration, 0, 1);
};

const getClassicKeyframedGlow = (progress: number) => {
    if (progress <= 0 || progress >= 1) {
        return 0;
    }

    if (progress < 0.3) {
        return easeOutCubic(progress / 0.3);
    }

    return 1 - clamp((progress - 0.3) / 0.7, 0, 1);
};

export const getClassicGlowEnvelope = (time: number, lineTiming: ResolvedLineRenderTiming, word: WordType) => {
    if (lineTiming.wordRevealMode === 'instant') {
        const activeEndTime = lineTiming.lineRenderEndTime;
        if (time < word.startTime || time > activeEndTime) {
            return 0;
        }

        const pulseProgress = clamp((time - word.startTime) / 0.067, 0, 1);
        return getClassicKeyframedGlow(pulseProgress);
    }

    if (lineTiming.wordRevealMode === 'fast') {
        const duration = Math.max(word.endTime - word.startTime, 0.045);

        if (time < word.startTime) {
            return 0;
        }

        if (time <= word.endTime) {
            const progress = clamp((time - word.startTime) / duration, 0, 1);

            if (progress < 0.14) {
                return easeOutCubic(progress / 0.14);
            }

            if (progress < 0.82) {
                return 1;
            }

            return mix(1, 0.92, (progress - 0.82) / 0.18);
        }

        const fadeOut = clamp((time - word.endTime) / 0.14, 0, 1);
        return Math.pow(1 - fadeOut, 2);
    }

    const duration = Math.max(word.endTime - word.startTime, 0.1);

    if (time < word.startTime) {
        return 0;
    }

    if (time <= word.endTime) {
        const progress = clamp((time - word.startTime) / duration, 0, 1);

        if (progress < 0.18) {
            return easeOutCubic(progress / 0.18);
        }

        if (progress < 0.9) {
            return 1;
        }

        return mix(1, 0.9, (progress - 0.9) / 0.1);
    }

    const fadeOut = clamp((time - word.endTime) / 0.9, 0, 1);
    return 0.9 * Math.pow(1 - fadeOut, 2);
};

export const getClassicCharGlow = (
    time: number,
    word: WordType,
    glyphIndex: number,
    glyphCount: number,
    wordGraphemeTimings: GraphemeTiming[] = [],
) => {
    const duration = Math.max(word.endTime - word.startTime, 0.1);
    const singleDuration = duration / Math.max(glyphCount, 1);
    const timing = wordGraphemeTimings[glyphIndex];
    const charDuration = timing ? Math.max(timing.endTime - timing.startTime, 0.001) : singleDuration;
    const charStartTime = timing?.startTime ?? (word.startTime + singleDuration * glyphIndex);
    const animationDuration = charDuration * 6;
    const elapsed = time - charStartTime;
    const activeGlow = elapsed <= 0 ? 0 : getClassicKeyframedGlow(elapsed / animationDuration);

    if (time <= word.endTime) {
        return activeGlow;
    }

    const fadeOut = Math.pow(1 - clamp((time - word.endTime) / 0.9, 0, 1), 2);
    return activeGlow * fadeOut;
};

export const getClassicBodyMix = (time: number, lineTiming: ResolvedLineRenderTiming, word: WordType) => {
    if (lineTiming.wordRevealMode === 'instant') {
        if (time < word.startTime) {
            return 0;
        }

        return time <= lineTiming.lineRenderEndTime ? 1 : 0;
    }

    if (time < word.startTime) {
        return 0;
    }

    if (time <= word.endTime) {
        return getWordProgress(time, lineTiming.wordRevealMode, word);
    }

    const fadeOut = clamp((time - word.endTime) / (lineTiming.wordRevealMode === 'fast' ? 0.12 : 0.8), 0, 1);
    return 1 - fadeOut;
};

export const getClassicLineEnvelope = (time: number, line: Line | null, lineTiming: ResolvedLineRenderTiming) => {
    if (!line) {
        return {
            opacity: 1,
            scale: 1,
            blur: 0,
        };
    }

    const renderHints = lineTiming.renderHints;
    const lineEndTime = lineTiming.lineRenderEndTime;
    const linePassStart = Math.max(lineTiming.lastWordEndTime, line.startTime) + lineTiming.linePassHold;

    if (renderHints?.lineTransitionMode === 'none') {
        return {
            opacity: 1,
            scale: 1,
            blur: 0,
        };
    }

    if (renderHints?.lineTransitionMode === 'fast') {
        const enterDuration = lineTiming.transitionTiming.enterDuration;
        const exitDuration = lineTiming.transitionTiming.exitDuration;
        const exitStart = Math.max(line.startTime + enterDuration + 0.01, linePassStart, lineEndTime - exitDuration);
        const enterProgress = easeOutCubic(clamp((time - line.startTime) / enterDuration, 0, 1));
        let opacity = mix(0.65, 1, enterProgress);
        let scale = mix(0.97, 1, enterProgress);
        let blur = mix(4, 0, enterProgress);

        const exitProgress = easeOutCubic(clamp((time - exitStart) / exitDuration, 0, 1));
        if (exitProgress > 0) {
            opacity = mix(opacity, 0, exitProgress);
            scale = mix(scale, 1.03, exitProgress);
            blur = Math.max(blur, mix(0, 6, exitProgress));
        }

        return {
            opacity: clamp(opacity, 0, 1),
            scale,
            blur,
        };
    }

    const enterDuration = lineTiming.transitionTiming.enterDuration;
    const exitDuration = lineTiming.transitionTiming.exitDuration;
    const preEnter = Math.min(0.1, enterDuration * 0.35);

    const enterProgress = easeOutCubic(clamp((time - (line.startTime - preEnter)) / (enterDuration + preEnter), 0, 1));
    let opacity = mix(0, 1, enterProgress);
    let scale = mix(0.9, 1, enterProgress);
    let blur = mix(10, 0, enterProgress);

    const exitStart = Math.max(linePassStart, lineEndTime - exitDuration);
    const exitProgress = easeOutCubic(clamp((time - exitStart) / exitDuration, 0, 1));
    if (exitProgress > 0) {
        opacity *= 1 - exitProgress;
        scale = mix(scale, 1.1, exitProgress);
        blur = Math.max(blur, mix(0, 20, exitProgress));
    }

    return {
        opacity: clamp(opacity, 0, 1),
        scale,
        blur,
    };
};

export const getClassicPassedDrift = (time: number, word: WordType) => {
    if (time <= word.endTime) {
        return 0;
    }

    return easeInOutQuad(clamp((time - word.endTime) / 5, 0, 1));
};

export const resolveLineRenderTiming = (line: Line): ResolvedLineRenderTiming => {
    // Cadenza needs more than just line endTime.
    // It needs to know when the line should stop feeling "active" and how long the pass-hold should last.
    const renderHints = line.renderHints ?? null;
    const wordRevealMode = renderHints?.wordRevealMode ?? 'normal';
    const lastWord = line.words[line.words.length - 1];
    const rawDuration = renderHints?.rawDuration ?? Math.max(line.endTime - line.startTime, 0);
    const transitionTiming = getLineTransitionTiming(
        rawDuration,
        renderHints?.lineTransitionMode ?? 'normal',
        wordRevealMode
    );

    return {
        renderHints,
        lineRenderEndTime: renderHints?.renderEndTime ?? line.endTime,
        wordRevealMode,
        lastWordEndTime: lastWord?.endTime ?? line.endTime,
        linePassHold: transitionTiming.linePassHold,
        transitionTiming,
    };
};

export const buildDomTextShadow = (color: string, intensity: number, blurScale = 1) => {
    const glow = clamp(intensity, 0, 1.6);
    if (glow <= 0.01) {
        return 'none';
    }

    return [
        `0 0 40px ${colorWithAlpha(color, Math.min(0.98, glow))}`,
        `0 0 40px ${colorWithAlpha(color, Math.min(0.92, glow * 0.92))}`,
        `0 0 40px ${colorWithAlpha(color, Math.min(0.35, glow * 0.26))}`,
    ].join(', ');
};
