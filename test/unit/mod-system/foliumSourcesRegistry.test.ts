// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

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
import type { FoliumSourceDef } from '@/mods/folium/sources/contract';
import type { SongResult } from '@/types';
import type { ProviderNotice } from '@/types/onlineMusic';
import { createFoliumClientApi } from '@/mods/folium/api';
import {
    deriveFoliumSourceCapabilities,
    getFoliumProviderHolder,
    getFoliumSourceCapability,
    readFoliumSourceParts,
    registerFoliumSource,
    sourcesRegistry,
} from '@/mods/folium/registries/sources';
import { omniProvidersRegistry } from '@/mods/folium/registries/omniProviders';
import { toHostSong } from '@/mods/folium/registries/sourceDtos';
import { createFoliumPageStore, foliumPageStoreKey } from '@/mods/folium/registries/sourcePageStore';
import { supportsFoliumCapability } from '@/mods/folium/sources/capabilities';
import { foliumSourceMember, markFoliumSourceMod } from '@/mods/runtime/guard';
import { clearFoliumIssues, getFoliumIssues } from '@/mods/runtime/status';
import { getProviderSessionKey } from '@/services/onlineMusic/providerStorage';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { participants } from '@/services/onlineMusic/crossSource';
import { canSourceMatchOnly } from '@/services/onlineMusic/sourceStates';
import { omni } from '@/services/onlineMusic/omni';
import { getCoverIdentity, getSizedCoverUrl } from '@/utils/coverUrl';
import { resolveSearchSources } from '@/components/app/search/searchSources';
import { getLyricSource } from '@/utils/lyrics/lyricSources';
import i18n from '@/i18n/config';
import { clientApiOptions } from './clientApiOptions';

// test/unit/mod-system/foliumSourcesRegistry.test.ts
// The registry and adapter of folium.sources (registries/sources.ts) beyond the sample: what a definition may
// say and what the host makes of it; the two tracks of the Folium version; the seams of S1 and S2 now fed from
// capability declarations (crossSource, canSourceMatchOnly, the cover rules); and the experimental
// omni.providers sharing the table of mod-held ids.

const MOD = 'reg-mod';
const sourceInfo = (localId: string, state: 'enabled' | 'matching' | 'disabled' = 'enabled') => ({
    id: `folium.${MOD}.${localId}`, localId, name: localId, state, keepForMatching: false, takeover: false, requires: [],
});
const mod = (overrides: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
    id: MOD, name: 'R', version: '1.0.0', author: null, description: null, permissions: [], status: 'loaded', error: null,
    enabled: true, trustStale: false, signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false, experimental: [], embedOrigins: [], folia: null, hasMain: false, clientUrl: null,
    folium: 2, kind: 'source', sources: [sourceInfo('a'), sourceInfo('b'), sourceInfo('off', 'disabled')], ...overrides,
});
const register = (def: Partial<FoliumSourceDef> & { id: string }, info = mod()) => registerFoliumSource(
    { mod: info, stopped: () => false },
    { displayName: 'R', capabilities: {}, ...def } as FoliumSourceDef,
);
const song = (providerId: string, id = 'x'): SongResult => toHostSong(providerId, { id, title: id, artists: [] });

afterEach(() => {
    sourcesRegistry.unregisterAll(MOD);
    omniProvidersRegistry.unregisterAll(MOD);
    markFoliumSourceMod(MOD, false);
    clearFoliumIssues(MOD);
    vi.restoreAllMocks();
});

describe('the Folium version, two tracks (plan §9)', () => {
    it('a folium 1 mod reads 1.9 and has nothing of Folium 2; a folium 2 mod reads 2.0 and has sources and i18n', () => {
        const one = createFoliumClientApi(mod({ folium: 1, kind: 'standard', sources: undefined }), clientApiOptions('main'));
        expect(one.host.folium).toEqual({ major: 1, minor: 9 });
        expect('sources' in one).toBe(false);
        expect('i18n' in one).toBe(false);
        expect('capability' in one.omni).toBe(false);
        // folium.lyrics stays at 1.9 too: no isPureMusicText, the rest as it was.
        expect('isPureMusicText' in one.lyrics).toBe(false);
        expect(typeof one.lyrics.parse).toBe('function');
        expect(typeof one.lyrics.getLines).toBe('function');
        const two = createFoliumClientApi(mod({ kind: 'standard', sources: undefined }), clientApiOptions('export'));
        expect(two.host.folium).toEqual({ major: 2, minor: 0 });
        expect(two.sources.supports('search', 1)).toBe(true);
        expect(two.sources.supports('playback.surface', 1)).toBe(false);
        expect(two.i18n.key('a.b', { n: 1 })).toEqual({ i18nKey: 'a.b', params: { n: 1 } });
        expect(() => two.sources.register({ id: 'a', displayName: 'x', capabilities: {} })).toThrow(/not-a-source-mod/);
        expect(two.omni.capability('x', 'y')).toBeNull();
        expect(two.lyrics.isPureMusicText('纯音乐，请欣赏')).toBe(true);
        // A source mod outside the main window cannot register.
        const exported = createFoliumClientApi(mod(), clientApiOptions('export'));
        expect(() => exported.sources.register({ id: 'a', displayName: 'x', capabilities: {} })).toThrow('sources-unavailable-in-export-context');
    });
});

describe('registering', () => {
    it('takes only ids its manifest declares, once, and skips a source turned off', () => {
        expect(() => register({ id: 'zzz' })).toThrow(/not a source of this mod/);
        const handle = register({ id: 'a' });
        expect(handle.id).toBe(`folium.${MOD}.a`);
        expect(() => register({ id: 'a' })).toThrow(/registered already/);
        const off = register({ id: 'off' });
        expect(getOnlineMusicProvider(off.id)).toBeNull();
        off.unregister();
        expect(getFoliumProviderHolder(handle.id)).toEqual({ modId: MOD, origin: 'sources' });
        handle.unregister();
        expect(getOnlineMusicProvider(handle.id)).toBeNull();
        // A stale handle does not take a newer registration down.
        const again = register({ id: 'a' });
        handle.unregister();
        expect(getOnlineMusicProvider(again.id)).not.toBeNull();
    });

    it('refuses a definition without a name or capabilities', () => {
        expect(() => register({ id: 'a', displayName: 3 as never })).toThrow(/displayName/);
        expect(() => register({ id: 'a', capabilities: null as never })).toThrow(/capabilities/);
    });

    it('leaves out, and says once in the mod\'s row, what the host cannot take', () => {
        register({
            id: 'a',
            capabilities: {
                'search@2': { searchSongs: async () => ({ items: [], hasMore: false }) },
                'playback.surface@1': {} as never,
                'nope@1': {},
                'x.other-mod.thing@1': {},
                'lyrics@1': {} as never,
                'x.reg-mod.thing@1': { hello: () => 'hi' },
            } as never,
        });
        const messages = getFoliumIssues(MOD).map((issue) => String(issue.message));
        expect(messages.some((message) => message.includes('"search@2" is left out: this host does not implement it'))).toBe(true);
        expect(messages.some((message) => message.includes('"playback.surface@1" is left out'))).toBe(true);
        expect(messages.some((message) => message.includes('"nope@1" is left out: this host knows no such capability'))).toBe(true);
        expect(messages.some((message) => message.includes('x.other-mod.thing@1'))).toBe(true);
        expect(messages.some((message) => message.includes('"lyrics@1" is left out: it has no getLyrics'))).toBe(true);
        expect(omni.getProviderCapabilities(`folium.${MOD}.a`)).toMatchObject({ search: false, lyrics: false });
        expect((getFoliumSourceCapability(`folium.${MOD}.a`, 'x.reg-mod.thing@1') as { hello(): string }).hello()).toBe('hi');
    });

    it('derives the flags from what is there (personalFmModes written out)', () => {
        const parts = readFoliumSourceParts(MOD, {
            'catalog@1': { getAlbumTracks: async () => ({ items: [], hasMore: false }) },
            'recommendations@1': { personalFmModes: true, getHistoryDates: async () => [] },
            'mutations@1': { likeSong: async () => {} },
        }, () => {});
        expect(deriveFoliumSourceCapabilities(parts)).toMatchObject({
            albums: true, playlists: false, artists: false, recommendations: true, personalFmModes: true,
            historyRecommendations: true, likes: true, playlistTrackMutations: false, mutations: true, songDetail: false,
        });
    });

    it('reads getters again on handle.changed()', () => {
        let signedIn = false;
        const external = {
            play: async () => {}, pause: async () => {}, resume: async () => {}, seek: async () => {},
            getStatus: async () => ({ mediaId: '', isPlaying: false, positionMs: 0, durationMs: 0, ended: false }),
            isStatusForSong: () => false,
        };
        let levels: string[] = ['standard'];
        const handle = register({
            id: 'a',
            capabilities: {
                get 'playback.external@1'() { return signedIn ? external : undefined; },
                'playback.audio@1': { getAudioSource: async () => null, get audioQualityLevels() { return levels as never; } },
            },
        });
        expect(omni.getProviderCapabilities(handle.id).externalPlayback).toBe(false);
        signedIn = true;
        levels = ['standard', 'lossless'];
        // A getter of a member is read where the host reads it, at once.
        expect(omni.getAudioQualityLevels(handle.id)).toEqual(['standard', 'lossless']);
        // A capability that comes and goes needs changed().
        expect(omni.getProviderCapabilities(handle.id).externalPlayback).toBe(false);
        // Read again in place: nothing that lists the providers sees the source go and come back.
        const seen: boolean[] = [];
        const off = omni.subscribeProviders(() => seen.push(getOnlineMusicProvider(handle.id) !== null));
        handle.changed();
        off();
        expect(seen).toEqual([true]);
        expect(omni.getProviderCapabilities(handle.id).externalPlayback).toBe(true);
    });

    it('passes a notice to whoever watches the providers, with its text as a key', () => {
        const told: ProviderNotice[] = [];
        const stop = omni.watchProviders((notice) => told.push(notice));
        const handle = register({ id: 'a' });
        handle.notify({ type: 'error', text: { 'zh-CN': '本机服务停了', en: 'The local service stopped' }, nonce: 3 });
        expect(told).toHaveLength(1);
        expect(told[0]).toMatchObject({ type: 'error', nonce: 3 });
        expect(i18n.t(told[0].textKey, { lng: 'en' })).toBe('The local service stopped');
        stop();
    });

    // A source mod's hot-path member is called while the UI renders: it reads no clock, but a throw answers the
    // member's cautious answer instead of reaching the render (nothing above it catches; the window went blank).
    it('calls a source mod\'s hot-path member untimed, and answers its cautious answer when it throws', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const member = (value: number) => value + 1;
        const throwing = (value: number): number => { throw new Error(`bad ${value}`); };
        markFoliumSourceMod(MOD, true);
        expect(foliumSourceMember(MOD, 'x', member, () => -1)(1)).toBe(2);
        const guarded = foliumSourceMember(MOD, 'y', throwing, (value) => value * 10);
        expect(guarded(3)).toBe(30);
        expect(guarded(4)).toBe(40);
        expect(console.warn).toHaveBeenCalledTimes(1);
        markFoliumSourceMod(MOD, false);
        expect(foliumSourceMember(MOD, 'x', member, () => -1)(1)).toBe(2);
    });

    it('keeps a source whose song availability throws from taking the song list down', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        // The client loader marks a source mod before its activate runs.
        markFoliumSourceMod(MOD, true);
        register({ id: 'a', capabilities: { 'songs@1': { getSong: async () => null, getAvailability: () => { throw new Error('bug'); } } } });
        const song = toHostSong(`folium.${MOD}.a`, { id: 's1', title: 'T', artists: [] });
        expect(getOnlineMusicProvider(`folium.${MOD}.a`)?.playback?.getAvailability?.(song)).toEqual({ state: 'unknown' });
    });

    it('turns a sync answer it gives again into the host\'s shape once, and a host song into its DTO once', () => {
        markFoliumSourceMod(MOD, true);
        const seen: unknown[] = [];
        const answer = Object.freeze({ state: 'unknown', reason: 'restricted', label: 'VIP' } as const);
        register({
            id: 'a',
            capabilities: { 'songs@1': { getSong: async () => null, getAvailability: (dto) => { seen.push(dto); return answer; } } },
        });
        const target = song(`folium.${MOD}.a`);
        const first = omni.getSongAvailability(target);
        expect(first).toEqual({ state: 'unknown', reason: 'restricted', label: 'VIP' });
        expect(omni.getSongAvailability(target)).toBe(first);
        expect(seen[0]).toBe(seen[1]);
    });
});

// The host clones and stores a song (the queue in IndexedDB, the windows' sync): its `data` must be plain JSON, a
// copy, and small; a function in it used to fail the whole queue's persistence.
describe('a source song\'s data as the host keeps it', () => {
    const host = (data: unknown, lyricIds?: unknown) => {
        const song = toHostSong(`folium.${MOD}.a`, { id: 's', title: 'T', artists: [], data, lyricIds } as never);
        return { sourceRef: song.sourceRef as { providerData?: unknown } | undefined };
    };

    it('keeps a copy of plain JSON data, and drops what JSON cannot hold or what is too large', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const data = { sign: 'x', nested: { n: 1 } };
        const kept = host(data).sourceRef?.providerData;
        expect(kept).toEqual(data);
        expect(kept).not.toBe(data);
        data.nested.n = 2;
        expect(kept).toEqual({ sign: 'x', nested: { n: 1 } });
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        expect(host(cycle).sourceRef?.providerData).toBeUndefined();
        expect(host({ big: 1n }).sourceRef?.providerData).toBeUndefined();
        expect(host({ blob: 'x'.repeat(20_000) }).sourceRef?.providerData).toBeUndefined();
        // A function JSON leaves out; what is left can be cloned.
        const withFunction = host({ sign: 'y', run: () => 1 }).sourceRef?.providerData;
        expect(withFunction).toEqual({ sign: 'y' });
        expect(() => structuredClone(withFunction)).not.toThrow();
    });

    it('keeps the string ids of lyricIds only', () => {
        const song = host(undefined, { qq: 'mid-1', netease: 7, kugou: { hash: 'h' } });
        expect(song.sourceRef?.providerData).toEqual({ '@lyricIds': { qq: 'mid-1' } });
    });
});

describe('a song\'s availability label', () => {
    it('follows the UI language, and two constant answers in turn are each turned once', async () => {
        markFoliumSourceMod(MOD, true);
        const restricted = Object.freeze({ state: 'unknown', reason: 'restricted', label: { en: 'Members', 'zh-CN': '会员' } } as const);
        const playable = Object.freeze({ state: 'playable' } as const);
        register({
            id: 'a',
            capabilities: { 'songs@1': { getSong: async () => null, getAvailability: (dto) => (dto.id === 'r' ? restricted : playable) } },
        });
        const before = i18n.language;
        try {
            await i18n.changeLanguage('en');
            const one = song(`folium.${MOD}.a`, 'r');
            const two = song(`folium.${MOD}.a`, 'p');
            const first = omni.getSongAvailability(one);
            const other = omni.getSongAvailability(two);
            expect(first.label).toBe('Members');
            expect(omni.getSongAvailability(one)).toBe(first);
            expect(omni.getSongAvailability(two)).toBe(other);
            await i18n.changeLanguage('zh-CN');
            expect(omni.getSongAvailability(one).label).toBe('会员');
        } finally {
            await i18n.changeLanguage(before);
        }
    });
});

describe('the seams of S1 and S2, fed from capabilities', () => {
    it('crossSource and canSourceMatchOnly read access, crossSource and metadataMatch', () => {
        register({
            id: 'a',
            capabilities: {
                'search@1': { access: 'account', searchSongs: async () => ({ items: [], hasMore: false }) },
                'songs@1': { access: 'anonymous', metadataMatch: true, getSong: async () => null },
                'lyrics@1': { access: 'account', crossSource: { linesOnly: true }, getLyrics: async () => null },
            },
        });
        const id = `folium.${MOD}.a`;
        expect(participants('search').skipped).toContainEqual({ sourceId: id, reason: 'needs-account' });
        expect(participants('lyrics').skipped).toContainEqual({ sourceId: id, reason: 'needs-account' });
        expect(participants('metadata').ready).toContain(id);
        expect(canSourceMatchOnly(id)).toBe(true);
        // Built-in platforms are read from their tables as before.
        expect(canSourceMatchOnly('netease')).toBe(true);
        expect(canSourceMatchOnly('spotify')).toBe(false);
        expect(participants('metadata').ready.slice(0, 3)).toEqual(['netease', 'qq', 'kugou']);
    });

    it('the search page lists a source whose search needs no account, signed in or not', () => {
        register({
            id: 'a',
            capabilities: {
                'search@1': { searchSongs: async () => ({ items: [], hasMore: false }) },
                'auth@1': { getLoginStatus: async () => null, logout: async () => {} },
            },
        });
        const id = `folium.${MOD}.a`;
        const summaries = omni.getProviderSummaries();
        expect(summaries.find((summary) => summary.providerId === id)).toMatchObject({ requiresAccount: true, status: 'unknown' });
        expect(resolveSearchSources({ providers: summaries, activeProviderId: 'netease', hasLocalSongs: false, navidromeReady: false })).toContain(id);
    });

    it('a source without its search does no cross-source matching', () => {
        register({
            id: 'b',
            capabilities: {
                'songs@1': { metadataMatch: true, getSong: async () => null },
                'lyrics@1': { crossSource: {}, getLyrics: async () => null },
            },
        });
        const id = `folium.${MOD}.b`;
        expect(canSourceMatchOnly(id)).toBe(false);
        expect(participants('metadata').ready).not.toContain(id);
        expect(participants('lyrics').ready).not.toContain(id);
    });

    // A source with songs@1 and no playback.audio@1 has a `playback` part (its availability), but no audio:
    // its songs must not read as playable (they did, and a press of play ended in "no audio").
    it('a source without playback.audio does not offer its songs as playable', () => {
        register({ id: 'a', capabilities: { 'songs@1': { getSong: async () => null } } });
        register({ id: 'b', capabilities: { 'songs@1': { getSong: async () => null }, 'playback.audio@1': { getAudioSource: async () => null } } });
        const songOf = (localId: string) => toHostSong(`folium.${MOD}.${localId}`, { id: 's1', title: 'T', artists: [] });
        expect(getOnlineMusicProvider(`folium.${MOD}.a`)?.playback).toBeTruthy();
        expect(omni.canPlaySong(songOf('a'))).toBe(false);
        expect(omni.canPlaySong(songOf('b'))).toBe(true);
    });

    it('covers@1 registers a rule, and the built-in rules stand', () => {
        register({
            id: 'a',
            capabilities: {
                'covers@1': {
                    hosts: ['img.reg.invalid'],
                    sized: (url, size) => (url.hostname === 'img.reg.invalid' ? `${url.origin}${url.pathname}?w=${size}` : null),
                    identity: () => null,
                },
            },
        });
        expect(getSizedCoverUrl('https://img.reg.invalid/a.jpg?w=10', 300)).toBe('https://img.reg.invalid/a.jpg?w=300');
        expect(getSizedCoverUrl('https://y.gtimg.cn/music/photo_new/T002R300x300M000x.jpg', 800)).toBe('https://y.gtimg.cn/music/photo_new/T002R800x800M000x.jpg');
    });

    // A source's rule is asked about its own hosts only, with a URL of its own: a loose rule must not rewrite or
    // claim another source's or a Navidrome server's pictures (those URLs carry the server's credentials).
    it('covers@1 asks the source only about its own hosts, each time with a URL of its own', () => {
        const asked: string[] = [];
        register({
            id: 'a',
            capabilities: {
                'covers@1': {
                    hosts: ['*.loose.invalid'],
                    sized: (url, size) => {
                        asked.push(url.hostname);
                        url.pathname = '/rewritten';
                        return url.hostname.endsWith('.loose.invalid') ? `${url.href}?w=${size}` : null;
                    },
                    identity: (url) => {
                        asked.push(url.hostname);
                        return `loose:${url.pathname}`;
                    },
                },
            },
        });
        expect(getSizedCoverUrl('https://cdn.loose.invalid/a.jpg', 300)).toBe('https://cdn.loose.invalid/rewritten?w=300');
        const navidrome = 'https://music.home.invalid/rest/getCoverArt?id=1&u=me&t=token';
        expect(getSizedCoverUrl(navidrome, 300)).not.toContain('rewritten');
        expect(getCoverIdentity(navidrome)).not.toBe('loose:/rest/getCoverArt');
        expect(asked.every((host) => host === 'cdn.loose.invalid')).toBe(true);
        // Without hosts the capability is left out, and its rule is never asked.
        register({ id: 'b', capabilities: { 'covers@1': { sized: () => 'x', identity: () => 'x' } as never } });
        expect(getSizedCoverUrl('https://elsewhere.invalid/p.jpg', 300)).not.toBe('x');
    });

    it('the page store is the key providerStorage reads, of the mod\'s own sources only', () => {
        expect(foliumPageStoreKey('netease', 'cookie')).toBe(getProviderSessionKey('netease', 'cookie'));
        const api = createFoliumClientApi(mod(), clientApiOptions('main', {
            sources: { register: () => { throw new Error('no'); }, capability: () => null, pageStore: createFoliumPageStore },
        }));
        const store = api.sources.pageStore('a');
        store.set('token', 'abc');
        expect(localStorage.getItem(`online_provider:folium.${MOD}.a:token`)).toBe('abc');
        expect(api.sources.pageStore(`folium.${MOD}.a`).get('token')).toBe('abc');
        expect(store.keys()).toEqual(['token']);
        store.set('token', null);
        expect(store.get('token')).toBeNull();
        expect(() => api.sources.pageStore('netease')).toThrow(/not a source of this mod/);
        expect(() => store.set('bad key', 'x')).toThrow(TypeError);
    });
});

describe('folium.net.fetch of a source mod', () => {
    it('asks the main process for bytes and reads them back; an ordinary mod keeps text only', async () => {
        const calls: unknown[] = [];
        (window as unknown as { electron?: unknown }).electron = {
            mods: {
                invokeModNetFetch: async (_modId: string, _url: string, init: Record<string, unknown>) => {
                    calls.push(init);
                    return init.responseType === 'base64'
                        ? { ok: true, result: { status: 200, statusText: 'OK', headers: {}, body: '', bodyBase64: btoa('\u0000\u0001ÿ') } }
                        : { ok: true, result: { status: 200, statusText: 'OK', headers: {}, body: 'héllo' } };
                },
            },
        };
        try {
            const source = createFoliumClientApi(mod(), clientApiOptions('main'));
            const bytes = await source.net.fetch('https://example.com/a', { responseType: 'arrayBuffer', session: 'login' });
            expect(calls[0]).toEqual({ responseType: 'base64', session: 'login' });
            expect([...new Uint8Array(bytes.arrayBuffer!())]).toEqual([0, 1, 255]);
            const text = await source.net.fetch('https://example.com/b');
            expect(text.text()).toBe('héllo');
            expect([...new Uint8Array(text.arrayBuffer!())]).toEqual([104, 195, 169, 108, 108, 111]);
            const plain = createFoliumClientApi(mod({ folium: 1, kind: 'standard', sources: undefined, permissions: ['net.fetch'] }), clientApiOptions('main'));
            const answer = await plain.net.fetch('https://example.com/c', { responseType: 'arrayBuffer', session: 'x' });
            expect(calls[2]).toEqual({});
            expect(answer.arrayBuffer).toBeUndefined();
        } finally {
            delete (window as unknown as { electron?: unknown }).electron;
        }
    });
});

describe('ids the host has already', () => {
    it('a source on an id another provider holds puts nothing in place, and a host lyric source of its id stays', () => {
        const mine = mod({ sources: [{ ...sourceInfo('a'), id: 'qq' }, { ...sourceInfo('b'), id: 'amll' }] });
        const lyrics = { getLyrics: async () => null, crossSource: {} };
        const search = { searchSongs: async () => ({ items: [], hasMore: false }) };
        expect(() => register({ id: 'a', capabilities: { 'search@1': search, 'lyrics@1': lyrics } }, mine)).toThrow(/already exists/);
        expect(getLyricSource('qq')).toMatchObject({ id: 'qq', metadataMatch: true });
        const amll = register({ id: 'b', capabilities: { 'search@1': search, 'lyrics@1': lyrics } }, mine);
        expect(getLyricSource('amll')).toMatchObject({ id: 'amll', platform: false });
        amll.unregister();
        expect(getLyricSource('amll')).toMatchObject({ id: 'amll', platform: false });
    });
});

describe('omni.providers, a shell on the same table', () => {
    it('holds its provider id like a source, and one id cannot be both', () => {
        omniProvidersRegistry.register(MOD, { id: 'a', displayName: 'Old', search: async () => ({ items: [], hasMore: false }) });
        expect(getFoliumProviderHolder(`folium.${MOD}.a`)).toEqual({ modId: MOD, origin: 'omni.providers' });
        expect(() => register({ id: 'a' })).toThrow(/already exists/);
        omniProvidersRegistry.unregisterAll(MOD);
        expect(getFoliumProviderHolder(`folium.${MOD}.a`)).toBeNull();
        expect(supportsFoliumCapability('search', 1)).toBe(true);
    });
});
