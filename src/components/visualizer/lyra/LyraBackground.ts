import { Theme } from '../../types';

interface ViewportSize {
    width: number;
    height: number;
}

interface WorldSize {
    width: number;
    height: number;
}

interface LyraBackgroundBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

type LyraBackgroundShapeKind = 'ring';
type LyraBackgroundAudioBand = 'bass' | 'lowMid' | 'mid' | 'vocal' | 'treble';
type LyraBackgroundShapeColor = 'secondary' | 'accent';

interface LyraBackgroundPoint {
    x: number;
    y: number;
}

interface LyraBackgroundShape {
    id: string;
    kind: LyraBackgroundShapeKind;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    rotationSpeed: number;
    strokeWidth: number;
    opacity: number;
    color: LyraBackgroundShapeColor;
    depth: number;
    dash?: [number, number];
    ringGapStart?: number;
    ringGapSize?: number;
    highlightStart?: number;
    highlightSpan?: number;
}

interface LyraBackgroundSpark {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    rotationSpeed: number;
    opacity: number;
    depth: number;
    colorMix: number;
    highlightMix: number;
    audioBand?: LyraBackgroundAudioBand;
}

interface LyraBackgroundAmbientDot {
    id: string;
    x: number;
    y: number;
    radius: number;
    opacity: number;
    depth: number;
    colorMix: number;
    highlightMix: number;
}

interface FumeAttachedSpark extends LyraBackgroundSpark {
    parentShapeId: string;
    offsetPhase: number;
    pulsePhase: number;
    pulseSpeed: number;
}

export interface LyraBackgroundScene {
    width: number;
    height: number;
    shapes: LyraBackgroundShape[];
    sparks: LyraBackgroundSpark[];
    attachedSparks: FumeAttachedSpark[];
    ambientDots: LyraBackgroundAmbientDot[];
}

export type LyraBackgroundAudioLevels = Partial<Record<LyraBackgroundAudioBand, number>> & {
    power?: number;
};

interface LyraBackgroundParallax {
    cameraX: number;
    cameraY: number;
    originX: number;
    originY: number;
    strength?: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const TAU = Math.PI * 2;

const hashString = (input: string) => {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const seeded = (seed: string) => {
    const hash = hashString(seed);
    return (hash % 10000) / 10000;
};

const colorWithAlpha = (color: string, alpha: number) => {
    const normalizedAlpha = clamp(alpha, 0, 1);

    if (color.startsWith('#')) {
        const hex = color.slice(1);
        const parse = (value: string) => Number.parseInt(value, 16);

        if (hex.length === 3) {
            const r = parse(hex[0] + hex[0]);
            const g = parse(hex[1] + hex[1]);
            const b = parse(hex[2] + hex[2]);
            return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
        }

        if (hex.length === 6) {
            const r = parse(hex.slice(0, 2));
            const g = parse(hex.slice(2, 4));
            const b = parse(hex.slice(4, 6));
            return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
        }
    }

    const rgbMatch = color.match(/^rgba?\(([^)]+)\)$/);
    if (rgbMatch) {
        const channels = rgbMatch[1].split(',').slice(0, 3).map(part => part.trim());
        return `rgba(${channels.join(', ')}, ${normalizedAlpha})`;
    }

    return color;
};

const parseColorChannels = (color: string) => {
    if (color.startsWith('#')) {
        const hex = color.slice(1);
        const parse = (value: string) => Number.parseInt(value, 16);

        if (hex.length === 3) {
            return {
                r: parse(hex[0] + hex[0]),
                g: parse(hex[1] + hex[1]),
                b: parse(hex[2] + hex[2]),
            };
        }

        if (hex.length === 6) {
            return {
                r: parse(hex.slice(0, 2)),
                g: parse(hex.slice(2, 4)),
                b: parse(hex.slice(4, 6)),
            };
        }
    }

    const rgbMatch = color.match(/^rgba?\(([^)]+)\)$/);
    if (rgbMatch) {
        const [r = '255', g = '255', b = '255'] = rgbMatch[1].split(',').slice(0, 3).map(part => part.trim());
        return {
            r: Number.parseFloat(r),
            g: Number.parseFloat(g),
            b: Number.parseFloat(b),
        };
    }

    return null;
};

const mixColors = (from: string, to: string, amount: number, alpha = 1) => {
    const normalizedAmount = clamp(amount, 0, 1);
    const fromChannels = parseColorChannels(from);
    const toChannels = parseColorChannels(to);

    if (!fromChannels || !toChannels) {
        return colorWithAlpha(normalizedAmount >= 0.5 ? to : from, alpha);
    }

    return `rgba(${Math.round(mix(fromChannels.r, toChannels.r, normalizedAmount))}, ${Math.round(mix(fromChannels.g, toChannels.g, normalizedAmount))}, ${Math.round(mix(fromChannels.b, toChannels.b, normalizedAmount))}, ${clamp(alpha, 0, 1)})`;
};

const normalizeBounds = (
    bounds: LyraBackgroundBounds,
    worldWidth: number,
    worldHeight: number,
): LyraBackgroundBounds => ({
    left: clamp(Math.min(bounds.left, bounds.right), 0, worldWidth),
    top: clamp(Math.min(bounds.top, bounds.bottom), 0, worldHeight),
    right: clamp(Math.max(bounds.left, bounds.right), 0, worldWidth),
    bottom: clamp(Math.max(bounds.top, bounds.bottom), 0, worldHeight),
});

const choosePaperHaloAnchor = ({
    paperBounds,
    worldWidth,
    worldHeight,
    width,
    height,
    seedKey,
}: {
    paperBounds: LyraBackgroundBounds;
    worldWidth: number;
    worldHeight: number;
    width: number;
    height: number;
    seedKey: string;
}) => {
    const side = Math.floor(seeded(`${seedKey}:side`) * 4) % 4;
    const overflowX = width * mix(0.12, 0.24, seeded(`${seedKey}:overflow-x`));
    const overflowY = height * mix(0.12, 0.24, seeded(`${seedKey}:overflow-y`));
    const spanJitterX = width * mix(-0.16, 0.16, seeded(`${seedKey}:span-jitter-x`));
    const spanJitterY = height * mix(-0.16, 0.16, seeded(`${seedKey}:span-jitter-y`));

    if (seeded(`${seedKey}:inside`) < 0.18) {
        return {
            x: clamp(
                mix(paperBounds.left, paperBounds.right, seeded(`${seedKey}:inside-x`)) + spanJitterX,
                0,
                worldWidth,
            ),
            y: clamp(
                mix(paperBounds.top, paperBounds.bottom, seeded(`${seedKey}:inside-y`)) + spanJitterY,
                0,
                worldHeight,
            ),
        };
    }

    if (side === 0) {
        return {
            x: clamp(paperBounds.left - overflowX, 0, worldWidth),
            y: clamp(mix(paperBounds.top, paperBounds.bottom, seeded(`${seedKey}:y`)) + spanJitterY, 0, worldHeight),
        };
    }

    if (side === 1) {
        return {
            x: clamp(paperBounds.right + overflowX, 0, worldWidth),
            y: clamp(mix(paperBounds.top, paperBounds.bottom, seeded(`${seedKey}:y`)) + spanJitterY, 0, worldHeight),
        };
    }

    if (side === 2) {
        return {
            x: clamp(mix(paperBounds.left, paperBounds.right, seeded(`${seedKey}:x`)) + spanJitterX, 0, worldWidth),
            y: clamp(paperBounds.top - overflowY, 0, worldHeight),
        };
    }

    return {
        x: clamp(mix(paperBounds.left, paperBounds.right, seeded(`${seedKey}:x`)) + spanJitterX, 0, worldWidth),
        y: clamp(paperBounds.bottom + overflowY, 0, worldHeight),
    };
};

const buildShapePath = (
    context: CanvasRenderingContext2D,
    shape: LyraBackgroundShape,
) => {
    context.beginPath();
    context.setLineDash(shape.dash ?? []);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    if (shape.kind === 'ring') {
        const gapStart = shape.ringGapStart ?? 0;
        const gapSize = clamp(shape.ringGapSize ?? 0, 0, Math.PI * 0.28);
        context.ellipse(
            0,
            0,
            shape.width * 0.5,
            shape.height * 0.5,
            0,
            gapStart + gapSize,
            gapStart + TAU,
        );
        return;
    }

};

// Approximate path sample points so attached sparks and local highlight can stick to real geometry.
const sampleShapePoint = (
    shape: LyraBackgroundShape,
    progress: number,
): LyraBackgroundPoint => {
    const t = ((progress % 1) + 1) % 1;

    if (shape.kind === 'ring') {
        const gapStart = shape.ringGapStart ?? 0;
        const gapSize = clamp(shape.ringGapSize ?? 0, 0, Math.PI * 0.28);
        const startAngle = gapStart + gapSize;
        const angle = startAngle + t * (TAU - gapSize);
        return {
            x: Math.cos(angle) * shape.width * 0.5,
            y: Math.sin(angle) * shape.height * 0.5,
        };
    }

    const angle = t * TAU;
    return {
        x: Math.cos(angle) * shape.width * 0.5,
        y: Math.sin(angle) * shape.height * 0.5,
    };
};

const rotatePoint = (point: LyraBackgroundPoint, angle: number) => ({
    x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
});

const resolveShapeWorldPoint = (
    shape: LyraBackgroundShape,
    progress: number,
    parallaxOffsetX = 0,
    parallaxOffsetY = 0,
    time = 0,
) => {
    const rotation = shape.rotation + time * shape.rotationSpeed;
    const local = rotatePoint(sampleShapePoint(shape, progress), rotation);
    return {
        x: shape.x + parallaxOffsetX + local.x,
        y: shape.y + parallaxOffsetY + local.y,
    };
};

const createLineGradient = (
    context: CanvasRenderingContext2D,
    shape: LyraBackgroundShape,
    theme: Theme,
    opacity: number,
) => {
    const secondary = theme.secondaryColor;
    const accent = theme.accentColor;
    const gradient = context.createLinearGradient(-shape.width * 0.55, -shape.height * 0.28, shape.width * 0.55, shape.height * 0.28);
    gradient.addColorStop(0, colorWithAlpha(secondary, opacity * 0.18));
    gradient.addColorStop(0.28, colorWithAlpha(mixColors(secondary, accent, 0.24), opacity * 0.58));
    gradient.addColorStop(0.54, colorWithAlpha(mixColors(secondary, accent, 0.62), opacity * 0.92));
    gradient.addColorStop(1, colorWithAlpha(accent, opacity * 0.7));
    return gradient;
};

const createSparkColor = (
    theme: Theme,
    colorMix: number,
    highlightMix: number,
    alpha: number,
) => {
    const mixed = mixColors(theme.secondaryColor, theme.accentColor, colorMix);
    const highlighted = mixColors(mixed, '#fffafc', highlightMix);
    return colorWithAlpha(highlighted, alpha);
};

const drawShapeStrokeLayers = ({
    context,
    shape,
    theme,
    opacity,
    highlightBoost,
}: {
    context: CanvasRenderingContext2D;
    shape: LyraBackgroundShape;
    theme: Theme;
    opacity: number;
    highlightBoost: number;
}) => {
    const baseGradient = createLineGradient(context, shape, theme, opacity);
    const baseWidth = Math.max(shape.strokeWidth * 0.22, 0.12);
    const midWidth = Math.max(shape.strokeWidth * 0.58, 0.38);
    const topWidth = Math.max(shape.strokeWidth * 1.04, 0.82);

    buildShapePath(context, shape);
    context.strokeStyle = createLineGradient(context, shape, theme, opacity * 0.42);
    context.lineWidth = baseWidth;
    context.shadowBlur = 0;
    context.stroke();

    buildShapePath(context, shape);
    context.strokeStyle = createLineGradient(context, shape, theme, opacity * 0.82);
    context.lineWidth = midWidth;
    context.shadowBlur = 4 + shape.strokeWidth * 1.4 + highlightBoost * 10;
    context.shadowColor = colorWithAlpha(mixColors(theme.secondaryColor, theme.accentColor, 0.58), opacity * (0.18 + highlightBoost * 0.22));
    context.stroke();

    buildShapePath(context, shape);
    context.strokeStyle = baseGradient;
    context.lineWidth = topWidth + highlightBoost * shape.strokeWidth * 0.22;
    context.shadowBlur = 8 + shape.strokeWidth * 2.8 + highlightBoost * 18;
    context.shadowColor = colorWithAlpha(
        mixColors(theme.secondaryColor, theme.accentColor, 0.7),
        opacity * (0.16 + highlightBoost * 0.32),
    );
    context.stroke();
};

const buildEightPointSparkPath = (
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
) => {
    const size = Math.min(width, height);
    const outer = size * 0.5;
    const inner = size * 0.13;

    context.beginPath();
    context.moveTo(0, -outer);
    context.lineTo(inner, -inner);
    context.lineTo(outer, 0);
    context.lineTo(inner, inner);
    context.lineTo(0, outer);
    context.lineTo(-inner, inner);
    context.lineTo(-outer, 0);
    context.lineTo(-inner, -inner);
    context.closePath();
};

const drawFreeSpark = ({
    context,
    spark,
    theme,
    alpha,
    glowBoost,
}: {
    context: CanvasRenderingContext2D;
    spark: LyraBackgroundSpark;
    theme: Theme;
    alpha: number;
    glowBoost: number;
}) => {
    const outerRadius = Math.max(spark.width * (1.2 + glowBoost * 0.4), 1.6);
    const halo = context.createRadialGradient(0, 0, 0, 0, 0, outerRadius);
    halo.addColorStop(0, createSparkColor(theme, spark.colorMix, 0.9, alpha * (0.8 + glowBoost * 0.2)));
    halo.addColorStop(0.26, createSparkColor(theme, spark.colorMix, spark.highlightMix, alpha * (0.46 + glowBoost * 0.16)));
    halo.addColorStop(0.68, createSparkColor(theme, spark.colorMix, 0.12, alpha * 0.14));
    halo.addColorStop(1, colorWithAlpha(theme.accentColor, 0));
    context.fillStyle = halo;
    context.beginPath();
    context.arc(0, 0, outerRadius, 0, TAU);
    context.fill();

    context.rotate(spark.rotation);
    context.strokeStyle = createSparkColor(theme, spark.colorMix, 0.96, alpha);
    context.lineWidth = spark.strokeWidth;
    context.shadowBlur = 8 + outerRadius * (1.2 + glowBoost);
    context.shadowColor = createSparkColor(theme, spark.colorMix, 0.82, alpha * 0.8);
    buildEightPointSparkPath(context, spark.width, spark.height);
    context.stroke();
};

const drawAttachedSpark = ({
    context,
    spark,
    theme,
    alpha,
    glowBoost,
}: {
    context: CanvasRenderingContext2D;
    spark: LyraBackgroundSpark;
    theme: Theme;
    alpha: number;
    glowBoost: number;
}) => {
    const outerRadius = Math.max(spark.width * (1.4 + glowBoost * 0.26), 1.5);
    const halo = context.createRadialGradient(0, 0, 0, 0, 0, outerRadius * 1.9);
    halo.addColorStop(0, createSparkColor(theme, spark.colorMix, 0.96, alpha * (0.82 + glowBoost * 0.18)));
    halo.addColorStop(0.3, createSparkColor(theme, spark.colorMix, spark.highlightMix, alpha * 0.34));
    halo.addColorStop(1, colorWithAlpha(theme.accentColor, 0));
    context.fillStyle = halo;
    context.beginPath();
    context.arc(0, 0, outerRadius * 1.9, 0, TAU);
    context.fill();

    context.rotate(spark.rotation);
    context.strokeStyle = createSparkColor(theme, spark.colorMix, 1, alpha);
    context.lineWidth = Math.max(spark.width * 0.085, 0.44);
    context.shadowBlur = 6 + outerRadius * (1 + glowBoost * 0.8);
    context.shadowColor = createSparkColor(theme, spark.colorMix, 0.86, alpha * 0.72);
    buildEightPointSparkPath(context, spark.width, spark.height);
    context.stroke();
};

const drawAmbientDot = ({
    context,
    dot,
    theme,
    alpha,
}: {
    context: CanvasRenderingContext2D;
    dot: LyraBackgroundAmbientDot;
    theme: Theme;
    alpha: number;
}) => {
    const color = createSparkColor(theme, dot.colorMix, dot.highlightMix, alpha);
    context.fillStyle = colorWithAlpha(
        mixColors('#ffffff', mixColors(theme.secondaryColor, theme.accentColor, dot.colorMix), 0.18),
        alpha,
    );
    context.beginPath();
    context.arc(0, 0, dot.radius, 0, TAU);
    context.fill();
};

export const buildLyraBackgroundScene = ({
    viewport,
    world,
    paperBounds,
    seed,
}: {
    viewport: ViewportSize;
    world: WorldSize;
    paperBounds?: LyraBackgroundBounds;
    seed?: string | number;
}): LyraBackgroundScene => {
    if (viewport.width <= 0 || viewport.height <= 0 || world.width <= 0 || world.height <= 0) {
        return {
            width: Math.max(world.width, viewport.width, 1),
            height: Math.max(world.height, viewport.height, 1),
            shapes: [],
            sparks: [],
            attachedSparks: [],
            ambientDots: [],
        };
    }

    const worldWidth = Math.max(world.width, viewport.width * 1.2);
    const worldHeight = Math.max(world.height, viewport.height * 1.2);
    const baseUnit = clamp(Math.min(viewport.width, viewport.height) * 0.72, 320, 760);
    const defaultPaperBounds = {
        left: worldWidth * 0.24,
        top: worldHeight * 0.18,
        right: worldWidth * 0.76,
        bottom: worldHeight * 0.82,
    };
    const resolvedPaperBounds = normalizeBounds(paperBounds ?? defaultPaperBounds, worldWidth, worldHeight);

    const shapeCount = worldWidth > worldHeight ? 9 : 8;
    const shapes = Array.from({ length: shapeCount }).map((_, index) => {
        const localSeed = `${seed ?? 'lyra'}:${worldWidth}:${worldHeight}:shape:${index}`;
        const kind: LyraBackgroundShapeKind = 'ring';
        const width = baseUnit * mix(1.02, 2.58, seeded(`${localSeed}:size`));
        const height = width;
        const anchor = choosePaperHaloAnchor({
            paperBounds: resolvedPaperBounds,
            worldWidth,
            worldHeight,
            width,
            height,
            seedKey: localSeed,
        });

        return {
            id: `lyra-shape-${index}`,
            kind,
            x: anchor.x,
            y: anchor.y,
            width,
            height,
            rotation: mix(-Math.PI * 0.34, Math.PI * 0.34, seeded(`${localSeed}:rotation`)),
            rotationSpeed: mix(-0.016, 0.016, seeded(`${localSeed}:rotation-speed`)),
            strokeWidth: mix(0.9, 2.1, seeded(`${localSeed}:stroke-width`)),
            opacity: mix(0.22, 0.46, seeded(`${localSeed}:opacity`)),
            color: (seeded(`${localSeed}:color`) > 0.46 ? 'accent' : 'secondary') as LyraBackgroundShapeColor,
            depth: seeded(`${localSeed}:depth`),
            dash: seeded(`${localSeed}:dash`) > 0.88
                ? [mix(1.6, 3.2, seeded(`${localSeed}:dash-a`)), mix(8, 14, seeded(`${localSeed}:dash-b`))]
                : undefined,
            ringGapStart: seeded(`${localSeed}:gap`) > 0.82
                ? mix(-Math.PI, Math.PI, seeded(`${localSeed}:gap-start`))
                : undefined,
            ringGapSize: seeded(`${localSeed}:gap`) > 0.82
                ? mix(Math.PI * 0.04, Math.PI * 0.12, seeded(`${localSeed}:gap-size`))
                : 0,
            highlightStart: seeded(`${localSeed}:highlight-start`),
            highlightSpan: mix(0.12, 0.24, seeded(`${localSeed}:highlight-span`)),
        };
    });

    const sparkBands: LyraBackgroundAudioBand[] = ['treble', 'vocal', 'mid', 'treble', 'lowMid'];
    const sparkCount = worldWidth > worldHeight ? 22 : 16;
    const sparkAreaLeft = clamp(resolvedPaperBounds.left - baseUnit * 0.28, worldWidth * 0.04, worldWidth * 0.92);
    const sparkAreaRight = clamp(resolvedPaperBounds.right + baseUnit * 0.28, worldWidth * 0.08, worldWidth * 0.96);
    const sparkAreaTop = clamp(resolvedPaperBounds.top - baseUnit * 0.24, worldHeight * 0.04, worldHeight * 0.9);
    const sparkAreaBottom = clamp(resolvedPaperBounds.bottom + baseUnit * 0.24, worldHeight * 0.08, worldHeight * 0.96);
    const sparkAreaWidth = Math.max(sparkAreaRight - sparkAreaLeft, 1);
    const sparkAreaHeight = Math.max(sparkAreaBottom - sparkAreaTop, 1);
    const sparkColumns = worldWidth > worldHeight ? 6 : 4;
    const sparkRows = Math.ceil(sparkCount / sparkColumns);
    const sparkCellWidth = sparkAreaWidth / sparkColumns;
    const sparkCellHeight = sparkAreaHeight / sparkRows;
    const sparks = Array.from({ length: sparkCount }).map((_, index) => {
        const localSeed = `${seed ?? 'lyra'}:${worldWidth}:${worldHeight}:spark:${index}`;
        const width = baseUnit * mix(0.1, 0.24, seeded(`${localSeed}:size`));
        const column = index % sparkColumns;
        const row = Math.floor(index / sparkColumns);
        const jitterX = mix(-0.42, 0.42, seeded(`${localSeed}:jitter-x`)) * sparkCellWidth;
        const jitterY = mix(-0.42, 0.42, seeded(`${localSeed}:jitter-y`)) * sparkCellHeight;
        return {
            id: `lyra-spark-${index}`,
            x: clamp(sparkAreaLeft + (column + 0.5) * sparkCellWidth + jitterX, sparkAreaLeft, sparkAreaRight),
            y: clamp(sparkAreaTop + (row + 0.5) * sparkCellHeight + jitterY, sparkAreaTop, sparkAreaBottom),
            width,
            height: width,
            rotation: mix(-Math.PI, Math.PI, seeded(`${localSeed}:rotation`)),
            rotationSpeed: mix(-0.08, 0.08, seeded(`${localSeed}:rotation-speed`)),
            opacity: mix(0.22, 0.58, seeded(`${localSeed}:opacity`)),
            depth: seeded(`${localSeed}:depth`),
            colorMix: mix(0, 1, seeded(`${localSeed}:color-mix`)),
            highlightMix: mix(0.08, 0.96, seeded(`${localSeed}:highlight-mix`)),
            audioBand: sparkBands[index % sparkBands.length],
        };
    });

    const ambientDotCount = worldWidth > worldHeight ? 36 : 28;
    const ambientDots = Array.from({ length: ambientDotCount }).map((_, index) => {
        const localSeed = `${seed ?? 'lyra'}:${worldWidth}:${worldHeight}:ambient:${index}`;
        return {
            id: `lyra-ambient-${index}`,
            x: mix(worldWidth * 0.04, worldWidth * 0.96, seeded(`${localSeed}:x`)),
            y: mix(worldHeight * 0.04, worldHeight * 0.96, seeded(`${localSeed}:y`)),
            radius: baseUnit * mix(0.0024, 0.0064, seeded(`${localSeed}:radius`)),
            opacity: mix(0.16, 0.42, seeded(`${localSeed}:opacity`)),
            depth: seeded(`${localSeed}:depth`),
            colorMix: seeded(`${localSeed}:color-mix`),
            highlightMix: mix(0.12, 0.88, seeded(`${localSeed}:highlight-mix`)),
        };
    });

    const attachedSparks = shapes.flatMap((shape, shapeIndex) => {
        const localSeed = `${seed ?? 'lyra'}:${worldWidth}:${worldHeight}:attached:${shapeIndex}`;
        const countSeed = seeded(`${localSeed}:count`);
        const count = countSeed > 0.82 ? 3 : countSeed > 0.52 ? 2 : countSeed > 0.24 ? 1 : 0;

        return Array.from({ length: count }).map((_, index) => ({
            id: `lyra-attached-${shapeIndex}-${index}`,
            parentShapeId: shape.id,
            x: 0,
            y: 0,
            width: baseUnit * mix(0.01, 0.022, seeded(`${localSeed}:${index}:size`)),
            height: baseUnit * mix(0.026, 0.068, seeded(`${localSeed}:${index}:height`)),
            rotation: mix(-Math.PI, Math.PI, seeded(`${localSeed}:${index}:rotation`)),
            rotationSpeed: mix(-0.04, 0.04, seeded(`${localSeed}:${index}:rotation-speed`)),
            opacity: mix(0.26, 0.64, seeded(`${localSeed}:${index}:opacity`)),
            depth: shape.depth + 0.02,
            colorMix: mix(0.14, 0.86, seeded(`${localSeed}:${index}:color-mix`)),
            highlightMix: mix(0.34, 1, seeded(`${localSeed}:${index}:highlight-mix`)),
            offsetPhase: seeded(`${localSeed}:${index}:offset-phase`),
            pulsePhase: seeded(`${localSeed}:${index}:pulse-phase`) * TAU,
            pulseSpeed: mix(0.45, 1.1, seeded(`${localSeed}:${index}:pulse-speed`)),
            audioBand: 'treble',
        }));
    });

    return {
        width: worldWidth,
        height: worldHeight,
        shapes: shapes.sort((left, right) => left.depth - right.depth),
        sparks: sparks.sort((left, right) => left.depth - right.depth),
        attachedSparks: attachedSparks.sort((left, right) => left.depth - right.depth),
        ambientDots: ambientDots.sort((left, right) => left.depth - right.depth),
    };
};

export const drawLyraBackground = ({
    context,
    scene,
    theme,
    time = 0,
    audioLevels,
    parallax,
}: {
    context: CanvasRenderingContext2D;
    scene: LyraBackgroundScene;
    theme: Theme;
    time?: number;
    audioLevels?: LyraBackgroundAudioLevels;
    parallax?: LyraBackgroundParallax;
}) => {
    const shapeById = new Map(scene.shapes.map(shape => [shape.id, shape]));

    for (const dot of scene.ambientDots) {
        const layerResponse = mix(0.54, 1.08, dot.depth);
        const parallaxStrength = parallax?.strength ?? 1;
        const parallaxOffsetX = parallax
            ? (parallax.cameraX - parallax.originX) * (1 - layerResponse) * parallaxStrength
            : 0;
        const parallaxOffsetY = parallax
            ? (parallax.cameraY - parallax.originY) * (1 - layerResponse) * parallaxStrength
            : 0;

        context.save();
        context.translate(dot.x + parallaxOffsetX, dot.y + parallaxOffsetY);
        drawAmbientDot({
            context,
            dot,
            theme,
            alpha: clamp(dot.opacity, 0.04, 0.62),
        });
        context.restore();
    }

    for (const shape of scene.shapes) {
        const layerResponse = mix(0.58, 1.14, shape.depth);
        const parallaxStrength = parallax?.strength ?? 1;
        const parallaxOffsetX = parallax
            ? (parallax.cameraX - parallax.originX) * (1 - layerResponse) * parallaxStrength
            : 0;
        const parallaxOffsetY = parallax
            ? (parallax.cameraY - parallax.originY) * (1 - layerResponse) * parallaxStrength
            : 0;
        const resolvedShape = {
            ...shape,
            x: shape.x + parallaxOffsetX,
            y: shape.y + parallaxOffsetY,
            rotation: shape.rotation + time * shape.rotationSpeed,
        };

        context.save();
        context.translate(resolvedShape.x, resolvedShape.y);
        context.rotate(resolvedShape.rotation);
        drawShapeStrokeLayers({
            context,
            shape: resolvedShape,
            theme,
            opacity: clamp(shape.opacity, 0.08, 0.96),
            highlightBoost: 0,
        });
        context.restore();
    }

    for (const spark of scene.sparks) {
        const bandValue = spark.audioBand ? audioLevels?.[spark.audioBand] : undefined;
        const audioScale = bandValue === undefined
            ? 1
            : mix(0.92, 1.32, clamp((bandValue - 12) / 190, 0, 1));
        const audioAlpha = bandValue === undefined
            ? 1
            : mix(0.82, 1.36, clamp((bandValue - 12) / 190, 0, 1));
        const layerResponse = mix(0.56, 1.12, spark.depth);
        const parallaxStrength = parallax?.strength ?? 1;
        const parallaxOffsetX = parallax
            ? (parallax.cameraX - parallax.originX) * (1 - layerResponse) * parallaxStrength
            : 0;
        const parallaxOffsetY = parallax
            ? (parallax.cameraY - parallax.originY) * (1 - layerResponse) * parallaxStrength
            : 0;
        const resolvedSpark = {
            ...spark,
            x: spark.x + parallaxOffsetX,
            y: spark.y + parallaxOffsetY,
            width: spark.width * audioScale,
            height: spark.height * audioScale,
            rotation: spark.rotation + time * spark.rotationSpeed,
        };

        context.save();
        context.translate(resolvedSpark.x, resolvedSpark.y);
        drawFreeSpark({
            context,
            spark: resolvedSpark,
            theme,
            alpha: clamp(spark.opacity * audioAlpha, 0.08, 1),
            glowBoost: 0,
        });
        context.restore();
    }

    for (const attachedSpark of scene.attachedSparks) {
        const parentShape = shapeById.get(attachedSpark.parentShapeId);
        if (!parentShape) {
            continue;
        }

        const layerResponse = mix(0.58, 1.14, parentShape.depth);
        const parallaxStrength = parallax?.strength ?? 1;
        const parallaxOffsetX = parallax
            ? (parallax.cameraX - parallax.originX) * (1 - layerResponse) * parallaxStrength
            : 0;
        const parallaxOffsetY = parallax
            ? (parallax.cameraY - parallax.originY) * (1 - layerResponse) * parallaxStrength
            : 0;
        const worldPoint = resolveShapeWorldPoint(parentShape, attachedSpark.offsetPhase, parallaxOffsetX, parallaxOffsetY, time);
        const pulse = 0.72 + 0.28 * Math.sin(time * attachedSpark.pulseSpeed + attachedSpark.pulsePhase);
        const bandValue = attachedSpark.audioBand ? audioLevels?.[attachedSpark.audioBand] : undefined;
        const bandBoost = bandValue === undefined
            ? 1
            : mix(0.94, 1.22, clamp((bandValue - 10) / 190, 0, 1));
        const powerLevel = clamp(((audioLevels?.power ?? 0) - 10) / 220, 0, 1);
        const audioAlphaBoost = bandValue === undefined
            ? 1
            : mix(0.9, 1.28, clamp((bandValue - 10) / 190, 0, 1));

        context.save();
        context.translate(worldPoint.x, worldPoint.y);
        drawAttachedSpark({
            context,
            spark: {
                ...attachedSpark,
                width: attachedSpark.width * pulse,
                height: attachedSpark.height * pulse,
                rotation: attachedSpark.rotation + time * attachedSpark.rotationSpeed,
            },
            theme,
            alpha: clamp(attachedSpark.opacity * audioAlphaBoost * 0.88, 0.12, 1),
            glowBoost: 0.42 + powerLevel * 0.28,
        });
        context.restore();
    }
};

