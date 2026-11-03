import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import type { LoginStep, LoginState } from '@/types/onlineMusic';
import { loginCaseOf, loginFailureFacts } from '@/services/onlineMusic/login/loginFailureCase';

// test/unit/spotify/spotifyLoginFailure.test.ts
// Which case each failure of a Spotify sign-in sorts to. The desktop side is the real one
// (electron/spotify/signIn.cjs and spotifyApiBridge.cjs) over stand-ins for Spotify, the loopback
// server and the system browser; the renderer side is the real facade, adapter and transport.
// Each test is named after the case it ends in. The other platforms are in
// test/unit/onlineMusic/loginFailurePlatforms.test.ts. Nothing here asks Spotify.

vi.mock('@/services/onlineMusic/providerAccountCache', () => ({ saveProviderAccountSnapshot: vi.fn() }));

const require = createRequire(import.meta.url);
const { createSpotifyApiBridge } = require('../../../electron/spotify/spotifyApiBridge.cjs');
const { createSpotifySignIn } = require('../../../electron/spotify/signIn.cjs');

const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const cipher = { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from(text), decryptString: (data: Buffer) => data.toString() };

// The desktop side with the renderer wired to it. `listens: false` is a port another program
// holds; `visit` is the browser coming back from Spotify's page with `answer` in its address.
// `token` and `account` are what Spotify's token endpoint and its other services answer.
const issued = () => json({ access_token: 'access-private', refresh_token: 'refresh-private', expires_in: 3600 });
const desktop = ({
    listens = true, opens = true, profile = {} as unknown, now = (): number => 1_000_000,
    token = issued as () => unknown, account = (): unknown => json(profile),
} = {}) => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const server: any = {
        on: (event: string, handler: (...args: any[]) => void) => { handlers[event] = handler; return server; },
        listen: (_port: number, _host: string, done: () => void) => (listens ? done() : handlers.error({ code: 'EADDRINUSE' })),
        close: () => { },
    };
    server.once = server.on;
    const fetch = vi.fn(async (url: string) => (String(url).includes('/api/token') ? token() : account()));
    const openExternal = vi.fn(async (_page: string) => { if (!opens) throw new Error('no handler for https'); });
    const quiet = () => { };
    const signIn = createSpotifySignIn({ fetch, openExternal, now, createServer: () => server, log: quiet, warn: quiet });
    const store = new Map<string, unknown>();
    const bridge = createSpotifyApiBridge({
        store: { get: (key: string) => store.get(key), set: (key: string, value: unknown) => store.set(key, value), delete: (key: string) => store.delete(key) },
        safeStorage: cipher, fetch, openExternal, now, log: quiet, warn: quiet, signIn,
    });
    vi.stubGlobal('window', { electron: { spotifyRequest: bridge.request } });
    const visit = async (answer: string) => {
        const state = new URL(openExternal.mock.calls.at(-1)![0]).searchParams.get('state')!;
        const response: any = { writeHead: () => response };
        const ended = new Promise<void>(resolve => { response.end = (_body?: string, done?: () => void) => { done?.(); resolve(); }; });
        handlers.request({ method: 'GET', url: `/login?${answer}&state=${encodeURIComponent(state)}` }, response);
        await ended;
    };
    return { visit };
};

// The facts and the case of a step that threw, and of a check that answered an error, put
// together as the sign-in hook puts them together.
const thrown = async (step: LoginStep, run: () => Promise<unknown>) => {
    const error = await run().then(() => { throw new Error('the step did not fail'); }, (failure: unknown) => failure);
    const facts = loginFailureFacts({ step, inBrowser: true, scanned: false }, { error });
    return { ...facts, id: loginCaseOf(facts).id };
};
const answered = (state: LoginState) => {
    if (state.state !== 'error') throw new Error(`the check answered ${state.state}`);
    const facts = loginFailureFacts({ step: 'check', inBrowser: true, scanned: false }, { detail: state.failure, error: state.message });
    return { ...facts, id: loginCaseOf(facts).id };
};
// A sign-in begun and its page opened: the key to check it with.
const begun = async () => {
    const { key } = await omni.startLogin('spotify');
    await omni.openLoginPage('spotify', key);
    return key;
};

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Spotify', () => {
    it('cannot-listen: another program holds the port the answer comes back to', async () => {
        desktop({ listens: false });
        expect(await thrown('start', () => omni.startLogin('spotify'))).toMatchObject({
            id: 'cannot-listen', mainCode: 'cannot-listen', errorCode: 'unavailable',
        });
    });

    it('browser-not-opened: the system would not open Spotify\'s page', async () => {
        desktop({ opens: false });
        const { key } = await omni.startLogin('spotify');
        expect(await thrown('open', () => omni.openLoginPage('spotify', key))).toMatchObject({ id: 'browser-not-opened' });
    });

    it('not-authorized: the person pressed cancel on Spotify\'s page', async () => {
        const { visit } = desktop();
        const key = await begun();
        await visit('error=access_denied');
        expect(answered(await omni.checkLogin('spotify', key))).toMatchObject({ id: 'not-authorized', mainCode: 'access-denied' });
    });

    it.each([
        ['error=server_error', 'unreachable', 'unreachable'],
        ['error=temporarily_unavailable', 'retry-later', 'asked-to-wait'],
        ['error=invalid_scope', 'refused', 'refused'],
        ['', 'unknown', 'sign-in-failed'],
    ])('the case of the reason Spotify sent the browser back with in place of a code (%s): %s', async (answer, id, mainCode) => {
        const { visit } = desktop();
        const key = await begun();
        await visit(answer);
        expect(answered(await omni.checkLogin('spotify', key))).toMatchObject({ id, mainCode });
    });

    it.each([
        ['unreachable', () => { throw new TypeError('fetch failed'); }, 'unreachable'],
        ['unreachable', () => json({}, 503), 'unreachable'],
        ['no-answer', () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }, 'no-answer'],
        ['retry-later', () => json({}, 429), 'asked-to-wait'],
        ['refused', () => json({ error: 'invalid_grant' }, 400), 'refused'],
        ['unknown', () => json({}), 'sign-in-failed'],
    ])('%s: Spotify sent a code, and it was not exchanged (%#)', async (id, token, mainCode) => {
        const { visit } = desktop({ token });
        const key = await begun();
        await visit('code=the-code');
        const failed = answered(await omni.checkLogin('spotify', key));
        expect(failed).toMatchObject({ id, mainCode });
        expect(JSON.stringify(failed)).not.toMatch(/access-private|refresh-private|the-code/);
    });

    it.each([
        ['unreachable', () => json({}, 503), 'unreachable'],
        ['retry-later', () => json({}, 429), 'asked-to-wait'],
        ['no-answer', () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }, 'no-answer'],
    ])('%s: Spotify approved, and the account could not be read for a minute (%#)', async (id, account, mainCode) => {
        let time = 1_000_000;
        const { visit } = desktop({ account, now: () => time });
        const key = await begun();
        await visit('code=the-code');
        // A line that fails for a moment does not end the sign-in: the account is read again.
        expect(await omni.checkLogin('spotify', key)).toEqual({ state: 'waiting' });
        time += 59_000;
        expect(await omni.checkLogin('spotify', key)).toEqual({ state: 'waiting' });
        time += 1_000;
        expect(await thrown('check', () => omni.checkLogin('spotify', key))).toMatchObject({ id, mainCode });
    });

    it('account-not-read: Spotify approved, and the account it then gave has no name', async () => {
        const { visit } = desktop({ profile: { data: { me: { profile: {} } } } });
        const key = await begun();
        await visit('code=the-code');
        const failed = await thrown('check', () => omni.checkLogin('spotify', key));
        expect(failed).toMatchObject({ id: 'account-not-read', mainCode: 'account-not-read' });
        expect(JSON.stringify(failed)).not.toMatch(/access-private|refresh-private|the-code/);
    });

    it('unreachable: the desktop side does not answer', async () => {
        vi.stubGlobal('window', { electron: { spotifyRequest: async () => { throw new Error('ipc'); } } });
        expect(await thrown('start', () => omni.startLogin('spotify'))).toMatchObject({ id: 'unreachable' });
    });

    it('browser-unfinished: ten minutes went by with no answer from the browser', async () => {
        let time = 1_000_000;
        desktop({ now: () => time });
        const key = await begun();
        time += 10 * 60 * 1000;
        expect(await omni.checkLogin('spotify', key)).toEqual({ state: 'expired' });
        expect(loginCaseOf(loginFailureFacts({ step: 'wait', inBrowser: true, scanned: false })).id).toBe('browser-unfinished');
    });
});
