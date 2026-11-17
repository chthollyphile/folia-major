import { beforeAll, describe, expect, it } from 'vitest';

// test/unit/stemMixer/stemMixerWorklet.test.ts
// 分轨调音台的 worklet（services/stemMixer/stemMixer.worklet.ts）：输入就是元素的声音。四个强度都是 1.0×、
// 没有块的地方都原样透传；人声 0 时是原曲减人声；走出有块的地方之前就交叉回输入、换歌和跳转都经输入交叉，
// 不跳变、不留空白；强度高于 1.0× 时不超满幅。在 44.1 kHz 下跑，不插值。

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
/** 元素的声音（浮点），块里按 ±2 满幅存成 Int16。 */
const fL = (i: number) => 0.5 * Math.sin(i * 0.05);
const fR = (i: number) => 0.5 * Math.cos(i * 0.03);
const store = (f: (i: number) => number, k = 1, from = 0, to = N) => Int16Array.from({ length: to - from }, (_, i) => Math.round(f(from + i) * k * (32767 / 2)));
/** 鼓 0.4、贝斯 0.3、人声 0.1 的份额（其他 0.2）。 */
const chunk = (from = 0, to = N) => ({ from, to, data: [1, 0.4, 0.3, 0.1].flatMap(k => [store(fL, k, from, to), store(fR, k, from, to)]) });

interface Run { L: number[]; R: number[]; inL: number[]; send: (data: unknown) => void; step: (quanta: number) => void }

/** 一个 processor，元素从第 0 个采样起放（`media(q)` 答第 q 个 quantum 元素在哪；默认跟着走）。 */
const start = (gains: number[], { chunks = [chunk()], media = (q: number) => q * 128 } = {}): Run => {
    const g = globalThis as Record<string, unknown>;
    g.currentTime = 0;
    const p = new Ctor();
    const send = (data: unknown) => p.port.onmessage?.({ data });
    send({ type: 'load', gen: 1 });
    for (const each of chunks) send({ type: 'chunk', gen: 1, ...each });
    send({ type: 'gains', gains });
    send({ type: 'play', position: 0, at: 0, speed: 1, seq: 1 });
    const run: Run = { L: [], R: [], inL: [], send, step: () => undefined };
    let q = 0;
    run.step = (quanta) => {
        for (let n = 0; n < quanta; n += 1, q += 1) {
            const at = media(q);
            const inL = Float32Array.from({ length: 128 }, (_, i) => fL(at + i));
            const inR = Float32Array.from({ length: 128 }, (_, i) => fR(at + i));
            const out = [new Float32Array(128), new Float32Array(128)];
            p.process([[inL, inR]], [out]);
            g.currentTime = (g.currentTime as number) + 128 / 44100;
            run.L.push(...out[0]);
            run.R.push(...out[1]);
            run.inL.push(...inL);
        }
    };
    return run;
};

/** 相邻两个采样之差的最大值：fL 本身最多差 0.025。 */
const maxStep = (xs: number[]) => xs.slice(1).reduce((m, v, i) => Math.max(m, Math.abs(v - xs[i])), 0);

describe('stem mixer worklet', () => {
    it('passes the input through untouched with every gain at 1.0x', () => {
        const run = start([1, 1, 1, 1]);
        run.step(20);
        run.L.forEach((v, i) => expect(v).toBe(run.inL[i]));
    });

    it('takes the voice out with vocals at 0', () => {
        // The gains move over ~15 ms (661 samples); by 6000 they are there.
        const run = start([1, 1, 1, 0]);
        run.step(60);
        for (const i of [6000, 7000, 7500]) expect(run.L[i]).toBeCloseTo(0.9 * fL(i), 4);
    });

    it('passes the input through where there are no chunks', () => {
        const run = start([0, 0, 0, 0], { chunks: [] });
        run.step(20);
        run.L.forEach((v, i) => expect(v).toBe(run.inL[i]));
    });

    it('is back on the input before it walks out of the chunks', () => {
        const run = start([1, 1, 1, 0], { chunks: [chunk(0, 4096)] });
        run.step(48);
        expect(run.L[3000]).toBeCloseTo(0.9 * fL(3000), 3);
        for (let i = 4096; i < run.L.length; i += 1) expect(run.L[i]).toBe(run.inL[i]);
        expect(maxStep(run.L)).toBeLessThan(0.03);
    });

    it('fades back to the input on a new song instead of cutting', () => {
        const run = start([1, 1, 1, 0]);
        run.step(30);
        run.send({ type: 'load', gen: 2 });
        run.step(10);
        expect(maxStep(run.L)).toBeLessThan(0.03);
        // 5 ms (221 samples) later it is the input.
        for (let i = 30 * 128 + 256; i < run.L.length; i += 1) expect(run.L[i]).toBe(run.inL[i]);
    });

    it('crosses through the input on a jump, with no gap', () => {
        // The element jumps from 3840 to 1000 at quantum 30; the worklet is told so a quantum on.
        const media = (q: number) => (q < 30 ? q * 128 : 1000 + (q - 30) * 128);
        const run = start([1, 1, 1, 0], { media });
        run.step(30);
        run.send({ type: 'play', position: 1000 + 128, at: 31 * 128 / 44100, speed: 1, seq: 2 });
        run.step(30);
        expect(run.L.slice(30 * 128).every((v, i) => Math.abs(v) > 0 || Math.abs(run.inL[30 * 128 + i]) < 1e-3)).toBe(true);
        // Back on the stems at the new place.
        const i = 50 * 128;
        expect(run.L[i]).toBeCloseTo(0.9 * fL(media(50)), 4);
    });

    it('keeps what it is fading out of when told to drop it mid-jump', () => {
        // The element jumps to 6000 at quantum 30; stop, the far play and the keep all land at once.
        const media = (q: number) => (q < 30 ? q * 128 : 6000 + (q - 30) * 128);
        const run = start([1, 1, 1, 0], { chunks: [chunk(0, 4096), chunk(4096, N)], media });
        run.step(30);
        run.send({ type: 'stop' });
        run.send({ type: 'play', position: 6000 + 128, at: 31 * 128 / 44100, speed: 1, seq: 2 });
        run.send({ type: 'keep', from: 4096, to: N });
        run.step(15);
        expect(maxStep(run.L)).toBeLessThan(0.03);
        expect(run.L[42 * 128]).toBeCloseTo(0.9 * fL(media(42)), 4);
    });

    it('stays inside full scale with the gains raised', () => {
        const run = start([2, 2, 2, 2]);
        run.step(20);
        expect(Math.max(...run.L.map(Math.abs), ...run.R.map(Math.abs))).toBeLessThan(1);
    });
});
