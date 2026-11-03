// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
            key: (index: number) => Array.from(items.keys())[index] ?? null,
            get length() { return items.size; },
        },
    });
});

import type { ModRuntimeInfo } from '@/mods/types';
import type { FoliumPlatformService } from '@/mods/folium/contract';
import { OnlineProviderError } from '@/types/onlineMusic';
import { neteaseRaw } from '@/services/onlineMusic/netease/neteaseRaw';
import { omni } from '@/services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { createFoliumExperimental } from '@/mods/folium/experimental';
import { createFoliumPlatformService } from '@/mods/folium/platformRaw';
import { createFoliumClientApi } from '@/mods/folium/api';
import { createFoliumRequestGate, resetFoliumRequestQuotasForTest } from '@/mods/folium/omni/requestQuota';
import { getFoliumAccountState, installFoliumHostAccount } from '@/mods/runtime/hostAccount';
import { clientApiOptions } from './clientApiOptions';

// test/unit/mod-system/foliumPlatformRaw.test.ts
// Folium 1.7 experimental platform.raw (#788): the opt-in and the permissions (read for reading
// endpoints, write on top for the ones that change the account), the platform's table (sign-in and
// unlisted endpoints refused), the answer with the account key folium.account gives, an answer dropped
// when the account changed meanwhile, abort, the per-mod allowance (120 a minute, eight at once and the
// rest waiting their turn), and the platform's failures as the contract's codes. The platform's adapter is real; only its request to the backend is replaced.
// The allowance is the one per mod id that folium.omni shares (omni/requestQuota.ts), kept for the
// whole page: each case ends by resetting it, and a reloaded mod keeps its minute.

installFoliumHostAccount();

const READ = 'platform.netease.read';
const WRITE = 'platform.netease.write';

const mod = (overrides: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
    id: 'mod-a', name: 'A', version: '1.0.0', author: null, description: null, permissions: [READ],
    status: 'loaded', error: null, enabled: true, trustStale: false, signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null }, devSource: false, experimental: ['platform.raw'], embedOrigins: [],
    folia: null, hasMain: false, clientUrl: null, ...overrides,
});

const signInAs = (id: number) => useOnlineProviderAccountStore.getState().updateAccount('netease', {
    status: 'authenticated',
    user: { id, nickname: 'listener' },
    hydration: 'ready',
    freshness: 'fresh',
});

let send: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    send = vi.spyOn(neteaseRaw, 'request').mockResolvedValue({ code: 200, cookie: 'MUSIC_U=1', data: { total: 42, token: 't' } });
    useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
    useOnlineProviderAccountStore.getState().clearAccount('netease');
});

afterEach(() => {
    resetFoliumRequestQuotasForTest();
    vi.restoreAllMocks();
});

/* What `request` rejected with: its code, or the error itself when it has none. */
const failureOf = (promise: Promise<unknown>) => promise.then(
    () => { throw new Error('resolved'); },
    (error: { code?: string }) => error.code ?? error,
);

describe('platform.raw opt-in', () => {
    it('is reachable only with the manifest opt-in', () => {
        const optedIn = createFoliumClientApi(mod(), clientApiOptions('main', { experimental: createFoliumExperimental(mod()) }));
        expect(typeof (optedIn.experimental['platform.raw'] as FoliumPlatformService).request).toBe('function');
        const other = mod({ experimental: ['omni.hooks'] });
        const without = createFoliumClientApi(other, clientApiOptions('main', { experimental: createFoliumExperimental(other) }));
        expect(() => without.experimental['platform.raw']).toThrow('experimental-not-declared:platform.raw');
    });

    it('describes a platform with its pinned backend, and one without raw endpoints as unsupported', () => {
        const platform = createFoliumPlatformService(mod());
        expect(platform.describe('netease')).toEqual({ supported: true, backend: neteaseRaw.backend });
        expect(platform.describe('kugou')).toEqual({ supported: false });
        expect(platform.describe('no-such-provider')).toEqual({ supported: false });
    });
});

describe('platform.raw request', () => {
    it('answers with the raw body, credentials taken out, and the account key folium.account gives', async () => {
        signInAs(777);
        const answer = await createFoliumPlatformService(mod()).request('netease', 'listen_data_total');
        expect(answer).toEqual({ body: { code: 200, data: { total: 42 } }, accountKey: getFoliumAccountState('netease')!.accountKey });
        expect(answer.accountKey).toMatch(/^[0-9a-f]{32}$/);
        expect(Object.isFrozen(answer)).toBe(true);
    });

    it('needs the read permission, and write on top for an endpoint that changes the account', async () => {
        signInAs(1);
        await expect(failureOf(createFoliumPlatformService(mod({ permissions: [] })).request('netease', 'listen_data_total'))).resolves.toBe(`permission-denied:${READ}`);
        await expect(failureOf(createFoliumPlatformService(mod()).request('netease', 'like', { id: 1, like: true }))).resolves.toBe(`permission-denied:${WRITE}`);
        await expect(createFoliumPlatformService(mod({ permissions: [READ, WRITE] })).request('netease', 'like', { id: 1, like: true })).resolves.toBeTruthy();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('refuses sign-in and credential endpoints and anything the table does not list, whatever the permissions', async () => {
        const platform = createFoliumPlatformService(mod({ permissions: [READ, WRITE] }));
        for (const endpoint of ['login_status', 'login_refresh', 'register_anonimous', 'user_account', 'api', 'playlist_delete', '__proto__']) {
            await expect(failureOf(platform.request('netease', endpoint)), endpoint).resolves.toBe('endpoint-denied');
        }
        await expect(failureOf(platform.request('kugou', 'anything'))).resolves.toBe('unsupported');
        expect(send).not.toHaveBeenCalled();
    });

    it('rejects malformed parameters with a TypeError, and parameters the host sets', async () => {
        const platform = createFoliumPlatformService(mod());
        for (const params of [{ proxy: 'http://evil.example' }, { cookie: 'x' }, { 'cookie[a]': 'x' }, { when: new Date() }, { n: Number.NaN }, { big: 'x'.repeat(20_000) }, [1]]) {
            await expect(platform.request('netease', 'listen_data_total', params as never)).rejects.toBeInstanceOf(TypeError);
        }
        expect(send).not.toHaveBeenCalled();
    });

    it('refuses a value that would walk the upstream path out of the endpoint, before any request', async () => {
        signInAs(1);
        const platform = createFoliumPlatformService(mod({ permissions: [READ, WRITE] }));
        for (const [endpoint, params] of [
            ['album', { id: '../../logout' }],
            ['album', { id: '1/../../point/dailyTask' }],
            ['user_detail', { uid: '..%2F..%2Flogout' }],
            ['comment_music', { id: '1?x=1' }],
            ['follow', { id: '1#x', t: 1 }],
            ['summary_annual', { year: '2019/../..' }],
            ['artist_album', { id: [1] }],
            ['album', { id: -1 }],
        ] as const) {
            await expect(platform.request('netease', endpoint, params as never), `${endpoint} ${JSON.stringify(params)}`).rejects.toThrow(/^invalid-params: /);
        }
        expect(send).not.toHaveBeenCalled();
        await expect(platform.request('netease', 'album', { id: '32311' })).resolves.toBeTruthy();
        await expect(platform.request('netease', 'album', { id: 32311 })).resolves.toBeTruthy();
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('drops an answer that comes after the account or the provider changed', async () => {
        signInAs(1);
        let answer!: (value: unknown) => void;
        send.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
        const platform = createFoliumPlatformService(mod());
        const pending = failureOf(platform.request('netease', 'listen_data_total'));
        await Promise.resolve();
        signInAs(2);
        answer({ code: 200 });
        await expect(pending).resolves.toBe('account-changed');

        const switched = failureOf(platform.request('netease', 'listen_data_total'));
        await Promise.resolve();
        omni.invalidateActiveRequests();
        answer({ code: 200 });
        await expect(switched).resolves.toBe('account-changed');
    });

    it('rejects with aborted when the signal aborts, before or during the request', async () => {
        const platform = createFoliumPlatformService(mod());
        const before = new AbortController();
        before.abort();
        await expect(failureOf(platform.request('netease', 'listen_data_total', {}, { signal: before.signal }))).resolves.toBe('aborted');
        expect(send).not.toHaveBeenCalled();

        let seen: AbortSignal | undefined;
        send.mockImplementation((_endpoint: string, _params: unknown, signal: AbortSignal) => {
            seen = signal;
            return new Promise(() => {});
        });
        const during = new AbortController();
        const pending = failureOf(platform.request('netease', 'listen_data_total', {}, { signal: during.signal }));
        await Promise.resolve();
        during.abort();
        await expect(pending).resolves.toBe('aborted');
        // The request itself was told to stop.
        expect(seen?.aborted).toBe(true);
        // A stopped mod's calls are refused.
        const stopped = createFoliumPlatformService(mod(), () => true);
        await expect(failureOf(stopped.request('netease', 'listen_data_total'))).resolves.toBe('aborted');
    });

    it('aborts the requests under way when the mod stops, with or without a signal', async () => {
        const releases: Array<() => void> = [];
        const platform = createFoliumPlatformService(mod(), () => false, (release) => releases.push(release));
        const seen: AbortSignal[] = [];
        send.mockImplementation((_endpoint: string, _params: unknown, signal: AbortSignal) => {
            seen.push(signal);
            return new Promise(() => {});
        });
        const bare = failureOf(platform.request('netease', 'listen_data_total'));
        const withSignal = failureOf(platform.request('netease', 'listen_data_total', {}, { signal: new AbortController().signal }));
        await Promise.resolve();
        expect(releases).toHaveLength(1);
        releases.forEach((release) => release());
        await expect(bare).resolves.toBe('aborted');
        await expect(withSignal).resolves.toBe('aborted');
        expect(seen).toHaveLength(2);
        expect(seen.every((signal) => signal.aborted)).toBe(true);
    });

    it('turns the platform\'s failures into the contract\'s codes', async () => {
        const platform = createFoliumPlatformService(mod());
        const failWith = (error: unknown) => send.mockRejectedValueOnce(error);
        failWith(new OnlineProviderError('auth-required', 'refused', 'netease'));
        await expect(failureOf(platform.request('netease', 'listen_data_total'))).resolves.toBe('not-signed-in');
        signInAs(3);
        failWith(new OnlineProviderError('auth-required', 'refused', 'netease'));
        await expect(failureOf(platform.request('netease', 'listen_data_total'))).resolves.toBe('session-expired');
        failWith(new OnlineProviderError('unavailable', 'too many', 'netease', undefined, 429));
        await expect(failureOf(platform.request('netease', 'listen_data_total'))).resolves.toBe('rate-limited');
        failWith(new OnlineProviderError('subscription-required', 'vip', 'netease'));
        await expect(failureOf(platform.request('netease', 'listen_data_total'))).resolves.toBe('vip-required');
        failWith(new OnlineProviderError('network', 'down', 'netease'));
        await expect(failureOf(platform.request('netease', 'listen_data_total'))).resolves.toBe('network');
        failWith(new Error('anything else'));
        await expect(failureOf(platform.request('netease', 'listen_data_total'))).resolves.toBe('network');
    });

    it('needs someone signed in for an endpoint about the signed-in user', async () => {
        await expect(failureOf(createFoliumPlatformService(mod()).request('netease', 'user_record', { type: 1 }))).resolves.toBe('not-signed-in');
        expect(send).not.toHaveBeenCalled();
    });

    /* The platform's answers held back, to be let out one by one: `answer(n)` answers the n-th request sent. */
    const holdAnswers = () => {
        const answers: Array<(body: unknown) => void> = [];
        const sentParams: unknown[] = [];
        send.mockImplementation((_endpoint: string, params: unknown) => {
            sentParams.push(params);
            return new Promise((resolve) => { answers.push(resolve); });
        });
        return { sentParams, answer: (index: number) => answers[index]({ code: 200 }) };
    };
    const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

    it('sends eight requests of one mod at once and lets the rest wait their turn', async () => {
        const held = holdAnswers();
        const platform = createFoliumPlatformService(mod());
        const results = Array.from({ length: 11 }, (_, i) => platform.request('netease', 'listen_data_total', { order: i }));
        await settle();
        expect(send).toHaveBeenCalledTimes(8);
        // One answer frees one place, for the oldest waiting request.
        held.answer(0);
        await settle();
        expect(held.sentParams).toHaveLength(9);
        expect(held.sentParams[8]).toEqual({ order: 8 });
        held.answer(2);
        held.answer(1);
        await settle();
        expect(held.sentParams.slice(9)).toEqual([{ order: 9 }, { order: 10 }]);
        for (let i = 3; i < 11; i += 1) held.answer(i);
        // Nobody failed for having waited.
        await expect(Promise.all(results)).resolves.toHaveLength(11);
        // Another mod has its own places.
        void createFoliumPlatformService(mod({ id: 'mod-b' })).request('netease', 'listen_data_total').catch(() => {});
        expect(send).toHaveBeenCalledTimes(12);
    });

    it('drops a waiting request that its signal or the mod\'s stop aborts, and gives its turn on', async () => {
        const held = holdAnswers();
        const releases: Array<() => void> = [];
        const platform = createFoliumPlatformService(mod(), () => false, (release) => releases.push(release));
        for (let i = 0; i < 8; i += 1) void platform.request('netease', 'listen_data_total', { order: i }).catch(() => {});
        const caller = new AbortController();
        const withSignal = failureOf(platform.request('netease', 'listen_data_total', { order: 8 }, { signal: caller.signal }));
        const next = failureOf(platform.request('netease', 'listen_data_total', { order: 9 }));
        await settle();
        caller.abort();
        await expect(withSignal).resolves.toBe('aborted');
        // Its turn goes to the one behind it; the aborted one is never sent.
        held.answer(0);
        await settle();
        expect(held.sentParams.slice(8)).toEqual([{ order: 9 }]);
        // All eight places are taken again. Stopping the mod aborts the waiting one too, unsent, along
        // with the ones under way.
        const waiting = failureOf(platform.request('netease', 'listen_data_total', { order: 10 }));
        await settle();
        releases.forEach((release) => release());
        await expect(waiting).resolves.toBe('aborted');
        await expect(next).resolves.toBe('aborted');
        expect(held.sentParams).toHaveLength(9);
    });

    it('refuses one mod past 120 requests a minute, waiting ones included', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
            const platform = createFoliumPlatformService(mod());
            const accepted = Array.from({ length: 120 }, () => platform.request('netease', 'listen_data_total'));
            await expect(failureOf(platform.request('netease', 'listen_data_total'))).resolves.toBe('rate-limited');
            await expect(Promise.all(accepted)).resolves.toHaveLength(120);
            // A minute on, the allowance is back.
            vi.setSystemTime(new Date('2026-10-20T12:01:00Z'));
            await expect(platform.request('netease', 'listen_data_total')).resolves.toMatchObject({ accountKey: null });
        } finally {
            vi.useRealTimers();
        }
    });

    it('says once in the developer log when Omni already offers the endpoint', async () => {
        const info = vi.mocked(console.info);
        const platform = createFoliumPlatformService(mod());
        await platform.request('netease', 'lyric', { id: 1 });
        await platform.request('netease', 'lyric', { id: 2 });
        const lines = info.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('platform.raw netease lyric'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('omni.getLyrics');
    });

    it('points the developer log at folium.omni where it has the endpoint, and says when nothing typed has', async () => {
        const info = vi.mocked(console.info);
        const platform = createFoliumPlatformService(mod());
        await platform.request('netease', 'song_detail', { ids: '1' });
        await platform.request('netease', 'playlist_track_all', { id: 1 });
        await platform.request('netease', 'listen_data_total');
        const lineOf = (endpoint: string) => info.mock.calls.map(([line]) => String(line)).find((line) => line.includes(`platform.raw netease ${endpoint}:`));
        expect(lineOf('song_detail')).toContain('folium.omni.resolveSongs');
        // A playlist's tracks: Omni does it, folium.omni opens no playlists.
        expect(lineOf('playlist_track_all')).toContain('omni.getCollectionTracks');
        expect(lineOf('playlist_track_all')).toContain('no typed interface');
        expect(lineOf('playlist_track_all')).not.toContain('folium.omni');
        expect(lineOf('listen_data_total')).toContain('first call (read)');
    });

    /* A gate of folium.omni for mod-a, as one call of its methods would get it, asking built-in sources. */
    const omniGate = (modId = 'mod-a') => createFoliumRequestGate({
        modId, what: 'omni.test', signal: new AbortController().signal, originOf: () => 'host',
    });

    it('shares the allowance per mod with folium.omni: its places and its minute', async () => {
        const held = holdAnswers();
        const omniAnswers: Array<() => void> = [];
        for (let i = 0; i < 8; i += 1) {
            void omniGate().run('netease', () => new Promise<void>((resolve) => { omniAnswers.push(resolve); }));
        }
        // All of mod-a's places are folium.omni's: platform.raw waits its turn, another mod does not.
        const raw = createFoliumPlatformService(mod()).request('netease', 'listen_data_total');
        await settle();
        expect(send).not.toHaveBeenCalled();
        void createFoliumPlatformService(mod({ id: 'mod-b' })).request('netease', 'listen_data_total');
        expect(send).toHaveBeenCalledTimes(1);
        omniAnswers[0]();
        await settle();
        expect(send).toHaveBeenCalledTimes(2);
        held.answer(0);
        held.answer(1);
        await expect(raw).resolves.toMatchObject({ accountKey: null });

        resetFoliumRequestQuotasForTest();
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
            send.mockResolvedValue({ code: 200 });
            const omniCalls = Array.from({ length: 119 }, () => omniGate().run('netease', () => Promise.resolve('omni')));
            const platform = createFoliumPlatformService(mod());
            const last = platform.request('netease', 'listen_data_total');
            await expect(failureOf(platform.request('netease', 'listen_data_total'))).resolves.toBe('rate-limited');
            await expect(failureOf(omniGate().run('netease', () => Promise.resolve('omni')))).resolves.toBe('rate-limited');
            await expect(Promise.all([...omniCalls, last])).resolves.toHaveLength(120);
            expect(vi.mocked(console.warn)).toHaveBeenCalledWith('[Folium:mod-a] platform.raw netease listen_data_total: refused, over 120 requests a minute');
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the minute of a mod across a reload: a new activation of the same id counts on', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
            const releases: Array<() => void> = [];
            const before = createFoliumPlatformService(mod(), () => false, (release) => releases.push(release));
            await expect(Promise.all(Array.from({ length: 120 }, () => before.request('netease', 'listen_data_total')))).resolves.toHaveLength(120);
            releases.forEach((release) => release());
            const after = createFoliumPlatformService(mod());
            await expect(failureOf(after.request('netease', 'listen_data_total'))).resolves.toBe('rate-limited');
            vi.setSystemTime(new Date('2026-10-21T12:01:00Z'));
            await expect(after.request('netease', 'listen_data_total')).resolves.toMatchObject({ accountKey: null });
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects an aborted request at once, and lets the next one in once the aborted request has stopped', async () => {
        const held = holdAnswers();
        const platform = createFoliumPlatformService(mod());
        const callers = Array.from({ length: 8 }, () => new AbortController());
        const aborted = callers.map((caller, i) => failureOf(platform.request('netease', 'listen_data_total', { order: i }, { signal: caller.signal })));
        callers.forEach((caller) => caller.abort());
        await expect(Promise.all(aborted)).resolves.toEqual(Array(8).fill('aborted'));
        // The eight have not stopped at the backend yet (the stand-in ignores the signal): a ninth waits.
        const next = platform.request('netease', 'listen_data_total', { order: 8 });
        await settle();
        expect(held.sentParams).toHaveLength(8);
        held.answer(3);
        await settle();
        expect(held.sentParams[8]).toEqual({ order: 8 });
        held.answer(8);
        await expect(next).resolves.toMatchObject({ accountKey: null });
    });
});
