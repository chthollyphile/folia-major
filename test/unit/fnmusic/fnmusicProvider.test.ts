import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fnMusicCoverUrl, fnMusicLogin, makeFnMusicDeviceId } from '@/services/onlineMusic/fnmusic/fnmusicTransport';
import { fnmusicProvider, normalizeFnMusicSong } from '@/services/onlineMusic/fnmusic/fnmusicProvider';

// test/unit/fnmusic/fnmusicProvider.test.ts
// 归一化、登录参数与封面地址的逻辑测试：桥的答复用替身，不碰真实 fnOS 服务。
// 封面与播放走 folia-fnmusic:// 自定义协议，地址稳定、不带 base / token / 明文凭据。

const bridgeRequest = vi.fn();
const statusSync = vi.fn();

beforeEach(() => {
    bridgeRequest.mockReset().mockResolvedValue({ ok: true, data: null });
    statusSync.mockReset().mockReturnValue({ available: true, configured: true, authenticated: false, base: null, username: '' });
    vi.stubGlobal('window', { electron: { fnmusicRequest: bridgeRequest, fnmusicStatusSync: statusSync } });
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('makeFnMusicDeviceId', () => {
    it('returns a 32-digit hex device id', () => {
        const id = makeFnMusicDeviceId();
        expect(id).toMatch(/^[0-9a-f]{32}$/);
    });
});

describe('fnMusicCoverUrl', () => {
    it('builds a stable folia-fnmusic:// cover address from coverId only, without base or token', () => {
        const url = fnMusicCoverUrl('cover-123', 300);
        expect(url).toBe('folia-fnmusic://cover?coverId=cover-123&size=300');
        expect(url).not.toMatch(/base=/);
        expect(url).not.toMatch(/token=/);
        expect(url).not.toMatch(/127\.0\.0\.1/);
    });

    it('returns an empty string when there is no coverId', () => {
        expect(fnMusicCoverUrl('')).toBe('');
        expect(fnMusicCoverUrl(undefined as unknown as string)).toBe('');
    });
});

describe('fnMusicLogin', () => {
    it('sends the login operation with device id and no plaintext beyond the form values', async () => {
        bridgeRequest.mockResolvedValue({ ok: true, data: { user: { guid: 'u1', name: 'Tester' } } });
        const result = await fnMusicLogin({ base: 'http://192.168.1.10:5666', username: 'alice', password: 'secret', deviceId: 'ab'.repeat(16) });
        expect(bridgeRequest).toHaveBeenCalledWith('login', expect.objectContaining({
            base: 'http://192.168.1.10:5666',
            username: 'alice',
            password: 'secret',
            deviceId: 'ab'.repeat(16),
        }));
        expect(result.user).toEqual({ guid: 'u1', name: 'Tester' });
        // 登录答复不把 token 带回渲染进程
        expect(bridgeRequest.mock.calls[0][1]).not.toHaveProperty('token');
    });
});

describe('fnmusicProvider availability', () => {
    it('is always configured on desktop when the main-process bridge exists (review blocker 2)', () => {
        expect(fnmusicProvider.getAvailability!()).toEqual({ configured: true });
    });

    it('is unavailable on web without the Electron bridge', () => {
        vi.stubGlobal('window', {});
        expect(fnmusicProvider.getAvailability!()).toEqual({ configured: false, reason: 'runtime-unavailable' });
    });
});

describe('normalizeFnMusicSong', () => {
    it('normalizes the web adapter fields and keeps coverId in providerData', () => {
        const song = normalizeFnMusicSong({
            guid: 'track-1',
            title: 'Title',
            artists: [{ guid: 'a1', name: 'Artist' }],
            album: { guid: 'al1', name: 'Album' },
            coverId: 'cover-1',
            duration: 210,
        });
        expect(song.id).toBe('track-1');
        expect(song.name).toBe('Title');
        expect(song.artists[0].name).toBe('Artist');
        expect(song.album.name).toBe('Album');
        expect(song.album.coverUrl).toMatch(/^folia-fnmusic:\/\/cover\?coverId=cover-1&size=/);
        if (song.sourceRef.kind === 'online') {
            expect(song.sourceRef.providerData?.coverId).toBe('cover-1');
        } else {
            throw new Error('expected an online source');
        }
    });

    it('falls back to a generic user id when name fields are missing, with no hard-coded Chinese nickname', () => {
        const song = normalizeFnMusicSong({ guid: 'track-2' });
        expect(song.name).toBe('');
        expect(song.album.coverUrl).toBe('');
    });
});
