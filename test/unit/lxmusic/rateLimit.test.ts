import { PassThrough, type Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEgress } from '../../../sources/lxmusic/main/egress';
import {
    createConcurrencyGate, createRateGate, guardStream, LIMITS, RateLimitedError,
} from '../../../sources/lxmusic/main/rateLimit';
import { answerLxRequest } from '../../../sources/lxmusic/main/sandboxHost';

// test/unit/lxmusic/rateLimit.test.ts
// 洛雪出口的三道限制：每秒请求数（按主机、按模组）、同时在途数（排队与拒绝）、音频回答的字节上限与空闲超时。
// 时间都是假的（vi.useFakeTimers），没有一个请求真的发出去。

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const settled = async (promise: Promise<unknown>): Promise<'pending' | 'resolved' | 'rejected'> => {
    let state: 'pending' | 'resolved' | 'rejected' = 'pending';
    promise.then(() => { state = 'resolved'; }, () => { state = 'rejected'; });
    await Promise.resolve();
    await Promise.resolve();
    return state;
};

describe('the requests-per-second gate', () => {
    const gate = () => createRateGate({ perHost: { perSecond: 2, burst: 3 }, total: { perSecond: 4, burst: 5 }, maxWaitMs: 2_000 });

    it('lets a burst through at once, then makes a host wait for its next token', async () => {
        const rate = gate();
        for (let i = 0; i < 3; i += 1) expect(await settled(rate.take('a.example'))).toBe('resolved');
        const fourth = rate.take('a.example');
        expect(await settled(fourth)).toBe('pending');
        await vi.advanceTimersByTimeAsync(499);
        expect(await settled(fourth)).toBe('pending');
        await vi.advanceTimersByTimeAsync(1);
        expect(await settled(fourth)).toBe('resolved');
    });

    it('keeps a bucket per host, and one over all of them that a script cannot dodge with new names', async () => {
        const rate = gate();
        // Five names, one request each: the hosts' own buckets are full, the module's is now empty.
        for (const host of ['a', 'b', 'c', 'd', 'e']) expect(await settled(rate.take(`${host}.example`))).toBe('resolved');
        const sixth = rate.take('f.example');
        expect(await settled(sixth)).toBe('pending');
        await vi.advanceTimersByTimeAsync(250);
        expect(await settled(sixth)).toBe('resolved');
    });

    it('refuses instead of queueing when the wait would be too long, and takes no token for it', async () => {
        const rate = gate();
        const waiting: Array<Promise<void>> = [];
        for (let i = 0; i < 3; i += 1) await rate.take('a.example');
        // Each waits 500 ms more than the one before: the fifth would wait 2.5 s.
        for (let i = 0; i < 4; i += 1) waiting.push(rate.take('a.example'));
        await expect(rate.take('a.example')).rejects.toBeInstanceOf(RateLimitedError);
        await expect(rate.take('a.example')).rejects.toThrow(/rate limited/);
        await vi.advanceTimersByTimeAsync(2_000);
        for (const promise of waiting) expect(await settled(promise)).toBe('resolved');
        // The refused ones left no debt: half a second later the next one is through.
        const next = rate.take('a.example');
        await vi.advanceTimersByTimeAsync(500);
        expect(await settled(next)).toBe('resolved');
    });

    it('fills up again while nothing is asked', async () => {
        const rate = gate();
        for (let i = 0; i < 3; i += 1) await rate.take('a.example');
        await vi.advanceTimersByTimeAsync(60_000);
        for (let i = 0; i < 3; i += 1) expect(await settled(rate.take('a.example'))).toBe('resolved');
        expect(await settled(rate.take('a.example'))).toBe('pending');
    });

    it('stops waiting when the request is aborted', async () => {
        const rate = gate();
        for (let i = 0; i < 3; i += 1) await rate.take('a.example');
        const controller = new AbortController();
        const waiting = rate.take('a.example', controller.signal);
        controller.abort();
        await expect(waiting).rejects.toThrow(/aborted/);
    });

    it('treats a host name the same in any case, and forgets the hosts used longest ago', async () => {
        const rate = createRateGate({ perHost: { perSecond: 1, burst: 1 }, total: { perSecond: 1000, burst: 1000 }, maxWaitMs: 5_000, maxHosts: 2 });
        await rate.take('A.example');
        expect(await settled(rate.take('a.EXAMPLE'))).toBe('pending');
        await rate.take('b.example');
        await rate.take('c.example');
        // a.example was pushed out: it starts from a full bucket again. Only the module's bucket bounds that.
        expect(await settled(rate.take('a.example'))).toBe('resolved');
    });

    it('gives the token back when the wait is aborted, so requests that never went out leave no debt', async () => {
        const rate = gate();
        for (let i = 0; i < 3; i += 1) await rate.take('a.example');
        // A script that sends requests with a one-second limit, over and over: each waits, gives up, and is not sent.
        for (let round = 0; round < 20; round += 1) {
            const controller = new AbortController();
            const waiting = rate.take('a.example', controller.signal);
            controller.abort();
            await expect(waiting).rejects.toThrow(/aborted/);
        }
        const next = rate.take('a.example');
        await vi.advanceTimersByTimeAsync(500);
        expect(await settled(next)).toBe('resolved');
    });

    it('does not run into debt when the clock goes backwards', async () => {
        let clock = 10_000_000;
        const rate = createRateGate({ perHost: { perSecond: 2, burst: 3 }, total: { perSecond: 4, burst: 5 }, maxWaitMs: 2_000, now: () => clock });
        await rate.take('a.example');
        clock -= 3_600_000;
        expect(await settled(rate.take('a.example'))).toBe('resolved');
        expect(await settled(rate.take('a.example'))).toBe('resolved');
    });

    it('counts a name with a trailing dot as the same host', async () => {
        const rate = gate();
        for (const name of ['a.example', 'a.example.', 'A.EXAMPLE.']) expect(await settled(rate.take(name))).toBe('resolved');
        expect(await settled(rate.take('a.example'))).toBe('pending');
    });

    it('is asked once for every hop of the egress, after the address is judged', async () => {
        const asked: string[] = [];
        const egress = createEgress({ gate: async (hostname) => { asked.push(hostname); } });
        // A blocked address is refused before it can take a place in the queue.
        await expect(egress.fetchBytes({ url: 'http://127.0.0.1:8080/' }, 1024)).rejects.toThrow(/egress blocked \(loopback\)/);
        await expect(egress.fetchBytes({ url: 'http://example.com:25/' }, 1024)).rejects.toThrow(/egress blocked \(port\)/);
        await expect(egress.fetchBytes({ url: 'file:///etc/passwd' }, 1024)).rejects.toThrow(/egress blocked \(protocol\)/);
        expect(asked).toEqual([]);
        const refusing = createEgress({ gate: async () => { throw new RateLimitedError('too many requests'); } });
        await expect(refusing.fetchBytes({ url: 'http://[2001:4860:4860::8888]/' }, 1024)).rejects.toBeInstanceOf(RateLimitedError);
    });
});

describe('the gate on requests in flight', () => {
    const deferred = () => {
        let release: () => void = () => undefined;
        const promise = new Promise<void>((resolve) => { release = resolve; });
        return { promise, release };
    };

    it('runs up to the limit of a host, queues the rest, and starts them as places free up', async () => {
        const gate = createConcurrencyGate({ perHost: 2, total: 3, maxQueue: 4 });
        const started: string[] = [];
        const holds = [deferred(), deferred(), deferred()];
        const runs = holds.map((hold, index) => gate.run('a.example', async () => { started.push(`a${index}`); await hold.promise; return index; }));
        await Promise.resolve();
        expect(started).toEqual(['a0', 'a1']);
        expect(gate.size()).toEqual({ running: 2, queued: 1 });
        holds[0].release();
        expect(await runs[0]).toBe(0);
        await Promise.resolve();
        expect(started).toEqual(['a0', 'a1', 'a2']);
        holds[1].release();
        holds[2].release();
        await Promise.all(runs);
        expect(gate.size()).toEqual({ running: 0, queued: 0 });
    });

    it('holds the whole module to its total, and lets a free host pass a queued one', async () => {
        const gate = createConcurrencyGate({ perHost: 1, total: 2, maxQueue: 4 });
        const started: string[] = [];
        const hold = { a: deferred(), b: deferred() };
        const first = gate.run('a.example', async () => { started.push('a'); await hold.a.promise; });
        const second = gate.run('b.example', async () => { started.push('b'); await hold.b.promise; });
        const queuedSameHost = gate.run('b.example', async () => { started.push('b2'); });
        const queuedOther = gate.run('c.example', async () => { started.push('c'); });
        await Promise.resolve();
        expect(started).toEqual(['a', 'b']);
        // a's place goes to c: b.example is still busy with its one.
        hold.a.release();
        await first;
        await queuedOther;
        expect(started).toEqual(['a', 'b', 'c']);
        hold.b.release();
        await Promise.all([second, queuedSameHost]);
        expect(started).toEqual(['a', 'b', 'c', 'b2']);
    });

    it('refuses once the queue is full, and frees the place of a request that failed', async () => {
        const gate = createConcurrencyGate({ perHost: 1, total: 1, maxQueue: 1 });
        const hold = deferred();
        const failing = gate.run('a.example', async () => { await hold.promise; throw new Error('boom'); });
        const queued = gate.run('a.example', async () => 'after');
        await expect(gate.run('a.example', async () => 'never')).rejects.toBeInstanceOf(RateLimitedError);
        hold.release();
        await expect(failing).rejects.toThrow('boom');
        expect(await queued).toBe('after');
        expect(gate.size()).toEqual({ running: 0, queued: 0 });
    });

    it('does not let two that leave in the same turn hand one place out twice', async () => {
        const gate = createConcurrencyGate({ perHost: 1, total: 2, maxQueue: 4 });
        const hold = { a: deferred(), b: deferred(), a2: deferred(), a3: deferred() };
        let together = 0;
        let most = 0;
        const onA = (wait: Promise<void>) => async () => {
            together += 1;
            most = Math.max(most, together);
            await wait;
            together -= 1;
        };
        const first = gate.run('a.example', onA(hold.a.promise));
        const other = gate.run('b.example', () => hold.b.promise);
        const second = gate.run('a.example', onA(hold.a2.promise));
        const third = gate.run('a.example', onA(hold.a3.promise));
        hold.a.release();
        hold.b.release();
        await Promise.all([first, other]);
        await Promise.resolve();
        expect(gate.size()).toEqual({ running: 1, queued: 1 });
        hold.a2.release();
        hold.a3.release();
        await Promise.all([second, third]);
        expect(most).toBe(1);
        expect(gate.size()).toEqual({ running: 0, queued: 0 });
    });

    it('drops a queued request whose window is gone, and never starts it', async () => {
        const gate = createConcurrencyGate({ perHost: 1, total: 1, maxQueue: 4 });
        const hold = deferred();
        const busy = gate.run('a.example', () => hold.promise);
        const window = new AbortController();
        let started = false;
        const queued = gate.run('a.example', async () => { started = true; }, window.signal);
        const later = gate.run('a.example', async () => 'later');
        expect(gate.size()).toEqual({ running: 1, queued: 2 });
        window.abort();
        await expect(queued).rejects.toThrow(/aborted/);
        expect(gate.size()).toEqual({ running: 1, queued: 1 });
        hold.release();
        await busy;
        expect(await later).toBe('later');
        expect(started).toBe(false);
        expect(gate.size()).toEqual({ running: 0, queued: 0 });
        await expect(gate.run('a.example', async () => 'never', window.signal)).rejects.toThrow(/aborted/);
    });

    it('tells the script it was limited, with no more than that', async () => {
        const gate = createConcurrencyGate({ perHost: 1, total: 1, maxQueue: 0 });
        const hold = deferred();
        const busy = gate.run('example.com', () => hold.promise);
        const answer = await (await answerLxRequest(createEgress(), { url: 'http://example.com/' }, gate)).json();
        expect(answer).toEqual({ ok: false, error: 'rate limited (too many requests at once)' });
        hold.release();
        await busy;
    });
});

describe('the guard around a forwarded audio answer', () => {
    const collect = (stream: Readable) => {
        const chunks: Buffer[] = [];
        const done = new Promise<Error | null>((resolve) => {
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => resolve(null));
            stream.on('error', resolve);
        });
        return { chunks, done };
    };
    const tick = () => vi.advanceTimersByTimeAsync(0);

    it('passes the bytes through and says when it ended', async () => {
        const upstream = new PassThrough();
        const closed: string[] = [];
        const { chunks, done } = collect(guardStream(upstream, { maxBytes: 100, idleMs: 1_000, onClose: reason => closed.push(reason) }));
        upstream.write(Buffer.from('hello '));
        upstream.end(Buffer.from('world'));
        await tick();
        expect(await done).toBeNull();
        expect(Buffer.concat(chunks).toString()).toBe('hello world');
        expect(closed).toEqual(['end']);
    });

    it('cuts an answer that grows past the limit, and closes the connection it came on', async () => {
        const upstream = new PassThrough();
        const closed: string[] = [];
        const { chunks, done } = collect(guardStream(upstream, { maxBytes: 10, idleMs: 1_000, onClose: reason => closed.push(reason) }));
        upstream.write(Buffer.alloc(8));
        await tick();
        upstream.write(Buffer.alloc(8));
        await tick();
        expect((await done)?.message).toMatch(/larger than the limit/);
        expect(Buffer.concat(chunks)).toHaveLength(8);
        expect(upstream.destroyed).toBe(true);
        expect(closed).toEqual(['too-large']);
    });

    it('cuts a source that sends nothing while we wait for it', async () => {
        const upstream = new PassThrough();
        const closed: string[] = [];
        const { done } = collect(guardStream(upstream, { maxBytes: 1_000, idleMs: 1_000, onClose: reason => closed.push(reason) }));
        upstream.write(Buffer.alloc(8));
        await tick();
        await vi.advanceTimersByTimeAsync(999);
        expect(closed).toEqual([]);
        // Data restarts the wait.
        upstream.write(Buffer.alloc(8));
        await tick();
        await vi.advanceTimersByTimeAsync(999);
        expect(closed).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect((await done)?.message).toMatch(/sent nothing for too long/);
        expect(upstream.destroyed).toBe(true);
        expect(closed).toEqual(['idle']);
    });

    it('does not count the time the player itself is not reading', async () => {
        const upstream = new PassThrough();
        const closed: string[] = [];
        const guarded = guardStream(upstream, { maxBytes: 10_000_000, idleMs: 1_000, onClose: reason => closed.push(reason) });
        // Nobody reads yet: nothing is asked of the source, however long that lasts.
        await vi.advanceTimersByTimeAsync(60_000);
        expect(closed).toEqual([]);
        // The reader takes one chunk and stops (a full buffer, a paused player): the source is paused, not slow.
        upstream.write(Buffer.alloc(64 * 1024));
        upstream.write(Buffer.alloc(64 * 1024));
        guarded.once('readable', () => { guarded.read(); });
        await tick();
        await vi.advanceTimersByTimeAsync(600_000);
        expect(closed).toEqual([]);
        expect(guarded.destroyed).toBe(false);
        // It reads on: everything arrives.
        const { done } = collect(guarded);
        upstream.end();
        await tick();
        expect(await done).toBeNull();
        expect(closed).toEqual(['end']);
    });

    it('closes the source when the player drops the answer, and reports a source that hangs up early', async () => {
        const dropped = new PassThrough();
        const closed: string[] = [];
        const guarded = guardStream(dropped, { maxBytes: 100, idleMs: 1_000, onClose: reason => closed.push(reason) });
        guarded.destroy();
        await tick();
        expect(dropped.destroyed).toBe(true);
        expect(closed).toEqual(['cancelled']);

        const hungUp = new PassThrough();
        const { done } = collect(guardStream(hungUp, { maxBytes: 100, idleMs: 1_000, onClose: reason => closed.push(reason) }));
        hungUp.write(Buffer.from('half'));
        await tick();
        hungUp.destroy();
        await tick();
        // Half a song must not pass for a whole one.
        expect((await done)?.message).toMatch(/closed the connection/);
        expect(closed).toEqual(['cancelled', 'error']);
    });
});

describe('the limits the main entry uses', () => {
    it('leaves room for ordinary use: ten songs in a row, a long lossless track', () => {
        // Ten songs of three requests each to one host fit the host's burst plus what it earns meanwhile.
        expect(LIMITS.rate.perHost.burst).toBeGreaterThanOrEqual(20);
        expect(LIMITS.rate.total.burst).toBeGreaterThanOrEqual(LIMITS.rate.perHost.burst);
        expect(LIMITS.concurrency.total).toBeGreaterThanOrEqual(LIMITS.concurrency.perHost);
        // Scrubbing: twenty ranged reads in a row, each through a CDN redirect or two, must not wait.
        expect(LIMITS.audioRate.perHost.burst).toBeGreaterThanOrEqual(20 * 3);
        expect(LIMITS.audioRate.total.burst).toBeGreaterThanOrEqual(LIMITS.audioRate.perHost.burst);
        // An hour of 24 bit / 192 kHz FLAC is about 2.5 GiB.
        expect(LIMITS.maxStreamBytes).toBeGreaterThan(2.5 * 1024 ** 3);
        expect(LIMITS.maxStreams).toBeGreaterThanOrEqual(4);
        expect(LIMITS.streamIdleMs).toBeGreaterThanOrEqual(15_000);
    });
});
