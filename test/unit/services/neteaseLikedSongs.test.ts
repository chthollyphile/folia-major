import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/services/neteaseLikedSongs.test.ts
// The liked list is asked for past the API server's cache, which answers a repeated address with
// what it answered before for two minutes.

describe('netease liked songs request', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
        vi.stubEnv('VITE_NETEASE_API_BASE', 'http://127.0.0.1:3000');
        vi.stubGlobal('localStorage', {
            getItem: vi.fn((key: string) => key === 'netease_cookie' ? 'mock-user-cookie' : null),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        });
        vi.stubGlobal('window', {});
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 200, ids: [1] })));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('asks a new address at every read, so that no read is answered from the cache', async () => {
        vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);
        const { neteaseApi } = await import('@/services/onlineMusic/netease/netease');

        await neteaseApi.getLikedSongs(7);
        await neteaseApi.getLikedSongs(7);

        const asked = vi.mocked(fetch).mock.calls.map(call => String(call[0]));
        expect(asked[0]).toContain('/likelist?uid=7&timestamp=1000');
        expect(asked[1]).toContain('/likelist?uid=7&timestamp=2000');
    });
});
