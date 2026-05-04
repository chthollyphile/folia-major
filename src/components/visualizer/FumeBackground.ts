import { Theme } from '../../types';

interface ViewportSize {
    width: number;
    height: number;
}

interface WorldSize {
    width: number;
    height: number;
}

interface FumeBackgroundBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

type FumeBackgroundShapeKind = 'ring' | 'square' | 'cross' | 'spark';
type FumeBackgroundAudioBand = 'bass' | 'lowMid' | 'mid' | 'vocal' | 'treble';
type FumeBackgroundShapeColor = 'secondary' | 'accent';

interface FumeBackgroundShape {
    id: string;
    kind: FumeBackgroundShapeKind;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    rotationSpeed: number;
    strokeWidth: number;
    opacity: number;
    color: FumeBackgroundShapeColor;
    depth: number;
    audioBand?: FumeBackgroundAudioBand;
    ringGapStart?: number;
    ringGapSize?: number;
}

export interface FumeBackgroundScene {
    width: number;
    height: number;
    shapes: FumeBackgroundShape[];
}

export type FumeBackgroundAudioLevels = Partial<Record<FumeBackgroundAudioBand, number>> & {
    power?: number;
};

interface FumeBackgroundParallax {
    cameraX: number;
    cameraY: number;
    originX: number;
    originY: number;
    strength?: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

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

const traceShape = (
    context: CanvasRenderingContext2D,
    shape: FumeBackgroundShape,
) => {
    context.save();
    context.translate(shape.x, shape.y);
    context.rotate(shape.rotation);
    context.beginPath();

    if (shape.kind === 'ring') {
        const gapStart = shape.ringGapStart ?? -Math.PI * 0.18;
        const gapSize = clamp(shape.ringGapSize ?? (Math.PI * 0.2), 0.18, Math.PI * 0.6);
        context.lineCap = 'round';
        context.ellipse(
            0,
            0,
            shape.width * 0.5,
            shape.width * 0.5,
            0,
            gapStart + gapSize,
            gapStart + Math.PI * 2,
        );
    } else {
        const size = shape.width;
        if (shape.kind === 'square') {
            context.rect(-size * 0.5, -size * 0.5, size, size);
        } else if (shape.kind === 'cross') {
            const arm = size * 0.3;
            context.moveTo(-arm, -size * 0.5);
            context.lineTo(arm, -size * 0.5);
            context.lineTo(arm, -arm);
            context.lineTo(size * 0.5, -arm);
            context.lineTo(size * 0.5, arm);
            context.lineTo(arm, arm);
            context.lineTo(arm, size * 0.5);
            context.lineTo(-arm, size * 0.5);
            context.lineTo(-arm, arm);
            context.lineTo(-size * 0.5, arm);
            context.lineTo(-size * 0.5, -arm);
            context.lineTo(-arm, -arm);
            context.closePath();
        } else {
            const outer = size * 0.5;
            const inner = size * 0.13;
            context.moveTo(0, -outer);
            context.lineTo(inner, -inner);
            context.lineTo(outer, 0);
            context.lineTo(inner, inner);
            context.lineTo(0, outer);
            context.lineTo(-inner, inner);
            context.lineTo(-outer, 0);
            context.lineTo(-inner, -inner);
            context.closePath();
        }
    }

    context.stroke();
    context.restore();
};

const normalizeBounds = (
    bounds: FumeBackgroundBounds,
    worldWidth: number,
    worldHeight: number,
): FumeBackgroundBounds => ({
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
    paperBounds: FumeBackgroundBounds;
    worldWidth: number;
    worldHeight: number;
    width: number;
    height: number;
    seedKey: string;
}) => {
    const insideChance = seeded(`${seedKey}:inside-chance`);
    if (insideChance < 0.22) {
        return {
            x: clamp(
                mix(
                    paperBounds.left + width * 0.12,
                    paperBounds.right - width * 0.12,
                    seeded(`${seedKey}:inside-x`),
                ),
                0,
                worldWidth,
            ),
            y: clamp(
                mix(
                    paperBounds.top + height * 0.12,
                    paperBounds.bottom - height * 0.12,
                    seeded(`${seedKey}:inside-y`),
                ),
                0,
                worldHeight,
            ),
        };
    }

    const side = Math.floor(seeded(`${seedKey}:side`) * 4) % 4;
    const overflowX = width * mix(0.16, 0.24, seeded(`${seedKey}:overflow-x`));
    const overflowY = height * mix(0.16, 0.24, seeded(`${seedKey}:overflow-y`));
    const spanJitterX = width * mix(-0.18, 0.18, seeded(`${seedKey}:span-jitter-x`));
    const spanJitterY = height * mix(-0.18, 0.18, seeded(`${seedKey}:span-jitter-y`));

    if (side === 0) {
        return {
            x: clamp(paperBounds.left - overflowX, 0, worldWidth),
            y: clamp(
                mix(paperBounds.top - height * 0.12, paperBounds.bottom + height * 0.12, seeded(`${seedKey}:y`)) + spanJitterY,
                0,
                worldHeight,
            ),
        };
    }

    if (side === 1) {
        return {
            x: clamp(paperBounds.right + overflowX, 0, worldWidth),
            y: clamp(
                mix(paperBounds.top - height * 0.12, paperBounds.bottom + height * 0.12, seeded(`${seedKey}:y`)) + spanJitterY,
                0,
                worldHeight,
            ),
        };
    }

    if (side === 2) {
        return {
            x: clamp(
                mix(paperBounds.left - width * 0.12, paperBounds.right + width * 0.12, seeded(`${seedKey}:x`)) + spanJitterX,
                0,
                worldWidth,
            ),
            y: clamp(paperBounds.top - overflowY, 0, worldHeight),
        };
    }

    return {
        x: clamp(
            mix(paperBounds.left - width * 0.12, paperBounds.right + width * 0.12, seeded(`${seedKey}:x`)) + spanJitterX,
            0,
            worldWidth,
        ),
        y: clamp(paperBounds.bottom + overflowY, 0, worldHeight),
    };
};

export const buildFumeBackgroundScene = ({
    viewport,
    world,
    paperBounds,
    seed,
}: {
    viewport: ViewportSize;
    world: WorldSize;
    paperBounds?: FumeBackgroundBounds;
    seed?: string | number;
}): FumeBackgroundScene => {
    if (viewport.width <= 0 || viewport.height <= 0 || world.width <= 0 || world.height <= 0) {
        return {
            width: Math.max(world.width, viewport.width, 1),
            height: Math.max(world.height, viewport.height, 1),
            shapes: [],
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
    const resolvedPaperBounds = normalizeBounds(
        paperBounds ?? defaultPaperBounds,
        worldWidth,
        worldHeight,
    );
    const shapeKinds: FumeBackgroundShapeKind[] = ['ring', 'square', 'cross', 'ring', 'square', 'cross'];
    const shapeCount = worldWidth > worldHeight ? 8 : 7;
    const sparkBands: FumeBackgroundAudioBand[] = ['treble', 'vocal', 'mid', 'treble', 'lowMid'];
    const sparkCount = worldWidth > worldHeight ? 12 : 9;
    const sparkAreaLeft = worldWidth * 0.2;
    const sparkAreaRight = worldWidth * 0.8;
    const sparkAreaTop = worldHeight * 0.18;
    const sparkAreaBottom = worldHeight * 0.82;
    const sparkAreaWidth = sparkAreaRight - sparkAreaLeft;
    const sparkAreaHeight = sparkAreaBottom - sparkAreaTop;
    const sparkColumns = Math.ceil(Math.sqrt(sparkCount * (worldWidth / Math.max(worldHeight, 1))));
    const sparkRows = Math.ceil(sparkCount / sparkColumns);
    const sparkCellWidth = sparkAreaWidth / sparkColumns;
    const sparkCellHeight = sparkAreaHeight / sparkRows;

    const baseShapes = Array.from({ length: shapeCount }).map((_, index) => {
        const localSeed = `${seed ?? 'fume'}:${worldWidth}:${worldHeight}:${index}`;
        const kind = shapeKinds[index % shapeKinds.length]!;
        const width = baseUnit * mix(0.82, 1.36, seeded(`${localSeed}:size`));
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
            id: `fume-bg-${index}`,
            kind,
            x: anchor.x,
            y: anchor.y,
            width,
            height,
            rotation: mix(-Math.PI * 0.2, Math.PI * 0.2, seeded(`${localSeed}:rotation`)),
            rotationSpeed: mix(-0.045, 0.045, seeded(`${localSeed}:rotation-speed`)),
            strokeWidth: mix(0.25, 2.1, seeded(`${localSeed}:stroke-width`)),
            opacity: mix(0.01, 0.16, seeded(`${localSeed}:opacity`)),
            color: (seeded(`${localSeed}:color`) > 0.5 ? 'accent' : 'secondary') as FumeBackgroundShapeColor,
            depth: seeded(`${localSeed}:depth`),
            ringGapStart: kind === 'ring'
                ? mix(-Math.PI, Math.PI, seeded(`${localSeed}:gap-start`))
                : undefined,
            ringGapSize: kind === 'ring'
                ? mix(Math.PI * 0.12, Math.PI * 0.24, seeded(`${localSeed}:gap-size`))
                : undefined,
        };
    });

    const sparkShapes = Array.from({ length: sparkCount }).map((_, index) => {
        const localSeed = `${seed ?? 'fume'}:${worldWidth}:${worldHeight}:spark:${index}`;
        const width = baseUnit * mix(0.1, 0.24, seeded(`${localSeed}:size`));
        const column = index % sparkColumns;
        const row = Math.floor(index / sparkColumns);
        const jitterX = mix(-0.32, 0.32, seeded(`${localSeed}:jitter-x`)) * sparkCellWidth;
        const jitterY = mix(-0.32, 0.32, seeded(`${localSeed}:jitter-y`)) * sparkCellHeight;
        const x = clamp(sparkAreaLeft + (column + 0.5) * sparkCellWidth + jitterX, sparkAreaLeft, sparkAreaRight);
        const y = clamp(sparkAreaTop + (row + 0.5) * sparkCellHeight + jitterY, sparkAreaTop, sparkAreaBottom);

        return {
            id: `fume-spark-${index}`,
            kind: 'spark' as const,
            x,
            y,
            width,
            height: width,
            rotation: mix(-Math.PI, Math.PI, seeded(`${localSeed}:rotation`)),
            rotationSpeed: mix(-0.18, 0.18, seeded(`${localSeed}:rotation-speed`)),
            strokeWidth: mix(0.75, 1.7, seeded(`${localSeed}:stroke-width`)),
            opacity: mix(0.08, 0.22, seeded(`${localSeed}:opacity`)),
            color: (seeded(`${localSeed}:color`) > 0.5 ? 'accent' : 'secondary') as FumeBackgroundShapeColor,
            depth: seeded(`${localSeed}:depth`),
            audioBand: sparkBands[index % sparkBands.length],
        };
    });

    const shapes = [...baseShapes, ...sparkShapes].sort((left, right) => left.depth - right.depth);

    return {
        width: worldWidth,
        height: worldHeight,
        shapes,
    };
};

export const drawFumeBackground = ({
    context,
    scene,
    theme,
    time = 0,
    audioLevels,
    parallax,
}: {
    context: CanvasRenderingContext2D;
    scene: FumeBackgroundScene;
    theme: Theme;
    time?: number;
    audioLevels?: FumeBackgroundAudioLevels;
    parallax?: FumeBackgroundParallax;
}) => {
    for (const shape of scene.shapes) {
        const bandValue = shape.audioBand ? audioLevels?.[shape.audioBand] : undefined;
        const audioScale = bandValue === undefined
            ? 1
            : mix(0.95, 1.45, clamp((bandValue - 10) / 190, 0, 1));
        const audioOpacityBoost = bandValue === undefined
            ? 1
            : mix(0.85, 1.55, clamp((bandValue - 10) / 190, 0, 1));

        context.save();
        context.lineWidth = shape.strokeWidth;
        const shapeColor = shape.color === 'accent' ? theme.accentColor : theme.secondaryColor;
        const layerResponse = mix(0.58, 1.16, shape.depth);
        const parallaxStrength = parallax?.strength ?? 1;
        const parallaxOffsetX = parallax
            ? (parallax.cameraX - parallax.originX) * (1 - layerResponse) * parallaxStrength
            : 0;
        const parallaxOffsetY = parallax
            ? (parallax.cameraY - parallax.originY) * (1 - layerResponse) * parallaxStrength
            : 0;

        context.strokeStyle = colorWithAlpha(shapeColor, clamp(shape.opacity * audioOpacityBoost, 0, 0.42));
        context.shadowBlur = shape.kind === 'spark'
            ? 10 * audioScale
            : shape.kind === 'cross'
                ? 6
                : 8;
        context.shadowColor = colorWithAlpha(shapeColor, shape.opacity * audioOpacityBoost * 0.75);
        traceShape(context, {
            ...shape,
            x: shape.x + parallaxOffsetX,
            y: shape.y + parallaxOffsetY,
            width: shape.width * audioScale,
            height: shape.height * audioScale,
            rotation: shape.rotation + time * shape.rotationSpeed,
        });
        context.restore();
    }
};
