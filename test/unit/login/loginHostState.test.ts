import { describe, expect, it } from 'vitest';
import { createLoginHostState } from '@/components/login/loginHostState';
import { loginHostMounted, openLoginWindow, useLoginWindowStore } from '@/components/login/loginWindowStore';
import type { LibraryLoginCompletion, LibraryLoginPhase, LibraryLoginSessionSnapshot } from '@/library/core/account/account.contract';
import type { ProviderAccountSummary } from '@/types/onlineMusic';

// test/unit/login/loginHostState.test.ts
// What the sign-in window does when a row is chosen and when an answer comes late. The sign-in itself
// (codes, checks, methods, the failure cases) is the account controller's; the window starts it when a
// row that needs one is chosen, and stops it when another row is chosen or the window closes. The rule
// of the window is "the turn": choosing a row, closing the window and unmounting the host each end it,
// and a switch or a sign-out answered in an ended turn does nothing. Every order of events below is
// forced by hand: nothing here waits on a clock.

const row = (providerId: string, extra: Partial<ProviderAccountSummary> = {}): ProviderAccountSummary => ({
    providerId, shortName: providerId, displayName: providerId, availability: { configured: true }, status: 'anonymous', user: null, collections: [], ...extra,
});
const ROWS = [
    row('code-a'), row('code-b'),
    row('in', { status: 'authenticated', user: { id: 1, nickname: 'someone' } }),
    row('out', { error: 'auth-required' }),
    row('free', { requiresAccount: false }),
    row('off', { availability: { configured: false, reason: 'not-configured' } }),
];

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
const deferred = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => { resolve = yes; });
    return { promise, resolve };
};
// Lets every answer already given be acted on.
const settle = async () => { for (let turn = 0; turn < 5; turn += 1) await Promise.resolve(); };

const sessionOf = (providerId: string, phase: LibraryLoginPhase): LibraryLoginSessionSnapshot => ({
    id: 1, providerId, phase, methods: [], selectedMethodId: null, inBrowser: false, codeImage: '', canReopenLoginPage: true,
    failure: null, selfCheck: null, localService: { available: false, failed: false, error: null, restarting: false }, texts: null,
});
const completion = (providerId: string, outcome: LibraryLoginCompletion['outcome'] = 'completed'): LibraryLoginCompletion => ({ sessionId: 1, providerId, outcome });

// `plays`: the animation after a sign-in is on (motion is on). Off unless a test asks for it;
// `motion.on` switches it while a test runs. `rows` are the test's own: it may change one.
const setup = ({ plays = false } = {}) => {
    const said: string[] = [];
    const motion = { on: plays };
    const rows = [...ROWS];
    // The controller's sign-in, as the window sees it.
    const sign = { login: null as LibraryLoginSessionSnapshot | null };
    const host = createLoginHostState({
        rows: () => rows,
        login: () => sign.login,
        startLogin: providerId => { said.push(`start ${providerId}`); sign.login = sessionOf(providerId, 'resolving-methods'); },
        closeLogin: () => { said.push('stop'); sign.login = null; },
        // The store's close: the host hears of it and ends the turn (LoginHost.tsx's effect).
        closeWindow: () => { said.push('close'); host.closed(); },
        playsDone: () => motion.on,
        switchTo: providerId => ask('switch', providerId),
        signOut: providerId => ask('sign out', providerId),
    });
    // A switch and a sign-out are answered by hand: `answers` holds the last one asked.
    const answers: Record<string, Deferred<boolean>> = {};
    const ask = (what: string, providerId: string): Promise<boolean> => {
        said.push(`${what} ${providerId}`);
        answers[what] = deferred();
        return answers[what].promise;
    };
    const tell = async (what: string, yes: boolean) => { answers[what].resolve(yes); await settle(); };
    const goes = (phase: LibraryLoginPhase) => {
        sign.login = sign.login && { ...sign.login, phase };
        host.loginChanged();
    };
    return { host, said, sign, tell, motion, rows, goes };
};

describe('the sign-in window\'s host', () => {
    it('opened with no platform: chooses nothing, starts nothing', () => {
        const { host, said } = setup();
        host.opened(null);
        expect(host.getState()).toEqual({ chosen: null, done: false });
        // Whatever sign-in was left is stopped when the window opens.
        expect(said).toEqual(['stop']);
    });

    it('a chosen row leads on: a sign-in starts at once for a row that needs one, an account or no sign-in for the others', () => {
        const { host, said } = setup();
        host.opened('code-a');
        expect(host.getState().chosen).toEqual({ providerId: 'code-a', lead: 'sign-in' });
        host.choose('in');
        expect(host.getState().chosen).toEqual({ providerId: 'in', lead: 'account' });
        host.choose('free');
        expect(host.getState().chosen).toEqual({ providerId: 'free', lead: 'accountless' });
        // A sign-in that ran out leads to a sign-in again.
        host.choose('out');
        expect(host.getState().chosen).toEqual({ providerId: 'out', lead: 'sign-in' });
        expect(said).toEqual(['stop', 'start code-a', 'stop', 'stop', 'start out']);
    });

    it('a row out of reach, and a platform that is not listed, cannot be chosen', () => {
        const { host, said } = setup();
        host.opened(null);
        host.choose('off');
        host.choose('gone');
        expect(host.getState().chosen).toBeNull();
        expect(said).toEqual(['stop']);
    });

    it('closing stops the sign-in under way, once, whoever closes; a window that is not open stops nothing', () => {
        const { host, said } = setup();
        host.closed();
        expect(said).toEqual([]);
        host.opened('code-a');
        host.closed();
        host.closed();
        expect(said).toEqual(['stop', 'start code-a', 'stop']);
    });

    it('once the window is closed, a choose does nothing, and a completion plays nothing', () => {
        const { host, said } = setup({ plays: true });
        host.opened('code-a');
        host.closed();
        host.choose('code-b');
        host.completed(completion('code-a'));
        expect(host.getState()).toEqual({ chosen: { providerId: 'code-a', lead: 'sign-in' }, done: false });
        expect(said).toEqual(['stop', 'start code-a', 'stop']);
    });

    it('choosing the chosen row again while its sign-in is under way does nothing; after it ended it starts over', () => {
        const { host, said, goes } = setup();
        host.opened('code-a');
        for (const phase of ['resolving-methods', 'loading', 'waiting', 'scanned', 'confirmed'] as const) {
            goes(phase);
            host.choose('code-a');
        }
        expect(said).toEqual(['stop', 'start code-a']);
        for (const phase of ['choosing-method', 'ready', 'expired', 'error'] as const) {
            goes(phase);
            host.choose('code-a');
        }
        expect(said.filter(line => line === 'start code-a')).toHaveLength(5);
    });

    it('the chosen account row chosen again changes nothing: a switch awaited for it still acts; a sign-in that ran out meanwhile leads on', async () => {
        const { host, said, tell, rows } = setup();
        host.opened('in');
        host.switchToChosen();
        host.choose('in');
        await tell('switch', true);
        expect(said).toEqual(['stop', 'stop', 'switch in', 'close', 'stop']);

        host.opened('in');
        rows[2] = { ...rows[2], status: 'anonymous', user: null, error: 'auth-required' };
        host.choose('in');
        expect(host.getState().chosen).toEqual({ providerId: 'in', lead: 'sign-in' });
        expect(said.at(-1)).toBe('start in');
    });

    it('a switch or a sign-out that succeeded closes the window, one that did not leaves it', async () => {
        const { host, said, tell } = setup();
        host.opened('in');
        host.switchToChosen();
        await tell('switch', false);
        host.signOutChosen();
        await tell('sign out', false);
        expect(said).not.toContain('close');
        host.signOutChosen();
        await tell('sign out', true);
        expect(said.at(-2)).toBe('close');
    });

    it('a switch or a sign-out answered after its turn ended does nothing', async () => {
        const { host, said, tell } = setup();
        host.opened('in');
        host.switchToChosen();
        host.choose('free');
        await tell('switch', true);
        host.signOutChosen();
        host.closed();
        host.opened('in');
        await tell('sign out', true);
        expect(said).not.toContain('close');
        expect(useLoginWindowStore.getState().isOpen).toBe(false);
    });

    describe('once the account is read', () => {
        it('with motion on the window stays for the animation, and the animation ends when it is told so', () => {
            const { host, said } = setup({ plays: true });
            host.opened('code-a');
            host.completed(completion('code-a'));
            expect(host.getState().done).toBe(true);
            expect(said).not.toContain('close');
            host.doneEnded();
            expect(host.getState().done).toBe(false);
        });

        it('with motion off there is no animation: the window closes at once, also when the person said no to switching', () => {
            const { host, said } = setup();
            host.opened('code-a');
            host.completed(completion('code-a', 'activation-declined'));
            expect(host.getState().done).toBe(false);
            expect(said).toContain('close');
        });

        it('while the animation plays no row can be chosen and no sign-in started; opening the window again ends it', () => {
            const { host, said } = setup({ plays: true });
            host.opened('code-a');
            host.completed(completion('code-a'));
            host.choose('code-b');
            expect(said.filter(line => line.startsWith('start'))).toEqual(['start code-a']);
            host.opened('code-b');
            expect(host.getState()).toEqual({ chosen: { providerId: 'code-b', lead: 'sign-in' }, done: false });
        });

        it('motion switched off while the animation plays ends it and closes the window; switched off at any other time it does nothing', () => {
            const { host, said, motion } = setup({ plays: true });
            host.opened('code-a');
            motion.on = false;
            host.motionChanged();
            expect(said).not.toContain('close');
            motion.on = true;
            host.completed(completion('code-a'));
            motion.on = false;
            host.motionChanged();
            expect(host.getState().done).toBe(false);
            expect(said).toContain('close');
        });

        it('a completion of another row, or one whose account was not read, plays nothing', () => {
            const { host, said } = setup({ plays: true });
            host.opened('code-a');
            host.completed(completion('code-b'));
            host.completed(completion('code-a', 'refresh-failed'));
            expect(host.getState().done).toBe(false);
            expect(said).not.toContain('close');
        });
    });

    describe('an account read late', () => {
        it('the row the window is signing in to became signed in by an earlier sign-in: this one stops, the row becomes the account', () => {
            const { host, said, rows, goes } = setup();
            host.opened('code-a');
            goes('waiting');
            rows[0] = { ...rows[0], status: 'authenticated', user: { id: 7, nickname: 'late' } };
            host.rowsChanged();
            expect(host.getState().chosen).toEqual({ providerId: 'code-a', lead: 'account' });
            expect(said.at(-1)).toBe('stop');
            expect(said).not.toContain('close');
        });

        it('the row signed in by this window\'s own sign-in waits for the completion: no switch to the account, the animation plays', () => {
            const { host, said, rows, goes, sign } = setup({ plays: true });
            host.opened('code-a');
            goes('confirmed');
            rows[0] = { ...rows[0], status: 'authenticated' };
            host.rowsChanged();
            // The controller put the sign-in away once the account was read; the completion comes after a switch question.
            sign.login = null;
            host.loginChanged();
            host.rowsChanged();
            expect(host.getState().chosen?.lead).toBe('sign-in');
            host.completed(completion('code-a'));
            expect(host.getState().done).toBe(true);
            expect(said).toEqual(['stop', 'start code-a']);
        });
    });

    // The store's flag does not outlive the window's host. In development React.StrictMode takes
    // every new effect down and sets it up again at once: that is not an unmount, and a window
    // opened before the host mounted must stay open through it.
    it('the window\'s flag closes when its host is really gone, not when the host is taken down and set up again at once', async () => {
        openLoginWindow('code-a');
        const takenDown = loginHostMounted();
        takenDown();
        const unmounted = loginHostMounted();
        await settle();
        expect(useLoginWindowStore.getState().isOpen).toBe(true);
        unmounted();
        // Not before the moment in which a new set-up would have come.
        expect(useLoginWindowStore.getState().isOpen).toBe(true);
        await settle();
        expect(useLoginWindowStore.getState().isOpen).toBe(false);
    });

    it('tells who listens of every change, and nobody after they left', () => {
        const { host } = setup();
        let changes = 0;
        const leave = host.subscribe(() => { changes += 1; });
        host.opened('code-a');
        expect(changes).toBe(2);
        leave();
        host.choose('in');
        expect(changes).toBe(2);
    });
});
