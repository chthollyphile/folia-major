import { describe, expect, it } from 'vitest';
import { createBalanceMeter, onPlayWrapped } from '@/services/volumeBalance/balanceMeter';
import { whyNotWholePlay } from '@/services/volumeBalance/balanceRules';

// test/unit/volumeBalance/balanceMeter.test.ts
// The meter's clock: heard time and the span of a play come from the media, and a loop is a new play.

const RATE = 8000;

const fakeNode = () => ({ connect: (next?: unknown) => next, gain: { value: 1 } });
const fakeContext = () => ({
    sampleRate: RATE,
    createGain: fakeNode,
    createChannelSplitter: fakeNode,
    createAnalyser: () => ({
        ...fakeNode(),
        fftSize: 0,
        smoothingTimeConstant: 0,
        // A steady 1 kHz tone well over the gates.
        getFloatTimeDomainData: (buffer: Float32Array) => buffer.forEach((_, index) => { buffer[index] = 0.1 * Math.sin(index * Math.PI / 4); }),
    }),
}) as unknown as AudioContext;

const fakeElement = (duration: number) => {
    const listeners = new Map<string, Array<() => void>>();
    return {
        duration,
        currentTime: 0,
        paused: false,
        addEventListener: (type: string, listener: () => void) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
        fire: (type: string) => listeners.get(type)?.forEach(listener => listener()),
    };
};

const setup = (duration: number) => {
    const element = fakeElement(duration);
    const node = fakeNode() as unknown as AudioNode;
    const meter = createBalanceMeter(fakeContext(), node, node, element as unknown as HTMLAudioElement);
    let clock = 0;
    /** Plays `seconds` of wall time in 25 ms ticks, the media moving `rate` times as fast. */
    const run = (seconds: number, rate = 1) => {
        for (let tick = 0; tick < Math.round(seconds / 0.025); tick += 1) {
            clock += 0.025;
            if (!element.paused) element.currentTime = Math.min(element.duration, element.currentTime + 0.025 * rate);
            meter.tick(clock);
        }
    };
    meter.tick(clock);
    return { element, meter, run };
};

describe('volume balance meter', () => {
    it('counts media time: a stall and a bent tempo do not make a whole play partial (F4)', () => {
        const { meter, run } = setup(60);
        run(20);
        run(3, 0);
        run(20, 1.05);
        run(19);
        const play = meter.play()!;
        expect(play.heardSec).toBeCloseTo(60, 1);
        expect(play.fromSec).toBe(0);
        expect(play.toSec).toBeCloseTo(60, 6);
        expect(whyNotWholePlay(play, { duration: 60 })).toBeNull();
    });

    it('takes a blend entered past the silence as whole, and a seek after it sounded as broken (F5)', () => {
        const entered = setup(60);
        entered.element.paused = true;
        entered.element.currentTime = 4.2;
        entered.element.fire('seeking');
        entered.run(0.1);
        entered.element.paused = false;
        entered.run(54.3);
        const play = entered.meter.play()!;
        expect(play.fromSec).toBeCloseTo(4.2, 6);
        expect(whyNotWholePlay(play, { duration: 60, leadInSec: 3 })).toBeNull();
        expect(whyNotWholePlay(play, { duration: 60, leadInSec: 1 })).toBe('started at 4.2s');

        const sought = setup(60);
        sought.run(10);
        sought.element.currentTime = 30;
        sought.element.fire('seeking');
        sought.run(30);
        expect(sought.meter.play()!.broken).toBe('seek');
    });

    it('ends a play when a loop comes round and starts the next one anew (F3)', () => {
        const { element, meter, run } = setup(30);
        const ended: number[] = [];
        const off = onPlayWrapped((from, play) => {
            if (from === meter) ended.push(play.toSec);
        });
        run(30);
        element.currentTime = 0;
        element.fire('seeking');
        off();
        expect(ended).toHaveLength(1);
        expect(ended[0]).toBeCloseTo(30, 6);
        expect(meter.wraps()).toBe(1);
        expect(meter.plays()).toBe(1);
        expect(meter.play()).toBeNull();
        run(5);
        expect(meter.play()).toMatchObject({ broken: null, fromSec: 0 });
        expect(meter.heardSec()).toBeCloseTo(5, 6);
    });
});
