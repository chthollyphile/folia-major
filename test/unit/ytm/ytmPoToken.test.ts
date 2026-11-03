import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// test/unit/ytm/ytmPoToken.test.ts — the proof-of-origin token minter. Its page scripts run for
// real, in a VM context standing in for the sandbox page, against a stand-in for BotGuard.

const require = createRequire(import.meta.url);
const { createYtmTokenMinter } = require('../../../electron/ytm/poToken.cjs');

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
// Bytes 0xfb 0xff: every character of the web-safe alphabet that differs from plain base64.
const INTEGRITY_TOKEN = '-_8.';

// The stand-in BotGuard: its minter prefixes the binding with the integrity token's bytes.
const INTERPRETER = `globalThis.fakeGuard = { a: async (program, setUp) => {
    setUp((resolve, args) => {
        args[2][0] = async integrity => async binding => new Uint8Array([...integrity, ...binding]);
        resolve('answer:' + program);
    });
} };`;
const challenge = () => ({
    program: 'program-1', globalName: 'fakeGuard',
    interpreterJavascript: { privateDoNotAccessOrElseSafeScriptWrappedValue: INTERPRETER },
});
const tokenFor = (binding: string) => Buffer.from([0xfb, 0xff, ...Buffer.from(binding)]).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

const setup = () => {
    let page = vm.createContext({ atob, btoa, TextEncoder });
    let time = 1_700_000_000_000;
    const evaluate = vi.fn(async (code: string) => vm.runInContext(code, page));
    const getChallenge = vi.fn(async (_config: { fetchFunction: (url: string, init: object) => Promise<unknown>; requestKey: string }) => challenge());
    const fetch = vi.fn(async (_url: string, _init: { body?: string; signal?: AbortSignal }) => ({ ok: true, status: 200, json: async () => [INTEGRITY_TOKEN, 43200, 100] }));
    const loadLibrary = vi.fn(async () => ({
        getChallenge, buildURL: (name: string, youtube: boolean) => `https://${youtube ? 'www.youtube.com' : 'waa.example'}/${name}`,
        getHeaders: () => ({ 'content-type': 'application/json+protobuf' }),
    }));
    const minter = createYtmTokenMinter({ fetch, evaluate, loadLibrary, now: () => time });
    return {
        minter, evaluate, getChallenge, fetch, loadLibrary,
        advance: (ms: number) => { time += ms; },
        replacePage: () => { page = vm.createContext({ atob, btoa, TextEncoder }); },
    };
};

describe('YouTube Music proof-of-origin tokens', () => {
    it('runs BotGuard in the page, trades its answer for an integrity token, and mints per binding', async () => {
        const { minter, getChallenge, fetch } = setup();
        expect(await minter.mint('m9SMT5ipbxk')).toBe(tokenFor('m9SMT5ipbxk'));
        // The script is asked for at www.youtube.com too, so that no other host has to be reachable.
        expect(getChallenge).toHaveBeenCalledWith({ fetchFunction: expect.any(Function), requestKey: REQUEST_KEY, useYouTubeAPI: true });
        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, request] = fetch.mock.calls[0];
        expect(url).toBe('https://www.youtube.com/GenerateIT');
        expect(request).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json+protobuf' } });
        expect(JSON.parse(String(request.body))).toEqual([REQUEST_KEY, 'answer:program-1']);
        // Neither request may wait for ever: every track waits for this set-up.
        expect(request.signal).toBeInstanceOf(AbortSignal);
        await getChallenge.mock.calls[0][0].fetchFunction('https://www.youtube.com/Create', { method: 'POST' });
        expect(fetch.mock.calls[1]).toEqual(['https://www.youtube.com/Create', { method: 'POST', signal: expect.any(AbortSignal) }]);

        expect(await minter.mint('dQw4w9WgXcQ')).toBe(tokenFor('dQw4w9WgXcQ'));
        expect(getChallenge).toHaveBeenCalledTimes(1);
    });

    it('sets up once for concurrent callers', async () => {
        const { minter, getChallenge } = setup();
        expect(await Promise.all([minter.mint('a'), minter.mint('b')])).toEqual([tokenFor('a'), tokenFor('b')]);
        expect(getChallenge).toHaveBeenCalledTimes(1);
    });

    it('sets up again in a page that replaced the one it used', async () => {
        const { minter, getChallenge, replacePage } = setup();
        await minter.mint('a');
        replacePage();
        expect(await minter.mint('b')).toBe(tokenFor('b'));
        expect(getChallenge).toHaveBeenCalledTimes(2);
    });

    it('replaces the minter at half the lifetime Google states', async () => {
        const { minter, getChallenge, advance } = setup();
        await minter.mint('a');
        advance(6 * 60 * 60 * 1000 - 1);
        await minter.mint('a');
        expect(getChallenge).toHaveBeenCalledTimes(1);
        advance(1);
        expect(await minter.mint('a')).toBe(tokenFor('a'));
        expect(getChallenge).toHaveBeenCalledTimes(2);
    });

    it('fails without a usable challenge or integrity token, and tries again on the next call', async () => {
        const { minter, getChallenge, fetch } = setup();
        getChallenge.mockResolvedValueOnce({ ...challenge(), interpreterJavascript: undefined as never });
        await expect(minter.mint('a')).rejects.toThrow('BotGuard challenge is incomplete');
        fetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => [] });
        await expect(minter.mint('a')).rejects.toThrow('status 403');
        fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => [null] as never });
        await expect(minter.mint('a')).rejects.toThrow('no integrity token');
        expect(await minter.mint('a')).toBe(tokenFor('a'));
        expect(getChallenge).toHaveBeenCalledTimes(4);
    });

    it('reports a BotGuard that does not start', async () => {
        const { minter, getChallenge } = setup();
        getChallenge.mockResolvedValueOnce({ ...challenge(), globalName: 'missingGuard' });
        await expect(minter.mint('a')).rejects.toThrow('BotGuard is unavailable');
    });
});
