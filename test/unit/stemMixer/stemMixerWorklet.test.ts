import { beforeAll, describe, expect, it } from 'vitest';

// test/unit/stemMixer/stemMixerWorklet.test.ts
// 分轨调音台的 worklet（services/stemMixer/stemMixer.worklet.ts）：四个强度都是 1.0× 时输出就是原曲；
// 人声 0 时是原曲减人声；没有分轨的地方放原曲；强度高于 1.0× 时不超满幅。在 44.1 kHz 下跑，不插值。

type Processor = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: (message: unknown) => void };
    process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
};
let Ctor: new () => Processor;

beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    g.sampleRate = 44100;
    g.currentTime = 0;
    g.AudioWorkletProcessor = class {
        port = { onmessage: null, postMessage: () => undefined };
    };
    g.registerProcessor = (_name: string, ctor: new () => Processor) => { Ctor = ctor; };
    await import('@/services/stemMixer/stemMixer.worklet');
});

const N = 8192;
const int16 = (f: (i: number) => number) => Int16Array.from({ length: N }, (_, i) => Math.round(f(i)));
const mixL = int16(i => 16000 * Math.sin(i * 0.05));
const mixR = int16(i => 16000 * Math.cos(i * 0.03));
// Stems at ±2 full scale: each a share of the mix (in mix units, half the stem units).
const share = (mix: Int16Array, k: number) => Int16Array.from(mix, v => Math.round((v * k) / 2));
const stems = [share(mixL, 0.4), share(mixR, 0.4), share(mixL, 0.3), share(mixR, 0.3), share(mixL, 0.1), share(mixR, 0.1)];

/** Loads, plays from 0 and renders `quanta` quanta; answers the left and right channels. */
const render = (gains: number[], { withStems = true, quanta = 6, at = 0 } = {}) => {
    const g = globalThis as Record<string, unknown>;
    g.currentTime = 0;
    const p = new Ctor();
    const send = (data: unknown) => p.port.onmessage?.({ data });
    send({ type: 'load', total: N, mixL: mixL.slice(), mixR: mixR.slice() });
    if (withStems) send({ type: 'stems', from: 0, to: N, data: stems.map(s => s.slice()) });
    send({ type: 'gains', gains });
    send({ type: 'play', position: 0, at, speed: 1, seq: 1 });
    const L: number[] = [];
    const R: number[] = [];
    for (let q = 0; q < quanta; q += 1) {
        const out = [new Float32Array(128), new Float32Array(128)];
        p.process([], [out]);
        g.currentTime = (g.currentTime as number) + 128 / 44100;
        L.push(...out[0]);
        R.push(...out[1]);
    }
    return { L, R };
};

describe('stem mixer worklet', () => {
    it('plays the original exactly with every gain at 1.0x, once faded in', () => {
        const { L, R } = render([1, 1, 1, 1]);
        // 4 ms fade-in (177 samples) and the 5 ms blend to the stems: from 256 on both are done.
        for (let i = 256; i < L.length; i += 1) {
            expect(L[i]).toBeCloseTo(mixL[i] / 32767, 6);
            expect(R[i]).toBeCloseTo(mixR[i] / 32767, 6);
        }
    });

    it('takes the voice out with vocals at 0', () => {
        // The gains move over ~15 ms (661 samples); by 6000 they are there.
        const { L } = render([1, 1, 1, 0], { quanta: 64 });
        for (const i of [6000, 7000, 8000]) expect(L[i]).toBeCloseTo((mixL[i] - 2 * stems[4][i]) / 32767, 4);
    });

    it('plays the original where there are no stems yet', () => {
        const { L } = render([0, 0, 0, 0], { withStems: false });
        for (let i = 256; i < L.length; i += 1) expect(L[i]).toBeCloseTo(mixL[i] / 32767, 6);
    });

    it('starts when the start falls on the end of a quantum, and keeps going', () => {
        const { L } = render([1, 1, 1, 1], { at: 128 / 44100 });
        // Silent through the first quantum, then the original from sample 0 on, a quantum late.
        expect(L.slice(0, 128).every(v => v === 0)).toBe(true);
        for (let i = 512; i < L.length; i += 1) expect(L[i]).toBeCloseTo(mixL[i - 128] / 32767, 6);
    });

    it('stays inside full scale with the gains raised', () => {
        const { L, R } = render([2, 2, 2, 2]);
        expect(Math.max(...L.map(Math.abs), ...R.map(Math.abs))).toBeLessThan(1);
    });
});
