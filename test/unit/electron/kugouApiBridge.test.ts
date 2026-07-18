import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/kugouApiBridge.test.ts

const require = createRequire(import.meta.url);
const { createKugouApiBridge, createKugouFileLogger } = require('../../../electron/kugouApiBridge.cjs');

const createStore = () => {
    const values = new Map<string, unknown>();
    return {
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => values.set(key, value),
    };
};

describe('Electron KuGou API bridge', () => {
    it('absorbs credentials, strips secrets, and reuses the session', async () => {
        const userDetail = vi.fn(async (params: any) => ({
            body: { data: { nickname: 'Kugou User' } },
            cookie: [],
        }));
        const api = {
            register_dev: async () => ({ body: { status: 1 }, cookie: ['dfid=device-dfid'] }),
            login_qr_check: async () => ({
                body: { data: { status: 4, token: 'secret-token', userid: '123' } },
                cookie: ['token=secret-token', 'userid=123'],
            }),
            user_detail: userDetail,
        };
        const bridge = createKugouApiBridge({ store: createStore(), apiLoader: () => api });

        const login = await bridge.request('login_qr_check', { key: 'qr' });
        expect(login).toEqual({ data: { status: 4 } });
        const profile = await bridge.request('user_detail', { userid: 'renderer-user-id' });
        expect(profile).toEqual({ data: { nickname: 'Kugou User', userid: '123' } });
        expect(userDetail.mock.calls[0][0].userid).toBe('123');
        expect(userDetail.mock.calls[0][0].cookie).toEqual(expect.objectContaining({
            token: 'secret-token', userid: '123', dfid: 'device-dfid',
        }));
    });

    it('clears account credentials without deleting the device identity', async () => {
        const store = createStore();
        const bridge = createKugouApiBridge({ store, apiLoader: () => ({
            register_dev: async () => ({ body: {}, cookie: ['dfid=device'] }),
            login_qr_check: async () => ({ body: { data: { status: 4 } }, cookie: ['token=secret', 'userid=9'] }),
        }) });
        await bridge.request('login_qr_check', {});
        await expect(bridge.request('logout')).resolves.toEqual({ code: 200 });
        const stored = store.get('KUGOU_API_SESSION_V1') as Record<string, string>;
        expect(stored.token).toBeUndefined();
        expect(stored.userid).toBeUndefined();
        expect(stored.KUGOU_API_GUID).toBeTruthy();
    });

    it('rejects operations outside the fixed allowlist', async () => {
        const bridge = createKugouApiBridge({ store: createStore(), apiLoader: () => ({}) });
        await expect(bridge.request('arbitrary_url', {})).rejects.toThrow('Unsupported KuGou operation');
    });

    it('redacts credentials from the persistent diagnostic log', () => {
        const writes: string[] = [];
        const directory = mkdtempSync(join(tmpdir(), 'folia-kugou-log-'));
        const logPath = join(directory, 'kugou-provider.log');
        try {
            const logger = createKugouFileLogger(logPath, {
                info: (_message: string, details: unknown) => writes.push(JSON.stringify(details)),
                warn: (_message: string, details: unknown) => writes.push(JSON.stringify(details)),
            });

            logger.info('test', { token: 'secret', message: 'userid=123&token=abc', hasToken: true });

            expect(writes[0]).not.toContain('secret');
            const persisted = readFileSync(logPath, 'utf8');
            expect(persisted).not.toContain('secret');
            expect(persisted).not.toContain('userid=123');
            expect(persisted).toContain('[REDACTED]');
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
