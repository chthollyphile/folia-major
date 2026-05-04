import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Application, Container, Graphics, Text } from 'pixi.js';
import { layoutWithLines, prepareWithSegments, type LayoutLine } from '@chenglou/pretext';
import { AudioBands, Line, Theme } from '../../../types';
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

interface GlyphTiming {
    startTime: number;
    endTime: number;
}

interface GlyphPlacement {
    id: string;
    lineIndex: number;
    glyphIndex: number;
    text: string;
    startTime: number;
    endTime: number;
    lineExitTime: number;
    targetX: number;
    targetY: number;
    sourceX: number;
    sourceY: number;
    fontPx: number;
    emphasis: number;
    phaseOffset: number;
    laneIndex: number;
}

interface LinePlacement {
    index: number;
    startTime: number;
    endTime: number;
    glyphStart: number;
    glyphEnd: number;
    centerX: number;
    centerY: number;
    width: number;
    height: number;
}

interface WorldLayout {
    glyphs: GlyphPlacement[];
    lines: LinePlacement[];
    worldWidth: number;
    worldHeight: number;
}

interface GlyphView {
    data: GlyphPlacement;
    layer: Container;
    connector: Graphics;
    accents: Graphics;
    text: Text;
}

interface CameraState {
    x: number;
    y: number;
    scale: number;
    velocityX: number;
    velocityY: number;
    velocityScale: number;
}

const DEFAULT_VIEWPORT: ViewportSize = { width: 0, height: 0 };
const DESTROY_AFTER_SECONDS = 8;
const PRELOAD_AHEAD_SECONDS = 22;
const GUIDE_WINDOW_LINES = 6;

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
const easeOutCubic = (value: number) => 1 - Math.pow(1 - clamp(value, 0, 1), 3);
const easeInCubic = (value: number) => Math.pow(clamp(value, 0, 1), 3);
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

const colorToNumber = (color: string, fallback: number) => {
    if (!color.startsWith('#')) {
        return fallback;
    }

    const hex = color.slice(1);
    if (hex.length === 3) {
        return Number.parseInt(hex.split('').map(char => char + char).join(''), 16);
    }
    if (hex.length === 6) {
        return Number.parseInt(hex, 16);
    }
    return fallback;
};

const createMeasureContext = () => {
    const canvas = document.createElement('canvas');
    return canvas.getContext('2d');
};

const mapWordTimingsToLine = (line: Line, graphemes: string[]): GlyphTiming[] => {
    const fallback = graphemes.map((_, index) => {
        const progress = graphemes.length <= 1 ? 0 : index / graphemes.length;
        const nextProgress = graphemes.length <= 1 ? 1 : (index + 1) / graphemes.length;

        return {
            startTime: mix(line.startTime, line.endTime, progress),
            endTime: mix(line.startTime, line.endTime, nextProgress),
        };
    });

    if (!line.words.length) {
        return fallback;
    }

    const normalized = [...fallback];
    let cursor = 0;

    line.words.forEach(word => {
        const wordGraphemes = splitGraphemes(word.text);
        if (!wordGraphemes.length) {
            return;
        }

        for (let start = cursor; start <= graphemes.length - wordGraphemes.length; start += 1) {
            const matches = wordGraphemes.every((glyph, offset) => graphemes[start + offset] === glyph);
            if (!matches) {
                continue;
            }

            wordGraphemes.forEach((_, offset) => {
                const progress = offset / wordGraphemes.length;
                const nextProgress = (offset + 1) / wordGraphemes.length;

                normalized[start + offset] = {
                    startTime: mix(word.startTime, word.endTime, progress),
                    endTime: mix(word.startTime, word.endTime, nextProgress),
                };
            });

            cursor = start + wordGraphemes.length;
            break;
        }
    });

    return normalized;
};

const measureGlyphCenters = (
    measureContext: CanvasRenderingContext2D,
    layoutLine: LayoutLine,
    lineX: number,
    baselineY: number
) => {
    const graphemes = splitGraphemes(layoutLine.text);
    if (!graphemes.length) {
        return [] as Array<{ x: number, y: number, text: string }>;
    }

    const widths = graphemes.map(glyph => measureContext.measureText(glyph).width);
    const measuredWidth = widths.reduce((sum, width) => sum + width, 0);
    const scale = measuredWidth > 0 ? layoutLine.width / measuredWidth : 1;

    let advance = 0;

    return graphemes.map((glyph, index) => {
        const width = (widths[index] ?? 0) * scale;
        const center = lineX + advance + width * 0.5;

        advance += width;

        return {
            x: center,
            y: baselineY,
            text: glyph,
        };
    });
};

const findFocusGlyphIndex = (glyphs: GlyphPlacement[], currentTimeValue: number) => {
    if (!glyphs.length) {
        return -1;
    }

    let latestStarted = -1;

    for (let index = 0; index < glyphs.length; index += 1) {
        const glyph = glyphs[index];
        if (currentTimeValue >= glyph.startTime && currentTimeValue <= glyph.lineExitTime + DESTROY_AFTER_SECONDS) {
            latestStarted = index;
        }
        if (currentTimeValue < glyph.startTime) {
            return latestStarted >= 0 ? latestStarted : index;
        }
    }

    return latestStarted >= 0 ? latestStarted : glyphs.length - 1;
};

const buildWorldLayout = ({
    lines,
    viewport,
    theme,
    lyricsFontScale,
    seed,
}: {
    lines: Line[];
    viewport: ViewportSize;
    theme: Theme;
    lyricsFontScale: number;
    seed: string | number | undefined;
}): WorldLayout => {
    if (viewport.width <= 0 || viewport.height <= 0 || !lines.length) {
        return {
            glyphs: [],
            lines: [],
            worldWidth: viewport.width,
            worldHeight: viewport.height,
        };
    }

    const measureContext = createMeasureContext();
    if (!measureContext) {
        return {
            glyphs: [],
            lines: [],
            worldWidth: viewport.width,
            worldHeight: viewport.height,
        };
    }

    const fontFamily = resolveThemeFontStack(theme);
    const filtered = lines
        .map((line, index) => ({ line, index }))
        .filter(entry => entry.line.fullText.trim().length > 0);
    const glyphs: GlyphPlacement[] = [];
    const linePlacements: LinePlacement[] = [];
    const laneHeight = Math.max(viewport.height * 0.16, 110);
    const worldHeight = Math.max(viewport.height * 2.4, laneHeight * 9);
    const baseY = worldHeight * 0.5;
    let worldCursorX = Math.max(viewport.width * 0.35, 280);
    let previousTarget = {
        x: worldCursorX - viewport.width * 0.18,
        y: baseY,
    };

    filtered.forEach(({ line, index }, filteredIndex) => {
        const graphemes = splitGraphemes(line.fullText);
        if (!graphemes.length) {
            return;
        }

        const timings = mapWordTimingsToLine(line, graphemes);
        const laneIndex = Math.round((hashToUnit(`${seed ?? 'overture'}:lane:${index}`) - 0.5) * 4);
        const lineBoxWidth = clamp(
            viewport.width * mix(0.26, 0.48, hashToUnit(`${seed ?? 'overture'}:width:${index}`)),
            220,
            560
        );
        const fontPx = clamp(
            viewport.width * 0.034 * lyricsFontScale * (graphemes.length <= 12 ? 1.05 : 0.92),
            22 * lyricsFontScale,
            54 * lyricsFontScale
        );
        const lineHeight = fontPx * 1.18;
        const font = `700 ${Math.round(fontPx)}px ${fontFamily}`;
        const prepared = prepareWithSegments(line.fullText, font);
        const layout = layoutWithLines(prepared, lineBoxWidth, lineHeight);
        const layoutWidth = layout.lines.reduce((widest, layoutLine) => Math.max(widest, layoutLine.width), 0);
        const layoutHeight = layout.height;
        const verticalDrift = (hashToUnit(`${seed ?? 'overture'}:drift:${index}`) - 0.5) * laneHeight * 1.2;
        const lineTop = clamp(
            baseY + laneIndex * laneHeight + verticalDrift - layoutHeight * 0.5,
            80,
            worldHeight - layoutHeight - 80
        );
        const lineLeft = worldCursorX;

        measureContext.font = font;

        const glyphStart = glyphs.length;

        layout.lines.forEach((layoutLine, wrappedLineIndex) => {
            const lineX = lineLeft;
            const baselineY = lineTop + wrappedLineIndex * lineHeight + lineHeight * 0.58;
            const centers = measureGlyphCenters(measureContext, layoutLine, lineX, baselineY);
            const globalStart = layoutLine.start.graphemeIndex;

            centers.forEach((center, glyphOffset) => {
                const glyphIndex = globalStart + glyphOffset;
                const timing = timings[glyphIndex];
                if (!timing || !center.text.trim()) {
                    return;
                }

                const target = {
                    x: center.x,
                    y: center.y,
                };

                glyphs.push({
                    id: `overture-${index}-${glyphIndex}`,
                    lineIndex: index,
                    glyphIndex,
                    text: center.text,
                    startTime: timing.startTime,
                    endTime: Math.max(timing.endTime, timing.startTime + 0.01),
                    lineExitTime: getLineRenderEndTime(line),
                    targetX: target.x,
                    targetY: target.y,
                    sourceX: previousTarget.x,
                    sourceY: previousTarget.y,
                    fontPx,
                    emphasis: filteredIndex % 5 === 0 ? 1.06 : 1,
                    phaseOffset: hashToUnit(`${seed ?? 'overture'}:phase:${index}:${glyphIndex}`),
                    laneIndex,
                });

                previousTarget = target;
            });
        });

        const glyphEnd = glyphs.length;
        linePlacements.push({
            index,
            startTime: line.startTime,
            endTime: getLineRenderEndTime(line),
            glyphStart,
            glyphEnd,
            centerX: lineLeft + layoutWidth * 0.5,
            centerY: lineTop + layoutHeight * 0.5,
            width: layoutWidth,
            height: layoutHeight,
        });

        worldCursorX += layoutWidth + Math.max(viewport.width * 0.18, 180) + Math.abs(laneIndex) * 18;
    });

    return {
        glyphs,
        lines: linePlacements,
        worldWidth: Math.max(worldCursorX + viewport.width * 0.4, viewport.width * 1.2),
        worldHeight,
    };
};

const createGlyphView = (
    glyph: GlyphPlacement,
    theme: Theme,
    primaryColor: number,
    accentColor: number
): GlyphView => {
    const layer = new Container();
    const connector = new Graphics();
    const accents = new Graphics();
    const text = new Text({
        text: glyph.text,
        style: {
            fontFamily: resolveThemeFontStack(theme),
            fontSize: Math.round(glyph.fontPx),
            fontWeight: '700',
            fill: primaryColor,
            dropShadow: {
                color: theme.accentColor,
                alpha: 0.35,
                blur: 18,
                distance: 0,
            },
        },
    });

    const bounds = text.getLocalBounds();
    text.pivot.set(bounds.width * 0.5, bounds.height * 0.55);
    text.tint = primaryColor;

    layer.addChild(connector);
    layer.addChild(accents);
    layer.addChild(text);

    return {
        data: glyph,
        layer,
        connector,
        accents,
        text,
    };
};

const drawGlyphFrame = (
    view: GlyphView,
    currentTimeValue: number,
    audioLevel: number,
    showText: boolean,
    primaryColor: number,
    accentColor: number
) => {
    const { data, connector, accents, text } = view;
    const enterDuration = Math.max((data.endTime - data.startTime) * 1.4, 0.16);
    const revealProgress = clamp((currentTimeValue - data.startTime) / enterDuration, 0, 1);
    const revealEase = easeOutCubic(revealProgress);
    const trailAge = Math.max(currentTimeValue - data.lineExitTime, 0);
    const fade = 1 - easeInCubic(clamp(trailAge / DESTROY_AFTER_SECONDS, 0, 1));
    const audioPulse = clamp(audioLevel, 0, 1.25);
    const travelX = mix(data.sourceX, data.targetX, revealEase);
    const travelY = mix(data.sourceY, data.targetY, revealEase);
    const orbit = Math.sin((currentTimeValue + data.phaseOffset) * 3.4) * (5 + audioPulse * 6);

    connector.clear();
    accents.clear();

    if (revealProgress <= 0 || fade <= 0.001) {
        text.alpha = 0;
        return;
    }

    text.alpha = showText ? fade : 0;
    text.x = data.targetX;
    text.y = data.targetY + orbit * 0.08;
    text.scale.set(mix(0.72, 1, revealEase) * (1 + audioPulse * 0.04));
    text.tint = revealProgress < 1 ? accentColor : primaryColor;

    connector
        .moveTo(data.sourceX, data.sourceY)
        .lineTo(travelX, travelY)
        .stroke({
            color: accentColor,
            width: 2 + audioPulse * 1.6,
            alpha: mix(0.08, 0.92, revealEase) * fade,
        });

    if (revealProgress >= 1) {
        connector
            .moveTo(travelX, travelY)
            .lineTo(data.targetX, data.targetY)
            .stroke({
                color: primaryColor,
                width: 1.2 + audioPulse,
                alpha: 0.28 * fade,
            });
    }

    const spikeSize = 8 + audioPulse * 8;
    const angle = Math.atan2(data.targetY - data.sourceY, data.targetX - data.sourceX);
    const headX = travelX + Math.cos(angle) * spikeSize;
    const headY = travelY + Math.sin(angle) * spikeSize;
    const leftX = travelX + Math.cos(angle + Math.PI * 0.72) * (spikeSize * 0.5);
    const leftY = travelY + Math.sin(angle + Math.PI * 0.72) * (spikeSize * 0.5);
    const rightX = travelX + Math.cos(angle - Math.PI * 0.72) * (spikeSize * 0.5);
    const rightY = travelY + Math.sin(angle - Math.PI * 0.72) * (spikeSize * 0.5);

    accents
        .moveTo(headX, headY)
        .lineTo(leftX, leftY)
        .lineTo(rightX, rightY)
        .closePath()
        .fill({ color: primaryColor, alpha: 0.48 * fade })
        .circle(data.targetX, data.targetY, 4 + audioPulse * 4)
        .stroke({ color: accentColor, width: 1.2, alpha: 0.44 * fade })
        .circle(data.targetX, data.targetY, 1.8 + audioPulse * 1.2)
        .fill({ color: primaryColor, alpha: 0.82 * fade });

    if (revealProgress < 1) {
        accents
            .circle(data.sourceX, data.sourceY, mix(5, 24, revealEase))
            .stroke({
                color: accentColor,
                width: 0.8 + audioPulse,
                alpha: (1 - revealProgress) * 0.26,
            });
    }
};

const drawGuideFrame = ({
    guideGraphics,
    obstacleGraphics,
    worldLayout,
    focusGlyphIndex,
    currentTimeValue,
    audioLevel,
    primaryColor,
    accentColor,
}: {
    guideGraphics: Graphics;
    obstacleGraphics: Graphics;
    worldLayout: WorldLayout;
    focusGlyphIndex: number;
    currentTimeValue: number;
    audioLevel: number;
    primaryColor: number;
    accentColor: number;
}) => {
    guideGraphics.clear();
    obstacleGraphics.clear();

    if (focusGlyphIndex < 0 || !worldLayout.glyphs.length) {
        return;
    }

    const focusGlyph = worldLayout.glyphs[focusGlyphIndex];
    const focusLineIndex = focusGlyph.lineIndex;
    const visibleLines = worldLayout.lines.filter(line => Math.abs(line.index - focusLineIndex) <= GUIDE_WINDOW_LINES);

    visibleLines.forEach((linePlacement, placementIndex) => {
        const lineGlyphs = worldLayout.glyphs.slice(linePlacement.glyphStart, linePlacement.glyphEnd);
        if (lineGlyphs.length < 2) {
            return;
        }

        const progress = clamp((currentTimeValue - linePlacement.startTime) / Math.max(linePlacement.endTime - linePlacement.startTime, 0.24), 0, 1);
        const lineAlpha = linePlacement.endTime + DESTROY_AFTER_SECONDS <= currentTimeValue
            ? 0
            : 0.12 + (1 - clamp((currentTimeValue - linePlacement.endTime) / DESTROY_AFTER_SECONDS, 0, 1)) * 0.22;

        for (let index = 1; index < lineGlyphs.length; index += 1) {
            const previous = lineGlyphs[index - 1];
            const next = lineGlyphs[index];
            guideGraphics
                .moveTo(previous.targetX, previous.targetY)
                .lineTo(next.targetX, next.targetY)
                .stroke({
                    color: placementIndex % 2 === 0 ? accentColor : primaryColor,
                    width: 1 + audioLevel * 0.9,
                    alpha: lineAlpha,
                });

            const localPhase = (currentTimeValue * (0.45 + index * 0.03) + next.phaseOffset) % 1;
            const pulseX = mix(previous.targetX, next.targetX, localPhase);
            const pulseY = mix(previous.targetY, next.targetY, localPhase);
            obstacleGraphics
                .rect(pulseX - 3.5, pulseY - 3.5, 7, 7)
                .fill({
                    color: placementIndex % 2 === 0 ? primaryColor : accentColor,
                    alpha: 0.14 + progress * 0.2,
                });
        }

        const firstGlyph = lineGlyphs[0];
        const lastGlyph = lineGlyphs[lineGlyphs.length - 1];
        const corridorWidth = Math.max(linePlacement.width + 60, 120);

        guideGraphics
            .roundRect(
                linePlacement.centerX - corridorWidth * 0.5,
                linePlacement.centerY - Math.max(linePlacement.height * 0.7, 36),
                corridorWidth,
                Math.max(linePlacement.height * 1.4, 72),
                22
            )
            .stroke({
                color: accentColor,
                width: 0.9 + audioLevel * 0.4,
                alpha: 0.08 + lineAlpha * 0.26,
            });

        obstacleGraphics
            .circle(firstGlyph.sourceX, firstGlyph.sourceY, 2.2 + audioLevel * 1.4)
            .fill({ color: accentColor, alpha: 0.16 + lineAlpha * 0.26 })
            .circle(lastGlyph.targetX, lastGlyph.targetY, 2.8 + audioLevel * 2)
            .fill({ color: primaryColor, alpha: 0.2 + lineAlpha * 0.3 });
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
    staticMode,
    backgroundOpacity,
    lyricsFontScale = 1,
    onBack,
}) => {
    const { t } = useTranslation();
    const pixiHostRef = useRef<HTMLDivElement | null>(null);
    const appRef = useRef<Application | null>(null);
    const cameraRootRef = useRef<Container | null>(null);
    const worldRef = useRef<Container | null>(null);
    const guideGraphicsRef = useRef<Graphics | null>(null);
    const obstacleGraphicsRef = useRef<Graphics | null>(null);
    const glyphViewsRef = useRef<Map<string, GlyphView>>(new Map());
    const currentTimeRef = useRef(currentTime);
    const audioPowerRef = useRef(audioPower);
    const showTextRef = useRef(showText);
    const worldLayoutRef = useRef<WorldLayout>({
        glyphs: [],
        lines: [],
        worldWidth: 0,
        worldHeight: 0,
    });
    const cameraRef = useRef<CameraState>({
        x: 0,
        y: 0,
        scale: 1,
        velocityX: 0,
        velocityY: 0,
        velocityScale: 0,
    });
    const [viewport, setViewport] = useState<ViewportSize>(DEFAULT_VIEWPORT);
    const [pixiReady, setPixiReady] = useState(false);
    const primaryColor = useMemo(() => colorToNumber(theme.primaryColor, 0xffffff), [theme.primaryColor]);
    const accentColor = useMemo(() => colorToNumber(theme.accentColor, primaryColor), [primaryColor, theme.accentColor]);
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
        audioPowerRef.current = audioPower;
    }, [audioPower]);

    useEffect(() => {
        showTextRef.current = showText;
    }, [showText]);

    useEffect(() => {
        const host = pixiHostRef.current;
        if (!host || appRef.current) {
            return;
        }

        let cancelled = false;
        const app = new Application();
        const cameraRoot = new Container();
        const world = new Container();
        const guideGraphics = new Graphics();
        const obstacleGraphics = new Graphics();

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
            world.addChild(guideGraphics);
            world.addChild(obstacleGraphics);
            cameraRoot.addChild(world);
            app.stage.addChild(cameraRoot);

            appRef.current = app;
            cameraRootRef.current = cameraRoot;
            worldRef.current = world;
            guideGraphicsRef.current = guideGraphics;
            obstacleGraphicsRef.current = obstacleGraphics;

            const resize = () => {
                const bounds = host.getBoundingClientRect();
                setViewport({ width: bounds.width, height: bounds.height });
            };

            resize();

            const observer = new ResizeObserver(resize);
            observer.observe(host);

            const tick = (ticker: { deltaMS: number; }) => {
                const worldLayout = worldLayoutRef.current;
                const cameraRootNode = cameraRootRef.current;
                const worldNode = worldRef.current;
                const guideNode = guideGraphicsRef.current;
                const obstacleNode = obstacleGraphicsRef.current;

                if (!cameraRootNode || !worldNode || !guideNode || !obstacleNode || !worldLayout.glyphs.length) {
                    return;
                }

                const currentTimeValue = currentTimeRef.current.get();
                const audioLevel = clamp(audioPowerRef.current.get(), 0, 1.4);
                const focusGlyphIndex = findFocusGlyphIndex(worldLayout.glyphs, currentTimeValue);
                const focusGlyph = worldLayout.glyphs[focusGlyphIndex] ?? null;

                if (!focusGlyph) {
                    return;
                }

                const lookAhead = clamp(viewport.width * (0.18 + audioLevel * 0.06), 120, 260);
                const targetScale = clamp(1.02 + focusGlyph.emphasis * 0.05 + audioLevel * 0.02, 0.94, 1.18);
                const targetX = clamp(focusGlyph.targetX + lookAhead, viewport.width * 0.5, Math.max(worldLayout.worldWidth - viewport.width * 0.2, viewport.width * 0.5));
                const targetY = clamp(focusGlyph.targetY, viewport.height * 0.4, Math.max(worldLayout.worldHeight - viewport.height * 0.4, viewport.height * 0.5));
                const dt = Math.min(ticker.deltaMS / 1000, 1 / 20);

                const springStrength = 42;
                const damping = 11.5;
                const accelX = (targetX - cameraRef.current.x) * springStrength - cameraRef.current.velocityX * damping;
                const accelY = (targetY - cameraRef.current.y) * springStrength - cameraRef.current.velocityY * damping;
                const accelScale = (targetScale - cameraRef.current.scale) * 26 - cameraRef.current.velocityScale * 9.5;

                cameraRef.current.velocityX += accelX * dt;
                cameraRef.current.velocityY += accelY * dt;
                cameraRef.current.velocityScale += accelScale * dt;
                cameraRef.current.x += cameraRef.current.velocityX * dt;
                cameraRef.current.y += cameraRef.current.velocityY * dt;
                cameraRef.current.scale = clamp(cameraRef.current.scale + cameraRef.current.velocityScale * dt, 0.9, 1.22);

                cameraRootNode.position.set(viewport.width * 0.34, viewport.height * 0.5);
                worldNode.scale.set(cameraRef.current.scale);
                worldNode.position.set(
                    -cameraRef.current.x * cameraRef.current.scale,
                    -cameraRef.current.y * cameraRef.current.scale
                );

                const keepAfter = currentTimeValue - DESTROY_AFTER_SECONDS;
                const keepAhead = currentTimeValue + PRELOAD_AHEAD_SECONDS;

                worldLayout.glyphs.forEach((glyph, index) => {
                    const shouldKeep = glyph.lineExitTime >= keepAfter && glyph.startTime <= keepAhead;
                    const existing = glyphViewsRef.current.get(glyph.id);

                    if (!shouldKeep) {
                        if (existing) {
                            worldNode.removeChild(existing.layer);
                            existing.layer.destroy({ children: true });
                            glyphViewsRef.current.delete(glyph.id);
                        }
                        return;
                    }

                    if (!existing) {
                        const view = createGlyphView(glyph, theme, primaryColor, accentColor);
                        view.layer.zIndex = 20 + index;
                        worldNode.addChild(view.layer);
                        glyphViewsRef.current.set(glyph.id, view);
                    }
                });

                glyphViewsRef.current.forEach(view => {
                    drawGlyphFrame(
                        view,
                        currentTimeValue,
                        audioLevel,
                        showTextRef.current,
                        primaryColor,
                        accentColor
                    );
                });

                drawGuideFrame({
                    guideGraphics: guideNode,
                    obstacleGraphics: obstacleNode,
                    worldLayout,
                    focusGlyphIndex,
                    currentTimeValue,
                    audioLevel,
                    primaryColor,
                    accentColor,
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
            glyphViewsRef.current.forEach(view => {
                view.layer.destroy({ children: true });
            });
            glyphViewsRef.current.clear();
            appRef.current?.destroy({ removeView: true }, true);
            appRef.current = null;
            cameraRootRef.current = null;
            worldRef.current = null;
            guideGraphicsRef.current = null;
            obstacleGraphicsRef.current = null;
            setPixiReady(false);
        };
    }, [accentColor, primaryColor, theme]);

    const worldLayout = useMemo(() => buildWorldLayout({
        lines,
        viewport,
        theme,
        lyricsFontScale,
        seed,
    }), [lines, lyricsFontScale, seed, theme, viewport]);

    useEffect(() => {
        worldLayoutRef.current = worldLayout;
        glyphViewsRef.current.forEach(view => {
            view.layer.destroy({ children: true });
        });
        glyphViewsRef.current.clear();

        if (!worldLayout.glyphs.length) {
            cameraRef.current = {
                x: 0,
                y: 0,
                scale: 1,
                velocityX: 0,
                velocityY: 0,
                velocityScale: 0,
            };
            return;
        }

        const focusIndex = findFocusGlyphIndex(worldLayout.glyphs, currentTime.get());
        const focusGlyph = worldLayout.glyphs[Math.max(focusIndex, 0)];

        cameraRef.current = {
            x: focusGlyph?.targetX ?? 0,
            y: focusGlyph?.targetY ?? 0,
            scale: 1,
            velocityX: 0,
            velocityY: 0,
            velocityScale: 0,
        };
    }, [currentTime, worldLayout]);

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
