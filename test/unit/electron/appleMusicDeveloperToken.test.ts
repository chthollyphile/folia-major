import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

// test/unit/electron/appleMusicDeveloperToken.test.ts

const require = createRequire(import.meta.url);
const { createDeveloperTokenSource } = require('../../../electron/appleMusic/developerTokenSource.cjs');
const token = (exp: number) => [JSON.stringify({ alg: 'ES256' }), JSON.stringify({ exp })]
    .map(s => Buffer.from(s).toString('base64url')).join('.') + '.signature';

const options = () => ({ endpoint: 'https://music.example/token', fallback: vi.fn(), now: () => 1000000 });

describe('maintainer-owned Apple Music developer token', () => {
    it('uses the configured service instead of local credentials and coalesces simultaneous requests', async () => {
        const config = options();
        const jwt = token(2000);
        const fetchToken = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: jwt }) });
        const resolve = createDeveloperTokenSource({ ...config, fetchToken });
        expect(await Promise.all([resolve(), resolve(), resolve()])).toEqual([jwt, jwt, jwt]);
        await resolve();
        expect(fetchToken).toHaveBeenCalledTimes(1);
        expect(config.fallback).not.toHaveBeenCalled();
        expect(fetchToken.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
    });
    it('refreshes near expiry and uses the still-valid cache during an outage', async () => {
        let now = 1000000;
        const first = token(2000);
        const next = token(3000);
        const fetchToken = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ token: first }) })
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce({ ok: true, json: async () => ({ token: next }) });
        const resolve = createDeveloperTokenSource({ ...options(), now: () => now, fetchToken });
        expect(await resolve()).toBe(first);
        now = 1800000;
        expect(await resolve()).toBe(first);
        expect(await resolve()).toBe(next);
    });
    it('does not fall back to a personal token when a configured service fails', async () => {
        const config = options();
        const resolve = createDeveloperTokenSource({ ...config, fetchToken: vi.fn().mockRejectedValue(new Error('offline')) });
        await expect(resolve()).rejects.toThrow('token-service-unavailable');
        expect(config.fallback).not.toHaveBeenCalled();
    });
    it('rejects insecure endpoints and expired service tokens', async () => {
        const fetchToken = vi.fn();
        await expect(createDeveloperTokenSource({ ...options(), endpoint: 'http://music.example/token', fetchToken })()).rejects.toThrow('developer-token-invalid');
        expect(fetchToken).not.toHaveBeenCalled();
        fetchToken.mockResolvedValue({ ok: true, json: async () => ({ token: token(1000) }) });
        await expect(createDeveloperTokenSource({ ...options(), fetchToken })()).rejects.toThrow('developer-token-expired');
    });
    it('preserves the existing local development setup when no service is configured', async () => {
        const fallback = vi.fn().mockReturnValue('local-fixture');
        expect(await createDeveloperTokenSource({ endpoint: '', fallback })()).toBe('local-fixture');
    });
});
