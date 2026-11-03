import { describe, expect, it } from 'vitest';
import type { Theme } from '@/types';
import { buildFumeBackgroundScene, drawFumeBackground } from '@/components/visualizer/fume/FumeBackground';

// test/unit/visualizer/fumeBackgroundGradients.test.ts
// fume's background keeps each shape's two line gradients between frames. Lock what makes a kept
// gradient stale: the context, the two theme colours and the opacity setting. A stale one would
// keep the old colours on screen after a theme change, which no frame-to-frame check shows.

const createContext = () => {
    const calls = { gradients: 0, paths: 0, strokes: 0 };
    const context = {
        calls,
        save() {}, restore() {}, translate() {}, rotate() {},
        beginPath() { calls.paths += 1; },
        ellipse() {}, rect() {}, moveTo() {}, lineTo() {}, closePath() {},
        stroke() { calls.strokes += 1; },
        createLinearGradient() {
            calls.gradients += 1;
            return { addColorStop() {} };
        },
    };
    return context as unknown as CanvasRenderingContext2D & { calls: typeof calls };
};

const theme = (accentColor: string) => ({ secondaryColor: '#335577', accentColor }) as Theme;
const scene = buildFumeBackgroundScene({ viewport: { width: 1920, height: 1080 }, world: { width: 2400, height: 1400 }, seed: 'test' });
const lineShapes = scene.shapes.filter(shape => shape.kind !== 'spark').length;

describe('fume background gradients', () => {
    it('makes two gradients per line shape once, and builds each path once a frame', () => {
        const context = createContext();
        drawFumeBackground({ context, scene, theme: theme('#ffaa00'), time: 1 });
        expect(lineShapes).toBeGreaterThan(0);
        expect(context.calls.gradients).toBe(lineShapes * 2);
        expect(context.calls.paths).toBe(scene.shapes.length);
        expect(context.calls.strokes).toBe(scene.shapes.length + lineShapes);

        drawFumeBackground({ context, scene, theme: theme('#ffaa00'), time: 2 });
        expect(context.calls.gradients).toBe(lineShapes * 2);
        expect(context.calls.paths).toBe(scene.shapes.length * 2);
    });

    it('makes them again for another colour, opacity or context', () => {
        const context = createContext();
        drawFumeBackground({ context, scene, theme: theme('#ffaa00') });
        drawFumeBackground({ context, scene, theme: theme('#00aaff') });
        expect(context.calls.gradients).toBe(lineShapes * 4);
        drawFumeBackground({ context, scene, theme: theme('#00aaff'), objectOpacityMultiplier: 0.5 });
        expect(context.calls.gradients).toBe(lineShapes * 6);

        const other = createContext();
        drawFumeBackground({ context: other, scene, theme: theme('#00aaff'), objectOpacityMultiplier: 0.5 });
        expect(other.calls.gradients).toBe(lineShapes * 2);
    });
});
