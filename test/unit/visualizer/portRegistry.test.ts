import { describe, expect, it } from 'vitest';
import { createDefaultVisualizerComplex } from '@/components/visualizer/complex';
import { canConnectPorts, getNodeSourcePorts, getNodeTargetPorts } from '@/components/visualizer/portRegistry';

// test/unit/visualizer/portRegistry.test.ts
// Locks typed visEditor ports so UI handles and runtime bindings stay compatible.
describe('visualizer port registry', () => {
    it('keeps source and target port ids unique per node', () => {
        const complex = createDefaultVisualizerComplex();

        complex.nodes.forEach(node => {
            const sourceIds = getNodeSourcePorts(node).map(port => port.id);
            const targetIds = getNodeTargetPorts(node).map(port => port.id);

            expect(new Set(sourceIds).size).toBe(sourceIds.length);
            expect(new Set(targetIds).size).toBe(targetIds.length);
        });
    });

    it('matches compatible types and rejects incompatible ports', () => {
        const complex = createDefaultVisualizerComplex();
        const themeInput = complex.nodes.find(node => node.id === 'input-theme');
        const lyricsInput = complex.nodes.find(node => node.id === 'input-lyrics');
        const mainNode = complex.nodes.find(node => node.id === 'main-classic');

        expect(canConnectPorts(themeInput, 'theme.accentColor', mainNode, 'theme.primaryColor')).toBe(true);
        expect(canConnectPorts(lyricsInput, 'lyrics.translationLines', mainNode, 'lyrics.lines')).toBe(true);
        expect(canConnectPorts(themeInput, 'theme.accentColor', mainNode, 'lyrics.lines')).toBe(false);
    });
});
