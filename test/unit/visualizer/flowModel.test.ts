import { describe, expect, it } from 'vitest';
import { createDefaultVisualizerComplex } from '@/components/visualizer/complex';
import { addComplexNode, connectFlowNodes, layoutComplexNodes, reconnectFlowEdge, removeComplexEdge, updateComplexNodePosition } from '@/components/visEditor/flowModel';

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
            id: 'main-fume-output-player',
            source: 'main-fume',
            target: 'output-player',
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

    it('allows only v1 graph connection directions', () => {
        const complex = createDefaultVisualizerComplex();
        const allowed = connectFlowNodes(complex, { source: 'input-song', target: 'bg-solid' });
        const rejected = connectFlowNodes(complex, { source: 'main-classic', target: 'bg-solid' });

        expect(allowed.edges).toHaveLength(complex.edges.length + 1);
        expect(allowed.output.bgNodeIds).toEqual(['bg-solid', 'bg-geometric', 'bg-vignette']);
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
            { id: 'main-output', source: 'main-classic', target: 'output-player' },
            { source: 'main-fume', target: 'output-player' },
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
});
