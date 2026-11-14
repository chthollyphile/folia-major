import { describe, expect, it } from 'vitest';
import {
    DispatchCosts, createFrameClock, createSliceQueue, durationsFromTicks, planCuts, sliceMsForFrame, type SubmitQueue,
} from '@/services/analysis/gpuSlices';

// test/unit/analysis/gpuSlices.test.ts
// The GPU analysis runtimes' slicing (src/services/analysis/gpuSlices.ts): where a run is cut by its
// measured costs, how many slices the queue keeps on the GPU, what lets the next one go, and the
// cost table's averaging and giving up - on a fake queue whose completions the test settles by hand.

/** A queue whose submits complete only when the test says, in order. */
const fakeQueue = () => {
    const done: (() => void)[] = [];
    let submitted = 0;
    const queue: SubmitQueue = {
        submit: () => { submitted += 1; },
        onSubmittedWorkDone: () => new Promise<void>((resolve) => { done.push(resolve); }),
    };
    return {
        queue,
        get submitted() { return submitted; },
        get unfinished() { return done.length; },
        /** Completes the oldest outstanding slice. */
        finish: () => done.shift()?.(),
    };
};

const commands = {} as GPUCommandBuffer;
/** Lets every pending promise callback run. */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
/** Whether `promise` has settled by now. */
const settled = async (promise: Promise<unknown>) => {
    let is = false;
    void promise.then(() => { is = true; });
    await flush();
    return is;
};

describe('createSliceQueue', () => {
    it('waits for each slice with one in flight', async () => {
        const fake = fakeQueue();
        const queue = createSliceQueue(fake.queue, { sliceMs: 2, inFlight: 1, frame: () => Promise.resolve() });
        const first = queue.submit(commands);
        // A frame does not let a lone slice go: one in flight waits for its completion.
        expect(await settled(first)).toBe(false);
        fake.finish();
        expect(await settled(first)).toBe(true);
        expect(queue.slices).toBe(1);
        expect(queue.roundTrips).toHaveLength(1);
    });

    it('lets the next slice go at a frame, up to the in-flight limit', async () => {
        const fake = fakeQueue();
        let tick: (() => void) | null = null;
        const frame = () => new Promise<void>((resolve) => { tick = resolve; });
        const queue = createSliceQueue(fake.queue, { sliceMs: 2, inFlight: 2, frame });
        const first = queue.submit(commands);
        expect(await settled(first)).toBe(false);
        tick!();
        expect(await settled(first)).toBe(true);
        // Two on the GPU now: the second waits for room, not for a frame.
        const second = queue.submit(commands);
        tick!();
        expect(await settled(second)).toBe(false);
        expect(fake.unfinished).toBe(2);
        fake.finish();
        expect(await settled(second)).toBe(true);
        expect(fake.unfinished).toBe(1);
    });

    it('lets the next slice go at its completion before any frame', async () => {
        const fake = fakeQueue();
        const queue = createSliceQueue(fake.queue, { sliceMs: 2, inFlight: 4, frame: () => new Promise<void>(() => undefined) });
        const first = queue.submit(commands);
        expect(await settled(first)).toBe(false);
        fake.finish();
        expect(await settled(first)).toBe(true);
    });

    it('keeps no more than the limit on the GPU without a frame clock', async () => {
        const fake = fakeQueue();
        const queue = createSliceQueue(fake.queue, { sliceMs: 2, inFlight: 3 });
        await queue.submit(commands);
        await queue.submit(commands);
        const third = queue.submit(commands);
        expect(await settled(third)).toBe(false);
        expect(fake.unfinished).toBe(3);
        fake.finish();
        expect(await settled(third)).toBe(true);
    });

    it('waits for every slice on the last one', async () => {
        const fake = fakeQueue();
        const queue = createSliceQueue(fake.queue, { sliceMs: 2, inFlight: 4, frame: () => Promise.resolve() });
        await queue.submit(commands);
        await queue.submit(commands);
        const last = queue.submit(commands, true);
        fake.finish();
        fake.finish();
        expect(await settled(last)).toBe(false);
        fake.finish();
        expect(await settled(last)).toBe(true);
        expect(fake.submitted).toBe(3);
        expect(queue.roundTrips).toHaveLength(3);
    });

    it('rejects with a failed completion instead of leaving it unhandled', async () => {
        const queue = createSliceQueue({ submit: () => undefined, onSubmittedWorkDone: () => Promise.reject(new Error('lost')) }, { sliceMs: 2, inFlight: 1 });
        await expect(queue.submit(commands)).rejects.toThrow('lost');
    });
});

describe('planCuts', () => {
    it('closes a slice before the dispatch that would take it past the size', () => {
        expect([...planCuts([1, 1, 1, 1, 1], 2)]).toEqual([2, 4]);
        expect([...planCuts([0.5, 0.5, 0.5, 0.5], 2)]).toEqual([]);
    });

    it('gives a dispatch longer than the size a slice of its own', () => {
        expect([...planCuts([1, 5, 1], 2)]).toEqual([1, 2]);
        expect([...planCuts([5, 1], 2)]).toEqual([1]);
    });
});

describe('DispatchCosts', () => {
    it('cuts by the first profiled run and averages in the second', () => {
        const costs = new DispatchCosts(3);
        expect(costs.wanted).toBe(true);
        expect(costs.cutsFor(2)).toBeNull();
        costs.record([1, 2, 3]);
        expect(costs.wanted).toBe(true);
        expect([...costs.cutsFor(3)!]).toEqual([2]);
        costs.record([3, 2, 1]);
        expect(costs.wanted).toBe(false);
        expect([...costs.costs!]).toEqual([2, 2, 2]);
        expect([...costs.cutsFor(3)!]).toEqual([1, 2]);
        // Further runs leave the table as it is.
        costs.record([9, 9, 9]);
        expect([...costs.costs!]).toEqual([2, 2, 2]);
    });

    it('keeps a table when a later run reads broken', () => {
        const costs = new DispatchCosts(3);
        costs.record([1, 1, 1]);
        costs.record([0, 0, 0]);
        expect(costs.unusable).toBe(false);
        expect([...costs.costs!]).toEqual([1, 1, 1]);
    });

    it('gives up on timestamps that cannot be right', () => {
        for (const broken of [[0, 0, 0], [1, -1, 1], [1, Number.NaN, 1], [1, 1]]) {
            const costs = new DispatchCosts(3);
            costs.record(broken);
            expect(costs.unusable).toBe(true);
            expect(costs.wanted).toBe(false);
            expect(costs.cutsFor(2)).toBeNull();
        }
    });
});

describe('durationsFromTicks', () => {
    it('reads begin/end pairs in nanoseconds as milliseconds', () => {
        expect([...durationsFromTicks(new BigInt64Array([0n, 1_500_000n, 2_000_000n, 2_250_000n]), 2)]).toEqual([1.5, 0.25]);
    });
});

describe('createFrameClock', () => {
    it('shares one request between waiters and learns the shortest interval', async () => {
        const callbacks: ((at: number) => void)[] = [];
        const clock = createFrameClock((callback) => { callbacks.push(callback); });
        const a = clock.next();
        const b = clock.next();
        expect(callbacks).toHaveLength(1);
        callbacks.shift()!(100);
        await Promise.all([a, b]);
        expect(clock.frameMs).toBeNull();
        void clock.next();
        callbacks.shift()!(108.3);
        void clock.next();
        callbacks.shift()!(125);
        expect(clock.frameMs).toBeCloseTo(8.3);
    });

    it('treats a requestAnimationFrame that throws as none', async () => {
        let calls = 0;
        const clock = createFrameClock(() => { calls += 1; throw new Error('NotSupportedError'); });
        expect(await settled(clock.next())).toBe(false);
        expect(await settled(clock.next())).toBe(false);
        expect(calls).toBe(1);
    });

    it('never resolves without requestAnimationFrame', async () => {
        const clock = createFrameClock(undefined);
        expect(await settled(clock.next())).toBe(false);
    });
});

describe('sliceMsForFrame', () => {
    it('is a quarter frame within 1-4 ms, a 120 Hz frame before one is known', () => {
        expect(sliceMsForFrame(null)).toBeCloseTo(1000 / 120 / 4);
        expect(sliceMsForFrame(1000 / 240)).toBe(1.0416666666666667);
        expect(sliceMsForFrame(1000 / 30)).toBe(4);
        expect(sliceMsForFrame(2)).toBe(1);
    });
});
