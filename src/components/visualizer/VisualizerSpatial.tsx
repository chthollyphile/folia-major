import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionValue, motion, useAnimationControls, useMotionValueEvent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { AudioBands, Line, Theme, Word } from '../../types';
import { getLineRenderEndTime, getLineRenderHints } from '../../utils/lyrics/renderHints';
import { useVisualizerRuntime } from './runtime';
import VisualizerShell from './VisualizerShell';
import VisualizerSubtitleOverlay from './VisualizerSubtitleOverlay';

interface VisualizerSpatialProps {
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
    backgroundOpacity?: number;
    lyricsFontScale?: number;
    onBack?: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const graphemeSegmenter = typeof Intl !== 'undefined'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
const splitGraphemes = (text: string) => {
    if (!text) return [] as string[];
    if (graphemeSegmenter) {
        return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
    }
    return Array.from(text);
};

const isCJK = (text: string) => /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(text);
const isLatinOrDigit = (text: string) => /[A-Za-z0-9]/.test(text);

const getWordScriptProfile = (text: string) => {
    const hasCJK = isCJK(text);
    const hasLatin = isLatinOrDigit(text);
    if (hasCJK && hasLatin) return 'mixed' as const;
    if (hasCJK) return 'cjk' as const;
    if (hasLatin) return 'latin' as const;
    return 'other' as const;
};

const estimateWordWidthUnits = (graphemes: string[]) => {
    if (graphemes.length === 0) return 1;
    return graphemes.reduce((sum, grapheme) => {
        if (/^\s+$/.test(grapheme)) return sum + 0.36;
        if (isCJK(grapheme)) return sum + 1;
        if (isLatinOrDigit(grapheme)) return sum + 0.64;
        return sum + 0.82;
    }, 0);
};

const estimateWordWidthUnitsFromText = (text: string) => {
    if (!text) return 1;
    if (/^\s+$/.test(text)) return Math.max(text.length * 0.36, 0.36);
    if (isCJK(text)) return Math.max(text.length, 1);
    if (isLatinOrDigit(text)) return Math.max(text.length * 0.64, 0.64);
    return Math.max(text.length * 0.82, 0.82);
};

const getActiveColor = (wordText: string, theme: Theme) => {
    if (!theme.wordColors || theme.wordColors.length === 0) {
        return theme.accentColor;
    }

    const cleanCurrent = wordText.trim();
    const matched = theme.wordColors.find(entry => {
        const target = entry.word;
        if (isCJK(cleanCurrent)) {
            return target.includes(cleanCurrent);
        }

        const targetWords = target.split(/\s+/).map(value => value.toLowerCase().replace(/[^\w]/g, ''));
        const normalizedCurrent = cleanCurrent.toLowerCase().replace(/[^\w]/g, '');
        return targetWords.includes(normalizedCurrent);
    });

    return matched?.color ?? theme.accentColor;
};

const SPATIAL_INTENSITY_PRESETS = {
    calm: {
        sequenceSpreadCurrent: 72,
        sequenceSpreadOther: 60,
        spreadCurrent: 165,
        spreadOther: 122,
        jitterX: 20,
        jitterY: 118,
        edgeYBoost: 32,
        zRange: 170,
        zEdgeBoost: 58,
        nextTargetZ: -620,
        nextInitialZ: -1520,
        nextWordInitialZ: -240,
        waitingWordDepth: -46,
        cameraYaw: 1.05,
        cameraPitch: 0.45,
        roleDurationCurrent: 0.62,
        roleDurationOther: 0.74,
    },
    normal: {
        sequenceSpreadCurrent: 86,
        sequenceSpreadOther: 72,
        spreadCurrent: 220,
        spreadOther: 165,
        jitterX: 34,
        jitterY: 168,
        edgeYBoost: 56,
        zRange: 230,
        zEdgeBoost: 80,
        nextTargetZ: -860,
        nextInitialZ: -1880,
        nextWordInitialZ: -320,
        waitingWordDepth: -68,
        cameraYaw: 1.8,
        cameraPitch: 0.8,
        roleDurationCurrent: 0.52,
        roleDurationOther: 0.66,
    },
    chaotic: {
        sequenceSpreadCurrent: 102,
        sequenceSpreadOther: 86,
        spreadCurrent: 282,
        spreadOther: 215,
        jitterX: 48,
        jitterY: 226,
        edgeYBoost: 84,
        zRange: 310,
        zEdgeBoost: 128,
        nextTargetZ: -1160,
        nextInitialZ: -2320,
        nextWordInitialZ: -430,
        waitingWordDepth: -92,
        cameraYaw: 2.55,
        cameraPitch: 1.2,
        roleDurationCurrent: 0.44,
        roleDurationOther: 0.58,
    },
} as const;

const getWordStatus = (time: number, word: Word, isCurrentLine: boolean) => {
    if (!isCurrentLine) return 'ambient' as const;
    if (time < word.startTime) return 'waiting' as const;
    if (time <= word.endTime) return 'active' as const;
    return 'passed' as const;
};

const getWordLookahead = (wordRevealMode: 'normal' | 'fast' | 'instant') => {
    if (wordRevealMode === 'instant') return 0.03;
    if (wordRevealMode === 'fast') return 0.08;
    return 0.15;
};

const getWordActiveEndTime = (
    word: Word,
    lineRenderEndTime: number,
    wordRevealMode: 'normal' | 'fast' | 'instant',
) => {
    if (wordRevealMode === 'instant') return lineRenderEndTime;
    if (wordRevealMode === 'fast') return Math.min(lineRenderEndTime, Math.max(word.endTime, word.startTime + 0.12));
    return word.endTime;
};

const getPassedGlowHold = (
    wordRevealMode: 'normal' | 'fast' | 'instant',
    animationIntensity: Theme['animationIntensity'],
) => {
    const base = wordRevealMode === 'instant' ? 0.55 : wordRevealMode === 'fast' ? 0.85 : 1.35;
    const intensityScale = animationIntensity === 'chaotic' ? 1.1 : animationIntensity === 'calm' ? 0.9 : 1;
    return base * intensityScale;
};

const getWordProgress = (
    time: number,
    word: Word,
    lineRenderEndTime: number,
    wordRevealMode: 'normal' | 'fast' | 'instant',
) => {
    const activeEndTime = getWordActiveEndTime(word, lineRenderEndTime, wordRevealMode);
    const minDuration = wordRevealMode === 'instant' ? 0.08 : wordRevealMode === 'fast' ? 0.12 : 0.1;
    const duration = Math.max(activeEndTime - word.startTime, minDuration);
    return clamp((time - word.startTime) / duration, 0, 1);
};

const getClassicGlowRadii = (wordRevealMode: 'normal' | 'fast' | 'instant') => {
    if (wordRevealMode === 'instant') return { inner: 14, outer: 24 };
    if (wordRevealMode === 'fast') return { inner: 18, outer: 32 };
    return { inner: 20, outer: 40 };
};

const getClassicGlowPulse = (progress: number, wordRevealMode: 'normal' | 'fast' | 'instant') => {
    const peakAt = wordRevealMode === 'instant' ? 0.35 : wordRevealMode === 'fast' ? 0.4 : 0.3;
    const clampedProgress = clamp(progress, 0, 1);
    if (clampedProgress <= peakAt) {
        return clamp(clampedProgress / Math.max(peakAt, 0.01), 0, 1);
    }
    return clamp(1 - (clampedProgress - peakAt) / Math.max(1 - peakAt, 0.01), 0, 1);
};

const getSpatialWordStatus = (
    time: number,
    word: Word,
    isCurrentLine: boolean,
    lineRenderEndTime: number,
    wordRevealMode: 'normal' | 'fast' | 'instant',
) => {
    if (!isCurrentLine) return 'ambient' as const;
    const lookahead = getWordLookahead(wordRevealMode);
    const activeEndTime = getWordActiveEndTime(word, lineRenderEndTime, wordRevealMode);
    if (time >= word.startTime - lookahead && time <= activeEndTime) return 'active' as const;
    if (time > activeEndTime) return 'passed' as const;
    return 'waiting' as const;
};

type SpatialRole = 'current' | 'previous' | 'next';
type SpatialWordRevealMode = 'normal' | 'fast' | 'instant';
type SpatialIntensityPreset = typeof SPATIAL_INTENSITY_PRESETS[Theme['animationIntensity']];
type SpatialRenderTier = 'full' | 'reduced' | 'instant';

interface SpatialRenderProfile {
    lineRenderEndTime: number;
    wordRevealMode: SpatialWordRevealMode;
    renderTier: SpatialRenderTier;
    shouldSplitGlyphs: boolean;
}

interface SpatialWordLayout {
    id: string;
    lanePush: number;
    antiCenterBias: number;
    randomX: number;
    y: number;
    z: number;
    rotateZ: number;
    scale: number;
    activeColor: string;
    graphemes: string[];
    scriptProfile: ReturnType<typeof getWordScriptProfile>;
    estimatedWidth: number;
    x: number;
    shouldSplitGlyphs: boolean;
}

interface SpatialPreparedLayout {
    renderProfile: SpatialRenderProfile;
    words: SpatialWordLayout[];
}

interface SpatialNextHintProfile {
    renderTier: SpatialRenderTier;
    opacity: number;
    blur: number;
    scale: number;
    z: number;
    y: number;
    duration: number;
}

interface SpatialCanvasWordState {
    text: string;
    x: number;
    y: number;
    z: number;
    rotateZ: number;
    scale: number;
    opacity: number;
    color: string;
    shadowColor: string;
    shadowBlur: number;
}

interface SpatialExitCanvasSnapshot {
    id: string;
    line: Line;
    preparedLayout: SpatialPreparedLayout;
    theme: Theme;
    lyricsFontScale: number;
    horizontalScale: number;
    viewportWidth: number;
}

const SPATIAL_LAYOUT_CACHE_LIMIT = 64;
const spatialLayoutCache = new Map<string, SpatialPreparedLayout>();

const resolveSpatialRenderProfile = (line: Line): SpatialRenderProfile => {
    const renderHints = getLineRenderHints(line);
    const wordRevealMode = renderHints?.wordRevealMode ?? 'normal';
    const isInstantLine = renderHints?.timingClass === 'micro' || wordRevealMode === 'instant';
    const isReducedLine = renderHints?.timingClass === 'short' || wordRevealMode === 'fast';
    const renderTier: SpatialRenderTier = isInstantLine ? 'instant' : isReducedLine ? 'reduced' : 'full';

    return {
        lineRenderEndTime: getLineRenderEndTime(line),
        wordRevealMode,
        renderTier,
        shouldSplitGlyphs: renderTier === 'full',
    };
};

const getSpatialThemeCacheKey = (theme: Theme) => {
    const wordColorsKey = theme.wordColors
        ?.map(entry => `${entry.word}:${entry.color}`)
        .join(',')
        ?? '';
    return [
        theme.animationIntensity,
        theme.accentColor,
        theme.primaryColor,
        theme.secondaryColor,
        wordColorsKey,
    ].join('|');
};

const buildSpatialLayoutCacheKey = (
    line: Line,
    role: SpatialRole,
    theme: Theme,
    renderProfile: SpatialRenderProfile,
) => [
    role,
    line.startTime,
    line.endTime,
    line.fullText,
    line.words.length,
    renderProfile.wordRevealMode,
    renderProfile.renderTier,
    renderProfile.shouldSplitGlyphs ? 1 : 0,
    getSpatialThemeCacheKey(theme),
].join('|');

const getOrBuildSpatialLayout = (
    line: Line,
    role: SpatialRole,
    theme: Theme,
    intensityPreset: SpatialIntensityPreset,
): SpatialPreparedLayout => {
    const renderProfile = resolveSpatialRenderProfile(line);
    const cacheKey = buildSpatialLayoutCacheKey(line, role, theme, renderProfile);
    const cached = spatialLayoutCache.get(cacheKey);
    if (cached) {
        spatialLayoutCache.delete(cacheKey);
        spatialLayoutCache.set(cacheKey, cached);
        return cached;
    }

    const seed = line.startTime * 1000;
    const count = Math.max(line.words.length, 1);
    const sequenceSpread = role === 'current'
        ? intensityPreset.sequenceSpreadCurrent
        : intensityPreset.sequenceSpreadOther;
    const wordsMeta = line.words.map((word, index) => {
        const random = (offset: number) => {
            const x = Math.sin(seed + index * 17.37 + offset) * 10000;
            return x - Math.floor(x);
        };
        const spreadBase = role === 'current' ? intensityPreset.spreadCurrent : intensityPreset.spreadOther;
        const normalized = count <= 1 ? 0 : (index / (count - 1)) * 2 - 1;
        const lanePush = normalized * spreadBase * 0.95;
        const antiCenterBias = Math.sign(normalized || (index % 2 === 0 ? 1 : -1)) * 34;
        const activeColor = getActiveColor(word.text, theme);
        const graphemes = renderProfile.shouldSplitGlyphs ? splitGraphemes(word.text) : [];
        const scriptProfile = getWordScriptProfile(word.text);
        const widthUnits = renderProfile.shouldSplitGlyphs
            ? estimateWordWidthUnits(graphemes)
            : estimateWordWidthUnitsFromText(word.text);
        const estimatedWidth = Math.max(sequenceSpread * 0.62, widthUnits * sequenceSpread * 0.78);
        return {
            id: `${line.startTime}-${index}-${word.text}`,
            lanePush,
            antiCenterBias,
            randomX: (random(1) - 0.5) * intensityPreset.jitterX,
            y: (random(2) - 0.5) * intensityPreset.jitterY + (Math.abs(normalized) > 0.55 ? (random(6) - 0.5) * intensityPreset.edgeYBoost : 0),
            z: (random(3) - 0.5) * intensityPreset.zRange + Math.abs(normalized) * intensityPreset.zEdgeBoost,
            rotateZ: (random(4) - 0.5) * 10,
            scale: 0.96 + random(5) * 0.28,
            activeColor,
            graphemes,
            scriptProfile,
            estimatedWidth,
            shouldSplitGlyphs: renderProfile.shouldSplitGlyphs,
        };
    });

    // Responsive word packing: use estimated token width to avoid CJK/Latin overlap.
    const centers: number[] = [];
    let cursor = 0;
    wordsMeta.forEach((meta, index) => {
        if (index > 0) {
            const prev = wordsMeta[index - 1]!;
            const baseGap = sequenceSpread * 0.54;
            const mixedGapBoost = prev.scriptProfile === 'mixed' || meta.scriptProfile === 'mixed' ? sequenceSpread * 0.1 : 0;
            const scriptSwapBoost = prev.scriptProfile !== meta.scriptProfile ? sequenceSpread * 0.16 : 0;
            const latinCjkBoost = (
                (prev.scriptProfile === 'latin' && meta.scriptProfile === 'cjk') ||
                (prev.scriptProfile === 'cjk' && meta.scriptProfile === 'latin')
            ) ? sequenceSpread * 0.12 : 0;
            cursor += baseGap + mixedGapBoost + scriptSwapBoost + latinCjkBoost;
        }

        const center = cursor + meta.estimatedWidth / 2;
        centers.push(center);
        cursor += meta.estimatedWidth;
    });

    const totalWidth = Math.max(cursor, sequenceSpread);
    const halfWidth = totalWidth / 2;
    const preparedLayout = {
        renderProfile,
        words: wordsMeta.map((meta, index) => ({
            ...meta,
            // Keep strict reading order: monotonic sequence centers + limited jitter.
            x: (centers[index]! - halfWidth) + meta.lanePush * 0.5 + meta.antiCenterBias + meta.randomX,
        })),
    };

    spatialLayoutCache.set(cacheKey, preparedLayout);
    if (spatialLayoutCache.size > SPATIAL_LAYOUT_CACHE_LIMIT) {
        const oldestKey = spatialLayoutCache.keys().next().value;
        if (oldestKey) {
            spatialLayoutCache.delete(oldestKey);
        }
    }

    return preparedLayout;
};

const getSpatialNextHintProfile = (line: Line): SpatialNextHintProfile | null => {
    const { renderTier } = resolveSpatialRenderProfile(line);
    if (renderTier === 'full') {
        return {
            renderTier,
            opacity: 0.38,
            blur: 7,
            scale: 0.78,
            z: -520,
            y: -46,
            duration: 0.34,
        };
    }

    if (renderTier === 'instant') {
        return {
            renderTier,
            opacity: 0.2,
            blur: 4,
            scale: 0.68,
            z: -420,
            y: -38,
            duration: 0.16,
        };
    }

    return {
        renderTier,
        opacity: 0.34,
        blur: 6,
        scale: 0.74,
        z: -480,
        y: -44,
        duration: 0.24,
    };
};

const shouldUseSpatialDomNext = (activeLine: Line | null, upcomingLine: Line | null) => {
    if (!upcomingLine) {
        return false;
    }

    const upcomingProfile = resolveSpatialRenderProfile(upcomingLine);
    if (upcomingProfile.renderTier !== 'full') {
        return false;
    }

    if (!activeLine) {
        return true;
    }

    const activeProfile = resolveSpatialRenderProfile(activeLine);
    if (activeProfile.renderTier !== 'full') {
        return false;
    }

    const activeRawDuration = activeLine.renderHints?.rawDuration ?? Math.max(activeLine.endTime - activeLine.startTime, 0);
    const upcomingRawDuration = upcomingLine.renderHints?.rawDuration ?? Math.max(upcomingLine.endTime - upcomingLine.startTime, 0);
    const leadToUpcoming = upcomingLine.startTime - activeLine.startTime;
    const gapAfterActive = upcomingLine.startTime - activeProfile.lineRenderEndTime;

    return (
        activeRawDuration >= 0.55
        && upcomingRawDuration >= 0.55
        && leadToUpcoming >= 0.58
        && gapAfterActive >= -0.12
    );
};

const getSpatialFontStack = (theme: Theme) => theme.fontFamily || (
    theme.fontStyle === 'serif'
        ? 'Georgia, "Times New Roman", serif'
        : theme.fontStyle === 'mono'
            ? '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
            : 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
);

const getSpatialOverflowFitScale = (
    wordLayout: SpatialWordLayout[],
    horizontalScale: number,
    viewportWidth: number,
) => {
    if (wordLayout.length === 0) return 1;
    const safeHalfViewport = Math.max(96, viewportWidth * 0.5 - 88);
    let furthestEdge = 0;

    for (const layout of wordLayout) {
        const halfWord = layout.estimatedWidth * horizontalScale * 0.5;
        const edge = Math.abs(layout.x * horizontalScale) + halfWord;
        if (edge > furthestEdge) {
            furthestEdge = edge;
        }
    }

    if (furthestEdge <= safeHalfViewport) return 1;
    return clamp(safeHalfViewport / furthestEdge, 0.48, 1);
};

const buildSpatialCanvasWordStates = ({
    line,
    preparedLayout,
    theme,
    now,
    horizontalScale,
    viewportWidth,
    mode,
}: {
    line: Line;
    preparedLayout: SpatialPreparedLayout;
    theme: Theme;
    now: number;
    horizontalScale: number;
    viewportWidth: number;
    mode: 'next' | 'exit';
}): SpatialCanvasWordState[] => {
    const intensityPreset = SPATIAL_INTENSITY_PRESETS[theme.animationIntensity];
    const { lineRenderEndTime, wordRevealMode } = preparedLayout.renderProfile;
    const overflowFitScale = getSpatialOverflowFitScale(preparedLayout.words, horizontalScale, viewportWidth);
    const glowRadii = getClassicGlowRadii(wordRevealMode);

    return line.words.map((word, index) => {
        const layout = preparedLayout.words[index]!;
        const outerY = mode === 'next' ? -34 : 0;
        const outerZ = mode === 'next' ? intensityPreset.nextTargetZ : 0;
        const highlightStatus = mode === 'next' ? 'ambient' : 'passed';
        const spatialStatus = mode === 'next' ? 'waiting' : 'passed';
        const progress = getWordProgress(now, word, lineRenderEndTime, wordRevealMode);
        const activeGlow = getClassicGlowPulse(progress, wordRevealMode);
        const passedFade = mode === 'exit' ? 0.42 : 0;
        const activeColor = layout.activeColor;
        const color = highlightStatus === 'active'
            ? activeColor
            : highlightStatus === 'passed'
                ? activeColor
                : theme.secondaryColor;
        const baseOpacity = mode === 'next'
            ? 0.46
            : highlightStatus === 'active'
                ? 1
                : highlightStatus === 'passed'
                    ? 0.62 + passedFade * 0.22
                    : 0.35;
        const targetZ = mode === 'next'
            ? outerZ + layout.z + intensityPreset.waitingWordDepth
            : layout.z + (spatialStatus === 'active' ? -36 : spatialStatus === 'passed' ? 46 : intensityPreset.waitingWordDepth);
        const shadowStrength = highlightStatus === 'active'
            ? clamp(activeGlow * 0.92, 0, 1)
            : highlightStatus === 'passed'
                ? passedFade * 0.38
                : 0;

        return {
            text: word.text,
            x: layout.x * horizontalScale * overflowFitScale,
            y: mode === 'next' ? outerY + layout.y : layout.y + (spatialStatus === 'active' ? -2 : 0),
            z: targetZ,
            rotateZ: layout.rotateZ + (mode === 'exit' && spatialStatus === 'passed' ? 4 : 0),
            scale: layout.scale * (mode === 'next' ? 0.9 : 1),
            opacity: baseOpacity,
            color,
            shadowColor: activeColor,
            shadowBlur: shadowStrength * glowRadii.inner,
        };
    });
};

const drawSpatialCanvasWords = (
    canvas: HTMLCanvasElement,
    words: SpatialCanvasWordState[],
    theme: Theme,
    lyricsFontScale: number,
    viewportWidth: number,
    options: {
        baseOpacity: number;
        baseBlur: number;
        fontScale: number;
    },
) => {
    const context = canvas.getContext('2d');
    if (!context) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const cssWidth = Math.max(320, Math.min(viewportWidth, 1120));
    const cssHeight = 620;
    const centerY = cssHeight / 2;
    const targetWidth = Math.round(cssWidth * dpr);
    const targetHeight = Math.round(cssHeight * dpr);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
    }
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    const baseFontSize = clamp(cssWidth * 0.055 * lyricsFontScale * options.fontScale, 22, 46 * lyricsFontScale);
    const fontStack = getSpatialFontStack(theme);
    const fontSize = baseFontSize;
    context.font = `700 ${fontSize}px ${fontStack}`;

    for (const word of words) {
        const projectedScale = clamp(1450 / Math.max(860, 1450 - word.z), 0.62, 1.42);
        context.save();
        context.translate(cssWidth / 2 + word.x * projectedScale, centerY + word.y * projectedScale);
        context.rotate(word.rotateZ * Math.PI / 180);
        context.scale(word.scale * projectedScale, word.scale * projectedScale);
        context.globalAlpha = clamp(word.opacity * options.baseOpacity, 0, 1);
        context.filter = options.baseBlur > 0 ? `blur(${options.baseBlur}px)` : 'none';
        context.shadowColor = word.shadowColor;
        context.shadowBlur = word.shadowBlur;
        context.fillStyle = word.color;
        context.fillText(word.text, 0, 0);
        context.restore();
    }

    context.filter = 'none';
    context.globalAlpha = 1;
    context.shadowBlur = 0;
};

const SpatialCanvasNextHint: React.FC<{
    line: Line | null;
    visible: boolean;
    theme: Theme;
    lyricsFontScale: number;
    horizontalScale: number;
    viewportWidth: number;
}> = ({ line, visible, theme, lyricsFontScale, horizontalScale, viewportWidth }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const profile = useMemo(() => line ? getSpatialNextHintProfile(line) : null, [line]);
    const preparedLayout = useMemo(
        () => line ? getOrBuildSpatialLayout(line, 'next', theme, SPATIAL_INTENSITY_PRESETS[theme.animationIntensity]) : null,
        [line, theme]
    );

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (!line || !profile || !preparedLayout) {
            const context = canvas.getContext('2d');
            context?.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        const words = buildSpatialCanvasWordStates({
            line,
            preparedLayout,
            theme,
            now: line.startTime,
            horizontalScale,
            viewportWidth,
            mode: 'next',
        });
        drawSpatialCanvasWords(canvas, words, theme, lyricsFontScale, viewportWidth, {
            baseOpacity: 0.9,
            baseBlur: profile.blur,
            fontScale: profile.scale,
        });
    }, [horizontalScale, line, lyricsFontScale, preparedLayout, profile, theme, viewportWidth]);

    return (
        <motion.canvas
            ref={canvasRef}
            className="absolute inset-0 m-auto pointer-events-none select-none"
            style={{
                transformStyle: 'preserve-3d',
            }}
            initial={false}
            animate={{
                opacity: visible && profile ? profile.opacity : 0,
                y: visible && profile ? profile.y : 0,
                z: visible && profile ? profile.z : 0,
                scale: visible ? 1 : 0.98,
            }}
            transition={{ duration: profile?.duration ?? 0.12, ease: [0.2, 0.8, 0.22, 1] }}
            aria-hidden="true"
        />
    );
};

const SpatialExitCanvas: React.FC<{
    snapshot: SpatialExitCanvasSnapshot | null;
    onDone: (id: string) => void;
}> = ({ snapshot, onDone }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const controls = useAnimationControls();
    const renderTier = snapshot?.preparedLayout.renderProfile.renderTier ?? 'full';
    const intensityPreset = snapshot ? SPATIAL_INTENSITY_PRESETS[snapshot.theme.animationIntensity] : SPATIAL_INTENSITY_PRESETS.normal;
    const duration = intensityPreset.roleDurationCurrent;

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (!snapshot) {
            return;
        }

        controls.stop();
        const words = buildSpatialCanvasWordStates({
            line: snapshot.line,
            preparedLayout: snapshot.preparedLayout,
            theme: snapshot.theme,
            now: snapshot.line.endTime,
            horizontalScale: snapshot.horizontalScale,
            viewportWidth: snapshot.viewportWidth,
            mode: 'exit',
        });
        drawSpatialCanvasWords(canvas, words, snapshot.theme, snapshot.lyricsFontScale, snapshot.viewportWidth, {
            baseOpacity: renderTier === 'instant' ? 0.72 : renderTier === 'reduced' ? 0.82 : 0.9,
            baseBlur: 0,
            fontScale: 1,
        });
        controls.set({ opacity: 1, y: 0, z: 0, scale: 1, filter: 'blur(0px)' });
        controls.start({
            opacity: 0,
            y: 94,
            z: 760,
            scale: 1,
            filter: 'blur(8px)',
            transition: { duration, ease: [0.2, 0.8, 0.22, 1] },
        }).then(() => onDone(snapshot.id));
    }, [controls, duration, onDone, renderTier, snapshot]);

    return (
        <motion.canvas
            ref={canvasRef}
            className="absolute inset-0 m-auto pointer-events-none select-none"
            style={{
                transformStyle: 'preserve-3d',
            }}
            initial={false}
            animate={controls}
            aria-hidden="true"
        />
    );
};

const SpatialWordCloud: React.FC<{
    line: Line;
    role: SpatialRole;
    theme: Theme;
    lyricsFontScale: number;
    audioPower: MotionValue<number>;
    now: number;
    horizontalScale: number;
    viewportWidth: number;
}> = ({ line, role, theme, lyricsFontScale, audioPower, now, horizontalScale, viewportWidth }) => {
    const energy = clamp(audioPower.get() / 255, 0, 1);
    const isCurrentLine = role === 'current';
    const intensityPreset = SPATIAL_INTENSITY_PRESETS[theme.animationIntensity];
    const preparedLayout = useMemo(
        () => getOrBuildSpatialLayout(line, role, theme, intensityPreset),
        [intensityPreset, line, role, theme]
    );
    const wordLayout = preparedLayout.words;
    const { lineRenderEndTime, renderTier, shouldSplitGlyphs, wordRevealMode } = preparedLayout.renderProfile;
    const isInstantLine = renderTier === 'instant';
    const isReducedLine = renderTier === 'reduced';
    const passedGlowHold = getPassedGlowHold(wordRevealMode, theme.animationIntensity);
    const previousElapsed = Math.max(0, now - lineRenderEndTime);
    const previousFadeWindow = wordRevealMode === 'instant' ? 0.32 : wordRevealMode === 'fast' ? 0.52 : 0.82;
    const previousPresence = role === 'previous'
        ? Math.pow(1 - clamp(previousElapsed / previousFadeWindow, 0, 1), 2.4)
        : 1;

    const roleEnvelope = useMemo(() => {
        if (role === 'previous') return { z: 520, y: 82, opacity: 0.45, blur: 4 };
        if (role === 'next') return { z: intensityPreset.nextTargetZ, y: -34, opacity: 0.36, blur: 5 };
        return { z: 0, y: 0, opacity: 1, blur: 0 };
    }, [intensityPreset.nextTargetZ, role]);

    const overflowFitScale = useMemo(() => {
        if (wordLayout.length === 0) return 1;
        // Reserve side padding so tails/glows still stay visible.
        const safeHalfViewport = Math.max(96, viewportWidth * 0.5 - 88);
        let furthestEdge = 0;

        for (const layout of wordLayout) {
            const halfWord = layout.estimatedWidth * horizontalScale * 0.5;
            const edge = Math.abs(layout.x * horizontalScale) + halfWord;
            if (edge > furthestEdge) {
                furthestEdge = edge;
            }
        }

        if (furthestEdge <= safeHalfViewport) return 1;
        return clamp(safeHalfViewport / furthestEdge, 0.48, 1);
    }, [horizontalScale, viewportWidth, wordLayout]);

    const mainFontSize = `clamp(${(2.1 * lyricsFontScale).toFixed(3)}rem, ${(5.8 * lyricsFontScale).toFixed(3)}vw, ${(3.95 * lyricsFontScale).toFixed(3)}rem)`;

    return (
        <motion.div
            className="absolute left-1/2 top-1/2 pointer-events-none select-none"
            style={{
                x: '-50%',
                y: '-50%',
                transformStyle: 'preserve-3d',
            }}
            initial={{
                opacity: isInstantLine
                    ? roleEnvelope.opacity * previousPresence
                    : isReducedLine
                        ? role === 'next' ? 0.14 : role === 'previous' ? 0.28 : 0.24
                        : role === 'next' ? 0 : role === 'previous' ? 0.2 : 0.08,
                z: isInstantLine
                    ? roleEnvelope.z
                    : isReducedLine
                        ? roleEnvelope.z + (role === 'next' ? -180 : role === 'previous' ? -120 : -96)
                        : role === 'next' ? intensityPreset.nextInitialZ : role === 'previous' ? 120 : -320,
                y: isInstantLine
                    ? roleEnvelope.y
                    : isReducedLine
                        ? roleEnvelope.y + (role === 'next' ? -10 : 12)
                        : role === 'next' ? -36 : role === 'previous' ? 40 : 20,
                filter: isInstantLine
                    ? 'none'
                    : isReducedLine
                        ? role === 'next' ? 'blur(5px)' : role === 'previous' ? 'blur(1px)' : 'blur(3px)'
                        : role === 'next' ? 'blur(18px)' : role === 'previous' ? 'blur(2px)' : 'blur(10px)',
            }}
            animate={{
                opacity: roleEnvelope.opacity * previousPresence,
                z: roleEnvelope.z,
                y: roleEnvelope.y,
                filter: isInstantLine
                    ? 'none'
                    : role === 'previous'
                        ? `blur(${(roleEnvelope.blur + (1 - previousPresence) * (isReducedLine ? 2.4 : 8)).toFixed(2)}px)`
                        : roleEnvelope.blur > 0
                            ? `blur(${isReducedLine ? Math.max(1, roleEnvelope.blur * 0.45) : roleEnvelope.blur}px)`
                            : 'blur(0px)',
            }}
            exit={{
                opacity: 0,
                z: roleEnvelope.z,
                y: roleEnvelope.y,
                filter: 'none',
                transition: {
                    duration: 0.01,
                    ease: 'easeOut',
                },
            }}
            transition={{
                duration: isInstantLine
                    ? 0.12
                    : isReducedLine
                        ? isCurrentLine ? 0.16 : 0.22
                        : isCurrentLine ? intensityPreset.roleDurationCurrent : intensityPreset.roleDurationOther,
                ease: [0.2, 0.8, 0.22, 1],
            }}
        >
            {line.words.map((word, index) => {
                const layout = wordLayout[index]!;
                const status = getSpatialWordStatus(now, word, isCurrentLine, lineRenderEndTime, wordRevealMode);
                const highlightStatus = getWordStatus(now, word, isCurrentLine);
                const progress = getWordProgress(now, word, lineRenderEndTime, wordRevealMode);
                const activeColor = layout.activeColor;
                const passedElapsed = Math.max(0, now - word.endTime);
                const passedFade = highlightStatus === 'passed'
                    ? Math.pow(1 - clamp(passedElapsed / passedGlowHold, 0, 1), 2)
                    : 0;
                const color = highlightStatus === 'active'
                    ? activeColor
                    : highlightStatus === 'passed'
                        ? `color-mix(in srgb, ${activeColor} 72%, ${theme.primaryColor} 28%)`
                        : theme.secondaryColor;
                const alpha = highlightStatus === 'active'
                    ? 1
                    : highlightStatus === 'passed'
                        ? (0.62 + passedFade * 0.22)
                        : role === 'next'
                            ? 0.5
                            : 0.35;
                const targetZ = layout.z + (status === 'active' ? -36 : status === 'passed' ? 46 : intensityPreset.waitingWordDepth);
                const depthBlur = isInstantLine || isReducedLine || highlightStatus === 'active'
                    ? 0
                    : clamp(Math.abs(targetZ) / 220, 0, 2.8);
                const strokePulse = highlightStatus === 'active'
                    ? (0.5 + Math.sin(progress * Math.PI) * 0.65 + energy * 0.3)
                    : 0;
                const glowRadii = getClassicGlowRadii(wordRevealMode);
                const activeGlow = getClassicGlowPulse(progress, wordRevealMode);
                const wordGlowStrength = Math.round(clamp(activeGlow * (0.92 + energy * 0.16), 0, 1) * 100);
                const wordGlowTailStrength = Math.round(clamp(activeGlow * (0.82 + energy * 0.12), 0, 1) * 100);
                const wordTextShadow = highlightStatus === 'active'
                    ? isInstantLine || isReducedLine
                        ? `0 0 ${glowRadii.inner}px color-mix(in srgb, ${activeColor} ${wordGlowStrength}%, transparent)`
                        : `0 0 ${glowRadii.inner}px color-mix(in srgb, ${activeColor} ${wordGlowStrength}%, transparent), 0 0 ${glowRadii.outer}px color-mix(in srgb, ${activeColor} ${wordGlowTailStrength}%, transparent)`
                    : 'none';
                const trailOpacity = shouldSplitGlyphs && highlightStatus === 'active'
                    ? clamp(0.16 + (1 - progress) * 0.14 + energy * 0.08, 0, 0.34)
                    : 0;
                const graphemes = layout.graphemes;
                const glyphCount = shouldSplitGlyphs ? Math.max(graphemes.length, 1) : 1;

                const positionedX = layout.x * horizontalScale * overflowFitScale;
                const targetScale = layout.scale * (status === 'active' ? 1.08 + energy * 0.04 : status === 'waiting' ? 0.9 : 1);

                return (
                    <React.Fragment key={layout.id}>
                        {trailOpacity > 0.01 && (
                            <>
                                <motion.span
                                    className="absolute left-1/2 top-1/2 whitespace-nowrap font-bold"
                                    style={{
                                        fontSize: mainFontSize,
                                        color: activeColor,
                                        transformStyle: 'preserve-3d',
                                        pointerEvents: 'none',
                                        filter: 'blur(1.8px)',
                                        textShadow: `0 0 ${glowRadii.inner}px color-mix(in srgb, ${activeColor} 55%, transparent)`,
                                    }}
                                    initial={false}
                                    animate={{
                                        x: positionedX - 14,
                                        y: layout.y + 4,
                                        z: targetZ + 10,
                                        rotateZ: layout.rotateZ,
                                        scale: layout.scale * 1.03,
                                        opacity: trailOpacity * 0.7,
                                    }}
                                    transition={{ duration: 0.16, ease: 'easeOut' }}
                                >
                                    {word.text}
                                </motion.span>
                                <motion.span
                                    className="absolute left-1/2 top-1/2 whitespace-nowrap font-bold"
                                    style={{
                                        fontSize: mainFontSize,
                                        color: activeColor,
                                        transformStyle: 'preserve-3d',
                                        pointerEvents: 'none',
                                        filter: 'blur(2.6px)',
                                        textShadow: `0 0 ${glowRadii.outer}px color-mix(in srgb, ${activeColor} 42%, transparent)`,
                                    }}
                                    initial={false}
                                    animate={{
                                        x: positionedX - 22,
                                        y: layout.y + 8,
                                        z: targetZ + 16,
                                        rotateZ: layout.rotateZ,
                                        scale: layout.scale * 1.06,
                                        opacity: trailOpacity * 0.45,
                                    }}
                                    transition={{ duration: 0.2, ease: 'easeOut' }}
                                >
                                    {word.text}
                                </motion.span>
                            </>
                        )}
                        <motion.span
                            className="absolute left-1/2 top-1/2 whitespace-nowrap font-bold"
                            style={{
                                fontSize: mainFontSize,
                                color,
                                transformStyle: 'preserve-3d',
                                textShadow: wordTextShadow,
                                WebkitTextStroke: highlightStatus === 'active'
                                    ? `${(0.45 + strokePulse * 0.5).toFixed(2)}px color-mix(in srgb, ${activeColor} 82%, transparent)`
                                    : '0px transparent',
                                filter: depthBlur > 0 ? `blur(${depthBlur.toFixed(2)}px)` : 'none',
                            }}
                            initial={{
                                x: isInstantLine ? positionedX : isReducedLine ? positionedX * 1.04 : positionedX * 1.12,
                                y: isInstantLine ? layout.y + (status === 'active' ? -2 : 0) : isReducedLine ? layout.y + 10 : layout.y + 26,
                                z: isInstantLine ? targetZ : isReducedLine ? targetZ - 24 : layout.z + (role === 'next' ? intensityPreset.nextWordInitialZ : role === 'previous' ? 140 : -24),
                                rotateZ: isInstantLine ? layout.rotateZ + (status === 'passed' ? 4 : 0) : isReducedLine ? layout.rotateZ + 2 : layout.rotateZ + 6,
                                scale: isInstantLine ? targetScale : isReducedLine ? Math.max(0.82, targetScale - 0.08) : role === 'next' ? Math.max(0.58, layout.scale - 0.34) : Math.max(0.75, layout.scale - 0.2),
                                opacity: isInstantLine ? (role === 'next' ? Math.min(alpha, 0.34) : alpha) : isReducedLine ? (role === 'next' ? Math.min(alpha, 0.28) : Math.max(alpha * 0.6, 0.22)) : role === 'next' ? 0.04 : 0,
                            }}
                            animate={{
                                x: positionedX,
                                y: layout.y + (status === 'active' ? -2 : 0),
                                z: targetZ,
                                rotateZ: layout.rotateZ + (status === 'passed' ? 4 : 0),
                                scale: targetScale,
                                opacity: role === 'next' ? Math.min(alpha, 0.34) : alpha,
                            }}
                            transition={{
                                duration: isInstantLine ? 0.08 : isReducedLine ? 0.12 : status === 'active' ? 0.14 : 0.36,
                                ease: status === 'active' ? 'easeOut' : [0.2, 0.75, 0.25, 1],
                            }}
                        >
                            {glyphCount <= 1 ? (
                                word.text
                            ) : (
                                graphemes.map((grapheme, glyphIndex) => {
                                // Flowing "Luminous" style: each glyph receives the highlight wave in sequence.
                                const headStretch = wordRevealMode === 'instant'
                                    ? 0.8
                                    : wordRevealMode === 'fast'
                                        ? 1
                                        : 1.35;
                                const head = progress * (glyphCount + 0.45) * headStretch;
                                const distanceFromHead = head - glyphIndex;
                                const leadWidth = wordRevealMode === 'instant' ? 0.62 : wordRevealMode === 'fast' ? 0.78 : 0.9;
                                const tailLength = wordRevealMode === 'instant' ? 2.4 : wordRevealMode === 'fast' ? 3.6 : 4.8;
                                const lead = clamp(1 - Math.abs(distanceFromHead - 0.1) / leadWidth, 0, 1);
                                const tail = distanceFromHead >= 0 ? clamp(1 - distanceFromHead / tailLength, 0, 1) : 0;
                                const glyphEnergy = highlightStatus === 'active'
                                    ? clamp(lead * 0.95 + tail * 0.52, 0, 1.35)
                                    : highlightStatus === 'passed'
                                        ? (0.08 + passedFade * 0.22) * clamp(1 - glyphIndex / Math.max(glyphCount, 1) * 0.35, 0.35, 1)
                                        : 0;
                                const glyphGlow = Math.max(0, glyphEnergy * (0.96 + energy * 0.14));
                                const glyphGlowMain = Math.round(clamp(glyphGlow, 0, 1) * 100);
                                const glyphGlowTail = Math.round(clamp(glyphGlow * 0.82, 0, 1) * 100);
                                const glyphTextShadow = highlightStatus === 'active' && glyphGlow > 0.02
                                    ? `0 0 ${glowRadii.inner}px color-mix(in srgb, ${activeColor} ${glyphGlowMain}%, transparent), 0 0 ${glowRadii.outer}px color-mix(in srgb, ${activeColor} ${glyphGlowTail}%, transparent)`
                                    : 'none';
                                const glyphTranslateY = highlightStatus === 'active' ? -glyphEnergy * 4 : 0;
                                const glyphScale = highlightStatus === 'active' ? 1 + glyphEnergy * 0.045 : 1;
                                const entryProgress = highlightStatus === 'active'
                                    ? clamp(progress * (wordRevealMode === 'instant' ? 2.8 : wordRevealMode === 'fast' ? 2 : 1.55), 0, 1)
                                    : highlightStatus === 'waiting'
                                        ? 0
                                        : 1;
                                const entryEase = 1 - Math.pow(1 - entryProgress, 2);
                                const entryAmount = 1 - entryEase;
                                const arcDirection = glyphIndex % 2 === 0 ? -1 : 1;
                                const lane = glyphCount <= 1 ? 0.5 : glyphIndex / (glyphCount - 1);
                                const arcHeight = Math.sin(lane * Math.PI) * (wordRevealMode === 'instant' ? 10 : wordRevealMode === 'fast' ? 13 : 16);
                                const entryOffsetX = entryAmount * arcDirection * (wordRevealMode === 'instant' ? 8 : 12);
                                const entryOffsetY = entryAmount * -(14 + arcHeight);
                                const entryRotate = entryAmount * arcDirection * 7;
                                const glyphOpacity = highlightStatus === 'waiting'
                                    ? clamp(0.28 + entryEase * 0.5, 0.28, 0.78)
                                    : 1;

                                    return (
                                        <span
                                            key={`${layout.id}-${glyphIndex}`}
                                            className="inline-block"
                                            style={{
                                                transform: `translate(${entryOffsetX.toFixed(2)}px, ${(glyphTranslateY + entryOffsetY).toFixed(2)}px) rotate(${entryRotate.toFixed(2)}deg) scale(${glyphScale})`,
                                                color: highlightStatus === 'active' && glyphEnergy > 0.08 ? activeColor : color,
                                                textShadow: glyphTextShadow,
                                                opacity: glyphOpacity,
                                                transition: 'transform 90ms ease-out, color 120ms linear, text-shadow 120ms ease-out',
                                            }}
                                        >
                                            {grapheme}
                                        </span>
                                    );
                                })
                            )}
                        </motion.span>
                    </React.Fragment>
                );
            })}
        </motion.div>
    );
};

const VisualizerSpatial: React.FC<VisualizerSpatialProps & { staticMode?: boolean; }> = ({
    currentTime,
    currentLineIndex,
    lines,
    theme,
    audioPower,
    audioBands,
    showText = true,
    coverUrl,
    useCoverColorBg = false,
    seed,
    staticMode = false,
    backgroundOpacity = 0.75,
    lyricsFontScale = 1,
    onBack,
}) => {
    const { t } = useTranslation();
    const [now, setNow] = useState(() => currentTime.get());
    const lastNowUpdateRef = useRef(now);
    const latestTimeRef = useRef(now);
    const contentRef = useRef<HTMLDivElement>(null);
    const [contentWidth, setContentWidth] = useState(1200);
    const [exitSnapshot, setExitSnapshot] = useState<SpatialExitCanvasSnapshot | null>(null);
    const previousActiveLineRef = useRef<Line | null>(null);
    const intensityPreset = SPATIAL_INTENSITY_PRESETS[theme.animationIntensity];
    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });
    useMotionValueEvent(currentTime, 'change', latest => {
        latestTimeRef.current = latest;
    });

    useEffect(() => {
        let rafId = 0;

        const syncNow = () => {
            const latest = latestTimeRef.current;
            const delta = latest - lastNowUpdateRef.current;

            // Song switch / seek backward: sync immediately to avoid stale lyric states.
            if (delta < 0) {
                lastNowUpdateRef.current = latest;
                setNow(latest);
                rafId = requestAnimationFrame(syncNow);
                return;
            }

            // Large forward seek should also skip throttling.
            if (delta > 0.32) {
                lastNowUpdateRef.current = latest;
                setNow(latest);
                rafId = requestAnimationFrame(syncNow);
                return;
            }

            // Throttle normal playback updates to reduce React work.
            if (delta >= 0.028) {
                lastNowUpdateRef.current = latest;
                setNow(latest);
            }

            rafId = requestAnimationFrame(syncNow);
        };

        rafId = requestAnimationFrame(syncNow);
        return () => cancelAnimationFrame(rafId);
    }, []);

    useEffect(() => {
        const element = contentRef.current;
        if (!element || typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) return;
            setContentWidth(entry.contentRect.width);
        });
        observer.observe(element);

        return () => observer.disconnect();
    }, []);

    const cameraEnergy = clamp(audioPower.get() / 255, 0, 1);
    const horizontalScale = clamp((contentWidth - 80) / 1200, 0.52, 1);
    const emptyFontSize = `clamp(${(1.4 * lyricsFontScale).toFixed(3)}rem, ${(3.4 * lyricsFontScale).toFixed(3)}vw, ${(2.2 * lyricsFontScale).toFixed(3)}rem)`;
    const translationFontSize = `clamp(${(1.125 * lyricsFontScale).toFixed(3)}rem, ${(2.6 * lyricsFontScale).toFixed(3)}vw, ${(1.25 * lyricsFontScale).toFixed(3)}rem)`;
    const upcomingFontSize = `clamp(${(0.875 * lyricsFontScale).toFixed(3)}rem, ${(2 * lyricsFontScale).toFixed(3)}vw, ${(1 * lyricsFontScale).toFixed(3)}rem)`;
    const upcomingLine = nextLines[0] ?? null;
    const shouldRenderUpcomingSpatial = shouldUseSpatialDomNext(activeLine, upcomingLine);
    const shouldRenderCanvasNextHint = Boolean(upcomingLine && !shouldRenderUpcomingSpatial);

    useEffect(() => {
        const previousLine = previousActiveLineRef.current;
        if (previousLine && previousLine !== activeLine && showText) {
            const preparedLayout = getOrBuildSpatialLayout(previousLine, 'current', theme, intensityPreset);
            const snapshot: SpatialExitCanvasSnapshot = {
                id: `exit-${previousLine.startTime}-${latestTimeRef.current}`,
                line: previousLine,
                preparedLayout,
                theme,
                lyricsFontScale,
                horizontalScale,
                viewportWidth: contentWidth,
            };
            setExitSnapshot(snapshot);
        }

        previousActiveLineRef.current = activeLine;
    }, [activeLine, contentWidth, horizontalScale, intensityPreset, lyricsFontScale, showText, theme]);

    const handleExitCanvasDone = useCallback((id: string) => {
        setExitSnapshot(current => current?.id === id ? null : current);
    }, []);

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            coverUrl={coverUrl}
            useCoverColorBg={useCoverColorBg}
            seed={seed}
            staticMode={staticMode}
            backgroundOpacity={backgroundOpacity}
            onBack={onBack}
        >
            <motion.div
                className="relative z-10 w-full h-[70vh] overflow-hidden pointer-events-none flex items-center justify-center p-8"
                style={{ perspective: '1450px', perspectiveOrigin: '50% 44%' }}
                animate={{
                    rotateY: cameraEnergy * intensityPreset.cameraYaw - intensityPreset.cameraYaw / 2,
                    rotateX: cameraEnergy * intensityPreset.cameraPitch - intensityPreset.cameraPitch / 2,
                }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
            >
                <div ref={contentRef} className="relative w-full h-full max-w-6xl" style={{ transformStyle: 'preserve-3d' }}>
                    <SpatialExitCanvas
                        snapshot={showText ? exitSnapshot : null}
                        onDone={handleExitCanvasDone}
                    />
                    <AnimatePresence mode="popLayout">
                        {showText && activeLine && (
                            <SpatialWordCloud
                                key={`current-${activeLine.startTime}`}
                                line={activeLine}
                                role="current"
                                theme={theme}
                                lyricsFontScale={lyricsFontScale}
                                audioPower={audioPower}
                                now={now}
                                horizontalScale={horizontalScale}
                                viewportWidth={contentWidth}
                            />
                        )}
                        {showText && upcomingLine && shouldRenderUpcomingSpatial && (
                            <SpatialWordCloud
                                key={`next-${upcomingLine.startTime}`}
                                line={upcomingLine}
                                role="next"
                                theme={theme}
                                lyricsFontScale={lyricsFontScale}
                                audioPower={audioPower}
                                now={now}
                                horizontalScale={horizontalScale}
                                viewportWidth={contentWidth}
                            />
                        )}
                        <SpatialCanvasNextHint
                            line={showText && shouldRenderCanvasNextHint ? upcomingLine : null}
                            visible={showText && shouldRenderCanvasNextHint}
                            theme={theme}
                            lyricsFontScale={lyricsFontScale}
                            horizontalScale={horizontalScale}
                            viewportWidth={contentWidth}
                        />
                    </AnimatePresence>
                </div>

                <AnimatePresence mode="wait">
                    {showText && !activeLine && (
                        <motion.div
                            key="empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 flex items-center justify-center"
                            style={{ color: theme.secondaryColor, fontSize: emptyFontSize }}
                        >
                            {t('ui.waitingForMusic')}
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>

            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={recentCompletedLine}
                nextLines={nextLines}
                theme={theme}
                translationFontSize={translationFontSize}
                upcomingFontSize={upcomingFontSize}
            />
        </VisualizerShell>
    );
};

export default VisualizerSpatial;
