import { describe, expect, it, vi } from 'vitest';
import { buildPlaybackGraph } from '@/services/playbackGraph';
import { resolveAudioEqualizerSettings } from '@/utils/audioEqualizer';
import { AUDIO_SOUND_PRESETS } from '@/utils/audioPresets';

// test/unit/services/playbackGraph.test.ts
// Where the volume fader sits, asserted by walking the graph the app actually builds.
//
// Three of the effects are absolute rather than relative - vinyl noise is MIXED IN rather than
// applied, bit crush quantizes against full scale, punch compresses against a fixed threshold -
// so a fader upstream of them changes what they do rather than how loud they are. Measured on the
// merged graph: the crackle read -51.9 dBFS at volume 1.00, 0.50 and 0.25 alike, and there was no
// setting of the volume control that made a record sound quieter than its own surface noise.
//
// This walks edges instead of re-stating the wiring, because a test that rebuilt the same order
// would pass whatever the source did.

type FakeNode = { kind: string; connect: (target: FakeNode) => void; disconnect: () => void };

const createFakeContext = () => {
    const edges: Array<[FakeNode, FakeNode]> = [];
    const node = <T extends object>(kind: string, extra = {} as T) => {
        const self = {
            kind,
            connect: (target: FakeNode) => { edges.push([self, target]); },
            disconnect: vi.fn(),
            ...extra,
        } as FakeNode & T;
        return self;
    };
    const param = (value = 0) => ({ value, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() });

    const context = {
        sampleRate: 48_000,
        currentTime: 0,
        destination: node('destination'),
        createGain: () => node('gain', { gain: param(1), channelCount: 2, channelCountMode: 'max', channelInterpretation: 'speakers' }),
        createBiquadFilter: () => node('biquad', { type: 'peaking', frequency: param(), Q: param(), gain: param() }),
        createWaveShaper: () => node('waveshaper', { curve: null, oversample: 'none' }),
        createDelay: () => node('delay', { delayTime: param() }),
        createChannelSplitter: () => node('splitter'),
        createChannelMerger: () => node('merger'),
        createDynamicsCompressor: () => node('compressor', {
            threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
        }),
        createConvolver: () => node('convolver', { normalize: true, buffer: null }),
        createBufferSource: () => node('bufferSource', { buffer: null, loop: false, start: vi.fn(), stop: vi.fn() }),
        createOscillator: () => node('oscillator', { frequency: param(), start: vi.fn(), stop: vi.fn() }),
        createBuffer: (channels: number, length: number) => ({
            numberOfChannels: channels,
            getChannelData: () => new Float32Array(length),
        }),
        createAnalyser: () => node('analyser', { fftSize: 2048, smoothingTimeConstant: 0.6 }),
    };
    return { context, edges, isNode: (n: unknown): n is FakeNode => Boolean(n) };
};

/** Every distinct route from `from` to the destination, as arrays of nodes. */
const routesToDestination = (edges: Array<[FakeNode, FakeNode]>, from: FakeNode): FakeNode[][] => {
    const routes: FakeNode[][] = [];
    const walk = (at: FakeNode, seen: FakeNode[]) => {
        if (seen.includes(at)) return;             // a cycle cannot reach anything new
        const path = [...seen, at];
        if (at.kind === 'destination') { routes.push(path); return; }
        edges.filter(([a]) => a === at).forEach(([, b]) => walk(b, path));
    };
    walk(from, []);
    return routes;
};

const buildWith = (effectsPreset: 'lofi' | 'flat') => {
    const { context, edges } = createFakeContext();
    const analyser = context.createAnalyser();
    const settings = resolveAudioEqualizerSettings({
        enabled: true,
        effects: AUDIO_SOUND_PRESETS[effectsPreset].effects,
    });
    const graph = buildPlaybackGraph({
        context: context as unknown as AudioContext,
        analyser: analyser as unknown as AnalyserNode,
        connectDecks: () => true,
        equalizerNodesRef: { current: [] },
        settings,
    });
    return { graph, edges, analyser, context };
};

describe('buildPlaybackGraph', () => {
    it('puts the volume fader between the vinyl noise and the speakers', () => {
        const { graph, edges, context } = buildWith('lofi');
        // The looping noise buffer the vinyl branch starts - the one thing in the chain that makes
        // sound with no music playing at all.
        const noiseSource = edges.map(([a]) => a).find(n => n.kind === 'bufferSource');
        expect(noiseSource, 'lo-fi should have started the vinyl noise source').toBeDefined();

        const routes = routesToDestination(edges, noiseSource!);
        expect(routes.length).toBeGreaterThan(0);
        routes.forEach(route => {
            expect(route, 'crackle that bypasses the fader cannot be turned down').toContain(
                graph.gainNode as unknown as FakeNode,
            );
        });
        expect(context.destination).toBeDefined();
    });

    it('puts the volume fader after the bit crush, so the fader cannot change the bit depth', () => {
        const { graph, edges } = buildWith('lofi');
        const crush = edges.map(([a]) => a).find(n => n.kind === 'waveshaper');
        expect(crush).toBeDefined();
        routesToDestination(edges, crush!).forEach(route => {
            expect(route.indexOf(graph.gainNode as unknown as FakeNode)).toBeGreaterThan(route.indexOf(crush!));
        });
    });

    it('leaves the analyser downstream of the fader, so the visualiser draws what is heard', () => {
        const { graph, edges, analyser } = buildWith('flat');
        const routes = routesToDestination(edges, graph.gainNode as unknown as FakeNode);
        expect(routes.length).toBeGreaterThan(0);
        routes.forEach(route => expect(route).toContain(analyser as unknown as FakeNode));
    });

    it('reports a deck that failed to connect instead of throwing', () => {
        const { context } = createFakeContext();
        const analyser = context.createAnalyser();
        const graph = buildPlaybackGraph({
            context: context as unknown as AudioContext,
            analyser: analyser as unknown as AnalyserNode,
            connectDecks: () => false,
            equalizerNodesRef: { current: [] },
            settings: resolveAudioEqualizerSettings({ enabled: false }),
        });
        expect(graph.decksConnected).toBe(false);
        expect(graph.gainNode).toBeDefined();
    });
});
