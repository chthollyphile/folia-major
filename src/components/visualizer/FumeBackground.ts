import { Theme } from '../../types';

interface ViewportSize {
    width: number;
    height: number;
}

interface WorldSize {
    width: number;
    height: number;
}

type FumeBackgroundShapeKind = 'ring' | 'square' | 'cross';

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
    colorMix: number;
    depth: number;
}

export interface FumeBackgroundScene {
    width: number;
    height: number;
    shapes: FumeBackgroundShape[];
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

const traceShape = (
    context: CanvasRenderingContext2D,
    shape: FumeBackgroundShape,
) => {
    context.save();
    context.translate(shape.x, shape.y);
    context.rotate(shape.rotation);
    context.beginPath();

    if (shape.kind === 'ring') {
        context.ellipse(0, 0, shape.width * 0.5, shape.width * 0.5, 0, 0, Math.PI * 2);
    } else {
        const size = shape.width;
        if (shape.kind === 'square') {
            context.rect(-size * 0.5, -size * 0.5, size, size);
        } else {
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
        }
    }

    context.stroke();
    context.restore();
};

const chooseCenterAnchor = ({
    worldWidth,
    worldHeight,
    seedKey,
}: {
    worldWidth: number;
    worldHeight: number;
    seedKey: string;
}) => ({
    x: mix(worldWidth * 0.16, worldWidth * 0.84, seeded(`${seedKey}:x`)),
    y: mix(worldHeight * 0.16, worldHeight * 0.84, seeded(`${seedKey}:y`)),
});

export const buildFumeBackgroundScene = ({
    viewport,
    world,
    seed,
}: {
    viewport: ViewportSize;
    world: WorldSize;
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
    const shapeKinds: FumeBackgroundShapeKind[] = ['ring', 'square', 'cross', 'ring', 'square', 'cross'];
    const shapeCount = worldWidth > worldHeight ? 8 : 7;

    const shapes = Array.from({ length: shapeCount }).map((_, index) => {
        const localSeed = `${seed ?? 'fume'}:${worldWidth}:${worldHeight}:${index}`;
        const kind = shapeKinds[index % shapeKinds.length]!;
        const width = baseUnit * mix(0.82, 1.36, seeded(`${localSeed}:size`));
        const height = width;
        const anchor = chooseCenterAnchor({
            worldWidth,
            worldHeight,
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
            strokeWidth: mix(1.6, 3.4, seeded(`${localSeed}:stroke-width`)),
            opacity: mix(0.042, 0.1, seeded(`${localSeed}:opacity`)),
            colorMix: mix(0.18, 0.62, seeded(`${localSeed}:color-mix`)),
            depth: seeded(`${localSeed}:depth`),
        };
    }).sort((left, right) => left.depth - right.depth);

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
}: {
    context: CanvasRenderingContext2D;
    scene: FumeBackgroundScene;
    theme: Theme;
    time?: number;
}) => {
    for (const shape of scene.shapes) {
        context.save();
        context.lineWidth = shape.strokeWidth;
        context.strokeStyle = mixColors(
            theme.secondaryColor,
            theme.accentColor,
            shape.colorMix,
            shape.opacity,
        );
        context.shadowBlur = shape.kind === 'cross' ? 6 : 8;
        context.shadowColor = colorWithAlpha(theme.accentColor, shape.opacity * 0.65);
        traceShape(context, {
            ...shape,
            rotation: shape.rotation + time * shape.rotationSpeed,
        });
        context.restore();
    }
};
