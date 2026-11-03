import { describe, expect, it } from 'vitest';
import { BUILTIN_VISUALIZER_MODES } from '@/types/visualizerModes';
import { normalizeRandomVisualizerModes, pickRandomVisualizerMode } from '@/utils/randomVisualizerModes';

// The random pool accepts built-ins only and never becomes empty or repeats an avoidable choice.
describe('random visualizer pool', () => {
    it.each([undefined, null, [], {}, 'classic', ['unknown', 'mod:test:style']])('defaults an unusable pool to all built-ins: %j', value => {
        expect(normalizeRandomVisualizerModes(value)).toEqual(BUILTIN_VISUALIZER_MODES);
    });

    it('removes unknown modes, mod modes and duplicates without weighting repeated ids', () => {
        expect(normalizeRandomVisualizerModes(['tilt', 'classic', 'tilt', 'mod:test:style', 123]))
            .toEqual(['classic', 'tilt']);
    });

    it('picks only selected styles, with no consecutive repeat when alternatives exist', () => {
        for (const current of ['classic', 'sonnet', 'tilt', 'monet']) {
            for (const value of [0, 0.25, 0.5, 0.999999]) {
                const next = pickRandomVisualizerMode(['sonnet', 'tilt'], current, () => value);
                expect(['sonnet', 'tilt']).toContain(next);
                expect(next).not.toBe(current);
            }
        }
    });

    it('keeps the sole selected style, even when it is already current', () => {
        expect(pickRandomVisualizerMode(['still'], 'still')).toBe('still');
        expect(pickRandomVisualizerMode(['still'], 'classic')).toBe('still');
    });

    it('gives every built-in a chance with all selected', () => {
        const sampled = BUILTIN_VISUALIZER_MODES.map((_, index) => (
            pickRandomVisualizerMode(BUILTIN_VISUALIZER_MODES, 'mod:current', () => index / BUILTIN_VISUALIZER_MODES.length)
        ));
        expect(sampled).toEqual(BUILTIN_VISUALIZER_MODES);
    });
});
