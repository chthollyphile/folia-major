import { describe, expect, it } from 'vitest';
import { chooseCpuThreads, chooseExecutor, cpuThreads, createScheduler, DEADLINE_HORIZON_MS, DEADLINE_MARGIN_MS, type FrameWatch, type UnitRequest } from '@/services/analysis/scheduler';

// test/unit/analysis/scheduler.test.ts
// The analysis scheduler: which unit runs next (deadline by slack, then on screen, then background,
// first come first served), a dropped task answering null at its turn, a paused one passed over and
// kept, the estimate a task's finish is judged by, and the GPU / CPU and thread-level choices. And
// yielding to the picture (2c): frames waited between units while it drops frames, not for a deadline.

const clock = () => {
    let at = 0;
    return { now: () => at, advance: (ms: number) => { at += ms; } };
};

/** A unit that answers when told, recording when it started. */
const held = (name: string, started: string[]) => {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    return {
        run: async () => { started.push(name); await done; return name; },
        finish: () => finish(),
    };
};

// Two tasks: the scheduler picks the next unit a task after the last one answered (scheduler.ts).
const flush = () => new Promise(resolve => setTimeout(resolve, 0)).then(() => new Promise(resolve => setTimeout(resolve, 0)));

describe('the scheduler', () => {
    it('runs a deadline first, then what is on screen, then background, in order within each', async () => {
        const time = clock();
        const scheduler = createScheduler({ now: time.now, log: () => undefined });
        const started: string[] = [];
        const first = held('first', started);
        const units: Record<string, ReturnType<typeof held>> = {};
        const submit = (name: string, request: Omit<UnitRequest<string>, 'run' | 'kind'>) => {
            units[name] = held(name, started);
            return scheduler.submit({ ...request, kind: 'htdemucs', run: units[name].run });
        };
        // Busy with one, so the rest queue.
        const busy = scheduler.submit({ kind: 'htdemucs', urgency: 'background', run: first.run });
        const answers = [
            submit('background-1', { urgency: 'background' }),
            submit('screen', { urgency: 'onScreen' }),
            submit('background-2', { urgency: 'background' }),
            submit('late', { urgency: 'transition', deadline: 60_000 }),
            submit('later', { urgency: 'transition', deadline: 600_000 }),
        ];
        expect(scheduler.queued()).toBe(5);
        first.finish();
        await busy;
        for (const name of ['late', 'later', 'screen', 'background-1', 'background-2']) {
            await flush();
            units[name].finish();
        }
        await Promise.all(answers);
        expect(started).toEqual(['first', 'late', 'later', 'screen', 'background-1', 'background-2']);
    });

    it('drops a unit whose task is no longer wanted when its turn comes, and passes a paused one over', async () => {
        const scheduler = createScheduler({ log: () => undefined });
        const started: string[] = [];
        const first = held('first', started);
        let wanted = true;
        let paused = true;
        const busy = scheduler.submit({ kind: 'beat_this', urgency: 'onScreen', run: first.run });
        const left = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', stillWanted: () => wanted, run: async () => 'left' });
        const resumed = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', paused: () => paused, run: async () => 'resumed' });
        const other = scheduler.submit({ kind: 'beat_this', urgency: 'background', run: async () => 'other' });
        wanted = false;
        first.finish();
        await busy;
        expect(await left).toBeNull();
        expect(await other).toBe('other');
        // Still queued, until it is resumed and something moves the queue.
        expect(scheduler.queued()).toBe(1);
        paused = false;
        expect(await scheduler.submit({ kind: 'percussive', urgency: 'background', run: async () => 'nudge' })).toBe('nudge');
        expect(await resumed).toBe('resumed');
    });

    it('measures each kind, and estimates a finish from what is ahead, the units left and a load', async () => {
        const time = clock();
        let loaded = false;
        const scheduler = createScheduler({ now: time.now, isLoaded: () => loaded, log: () => undefined });
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => { time.advance(200); return 1; } });
        expect(scheduler.unitMs('htdemucs')).toBe(200);
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => { time.advance(100); return 1; } });
        // A moving average, weighted to the newer.
        expect(scheduler.unitMs('htdemucs')).toBeCloseTo(180);
        scheduler.noteLoad('htdemucs', 1000);
        expect(scheduler.estimateFinish('htdemucs', 10, 'transition', 60_000)).toBeCloseTo(time.now() + 1800 + 1000);
        loaded = true;
        expect(scheduler.estimateFinish('htdemucs', 10, 'transition', 60_000)).toBeCloseTo(time.now() + 1800);
    });

    it('counts the units picked before a task, not those after it', async () => {
        const time = clock();
        const scheduler = createScheduler({ now: time.now, log: () => undefined });
        const started: string[] = [];
        const first = held('first', started);
        const busy = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: first.run });
        const behind = scheduler.submit({ kind: 'beat_this', urgency: 'background', run: async () => 'x' });
        const ahead = scheduler.submit({ kind: 'beat_this', urgency: 'onScreen', run: async () => 'y' });
        // What is left of the running unit (none of it has passed on this clock), then: on screen, the
        // on-screen unit is ahead of it (first come) and the background one is not.
        const runningLeft = scheduler.unitMs('htdemucs');
        expect(scheduler.estimateFinish('htdemucs', 1, 'onScreen')).toBeCloseTo(runningLeft + scheduler.unitMs('beat_this') + scheduler.unitMs('htdemucs'));
        // A deadline goes before both.
        expect(scheduler.estimateFinish('htdemucs', 1, 'transition', 1e9)).toBeCloseTo(runningLeft + scheduler.unitMs('htdemucs'));
        first.finish();
        await Promise.all([busy, behind, ahead]);
    });
});

describe('the scheduler, from review', () => {
    it('lets a background unit that has waited a second in before the next on-screen one', async () => {
        const time = clock();
        const scheduler = createScheduler({ now: time.now, log: () => undefined });
        const started: string[] = [];
        const segment = held('segment-1', started);
        const busy = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: segment.run });
        const automix = scheduler.submit({ kind: 'beat_this', urgency: 'background', run: async () => { started.push('automix'); return 'automix'; } });
        time.advance(1500);
        // The separation asks for its next segment as the last one answers.
        const next = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => { started.push('segment-2'); return 'segment-2'; } });
        segment.finish();
        await Promise.all([busy, automix, next]);
        expect(started).toEqual(['segment-1', 'automix', 'segment-2']);
    });

    it('raises a track\'s queued units when a caller on screen joins them', async () => {
        const scheduler = createScheduler({ log: () => undefined });
        const started: string[] = [];
        const first = held('first', started);
        const busy = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: first.run });
        const joined = scheduler.submit({ kind: 'beat_this', key: 'song-1', urgency: 'background', run: async () => { started.push('song-1'); return 1; } });
        const screen = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => { started.push('screen'); return 2; } });
        scheduler.raise('song-1', 'onScreen');
        first.finish();
        await Promise.all([busy, joined, screen]);
        expect(started).toEqual(['first', 'song-1', 'screen']);
    });

    it('runs a resumed unit on wake, with nothing else queued', async () => {
        const scheduler = createScheduler({ log: () => undefined });
        let paused = true;
        const answer = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', paused: () => paused, run: async () => 'resumed' });
        await flush();
        expect(scheduler.queued()).toBe(1);
        paused = false;
        scheduler.wake();
        expect(await answer).toBe('resumed');
    });

    it('takes a load off the unit it happened in, and does not time a run that answered nothing', async () => {
        const time = clock();
        const scheduler = createScheduler({ now: time.now, log: () => undefined });
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => { time.advance(1000); scheduler.noteLoad('htdemucs', 1000); time.advance(150); return 1; } });
        expect(scheduler.unitMs('htdemucs')).toBe(150);
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => null });
        expect(scheduler.unitMs('htdemucs')).toBe(150);
    });

    it('does not stay busy after a run that throws before its first await', async () => {
        const scheduler = createScheduler({ log: () => undefined });
        await expect(scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: () => { throw new Error('sync'); } })).rejects.toThrow('sync');
        expect(await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => 'after' })).toBe('after');
    });
});

describe('yielding to the picture', () => {
    /** Frames that drop under every unit while `dropping`, and waits the test lets through by hand. */
    const fakeFrames = () => {
        const waits: Array<{ count: number; done: (waited?: { drawn: boolean; over: number }) => void }> = [];
        const watch = {
            dropping: true,
            /** Whether a unit is drawn under at all: false, a minimised window. */
            drawing: true,
            waits,
            begin: () => undefined,
            end: () => (watch.drawing ? { worst: 40, refresh: 16.7, over: watch.dropping ? 2 : 0 } : null),
            wait: (count: number) => new Promise<{ drawn: boolean; over: number }>((resolve) => {
                waits.push({ count, done: (waited = { drawn: true, over: 0 }) => resolve(waited) });
            }),
            frameMs: () => 16.7,
        };
        return watch as typeof watch & FrameWatch;
    };

    it('waits a frame before the next unit once frames drop, doubling while they go on, and halving back', async () => {
        const frames = fakeFrames();
        const scheduler = createScheduler({ frames, log: () => undefined });
        const ran: number[] = [];
        const unit = (n: number) => scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => { ran.push(n); return n; } });
        const answers = [unit(1), unit(2), unit(3)];
        await flush();
        // The first ran at once; frames dropped under it, so the second waits one frame.
        expect(ran).toEqual([1]);
        expect(frames.waits.map(wait => wait.count)).toEqual([1]);
        frames.waits[0].done();
        await flush();
        expect(ran).toEqual([1, 2]);
        expect(frames.waits.map(wait => wait.count)).toEqual([1, 2]);
        frames.dropping = false;
        frames.waits[1].done();
        await Promise.all(answers);
        expect(ran).toEqual([1, 2, 3]);
        // The third dropped none: down to one frame, then none.
        const after = unit(4);
        await flush();
        expect(frames.waits.map(wait => wait.count)).toEqual([1, 2, 1]);
        frames.waits[2].done();
        await after;
        expect(await unit(5)).toBe(5);
        expect(frames.waits).toHaveLength(3);
    });

    it('does not wait for a unit whose deadline is close', async () => {
        const time = clock();
        const frames = fakeFrames();
        const scheduler = createScheduler({ now: time.now, frames, log: () => undefined });
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => 1 });
        // Frames dropped: a unit with time to spare waits, one about to be late does not.
        const late = scheduler.submit({ kind: 'htdemucs', urgency: 'transition', deadline: DEADLINE_MARGIN_MS - 1, run: async () => 'late' });
        expect(await late).toBe('late');
        expect(frames.waits).toHaveLength(0);
        const spare = scheduler.submit({ kind: 'htdemucs', urgency: 'transition', deadline: 600_000, run: async () => 'spare' });
        await flush();
        expect(frames.waits).toHaveLength(1);
        frames.waits[0].done();
        expect(await spare).toBe('spare');
    });

    it('goes back to back when the picture drops frames between units too: they are not the cause', async () => {
        const frames = fakeFrames();
        const lines: string[] = [];
        const scheduler = createScheduler({ frames, log: line => lines.push(line) });
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => 1 });
        const next = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => 2 });
        await flush();
        frames.waits[0].done({ drawn: true, over: 1 });
        expect(await next).toBe(2);
        // It dropped under the second unit as well, but that starts over at one frame, not two.
        const third = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => 3 });
        await flush();
        expect(frames.waits.map(wait => wait.count)).toEqual([1, 1]);
        frames.waits[1].done();
        await third;
        expect(lines.some(line => line.includes('between units too'))).toBe(true);
    });

    it('stops waiting when no frames come: a minimised window has no picture to yield to', async () => {
        const frames = fakeFrames();
        const scheduler = createScheduler({ frames, log: () => undefined });
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => 1 });
        frames.drawing = false;
        const next = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => 2 });
        await flush();
        // The wait ends on its timer, no frame drawn: no more waits, whatever the units after see.
        frames.waits[0].done({ drawn: false, over: 0 });
        expect(await next).toBe(2);
        expect(await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => 3 })).toBe(3);
        expect(frames.waits).toHaveLength(1);
    });

    it('caps the wait at eight frames, and counts it in an estimate', async () => {
        const time = clock();
        const frames = fakeFrames();
        const scheduler = createScheduler({ now: time.now, frames, log: () => undefined });
        const counts: number[] = [];
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => 0 });
        for (let n = 1; n <= 5; n += 1) {
            const unit = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => n });
            await flush();
            const wait = frames.waits[frames.waits.length - 1];
            counts.push(wait.count);
            wait.done();
            await unit;
        }
        expect(counts).toEqual([1, 2, 4, 8, 8]);
        // Each unit is its own time and eight frames.
        expect(scheduler.estimateFinish('htdemucs', 2, 'onScreen')).toBeCloseTo(time.now() + 2 * (scheduler.unitMs('htdemucs') + 8 * 16.7));
    });

    it('does not carry a wait over to a unit asked for after the one waited for was dropped', async () => {
        const frames = fakeFrames();
        const scheduler = createScheduler({ frames, log: () => undefined });
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => 1 });
        let wanted = true;
        const dropped = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', stillWanted: () => wanted, run: async () => 2 });
        await flush();
        wanted = false;
        frames.waits[0].done();
        expect(await dropped).toBeNull();
        const later = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => 3 });
        await flush();
        expect(frames.waits).toHaveLength(2);
        frames.waits[1].done();
        expect(await later).toBe(3);
    });

    it('takes a unit submitted during a wait after it, once, in order', async () => {
        const frames = fakeFrames();
        const scheduler = createScheduler({ frames, log: () => undefined });
        const ran: string[] = [];
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => 1 });
        const screen = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => { ran.push('screen'); return 1; } });
        await flush();
        const late = scheduler.submit({ kind: 'htdemucs', urgency: 'transition', deadline: 1, run: async () => { ran.push('late'); return 2; } });
        scheduler.wake();
        await flush();
        // Nothing handed out early, and the one wait.
        expect(ran).toEqual([]);
        expect(frames.waits).toHaveLength(1);
        frames.waits[0].done();
        await late;
        expect(ran[0]).toBe('late');
        await flush();
        expect(frames.waits).toHaveLength(2);
        frames.waits[1].done();
        await screen;
    });
});

describe('a deadline far off', () => {
    it('ranks by its urgency until its slack is under the horizon, then goes first', async () => {
        const time = clock();
        const scheduler = createScheduler({ now: time.now, log: () => undefined });
        const started: string[] = [];
        const first = held('first', started);
        const busy = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: first.run });
        const far = scheduler.submit({ kind: 'htdemucs', urgency: 'background', deadline: 10 * DEADLINE_HORIZON_MS, run: async () => { started.push('far'); return 1; } });
        const near = scheduler.submit({ kind: 'htdemucs', urgency: 'background', deadline: DEADLINE_HORIZON_MS / 2, run: async () => { started.push('near'); return 1; } });
        const screen = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => { started.push('screen'); return 1; } });
        first.finish();
        await Promise.all([busy, far, near, screen]);
        expect(started).toEqual(['first', 'near', 'screen', 'far']);
    });
});

describe('where and how hard a task runs', () => {
    it('takes the GPU unless it is missing or late, and then the CPU only if that is on time', () => {
        expect(chooseExecutor({ gpuAvailable: false, gpuFinish: 0, cpuFinish: 0 })).toBe('cpu');
        expect(chooseExecutor({ gpuAvailable: true, gpuFinish: 1e9, cpuFinish: 0 })).toBe('gpu');
        expect(chooseExecutor({ gpuAvailable: true, deadline: 60_000, gpuFinish: 1000, cpuFinish: 0 })).toBe('gpu');
        expect(chooseExecutor({ gpuAvailable: true, deadline: 60_000, gpuFinish: 59_000, cpuFinish: 20_000 })).toBe('cpu');
        expect(chooseExecutor({ gpuAvailable: true, deadline: 60_000, gpuFinish: 59_000, cpuFinish: 70_000 })).toBe('gpu');
    });

    it('sizes the CPU threads by the machine: a quarter, htdemucs at most four, half in a hurry', () => {
        expect([24, 10, 8, 4, 2].map(cores => cpuThreads(cores, 'quiet', 'htdemucs'))).toEqual([4, 2, 2, 1, 1]);
        expect([24, 10, 8, 4].map(cores => cpuThreads(cores, 'quiet', 'beat_this'))).toEqual([6, 2, 2, 1]);
        expect([24, 10, 8, 4, 1].map(cores => cpuThreads(cores, 'hurry', 'htdemucs'))).toEqual([12, 5, 4, 2, 1]);
    });

    it('hurries only when the quiet level would be late', () => {
        expect(chooseCpuThreads({ quietFinish: 1e9, hurryFinish: 0 })).toBe('quiet');
        expect(chooseCpuThreads({ deadline: 60_000, quietFinish: 60_000 - DEADLINE_MARGIN_MS - 1, hurryFinish: 0 })).toBe('quiet');
        expect(chooseCpuThreads({ deadline: 60_000, quietFinish: 60_000, hurryFinish: 59_999 })).toBe('hurry');
    });

    // Measured after PR #750, 2026-10-19: more threads are not always sooner - a rebuild for the other
    // count, a worker whose one MNN thread pool was made for fewer - so late alone does not hurry.
    it('stays quiet when the hurry level would not finish sooner', () => {
        expect(chooseCpuThreads({ deadline: 60_000, quietFinish: 60_000, hurryFinish: 60_000 })).toBe('quiet');
        expect(chooseCpuThreads({ deadline: 60_000, quietFinish: 60_000, hurryFinish: 61_000 })).toBe('quiet');
    });
});

describe('tasks that submit their next unit once the last one answers', () => {
    // From the PR #750 review: picked in the same microtask chain as the answer, the queue held only
    // the other task's units, and two such tasks took strict turns whatever their urgencies.
    it('still go by urgency, not in turns', async () => {
        const scheduler = createScheduler({ log: () => undefined });
        const ran: string[] = [];
        const task = async (name: string, urgency: 'onScreen' | 'background', units: number) => {
            for (let unit = 0; unit < units; unit += 1) {
                await scheduler.submit({ kind: 'htdemucs', urgency, run: async () => { ran.push(name); return unit; } });
                // A few awaits of its own before the next unit, as the stem segments' do.
                await Promise.resolve();
                await Promise.resolve();
                await Promise.resolve();
            }
        };
        await Promise.all([task('A', 'background', 3), task('D', 'onScreen', 3)]);
        expect(ran.join('')).toBe('ADDDAA');
    });
});

describe('telling who listens when a unit starts and ends', () => {
    // gpuActivity.ts counts the running units from these: a unit that fails or throws must still end,
    // or 町景's adaptive degrade would skip its frames for good.
    const watch = () => {
        const heard: string[] = [];
        const scheduler = createScheduler({ log: () => undefined, onUnit: active => heard.push(active ? 'start' : 'end') });
        return { heard, scheduler };
    };

    it('tells a start, then an end once the unit answers', async () => {
        const { heard, scheduler } = watch();
        const answer = await scheduler.submit({ kind: 'htdemucs', urgency: 'background', run: async () => { heard.push('run'); return 'done'; } });
        expect(answer).toBe('done');
        expect(heard).toEqual(['start', 'run', 'end']);
    });

    it('tells the end of a unit that rejects', async () => {
        const { heard, scheduler } = watch();
        const failed = scheduler.submit({ kind: 'htdemucs', urgency: 'background', run: async () => { heard.push('run'); throw new Error('lost device'); } });
        await expect(failed).rejects.toThrow('lost device');
        expect(heard).toEqual(['start', 'run', 'end']);
    });

    it('tells the end of a unit that throws before its first await', async () => {
        const { heard, scheduler } = watch();
        const failed = scheduler.submit({ kind: 'htdemucs', urgency: 'background', run: () => { heard.push('run'); throw new Error('no model'); } });
        await expect(failed).rejects.toThrow('no model');
        expect(heard).toEqual(['start', 'run', 'end']);
    });
});
