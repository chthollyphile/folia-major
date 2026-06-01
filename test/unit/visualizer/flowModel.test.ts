import { describe, expect, it } from 'vitest';
import { createDefaultVisualizerComplex } from '@/components/visualizer/complex';
import { addComplexNode, connectFlowNodes, layoutComplexNodes, reconnectFlowEdge, removeComplexEdge, toLayerFlowEdges, toLayerFlowNodes, updateComplexNodePosition } from '@/components/visEditor/flowModel';

// test/unit/visualizer/flowModel.test.ts
// Covers persisted graph edits projected from the React Flow editor.
describe('visEditor flow model', () => {
    it('adds visual nodes with a unique id and output edge', () => {
        const complex = createDefaultVisualizerComplex();
        const result = addComplexNode(complex, {
            role: 'visualizerMain',
            mode: 'fume',
            label: 'Fume',
        });

        expect(result.nodeId).toBe('main-fume');
        expect(result.complex.output.mainNodeIds).toContain('main-fume');
        expect(result.complex.edges).toContainEqual({
            id: 'main-fume-layer-visual-output-player-output-visualLayer',
            source: 'main-fume',
            sourceHandle: 'layer.visual',
            target: 'output-player',
            targetHandle: 'output.visualLayer',
        });
    });

    it('adds nodes at an explicit flow position', () => {
        const complex = createDefaultVisualizerComplex();
        const result = addComplexNode(complex, {
            role: 'visualizerBg',
            kind: 'vignette',
            label: '暗角',
            position: { x: 480, y: 260 },
        });

        const node = result.complex.nodes.find(node => node.id === result.nodeId);
        expect(node?.position).toEqual({ x: 480, y: 260 });
    });

    it('removes a selected persisted edge', () => {
        const complex = createDefaultVisualizerComplex();
        const next = removeComplexEdge(complex, 'main-output');

        expect(next.edges.some(edge => edge.id === 'main-output')).toBe(false);
        expect(next.output.mainNodeIds).toEqual([]);
    });

    it('updates one node position without changing graph edges', () => {
        const complex = createDefaultVisualizerComplex();
        const next = updateComplexNodePosition(complex, 'main-classic', { x: 700, y: 220 });

        expect(next.nodes.find(node => node.id === 'main-classic')?.position).toEqual({ x: 700, y: 220 });
        expect(next.edges).toEqual(complex.edges);
    });

    it('allows only matching v2 typed ports', () => {
        const complex = createDefaultVisualizerComplex();
        const allowed = connectFlowNodes(complex, {
            source: 'input-theme',
            sourceHandle: 'theme.accentColor',
            target: 'main-classic',
            targetHandle: 'theme.primaryColor',
        });
        const rejected = connectFlowNodes(complex, {
            source: 'input-song',
            sourceHandle: 'song.title',
            target: 'bg-solid',
            targetHandle: 'theme.backgroundColor',
        });

        expect(allowed.edges).toHaveLength(complex.edges.length + 1);
        expect(allowed.edges.at(-1)).toMatchObject({
            sourceHandle: 'theme.accentColor',
            targetHandle: 'theme.primaryColor',
        });
        expect(rejected.edges).toHaveLength(complex.edges.length);
    });

    it('reconnects output edges and updates the render stack', () => {
        const complex = createDefaultVisualizerComplex();
        const withFume = addComplexNode(complex, {
            role: 'visualizerMain',
            mode: 'fume',
            label: 'Fume',
        }).complex;
        const next = reconnectFlowEdge(
            withFume,
            { id: 'main-output', source: 'main-classic', sourceHandle: 'layer.visual', target: 'output-player', targetHandle: 'output.visualLayer' },
            { source: 'main-fume', sourceHandle: 'layer.visual', target: 'output-player', targetHandle: 'output.visualLayer' },
        );

        expect(next.edges.some(edge => edge.source === 'main-classic' && edge.target === 'output-player')).toBe(false);
        expect(next.output.mainNodeIds).toEqual(['main-fume']);
    });

    it('auto-layouts nodes without changing edges', () => {
        const complex = createDefaultVisualizerComplex();
        const next = layoutComplexNodes(complex);

        expect(next.edges).toEqual(complex.edges);
        expect(next.nodes.find(node => node.id === 'input-theme')?.position).toEqual({ x: 40, y: 42 });
        expect(next.nodes.find(node => node.id === 'output-player')?.position.x).toBe(850);
    });

    it('filters graph nodes and edges by editor layer view', () => {
        const complex = createDefaultVisualizerComplex();
        const backgroundNodeIds = toLayerFlowNodes(complex, 'background').map(node => node.id);
        const lyricsNodeIds = toLayerFlowNodes(complex, 'lyrics').map(node => node.id);
        const overlayNodeIds = toLayerFlowNodes(complex, 'overlay').map(node => node.id);

        expect(backgroundNodeIds).toContain('input-song');
        expect(lyricsNodeIds).toContain('input-song');
        expect(overlayNodeIds).toContain('input-song');
        expect(backgroundNodeIds).toContain('bg-geometric');
        expect(backgroundNodeIds).not.toContain('main-classic');
        expect(lyricsNodeIds).toContain('main-classic');
        expect(lyricsNodeIds).not.toContain('overlay-subtitle');
        expect(overlayNodeIds).toContain('overlay-subtitle');
        expect(overlayNodeIds).not.toContain('bg-solid');
        expect(toLayerFlowEdges(complex, 'lyrics').every(edge => lyricsNodeIds.includes(edge.source) && lyricsNodeIds.includes(edge.target))).toBe(true);
    });
});
