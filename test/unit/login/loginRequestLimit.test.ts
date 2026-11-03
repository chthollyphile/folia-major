import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropLoginRequestLimits, LOGIN_REQUEST_LIMIT_MS, LoginRequestTimeout, withLoginRequestLimit } from '@/services/onlineMusic/login/loginRequestLimit';

// test/unit/login/loginRequestLimit.test.ts
// The time limit of the requests a sign-in makes, under fake timers. Which requests of which
// platform get it, and the case it ends in, is in test/unit/onlineMusic/loginFailurePlatforms.test.ts; what the
// sign-in does with it (stops timing them when it stops, the no-answer case) is in
// test/unit/library/core/providerLoginSession.test.ts.

// A request that never answers. Like fetch, it ends only when it is aborted.
const neverAnswers = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
});

describe('the time limit of a sign-in request', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('ends a request that is not answered in 20 s: it fails with LoginRequestTimeout, is aborted, and leaves no timer', async () => {
        expect(LOGIN_REQUEST_LIMIT_MS).toBe(20_000);
        let signal: AbortSignal | undefined;
        const outcome = withLoginRequestLimit(given => { signal = given; return neverAnswers(given); }).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(19_999);
        expect(signal!.aborted).toBe(false);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        const error = await outcome;
        expect(error).toBeInstanceOf(LoginRequestTimeout);
        expect(error).toMatchObject({ name: 'LoginRequestTimeout', message: 'The sign-in request was not answered in 20 s' });
        expect(signal!.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stops waiting for a request that cannot be aborted', async () => {
        const outcome = withLoginRequestLimit(() => new Promise<never>(() => { })).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(await outcome).toBeInstanceOf(LoginRequestTimeout);
    });

    it('leaves a request that is answered in time as it is: its answer or its own error, and no timer', async () => {
        await expect(withLoginRequestLimit(async () => 'answer')).resolves.toBe('answer');
        const refused = new Error('refused');
        await expect(withLoginRequestLimit(async () => { throw refused; })).rejects.toBe(refused);
        expect(vi.getTimerCount()).toBe(0);

        let signal: AbortSignal | undefined;
        let answer: (value: string) => void = () => { };
        const late = withLoginRequestLimit(given => { signal = given; return new Promise<string>(resolve => { answer = resolve; }); });
        await vi.advanceTimersByTimeAsync(19_999);
        answer('just in time');
        await expect(late).resolves.toBe('just in time');
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(signal!.aborted).toBe(false);
    });

    it('leaves no timer when the request throws at once instead of answering with a promise', async () => {
        const atOnce = new Error('thrown before anything was sent');
        await expect(withLoginRequestLimit(() => { throw atOnce; })).rejects.toBe(atOnce);
        expect(vi.getTimerCount()).toBe(0);
        await expect(withLoginRequestLimit((() => 'no promise') as never)).resolves.toBe('no promise');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stops timing the requests still waiting when the sign-in is given up, without ending them', async () => {
        let signal: AbortSignal | undefined;
        let answer: (value: string) => void = () => { };
        const waiting = withLoginRequestLimit(given => { signal = given; return new Promise<string>(resolve => { answer = resolve; }); });
        void withLoginRequestLimit(() => new Promise<never>(() => { }));
        expect(vi.getTimerCount()).toBe(2);
        dropLoginRequestLimits();
        expect(vi.getTimerCount()).toBe(0);

        // The request runs on: a code made late is still handed to whoever waits for it.
        await vi.advanceTimersByTimeAsync(60_000);
        expect(signal!.aborted).toBe(false);
        answer('late key');
        await expect(waiting).resolves.toBe('late key');

        // A request made after that is timed again.
        const next = withLoginRequestLimit(neverAnswers).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(await next).toBeInstanceOf(LoginRequestTimeout);
    });
});
