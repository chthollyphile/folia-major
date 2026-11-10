import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The request to the local backend is the one thing replaced: the table, the answer handling and omni run as they are.
vi.mock('@/services/onlineMusic/netease/netease', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/services/onlineMusic/netease/netease')>(),
    requestNeteaseRoute: vi.fn(),
}));

import { OnlineProviderError } from '@/types/onlineMusic';
import { requestNeteaseRoute } from '@/services/onlineMusic/netease/netease';
import { NETEASE_RAW_ENDPOINTS, neteaseRaw, neteaseRawQuery, neteaseRouteOf } from '@/services/onlineMusic/netease/neteaseRaw';
import { withoutCredentials } from '@/services/onlineMusic/rawResponse';
import { omni } from '@/services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';

// test/unit/onlineMusic/neteaseRaw.test.ts
// NetEase's raw endpoints (Folium 1.7 platform.raw, #788): the table names only modules the pinned
// backend has, never opens a sign-in or credential module, and points at omni methods that exist; the
// request turns NetEase's refusals into the shared errors; omni takes credentials out of every answer,
// at any depth, and fills in the signed-in user where an endpoint is about them.

const ROOT = path.resolve(__dirname, '../../..');
const PACKAGE_DIR = path.join(ROOT, 'node_modules/@neteasecloudmusicapienhanced/api');
const route = vi.mocked(requestNeteaseRoute);
const signal = () => new AbortController().signal;
const readdirModules = (): string[] => readdirSync(path.join(PACKAGE_DIR, 'module')).map((file) => file.replace(/\.js$/, ''));

afterEach(() => {
    route.mockReset();
    useOnlineProviderAccountStore.setState({ accounts: {}, activeProviderId: 'netease' });
});

describe('the table of NetEase raw endpoints', () => {
    it('names only modules the pinned backend has', () => {
        const missing = Object.keys(NETEASE_RAW_ENDPOINTS).filter((name) => !existsSync(path.join(PACKAGE_DIR, 'module', `${name}.js`)));
        expect(missing).toEqual([]);
    });

    it('never opens sign-in, session, credential or pass-through modules, and refuses what it does not list', () => {
        const never = [
            'login', 'login_cellphone', 'login_qr_key', 'login_qr_create', 'login_qr_check', 'login_refresh', 'login_status',
            'logout', 'register_anonimous', 'register_cellphone', 'user_account', 'user_binding', 'api', 'batch', 'eapi_decrypt',
        ];
        never.forEach((name) => expect(neteaseRaw.describeEndpoint(name)?.access, name).toBe('denied'));
        // Every module whose name says it signs in or hands out a key is listed, and denied.
        const credentialish = readdirModules().filter((name) => /^(login|logout|register|captcha)/.test(name));
        credentialish.forEach((name) => expect(neteaseRaw.describeEndpoint(name)?.access, name).toBe('denied'));
        expect(neteaseRaw.describeEndpoint('user_update')?.access).toBe('denied');
        expect(neteaseRaw.describeEndpoint('playlist_delete')).toBeNull();
        expect(neteaseRaw.describeEndpoint('constructor')).toBeNull();
        expect(neteaseRaw.describeEndpoint('no_such_module')).toBeNull();
        expect(neteaseRaw.describeEndpoint('user_record')).toEqual({ access: 'read', selfParam: 'uid' });
        expect(neteaseRaw.describeEndpoint('listen_data_total')?.access).toBe('read');
        expect(neteaseRaw.describeEndpoint('listen_data_realtime_report')?.access).toBe('read');
        expect(neteaseRaw.describeEndpoint('like')?.access).toBe('write');
    });

    it('takes digits only for every parameter a listed module writes into the upstream path', () => {
        // `${query.x}` in a module's '/api/…' path, unless the module first replaces query.x itself
        // (follow's `t`, comment_hot's `type`). A new one after a backend update needs `pathParams`.
        const unchecked = Object.entries(NETEASE_RAW_ENDPOINTS)
            .filter(([, row]) => row.access !== 'denied')
            .flatMap(([name, row]) => {
                const source = readFileSync(path.join(PACKAGE_DIR, 'module', `${name}.js`), 'utf8');
                const paths = source.match(/`\/api\/[^`]*`/g) ?? [];
                const used = new Set(paths.flatMap((text) => Array.from(text.matchAll(/\$\{query\.(\w+)\}/g), (match) => match[1])));
                return Array.from(used)
                    .filter((param) => !new RegExp(`query\\.${param}\\s*=[^=]`).test(source))
                    .filter((param) => !(row.pathParams ?? []).includes(param))
                    .map((param) => `${name}.${param}`);
            });
        expect(unchecked).toEqual([]);
        expect(neteaseRaw.checkParams!('album', { id: '../../logout' })).toMatch(/"id"/);
        expect(neteaseRaw.checkParams!('album', { id: 12 })).toBeNull();
        expect(neteaseRaw.checkParams!('cloudsearch', { keywords: 'AC/DC ../?#%' })).toBeNull();
    });

    it('points only at omni methods that exist', () => {
        const named = Object.entries(NETEASE_RAW_ENDPOINTS).flatMap(([name, row]) => (row.omni ? [[name, row.omni] as const] : []));
        expect(named.length).toBeGreaterThan(0);
        named.forEach(([name, method]) => expect(typeof (omni as Record<string, unknown>)[method], `${name} -> omni.${method}`).toBe('function'));
    });

    it('reports the backend the host pins, read from the package itself', () => {
        const pinned = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies['@neteasecloudmusicapienhanced/api'];
        expect(neteaseRaw.backend).toEqual({ name: '@neteasecloudmusicapienhanced/api', version: pinned });
        expect(omni.getRawRequestInfo('netease')?.backend).toEqual(neteaseRaw.backend);
        expect(omni.getRawRequestInfo('kugou')).toBeNull();
        expect(omni.getRawRequestInfo('no-such-provider')).toBeNull();
    });

    it('routes modules as the backend serves them and writes parameters into the query', () => {
        expect(neteaseRouteOf('user_record')).toBe('/user/record');
        expect(neteaseRouteOf('listen_data_realtime_report')).toBe('/listen/data/realtime/report');
        expect(neteaseRouteOf('personal_fm')).toBe('/personal_fm');
        expect(neteaseRawQuery({ uid: 12, type: 1, flag: true, name: 'a&b', ids: [1, 2], skip: null })).toBe('uid=12&type=1&flag=true&name=a%26b&ids=%5B1%2C2%5D');
    });
});

describe('a NetEase raw request', () => {
    it('sends the module\'s route with the parameters and answers with the raw body', async () => {
        route.mockResolvedValue({ code: 200, weekData: [{ score: 1 }] });
        await expect(neteaseRaw.request('user_record', { uid: 5, type: 1 }, signal())).resolves.toEqual({ code: 200, weekData: [{ score: 1 }] });
        expect(route).toHaveBeenCalledWith('/user/record', 'uid=5&type=1', expect.any(AbortSignal));
    });

    it('turns NetEase\'s sign-in refusals and its rate limit into the shared errors', async () => {
        route.mockResolvedValue({ code: 301, msg: 'need login' });
        await expect(neteaseRaw.request('listen_data_total', {}, signal())).rejects.toMatchObject({ code: 'auth-required' });
        route.mockResolvedValue({ code: 405, msg: '操作频繁' });
        await expect(neteaseRaw.request('listen_data_total', {}, signal())).rejects.toMatchObject({ code: 'unavailable', httpStatus: 429 });
        // Another refusal is the platform's raw answer.
        route.mockResolvedValue({ code: -2, msg: 'no right' });
        await expect(neteaseRaw.request('user_record', { uid: 1 }, signal())).resolves.toEqual({ code: -2, msg: 'no right' });
    });

    it('reads a backend that could not be reached as the network\'s failure, and passes an abort on', async () => {
        route.mockRejectedValue(Object.assign(new Error('NetEase API request /listen/data/total failed'), { networkFailure: true }));
        const failed = await neteaseRaw.request('listen_data_total', {}, signal()).catch((error: unknown) => error) as OnlineProviderError;
        expect(failed).toBeInstanceOf(OnlineProviderError);
        expect(failed.code).toBe('network');
        const aborted = new DOMException('aborted', 'AbortError');
        route.mockRejectedValue(aborted);
        await expect(neteaseRaw.request('listen_data_total', {}, signal())).rejects.toBe(aborted);
    });
});

describe('omni.requestProviderRaw', () => {
    const signInAs = (id: number) => useOnlineProviderAccountStore.getState().updateAccount('netease', {
        status: 'authenticated',
        user: { id, nickname: 'listener' },
        hydration: 'ready',
    });

    it('takes credential fields out of the answer at any depth', async () => {
        route.mockResolvedValue({
            code: 200,
            cookie: 'MUSIC_U=secret',
            data: { token: 't', list: [{ name: 'kept', csrf_token: 'x', MUSIC_U: 'u', nested: { refreshToken: 'r', ok: 1 } }] },
            account: { password: 'p', tokenJsonStr: '{}' },
        });
        const body = await omni.requestProviderRaw('netease', 'listen_data_total', {}, signal());
        expect(body).toEqual({ code: 200, data: { list: [{ name: 'kept', nested: { ok: 1 } }] }, account: {} });
        expect(JSON.stringify(body)).not.toMatch(/secret|MUSIC_U/);
    });

    it('fills in the signed-in user for an endpoint about them, and needs one signed in for it', async () => {
        route.mockResolvedValue({ code: 200 });
        await expect(omni.requestProviderRaw('netease', 'user_record', { type: 1 }, signal())).rejects.toMatchObject({ code: 'auth-required' });
        expect(route).not.toHaveBeenCalled();
        signInAs(4321);
        await omni.requestProviderRaw('netease', 'user_record', { type: 1 }, signal());
        expect(route).toHaveBeenLastCalledWith('/user/record', 'type=1&uid=4321', expect.any(AbortSignal));
        // Someone else's records, named by the caller, are asked as named.
        await omni.requestProviderRaw('netease', 'user_record', { uid: 99 }, signal());
        expect(route).toHaveBeenLastCalledWith('/user/record', 'uid=99', expect.any(AbortSignal));
    });

    it('refuses denied and unlisted endpoints, host parameters, and platforms without raw endpoints', async () => {
        await expect(omni.requestProviderRaw('netease', 'login_status', {}, signal())).rejects.toMatchObject({ code: 'unsupported' });
        await expect(omni.requestProviderRaw('netease', 'playlist_delete', {}, signal())).rejects.toMatchObject({ code: 'unsupported' });
        await expect(omni.requestProviderRaw('netease', 'listen_data_total', { proxy: 'http://evil.example' }, signal())).rejects.toMatchObject({ code: 'unsupported' });
        await expect(omni.requestProviderRaw('kugou', 'anything', {}, signal())).rejects.toMatchObject({ code: 'unsupported' });
        await expect(omni.requestProviderRaw('netease', 'album', { id: '../../logout' }, signal())).rejects.toMatchObject({ code: 'unsupported' });
        expect(route).not.toHaveBeenCalled();
    });
});

describe('withoutCredentials', () => {
    it('drops what JSON has no place for and keeps the rest', () => {
        expect(withoutCredentials({ a: 1, b: undefined, c: () => 1, d: [undefined, NaN, 'x'], Cookie: 'c' }))
            .toEqual({ a: 1, d: [null, null, 'x'] });
        expect(withoutCredentials({ MUSIC_U: 'u', music_a: 'a' }, ['MUSIC_U', 'MUSIC_A'])).toEqual({});
        expect(withoutCredentials('plain')).toBe('plain');
    });
});
