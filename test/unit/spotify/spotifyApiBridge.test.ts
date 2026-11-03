import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/spotify/spotifyApiBridge.test.ts — the Spotify host bridge against a stand-in for
// Spotify: the sign-in that comes back from the browser, the token kept and renewed, what the
// renderer may ask for, and what never leaves the process.

const require = createRequire(import.meta.url);
const { createSpotifyApiBridge, CHANGES, QUERIES, SPOTIFY_OPERATIONS } = require('../../../electron/spotify/spotifyApiBridge.cjs');
const { createSpotifySignIn, REDIRECT_URI } = require('../../../electron/spotify/signIn.cjs');
const { createSpotifySessionRepository, publicAccountId, SESSION_KEY } = require('../../../electron/spotify/session.cjs');

const createStore = () => {
    const values = new Map<string, unknown>();
    return { values, get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value), delete: (key: string) => values.delete(key) };
};
const cipher = () => ({ isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(Buffer.from(text).map(byte => byte ^ 0xa5)),
    decryptString: (data: Buffer) => Buffer.from(data.map(byte => byte ^ 0xa5)).toString() });
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const stored = (store: ReturnType<typeof createStore>) => {
    const sealed = store.values.get(SESSION_KEY);
    return typeof sealed === 'string' ? JSON.parse(cipher().decryptString(Buffer.from(sealed, 'base64'))) : null;
};
const seal = (store: ReturnType<typeof createStore>, expiresAt: number, premium = false) => store.values.set(SESSION_KEY, cipher().encryptString(JSON.stringify({
    version: 1, credentials: { access_token: 'access-private', refresh_token: 'refresh-private', expires_at: expiresAt },
    user: { id: publicAccountId('fixture-private'), nickname: 'Fixture', avatarUrl: '', premium },
})).toString('base64'));

// The loopback server the sign-in listens on: `visit` is the browser coming back.
const fakeServer = () => {
    const server: any = { handlers: {} as Record<string, (...args: any[]) => void>, listening: null as null | [number, string], closed: 0 };
    server.on = (event: string, handler: (...args: any[]) => void) => { server.handlers[event] = handler; return server; };
    server.once = server.on;
    server.listen = (port: number, host: string, done: () => void) => { server.listening = [port, host]; done(); };
    server.close = () => { server.closed += 1; };
    server.visit = async (path: string) => {
        const response: any = { status: 0, body: '' };
        const ended = new Promise<void>(resolve => {
            response.writeHead = (status: number) => { response.status = status; return response; };
            response.end = (body?: string, done?: () => void) => { response.body = body ?? ''; done?.(); resolve(); };
        });
        server.handlers.request({ method: 'GET', url: path }, response);
        await ended;
        return response;
    };
    return server;
};
const profile = { data: { me: { profile: { username: 'fixture-private', name: 'Fixture', avatar: { sources: [{ url: 'https://i.scdn.co/small', width: 64 }, { url: 'https://i.scdn.co/large', width: 300 }] } } } } };

// A bridge whose every request goes to `answer`, with the calls it made.
const setup = (answer: (url: string, init: any) => any, { now = () => 1_000_000, openSession }: { now?: () => number; openSession?: (...args: any[]) => any } = {}) => {
    const store = createStore();
    const server = fakeServer();
    const fetch = vi.fn(async (url: string, init: any) => answer(String(url), init));
    const openExternal = vi.fn(async (_url: string) => {});
    const logs: string[] = [];
    const record = (...args: unknown[]) => { logs.push(args.join(' ')); };
    const signIn = createSpotifySignIn({ fetch, openExternal, now, createServer: () => server, log: record, warn: record });
    const bridge = createSpotifyApiBridge({ store, safeStorage: cipher(), fetch, openExternal, now, log: record, warn: record, signIn, openSession });
    return { bridge, store, server, fetch, openExternal, logs };
};
const stateOf = (openExternal: any) => new URL(openExternal.mock.calls.at(-1)[0]).searchParams;

describe('Spotify stored sign-in', () => {
    const credentials = { access_token: 'access-new', refresh_token: 'refresh-new', expires_at: 2_000_000 };
    const account = { id: publicAccountId('fixture-private'), nickname: 'Fixture', avatarUrl: '', premium: false };

    it('replaces what is stored where a new sign-in cannot be sealed, and leaves it where it cannot be written', () => {
        const store = createStore();
        seal(store, 1_500_000);
        const sealed = store.values.get(SESSION_KEY);
        const warn = vi.fn();
        const unsealed = createSpotifySessionRepository({ store, safeStorage: { isEncryptionAvailable: () => false }, log: vi.fn(), warn });
        unsealed.set({ credentials, user: account });
        unsealed.update({ credentials: { ...credentials, access_token: 'access-renewed' } });
        expect(store.values.has(SESSION_KEY)).toBe(false);
        store.set(SESSION_KEY, sealed);
        expect(unsealed.get().credentials.access_token).toBe('access-renewed');
        expect(warn).toHaveBeenCalledTimes(1);
        const locked = { ...store, set: () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); } };
        const lockedWarn = vi.fn();
        createSpotifySessionRepository({ store: locked, safeStorage: cipher(), log: vi.fn(), warn: lockedWarn }).set({ credentials, user: account });
        expect(store.values.get(SESSION_KEY)).toBe(sealed);
        expect(lockedWarn).toHaveBeenLastCalledWith('[Spotify] Sign-in could not be stored; what is stored stays as it was', expect.objectContaining({ code: 'EPERM' }));
        // Another account's sign-in that cannot be written: the one stored before goes, so it does not come back at a later start.
        createSpotifySessionRepository({ store: locked, safeStorage: cipher(), log: vi.fn(), warn: lockedWarn })
            .set({ credentials, user: { ...account, id: publicAccountId('fixture-another') } });
        expect(store.values.has(SESSION_KEY)).toBe(false);
        expect(lockedWarn).toHaveBeenLastCalledWith('[Spotify] Sign-in could not be stored; the one of another account stored before was removed', expect.objectContaining({ code: 'EPERM' }));
    });

    it.each([
        ['without OS encryption', { ...cipher(), isEncryptionAvailable: (): boolean => false }],
        ['on the plaintext Linux backend', { ...cipher(), getSelectedStorageBackend: (): string => 'basic_text' }],
    ])('does not answer a stored sign-in it cannot read %s as nobody, and nobody once signed out', async (_case, keychain) => {
        const store = createStore();
        seal(store, 1_500_000);
        const fetch = vi.fn();
        const bridge = createSpotifyApiBridge({ store, safeStorage: keychain, fetch, openExternal: vi.fn(), now: () => 1_000_000, log: vi.fn(), warn: vi.fn() });
        expect(await bridge.request('login_status')).toEqual({ ok: false, error: { code: 'unavailable', message: 'The stored Spotify sign-in cannot be read now' } });
        expect(fetch).not.toHaveBeenCalled();
        await bridge.request('logout');
        expect(store.values.get(SESSION_KEY)).toBeUndefined();
        expect(await bridge.request('login_status')).toEqual({ ok: true, data: null });
    });

    it('answers nobody for a stored sign-in the keychain will not unseal while encryption works', async () => {
        const store = createStore();
        seal(store, 1_500_000);
        const keychain = { ...cipher(), decryptString: () => { throw new Error('refused'); } };
        const bridge = createSpotifyApiBridge({ store, safeStorage: keychain, fetch: vi.fn(), openExternal: vi.fn(), now: () => 1_000_000, log: vi.fn(), warn: vi.fn() });
        expect(await bridge.request('login_status')).toEqual({ ok: true, data: null });
    });
});

describe('Spotify quitting', () => {
    it('holds a quit for a token renewal under way until its answer is stored, and not without one', async () => {
        const store = createStore();
        seal(store, 1_000_000);
        let renewed!: (credentials: unknown) => void;
        const signIn = { renew: vi.fn(() => new Promise(resolve => { renewed = resolve; })), cancel: vi.fn() };
        const wait = vi.fn(() => new Promise<void>(() => {}));
        const bridge = createSpotifyApiBridge({ store, safeStorage: cipher(), fetch: vi.fn(async () => json({})), openExternal: vi.fn(),
            now: () => 1_000_000, log: vi.fn(), warn: vi.fn(), signIn, wait });
        expect(bridge.shutdown()).toBeNull();
        await bridge.request('login_status');
        expect(signIn.renew).toHaveBeenCalledWith('refresh-private');
        const quit = bridge.shutdown();
        expect(wait).toHaveBeenCalledWith(3000);
        let done = false;
        void quit.then(() => { done = true; });
        await new Promise(resolve => { setImmediate(resolve); });
        expect(done).toBe(false);
        renewed({ access_token: 'access-renewed', refresh_token: 'refresh-private', expires_at: 5_000_000 });
        await quit;
        expect(stored(store).credentials.access_token).toBe('access-renewed');
    });
});

describe('Spotify sign-in from the browser', () => {
    const spotify = (url: string, init: any) => {
        if (url.includes('/api/token')) return json({ access_token: 'access-private', refresh_token: 'refresh-private', expires_in: 3600 });
        if (url.includes('product_state')) return json({ catalogue: 'premium', product: 'premium' });
        if (JSON.parse(init.body).operationName === 'profileAttributes') return json(profile);
        return json({}, 500);
    };

    it('listens on the loopback address, opens Spotify\'s own page, and signs in when the browser comes back with the code', async () => {
        const { bridge, store, server, fetch, openExternal, logs } = setup(spotify);
        const started = await bridge.request('login_start');
        expect(started).toEqual({ ok: true, data: { key: expect.any(String), expiresInMs: 600000 } });
        expect(server.listening).toEqual([5588, '127.0.0.1']);
        const key = started.data.key;
        expect(await bridge.request('login_check', { key })).toEqual({ ok: true, data: { state: 'waiting' } });
        await bridge.request('login_open', { key });
        const page = new URL(openExternal.mock.calls[0][0]);
        expect(`${page.origin}${page.pathname}`).toBe('https://accounts.spotify.com/authorize');
        expect(Object.fromEntries(page.searchParams)).toMatchObject({ response_type: 'code', redirect_uri: REDIRECT_URI, code_challenge_method: 'S256' });

        // A request that does not carry this attempt's state is not its answer: it is told the
        // sign-in did not complete, and nothing is exchanged or recorded.
        const stranger = await server.visit('/login?code=stolen&state=wrong');
        expect(stranger).toMatchObject({ status: 200, body: expect.stringContaining('登录未完成。请回到 Folia 重试。') });
        expect(fetch).not.toHaveBeenCalled();
        expect(server.closed).toBe(0);
        expect(await bridge.request('login_check', { key })).toEqual({ ok: true, data: { state: 'waiting' } });
        expect((await server.visit('/favicon.ico')).status).toBe(404);
        // A request line that is no address at all is a stranger too, not an exception in the main process.
        expect((await server.visit('//')).status).toBe(404);
        const back = await server.visit(`/login?code=the-code&state=${encodeURIComponent(page.searchParams.get('state')!)}`);
        expect(back.status).toBe(200);
        expect(server.closed).toBeGreaterThan(0);
        const exchange = fetch.mock.calls.find(call => String(call[0]).includes('/api/token'))!;
        expect(Object.fromEntries(new URLSearchParams(exchange[1].body))).toMatchObject({ grant_type: 'authorization_code', code: 'the-code', redirect_uri: REDIRECT_URI });

        expect(await bridge.request('login_check', { key })).toEqual({ ok: true, data: { state: 'confirmed' } });
        expect(stored(store)).toMatchObject({ credentials: { access_token: 'access-private', refresh_token: 'refresh-private', expires_at: 1_000_000 + 3600_000 },
            user: { id: publicAccountId('fixture-private'), nickname: 'Fixture', avatarUrl: 'https://i.scdn.co/large', premium: true } });
        // The renderer learns who signed in, and nothing of the token or of Spotify's name for the account.
        const status = await bridge.request('login_status');
        expect(status.data).toEqual({ id: publicAccountId('fixture-private'), nickname: 'Fixture', avatarUrl: 'https://i.scdn.co/large', vipType: 1 });
        expect(JSON.stringify([status, logs])).not.toMatch(/access-private|refresh-private|fixture-private|the-code/);
        // The attempt is over: its key is no longer known.
        expect(await bridge.request('login_check', { key })).toEqual({ ok: true, data: { state: 'expired' } });
    });

    it('reads the account again on the next poll when the line fails after the approval, without a second trip to the browser', async () => {
        let down = true;
        const { bridge, store, server, openExternal } = setup(url => {
            if (url.includes('/api/token')) return json({ access_token: 'access-private', refresh_token: 'refresh-private', expires_in: 3600 });
            if (url.includes('product_state')) return json({ catalogue: 'free' });
            return down ? json({}, 503) : json(profile);
        });
        const key = (await bridge.request('login_start')).data.key;
        await bridge.request('login_open', { key });
        await server.visit(`/login?code=the-code&state=${encodeURIComponent(stateOf(openExternal).get('state')!)}`);
        expect(await bridge.request('login_check', { key })).toEqual({ ok: true, data: { state: 'waiting' } });
        expect(stored(store)).toBeNull();
        down = false;
        expect(await bridge.request('login_check', { key })).toEqual({ ok: true, data: { state: 'confirmed' } });
        expect(stored(store).user).toMatchObject({ nickname: 'Fixture', premium: false });
    });

    it('answers an approval in the tab of an attempt a new start replaced with the page of a sign-in not completed, and the new attempt goes on', async () => {
        const { bridge, server, fetch, openExternal } = setup(spotify);
        const first = (await bridge.request('login_start')).data.key;
        await bridge.request('login_open', { key: first });
        const oldState = stateOf(openExternal).get('state')!;
        const second = (await bridge.request('login_start')).data.key;
        await bridge.request('login_open', { key: second });
        const closedBefore = server.closed;
        const old = await server.visit(`/login?code=the-old-code&state=${encodeURIComponent(oldState)}`);
        expect(old).toMatchObject({ status: 200, body: expect.stringContaining('登录未完成。请回到 Folia 重试。') });
        expect(fetch).not.toHaveBeenCalled();
        expect(server.closed).toBe(closedBefore);
        expect(await bridge.request('login_check', { key: second })).toEqual({ ok: true, data: { state: 'waiting' } });
        // The new attempt's own answer is still taken.
        await server.visit(`/login?code=the-code&state=${encodeURIComponent(stateOf(openExternal).get('state')!)}`);
        expect(await bridge.request('login_check', { key: second })).toEqual({ ok: true, data: { state: 'confirmed' } });
    });

    it('reports a refusal in the browser, and signs nobody in', async () => {
        const { bridge, store, server, openExternal } = setup(spotify);
        const key = (await bridge.request('login_start')).data.key;
        await bridge.request('login_open', { key });
        await server.visit(`/login?error=access_denied&state=${encodeURIComponent(stateOf(openExternal).get('state')!)}`);
        expect(await bridge.request('login_check', { key })).toEqual({ ok: true, data: { state: 'error', message: 'access-denied' } });
        expect(stored(store)).toBeNull();
    });

    it('drops an attempt that was cancelled, or outlived its time, without signing in', async () => {
        let time = 1_000_000;
        const { bridge, store, server, openExternal } = setup(spotify, { now: () => time });
        const first = (await bridge.request('login_start')).data.key;
        await bridge.request('login_cancel', { key: first });
        expect(server.closed).toBeGreaterThan(0);
        expect(await bridge.request('login_check', { key: first })).toEqual({ ok: true, data: { state: 'expired' } });
        expect((await bridge.request('login_open', { key: first })).data).toBe(false);
        expect(openExternal).not.toHaveBeenCalled();
        const second = (await bridge.request('login_start')).data.key;
        time += 600_001;
        expect(await bridge.request('login_check', { key: second })).toEqual({ ok: true, data: { state: 'expired' } });
        expect(stored(store)).toBeNull();
    });

    it('signs out by forgetting the tokens', async () => {
        const { bridge, store } = setup(spotify);
        seal(store, 9_000_000);
        expect((await bridge.request('login_status')).data).toMatchObject({ nickname: 'Fixture', vipType: 0 });
        await bridge.request('logout');
        expect(store.values.has(SESSION_KEY)).toBe(false);
        expect((await bridge.request('login_status')).data).toBeNull();
        expect(await bridge.request('query', { name: 'home', variables: {} })).toMatchObject({ ok: false, error: { code: 'auth-required' } });
    });
});

describe('Spotify requests as the account', () => {
    const query = (bridge: any, name = 'home') => bridge.request('query', { name, variables: { uri: 'spotify:playlist:x' } });

    it('sends only the queries it knows, by the hash Spotify knows them by, with the stored token', async () => {
        const { bridge, store, fetch } = setup(() => json({ data: { home: 1 } }));
        seal(store, 9_000_000);
        expect(await query(bridge)).toEqual({ ok: true, data: { home: 1 } });
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe('https://api-partner.spotify.com/pathfinder/v2/query');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer access-private', 'Accept-Language': 'zh-CN' });
        expect(JSON.parse(init.body)).toEqual({ variables: { uri: 'spotify:playlist:x' }, operationName: 'home', extensions: { persistedQuery: { version: 1, sha256Hash: QUERIES.home } } });
        fetch.mockClear();
        expect(await query(bridge, 'somethingElse')).toMatchObject({ ok: false, error: { code: 'unsupported' } });
        expect(await query(bridge, 'constructor')).toMatchObject({ ok: false, error: { code: 'unsupported' } });
        // The query that names the account is the main process's own.
        expect(await query(bridge, 'profileAttributes')).toMatchObject({ ok: false, error: { code: 'unsupported' } });
        expect(await bridge.request('query', { name: 'home', variables: { text: 'x'.repeat(5000) } })).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        expect(await bridge.request('anything')).toMatchObject({ ok: false, error: { code: 'unsupported' } });
        expect(await bridge.request('query', null)).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        expect(await bridge.request('radio', { id: '../x' })).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        expect(fetch).not.toHaveBeenCalled();
        expect(SPOTIFY_OPERATIONS).toContain('query');
    });

    it('renews a token about to run out, once for requests made together, and keeps the new one', async () => {
        const { bridge, store, fetch } = setup(url => (url.includes('/api/token')
            ? json({ access_token: 'renewed-private', expires_in: 3600 }) : json({ data: {} })));
        seal(store, 1_000_000 + 30_000);
        expect((await Promise.all([query(bridge), query(bridge), query(bridge)])).every(result => result.ok)).toBe(true);
        const renewals = fetch.mock.calls.filter(call => String(call[0]).includes('/api/token'));
        expect(renewals).toHaveLength(1);
        expect(Object.fromEntries(new URLSearchParams(renewals[0][1].body))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh-private' });
        expect(fetch.mock.calls.filter(call => String(call[0]).includes('pathfinder')).every(call => call[1].headers.Authorization === 'Bearer renewed-private')).toBe(true);
        // Spotify sent no new refresh token: the one held stays.
        expect(stored(store).credentials).toEqual({ access_token: 'renewed-private', refresh_token: 'refresh-private', expires_at: 1_000_000 + 3600_000 });
    });

    it('answers a 401 with one renewed token, once, and clears the sign-in only when Spotify refuses the grant itself', async () => {
        const { bridge, store, fetch } = setup((url, init) => {
            if (url.includes('/api/token')) return json({ access_token: 'renewed-private', expires_in: 3600 });
            return init.headers.Authorization === 'Bearer renewed-private' ? json({ data: { ok: true } }) : json({}, 401);
        });
        seal(store, 9_000_000);
        expect(await query(bridge)).toEqual({ ok: true, data: { ok: true } });
        expect(fetch.mock.calls.filter(call => String(call[0]).includes('pathfinder'))).toHaveLength(2);
        expect(stored(store).credentials.access_token).toBe('renewed-private');

        // Still 401 with the renewed token: no third try, and the sign-in stays.
        const always = setup(url => (url.includes('/api/token') ? json({ access_token: 'renewed-private', expires_in: 3600 }) : json({}, 401)));
        seal(always.store, 9_000_000);
        expect(await query(always.bridge)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        expect(always.fetch.mock.calls.filter(call => String(call[0]).includes('pathfinder'))).toHaveLength(2);
        expect(always.store.values.has(SESSION_KEY)).toBe(true);

        // The renewal a 401 leads to is refused as a grant: the sign-in is gone.
        const refused = setup(url => (url.includes('/api/token') ? json({ error: 'invalid_grant' }, 400) : json({}, 401)));
        seal(refused.store, 9_000_000);
        expect(await query(refused.bridge)).toMatchObject({ ok: false, error: { code: 'auth-required' } });
        expect(refused.store.values.has(SESSION_KEY)).toBe(false);
    });

    it('keeps the sign-in when Spotify is unreachable or answers with an error, and tells which it was', async () => {
        const down = setup(url => (url.includes('/api/token') ? json({}, 503) : json({ data: {} })));
        seal(down.store, 1_000_000);
        expect(await query(down.bridge)).toMatchObject({ ok: false, error: { code: 'network' } });
        expect(down.store.values.has(SESSION_KEY)).toBe(true);

        const replaced = setup(() => json({ errors: [{ message: 'PersistedQueryNotFound' }] }));
        seal(replaced.store, 9_000_000);
        expect(await query(replaced.bridge)).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        expect(replaced.logs.join('\n')).toContain('PersistedQueryNotFound');
        expect(replaced.store.values.has(SESSION_KEY)).toBe(true);
        const limited = setup(() => json({}, 429));
        seal(limited.store, 9_000_000);
        expect(await query(limited.bridge)).toMatchObject({ ok: false, error: { code: 'network' } });
        expect(limited.store.values.has(SESSION_KEY)).toBe(true);
        const offline = setup(() => { throw new TypeError('fetch failed'); });
        seal(offline.store, 9_000_000);
        expect(await query(offline.bridge)).toMatchObject({ ok: false, error: { code: 'network' } });
        expect(offline.store.values.has(SESSION_KEY)).toBe(true);
    });

    it('reads a song\'s radio and its lyrics, and answers "none" where Spotify has none', async () => {
        const { bridge, store, fetch } = setup(url => {
            if (url.includes('seed_to_playlist')) return json({ mediaItems: [{ uri: 'spotify:playlist:radio' }] });
            if (url.includes('/aaaaaaaaaaaaaaaaaaaaaa?')) return json({ lyrics: { syncType: 'LINE_SYNCED', lines: [{ startTimeMs: '500', words: 'First' }] } });
            return json({}, 404);
        });
        seal(store, 9_000_000);
        expect((await bridge.request('radio', { id: 'a'.repeat(22) })).data).toEqual({ uri: 'spotify:playlist:radio' });
        expect((await bridge.request('lyrics', { id: 'a'.repeat(22) })).data).toEqual({ timed: true, lines: [{ startMs: 500, words: 'First' }] });
        expect(fetch.mock.calls.at(-1)![1].headers['app-platform']).toBe('WebPlayer');
        expect((await bridge.request('lyrics', { id: 'b'.repeat(22) })).data).toBeNull();
    });

    it('keeps what it knew of the plan when the plan cannot be read', async () => {
        const { bridge, store, logs } = setup((url, init) => {
            if (url.includes('product_state')) return json({}, 503);
            return JSON.parse(init.body).operationName === 'profileAttributes' ? json(profile) : json({ data: {} });
        });
        seal(store, 9_000_000, true);
        expect((await bridge.request('login_status')).data.vipType).toBe(1);
        await vi.waitFor(() => expect(logs.join('\n')).toContain('plan could not be read'));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(stored(store).user.premium).toBe(true);
    });

    it('gives no request of one sign-in the token a renewal brings for the sign-in before it', async () => {
        let release: (value: unknown) => void = () => {};
        const { bridge, store, server, fetch, openExternal } = setup((url, init) => {
            if (url.includes('product_state')) return json({ catalogue: 'free' });
            if (!url.includes('/api/token')) return init.body.includes('profileAttributes') ? json(profile) : json({ data: { as: init.headers.Authorization } });
            const asked = new URLSearchParams(init.body);
            // The second sign-in's token is one about to run out, so that its first request renews it.
            if (asked.get('grant_type') === 'authorization_code') return json({ access_token: 'second-old', refresh_token: 'second-refresh', expires_in: 60 });
            if (asked.get('refresh_token') === 'second-refresh') return json({ access_token: 'second-renewed', expires_in: 3600 });
            return new Promise(resolve => { release = resolve; });
        });
        seal(store, 1_000_000);
        const early = query(bridge);
        await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
        await bridge.request('logout');
        const key = (await bridge.request('login_start')).data.key;
        await bridge.request('login_open', { key });
        await server.visit(`/login?code=the-code&state=${encodeURIComponent(stateOf(openExternal).get('state')!)}`);
        expect((await bridge.request('login_check', { key })).data).toEqual({ state: 'confirmed' });

        expect((await query(bridge)).data).toEqual({ as: 'Bearer second-renewed' });
        release(json({ access_token: 'first-renewed', expires_in: 3600 }));
        await early;
        expect(stored(store).credentials).toMatchObject({ access_token: 'second-renewed', refresh_token: 'second-refresh' });
    });

    it('notices without a new sign-in that the account began to pay', async () => {
        const { bridge, store } = setup((url, init) => {
            if (url.includes('product_state')) return json({ catalogue: 'premium' });
            return JSON.parse(init.body).operationName === 'profileAttributes' ? json(profile) : json({ data: {} });
        });
        seal(store, 9_000_000);
        expect((await bridge.request('login_status')).data.vipType).toBe(0);
        await vi.waitFor(() => expect(stored(store).user.premium).toBe(true));
        expect((await bridge.request('login_status')).data.vipType).toBe(1);
    });

    it('adds to the library and takes out by the change that fits the thing, and tells a refusal from a change made', async () => {
        const bodies: any[] = [];
        let refuse: unknown = null;
        let owner: string | undefined = 'someone-else';
        let administers = false;
        const { bridge, store } = setup((_url, init) => {
            const body = JSON.parse(init.body);
            // Whose a playlist is, is read before it is changed.
            if (body.operationName === 'fetchPlaylist') {
                return json({ data: { playlistV2: { ownerV2: { data: { username: owner } }, currentUserCapabilities: { canAdministratePermissions: administers } } } });
            }
            bodies.push(body);
            return json(refuse ?? { data: { done: { __typename: 'LibraryResponse' } } });
        });
        seal(store, 9_000_000);
        const [track, album, list] = ['track', 'album', 'playlist'].map(kind => `spotify:${kind}:4cOdK2wGLETKBW3PvgPWqT`);

        expect(await bridge.request('library', { uri: track, saved: true })).toEqual({ ok: true, data: true });
        await bridge.request('library', { uri: album, saved: false });
        await bridge.request('library', { uri: list, saved: true });
        await bridge.request('library', { uri: list, saved: false });
        expect(bodies.map(body => [body.operationName, body.variables, body.extensions.persistedQuery.sha256Hash])).toEqual([
            ['addToLibrary', { libraryItemUris: [track] }, CHANGES.addToLibrary],
            ['removeFromLibrary', { libraryItemUris: [album] }, CHANGES.removeFromLibrary],
            ['addItemsToRootlist', { uris: [list] }, CHANGES.addItemsToRootlist],
            ['removeItemsFromRootlist', { uris: [list] }, CHANGES.removeItemsFromRootlist],
        ]);

        // Spotify answers a change it refuses with status 200 and an error; an answer without the
        // change's result confirms nothing either.
        for (const answer of [{ data: null, errors: [{ message: 'Argument <uris> is not valid' }] }, { data: { done: { __typename: 'x' } }, errors: [{}] }, { data: { done: null } }, { data: {} }]) {
            refuse = answer;
            expect((await bridge.request('library', { uri: track, saved: true })).error.code).toBe('unavailable');
        }
        refuse = null;
        // One of the account's own playlists is not taken out of its library (that removes it), and
        // neither is one Spotify does not name the owner of.
        const asked = bodies.length;
        owner = 'fixture-private';
        expect((await bridge.request('library', { uri: list, saved: false })).error.code).toBe('unsupported');
        owner = undefined;
        expect((await bridge.request('library', { uri: list, saved: false })).error.code).toBe('unsupported');
        owner = 'someone-else';
        administers = true;
        expect((await bridge.request('library', { uri: list, saved: false })).error.code).toBe('unsupported');
        // Nothing but a song, an album or a playlist is taken, and the renderer cannot send a change by its name.
        for (const params of [{ uri: 'spotify:artist:4cOdK2wGLETKBW3PvgPWqT', saved: true }, { uri: track, saved: 'yes' }, { uri: `${track}x`, saved: true }, {}]) {
            expect((await bridge.request('library', params)).ok).toBe(false);
        }
        expect((await bridge.request('query', { name: 'addToLibrary', variables: { libraryItemUris: [track] } })).error.code).toBe('unsupported');
        expect(bodies).toHaveLength(asked);
    });

    it('puts in a playlist only the songs it does not hold, takes out every row of a song, and refuses a playlist the account may not change', async () => {
        const song = (letter: string) => letter.repeat(22);
        const row = (letter: string, uid: string) => ({ uid, itemV2: { data: { uri: `spotify:track:${song(letter)}` } } });
        // The playlist holds one song twice and one in a row without an id of its own, and Spotify
        // gives two rows a request.
        const rows = [row('a', 'u1'), row('b', 'u2'), row('a', 'u3'), { itemV2: { data: { uri: `spotify:track:${song('d')}` } } }];
        const reads: number[] = [];
        const changes: any[] = [];
        let editable = true;
        let read: 'whole' | 'in part' | 'without rows' | 'without end' = 'whole';
        const { bridge, store } = setup((_url, init) => {
            const body = JSON.parse(init.body);
            if (body.operationName === 'fetchPlaylist') {
                reads.push(body.variables.offset);
                const list = (content: unknown) => ({ data: { playlistV2: { currentUserCapabilities: { canEditItems: editable }, content } } });
                if (read === 'in part') return json({ ...list({ totalCount: 1, items: rows.slice(1, 2) }), errors: [{ message: 'content timed out' }] });
                if (read === 'without rows') return json(list(null));
                if (read === 'without end') return json(list({ totalCount: 1_000_000, items: [row('b', `u${body.variables.offset}`)] }));
                return json(list({ totalCount: rows.length, items: rows.slice(body.variables.offset, body.variables.offset + 2) }));
            }
            changes.push([body.operationName, body.variables, body.extensions.persistedQuery.sha256Hash]);
            return json({ data: { done: { __typename: 'x' } } });
        });
        seal(store, 9_000_000);
        const list = song('p');

        expect(await bridge.request('playlist_edit', { id: list, action: 'add', tracks: [song('a'), song('c'), song('c')] })).toEqual({ ok: true, data: true });
        expect(reads).toEqual([0, 2]);
        // Songs the playlist holds: nothing is sent.
        expect(await bridge.request('playlist_edit', { id: list, action: 'add', tracks: [song('b'), song('d')] })).toEqual({ ok: true, data: true });
        await bridge.request('playlist_edit', { id: list, action: 'remove', tracks: [song('a'), song('z')] });
        expect(changes).toEqual([
            ['addToPlaylist', { playlistItemUris: [`spotify:track:${song('c')}`], playlistUri: `spotify:playlist:${list}`, newPosition: { moveType: 'BOTTOM_OF_PLAYLIST', fromUid: null } }, CHANGES.addToPlaylist],
            ['removeFromPlaylist', { playlistUri: `spotify:playlist:${list}`, uids: ['u1', 'u3'] }, CHANGES.removeFromPlaylist],
        ]);

        // Only a whole read will do. From an answer Spotify gave in part, one without the rows, or
        // a playlist longer than is read, a song would be put in twice or reported taken out.
        for (const [faulty, code] of [['in part', 'invalid-response'], ['without rows', 'invalid-response'], ['without end', 'unavailable']] as const) {
            read = faulty;
            expect((await bridge.request('playlist_edit', { id: list, action: 'add', tracks: [song('c')] })).error.code).toBe(code);
            expect((await bridge.request('playlist_edit', { id: list, action: 'remove', tracks: [song('b')] })).error.code).toBe(code);
        }
        read = 'whole';
        editable = false;
        expect((await bridge.request('playlist_edit', { id: list, action: 'add', tracks: [song('c')] })).error.code).toBe('unsupported');
        for (const params of [{ id: 'x', action: 'add', tracks: [song('a')] }, { id: list, action: 'move', tracks: [song('a')] }, { id: list, action: 'add', tracks: [] }, { id: list, action: 'add', tracks: ['x'] }, { id: list, action: 'add' }]) {
            expect((await bridge.request('playlist_edit', params)).error.code).toBe('invalid-response');
        }
        expect(changes).toHaveLength(2);
    });

    it('makes a playlist by its name, puts it in the library, and answers with its uri', async () => {
        const uri = `spotify:playlist:${'n'.repeat(22)}`;
        const sent: any[] = [];
        let made: unknown = { uri, revision: 'r' };
        const { bridge, store } = setup((url, init) => {
            const body = JSON.parse(init.body);
            const creates = url.includes('/playlist/v2/playlist');
            sent.push(creates ? ['create', body] : [body.operationName, body.variables]);
            return json(creates ? made : { data: { addItemsToRootlist: { __typename: 'x' } } });
        });
        seal(store, 9_000_000);

        expect(await bridge.request('playlist_create', { name: '  Road  ' })).toEqual({ ok: true, data: { uri } });
        expect(sent).toEqual([
            ['create', { ops: [{ kind: 'UPDATE_LIST_ATTRIBUTES', updateListAttributes: { newAttributes: { values: { name: 'Road' } } } }] }],
            ['addItemsToRootlist', { uris: [uri] }],
        ]);
        // An answer that names no playlist puts nothing in the library.
        made = {};
        expect((await bridge.request('playlist_create', { name: 'Road' })).error.code).toBe('invalid-response');
        expect(sent).toHaveLength(3);
        for (const name of ['', '   ', 'x'.repeat(101), 7]) expect((await bridge.request('playlist_create', { name })).ok).toBe(false);
        expect(sent).toHaveLength(3);
    });

    it('refuses a free account\'s track after reading its plan once more, and plays for an account that began to pay', async () => {
        let plan = 'free';
        let clock = 1_000_000;
        // The first bytes of a file as Spotify keeps one, encrypted with an all-zero key.
        const head = Buffer.alloc(0xa7 + 4);
        head.write('OggS', 0xa7, 'latin1');
        const sealed = crypto.createCipheriv('aes-128-ctr', Buffer.alloc(16), Buffer.from('72e067fbddcbcf77ebe8bc643f630d93', 'hex')).update(head);
        const resolveAudioFileAsync = vi.fn(async () => ({ cdnUrl: 'https://cdn.test/file', keyHex: '00'.repeat(16), format: 'OGG_VORBIS_160' }));
        const openSession = vi.fn(async () => ({ resolveAudioFileAsync, close: async () => {} }));
        const { bridge, store } = setup((url, init) => {
            if (url.includes('product_state')) return json({ catalogue: plan, product: plan });
            if (url.startsWith('https://cdn.test/')) return new Response(new Uint8Array(sealed), { status: 206, headers: { 'Content-Range': `bytes 0-${sealed.length - 1}/5000` } });
            return JSON.parse(init.body).operationName === 'profileAttributes' ? json(profile) : json({ data: {} });
        }, { now: () => clock, openSession });
        seal(store, 9_000_000);
        const ask = () => bridge.request('audio', { id: '4cOdK2wGLETKBW3PvgPWqT', quality: 'standard' });

        expect(await ask()).toEqual({ ok: false, error: { code: 'subscription-required', message: 'Spotify plays for Premium accounts only' } });
        // The plan is not read for every track a free account asks for.
        plan = 'premium';
        expect((await ask()).error.code).toBe('subscription-required');
        expect(openSession).not.toHaveBeenCalled();

        clock += 31_000;
        const played = await ask();
        expect(played.data.url).toMatch(/^folia-spotify:\/\/audio\/4cOdK2wGLETKBW3PvgPWqT\?k=/);
        expect(openSession).toHaveBeenCalledWith({ accessToken: 'access-private', deviceId: expect.stringMatching(/^[0-9a-f]{40}$/) });
        expect(resolveAudioFileAsync).toHaveBeenCalledWith({ uri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT', bitrate: 160 });
        expect(stored(store).user.premium).toBe(true);
        // Signing out ends the address.
        await bridge.request('logout');
        expect((await bridge.handleAudioRequest(new Request(played.data.url))).status).toBe(503);
    });

    it('lets every track wait for a plan read under way, and asks for the track when the plan cannot be read', async () => {
        const head = Buffer.alloc(0xa7 + 4);
        head.write('OggS', 0xa7, 'latin1');
        const sealed = crypto.createCipheriv('aes-128-ctr', Buffer.alloc(16), Buffer.from('72e067fbddcbcf77ebe8bc643f630d93', 'hex')).update(head);
        const openSession = vi.fn(async () => ({
            resolveAudioFileAsync: async () => ({ cdnUrl: 'https://cdn.test/file', keyHex: '00'.repeat(16), format: 'OGG_VORBIS_320' }), close: async () => {},
        }));
        let plan: () => Promise<unknown> = async () => json({ catalogue: 'premium', product: 'premium' });
        const spotify = (url: string, init: any) => {
            if (url.includes('product_state')) return plan();
            if (url.startsWith('https://cdn.test/')) return new Response(new Uint8Array(sealed), { status: 206, headers: { 'Content-Range': `bytes 0-${sealed.length - 1}/5000` } });
            return JSON.parse(init.body).operationName === 'profileAttributes' ? json(profile) : json({ data: {} });
        };
        const ask = (bridge: any, id: string) => bridge.request('audio', { id, quality: 'high' });

        // The app's start reads the plan; two tracks are asked for before the answer is there.
        let answer!: (value: unknown) => void;
        plan = () => new Promise(resolve => { answer = resolve; });
        const first = setup(spotify, { openSession });
        seal(first.store, 9_000_000);
        await first.bridge.request('login_status');
        const both = Promise.all([ask(first.bridge, '4cOdK2wGLETKBW3PvgPWqT'), ask(first.bridge, '1111111111111111111111')]);
        await vi.waitFor(() => expect(answer).toBeTypeOf('function'));
        answer(json({ catalogue: 'premium', product: 'premium' }));
        expect((await both).map(result => result.ok)).toEqual([true, true]);

        // A plan Spotify does not give is no word that the account is free.
        plan = async () => json({}, 500);
        const second = setup(spotify, { openSession });
        seal(second.store, 9_000_000);
        expect((await ask(second.bridge, '4cOdK2wGLETKBW3PvgPWqT')).ok).toBe(true);
    });
});
