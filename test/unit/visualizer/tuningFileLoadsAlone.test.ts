// This import comes first on purpose: the test is about what happens when a style's tuning.ts is
// the first visualizer file to load.
import pendoloTuning from '@/components/visualizer/pendolo/tuning';
import { describe, expect, it } from 'vitest';
import { getVisualizerTuningModes } from '@/components/visualizer/tuningRegistry';

// test/unit/visualizer/tuningFileLoadsAlone.test.ts
// A style's entry.tsx may import its own tuning.ts to read its tuning, so a tuning.ts has to load
// whichever visualizer file comes first.
//
// It did not while defineVisualizerTuning lived in tuningRegistry.ts: that file collects every
// tuning.ts as it loads, so a tuning.ts loaded first started the registry while itself half loaded,
// and the registry threw on the missing default export. Nothing imported a tuning.ts directly then,
// which is why the app never hit it.

describe('a tuning file loaded before the tuning registry', () => {
    it('loads, and the registry still finds it', () => {
        expect(pendoloTuning.mode).toBe('pendolo');
        expect(getVisualizerTuningModes()).toContain('pendolo');
    });
});
