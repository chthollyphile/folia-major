import { describe, expect, it, vi } from 'vitest';
import {
    createMotesSpace, drawMotesSpace, MOTES_SPACE_FAR, MOTES_SPACE_NEAR, MOTES_SPACE_SPEED,
    resolveMotesDepth, resolveMotesDepthFade, type MotesSpace, type MotesSpaceDrawOptions,
} from '@/components/visualizer/motes/motesSpace';
import { DEFAULT_MOTES_TUNING } from '@/components/visualizer/motes/types';
import { resolveMotesMaterial } from '@/components/visualizer/motes/motesMaterial';

// The depth field stays bounded and reproducible without an accumulated simulation or its own scheduler.
const capture = (space = createMotesSpace('test-song')) => {
    const commands: unknown[][] = [];
    let path: number[] = [];
    let theme = { primaryColor: '#ffffff', accentColor: '#ff0000' };
    const ownerDocument = { createElement: vi.fn(() => {
        const paint = { fillStyle: '', globalCompositeOperation: 'source-over', createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} };
        return { width: 0, height: 0, getContext: () => paint };
    }) };
    const context = {
        canvas: { width: 1280, height: 720, ownerDocument },
        fillStyle: '' as string | CanvasGradient,
        strokeStyle: '', lineWidth: 1, lineCap: 'butt',
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        save() {}, restore() {},
        translate(x: number, y: number) { commands.push(['translate', x, y]); },
        beginPath() { path = []; },
        moveTo(x: number, y: number) { path.push(x, y); },
        lineTo(x: number, y: number) { path.push(x, y); },
        stroke() { commands.push(['stroke', this.strokeStyle, this.globalAlpha, this.lineWidth, ...path]); },
        createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        fillRect(x: number, y: number, width: number, height: number) {
            commands.push(['fill', typeof this.fillStyle === 'string' ? this.fillStyle : 'haze', this.globalAlpha, x, y, width, height]);
        },
        drawImage(sprite: HTMLCanvasElement, x: number, y: number, width: number, height: number) {
            const material = resolveMotesMaterial(this as unknown as CanvasRenderingContext2D, theme.primaryColor, theme.accentColor)!;
            const kind = sprite === material.primary || sprite === material.accent ? 'fill' : 'glow';
            commands.push([kind, sprite.getContext('2d')!.fillStyle, this.globalAlpha, x, y, width, height]);
        },
    };
    const draw = (time: number, overrides: Partial<MotesSpaceDrawOptions> = {}) => {
        commands.length = 0;
        theme = overrides.theme ?? { primaryColor: '#ffffff', accentColor: '#ff0000' };
        drawMotesSpace(context as unknown as CanvasRenderingContext2D, space, {
            width: 640, height: 360, time,
            theme,
            tuning: DEFAULT_MOTES_TUNING, ...overrides,
        });
        return structuredClone(commands);
    };
    return { context, space, draw };
};

const singleMote = (z: number, x = 0.25, y = 0.1): MotesSpace => ({
    x: new Float32Array([x]), y: new Float32Array([y]), z: new Float32Array([z]),
    size: new Float32Array([1]), phase: new Float32Array([0]),
});

const particleRects = (commands: unknown[][]) => commands.filter(command => command[0] === 'fill' && command[1] !== 'haze') as [string, string, number, number, number, number, number][];
const centerOf = (rect: ReturnType<typeof particleRects>[number]) => ({ x: rect[3] + rect[5] / 2, y: rect[4] + rect[6] / 2 });
const distanceFromCenter = (rect: ReturnType<typeof particleRects>[number]) => Math.hypot(centerOf(rect).x - 320, centerOf(rect).y - 360 * 0.43);

describe('Motes spatial field', () => {
    it('allocates a bounded field across multiple depths and reproduces a song seed', () => {
        const space = createMotesSpace('song-a');
        expect(space.x.length).toBeGreaterThan(0);
        expect(space.x.length).toBeLessThanOrEqual(800);
        for (const values of [space.y, space.z, space.phase, space.size]) {
            expect(values.length).toBe(space.x.length);
            expect([...values].every(Number.isFinite)).toBe(true);
        }
        expect([...space.z].every(value => value >= MOTES_SPACE_NEAR && value < MOTES_SPACE_FAR)).toBe(true);
        expect(createMotesSpace('song-a')).toEqual(space);
        expect(createMotesSpace('song-b').x).not.toEqual(space.x);
    });

    it('projects the same world point smaller and closer to the vanishing point when distant', () => {
        const far = particleRects(capture(singleMote(8)).draw(0))[0];
        const near = particleRects(capture(singleMote(1.2)).draw(0))[0];
        expect(near[5]).toBeGreaterThan(far[5] * 2);
        expect(distanceFromCenter(near)).toBeGreaterThan(distanceFromCenter(far) * 5);
        const field = createMotesSpace('density-check');
        const farCloud = particleRects(capture({ ...field, z: new Float32Array(field.z.length).fill(8) }).draw(0));
        const nearCloud = particleRects(capture({ ...field, z: new Float32Array(field.z.length).fill(1.2) }).draw(0));
        // Fixed world coordinates converge in the distance; nearby particles mostly leave the viewport.
        expect(nearCloud.length).toBeGreaterThan(0);
        expect(farCloud.length).toBeGreaterThan(nearCloud.length * 2);
        const meanRadius = (rects: ReturnType<typeof particleRects>) => rects.reduce((sum, rect) => sum + distanceFromCenter(rect), 0) / rects.length;
        expect(meanRadius(farCloud)).toBeLessThan(meanRadius(nearCloud));
    });

    it('moves a particle outward as it approaches and draws a short radial tail only nearby', () => {
        const { draw } = capture(singleMote(2));
        const first = particleRects(draw(0))[0];
        const later = draw(4);
        const approached = particleRects(later)[0];
        expect(distanceFromCenter(approached) - distanceFromCenter(first)).toBeGreaterThan(4);
        expect(approached[5]).toBeGreaterThan(first[5]);
        const tail = later.find(command => command[0] === 'stroke') as [string, string, number, number, number, number, number, number];
        expect(tail).toBeDefined();
        const [, , , , fromX, fromY, toX, toY] = tail;
        const center = centerOf(approached);
        expect(toX).toBeCloseTo(center.x);
        expect(toY).toBeCloseTo(center.y);
        expect(Math.hypot(toX - fromX, toY - fromY)).toBeGreaterThan(0);
        expect(Math.hypot(toX - fromX, toY - fromY)).toBeLessThan(640 * 0.1);
        expect(Math.abs((fromX - 320) * (toY - 360 * 0.43) - (fromY - 360 * 0.43) * (toX - 320))).toBeLessThan(1e-7);
        expect(Math.hypot(fromX - 320, fromY - 360 * 0.43)).toBeLessThan(distanceFromCenter(approached));
        expect(capture(singleMote(8)).draw(4).some(command => command[0] === 'stroke')).toBe(false);
    });

    it('keeps a tail crossing the viewport after its head leaves, then culls it fully outside', () => {
        const atScreenX = (x: number) => singleMote(1.9, (x - 320) * 1.9 / 342, 0);
        const crossing = capture(atScreenX(648)).draw(0);
        const tail = crossing.find(command => command[0] === 'stroke') as [string, string, number, number, number, number, number, number];
        expect(tail).toBeDefined();
        expect(tail[4]).toBeLessThan(640);
        expect(tail[6]).toBeGreaterThan(640);
        const outside = capture(atScreenX(750)).draw(0);
        expect(outside.some(command => command[0] === 'stroke')).toBe(false);
        expect(particleRects(outside)).toHaveLength(0);
    });

    it('fades out on both sides of the near-to-far wrap before showing the recycled point', () => {
        const initial = MOTES_SPACE_NEAR + 0.5;
        const crossing = 0.5 / MOTES_SPACE_SPEED;
        const before = resolveMotesDepth(initial, crossing - 0.01, 1);
        const after = resolveMotesDepth(initial, crossing + 0.01, 1);
        expect(before).toBeLessThan(MOTES_SPACE_NEAR + 0.01);
        expect(after).toBeGreaterThan(MOTES_SPACE_FAR - 0.01);
        expect(resolveMotesDepthFade(MOTES_SPACE_NEAR)).toBe(0);
        expect(resolveMotesDepthFade(MOTES_SPACE_FAR)).toBe(0);
        expect(resolveMotesDepthFade(before)).toBeLessThan(0.01);
        expect(resolveMotesDepthFade(after)).toBeLessThan(0.01);
        expect(resolveMotesDepthFade(4)).toBeGreaterThan(0.9);
        const { draw } = capture(singleMote(initial, 0.05, 0.02));
        const options = { tuning: { ...DEFAULT_MOTES_TUNING, drift: 1 } };
        const alpha = (time: number) => Math.max(0, ...particleRects(draw(time, options)).map(rect => rect[2]));
        const visible = alpha(0);
        expect(visible).toBeGreaterThan(0.05);
        expect(alpha(crossing - 0.01)).toBeLessThan(visible * 0.01);
        expect(alpha(crossing + 0.01)).toBeLessThan(visible * 0.01);
        expect(alpha(crossing + 5)).toBeGreaterThan(0.05);
    });

    it('moves during stable playback and reproduces the same frame after an arbitrary seek', () => {
        const { space, draw } = capture();
        const geometry = structuredClone({ x: space.x, y: space.y, z: space.z });
        const first = draw(1);
        expect(draw(20)).not.toEqual(first);
        draw(0); draw(1000);
        expect(draw(1)).toEqual(first);
        expect({ x: space.x, y: space.y, z: space.z }).toEqual(geometry);
    });

    it.each([
        { staticMode: true },
        { reducedMotion: true },
        { tuning: { ...DEFAULT_MOTES_TUNING, drift: 0 } },
    ])('keeps %j stationary at every playback time', options => {
        const { draw } = capture();
        const first = draw(0, options);
        expect(first.length).toBeGreaterThan(0);
        expect(draw(10, options)).toEqual(first);
        expect(draw(1000, options)).toEqual(first);
    });

    it('does no drawing or gradient allocation with depth disabled or an empty viewport', () => {
        const { context, draw } = capture();
        expect(draw(10, { tuning: { ...DEFAULT_MOTES_TUNING, depth: 0 } })).toEqual([]);
        expect(draw(10, { width: 0 })).toEqual([]);
        expect(draw(10, { height: 0 })).toEqual([]);
        expect(context.createRadialGradient).not.toHaveBeenCalled();
        expect(context.canvas.ownerDocument.createElement).not.toHaveBeenCalled();
    });

    it('uses both dark and light theme colors without changing the perspective geometry', () => {
        const { draw } = capture();
        const light = particleRects(draw(4, { theme: { primaryColor: '#f4f7ff', accentColor: '#e4d9ff' } }));
        const dark = particleRects(draw(4, { theme: { primaryColor: '#142638', accentColor: '#533870' } }));
        expect(new Set(light.map(rect => rect[1]))).toEqual(new Set(['#f4f7ff', '#e4d9ff']));
        expect(new Set(dark.map(rect => rect[1]))).toEqual(new Set(['#142638', '#533870']));
        expect(dark.map(rect => rect.slice(2))).toEqual(light.map(rect => rect.slice(2)));
        expect(dark.some(rect => rect[2] > 0.05)).toBe(true);
    });

    it('bounds per-frame drawing and reuses finite haze geometry until size, pixel ratio or colors change', () => {
        const { context, space, draw } = capture();
        for (const time of [0, 300, 1_000_000, Number.NaN]) {
            const commands = draw(time);
            expect(commands.filter(command => command[0] === 'fill' || command[0] === 'glow').length).toBeLessThanOrEqual(1 + space.x.length * 2);
            expect(commands.filter(command => command[0] === 'stroke').length).toBeLessThanOrEqual(Math.ceil(space.x.length / 5));
            for (const command of commands) {
                expect(command.slice(2).every(value => typeof value === 'number' && Number.isFinite(value))).toBe(true);
                expect(command[2]).toBeGreaterThanOrEqual(0);
                expect(command[2]).toBeLessThanOrEqual(1);
            }
        }
        expect(context.createRadialGradient).toHaveBeenCalledTimes(1);
        draw(10, { width: 320 });
        expect(context.createRadialGradient).toHaveBeenCalledTimes(2);
        draw(10, { width: 320, theme: { primaryColor: '#0088aa', accentColor: '#ff0000' } });
        expect(context.createRadialGradient).toHaveBeenCalledTimes(3);
        context.canvas.width = 640;
        context.canvas.height = 360;
        draw(10, { width: 320, theme: { primaryColor: '#0088aa', accentColor: '#ff0000' } });
        expect(context.createRadialGradient).toHaveBeenCalledTimes(4);
    });
});
