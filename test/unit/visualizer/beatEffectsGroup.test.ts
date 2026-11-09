import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import BeatEffectsGroup from '@/components/visualizer/BeatEffectsGroup';
import { getVisualizerRegistryEntry } from '@/components/visualizer/registry';

// test/unit/visualizer/beatEffectsGroup.test.ts
// A mode's 智能动感模式 effects in its own settings (BeatEffectsGroup.tsx): one row per effect it
// offers, retired ones left out, the switch's notice and no strength slider while 智能动感模式 is
// off, and nothing for a mode with no effects.

const t = (key: string) => key;
const render = (mode: Parameters<typeof getVisualizerRegistryEntry>[0]) => renderToStaticMarkup(
    React.createElement(BeatEffectsGroup, { t, effects: getVisualizerRegistryEntry(mode).beatEffects }),
);

// Rendered on the server, which reads the store's initial state: 智能动感模式 off, every effect at 1.
describe('a mode\'s beat effects in its settings', () => {
    it('offers 时计 its 仿真鼓面 alone: 齿轮随拍 is retired', () => {
        const html = render('pendolo');
        expect(html).toContain('options.beatEffect_pendoloDrumhead');
        expect(html).not.toContain('options.beatEffect_pendoloGearBeats');
    });

    it('says the switch is off, and shows no strength until it is on', () => {
        const html = render('sonnet');
        expect(html).toContain('options.beatEffect_sonnetLensTear');
        expect(html).toContain('options.beatEffectsNeedSmartBeat');
        expect(html).not.toContain('options.beatEffectStrength');
    });

    it('is nothing for a mode with no effects', () => {
        expect(render('partita')).toBe('');
    });
});
