import type { Theme } from '../../../types';
import { colorWithAlpha } from '../colorMix';
import { createMotesRandom, hashMotesSeed } from './motesSampling';
import type { MotesTuning } from './types';
import { resolveMotesMaterial } from './motesMaterial';

// A small, time-addressable depth field; the shared background remains visible through it.
export const MOTES_SPACE_PARTICLES = 768;
export const MOTES_SPACE_NEAR = 0.5;
export const MOTES_SPACE_FAR = 9.5;
export const MOTES_SPACE_SPEED = 0.6;
const MAX_TRAIL_LENGTH = 18;
const MAX_STAR_RADIUS = 3;

export interface MotesSpace {
    x: Float32Array;
    y: Float32Array;
    z: Float32Array;
    size: Float32Array;
    phase: Float32Array;
    haze?: {
        context: CanvasRenderingContext2D;
        width: number;
        height: number;
        pixelWidth: number;
        pixelHeight: number;
        primary: string;
        accent: string;
        cloud: CanvasGradient;
    };
}

export const createMotesSpace = (seed: string | number = 'motes'): MotesSpace => {
    const random = createMotesRandom(hashMotesSeed(String(seed)));
    const x = new Float32Array(MOTES_SPACE_PARTICLES);
    const y = new Float32Array(MOTES_SPACE_PARTICLES);
    const z = new Float32Array(MOTES_SPACE_PARTICLES);
    const size = new Float32Array(MOTES_SPACE_PARTICLES);
    const phase = new Float32Array(MOTES_SPACE_PARTICLES);
    for (let index = 0; index < MOTES_SPACE_PARTICLES; index += 1) {
        z[index] = MOTES_SPACE_NEAR + random() * (MOTES_SPACE_FAR - MOTES_SPACE_NEAR);
        // World positions are independent of depth: distant motes converge and near ones leave the frustum.
        // The wider third fills the outer viewport while the core preserves a dense distant star cluster.
        const spread = index % 3 === 0 ? 2.2 : 1;
        x[index] = (random() * 2 - 1) * 3.2 * spread;
        y[index] = (random() * 2 - 1) * 2.2 * spread;
        size[index] = 0.8 + random() * 0.7;
        phase[index] = random() * Math.PI * 2;
    }
    return { x, y, z, size, phase };
};

export interface MotesSpaceDrawOptions {
    width: number;
    height: number;
    time: number;
    theme: Pick<Theme, 'primaryColor' | 'accentColor'>;
    tuning: MotesTuning;
    staticMode?: boolean;
    reducedMotion?: boolean;
}

const unit = (value: number) => Math.max(0, Math.min(1, value));
const fraction = (value: number) => value - Math.floor(value);
const smooth = (value: number) => { const t = unit(value); return t * t * (3 - 2 * t); };

// Address the same world field directly by song time so seeking never depends on previous frames.
export const resolveMotesDepth = (initialDepth: number, time: number, drift: number): number => {
    const span = MOTES_SPACE_FAR - MOTES_SPACE_NEAR;
    const clock = Number.isFinite(time) ? time : 0;
    return MOTES_SPACE_NEAR + fraction((initialDepth - MOTES_SPACE_NEAR - clock * unit(drift) * MOTES_SPACE_SPEED) / span) * span;
};

// Both ends disappear before wrapping, including a mote passing directly through the vanishing point.
export const resolveMotesDepthFade = (depth: number): number =>
    smooth((depth - MOTES_SPACE_NEAR) / 0.4) * smooth((MOTES_SPACE_FAR - depth) / 0.8);

// Cache the distant cloud: no gradient or shadow is constructed for an individual mote.
const resolveHaze = (context: CanvasRenderingContext2D, space: MotesSpace, width: number, height: number, theme: MotesSpaceDrawOptions['theme']) => {
    const primary = theme.primaryColor;
    const accent = theme.accentColor || primary;
    const pixelWidth = context.canvas?.width ?? width;
    const pixelHeight = context.canvas?.height ?? height;
    const cached = space.haze;
    if (cached?.context === context && cached.width === width && cached.height === height
        && cached.pixelWidth === pixelWidth && cached.pixelHeight === pixelHeight
        && cached.primary === primary && cached.accent === accent) return cached;
    const radius = Math.min(width, height) * 0.55;
    const cloud = context.createRadialGradient(width * 0.5, height * 0.43, 0, width * 0.5, height * 0.43, radius);
    cloud.addColorStop(0, colorWithAlpha(accent, 0.6));
    cloud.addColorStop(0.45, colorWithAlpha(primary, 0.15));
    cloud.addColorStop(1, 'transparent');
    space.haze = { context, width, height, pixelWidth, pixelHeight, primary, accent, cloud };
    return space.haze;
};

export const drawMotesSpace = (
    context: CanvasRenderingContext2D,
    space: MotesSpace,
    { width, height, time, theme, tuning, staticMode = false, reducedMotion = false }: MotesSpaceDrawOptions,
) => {
    const depth = unit(Number.isFinite(tuning.depth) ? tuning.depth : 0.7);
    if (depth === 0 || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    const drift = unit(Number.isFinite(tuning.drift) ? tuning.drift : 0.6);
    const motion = staticMode || reducedMotion ? 0 : drift;
    const clock = motion === 0 ? 0 : Number.isFinite(time) ? time : 0;
    const focal = Math.min(width, height) * 0.95;
    const centerX = width * 0.5;
    const centerY = height * 0.43;
    const boundsMargin = MAX_TRAIL_LENGTH + MAX_STAR_RADIUS;
    const haze = resolveHaze(context, space, width, height, theme);
    const material = resolveMotesMaterial(context, theme.primaryColor, theme.accentColor || theme.primaryColor);
    context.save();
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = depth * 0.075;
    context.fillStyle = haze.cloud;
    context.fillRect(0, 0, width, height);
    for (let index = 0; index < space.x.length; index += 1) {
        const z = resolveMotesDepth(space.z[index], clock, motion);
        const projectedX = space.x[index] * focal / z;
        const projectedY = space.y[index] * focal / z;
        const x = centerX + projectedX;
        const y = centerY + projectedY;
        // A head outside the viewport may still leave a visible trail or glow inside it.
        if (x < -boundsMargin || x > width + boundsMargin || y < -boundsMargin || y > height + boundsMargin) continue;
        // Lyrics stay clearest in the middle without erasing the distant cluster behind them.
        const dx = projectedX / (width * 0.38);
        const dy = projectedY / (height * 0.25);
        const clearance = 0.44 + smooth((dx * dx + dy * dy) / 1.5) * 0.56;
        const nearness = unit((5 - z) / 4.5);
        const shimmer = 0.88 + Math.sin(clock * motion * 0.3 + space.phase[index]) * 0.12;
        const alpha = depth * (0.64 + nearness * 0.32) * clearance * resolveMotesDepthFade(z) * shimmer;
        if (alpha <= 0) continue;
        const radius = Math.min(MAX_STAR_RADIUS, space.size[index] * (0.34 + 1.45 / z));
        const accented = index % 5 === 0;
        const color = accented ? theme.accentColor || theme.primaryColor : theme.primaryColor;
        const grain = accented ? material?.accent : material?.primary;
        const glow = accented ? material?.glowAccent : material?.glowPrimary;
        context.fillStyle = color;
        if (z < 4 && motion > 0 && index % 5 === 0) {
            // A few foreground exposures carry the journey; distant stars stay quiet behind the text.
            const exposure = MOTES_SPACE_SPEED * motion * 0.65;
            const trailRatio = exposure / (z + exposure);
            const radialDistance = Math.hypot(projectedX, projectedY);
            const ratio = Math.min(trailRatio, MAX_TRAIL_LENGTH / Math.max(1, radialDistance));
            context.strokeStyle = color;
            context.lineWidth = Math.max(0.6, radius * 0.65);
            context.lineCap = 'round';
            context.globalAlpha = alpha * 0.7 * smooth((4 - z) / 1.2);
            context.beginPath();
            context.moveTo(x - projectedX * ratio, y - projectedY * ratio);
            context.lineTo(x, y);
            context.stroke();
        }
        if (glow && z < 3.5) {
            context.globalAlpha = alpha * smooth((3.5 - z) / 1.5) * 0.2;
            context.drawImage(glow, x - radius * 4, y - radius * 4, radius * 8, radius * 8);
        }
        context.globalAlpha = Math.min(1, alpha * (1 + nearness * 0.25));
        if (grain) context.drawImage(grain, x - radius, y - radius, radius * 2, radius * 2);
        else context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    context.restore();
};
