import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppleMusicPlaylists } from '../../../src/services/onlineMusic/appleMusic/appleMusicData';

// A one-row response is not the playlist's total; missing counts remain unknown.
const require = createRequire(import.meta.url);
const { validateRequest, requestExpression } = require('../../../electron/appleMusic/companionRequests.cjs');
afterEach(() => vi.unstubAllGlobals());

describe('Apple Music playlist counts', () => {
    it.each([63, 0, null, -1, '63', 1.5])('returns only a valid total, not the loaded row count (%s)', async total => {
        const call = vi.fn(async (path: string) => path === 'v1/me/storefront'
            ? { status: 200, data: { data: [{ id: 'cn' }] } }
            : { status: 200, data: { data: [{ id: '123' }], meta: { total }, next: '?offset=1' } });
        const request = validateRequest({ id: 'count', operation: 'playlistTrackCount', params: { playlistId: 'p.a' } });
        const result = await runInNewContext(requestExpression(request), { window: { MusicKit: { getInstance: () => ({ api: { music: call } }) } } });
        expect(result).toMatchObject({ ok: true, data: { total: typeof total === 'number' && Number.isSafeInteger(total) && total >= 0 ? total : null } });
        expect(call).toHaveBeenLastCalledWith('v1/me/library/playlists/p.a/tracks', { limit: 1 });
    });
    it('attaches real counts and preserves an unknown count when its request fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const request = vi.fn(async (op: string, params: Record<string, unknown>) => op === 'playlists'
            ? { ok: true, data: { items: ['a', 'b', 'c'].map(id => ({ id: `p.${id}`, type: 'library-playlists', attributes: {} })), hasMore: false, nextOffset: 3 } }
            : params.playlistId === 'p.c' ? { ok: false, error: 'request-failed' }
                : { ok: true, data: { total: params.playlistId === 'p.a' ? 63 : 0 } });
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const result = await getAppleMusicPlaylists(100, 0, true);
        expect(result.items.map(item => item.trackCount)).toEqual([63, 0, undefined]);
        expect(result.hasMore).toBe(false);
        vi.restoreAllMocks();
    });
    it('limits simultaneous count reads to two', async () => {
        let active = 0;
        let maximum = 0;
        const request = vi.fn(async (op: string) => {
            if (op === 'playlists') return { ok: true, data: { items: Array.from({ length: 5 }, (_, i) => ({ id: `p.${i}`, type: 'library-playlists', attributes: {} })), hasMore: false, nextOffset: 5 } };
            active++;
            maximum = Math.max(maximum, active);
            await Promise.resolve();
            active--;
            return { ok: true, data: { total: 12 } };
        });
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        const result = await getAppleMusicPlaylists(100, 0, true);
        expect(maximum).toBe(2);
        expect(result.items.map(item => item.trackCount)).toEqual([12, 12, 12, 12, 12]);
    });
    it('does not fetch optional counts for internal favorite-list discovery', async () => {
        const request = vi.fn(async () => ({ ok: true, data: { items: [{ id: 'p.a', type: 'library-playlists', attributes: {} }], hasMore: false, nextOffset: 1 } }));
        vi.stubGlobal('window', { electron: { appleMusicRequest: request } });
        await getAppleMusicPlaylists(100, 0, false);
        expect(request).toHaveBeenCalledOnce();
    });
});
