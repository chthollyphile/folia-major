import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Application, Container, Graphics, Text } from 'pixi.js';
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

type GeometryPieceKind = 'platform' | 'bridge' | 'title' | 'translation' | 'hazard' | 'ground';
type RhythmUnitKind = 'cjk' | 'word' | 'symbol';

interface OvertureRhythmNode {
    id: string;
    blockIndex: number;
    text: string;
    startTime: number;
    endTime: number;
    x: number;
    y: number;
    width: number;
    height: number;
    entryTangent: number;
    exitTangent: number;
    kind: RhythmUnitKind;
}

interface OvertureGeometryPiece {
    id: string;
    kind: GeometryPieceKind;
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
}

interface OvertureBlock {
    id: string;
    index: number;
    line: Line;
    startX: number;
    endX: number;
    groundY: number;
    titleGeometry: OvertureGeometryPiece[];
    currentLineChannel: OvertureGeometryPiece[];
    translationGeometry: OvertureGeometryPiece[];
    platforms: OvertureGeometryPiece[];
    hazards: OvertureGeometryPiece[];
    rhythmNodes: OvertureRhythmNode[];
}

interface OvertureWorld {
    blocks: OvertureBlock[];
    nodes: OvertureRhythmNode[];
    worldWidth: number;
    worldHeight: number;
}

interface ChannelNodeView {
    node: OvertureRhythmNode;
    frame: Graphics;
    text: Text;
}

interface GeometryLabelView {
    shape: Graphics;
    text?: Text;
}

interface SceneViews {
    channelViews: ChannelNodeView[];
    titleViews: GeometryLabelView[];
    translationViews: GeometryLabelView[];
}

interface CameraState {
    x: number;
    y: number;
    scale: number;
    velocityX: number;
    velocityY: number;
    velocityScale: number;
}

interface FocusSnapshot {
    nodeIndex: number;
    positionX: number;
    positionY: number;
    angle: number;
    progress: number;
}

const DEFAULT_VIEWPORT: ViewportSize = { width: 0, height: 0 };
const CJK_REGEX = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
const LATIN_REGEX = /[A-Za-z0-9]/;
const MAX_FORWARD_HINT_SEGMENTS = 5;

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

const createMeasureContext = () => {
    const canvas = document.createElement('canvas');
    return canvas.getContext('2d');
};

const drawRotatedRect = (
    graphics: Graphics,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    angle: number,
    color: number,
    alpha: number,
    strokeWidth = 0
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
        .closePath();

    if (strokeWidth > 0) {
        graphics.stroke({ color, width: strokeWidth, alpha });
        return;
    }

    graphics.fill({ color, alpha });
};

const drawTriangle = (
    graphics: Graphics,
    centerX: number,
    centerY: number,
    size: number,
    angle: number,
    color: number,
    alpha: number,
    strokeWidth = 0
) => {
    const points = [0, Math.PI * 0.66, -Math.PI * 0.66].map(offset => ({
        x: centerX + Math.cos(angle + offset) * size,
        y: centerY + Math.sin(angle + offset) * size,
    }));

    graphics
        .moveTo(points[0]!.x, points[0]!.y)
        .lineTo(points[1]!.x, points[1]!.y)
        .lineTo(points[2]!.x, points[2]!.y)
        .closePath();

    if (strokeWidth > 0) {
        graphics.stroke({ color, width: strokeWidth, alpha });
        return;
    }

    graphics.fill({ color, alpha });
};

const isLatinWord = (text: string) => LATIN_REGEX.test(text) && !CJK_REGEX.test(text);

const normalizeUnitText = (text: string) => text.replace(/\s+/g, ' ').trim();

const buildFallbackWords = (line: Line): Word[] => {
    const tokens = normalizeUnitText(line.fullText).match(/[A-Za-z0-9'’-]+|[^\s]/g) ?? [];
    if (!tokens.length) {
        return [];
    }

    return tokens.map((token, index) => {
        const startRatio = index / tokens.length;
        const endRatio = (index + 1) / tokens.length;

        return {
            text: token,
            startTime: mix(line.startTime, line.endTime, startRatio),
            endTime: mix(line.startTime, line.endTime, endRatio),
        };
    });
};

// Align rhythm units to lyric timing while keeping English words intact and CJK character-driven.
const buildRhythmUnits = (line: Line) => {
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

        graphemes.forEach((grapheme, index) => {
            const startRatio = index / graphemes.length;
            const endRatio = (index + 1) / graphemes.length;
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

const getUnitFontSize = (text: string, viewport: ViewportSize, lyricsFontScale: number) => {
    const textLength = splitGraphemes(text).length;
    return clamp(
        viewport.width * (textLength <= 2 ? 0.05 : textLength <= 5 ? 0.044 : 0.038) * lyricsFontScale,
        24 * lyricsFontScale,
        56 * lyricsFontScale
    );
};

const measureTextBox = (
    measureContext: CanvasRenderingContext2D,
    text: string,
    fontPx: number,
    theme: Theme
) => {
    measureContext.font = `800 ${Math.round(fontPx)}px ${resolveThemeFontStack(theme)}`;
    const width = Math.max(measureContext.measureText(text).width, fontPx * 0.72);
    return {
        width,
        height: fontPx * 1.06,
    };
};

const buildOvertureWorld = ({
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
}): OvertureWorld => {
    if (viewport.width <= 0 || viewport.height <= 0 || !lines.length) {
        return {
            blocks: [],
            nodes: [],
            worldWidth: viewport.width,
            worldHeight: viewport.height,
        };
    }

    const measureContext = createMeasureContext();
    if (!measureContext) {
        return {
            blocks: [],
            nodes: [],
            worldWidth: viewport.width,
            worldHeight: viewport.height,
        };
    }

    const filtered = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => line.fullText.trim().length > 0);
    const blocks: OvertureBlock[] = [];
    const nodes: OvertureRhythmNode[] = [];
    const worldHeight = Math.max(viewport.height * 1.55, 760);
    let cursorX = Math.max(viewport.width * 0.26, 220);

    filtered.forEach(({ line, index }) => {
        const rhythmUnits = buildRhythmUnits(line);
        if (!rhythmUnits.length) {
            return;
        }

        const blockSeed = `${seed ?? 'overture'}:${index}:${line.fullText}`;
        const avgDuration = Math.max((line.endTime - line.startTime) / rhythmUnits.length, 0.04);
        const groundY = viewport.height * 0.76;
        const baseY = viewport.height * 0.46;
        const baseSpacing = clamp(viewport.width * 0.06, 64, 110);
        const densityBoost = clamp((0.34 - avgDuration) * 180, 0, 42);
        const minSpacing = baseSpacing + densityBoost;
        const titleText = line.fullText.trim();
        const translationText = normalizeUnitText(line.translation ?? '');
        const titleGeometry: OvertureGeometryPiece[] = [];
        const translationGeometry: OvertureGeometryPiece[] = [];
        const currentLineChannel: OvertureGeometryPiece[] = [];
        const platforms: OvertureGeometryPiece[] = [];
        const hazards: OvertureGeometryPiece[] = [];
        const blockNodes: OvertureRhythmNode[] = [];
        let lastNodeX = cursorX;
        let blockStartX = cursorX;

        rhythmUnits.forEach((unit, unitIndex) => {
            const fontPx = getUnitFontSize(unit.text, viewport, lyricsFontScale);
            const textBox = measureTextBox(measureContext, unit.text, fontPx, theme);
            const zigzagAmplitude = mix(34, 86, hashToUnit(`${blockSeed}:zigzag-a`));
            const wave = Math.sin(unitIndex * 1.02 + hashToUnit(`${blockSeed}:wave`)) * mix(6, 18, hashToUnit(`${blockSeed}:wave-span`));
            const zigzag = ((unitIndex % 2 === 0 ? -1 : 1) * zigzagAmplitude);
            const stair = ((unitIndex % 5) - 2) * mix(6, 20, hashToUnit(`${blockSeed}:stair`));
            const x = unitIndex === 0
                ? cursorX
                : lastNodeX + Math.max(minSpacing, textBox.width * (unit.kind === 'word' ? 1.05 : 0.86));
            const y = baseY + zigzag + wave + stair;
            const prevX = unitIndex === 0 ? x - minSpacing * 0.6 : blockNodes[unitIndex - 1]!.x;
            const prevY = unitIndex === 0 ? y : blockNodes[unitIndex - 1]!.y;
            const nextPreviewY = baseY
                + (((unitIndex + 1) % 2 === 0 ? -1 : 1) * zigzagAmplitude)
                + Math.sin((unitIndex + 1) * 1.02 + hashToUnit(`${blockSeed}:wave`)) * mix(6, 18, hashToUnit(`${blockSeed}:wave-span`))
                + ((((unitIndex + 1) % 5) - 2) * mix(6, 20, hashToUnit(`${blockSeed}:stair`)));
            const exitAngle = Math.atan2(nextPreviewY - y, minSpacing);
            const node: OvertureRhythmNode = {
                id: `overture-node-${index}-${unitIndex}`,
                blockIndex: index,
                text: unit.text,
                startTime: unit.startTime,
                endTime: Math.max(unit.endTime, unit.startTime + 0.04),
                x,
                y,
                width: textBox.width,
                height: textBox.height,
                entryTangent: Math.atan2(y - prevY, Math.max(x - prevX, 1)),
                exitTangent: exitAngle,
                kind: unit.kind,
            };

            blockNodes.push(node);
            nodes.push(node);
            lastNodeX = x;

            currentLineChannel.push({
                id: `channel-${node.id}`,
                kind: 'bridge',
                x: x - textBox.width * 0.66,
                y: y - textBox.height * 0.7,
                width: textBox.width * 1.32,
                height: textBox.height * 1.4,
                text: unit.text,
            });

            platforms.push({
                id: `platform-${node.id}`,
                kind: 'platform',
                x: x - textBox.width * 0.4,
                y: y + textBox.height * 0.86,
                width: textBox.width * 0.8,
                height: 4,
            });
        });

        const blockEndX = lastNodeX + Math.max(viewport.width * 0.18, 180);
        const titleFont = clamp(viewport.width * 0.052 * lyricsFontScale, 34, 64);
        const titleBox = measureTextBox(measureContext, titleText, titleFont, theme);
        titleGeometry.push({
            id: `title-${index}`,
            kind: 'title',
            x: blockStartX + mix(40, 180, hashToUnit(`${blockSeed}:title-x`)),
            y: mix(40, viewport.height * 0.24, hashToUnit(`${blockSeed}:title-y`)),
            width: titleBox.width,
            height: titleBox.height,
            text: titleText,
        });

        if (translationText) {
            const translationFont = clamp(viewport.width * 0.024 * lyricsFontScale, 18, 28);
            const translationBox = measureTextBox(measureContext, translationText, translationFont, theme);
            translationGeometry.push({
                id: `translation-${index}`,
                kind: 'translation',
                x: blockStartX + mix(120, 320, hashToUnit(`${blockSeed}:translation-x`)),
                y: mix(viewport.height * 0.66, viewport.height * 0.88, hashToUnit(`${blockSeed}:translation-y`)),
                width: translationBox.width,
                height: translationBox.height,
                text: translationText,
            });
        }

        blocks.push({
            id: `overture-block-${index}`,
            index,
            line,
            startX: blockStartX,
            endX: blockEndX,
            groundY,
            titleGeometry,
            currentLineChannel,
            translationGeometry,
            platforms,
            hazards,
            rhythmNodes: blockNodes,
        });

        cursorX = blockEndX + Math.max(viewport.width * 0.08, 90);
    });

    return {
        blocks,
        nodes,
        worldWidth: Math.max(cursorX + viewport.width * 0.2, viewport.width * 1.25),
        worldHeight,
    };
};

const getFocusSnapshot = (nodes: OvertureRhythmNode[], currentTimeValue: number, staticMode: boolean): FocusSnapshot | null => {
    if (!nodes.length) {
        return null;
    }

    if (currentTimeValue <= nodes[0]!.startTime) {
        return {
            nodeIndex: 0,
            positionX: nodes[0]!.x,
            positionY: nodes[0]!.y,
            angle: nodes[0]!.exitTangent,
            progress: nodes[0]!.startTime,
        };
    }

    for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]!;
        const nextNode = nodes[index + 1] ?? null;
        const isSameBlockAsNext = Boolean(nextNode && nextNode.blockIndex === node.blockIndex);

        if (isSameBlockAsNext && nextNode && currentTimeValue < nextNode.startTime) {
            const segmentProgress = clamp(
                (currentTimeValue - node.startTime) / Math.max(nextNode.startTime - node.startTime, 0.0001),
                0,
                1
            );
            const eased = staticMode ? 0 : easeInOutCubic(segmentProgress);
            return {
                nodeIndex: index,
                positionX: mix(node.x, nextNode.x, eased),
                positionY: mix(node.y, nextNode.y, eased),
                angle: Math.atan2(nextNode.y - node.y, nextNode.x - node.x),
                progress: currentTimeValue,
            };
        }

        if (currentTimeValue <= node.endTime || !nextNode) {
            return {
                nodeIndex: index,
                positionX: node.x,
                positionY: node.y,
                angle: nextNode ? Math.atan2(nextNode.y - node.y, nextNode.x - node.x) : node.exitTangent,
                progress: currentTimeValue,
            };
        }

        if (nextNode && currentTimeValue < nextNode.startTime) {
            const bridgeProgress = clamp(
                (currentTimeValue - node.endTime) / Math.max(nextNode.startTime - node.endTime, 0.0001),
                0,
                1
            );
            const eased = staticMode ? 0 : easeInOutCubic(bridgeProgress);
            return {
                nodeIndex: index,
                positionX: mix(node.x, nextNode.x, eased),
                positionY: mix(node.y, nextNode.y, eased),
                angle: Math.atan2(nextNode.y - node.y, nextNode.x - node.x),
                progress: currentTimeValue,
            };
        }
    }

    const lastNode = nodes[nodes.length - 1]!;
    return {
        nodeIndex: nodes.length - 1,
        positionX: lastNode.x,
        positionY: lastNode.y,
        angle: lastNode.exitTangent,
        progress: currentTimeValue,
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
            align: 'left',
        },
    });
    label.alpha = alpha;
    return label;
};

const getVisiblePathNodes = (nodes: OvertureRhythmNode[], focusIndex: number) => {
    if (!nodes.length) {
        return [] as OvertureRhythmNode[];
    }

    const start = Math.max(0, focusIndex - 6);
    const end = Math.min(nodes.length, focusIndex + MAX_FORWARD_HINT_SEGMENTS + 3);
    return nodes.slice(start, end);
};

const destroySceneViews = (views: SceneViews) => {
    views.channelViews.forEach(view => {
        view.frame.destroy();
        view.text.destroy();
    });
    views.titleViews.forEach(view => {
        view.shape.destroy();
        view.text?.destroy();
    });
    views.translationViews.forEach(view => {
        view.shape.destroy();
        view.text?.destroy();
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
    const cameraRootRef = useRef<Container | null>(null);
    const worldRef = useRef<Container | null>(null);
    const backgroundGraphicsRef = useRef<Graphics | null>(null);
    const geometryGraphicsRef = useRef<Graphics | null>(null);
    const focusGraphicsRef = useRef<Graphics | null>(null);
    const titleLayerRef = useRef<Container | null>(null);
    const translationLayerRef = useRef<Container | null>(null);
    const channelLayerRef = useRef<Container | null>(null);
    const sceneViewsRef = useRef<SceneViews>({
        channelViews: [],
        titleViews: [],
        translationViews: [],
    });
    const currentTimeRef = useRef(currentTime);
    const audioPowerRef = useRef(audioPower);
    const audioBandsRef = useRef(audioBands);
    const showTextRef = useRef(showText);
    const worldLayoutRef = useRef<OvertureWorld>({
        blocks: [],
        nodes: [],
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
    const secondaryColor = useMemo(() => colorToNumber(theme.secondaryColor, primaryColor), [primaryColor, theme.secondaryColor]);
    const waitingColor = useMemo(() => mixColor(theme.secondaryColor, theme.backgroundColor, 0.28), [theme.backgroundColor, theme.secondaryColor]);
    const passedColor = useMemo(() => mixColor(theme.primaryColor, theme.accentColor, 0.26), [theme.accentColor, theme.primaryColor]);
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
        audioBandsRef.current = audioBands;
    }, [audioBands]);

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
        const backgroundGraphics = new Graphics();
        const geometryGraphics = new Graphics();
        const focusGraphics = new Graphics();
        const titleLayer = new Container();
        const translationLayer = new Container();
        const channelLayer = new Container();

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
            backgroundGraphics.zIndex = 2;
            geometryGraphics.zIndex = 6;
            titleLayer.zIndex = 10;
            translationLayer.zIndex = 12;
            channelLayer.zIndex = 16;
            focusGraphics.zIndex = 22;

            world.addChild(backgroundGraphics);
            world.addChild(geometryGraphics);
            world.addChild(titleLayer);
            world.addChild(translationLayer);
            world.addChild(channelLayer);
            world.addChild(focusGraphics);
            cameraRoot.addChild(world);
            app.stage.addChild(cameraRoot);

            appRef.current = app;
            cameraRootRef.current = cameraRoot;
            worldRef.current = world;
            backgroundGraphicsRef.current = backgroundGraphics;
            geometryGraphicsRef.current = geometryGraphics;
            focusGraphicsRef.current = focusGraphics;
            titleLayerRef.current = titleLayer;
            translationLayerRef.current = translationLayer;
            channelLayerRef.current = channelLayer;

            const resize = () => {
                const bounds = host.getBoundingClientRect();
                setViewport({ width: bounds.width, height: bounds.height });
            };

            resize();

            const observer = new ResizeObserver(resize);
            observer.observe(host);

            const tick = (ticker: { deltaMS: number }) => {
                const layout = worldLayoutRef.current;
                const cameraRootNode = cameraRootRef.current;
                const worldNode = worldRef.current;
                const focusNode = focusGraphicsRef.current;
                const backgroundNode = backgroundGraphicsRef.current;

                if (!cameraRootNode || !worldNode || !focusNode || !backgroundNode || !layout.nodes.length) {
                    return;
                }

                const currentTimeValue = currentTimeRef.current.get();
                const bass = clamp(audioBandsRef.current.bass.get(), 0, 1.4);
                const vocal = clamp(audioBandsRef.current.vocal.get(), 0, 1.4);
                const treble = clamp(audioBandsRef.current.treble.get(), 0, 1.4);
                const focus = getFocusSnapshot(layout.nodes, currentTimeValue, staticMode);
                if (!focus) {
                    return;
                }

                const dt = Math.min(ticker.deltaMS / 1000, 1 / 20);
                const targetScale = staticMode ? 1 : clamp(1.04 + treble * 0.02, 1, 1.1);
                const targetX = clamp(focus.positionX, viewport.width * 0.5, Math.max(layout.worldWidth - viewport.width * 0.5, viewport.width * 0.5));
                const targetY = clamp(focus.positionY, viewport.height * 0.5, layout.worldHeight - viewport.height * 0.5);

                if (staticMode) {
                    cameraRef.current.x = targetX;
                    cameraRef.current.y = targetY;
                    cameraRef.current.scale = 1;
                    cameraRef.current.velocityX = 0;
                    cameraRef.current.velocityY = 0;
                    cameraRef.current.velocityScale = 0;
                } else {
                    const accelX = (targetX - cameraRef.current.x) * 34 - cameraRef.current.velocityX * 9.4;
                    const accelY = (targetY - cameraRef.current.y) * 28 - cameraRef.current.velocityY * 8.2;
                    const accelScale = (targetScale - cameraRef.current.scale) * 18 - cameraRef.current.velocityScale * 8;

                    cameraRef.current.velocityX += accelX * dt;
                    cameraRef.current.velocityY += accelY * dt;
                    cameraRef.current.velocityScale += accelScale * dt;
                    cameraRef.current.x += cameraRef.current.velocityX * dt;
                    cameraRef.current.y += cameraRef.current.velocityY * dt;
                    cameraRef.current.scale = clamp(cameraRef.current.scale + cameraRef.current.velocityScale * dt, 0.94, 1.12);
                }

                cameraRootNode.position.set(viewport.width * 0.5, viewport.height * 0.5);
                worldNode.scale.set(cameraRef.current.scale);
                worldNode.position.set(
                    -cameraRef.current.x * cameraRef.current.scale,
                    -cameraRef.current.y * cameraRef.current.scale
                );

                backgroundNode.clear();
                const backgroundPulse = staticMode ? 0.08 : 0.08 + bass * 0.05;
                layout.blocks.forEach((block, blockIndex) => {
                    const blockSeed = `${seed ?? 'overture'}:bg:${blockIndex}`;
                    const rectAngleA = mix(-0.48, 0.48, hashToUnit(`${blockSeed}:rect-a-angle`));
                    const rectAngleB = mix(-0.62, 0.62, hashToUnit(`${blockSeed}:rect-b-angle`));
                    drawRotatedRect(
                        backgroundNode,
                        block.startX + mix(160, 320, hashToUnit(`${blockSeed}:rect-a-x`)),
                        mix(140, 260, hashToUnit(`${blockSeed}:rect-a-y`)),
                        mix(180, 360, hashToUnit(`${blockSeed}:rect-a-w`)),
                        mix(140, 260, hashToUnit(`${blockSeed}:rect-a-h`)),
                        rectAngleA,
                        secondaryColor,
                        backgroundPulse * 0.36,
                        8
                    );
                    drawRotatedRect(
                        backgroundNode,
                        block.endX - mix(100, 260, hashToUnit(`${blockSeed}:rect-b-x`)),
                        mix(layout.worldHeight * 0.68, layout.worldHeight * 0.84, hashToUnit(`${blockSeed}:rect-b-y`)),
                        mix(160, 300, hashToUnit(`${blockSeed}:rect-b-w`)),
                        mix(120, 220, hashToUnit(`${blockSeed}:rect-b-h`)),
                        rectAngleB,
                        secondaryColor,
                        backgroundPulse * 0.28,
                        8
                    );

                    backgroundNode
                        .circle(
                            block.startX - mix(100, 180, hashToUnit(`${blockSeed}:circle-x`)),
                            mix(layout.worldHeight * 0.28, layout.worldHeight * 0.6, hashToUnit(`${blockSeed}:circle-y`)),
                            mix(90, 220, hashToUnit(`${blockSeed}:circle-r`))
                        )
                        .stroke({
                            color: secondaryColor,
                            width: 8,
                            alpha: backgroundPulse * 0.28,
                        });

                    drawTriangle(
                        backgroundNode,
                        block.startX + mix(220, 420, hashToUnit(`${blockSeed}:tri-x`)),
                        mix(layout.worldHeight * 0.32, layout.worldHeight * 0.58, hashToUnit(`${blockSeed}:tri-y`)),
                        mix(48, 94, hashToUnit(`${blockSeed}:tri-s`)),
                        mix(-0.8, 0.8, hashToUnit(`${blockSeed}:tri-a`)),
                        secondaryColor,
                        backgroundPulse * 0.42,
                        10
                    );
                });

                sceneViewsRef.current.channelViews.forEach((view, index) => {
                    const node = view.node;
                    const nextNode = layout.nodes[index + 1] ?? null;
                    const state = (() => {
                        if (focus.nodeIndex > index) {
                            return 'passed' as const;
                        }

                        if (focus.nodeIndex === index) {
                            return 'active' as const;
                        }

                        return 'waiting' as const;
                    })();
                    const progressWithinNode = focus.nodeIndex === index
                        ? clamp(
                            (focus.progress - node.startTime) / Math.max(node.endTime - node.startTime, 0.0001),
                            0,
                            1
                        )
                        : state === 'passed'
                            ? 1
                            : 0;
                    const activeGlow = staticMode ? (state === 'active' ? 1 : 0) : progressWithinNode;
                    const fillColor = state === 'passed'
                        ? mixColor(theme.primaryColor, theme.accentColor, 0.2)
                        : state === 'active'
                            ? mixColor(theme.secondaryColor, theme.accentColor, 0.2 + activeGlow * 0.8)
                            : waitingColor;
                    const frameColor = state === 'passed'
                        ? passedColor
                        : state === 'active'
                            ? accentColor
                            : secondaryColor;
                    view.frame.clear();

                    view.text.x = node.x + Math.cos(node.exitTangent + Math.PI * 0.5) * (state === 'active' ? -2 : 0);
                    view.text.y = node.y + Math.sin(node.exitTangent + Math.PI * 0.5) * (state === 'active' ? -2 : 0);
                    view.text.anchor.set(0.5);
                    view.text.tint = state === 'active'
                        ? accentColor
                        : state === 'passed'
                            ? primaryColor
                            : secondaryColor;
                    view.text.alpha = showTextRef.current
                        ? (state === 'waiting' ? 0.34 : state === 'passed' ? 0.66 : 1)
                        : 0.18;
                    view.text.scale.set(
                        state === 'active'
                            ? 1.06 + activeGlow * 0.12 + vocal * 0.05
                            : state === 'passed'
                                ? 0.92
                                : 0.82
                    );
                    view.text.rotation = node.exitTangent * 0.18;
                });

                sceneViewsRef.current.titleViews.forEach((view, index) => {
                    view.shape.alpha = 0;
                    if (view.text) {
                        view.text.alpha = showTextRef.current ? (0.16 + (index % 2 === 0 ? 0.04 : 0)) : 0.05;
                        view.text.rotation = mix(-0.72, 0.72, hashToUnit(`${seed ?? 'overture'}:title-rot:${index}`));
                    }
                });

                sceneViewsRef.current.translationViews.forEach((view, index) => {
                    view.shape.alpha = 0;
                    if (view.text) {
                        view.text.alpha = showTextRef.current ? 0.22 : 0.08;
                        view.text.rotation = mix(-0.16, 0.16, hashToUnit(`${seed ?? 'overture'}:translation-rot:${index}`));
                    }
                });

                focusNode.clear();
                const currentNode = layout.nodes[focus.nodeIndex]!;
                const pathNodes = getVisiblePathNodes(layout.nodes, focus.nodeIndex);
                const activePathColor = colorToNumber(theme.accentColor, 0xd9742b);
                const passedPathColor = colorToNumber(theme.primaryColor, 0x7d848f);
                const futurePathColor = colorToNumber(theme.secondaryColor, 0xc0c4ca);

                for (let index = 0; index < pathNodes.length - 1; index += 1) {
                    const from = pathNodes[index]!;
                    const to = pathNodes[index + 1]!;
                    const absoluteIndex = Math.max(0, focus.nodeIndex - 6) + index;
                    const isCurrentSegment = absoluteIndex === focus.nodeIndex;
                    const isPastSegment = absoluteIndex < focus.nodeIndex;

                    focusNode
                        .moveTo(from.x, from.y)
                        .lineTo(to.x, to.y)
                        .stroke({
                            color: isCurrentSegment ? activePathColor : (isPastSegment ? passedPathColor : futurePathColor),
                            width: isCurrentSegment ? 8 : (isPastSegment ? 5 : 4),
                            alpha: isCurrentSegment ? 0.92 : (isPastSegment ? 0.28 : 0.16),
                            cap: 'round',
                            join: 'round',
                        });
                }

                const arrowLength = 28;
                const arrowWidth = 16;
                const tipX = focus.positionX + Math.cos(focus.angle) * arrowLength;
                const tipY = focus.positionY + Math.sin(focus.angle) * arrowLength;
                const leftX = focus.positionX + Math.cos(focus.angle + Math.PI * 0.78) * arrowWidth;
                const leftY = focus.positionY + Math.sin(focus.angle + Math.PI * 0.78) * arrowWidth;
                const rightX = focus.positionX + Math.cos(focus.angle - Math.PI * 0.78) * arrowWidth;
                const rightY = focus.positionY + Math.sin(focus.angle - Math.PI * 0.78) * arrowWidth;
                focusNode
                    .moveTo(tipX, tipY)
                    .lineTo(leftX, leftY)
                    .lineTo(rightX, rightY)
                    .closePath()
                    .fill({
                        color: 0x05070c,
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
                channelViews: [],
                titleViews: [],
                translationViews: [],
            };
            appRef.current?.destroy({ removeView: true }, true);
            appRef.current = null;
            cameraRootRef.current = null;
            worldRef.current = null;
            backgroundGraphicsRef.current = null;
            geometryGraphicsRef.current = null;
            focusGraphicsRef.current = null;
            titleLayerRef.current = null;
            translationLayerRef.current = null;
            channelLayerRef.current = null;
            setPixiReady(false);
        };
    }, [accentColor, primaryColor, secondaryColor, staticMode, theme]);

    const worldLayout = useMemo(() => buildOvertureWorld({
        lines,
        viewport,
        theme,
        lyricsFontScale,
        seed,
    }), [lines, lyricsFontScale, seed, theme, viewport]);

    useEffect(() => {
        worldLayoutRef.current = worldLayout;

        const geometryGraphics = geometryGraphicsRef.current;
        const titleLayer = titleLayerRef.current;
        const translationLayer = translationLayerRef.current;
        const channelLayer = channelLayerRef.current;

        if (!geometryGraphics || !titleLayer || !translationLayer || !channelLayer) {
            return;
        }

        destroySceneViews(sceneViewsRef.current);
        sceneViewsRef.current = {
            channelViews: [],
            titleViews: [],
            translationViews: [],
        };

        titleLayer.removeChildren();
        translationLayer.removeChildren();
        channelLayer.removeChildren();
        geometryGraphics.clear();

        worldLayout.blocks.forEach(block => {
            block.titleGeometry.forEach(piece => {
                const shape = new Graphics();
                titleLayer.addChild(shape);

                const fontPx = clamp(piece.height * 0.96, 28, 68);
                const label = createLabelText(piece.text ?? '', fontPx, secondaryColor, 0.12, theme);
                label.x = piece.x;
                label.y = piece.y;
                titleLayer.addChild(label);

                sceneViewsRef.current.titleViews.push({
                    shape,
                    text: label,
                });
            });

            block.translationGeometry.forEach(piece => {
                const shape = new Graphics();
                translationLayer.addChild(shape);

                const fontPx = clamp(piece.height * 0.92, 18, 30);
                const label = createLabelText(piece.text ?? '', fontPx, secondaryColor, 0.56, theme);
                label.x = piece.x;
                label.y = piece.y;
                translationLayer.addChild(label);

                sceneViewsRef.current.translationViews.push({
                    shape,
                    text: label,
                });
            });

            block.rhythmNodes.forEach(node => {
                const frame = new Graphics();
                channelLayer.addChild(frame);

                const fontPx = clamp(node.height / 1.06, 18, 58);
                const label = createLabelText(node.text, fontPx, secondaryColor, showText ? 0.88 : 0.18, theme);
                label.anchor.set(0.5);
                label.x = node.x;
                label.y = node.y;
                channelLayer.addChild(label);

                sceneViewsRef.current.channelViews.push({
                    node,
                    frame,
                    text: label,
                });
            });
        });

        if (!worldLayout.nodes.length) {
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

        const initialFocus = getFocusSnapshot(worldLayout.nodes, currentTime.get(), staticMode);
        cameraRef.current = {
            x: initialFocus?.positionX ?? worldLayout.nodes[0]!.x,
            y: initialFocus?.positionY ?? worldLayout.nodes[0]!.y,
            scale: 1,
            velocityX: 0,
            velocityY: 0,
            velocityScale: 0,
        };
    }, [
        accentColor,
        currentTime,
        passedColor,
        primaryColor,
        secondaryColor,
        showText,
        staticMode,
        theme,
        waitingColor,
        worldLayout,
    ]);

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
