import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveMotesMaterial } from '@/components/visualizer/motes/motesMaterial';

// Exercise the real palette cache while replacing only the offscreen canvas raster IO.
const makeOwner = (failAt = -1) => {
    const canvases: { width: number; height: number; getContext: ReturnType<typeof vi.fn>; paint: { fillStyle: unknown; globalCompositeOperation: string } }[] = [];
    const owner = { createElement: vi.fn(() => {
        const index = canvases.length;
        const paint = {
            fillStyle: '' as unknown, globalCompositeOperation: 'source-over',
            createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
            fillRect: vi.fn(),
        };
        const canvas = { width: 0, height: 0, getContext: vi.fn(() => index === failAt ? null : paint), paint };
        canvases.push(canvas);
        return canvas;
    }) };
    return { owner, canvases, context: { canvas: { ownerDocument: owner } } as unknown as CanvasRenderingContext2D };
};

afterEach(() => vi.unstubAllGlobals());

describe('Motes circular materials', () => {
    it('reuses the same palette, honors the canvas owner, and supports CSS colors without parsing them', () => {
        const { owner, canvases, context } = makeOwner();
        const otherDocument = { createElement: vi.fn() };
        vi.stubGlobal('document', otherDocument);
        const first = resolveMotesMaterial(context, 'hsl(210 50% 80%)', 'rebeccapurple');
        expect(first).not.toBeNull();
        expect(resolveMotesMaterial(context, 'hsl(210 50% 80%)', 'rebeccapurple')).toBe(first);
        expect(owner.createElement).toHaveBeenCalledTimes(4);
        expect(otherDocument.createElement).not.toHaveBeenCalled();
        expect(canvases.every(canvas => canvas.width === 64 && canvas.height === 64)).toBe(true);
        expect(canvases.map(canvas => canvas.paint.fillStyle)).toEqual(['hsl(210 50% 80%)', 'rebeccapurple', 'hsl(210 50% 80%)', 'rebeccapurple']);
        expect(canvases.every(canvas => canvas.paint.globalCompositeOperation === 'source-over')).toBe(true);
    });

    it('releases previous backing stores on palette changes and keeps only one four-sprite palette per context', () => {
        const { canvases, context } = makeOwner();
        const first = resolveMotesMaterial(context, '#ffffff', '#aa88ff');
        for (let index = 0; index < 12; index += 1) {
            const next = resolveMotesMaterial(context, `hsl(${index * 20} 50% 70%)`, '#aa88ff');
            expect(next).not.toBe(first);
            expect(canvases.filter(canvas => canvas.width > 0 || canvas.height > 0)).toHaveLength(4);
        }
        expect(first!.primary.width).toBe(0);
        expect(first!.glowAccent.height).toBe(0);
    });

    it('isolates target contexts and treats an empty accent as the primary palette', () => {
        const { owner, context } = makeOwner();
        const first = resolveMotesMaterial(context, '#abcdef', '');
        expect(resolveMotesMaterial(context, '#abcdef', '#abcdef')).toBe(first);
        const secondContext = { canvas: { ownerDocument: owner } } as unknown as CanvasRenderingContext2D;
        const second = resolveMotesMaterial(secondContext, '#abcdef', '');
        expect(second!.primary).not.toBe(first!.primary);
        expect(first!.primary.width).toBe(64);
        expect(owner.createElement).toHaveBeenCalledTimes(8);
    });

    it('releases partial sprites and caches a failed 2D context instead of reallocating every frame', () => {
        const { owner, canvases, context } = makeOwner(2);
        expect(resolveMotesMaterial(context, '#ffffff', '#aa88ff')).toBeNull();
        expect(canvases).toHaveLength(3);
        expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
        for (let frame = 0; frame < 10; frame += 1) expect(resolveMotesMaterial(context, '#ffffff', '#aa88ff')).toBeNull();
        expect(owner.createElement).toHaveBeenCalledTimes(3);
    });

    it('returns the renderer fallback when there is no document and uses a global document when available', () => {
        vi.stubGlobal('document', undefined);
        expect(resolveMotesMaterial({ canvas: {} } as CanvasRenderingContext2D, '#ffffff', '')).toBeNull();
        const { owner } = makeOwner();
        vi.stubGlobal('document', owner);
        const material = resolveMotesMaterial({ canvas: {} } as CanvasRenderingContext2D, '#ffffff', '');
        expect(material).not.toBeNull();
        expect(owner.createElement).toHaveBeenCalledTimes(4);
    });
});
