import { describe, expect, it } from 'vitest';
import {
    dropLeavingMonetPortraitLayers,
    endMonetPortraitHandoff,
    MONET_PORTRAIT_MAX_LAYERS,
    monetPortraitTargetSource,
    pushMonetPortraitLayer,
    settleMonetPortraitLayers,
    type MonetPortraitLayer,
} from '@/components/visualizer/monet/monetPortraitCrossfade';

// test/unit/visualizer/monetPortraitCrossfade.test.ts
// The property the Monet cover crossfade rests on: a layer is only ever removed once something
// fully opaque is covering it. Break that and the frame flashes at a track change, which is the
// bug the stack replaced.

const stack = (...sources: string[]): MonetPortraitLayer[] => sources.reduce<MonetPortraitLayer[]>(
    (layers, src, index) => pushMonetPortraitLayer(layers, src, `k${index}`),
    [],
);

describe('Monet portrait crossfade stack', () => {
    it('keeps the cover on screen underneath the one fading in', () => {
        const layers = stack('a.jpg', 'b.jpg');
        expect(layers.map(layer => layer.src)).toEqual(['a.jpg', 'b.jpg']);
        expect(monetPortraitTargetSource(layers)).toBe('b.jpg');
    });

    it('ignores a URL that resolves to the cover already being faded in', () => {
        const layers = stack('a.jpg', 'b.jpg');
        expect(pushMonetPortraitLayer(layers, 'b.jpg', 'k9')).toBe(layers);
    });

    it('fades back to a cover that comes round again', () => {
        const layers = stack('a.jpg', 'b.jpg', 'a.jpg');
        expect(layers.map(layer => layer.src)).toEqual(['a.jpg', 'b.jpg', 'a.jpg']);
    });

    it('drops the whole stack at once when the top layer settles', () => {
        const layers = stack('a.jpg', 'b.jpg', 'c.jpg');
        const settled = settleMonetPortraitLayers(layers, layers[layers.length - 1].key);
        expect(settled.map(layer => layer.src)).toEqual(['c.jpg']);
    });

    it('leaves the stack alone for a layer that is already the bottom or gone', () => {
        const layers = stack('a.jpg', 'b.jpg');
        expect(settleMonetPortraitLayers(layers, layers[0].key)).toBe(layers);
        expect(settleMonetPortraitLayers(layers, 'never-stacked')).toBe(layers);
    });

    it('caps the stack while holding skip down, keeping the newest covers', () => {
        const sources = Array.from({ length: MONET_PORTRAIT_MAX_LAYERS + 3 }, (_, index) => `${index}.jpg`);
        const layers = stack(...sources);
        expect(layers).toHaveLength(MONET_PORTRAIT_MAX_LAYERS);
        expect(monetPortraitTargetSource(layers)).toBe(sources[sources.length - 1]);
    });

    it('reports nothing to fade towards while no cover has decoded', () => {
        expect(monetPortraitTargetSource([])).toBeNull();
    });
});

describe('Monet portrait crossfade along a blend hand-off', () => {
    // Seen in the app: the incoming cover decoded twice at the start of a blend (two addresses), and
    // the first copy, no longer the one following the blend, faded in over 900 ms instead.
    it('lets a second address of the cover take the place of the one fading along the hand-off', () => {
        const fading = pushMonetPortraitLayer(stack('a.jpg'), 'b-net.jpg', 'k1', 0.1);
        const layers = pushMonetPortraitLayer(fading, 'b-cache.jpg', 'k2', 0.4);
        expect(layers).toEqual([{ key: 'k0', src: 'a.jpg' }, { key: 'k2', src: 'b-cache.jpg', handoffFrom: 0.1 }]);
    });

    it('stacks a cover over one fading on the clock when the hand-off begins', () => {
        const layers = pushMonetPortraitLayer(stack('a.jpg', 'b.jpg'), 'c.jpg', 'k9', 0);
        expect(layers.map(layer => layer.handoffFrom)).toEqual([undefined, undefined, 0]);
    });

    it('keeps the cover fading along the hand-off when its address comes again', () => {
        const layers = pushMonetPortraitLayer(stack('a.jpg'), 'b.jpg', 'k1', 0.2);
        expect(pushMonetPortraitLayer(layers, 'b.jpg', 'k2', 0.5)).toBe(layers);
    });

    it('ties no cover to the hand-off once it is over', () => {
        const layers = endMonetPortraitHandoff(pushMonetPortraitLayer(stack('a.jpg'), 'b.jpg', 'k1', 0.2));
        expect(layers).toEqual([{ key: 'k0', src: 'a.jpg' }, { key: 'k1', src: 'b.jpg' }]);
        expect(endMonetPortraitHandoff(layers)).toBe(layers);
    });

    it('fades the incoming cover back out when a cancel asks for the one beneath again', () => {
        // Faded on in, it would brighten for a moment and then be covered by the outgoing cover
        // stacked over it again: a flash at every cancelled blend.
        const handingOff = pushMonetPortraitLayer(stack('a.jpg'), 'b.jpg', 'k1', 0.2);
        const cancelled = endMonetPortraitHandoff(handingOff, 'a.jpg');
        expect(cancelled).toEqual([{ key: 'k0', src: 'a.jpg' }, { key: 'k1', src: 'b.jpg', leaving: true }]);
        expect(monetPortraitTargetSource(cancelled)).toBe('a.jpg');
        expect(pushMonetPortraitLayer(cancelled, 'a.jpg', 'k2')).toBe(cancelled);
        expect(dropLeavingMonetPortraitLayers(cancelled)).toEqual([{ key: 'k0', src: 'a.jpg' }]);
        // A settle onto another address of the incoming cover goes on fading it in.
        expect(endMonetPortraitHandoff(handingOff, 'b-cache.jpg')).toEqual([{ key: 'k0', src: 'a.jpg' }, { key: 'k1', src: 'b.jpg' }]);
    });
});
