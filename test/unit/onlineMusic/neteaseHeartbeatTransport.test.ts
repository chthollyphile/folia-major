import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/neteaseHeartbeatTransport.test.ts
// Verifies the Enhanced API endpoint contract without accessing a real account.

describe('NetEase heartbeat request', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv('VITE_NETEASE_API_BASE', 'http://127.0.0.1:3000');
        vi.stubGlobal('window', {});
        vi.stubGlobal('localStorage', {
            getItem: vi.fn((key: string) => key === 'netease_cookie' ? 'test-session' : null),
            setItem: vi.fn(), removeItem: vi.fn(),
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            status: 200, text: async () => JSON.stringify({ code: 200, data: [] }),
        }));
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it.each([undefined, 789])('maps sid=%s without inventing a count parameter', async sid => {
        const { neteaseApi } = await import('@/services/netease');
        await expect(neteaseApi.getHeartbeatSongs(456, 123, sid)).resolves.toEqual({ code: 200, data: [] });
        const [url, init] = vi.mocked(fetch).mock.calls[0];
        const request = new URL(String(url));
        expect(request.pathname).toBe('/playmode/intelligence/list');
        expect(request.searchParams.get('id')).toBe('456');
        expect(request.searchParams.get('pid')).toBe('123');
        expect(request.searchParams.get('sid')).toBe(sid === undefined ? null : '789');
        expect(request.searchParams.has('count')).toBe(false);
        expect(request.searchParams.has('timestamp')).toBe(true);
        expect(request.searchParams.get('cookie')).toBe('test-session');
        expect(init?.credentials).toBe('include');
    });
});
