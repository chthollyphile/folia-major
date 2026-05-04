import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Application, Container, Graphics, Text } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { AudioBands, Line, Theme, Word } from '../../../types';
import { resolveThemeFontStack } from '../../../utils/fontStacks';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { useVisualizerRuntime } from '../runtime';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';

// Visualizer overture
interface VisualizerProps {
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

interface ViewportSize {
    width: number;
    height: number;
}

type RhythmUnitKind = 'cjk' | 'word' | 'symbol';
type ObstacleShape = 'rect' | 'triangle' | 'circle' | 'text';
type WindowLineWeight = 'active' | 'upcoming';

interface WindowLine {
    line: Line;
    sourceIndex: number;
    weight: WindowLineWeight;
}

interface FocusUnit {
    id: string;
    text: string;
    lineIndex: number;
    sourceLineIndex: number;
    weight: WindowLineWeight;
    startTime: number;
    endTime: number;
    pathDistance: number;
    segmentStartDistance: number;
    segmentEndDistance: number;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    fontSize: number;
    segmentIndex: number;
    kind: RhythmUnitKind;
}

interface PathPoint {
    x: number;
    y: number;
}

interface PathMetrics {
    points: PathPoint[];
    segmentLengths: number[];
    cumulativeStarts: number[];
    totalLength: number;
}

interface ObstaclePiece {
    id: string;
    shape: ObstacleShape;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    text?: string;
    alpha: number;
    lineIndex: number;
    color: number;
    filled: boolean;
}

interface LineAnchor {
    lineIndex: number;
    sourceLineIndex: number;
    startDistance: number;
    endDistance: number;
    centerX: number;
    centerY: number;
    targetX: number;
    targetY: number;
}

interface OvertureWindow {
    focusUnits: FocusUnit[];
    lineAnchors: LineAnchor[];
    pathMetrics: PathMetrics;
    obstacles: ObstaclePiece[];
    worldWidth: number;
    worldHeight: number;
}

interface FocusSnapshot {
    unitIndex: number;
    distance: number;
    x: number;
    y: number;
    angle: number;
    segmentIndex: number;
    progress: number;
}

interface LyricsView {
    unit: FocusUnit;
    text: Text;
}

interface ObstacleTextView {
    obstacle: ObstaclePiece;
    text: Text;
}

interface SceneViews {
    lyricsViews: LyricsView[];
    obstacleTextViews: ObstacleTextView[];
}

interface HitBurst {
    id: string;
    unitId: string;
    x: number;
    y: number;
    createdAt: number;
    color: number;
}

interface CameraState {
    x: number;
    y: number;
    scale: number;
    velocityScale: number;
}

const DEFAULT_VIEWPORT: ViewportSize = { width: 0, height: 0 };
const CJK_REGEX = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
const LATIN_REGEX = /[A-Za-z0-9]/;

const graphemeSegmenter = typeof Intl !== 'undefined'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

const splitGraphemes = (text: string) => {
    if (!text) {
        return [] as string[];
    }

    if (graphemeSegmenter) {
        return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
    }

    return Array.from(text);
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const easeInOutCubic = (value: number) => {
    const normalized = clamp(value, 0, 1);
    return normalized < 0.5
        ? 4 * normalized * normalized * normalized
        : 1 - Math.pow(-2 * normalized + 2, 3) / 2;
};

const hashToUnit = (input: string) => {
    let hash = 2166136261;

    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return ((hash >>> 0) % 10000) / 10000;
};

const normalizeUnitText = (text: string) => text.replace(/\s+/g, ' ').trim();
const isLatinWord = (text: string) => LATIN_REGEX.test(text) && !CJK_REGEX.test(text);
const isPunctuationGrapheme = (text: string) => /^[\p{P}\p{S}。、，！？；：·…「」『』（）〈〉《》【】—～·]+$/u.test(text);

const colorToRgb = (color: string, fallback: { r: number, g: number, b: number }) => {
    if (color.startsWith('#')) {
        const hex = color.slice(1);
        if (hex.length === 3) {
            return {
                r: Number.parseInt(hex[0] + hex[0], 16),
                g: Number.parseInt(hex[1] + hex[1], 16),
                b: Number.parseInt(hex[2] + hex[2], 16),
            };
        }

        if (hex.length === 6) {
            return {
                r: Number.parseInt(hex.slice(0, 2), 16),
                g: Number.parseInt(hex.slice(2, 4), 16),
                b: Number.parseInt(hex.slice(4, 6), 16),
            };
        }
    }

    const rgbMatch = color.match(/^rgba?\(([^)]+)\)$/);
    if (rgbMatch) {
        const [r = '255', g = '255', b = '255'] = rgbMatch[1]
            .split(',')
            .slice(0, 3)
            .map(part => part.trim());

        return {
            r: Number.parseFloat(r),
            g: Number.parseFloat(g),
            b: Number.parseFloat(b),
        };
    }

    return fallback;
};

const rgbToNumber = (rgb: { r: number, g: number, b: number }) =>
    ((Math.round(rgb.r) & 255) << 16)
    | ((Math.round(rgb.g) & 255) << 8)
    | (Math.round(rgb.b) & 255);

const mixColor = (from: string, to: string, amount: number) => {
    const fromRgb = colorToRgb(from, { r: 255, g: 255, b: 255 });
    const toRgb = colorToRgb(to, fromRgb);
    const normalized = clamp(amount, 0, 1);

    return rgbToNumber({
        r: mix(fromRgb.r, toRgb.r, normalized),
        g: mix(fromRgb.g, toRgb.g, normalized),
        b: mix(fromRgb.b, toRgb.b, normalized),
    });
};

const colorToNumber = (color: string, fallback: number) => {
    if (color.startsWith('#') || color.startsWith('rgb')) {
        return mixColor(color, color, 1);
    }

    return fallback;
};

type GlowLikeFilter = GlowFilter & {
    color: number;
    outerStrength: number;
    innerStrength: number;
    alpha: number;
};

const createGlowFilter = (options: ConstructorParameters<typeof GlowFilter>[0]) =>
    new GlowFilter(options) as unknown as GlowLikeFilter;

const attachGlowFilter = (target: Graphics | Text, filter: GlowLikeFilter) => {
    (target as unknown as { filters: unknown[] | null }).filters = [filter as unknown];
};

const getFirstGlowFilter = (target: Graphics | Text) => {
    const filters = (target as unknown as { filters?: unknown[] | null }).filters;
    if (!Array.isArray(filters) || filters.length === 0) {
        return null;
    }

    return filters[0] as unknown as GlowLikeFilter;
};

const pickObstacleColor = (theme: Theme, seedKey: string) => {
    const palette = [
        theme.accentColor,
        theme.primaryColor,
        theme.secondaryColor,
        theme.accentColor,
    ];
    const paletteIndex = Math.floor(hashToUnit(`${seedKey}:palette`) * palette.length);
    const source = palette[paletteIndex] ?? theme.accentColor;
    const amount = mix(0.18, 0.78, hashToUnit(`${seedKey}:mix`));
    return mixColor(source, theme.backgroundColor, amount);
};

const createMeasureContext = () => {
    const canvas = document.createElement('canvas');
    return canvas.getContext('2d');
};

const buildFallbackWords = (line: Line): Word[] => {
    const tokens = normalizeUnitText(line.fullText).match(/[A-Za-z0-9'’-]+|[^\s]/g) ?? [];
    if (!tokens.length) {
        return [];
    }

    return tokens.map((token, index) => ({
        text: token,
        startTime: mix(line.startTime, line.endTime, index / tokens.length),
        endTime: mix(line.startTime, line.endTime, (index + 1) / tokens.length),
    }));
};

// Split each visible lyric line into the exact focus units used by the hidden guide path.
const buildFocusUnitsFromLine = (line: Line) => {
    const words = line.words.length > 0 ? line.words : buildFallbackWords(line);
    const units: Array<{ text: string, startTime: number, endTime: number, kind: RhythmUnitKind }> = [];

    words.forEach(word => {
        const text = normalizeUnitText(word.text);
        if (!text) {
            return;
        }

        if (isLatinWord(text)) {
            units.push({
                text,
                startTime: word.startTime,
                endTime: Math.max(word.endTime, word.startTime + 0.05),
                kind: 'word',
            });
            return;
        }

        const graphemes = splitGraphemes(text).filter(grapheme => grapheme.trim().length > 0);
        if (!graphemes.length) {
            return;
        }

        const weights = graphemes.map(grapheme => {
            if (CJK_REGEX.test(grapheme)) {
                return 1;
            }

            if (isPunctuationGrapheme(grapheme)) {
                return 0.72;
            }

            return 0.9;
        });
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        let accumulatedWeight = 0;

        graphemes.forEach((grapheme, index) => {
            const startRatio = accumulatedWeight / Math.max(totalWeight, 0.0001);
            accumulatedWeight += weights[index]!;
            const endRatio = accumulatedWeight / Math.max(totalWeight, 0.0001);
            units.push({
                text: grapheme,
                startTime: mix(word.startTime, word.endTime, startRatio),
                endTime: mix(word.startTime, word.endTime, endRatio),
                kind: CJK_REGEX.test(grapheme) ? 'cjk' : 'symbol',
            });
        });
    });

    return units;
};

const computePathMetrics = (points: PathPoint[]): PathMetrics => {
    const segmentLengths: number[] = [];
    const cumulativeStarts: number[] = [];
    let totalLength = 0;

    for (let index = 0; index < points.length - 1; index += 1) {
        cumulativeStarts.push(totalLength);
        const from = points[index]!;
        const to = points[index + 1]!;
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        segmentLengths.push(length);
        totalLength += length;
    }

    return {
        points,
        segmentLengths,
        cumulativeStarts,
        totalLength,
    };
};

const getSegmentNormal = (from: PathPoint, to: PathPoint) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
        x: -dy / length,
        y: dx / length,
    };
};

// Sample the hidden guide path at a distance so arrow motion follows corners instead of cutting through them.
const samplePath = (metrics: PathMetrics, distance: number) => {
    if (metrics.points.length < 2 || metrics.segmentLengths.length === 0) {
        return {
            x: metrics.points[0]?.x ?? 0,
            y: metrics.points[0]?.y ?? 0,
            angle: 0,
            segmentIndex: 0,
            progress: 0,
        };
    }

    const clampedDistance = clamp(distance, 0, metrics.totalLength);
    for (let index = 0; index < metrics.segmentLengths.length; index += 1) {
        const startDistance = metrics.cumulativeStarts[index]!;
        const endDistance = startDistance + metrics.segmentLengths[index]!;
        if (clampedDistance <= endDistance || index === metrics.segmentLengths.length - 1) {
            const local = clamp(
                (clampedDistance - startDistance) / Math.max(metrics.segmentLengths[index]!, 0.0001),
                0,
                1
            );
            const from = metrics.points[index]!;
            const to = metrics.points[index + 1]!;
            return {
                x: mix(from.x, to.x, local),
                y: mix(from.y, to.y, local),
                angle: Math.atan2(to.y - from.y, to.x - from.x),
                segmentIndex: index,
                progress: local,
            };
        }
    }

    const lastPoint = metrics.points[metrics.points.length - 1]!;
    const previousPoint = metrics.points[metrics.points.length - 2]!;
    return {
        x: lastPoint.x,
        y: lastPoint.y,
        angle: Math.atan2(lastPoint.y - previousPoint.y, lastPoint.x - previousPoint.x),
        segmentIndex: metrics.segmentLengths.length - 1,
        progress: 1,
    };
};

const createLabelText = (text: string, fontPx: number, tint: number, alpha: number, theme: Theme) => {
    const label = new Text({
        text,
        style: {
            fontFamily: resolveThemeFontStack(theme),
            fontSize: Math.round(fontPx),
            fontWeight: '800',
            fill: tint,
            align: 'center',
        },
    });
    label.alpha = alpha;
    return label;
};

const chooseWindowLines = (lines: Line[]) =>
    lines
        .map((line, sourceIndex) => ({
            line,
            sourceIndex,
            weight: 'upcoming' as const,
        }))
        .filter(entry => entry.line.fullText.trim().length > 0);

const getFocusFontSize = (
    text: string,
    viewport: ViewportSize,
    lyricsFontScale: number
) => {
    const graphemeCount = splitGraphemes(text).length;
    const base = graphemeCount <= 1
        ? viewport.width * 0.112
        : graphemeCount <= 3
            ? viewport.width * 0.098
            : viewport.width * 0.084;
    return clamp(base * lyricsFontScale, 40 * lyricsFontScale, 116 * lyricsFontScale);
};

const measureTextBox = (
    measureContext: CanvasRenderingContext2D,
    text: string,
    fontPx: number,
    theme: Theme
) => {
    measureContext.font = `800 ${Math.round(fontPx)}px ${resolveThemeFontStack(theme)}`;
    const width = Math.max(measureContext.measureText(text).width, fontPx * 0.8);
    return {
        width,
        height: fontPx * 1.06,
    };
};

// Build a monotonic zigzag path so every focus unit owns a dedicated safe segment between corners.
const buildHiddenPathPoints = (unitCount: number, viewport: ViewportSize, seed: string | number | undefined) => {
    const worldHeight = Math.max(viewport.height * 1.18, 760);
    const segmentSpan = clamp(viewport.width * 0.14, 130, 220);
    const startX = viewport.width * 0.14;
    const lanes = [
        worldHeight * 0.16,
        worldHeight * 0.32,
        worldHeight * 0.52,
        worldHeight * 0.74,
    ];

    const points: PathPoint[] = [];
    const firstLaneIndex = Math.floor(hashToUnit(`${seed ?? 'overture'}:lane:0`) * 2);
    points.push({
        x: startX,
        y: lanes[firstLaneIndex]!,
    });

    let previousLaneIndex = firstLaneIndex;
    for (let index = 1; index <= unitCount; index += 1) {
        const candidates = lanes
            .map((laneY, laneIndex) => ({ laneY, laneIndex }))
            .filter(({ laneIndex }) => Math.abs(laneIndex - previousLaneIndex) >= 1);
        const choice = candidates[Math.floor(hashToUnit(`${seed ?? 'overture'}:lane:${index}`) * candidates.length)] ?? candidates[0]!;
        const jitterX = mix(-segmentSpan * 0.14, segmentSpan * 0.14, hashToUnit(`${seed ?? 'overture'}:xj:${index}`));
        points.push({
            x: startX + segmentSpan * index + jitterX,
            y: choice.laneY,
        });
        previousLaneIndex = choice.laneIndex;
    }

    return {
        points,
        worldWidth: startX + segmentSpan * (unitCount + 1),
        worldHeight,
    };
};

const buildObstacleTextPool = (windowLines: WindowLine[]) => {
    const pool: Array<{ text: string, lineIndex: number }> = [];
    windowLines.forEach((windowLine, index) => {
        const translationText = normalizeUnitText(windowLine.line.translation ?? '');

        if (translationText) {
            pool.push({ text: translationText, lineIndex: index });
        }
    });

    return pool;
};

// Place geometry and text obstacles beside corners and segment normals so the path appears to weave around them.
const buildObstacles = (
    metrics: PathMetrics,
    focusUnits: FocusUnit[],
    windowLines: WindowLine[],
    viewport: ViewportSize,
    theme: Theme,
    seed: string | number | undefined
) => {
    const obstacles: ObstaclePiece[] = [];
    const textPool = buildObstacleTextPool(windowLines);

    for (let index = 1; index < metrics.points.length - 1; index += 1) {
        const previousPoint = metrics.points[index - 1]!;
        const point = metrics.points[index]!;
        const nextPoint = metrics.points[index + 1]!;
        const previousNormal = getSegmentNormal(previousPoint, point);
        const nextNormal = getSegmentNormal(point, nextPoint);
        const combinedNormal = {
            x: previousNormal.x + nextNormal.x,
            y: previousNormal.y + nextNormal.y,
        };
        const combinedLength = Math.hypot(combinedNormal.x, combinedNormal.y) || 1;
        const cross = (point.x - previousPoint.x) * (nextPoint.y - point.y) - (point.y - previousPoint.y) * (nextPoint.x - point.x);
        const outwardSign = cross >= 0 ? -1 : 1;
        const outward = {
            x: (combinedNormal.x / combinedLength) * outwardSign,
            y: (combinedNormal.y / combinedLength) * outwardSign,
        };
        const shapeIndex = Math.floor(hashToUnit(`${seed ?? 'overture'}:corner-shape:${index}`) * 3);
        const colorSeed = `${seed ?? 'overture'}:corner-color:${index}`;
        obstacles.push({
            id: `corner-obstacle-${index}`,
            shape: shapeIndex === 0 ? 'rect' : shapeIndex === 1 ? 'triangle' : 'circle',
            x: point.x + outward.x * mix(130, 210, hashToUnit(`${seed ?? 'overture'}:corner-dist:${index}`)),
            y: point.y + outward.y * mix(130, 210, hashToUnit(`${seed ?? 'overture'}:corner-dist:${index}:y`)),
            width: mix(viewport.width * 0.18, viewport.width * 0.34, hashToUnit(`${seed ?? 'overture'}:corner-w:${index}`)),
            height: mix(viewport.height * 0.14, viewport.height * 0.28, hashToUnit(`${seed ?? 'overture'}:corner-h:${index}`)),
            rotation: mix(-0.88, 0.88, hashToUnit(`${seed ?? 'overture'}:corner-r:${index}`)),
            alpha: 0.24,
            lineIndex: index % Math.max(windowLines.length, 1),
            color: pickObstacleColor(theme, colorSeed),
            filled: hashToUnit(`${colorSeed}:fill`) > 0.56,
        });
    }

    focusUnits.forEach((unit, index) => {
        const segmentIndex = unit.segmentIndex;
        const from = metrics.points[segmentIndex]!;
        const to = metrics.points[segmentIndex + 1]!;
        const normal = getSegmentNormal(from, to);
        const side = index % 2 === 0 ? 1 : -1;
        const textDistance = Math.max(unit.height * 1.55 + unit.width * 0.32, 110);

        if (index < focusUnits.length - 1 && index % 2 === 0) {
            const colorSeed = `${seed ?? 'overture'}:segment-color:${index}`;
            obstacles.push({
                id: `segment-obstacle-${index}`,
                shape: index % 3 === 0 ? 'triangle' : 'rect',
                x: unit.x - normal.x * (textDistance * 0.82) * side,
                y: unit.y - normal.y * (textDistance * 0.82) * side,
                width: mix(72, 150, hashToUnit(`${seed ?? 'overture'}:segment-w:${index}`)),
                height: mix(64, 140, hashToUnit(`${seed ?? 'overture'}:segment-h:${index}`)),
                rotation: mix(-0.7, 0.7, hashToUnit(`${seed ?? 'overture'}:segment-r:${index}`)),
                alpha: 0.22,
                lineIndex: unit.lineIndex,
                color: pickObstacleColor(theme, colorSeed),
                filled: hashToUnit(`${colorSeed}:fill`) > 0.48,
            });
        }
    });

    textPool.forEach((entry, index) => {
        const anchorUnit = focusUnits[
            Math.min(
                focusUnits.length - 1,
                Math.max(0, Math.round(((index + 1) / (textPool.length + 1)) * (focusUnits.length - 1)))
            )
        ]!;
        const segmentIndex = anchorUnit.segmentIndex;
        const from = metrics.points[segmentIndex]!;
        const to = metrics.points[segmentIndex + 1]!;
        const normal = getSegmentNormal(from, to);
        const side = index % 2 === 0 ? 1 : -1;
        const textDistance = Math.max(anchorUnit.height * 2.2 + anchorUnit.width * 0.55, 180);
        const colorSeed = `${seed ?? 'overture'}:text-color:${index}`;

        obstacles.push({
            id: `text-obstacle-${index}`,
            shape: 'text',
            x: anchorUnit.x + normal.x * textDistance * side,
            y: anchorUnit.y + normal.y * textDistance * side,
            width: anchorUnit.width * mix(1.35, 1.9, hashToUnit(`${seed ?? 'overture'}:text-w:${index}`)),
            height: anchorUnit.height * mix(0.9, 1.2, hashToUnit(`${seed ?? 'overture'}:text-h:${index}`)),
            rotation: mix(-0.86, 0.86, hashToUnit(`${seed ?? 'overture'}:text-r:${index}`)),
            text: entry.text,
            alpha: 0.14,
            lineIndex: entry.lineIndex,
            color: pickObstacleColor(theme, colorSeed),
            filled: hashToUnit(`${colorSeed}:fill`) > 0.62,
        });
    });

    return obstacles;
};

// Assemble the visible two-line window, hidden path anchors, and obstacle field from scratch on every window change.
const buildOvertureWindow = ({
    windowLines,
    viewport,
    theme,
    lyricsFontScale,
    seed,
}: {
    windowLines: WindowLine[];
    viewport: ViewportSize;
    theme: Theme;
    lyricsFontScale: number;
    seed: string | number | undefined;
}): OvertureWindow => {
    if (viewport.width <= 0 || viewport.height <= 0 || windowLines.length === 0) {
        return {
            focusUnits: [],
            lineAnchors: [],
            pathMetrics: computePathMetrics([{ x: 0, y: 0 }, { x: 0, y: 0 }]),
            obstacles: [],
            worldWidth: viewport.width,
            worldHeight: viewport.height,
        };
    }

    const measureContext = createMeasureContext();
    if (!measureContext) {
        return {
            focusUnits: [],
            lineAnchors: [],
            pathMetrics: computePathMetrics([{ x: 0, y: 0 }, { x: 0, y: 0 }]),
            obstacles: [],
            worldWidth: viewport.width,
            worldHeight: viewport.height,
        };
    }

    const unitSpecs = windowLines.flatMap((windowLine, lineIndex) =>
        buildFocusUnitsFromLine(windowLine.line).map(unit => ({
            ...unit,
            lineIndex,
            sourceLineIndex: windowLine.sourceIndex,
            weight: windowLine.weight,
        }))
    );

    if (!unitSpecs.length) {
        return {
            focusUnits: [],
            lineAnchors: [],
            pathMetrics: computePathMetrics([{ x: 0, y: 0 }, { x: 0, y: 0 }]),
            obstacles: [],
            worldWidth: viewport.width,
            worldHeight: viewport.height,
        };
    }

    const hiddenPath = buildHiddenPathPoints(unitSpecs.length, viewport, seed);
    const pathMetrics = computePathMetrics(hiddenPath.points);
    const focusUnits: FocusUnit[] = unitSpecs.map((unit, index) => {
        const segmentDistance = pathMetrics.cumulativeStarts[index]! + pathMetrics.segmentLengths[index]! * 0.5;
        const pathSample = samplePath(pathMetrics, segmentDistance);
        const fontSize = getFocusFontSize(unit.text, viewport, lyricsFontScale);
        const textBox = measureTextBox(measureContext, unit.text, fontSize, theme);

        return {
            id: `overture-focus-unit-${unit.sourceLineIndex}-${index}`,
            text: unit.text,
            lineIndex: unit.lineIndex,
            sourceLineIndex: unit.sourceLineIndex,
            weight: unit.weight,
            startTime: unit.startTime,
            endTime: Math.max(unit.endTime, unit.startTime + 0.04),
            pathDistance: segmentDistance,
            segmentStartDistance: pathMetrics.cumulativeStarts[index]!,
            segmentEndDistance: pathMetrics.cumulativeStarts[index]! + pathMetrics.segmentLengths[index]!,
            x: pathSample.x,
            y: pathSample.y,
            width: textBox.width,
            height: textBox.height,
            rotation: mix(-0.38, 0.38, hashToUnit(`${seed ?? 'overture'}:rot:${index}`)),
            fontSize,
            segmentIndex: pathSample.segmentIndex,
            kind: unit.kind,
        };
    });

    const obstacles = buildObstacles(pathMetrics, focusUnits, windowLines, viewport, theme, seed);
    const lineAnchors = windowLines
        .map((windowLine, lineIndex) => {
            const units = focusUnits.filter(unit => unit.lineIndex === lineIndex);
            if (!units.length) {
                return null;
            }

            const minX = Math.min(...units.map(unit => unit.x));
            const maxX = Math.max(...units.map(unit => unit.x));
            const minY = Math.min(...units.map(unit => unit.y));
            const maxY = Math.max(...units.map(unit => unit.y));
            const startDistance = units[0]!.segmentStartDistance;
            const endDistance = units[units.length - 1]!.segmentEndDistance;

            return {
                lineIndex,
                sourceLineIndex: windowLine.sourceIndex,
                startDistance,
                endDistance,
                centerX: (minX + maxX) * 0.5,
                centerY: (minY + maxY) * 0.5,
                targetX: mix(minX, maxX, 0.56),
                targetY: mix(minY, maxY, 0.5),
            } satisfies LineAnchor;
        })
        .filter((anchor): anchor is LineAnchor => Boolean(anchor));

    return {
        focusUnits,
        lineAnchors,
        pathMetrics,
        obstacles,
        worldWidth: hiddenPath.worldWidth,
        worldHeight: hiddenPath.worldHeight,
    };
};

const sampleLineAnchorY = (lineAnchors: LineAnchor[], focusDistance: number, fallbackY: number) => {
    if (!lineAnchors.length) {
        return fallbackY;
    }

    if (focusDistance <= lineAnchors[0]!.startDistance) {
        return lineAnchors[0]!.targetY;
    }

    for (let index = 0; index < lineAnchors.length; index += 1) {
        const currentAnchor = lineAnchors[index]!;
        const nextAnchor = lineAnchors[index + 1] ?? null;

        if (!nextAnchor) {
            return currentAnchor.targetY;
        }

        if (focusDistance < nextAnchor.startDistance) {
            const progress = clamp(
                (focusDistance - currentAnchor.startDistance)
                / Math.max(nextAnchor.startDistance - currentAnchor.startDistance, 0.0001),
                0,
                1
            );
            return mix(currentAnchor.targetY, nextAnchor.targetY, progress);
        }
    }

    return lineAnchors[lineAnchors.length - 1]!.targetY;
};

const intersectsViewportBounds = (
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    viewportLeft: number,
    viewportRight: number,
    viewportTop: number,
    viewportBottom: number
) => {
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    return !(
        centerX + halfWidth < viewportLeft
        || centerX - halfWidth > viewportRight
        || centerY + halfHeight < viewportTop
        || centerY - halfHeight > viewportBottom
    );
};

// Drive the arrow by path distance so both intra-line and inter-line motion stay continuous.
const getFocusSnapshot = (focusUnits: FocusUnit[], currentTimeValue: number, staticMode: boolean): FocusSnapshot | null => {
    if (!focusUnits.length) {
        return null;
    }

    if (currentTimeValue <= focusUnits[0]!.startTime) {
        const firstUnit = focusUnits[0]!;
        return {
            unitIndex: 0,
            distance: firstUnit.pathDistance,
            x: firstUnit.x,
            y: firstUnit.y,
            angle: 0,
            segmentIndex: firstUnit.segmentIndex,
            progress: firstUnit.startTime,
        };
    }

    for (let index = 0; index < focusUnits.length; index += 1) {
        const unit = focusUnits[index]!;
        const nextUnit = focusUnits[index + 1] ?? null;
        if (nextUnit && currentTimeValue < nextUnit.startTime) {
            const segmentProgress = clamp(
                (currentTimeValue - unit.startTime) / Math.max(nextUnit.startTime - unit.startTime, 0.0001),
                0,
                1
            );
            return {
                unitIndex: index,
                distance: mix(
                    unit.segmentStartDistance,
                    nextUnit.segmentStartDistance,
                    staticMode ? 0 : segmentProgress
                ),
                x: 0,
                y: 0,
                angle: 0,
                segmentIndex: unit.segmentIndex,
                progress: currentTimeValue,
            };
        }

        if (!nextUnit && currentTimeValue <= unit.endTime) {
            const lastSegmentProgress = clamp(
                (currentTimeValue - unit.startTime) / Math.max(unit.endTime - unit.startTime, 0.0001),
                0,
                1
            );
            return {
                unitIndex: index,
                distance: mix(
                    unit.segmentStartDistance,
                    unit.segmentEndDistance,
                    staticMode ? 0 : lastSegmentProgress
                ),
                x: 0,
                y: 0,
                angle: 0,
                segmentIndex: unit.segmentIndex,
                progress: currentTimeValue,
            };
        }
    }

    const lastUnit = focusUnits[focusUnits.length - 1]!;
    return {
        unitIndex: focusUnits.length - 1,
        distance: lastUnit.segmentEndDistance,
        x: 0,
        y: 0,
        angle: 0,
        segmentIndex: lastUnit.segmentIndex,
        progress: currentTimeValue,
    };
};

const drawRotatedRectOutline = (
    graphics: Graphics,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    angle: number,
    color: number,
    alpha: number,
    strokeWidth: number
) => {
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const points = [
        { x: -halfWidth, y: -halfHeight },
        { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight },
        { x: -halfWidth, y: halfHeight },
    ].map(point => ({
        x: centerX + point.x * cos - point.y * sin,
        y: centerY + point.x * sin + point.y * cos,
    }));

    graphics
        .moveTo(points[0]!.x, points[0]!.y)
        .lineTo(points[1]!.x, points[1]!.y)
        .lineTo(points[2]!.x, points[2]!.y)
        .lineTo(points[3]!.x, points[3]!.y)
        .closePath()
        .stroke({
            color,
            width: strokeWidth,
            alpha,
            join: 'miter',
        });
};

const drawRotatedRectFill = (
    graphics: Graphics,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    angle: number,
    color: number,
    alpha: number
) => {
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const points = [
        { x: -halfWidth, y: -halfHeight },
        { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight },
        { x: -halfWidth, y: halfHeight },
    ].map(point => ({
        x: centerX + point.x * cos - point.y * sin,
        y: centerY + point.x * sin + point.y * cos,
    }));

    graphics
        .moveTo(points[0]!.x, points[0]!.y)
        .lineTo(points[1]!.x, points[1]!.y)
        .lineTo(points[2]!.x, points[2]!.y)
        .lineTo(points[3]!.x, points[3]!.y)
        .closePath()
        .fill({
            color,
            alpha,
        });
};

const drawTriangleOutline = (
    graphics: Graphics,
    centerX: number,
    centerY: number,
    size: number,
    angle: number,
    color: number,
    alpha: number,
    strokeWidth: number
) => {
    const points = [0, Math.PI * (2 / 3), Math.PI * (4 / 3)].map(offset => ({
        x: centerX + Math.cos(angle + offset) * size,
        y: centerY + Math.sin(angle + offset) * size,
    }));

    graphics
        .moveTo(points[0]!.x, points[0]!.y)
        .lineTo(points[1]!.x, points[1]!.y)
        .lineTo(points[2]!.x, points[2]!.y)
        .closePath()
        .stroke({
            color,
            width: strokeWidth,
            alpha,
            join: 'miter',
        });
};

const drawTriangleFill = (
    graphics: Graphics,
    centerX: number,
    centerY: number,
    size: number,
    angle: number,
    color: number,
    alpha: number
) => {
    const points = [0, Math.PI * (2 / 3), Math.PI * (4 / 3)].map(offset => ({
        x: centerX + Math.cos(angle + offset) * size,
        y: centerY + Math.sin(angle + offset) * size,
    }));

    graphics
        .moveTo(points[0]!.x, points[0]!.y)
        .lineTo(points[1]!.x, points[1]!.y)
        .lineTo(points[2]!.x, points[2]!.y)
        .closePath()
        .fill({
            color,
            alpha,
        });
};

const destroySceneViews = (views: SceneViews) => {
    views.lyricsViews.forEach(view => {
        view.text.destroy();
    });
    views.obstacleTextViews.forEach(view => {
        view.text.destroy();
    });
};

const VisualizerOverture: React.FC<VisualizerProps & { staticMode?: boolean; }> = ({
    currentTime,
    currentLineIndex,
    lines,
    theme,
    audioPower,
    audioBands,
    showText = true,
    coverUrl,
    useCoverColorBg,
    seed,
    staticMode = false,
    backgroundOpacity,
    lyricsFontScale = 1,
    onBack,
}) => {
    const { t } = useTranslation();
    const pixiHostRef = useRef<HTMLDivElement | null>(null);
    const appRef = useRef<Application | null>(null);
    const worldRef = useRef<Container | null>(null);
    const obstacleGraphicsRef = useRef<Graphics | null>(null);
    const guideGraphicsRef = useRef<Graphics | null>(null);
    const arrowGraphicsRef = useRef<Graphics | null>(null);
    const effectGraphicsRef = useRef<Graphics | null>(null);
    const obstacleTextLayerRef = useRef<Container | null>(null);
    const mainLyricsLayerRef = useRef<Container | null>(null);
    const worldWindowRef = useRef<OvertureWindow>({
        focusUnits: [],
        lineAnchors: [],
        pathMetrics: computePathMetrics([{ x: 0, y: 0 }, { x: 0, y: 0 }]),
        obstacles: [],
        worldWidth: 0,
        worldHeight: 0,
    });
    const sceneViewsRef = useRef<SceneViews>({
        lyricsViews: [],
        obstacleTextViews: [],
    });
    const cameraRef = useRef<CameraState>({
        x: 0,
        y: 0,
        scale: 1,
        velocityScale: 0,
    });
    const currentTimeRef = useRef(currentTime);
    const audioBandsRef = useRef(audioBands);
    const themeRef = useRef(theme);
    const showTextRef = useRef(showText);
    const activeSourceIndexRef = useRef(-1);
    const upcomingSourceIndexRef = useRef(-1);
    const lastHitUnitIdRef = useRef<string | null>(null);
    const hitBurstsRef = useRef<HitBurst[]>([]);
    const guideGlowFilterRef = useRef<GlowLikeFilter | null>(null);
    const arrowGlowFilterRef = useRef<GlowLikeFilter | null>(null);
    const effectGlowFilterRef = useRef<GlowLikeFilter | null>(null);
    const viewportRef = useRef(DEFAULT_VIEWPORT);
    const [viewport, setViewport] = useState<ViewportSize>(DEFAULT_VIEWPORT);
    const [pixiReady, setPixiReady] = useState(false);

    const {
        activeLine,
        recentCompletedLine,
        upcomingLine,
        nextLines,
    } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    useEffect(() => {
        currentTimeRef.current = currentTime;
    }, [currentTime]);

    useEffect(() => {
        audioBandsRef.current = audioBands;
    }, [audioBands]);

    useEffect(() => {
        themeRef.current = theme;
    }, [theme]);

    useEffect(() => {
        showTextRef.current = showText;
    }, [showText]);

    useEffect(() => {
        activeSourceIndexRef.current = activeLine
            ? lines.indexOf(activeLine)
            : recentCompletedLine
                ? lines.indexOf(recentCompletedLine)
                : -1;
        upcomingSourceIndexRef.current = upcomingLine ? lines.indexOf(upcomingLine) : -1;
    }, [activeLine, lines, recentCompletedLine, upcomingLine]);

    useEffect(() => {
        viewportRef.current = viewport;
    }, [viewport]);

    const windowLines = useMemo(() => chooseWindowLines(lines), [lines]);

    const overtureWindow = useMemo(() => buildOvertureWindow({
        windowLines,
        viewport,
        theme,
        lyricsFontScale,
        seed,
    }), [lyricsFontScale, seed, theme, viewport, windowLines]);

    useEffect(() => {
        const host = pixiHostRef.current;
        if (!host) {
            return;
        }

        let cancelled = false;
        const app = new Application();
        const world = new Container();
        const obstacleGraphics = new Graphics();
        const guideGraphics = new Graphics();
        const arrowGraphics = new Graphics();
        const effectGraphics = new Graphics();
        const obstacleTextLayer = new Container();
        const mainLyricsLayer = new Container();
        const guideGlowFilter = createGlowFilter({
            distance: 24,
            outerStrength: 2.2,
            innerStrength: 0,
            color: 0xffffff,
            quality: 0.24,
            alpha: 0.48,
            knockout: false,
        });
        const arrowGlowFilter = createGlowFilter({
            distance: 30,
            outerStrength: 2.8,
            innerStrength: 0.32,
            color: 0xffffff,
            quality: 0.26,
            alpha: 0.72,
            knockout: false,
        });
        const effectGlowFilter = createGlowFilter({
            distance: 34,
            outerStrength: 2.6,
            innerStrength: 0,
            color: 0xffffff,
            quality: 0.24,
            alpha: 0.62,
            knockout: false,
        });

        const initialize = async () => {
            await app.init({
                resizeTo: host,
                backgroundAlpha: 0,
                antialias: true,
                autoDensity: true,
                resolution: Math.min(window.devicePixelRatio || 1, 2),
            });

            if (cancelled) {
                app.destroy({ removeView: true }, true);
                return;
            }

            app.canvas.style.width = '100%';
            app.canvas.style.height = '100%';
            app.canvas.style.display = 'block';
            host.replaceChildren(app.canvas);

            world.sortableChildren = true;
            obstacleGraphics.zIndex = 2;
            obstacleTextLayer.zIndex = 4;
            mainLyricsLayer.zIndex = 10;
            guideGraphics.zIndex = 16;
            effectGraphics.zIndex = 20;
            arrowGraphics.zIndex = 24;
            attachGlowFilter(guideGraphics, guideGlowFilter);
            attachGlowFilter(effectGraphics, effectGlowFilter);
            attachGlowFilter(arrowGraphics, arrowGlowFilter);

            world.addChild(obstacleGraphics);
            world.addChild(obstacleTextLayer);
            world.addChild(mainLyricsLayer);
            world.addChild(guideGraphics);
            world.addChild(effectGraphics);
            world.addChild(arrowGraphics);
            app.stage.addChild(world);

            appRef.current = app;
            worldRef.current = world;
            obstacleGraphicsRef.current = obstacleGraphics;
            guideGraphicsRef.current = guideGraphics;
            arrowGraphicsRef.current = arrowGraphics;
            effectGraphicsRef.current = effectGraphics;
            obstacleTextLayerRef.current = obstacleTextLayer;
            mainLyricsLayerRef.current = mainLyricsLayer;
            guideGlowFilterRef.current = guideGlowFilter;
            arrowGlowFilterRef.current = arrowGlowFilter;
            effectGlowFilterRef.current = effectGlowFilter;

            const resize = () => {
                const bounds = host.getBoundingClientRect();
                setViewport({ width: bounds.width, height: bounds.height });
            };

            resize();
            const observer = new ResizeObserver(resize);
            observer.observe(host);

            const tick = (ticker: { deltaMS: number }) => {
                const windowLayout = worldWindowRef.current;
                const worldNode = worldRef.current;
                const obstacleNode = obstacleGraphicsRef.current;
                const guideNode = guideGraphicsRef.current;
                const arrowNode = arrowGraphicsRef.current;
                const effectNode = effectGraphicsRef.current;
                if (!worldNode || !obstacleNode || !guideNode || !arrowNode || !effectNode || !windowLayout.focusUnits.length) {
                    return;
                }

                const currentTimeValue = currentTimeRef.current.get();
                const bass = clamp(audioBandsRef.current.bass.get(), 0, 1.4);
                const vocal = clamp(audioBandsRef.current.vocal.get(), 0, 1.4);
                const treble = clamp(audioBandsRef.current.treble.get(), 0, 1.4);
                const focusBase = getFocusSnapshot(windowLayout.focusUnits, currentTimeValue, staticMode);
                if (!focusBase) {
                    return;
                }

                const focusSample = samplePath(windowLayout.pathMetrics, focusBase.distance);
                const focus: FocusSnapshot = {
                    ...focusBase,
                    x: focusSample.x,
                    y: focusSample.y,
                    angle: focusSample.angle,
                    segmentIndex: focusSample.segmentIndex,
                };

                const dt = Math.min(ticker.deltaMS / 1000, 1 / 20);
                const runtimeViewport = viewportRef.current;
                const targetScale = staticMode ? 1 : clamp(1 + treble * 0.012, 1, 1.03);
                const desiredArrowScreenX = runtimeViewport.width * 0.62;
                const targetCameraX = focus.x - ((desiredArrowScreenX - runtimeViewport.width * 0.5) / Math.max(cameraRef.current.scale, 0.0001));
                const targetCameraY = sampleLineAnchorY(windowLayout.lineAnchors, focus.distance, focus.y);

                if (staticMode) {
                    cameraRef.current.x = targetCameraX;
                    cameraRef.current.y = targetCameraY;
                    cameraRef.current.scale = 1;
                    cameraRef.current.velocityScale = 0;
                } else {
                    const accelScale = (targetScale - cameraRef.current.scale) * 18 - cameraRef.current.velocityScale * 9.8;
                    const cameraErrorX = Math.abs(targetCameraX - cameraRef.current.x);
                    const cameraErrorY = Math.abs(targetCameraY - cameraRef.current.y);
                    const trackingBlendX = clamp(dt * (1.2 + cameraErrorX * 0.02), 0.018, 0.085);
                    const trackingBlendY = clamp(dt * (0.48 + cameraErrorY * 0.008), 0.006, 0.02);
                    cameraRef.current.velocityScale += accelScale * dt;
                    cameraRef.current.x = mix(cameraRef.current.x, targetCameraX, trackingBlendX);
                    cameraRef.current.y = mix(cameraRef.current.y, targetCameraY, trackingBlendY);
                    cameraRef.current.scale = clamp(cameraRef.current.scale + cameraRef.current.velocityScale * dt, 0.98, 1.04);
                }

                worldNode.scale.set(cameraRef.current.scale);
                worldNode.position.set(
                    runtimeViewport.width * 0.5 - cameraRef.current.x * cameraRef.current.scale,
                    runtimeViewport.height * 0.5 - cameraRef.current.y * cameraRef.current.scale
                );

                const activeColor = colorToNumber(themeRef.current.accentColor, 0xffffff);
                const primaryColor = colorToNumber(themeRef.current.primaryColor, 0xe0e0e0);
                const secondaryColor = colorToNumber(themeRef.current.secondaryColor, 0x9ea4af);
                const trailGuideColor = mixColor(themeRef.current.primaryColor, themeRef.current.backgroundColor, 0.38);
                const futureGuideColor = mixColor(themeRef.current.secondaryColor, themeRef.current.backgroundColor, 0.28);
                const guideGlowFilter = guideGlowFilterRef.current;
                const arrowGlowFilter = arrowGlowFilterRef.current;
                const effectGlowFilter = effectGlowFilterRef.current;
                if (guideGlowFilter) {
                    guideGlowFilter.color = activeColor;
                    guideGlowFilter.outerStrength = 1.6 + vocal * 1.6;
                    guideGlowFilter.alpha = 0.46 + vocal * 0.18;
                }
                if (arrowGlowFilter) {
                    arrowGlowFilter.color = activeColor;
                    arrowGlowFilter.outerStrength = 2 + vocal * 1.8;
                    arrowGlowFilter.innerStrength = 0.22 + vocal * 0.12;
                    arrowGlowFilter.alpha = 0.62 + vocal * 0.18;
                }
                if (effectGlowFilter) {
                    effectGlowFilter.color = activeColor;
                    effectGlowFilter.outerStrength = 1.8 + vocal * 1.8;
                    effectGlowFilter.alpha = 0.54 + vocal * 0.2;
                }
                const viewportInset = 120 / Math.max(cameraRef.current.scale, 0.0001);
                const viewportWorldLeft = cameraRef.current.x - (runtimeViewport.width * 0.5) / Math.max(cameraRef.current.scale, 0.0001) - viewportInset;
                const viewportWorldRight = cameraRef.current.x + (runtimeViewport.width * 0.5) / Math.max(cameraRef.current.scale, 0.0001) + viewportInset;
                const viewportWorldTop = cameraRef.current.y - (runtimeViewport.height * 0.5) / Math.max(cameraRef.current.scale, 0.0001) - viewportInset;
                const viewportWorldBottom = cameraRef.current.y + (runtimeViewport.height * 0.5) / Math.max(cameraRef.current.scale, 0.0001) + viewportInset;

                obstacleNode.clear();
                windowLayout.obstacles.forEach(obstacle => {
                    const visibleInViewport = intersectsViewportBounds(
                        obstacle.x,
                        obstacle.y,
                        obstacle.width,
                        obstacle.height,
                        viewportWorldLeft,
                        viewportWorldRight,
                        viewportWorldTop,
                        viewportWorldBottom
                    );
                    if (!visibleInViewport) {
                        return;
                    }

                    const pulsedAlpha = obstacle.alpha + (staticMode ? 0 : bass * 0.025);
                    if (obstacle.shape === 'rect') {
                        if (obstacle.filled) {
                            drawRotatedRectFill(
                                obstacleNode,
                                obstacle.x,
                                obstacle.y,
                                obstacle.width,
                                obstacle.height,
                                obstacle.rotation,
                                obstacle.color,
                                pulsedAlpha * 0.2,
                            );
                        }
                        drawRotatedRectOutline(
                            obstacleNode,
                            obstacle.x,
                            obstacle.y,
                            obstacle.width,
                            obstacle.height,
                            obstacle.rotation,
                            obstacle.color,
                            pulsedAlpha,
                            8
                        );
                    } else if (obstacle.shape === 'triangle') {
                        if (obstacle.filled) {
                            drawTriangleFill(
                                obstacleNode,
                                obstacle.x,
                                obstacle.y,
                                Math.max(obstacle.width, obstacle.height) * 0.4,
                                obstacle.rotation,
                                obstacle.color,
                                pulsedAlpha * 0.18
                            );
                        }
                        drawTriangleOutline(
                            obstacleNode,
                            obstacle.x,
                            obstacle.y,
                            Math.max(obstacle.width, obstacle.height) * 0.4,
                            obstacle.rotation,
                            obstacle.color,
                            pulsedAlpha,
                            8
                        );
                    } else if (obstacle.shape === 'circle') {
                        if (obstacle.filled) {
                            obstacleNode
                                .circle(obstacle.x, obstacle.y, Math.max(obstacle.width, obstacle.height) * 0.32)
                                .fill({
                                    color: obstacle.color,
                                    alpha: pulsedAlpha * 0.16,
                                });
                        }
                        obstacleNode
                            .circle(obstacle.x, obstacle.y, Math.max(obstacle.width, obstacle.height) * 0.32)
                            .stroke({
                                color: obstacle.color,
                                width: 8,
                                alpha: pulsedAlpha,
                            });
                    }
                });

                sceneViewsRef.current.obstacleTextViews.forEach(view => {
                    view.text.visible = intersectsViewportBounds(
                        view.obstacle.x,
                        view.obstacle.y,
                        view.obstacle.width,
                        view.obstacle.height,
                        viewportWorldLeft,
                        viewportWorldRight,
                        viewportWorldTop,
                        viewportWorldBottom
                    );
                    if (!view.text.visible) {
                        return;
                    }
                    view.text.tint = view.obstacle.color;
                    view.text.alpha = view.obstacle.alpha + (staticMode ? 0.04 : vocal * 0.05);
                    view.text.scale.set(1 + (staticMode ? 0.02 : bass * 0.02));
                    view.text.rotation = view.obstacle.rotation;
                    const glowFilter = getFirstGlowFilter(view.text);
                    if (glowFilter) {
                        glowFilter.color = view.obstacle.color;
                        glowFilter.outerStrength = 1.4 + vocal * 1.1;
                        glowFilter.alpha = 0.34 + vocal * 0.14;
                    }
                });

                sceneViewsRef.current.lyricsViews.forEach((view, index) => {
                    const unit = view.unit;
                    view.text.visible = intersectsViewportBounds(
                        unit.x,
                        unit.y,
                        unit.width,
                        unit.height,
                        viewportWorldLeft,
                        viewportWorldRight,
                        viewportWorldTop,
                        viewportWorldBottom
                    );
                    if (!view.text.visible) {
                        return;
                    }

                    const state = focus.unitIndex > index
                        ? 'passed'
                        : focus.unitIndex === index
                            ? 'active'
                            : 'waiting';
                    const lineWeakening = unit.sourceLineIndex === activeSourceIndexRef.current
                        ? 1
                        : unit.sourceLineIndex === upcomingSourceIndexRef.current
                            ? 0.72
                            : 0.46;
                    const activePulse = staticMode ? 1.06 : (1.12 + vocal * 0.14);
                    const activeWobble = staticMode ? 0.02 : Math.sin(currentTimeValue * 18 + index * 0.6) * 0.08;
                    view.text.tint = state === 'active'
                        ? activeColor
                        : state === 'passed'
                            ? primaryColor
                            : secondaryColor;
                    view.text.alpha = showTextRef.current ? 1 : 0;
                    view.text.scale.set(
                        state === 'active'
                            ? activePulse
                            : state === 'passed'
                                ? 0.95
                                : 0.88
                    );
                    view.text.rotation = unit.rotation + (state === 'active' ? activeWobble : 0);
                    const glowFilter = getFirstGlowFilter(view.text);
                    if (glowFilter) {
                        glowFilter.color = state === 'active' ? activeColor : (state === 'passed' ? primaryColor : secondaryColor);
                        glowFilter.outerStrength = state === 'active' ? (1.15 + vocal * 0.7) : 0.45;
                        glowFilter.innerStrength = 0;
                        glowFilter.alpha = state === 'active' ? 0.28 : (state === 'passed' ? 0.14 : 0.08);
                    }
                });

                guideNode.clear();
                for (let index = 0; index < windowLayout.pathMetrics.segmentLengths.length; index += 1) {
                    const from = windowLayout.pathMetrics.points[index]!;
                    const to = windowLayout.pathMetrics.points[index + 1]!;
                    const segmentMinX = Math.min(from.x, to.x);
                    const segmentMaxX = Math.max(from.x, to.x);
                    const segmentMinY = Math.min(from.y, to.y);
                    const segmentMaxY = Math.max(from.y, to.y);
                    const intersectsViewport = !(
                        segmentMaxX < viewportWorldLeft
                        || segmentMinX > viewportWorldRight
                        || segmentMaxY < viewportWorldTop
                        || segmentMinY > viewportWorldBottom
                    );

                    if (!intersectsViewport) {
                        continue;
                    }

                    const segmentStart = windowLayout.pathMetrics.cumulativeStarts[index]!;
                    const segmentEnd = segmentStart + windowLayout.pathMetrics.segmentLengths[index]!;
                    const isPassed = focus.distance >= segmentEnd;
                    const isCurrent = focus.distance >= segmentStart && focus.distance <= segmentEnd;
                    if (isPassed || isCurrent) {
                        const trailToX = isCurrent ? focus.x : to.x;
                        const trailToY = isCurrent ? focus.y : to.y;
                        guideNode
                            .moveTo(from.x, from.y)
                            .lineTo(trailToX, trailToY)
                            .stroke({
                                color: activeColor,
                                width: isCurrent ? 7 : 5,
                                alpha: isCurrent ? 0.58 : 0.36,
                                cap: 'round',
                                join: 'round',
                            });
                    }

                    if (isCurrent) {
                        guideNode
                            .moveTo(from.x, from.y)
                            .lineTo(focus.x, focus.y)
                            .stroke({
                                color: trailGuideColor,
                                width: 5,
                                alpha: 0.42,
                                cap: 'round',
                                join: 'round',
                            });
                        guideNode
                            .moveTo(focus.x, focus.y)
                            .lineTo(to.x, to.y)
                            .stroke({
                                color: futureGuideColor,
                                width: 3,
                                alpha: 0.16,
                                cap: 'round',
                                join: 'round',
                            });
                        continue;
                    }

                    guideNode
                        .moveTo(from.x, from.y)
                        .lineTo(to.x, to.y)
                        .stroke({
                            color: isPassed ? trailGuideColor : futureGuideColor,
                            width: isPassed ? 5 : 3,
                            alpha: isPassed ? 0.42 : 0.14,
                            cap: 'round',
                            join: 'round',
                        });
                }

                const activeUnit = windowLayout.focusUnits[focus.unitIndex] ?? null;
                if (activeUnit && lastHitUnitIdRef.current !== activeUnit.id) {
                    lastHitUnitIdRef.current = activeUnit.id;
                    hitBurstsRef.current.push({
                        id: `burst-${activeUnit.id}-${currentTimeValue.toFixed(3)}`,
                        unitId: activeUnit.id,
                        x: activeUnit.x,
                        y: activeUnit.y,
                        createdAt: currentTimeValue,
                        color: activeColor,
                    });
                }
                hitBurstsRef.current = hitBurstsRef.current.filter(burst => currentTimeValue - burst.createdAt < 0.42);
                effectNode.clear();
                hitBurstsRef.current.forEach((burst, burstIndex) => {
                    const age = currentTimeValue - burst.createdAt;
                    const progress = clamp(age / 0.42, 0, 1);
                    const particleCount = 8;
                    const radius = mix(12, 94, progress);
                    const particleRadius = mix(10, 2, progress);
                    for (let index = 0; index < particleCount; index += 1) {
                        const angle = (Math.PI * 2 * index) / particleCount + burstIndex * 0.12;
                        effectNode
                            .circle(
                                burst.x + Math.cos(angle) * radius,
                                burst.y + Math.sin(angle) * radius,
                                particleRadius
                            )
                            .fill({
                                color: burst.color,
                                alpha: (1 - progress) * 0.32,
                            });
                    }
                    effectNode
                        .circle(burst.x, burst.y, mix(18, 88, progress))
                        .stroke({
                            color: burst.color,
                            width: mix(10, 1, progress),
                            alpha: (1 - progress) * 0.18,
                        });
                });

                arrowNode.clear();
                const arrowLength = 30;
                const arrowWidth = 16;
                const centerX = focus.x;
                const centerY = focus.y;
                const tipX = centerX + Math.cos(focus.angle) * arrowLength;
                const tipY = centerY + Math.sin(focus.angle) * arrowLength;
                const leftX = centerX + Math.cos(focus.angle + Math.PI * 0.82) * arrowWidth;
                const leftY = centerY + Math.sin(focus.angle + Math.PI * 0.82) * arrowWidth;
                const rightX = centerX + Math.cos(focus.angle - Math.PI * 0.82) * arrowWidth;
                const rightY = centerY + Math.sin(focus.angle - Math.PI * 0.82) * arrowWidth;
                arrowNode
                    .moveTo(tipX, tipY)
                    .lineTo(leftX, leftY)
                    .lineTo(rightX, rightY)
                    .closePath()
                    .fill({
                        color: activeColor,
                        alpha: 0.98,
                    });
            };

            app.ticker.add(tick);
            setPixiReady(true);

            return () => {
                observer.disconnect();
                app.ticker.remove(tick);
            };
        };

        let cleanup: (() => void) | undefined;
        void initialize().then(result => {
            cleanup = result;
        });

        return () => {
            cancelled = true;
            cleanup?.();
            destroySceneViews(sceneViewsRef.current);
            sceneViewsRef.current = {
                lyricsViews: [],
                obstacleTextViews: [],
            };
            appRef.current?.destroy({ removeView: true }, true);
            appRef.current = null;
            worldRef.current = null;
            obstacleGraphicsRef.current = null;
            guideGraphicsRef.current = null;
            arrowGraphicsRef.current = null;
            effectGraphicsRef.current = null;
            obstacleTextLayerRef.current = null;
            mainLyricsLayerRef.current = null;
            setPixiReady(false);
        };
    }, []);

    useEffect(() => {
        worldWindowRef.current = overtureWindow;

        const obstacleTextLayer = obstacleTextLayerRef.current;
        const mainLyricsLayer = mainLyricsLayerRef.current;
        const obstacleGraphics = obstacleGraphicsRef.current;
        const guideGraphics = guideGraphicsRef.current;
        const arrowGraphics = arrowGraphicsRef.current;
        const effectGraphics = effectGraphicsRef.current;
        if (!obstacleTextLayer || !mainLyricsLayer || !obstacleGraphics || !guideGraphics || !arrowGraphics || !effectGraphics) {
            return;
        }

        destroySceneViews(sceneViewsRef.current);
        sceneViewsRef.current = {
            lyricsViews: [],
            obstacleTextViews: [],
        };

        obstacleTextLayer.removeChildren();
        mainLyricsLayer.removeChildren();
        obstacleGraphics.clear();
        guideGraphics.clear();
        arrowGraphics.clear();
        effectGraphics.clear();

        const secondaryColor = colorToNumber(theme.secondaryColor, 0xffffff);
        overtureWindow.obstacles
            .filter(obstacle => obstacle.shape === 'text' && obstacle.text)
            .forEach(obstacle => {
                const fontPx = clamp(obstacle.height * 0.56, 20, 66);
                const label = createLabelText(obstacle.text ?? '', fontPx, secondaryColor, obstacle.alpha, theme);
                attachGlowFilter(label, createGlowFilter({
                    distance: 22,
                    outerStrength: 1.6,
                    innerStrength: 0,
                    color: obstacle.color,
                    quality: 0.22,
                    alpha: 0.36,
                    knockout: false,
                }));
                label.anchor.set(0.5);
                label.x = obstacle.x;
                label.y = obstacle.y;
                label.rotation = obstacle.rotation;
                obstacleTextLayer.addChild(label);
                sceneViewsRef.current.obstacleTextViews.push({
                    obstacle,
                    text: label,
                });
            });

        overtureWindow.focusUnits.forEach(unit => {
            const label = createLabelText(unit.text, unit.fontSize, secondaryColor, showText ? 0.82 : 0, theme);
            attachGlowFilter(label, createGlowFilter({
                distance: 34,
                outerStrength: 0.72,
                innerStrength: 0,
                color: secondaryColor,
                quality: 0.3,
                alpha: 0.1,
                knockout: false,
            }));
            label.anchor.set(0.5);
            label.x = unit.x;
            label.y = unit.y;
            label.rotation = unit.rotation;
            mainLyricsLayer.addChild(label);
            sceneViewsRef.current.lyricsViews.push({
                unit,
                text: label,
            });
        });

        const initialFocusBase = getFocusSnapshot(overtureWindow.focusUnits, currentTime.get(), staticMode);
        if (!initialFocusBase) {
            cameraRef.current = {
                x: 0,
                y: 0,
                scale: 1,
                velocityScale: 0,
            };
            return;
        }

        const initialFocus = samplePath(overtureWindow.pathMetrics, initialFocusBase.distance);
        cameraRef.current = {
            x: initialFocus.x,
            y: initialFocus.y,
            scale: 1,
            velocityScale: 0,
        };
    }, [currentTime, overtureWindow, showText, staticMode, theme]);

    const translationFontSize = `clamp(${(1.05 * lyricsFontScale).toFixed(3)}rem, ${(2.2 * lyricsFontScale).toFixed(3)}vw, ${(1.2 * lyricsFontScale).toFixed(3)}rem)`;
    const upcomingFontSize = `clamp(${(0.875 * lyricsFontScale).toFixed(3)}rem, ${(1.9 * lyricsFontScale).toFixed(3)}vw, ${(1 * lyricsFontScale).toFixed(3)}rem)`;
    const emptyStateVisible = !activeLine && !recentCompletedLine && !upcomingLine;

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
            disableGeometricBackground={pixiReady}
        >
            <div ref={pixiHostRef} className="absolute inset-0 z-10" />

            {emptyStateVisible && (
                <div
                    className="absolute inset-0 z-20 flex items-center justify-center px-6 text-center pointer-events-none"
                    style={{
                        color: theme.secondaryColor,
                        fontFamily: resolveThemeFontStack(theme),
                        fontSize: `clamp(${(1.3 * lyricsFontScale).toFixed(3)}rem, ${(3 * lyricsFontScale).toFixed(3)}vw, ${(2.1 * lyricsFontScale).toFixed(3)}rem)`,
                    }}
                >
                    {t('ui.waitingForMusic') || 'waiting for music'}
                </div>
            )}

            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={recentCompletedLine}
                nextLines={nextLines}
                theme={theme}
                translationFontSize={translationFontSize}
                upcomingFontSize={upcomingFontSize}
                opacity={0.66}
            />
        </VisualizerShell>
    );
};

export default VisualizerOverture;
