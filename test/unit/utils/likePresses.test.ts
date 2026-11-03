import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLikePresses } from '@/utils/likePresses';

// test/unit/utils/likePresses.test.ts
// The rule between a press on a heart and the service holding the new state: one request at a
// time for a song, the service ends with the state the listener left, a failed request ends
// the run, and so does one that goes 20 seconds without an answer.

// A service whose answers the test gives one by one.
const service = () => {
    const requests: Array<{ liked: boolean; take: () => void; refuse: (error: unknown) => void }> = [];
    let underWay = 0;
    const seen = { mostAtOnce: 0 };
    const send = (liked: boolean): Promise<void> => {
        underWay += 1;
        seen.mostAtOnce = Math.max(seen.mostAtOnce, underWay);
        return new Promise<void>((take, refuse) => { requests.push({ liked, take, refuse }); })
            .finally(() => { underWay -= 1; });
    };
    return { requests, seen, send };
};

// Lets the promise callbacks queued so far run.
const settleCallbacks = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });

describe('like presses', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('counts a request with no answer after 20 seconds as failed, and tells the request that nobody waits for it', async () => {
        vi.useFakeTimers();
        const signals: AbortSignal[] = [];
        const send = vi.fn((_liked: boolean, signal: AbortSignal) => {
            signals.push(signal);
            return new Promise<void>(() => {});
        });
        const presses = createLikePresses({ name: 'test' });

        const press = presses.press('song', true, send);
        await vi.advanceTimersByTimeAsync(19_999);
        expect(presses.wanted()).toEqual({ song: true });
        expect(signals[0].aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await expect(press.settled).resolves.toMatchObject({ ok: false, error: new Error('no answer in 20 s') });
        expect(presses.wanted()).toEqual({});
        expect(signals[0].aborted).toBe(true);
        // The run is over: the next press begins one of its own.
        expect(presses.press('song', true, send).joined).toBe(false);
    });

    it('does not count an answer that came in time as failed once the 20 seconds have passed', async () => {
        vi.useFakeTimers();
        const { requests, send } = service();
        const presses = createLikePresses({ name: 'test' });

        const press = presses.press('song', true, send);
        await vi.advanceTimersByTimeAsync(19_000);
        requests[0].take();
        await expect(press.settled).resolves.toEqual({ ok: true, liked: true });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('gives each request of a run its own 20 seconds', async () => {
        vi.useFakeTimers();
        const { requests, send } = service();
        const presses = createLikePresses({ name: 'test' });

        const press = presses.press('song', true, send);
        presses.press('song', false, send);
        await vi.advanceTimersByTimeAsync(15_000);
        requests[0].take();
        await vi.advanceTimersByTimeAsync(15_000);
        // 30 seconds since the press, 15 since the second request went out.
        expect(presses.wanted()).toEqual({ song: false });

        await vi.advanceTimersByTimeAsync(5_000);
        await expect(press.settled).resolves.toMatchObject({ ok: false, confirmed: true });
    });

    it('sends a press made during a request once that request is over, never two at a time', async () => {
        const { requests, seen, send } = service();
        const presses = createLikePresses({ name: 'test' });

        const first = presses.press('song', true, send);
        const second = presses.press('song', false, send);

        expect(first).toMatchObject({ wanted: true, joined: false });
        expect(second).toMatchObject({ wanted: false, joined: true });
        expect(second.settled).toBe(first.settled);
        expect(requests.map(request => request.liked)).toEqual([true]);
        expect(presses.wanted()).toEqual({ song: false });

        requests[0].take();
        await settleCallbacks();
        expect(requests.map(request => request.liked)).toEqual([true, false]);
        expect(presses.wanted()).toEqual({ song: false });

        requests[1].take();
        await expect(first.settled).resolves.toEqual({ ok: true, liked: false });
        expect(seen.mostAtOnce).toBe(1);
        expect(presses.wanted()).toEqual({});
    });

    it('sends nothing more when the presses come back to what was sent', async () => {
        const { requests, send } = service();
        const presses = createLikePresses({ name: 'test' });

        const first = presses.press('song', true, send);
        presses.press('song', false, send);
        presses.press('song', true, send);
        requests[0].take();

        await expect(first.settled).resolves.toEqual({ ok: true, liked: true });
        expect(requests).toHaveLength(1);
    });

    it('keeps the songs apart: a request for one does not hold back another', () => {
        const { requests, send } = service();
        const presses = createLikePresses({ name: 'test' });

        presses.press('one', true, send);
        presses.press('other', false, send);

        expect(requests.map(request => request.liked)).toEqual([true, false]);
        expect(presses.wanted()).toEqual({ one: true, other: false });
    });

    it('ends the run when a request fails: nothing is wanted any more, nothing more is sent', async () => {
        const { requests, send } = service();
        const presses = createLikePresses({ name: 'test' });
        const error = new Error('offline');

        const first = presses.press('song', true, send);
        presses.press('song', false, send);
        requests[0].refuse(error);

        await expect(first.settled).resolves.toEqual({ ok: false, error });
        expect(requests).toHaveLength(1);
        expect(presses.wanted()).toEqual({});
        // The next press begins a run of its own.
        expect(presses.press('song', true, send).joined).toBe(false);
    });

    it('tells the last state the service took when a later request of the run fails', async () => {
        const { requests, send } = service();
        const presses = createLikePresses({ name: 'test' });
        const error = new Error('offline');

        const first = presses.press('song', true, send);
        presses.press('song', false, send);
        requests[0].take();
        await settleCallbacks();
        requests[1].refuse(error);

        await expect(first.settled).resolves.toEqual({ ok: false, error, confirmed: true });
    });

    it('tells what is wanted at every change, and nothing once the run is over', async () => {
        const { requests, send } = service();
        const changes: Array<Record<string, boolean>> = [];
        const presses = createLikePresses({ name: 'test', onChange: wanted => changes.push(wanted) });

        const first = presses.press('song', true, send);
        presses.press('song', false, send);
        requests[0].take();
        await settleCallbacks();
        requests[1].take();
        await first.settled;

        expect(changes).toEqual([{ song: true }, { song: false }, {}]);
    });

    it('leaves no timer behind when a send throws at once', async () => {
        vi.useFakeTimers();
        const presses = createLikePresses({ name: 'test' });

        const press = presses.press('song', true, () => { throw new Error('thrown at once'); });

        expect(await press.settled).toMatchObject({ ok: false });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not count a song whose request failed as taken', async () => {
        const { requests, send } = service();
        const presses = createLikePresses({ name: 'test', now: () => 100 });

        const press = presses.press('song', true, send);
        requests[0].refuse(new Error('refused'));
        await press.settled;

        expect(presses.touchedSince('song', 0)).toBe(false);
    });

    it('knows which songs have an unsettled press, or a request taken since a moment', async () => {
        const { requests, send } = service();
        let clock = 100;
        const presses = createLikePresses({ name: 'test', now: () => clock });

        const press = presses.press('song', true, send);
        clock = 5_000;
        // Unsettled: pressed long ago, and still to be kept.
        expect(presses.touchedSince('song', 4_000)).toBe(true);

        requests[0].take();
        await press.settled;
        expect(presses.touchedSince('song', 5_000)).toBe(true);
        expect(presses.touchedSince('song', 5_001)).toBe(false);
        expect(presses.touchedSince('never pressed', 0)).toBe(false);
    });

    it('forgets every press: none is wanted or touched any more, and a request under way ends with nothing more', async () => {
        const { requests, send } = service();
        const told: Array<Record<string, boolean>> = [];
        const presses = createLikePresses({ name: 'test', now: () => 100, onChange: wanted => told.push(wanted) });

        const taken = presses.press('taken', true, send);
        requests[0].take();
        await taken.settled;
        const forgotten = presses.press('under way', true, send);
        presses.press('under way', false, send);

        presses.forget();
        expect(presses.wanted()).toEqual({});
        expect(told.at(-1)).toEqual({});
        expect(presses.touchedSince('taken', 0)).toBe(false);
        expect(presses.touchedSince('under way', 0)).toBe(false);

        // A press after it begins a run of its own, which the end of the forgotten run leaves alone.
        const again = presses.press('under way', true, send);
        expect(again.joined).toBe(false);
        requests[1].take();
        await expect(forgotten.settled).resolves.toEqual({ ok: true, liked: true });
        // The forgotten run sent nothing for the state wanted before it was forgotten.
        expect(requests.map(request => request.liked)).toEqual([true, true, true]);
        expect(presses.wanted()).toEqual({ 'under way': true });

        requests[2].take();
        await again.settled;
        expect(presses.wanted()).toEqual({});
        expect(presses.touchedSince('under way', 100)).toBe(true);
    });

    it('records nothing for a forgotten request the service takes late', async () => {
        const { requests, send } = service();
        const presses = createLikePresses({ name: 'test', now: () => 100 });

        const press = presses.press('song', true, send);
        presses.forget();
        requests[0].take();
        await press.settled;

        expect(presses.touchedSince('song', 0)).toBe(false);
    });
});
