import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_VISUALIZER_MODE,
    VISUALIZER_REGISTRY,
    appendVisualizerEntry,
    getVisualizerModeLabel,
    getVisualizerRegistryEntry,
    hasVisualizerMode,
    removeVisualizerEntry,
    type VisualizerRegistryEntry,
} from '@/components/visualizer/registry';
import { VisualizerModeGlyph } from '@/components/visualizer/modeGlyphs';

// test/unit/visualizer/registry.test.ts
// Locks the discoverable visualizer registry contract.
describe('visualizer registry', () => {
    it('auto-loads the built-in visualizer entries in stable order', () => {
        expect(VISUALIZER_REGISTRY.map(entry => entry.mode)).toEqual([
            'sonnet',
            'tempera',
            'lumiere',
            'hanabi',
            'classic',
            'cadenza',
            'partita',
            'fume',
            'tilt',
            'claddagh',
            'monet',
            'pendolo',
            'cappella',
            'diorama',
            'still',
            'motes',
        ]);
    });

    it('keeps visualizer modes unique', () => {
        const modes = VISUALIZER_REGISTRY.map(entry => entry.mode);

        expect(new Set(modes).size).toBe(modes.length);
    });

    it('recognizes registered modes and rejects unknown modes', () => {
        expect(hasVisualizerMode('classic')).toBe(true);
        expect(hasVisualizerMode('still')).toBe(true);
        expect(hasVisualizerMode('fume')).toBe(true);
        expect(hasVisualizerMode('motes')).toBe(true);
        expect(hasVisualizerMode('missing-mode')).toBe(false);
        expect(DEFAULT_VISUALIZER_MODE).toBe('classic');
    });

    it('falls back to classic for an unknown lookup', () => {
        expect(getVisualizerRegistryEntry('missing-mode').mode).toBe('classic');
    });

    it('uses label fallback when the translation key is missing', () => {
        const label = getVisualizerModeLabel('partita', key => key);

        expect(label).toBe('云阶');
    });

    // What a mod's style looks like once the loader has turned it into an entry: no icon, no command.
    const modEntry = (order: number): VisualizerRegistryEntry => ({
        mode: 'mod:test:added',
        order,
        labelKey: 'ui.modVisualizer.mod.test.added',
        labelFallback: 'Added',
        previewSeed: 'mod:test:added',
        previewStartOffset: 0,
        render: () => createElement('div'),
    });

    it('places an added style by the order it declares', () => {
        const entry = modEntry(15);

        expect(appendVisualizerEntry(entry)).toBe(true);
        const modes = VISUALIZER_REGISTRY.map(candidate => candidate.mode);
        removeVisualizerEntry(entry.mode);

        expect(modes.slice(0, 3)).toEqual(['sonnet', entry.mode, 'tempera']);
        expect(VISUALIZER_REGISTRY.map(candidate => candidate.mode)).not.toContain(entry.mode);
    });

    it('draws the generic icon for a style without one, not the default style\'s', () => {
        const glyphOf = (mode: string) => renderToStaticMarkup(createElement(VisualizerModeGlyph, { mode }));
        const entry = modEntry(500);
        const generic = glyphOf('missing-mode');

        appendVisualizerEntry(entry);
        const added = glyphOf(entry.mode);
        removeVisualizerEntry(entry.mode);

        expect(added).toBe(generic);
        expect(generic).not.toBe(glyphOf(DEFAULT_VISUALIZER_MODE));
    });
});
