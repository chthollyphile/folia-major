import { motionValue } from 'framer-motion';
import { describe, expect, it } from 'vitest';
import { createDefaultVisualizerComplex } from '@/components/visualizer/complex';
import { createTranslationLines, resolveVisualizerNodeProps, type VisualizerComplexBaseInputs } from '@/components/visualizer/complexRuntime';

// test/unit/visualizer/complexRuntime.test.ts
// Verifies typed visEditor ports become real node-local renderer inputs.
const createBaseInputs = (): VisualizerComplexBaseInputs => {
    const currentTime = motionValue(0);
    const audioPower = motionValue(0.4);
    const band = motionValue(0.2);

    return {
        currentTime,
        currentLineIndex: 0,
        lines: [
            {
                startTime: 1,
                endTime: 3,
                fullText: 'hello',
                translation: '你好',
                words: [{ text: 'hello', startTime: 1, endTime: 3 }],
            },
            {
                startTime: 4,
                endTime: 6,
                fullText: 'world',
                words: [{ text: 'world', startTime: 4, endTime: 6 }],
            },
        ],
        theme: {
            name: 'Test',
            backgroundColor: '#000000',
            primaryColor: '#ffffff',
            accentColor: '#ff0000',
            secondaryColor: '#888888',
            fontStyle: 'sans',
            animationIntensity: 'normal',
        },
        audioPower,
        audioBands: {
            bass: band,
            lowMid: band,
            mid: band,
            vocal: band,
            treble: band,
        },
        showText: true,
        songTitle: 'Song A',
        coverUrl: 'cover-a.jpg',
    };
};

describe('visualizer complex runtime', () => {
    it('derives translation lines with original timing and fallback text', () => {
        const lines = createTranslationLines(createBaseInputs().lines);

        expect(lines[0]?.fullText).toBe('你好');
        expect(lines[0]?.translation).toBe('你好');
        expect(lines[0]?.startTime).toBe(1);
        expect(lines[0]?.endTime).toBe(3);
        expect(lines[1]?.fullText).toBe('world');
    });

    it('overrides one node theme without mutating base inputs', () => {
        const complex = {
            ...createDefaultVisualizerComplex(),
            edges: [
                ...createDefaultVisualizerComplex().edges,
                { id: 'accent-to-main-primary', source: 'input-theme', sourceHandle: 'theme.accentColor', target: 'main-classic', targetHandle: 'theme.primaryColor' },
            ],
        };
        const baseInputs = createBaseInputs();
        const mainNode = complex.nodes.find(node => node.id === 'main-classic');
        if (!mainNode) throw new Error('missing main node');

        const props = resolveVisualizerNodeProps(complex, mainNode, baseInputs);

        expect(props.theme.primaryColor).toBe('#ff0000');
        expect(props.theme.accentColor).toBe('#ff0000');
        expect(baseInputs.theme.primaryColor).toBe('#ffffff');
    });

    it('uses translation lines when connected to the lyrics target port', () => {
        const complex = createDefaultVisualizerComplex();
        const overlayNode = complex.nodes.find(node => node.id === 'overlay-subtitle');
        if (!overlayNode) throw new Error('missing overlay node');

        const props = resolveVisualizerNodeProps(complex, overlayNode, createBaseInputs());

        expect(props.lines[0]?.fullText).toBe('你好');
        expect(props.lines[1]?.fullText).toBe('world');
    });
});
