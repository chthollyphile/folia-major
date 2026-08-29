import { vi } from 'vitest';
import type { AutomixDeckChain } from '@/services/automix/crossfadeGraph';

// test/unit/automix/fakeAudioGraph.ts
// Just enough of Web Audio to record what the automix code asks the audio clock to do. Recording
// the automation events rather than the resulting samples is the point: the thing worth asserting
// is the shape of the schedule, which is what a real engine would then render.

export type GainEvent =
    | { type: 'cancel'; time: number }
    | { type: 'set'; time: number; value: number }
    | { type: 'ramp'; time: number; value: number }
    | { type: 'exp'; time: number; value: number }
    | { type: 'curve'; time: number; duration: number; curve: Float32Array };

export interface FakeGainNode {
    gain: AudioParam;
    events: GainEvent[];
}

export const createFakeGainNode = (): FakeGainNode => {
    const events: GainEvent[] = [];
    let value = 1;
    // The one engine rule this recorder has to enforce rather than record: no automation may land
    // inside a running setValueCurveAtTime. A real AudioParam throws, the whole schedule around it
    // is abandoned, and a double that quietly accepts it cannot see the difference between a blend
    // that works and one the engine will refuse. It let a real bug through, so it is modelled here.
    // Chrome's own bound: [start, start + duration) is closed at the start and open at the end.
    let curve: { start: number; end: number } | null = null;
    const guard = (what: string, time: number) => {
        if (curve && time >= curve.start && time < curve.end) {
            throw new Error(
                `${what}(${time}) overlaps setValueCurveAtTime(..., ${curve.start}, ${curve.end - curve.start})`,
            );
        }
    };

    const gain = {
        get value() { return value; },
        set value(next: number) { value = next; },
        cancelScheduledValues: (time: number) => {
            if (curve && curve.start >= time) curve = null;
            events.push({ type: 'cancel', time });
        },
        setValueAtTime: (next: number, time: number) => {
            guard('setValueAtTime', time);
            value = next;
            events.push({ type: 'set', time, value: next });
        },
        linearRampToValueAtTime: (next: number, time: number) => {
            guard('linearRampToValueAtTime', time);
            events.push({ type: 'ramp', time, value: next });
        },
        exponentialRampToValueAtTime: (next: number, time: number) => {
            guard('exponentialRampToValueAtTime', time);
            events.push({ type: 'exp', time, value: next });
        },
        setValueCurveAtTime: (next: Float32Array, time: number, duration: number) => {
            guard('setValueCurveAtTime', time);
            curve = { start: time, end: time + duration };
            events.push({ type: 'curve', time, duration, curve: next });
        },
    } as unknown as AudioParam;

    return { gain, events };
};

export const asGain = (node: FakeGainNode) => node as unknown as GainNode;

/** Where an automation sequence is headed, ignoring the cancels and holds along the way. */
export const finalTarget = (node: FakeGainNode): number | null => {
    for (let index = node.events.length - 1; index >= 0; index -= 1) {
        const event = node.events[index];
        if (event.type === 'set' || event.type === 'ramp' || event.type === 'exp') return event.value;
    }
    return null;
};

export const lastCurve = (node: FakeGainNode) => {
    for (let index = node.events.length - 1; index >= 0; index -= 1) {
        const event = node.events[index];
        if (event.type === 'curve') return event;
    }
    return null;
};

/**
 * A biquad's gain is an AudioParam too, so the same recorder describes the per-band shaping.
 *
 * `gain` rather than `frequency`, because that is the parameter the three tone filters automate: a
 * shelf pulled to -24dB removes a band as completely as a filter swept over it, and unlike a sweep
 * it returns to exactly unity rather than to "far enough out of the way".
 */
export const createFakeFilter = (type: BiquadFilterType = 'peaking') => {
    const gain = createFakeGainNode();
    return {
        node: {
            type,
            gain: gain.gain,
            frequency: { value: 1000 },
            Q: { value: 1 },
        } as unknown as BiquadFilterNode,
        events: gain.events,
        param: gain,
    };
};

export interface FakeDeckChain extends AutomixDeckChain {
    fadeNode: FakeGainNode;
    replayGainNode: FakeGainNode;
    trimNode: FakeGainNode;
    /** The three band gains, in the order the curve builder produces them. */
    toneParams: [FakeGainNode, FakeGainNode, FakeGainNode];
    throwParam: FakeGainNode;
}

/** Measurements a deck can be told to report, so a blend's shape can be driven from a test. */
export interface FakeAnalyserReadings {
    loudnessDb?: number | null;
    bpm?: number | null;
    /** Seconds from the blend starting to the next beat. */
    nextBeatIn?: number | null;
}

export const createFakeChain = (readings: FakeAnalyserReadings = {}): FakeDeckChain => {
    const fadeNode = createFakeGainNode();
    const replayGainNode = createFakeGainNode();
    const trimNode = createFakeGainNode();
    const low = createFakeFilter('lowshelf');
    const mid = createFakeFilter('peaking');
    const high = createFakeFilter('highshelf');
    const throwSend = createFakeGainNode();
    const bpm = readings.bpm ?? null;

    return {
        source: {} as MediaElementAudioSourceNode,
        // The shared mix point. Never reached by these tests - a stem gesture needs real buffers -
        // but the chain has to be shaped like the real one.
        output: {} as AudioNode,
        replayGain: replayGainNode as unknown as GainNode,
        trim: trimNode as unknown as GainNode,
        tone: { low: low.node, mid: mid.node, high: high.node },
        fade: fadeNode as unknown as GainNode,
        throw: {
            send: throwSend as unknown as GainNode,
            delay: { delayTime: createFakeGainNode().gain } as unknown as DelayNode,
            feedback: createFakeGainNode() as unknown as GainNode,
        },
        analyser: {
            tick: () => { },
            loudnessDb: () => readings.loudnessDb ?? null,
            levelHistory: () => null,
            tempo: () => (bpm === null
                ? null
                : { bpm, periodSec: 60 / bpm, confidence: 1, beatOffsetHops: 0 }),
            nextBeatIn: () => readings.nextBeatIn ?? null,
            reset: () => { },
        },
        fadeNode,
        replayGainNode,
        trimNode,
        toneParams: [low.param, mid.param, high.param],
        throwParam: throwSend,
    };
};

export const createFakeContext = (currentTime = 0) => ({ currentTime } as AudioContext);

export interface FakeAudioElement {
    duration: number;
    currentTime: number;
    playbackRate: number;
    paused: boolean;
    readyState: number;
    pause: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
}

export const createFakeElement = (duration = 100, currentTime = 0): FakeAudioElement => ({
    duration,
    currentTime,
    playbackRate: 1,
    paused: false,
    // HAVE_METADATA: enough for a seek to land, which is what the entry point needs.
    readyState: 1,
    pause: vi.fn(),
    addEventListener: vi.fn(),
});

export const asElement = (element: FakeAudioElement) => element as unknown as HTMLAudioElement;
