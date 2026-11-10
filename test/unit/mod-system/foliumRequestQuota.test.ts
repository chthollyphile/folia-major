import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createFoliumRequestGate,
    isFoliumRequestQuotaError,
    resetFoliumRequestQuotasForTest,
    runFoliumRequest,
    type FoliumSourceOrigin,
} from '@/mods/folium/omni/requestQuota';

// test/unit/mod-system/foliumRequestQuota.test.ts
// Folium 1.7 shared request allowance (folium.omni and platform.raw): per mod id 120 a minute and 8 at
// once, counted when accepted (waiting ones included), first come first served; mods' sources counted
// against the minute without a place; per source built into Folia 240 a minute and 8 at once across all
// mods, the mod's place taken before the source's; places given back when the work settles, not when the
// caller aborts; the 30 s answer limit and the forced give-back 120 s after sending; the test reset.

const originOf = (providerId: string): FoliumSourceOrigin => (providerId.startsWith('folium.') ? 'mod' : 'host');

/* The gate one call of a folium.omni method of `modId` would get; its signal never aborts unless given. */
const gateFor = (modId: string, signal: AbortSignal = new AbortController().signal) => (
    createFoliumRequestGate({ modId, what: 'omni.test', signal, originOf })
);

/* Requests whose answers the test holds back: `work(label)` notes the label when sent and answers when told. */
const holdAnswers = () => {
    const sent: string[] = [];
    const settles = new Map<string, { resolve: (value: string) => void; reject: (error: unknown) => void }>();
    return {
        sent,
        work: (label: string) => () => new Promise<string>((resolve, reject) => {
            sent.push(label);
            settles.set(label, { resolve, reject });
        }),
        answer: (label: string) => settles.get(label)!.resolve(label),
        fail: (label: string, error: unknown) => settles.get(label)!.reject(error),
    };
};

/* Watches a call: whether it settled yet, with its value or its rejection's code (or the error without one). */
const watch = <T>(promise: Promise<T>) => {
    const state: { settled: boolean; value?: T; failure?: unknown } = { settled: false };
    promise.then(
        (value) => { state.settled = true; state.value = value; },
        (error: { code?: unknown } | null) => { state.settled = true; state.failure = error?.code ?? error; },
    );
    return state;
};

/* What a call rejected with: its code, or the error itself when it has none. */
const failureOf = (promise: Promise<unknown>) => promise.then(
    () => { throw new Error('resolved'); },
    (error: { code?: string }) => error.code ?? error,
);

const flush = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

const labels = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    resetFoliumRequestQuotasForTest();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('the allowance per mod', () => {
    it('sends eight requests of one mod at once and lets the rest wait their turn, first come first served', async () => {
        const held = holdAnswers();
        const gate = gateFor('mod-a');
        const calls = labels('r', 11).map((label) => gate.run('netease', held.work(label)));
        // Sent in the same turn as they were made.
        expect(held.sent).toEqual(labels('r', 8));
        // One answer frees one place, for the oldest waiting request.
        held.answer('r3');
        await flush();
        expect(held.sent.slice(8)).toEqual(['r8']);
        held.answer('r1');
        held.answer('r0');
        await flush();
        expect(held.sent.slice(9)).toEqual(['r9', 'r10']);
        for (const label of labels('r', 11)) if (label !== 'r0' && label !== 'r1' && label !== 'r3') held.answer(label);
        // Nobody failed for having waited.
        await expect(Promise.all(calls)).resolves.toEqual(labels('r', 11));
    });

    it('counts a request when it is accepted, waiting and aborted ones included, refused ones not', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
        const gate = gateFor('mod-a');
        const held = holdAnswers();
        // Eight sent, 112 waiting: all 120 count.
        const callers = labels('r', 120).map(() => new AbortController());
        labels('r', 120).forEach((label, i) => void gateFor('mod-a', callers[i].signal).run('netease', held.work(label)).catch(() => {}));
        expect(held.sent).toHaveLength(8);
        // Aborting some of them takes nothing off the minute.
        callers.slice(100).forEach((caller) => caller.abort());
        const refused = gate.run('netease', held.work('over'));
        await expect(failureOf(refused)).resolves.toBe('rate-limited');
        await refused.catch((error: unknown) => expect(isFoliumRequestQuotaError(error)).toBe(true));
        expect(warn).toHaveBeenCalledWith('[Folium:mod-a] omni.test netease: refused, over 120 requests a minute');
        // Refused calls half a minute on take nothing either: a minute after the first 120 a whole new
        // minute's worth is accepted.
        vi.setSystemTime(new Date('2026-10-21T12:00:30Z'));
        for (let i = 0; i < 5; i += 1) await expect(failureOf(gate.run('netease', held.work(`late${i}`)))).resolves.toBe('rate-limited');
        vi.setSystemTime(new Date('2026-10-21T12:01:00Z'));
        const next = labels('n', 121).map((label) => watch(gate.run('folium.mod-b.songs', () => Promise.resolve(label))));
        await flush();
        expect(next.slice(0, 120).every((call) => call.value !== undefined)).toBe(true);
        expect(next[120].failure).toBe('rate-limited');
        expect(held.sent).not.toContain('over');
    });

    it('keeps one allowance per mod id, shared by two gates of one mod (two services, a reloaded mod)', async () => {
        const held = holdAnswers();
        const first = gateFor('mod-a');
        const second = gateFor('mod-a');
        labels('a', 8).forEach((label) => void first.run('netease', held.work(label)));
        const waiting = watch(second.run('qq', held.work('second')));
        // Another mod has its own places.
        void gateFor('mod-b').run('qq', held.work('b'));
        expect(held.sent).toEqual([...labels('a', 8), 'b']);
        held.answer('a0');
        await flush();
        expect(held.sent).toContain('second');
        held.answer('second');
        await flush();
        expect(waiting.value).toBe('second');

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
        resetFoliumRequestQuotasForTest();
        const answers = [
            ...labels('x', 60).map(() => watch(first.run('folium.mod-a.songs', () => Promise.resolve('x')))),
            ...labels('y', 60).map(() => watch(second.run('folium.mod-a.songs', () => Promise.resolve('y')))),
        ];
        const over = watch(gateFor('mod-a').run('folium.mod-a.songs', () => Promise.resolve('over')));
        const other = watch(gateFor('mod-b').run('folium.mod-a.songs', () => Promise.resolve('other')));
        await flush();
        expect(answers.every((call) => call.value !== undefined)).toBe(true);
        expect(over.failure).toBe('rate-limited');
        expect(other.value).toBe('other');
    });

    it('rejects an aborted caller at once but gives the place back only when the work settles', async () => {
        const held = holdAnswers();
        const callers = labels('r', 8).map(() => new AbortController());
        const calls = labels('r', 8).map((label, i) => watch(gateFor('mod-a', callers[i].signal).run('netease', held.work(label))));
        callers.forEach((caller) => caller.abort());
        await flush();
        expect(calls.every((call) => call.failure === 'aborted')).toBe(true);
        // The eight are still under way at the source: a ninth waits.
        void gateFor('mod-a').run('netease', held.work('r8'));
        expect(held.sent).toEqual(labels('r', 8));
        // One of them settles (its answer is dropped): its place goes to the ninth.
        held.answer('r5');
        await flush();
        expect(held.sent).toEqual([...labels('r', 8), 'r8']);
        expect(calls[5].value).toBeUndefined();
    });

    it('takes a waiting request whose signal aborts out of the queue, unsent, and gives its turn on', async () => {
        const held = holdAnswers();
        const gate = gateFor('mod-a');
        labels('r', 8).forEach((label) => void gate.run('netease', held.work(label)));
        const caller = new AbortController();
        const aborted = failureOf(gateFor('mod-a', caller.signal).run('netease', held.work('r8')));
        const next = watch(gate.run('netease', held.work('r9')));
        caller.abort();
        await expect(aborted).resolves.toBe('aborted');
        held.answer('r0');
        await flush();
        expect(held.sent.slice(8)).toEqual(['r9']);
        held.answer('r9');
        await flush();
        expect(next.value).toBe('r9');
    });

    it('rejects a call whose signal aborted already, and passes the work\'s own failures through', async () => {
        const before = new AbortController();
        before.abort();
        const work = vi.fn(() => Promise.resolve('never'));
        await expect(failureOf(gateFor('mod-a', before.signal).run('netease', work))).resolves.toBe('aborted');
        expect(work).not.toHaveBeenCalled();

        // A failure that looks like the allowance's is the work's all the same, and its place comes back.
        const gate = gateFor('mod-a');
        const lookalike = Object.assign(new Error('rate-limited'), { code: 'rate-limited' });
        const failed = gate.run('netease', () => Promise.reject(lookalike));
        await expect(failed).rejects.toBe(lookalike);
        expect(isFoliumRequestQuotaError(lookalike)).toBe(false);
        const thrown = new Error('thrown at once');
        await expect(gate.run('netease', () => { throw thrown; })).rejects.toBe(thrown);
        const held = holdAnswers();
        labels('r', 8).forEach((label) => void gate.run('netease', held.work(label)));
        expect(held.sent).toHaveLength(8);
    });
});

describe('mods\' sources', () => {
    it('counts a request to a mod\'s source against the minute without a place, so it never waits', async () => {
        const held = holdAnswers();
        const gate = gateFor('mod-a');
        labels('r', 8).forEach((label) => void gate.run('netease', held.work(label)));
        void gate.run('folium.mod-b.songs', held.work('mod-source'));
        expect(held.sent).toContain('mod-source');
        // Eight of them under way leave all of the mod's places free.
        labels('m', 8).forEach((label) => void gateFor('mod-c').run('folium.mod-b.songs', held.work(label)));
        void gateFor('mod-c').run('kugou', held.work('kugou'));
        expect(held.sent).toContain('kugou');

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
        resetFoliumRequestQuotasForTest();
        const calls = labels('s', 121).map((label) => watch(gate.run('folium.mod-b.songs', () => Promise.resolve(label))));
        await flush();
        expect(calls.slice(0, 120).every((call) => call.value !== undefined)).toBe(true);
        expect(calls[120].failure).toBe('rate-limited');
    });

    it('does not deadlock when a mod\'s source asks again from inside its own request', async () => {
        const held = holdAnswers();
        const gate = gateFor('mod-a');
        labels('r', 8).forEach((label) => void gate.run('netease', held.work(label)));
        // A mod's source whose search asks folium.omni again, while all of the mod's places are taken.
        const outer = gate.run('folium.mod-a.songs', async () => {
            const inner = await gate.run('folium.mod-a.songs', () => Promise.resolve('inner'));
            return `outer:${inner}`;
        });
        await expect(outer).resolves.toBe('outer:inner');
    });
});

describe('the allowance per source across all mods', () => {
    it('lets eight requests to one source under way at once from all mods, the mod\'s place taken first', async () => {
        const held = holdAnswers();
        labels('a', 5).forEach((label) => void gateFor('mod-a').run('netease', held.work(label)));
        labels('b', 3).forEach((label) => void gateFor('mod-b').run('netease', held.work(label)));
        const gateB = gateFor('mod-b');
        void gateB.run('netease', held.work('b3'));
        void gateFor('mod-c').run('netease', held.work('c0'));
        // Another source is not held up, and neither is the mod with a request waiting.
        void gateB.run('qq', held.work('b-qq'));
        expect(held.sent).toEqual([...labels('a', 5), ...labels('b', 3), 'b-qq']);
        // A freed place of the source goes to the oldest waiting, whichever mod.
        held.answer('a0');
        await flush();
        expect(held.sent.slice(9)).toEqual(['b3']);
        held.answer('a1');
        await flush();
        expect(held.sent.slice(10)).toEqual(['c0']);
    });

    it('takes a request that aborts while waiting for the source out of the queue, and its mod place goes on', async () => {
        const held = holdAnswers();
        labels('a', 8).forEach((label) => void gateFor('mod-a').run('netease', held.work(label)));
        // mod-b: one waiting for the source while it holds one of mod-b's places, seven more under way
        // elsewhere, and one waiting for a place of mod-b's.
        const caller = new AbortController();
        const waitingForSource = failureOf(gateFor('mod-b', caller.signal).run('netease', held.work('b-netease')));
        labels('b', 7).forEach((label) => void gateFor('mod-b').run('qq', held.work(label)));
        void gateFor('mod-b').run('kugou', held.work('b-kugou'));
        expect(held.sent).toEqual([...labels('a', 8), ...labels('b', 7)]);
        caller.abort();
        await expect(waitingForSource).resolves.toBe('aborted');
        expect(held.sent.slice(15)).toEqual(['b-kugou']);
        // It left the source's queue too: the next free place of the source stays free.
        held.answer('a0');
        await flush();
        void gateFor('mod-c').run('netease', held.work('c0'));
        expect(held.sent.slice(16)).toEqual(['c0']);
        expect(held.sent).not.toContain('b-netease');
    });

    /*
     * mod-b holds all of netease's places. mod-a: one call waits for netease while it holds one of
     * mod-a's places, seven are under way at qq, and one waits for a place of mod-a's to go to kugou,
     * which is free. When the netease call stops waiting it gives its mod place back, the place the
     * kugou call waits for.
     */
    const waitForSourceAndForMod = (held: ReturnType<typeof holdAnswers>, netease: AbortSignal, kugou: AbortSignal) => {
        labels('b', 8).forEach((label) => void gateFor('mod-b').run('netease', held.work(label)));
        const waitingForSource = failureOf(gateFor('mod-a', netease).run('netease', held.work('a-netease')));
        labels('q', 7).forEach((label) => void gateFor('mod-a').run('qq', held.work(label)));
        const waitingForMod = failureOf(gateFor('mod-a', kugou).run('kugou', held.work('a-kugou')));
        expect(held.sent).toEqual([...labels('b', 8), ...labels('q', 7)]);
        return Promise.all([waitingForSource, waitingForMod]);
    };

    it('never sends a waiting request whose signal aborted, though a place reaches it before its abort listener runs', async () => {
        const held = holdAnswers();
        // Both calls share one signal: the netease call's listener runs first and gives its mod place back.
        const batch = new AbortController();
        const failures = waitForSourceAndForMod(held, batch.signal, batch.signal);
        batch.abort();
        await expect(failures).resolves.toEqual(['aborted', 'aborted']);
        expect(held.sent).not.toContain('a-kugou');
        expect(held.sent).not.toContain('a-netease');
        // Nothing holds the place it was given: mod-a has seven under way, and its next call goes at once.
        void gateFor('mod-a').run('kugou', held.work('fresh'));
        expect(held.sent.at(-1)).toBe('fresh');
    });

    it('passes no place to a call that stops in the same turn, as a stopping mod\'s calls do one after another', async () => {
        const held = holdAnswers();
        // A signal each, aborted one after the other in one go (as when the activation ends): when the
        // netease call stops, the kugou call's signal has not aborted yet.
        const callers = [new AbortController(), new AbortController()];
        const failures = waitForSourceAndForMod(held, callers[0].signal, callers[1].signal);
        callers.forEach((caller) => caller.abort());
        await expect(failures).resolves.toEqual(['aborted', 'aborted']);
        expect(held.sent).not.toContain('a-kugou');
        void gateFor('mod-a').run('kugou', held.work('fresh'));
        expect(held.sent.at(-1)).toBe('fresh');
    });

    it('refuses past 240 requests a minute to one source from all mods, without taking from the mod\'s minute', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
        // Accepted when made: most of them wait for a place, and all count.
        const accepted = ['mod-a', 'mod-b'].flatMap((modId) => (
            labels(modId, 120).map((label) => gateFor(modId).run('netease', () => Promise.resolve(label)))
        ));
        await expect(failureOf(gateFor('mod-c').run('netease', () => Promise.resolve('refused')))).resolves.toBe('rate-limited');
        await expect(Promise.all(accepted)).resolves.toHaveLength(240);
        expect(warn).toHaveBeenCalledWith('[Folium:mod-c] omni.test netease: refused, all mods together are over 240 requests a minute to netease');
        // mod-c's own minute is whole, and other sources are not touched.
        const own = labels('c', 120).map((label) => gateFor('mod-c').run('qq', () => Promise.resolve(label)));
        await expect(failureOf(gateFor('mod-c').run('qq', () => Promise.resolve('over')))).resolves.toBe('rate-limited');
        await expect(Promise.all(own)).resolves.toHaveLength(120);
        // Requests outside the allowance per source still go: platform.raw's, and a mod's source's.
        const raw = watch(runFoliumRequest({
            modId: 'mod-d', providerId: 'netease', origin: 'host', perSource: false,
            signal: new AbortController().signal, answerWithinMs: null, what: 'platform.raw netease x',
        }, () => Promise.resolve('raw')));
        await flush();
        expect(raw.value).toBe('raw');
    });

    it('leaves requests without the allowance per source (platform.raw) out of the source\'s places', () => {
        const held = holdAnswers();
        labels('a', 8).forEach((label) => void gateFor('mod-a').run('netease', held.work(label)));
        void runFoliumRequest({
            modId: 'mod-b', providerId: 'netease', origin: 'host', perSource: false,
            signal: new AbortController().signal, answerWithinMs: null, what: 'platform.raw netease x',
        }, held.work('raw'));
        expect(held.sent).toContain('raw');
    });
});

describe('time limits', () => {
    it('rejects network 30 s after the call, the request keeping its place, and gives it back 120 s after sending', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
        const held = holdAnswers();
        const gate = gateFor('mod-a');
        const calls = labels('r', 8).map((label) => watch(gate.run('netease', held.work(label))));
        await vi.advanceTimersByTimeAsync(29_999);
        expect(calls.some((call) => call.settled)).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(calls.every((call) => call.failure === 'network')).toBe(true);
        // Their places are still taken: one more waits, and gives up unsent after its own 30 s.
        await vi.advanceTimersByTimeAsync(1_000);
        const unsent = watch(gate.run('netease', held.work('unsent')));
        await vi.advanceTimersByTimeAsync(30_000);
        expect(unsent.failure).toBe('network');
        expect(held.sent).not.toContain('unsent');
        // 120 s after they were sent the eight give their places back, each with a line in the log.
        await vi.advanceTimersByTimeAsync(39_000);
        const next = watch(gate.run('netease', held.work('next')));
        expect(held.sent).not.toContain('next');
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('still under way'));
        await vi.advanceTimersByTimeAsync(20_000);
        expect(held.sent).toContain('next');
        expect(warn.mock.calls.filter(([line]: unknown[]) => String(line).includes('still under way 120 s after it was sent'))).toHaveLength(8);
        held.answer('next');
        await vi.advanceTimersByTimeAsync(0);
        expect(next.value).toBe('next');
        // A late answer of one of the eight gives nothing back twice: eight places, no more.
        held.answer('r0');
        await vi.advanceTimersByTimeAsync(0);
        labels('s', 9).forEach((label) => void gate.run('netease', held.work(label)));
        expect(held.sent.filter((label) => label.startsWith('s'))).toEqual(labels('s', 8));
    });

    it('never sends a waiting request whose 30 s ran out, though a place reaches it before its own timer fires', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
        const held = holdAnswers();
        // mod-b holds all of netease's places; mod-a has one call waiting for netease (holding a place of
        // mod-a's), seven under way at qq and one waiting for a place of mod-a's to go to kugou, all made in
        // the same moment. The netease call's timer fires first and gives its mod place back.
        labels('b', 8).forEach((label) => void gateFor('mod-b').run('netease', held.work(label)).catch(() => {}));
        const waitingForSource = watch(gateFor('mod-a').run('netease', held.work('a-netease')));
        labels('q', 7).forEach((label) => void gateFor('mod-a').run('qq', held.work(label)).catch(() => {}));
        const waitingForMod = watch(gateFor('mod-a').run('kugou', held.work('a-kugou')));
        await vi.advanceTimersByTimeAsync(30_000);
        expect(waitingForSource.failure).toBe('network');
        expect(waitingForMod.failure).toBe('network');
        expect(held.sent).not.toContain('a-kugou');
        // The seven at qq still hold their places; the eighth is free again.
        void gateFor('mod-a').run('kugou', held.work('fresh'));
        expect(held.sent.at(-1)).toBe('fresh');
    });

    it('holds no place for a mod\'s source but still answers network after 30 s', async () => {
        vi.useFakeTimers();
        const held = holdAnswers();
        const call = watch(gateFor('mod-a').run('folium.mod-b.songs', held.work('hangs')));
        await vi.advanceTimersByTimeAsync(30_000);
        expect(call.failure).toBe('network');
    });

    it('sets no answer limit for a request that has one of its own (platform.raw), but still the 120 s give-back', async () => {
        vi.useFakeTimers();
        const held = holdAnswers();
        const raw = (label: string) => watch(runFoliumRequest({
            modId: 'mod-a', providerId: 'netease', origin: 'host', perSource: false,
            signal: new AbortController().signal, answerWithinMs: null, what: `platform.raw netease ${label}`,
        }, held.work(label)));
        const calls = labels('r', 8).map(raw);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(calls.some((call) => call.settled)).toBe(false);
        raw('r8');
        expect(held.sent).not.toContain('r8');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(held.sent).toContain('r8');
        expect(calls.some((call) => call.settled)).toBe(false);
    });
});

describe('resetFoliumRequestQuotasForTest', () => {
    it('forgets every mod\'s and every source\'s allowance', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
        const held = holdAnswers();
        labels('r', 8).forEach((label) => void gateFor('mod-a').run('netease', held.work(label)));
        labels('f', 112).forEach(() => void gateFor('mod-a').run('netease', () => Promise.resolve('f')).catch(() => {}));
        await expect(failureOf(gateFor('mod-a').run('netease', held.work('over')))).resolves.toBe('rate-limited');
        resetFoliumRequestQuotasForTest();
        void gateFor('mod-a').run('netease', held.work('fresh'));
        expect(held.sent).toContain('fresh');
    });
});
