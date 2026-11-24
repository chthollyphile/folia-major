// @builtin-sources
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fnMusicCoverUrl } from '../../../sources/fnmusic/client/fnmusicTransport';
import { normalizeFnMusicSong } from '../../../sources/fnmusic/client/fnmusicProvider';
import { answerFnMusicRequests, fnmusicProvider } from '../helpers/fnmusicSource';

// test/unit/fnmusic/fnmusicProvider.test.ts
// 飞牛音源模组经注册着的音源跑（helpers/fnmusicSource.ts）：归一化、登录参数、账号、播放、歌词与封面地址。
// 桥的答复用替身，不碰真实 fnOS 服务。封面与播放走模组的 _media 路由，地址稳定、不带 base / token / 明文凭据。

let bridge: ReturnType<typeof answerFnMusicRequests>;

beforeEach(() => {
    bridge = answerFnMusicRequests();
});
afterEach(() => {
    bridge.off();
});

// 迁之前 normalizeFnMusicSong 的宿主形状：原始记录经模组变成 DTO，再经宿主的 normalizeSong 变成宿主的歌。
const hostSong = (raw: unknown) => fnmusicProvider().normalizeSong(normalizeFnMusicSong(raw));

describe('fnMusicCoverUrl', () => {
    it('builds a stable cover route address from coverId only, without base or token', () => {
        const url = fnMusicCoverUrl('cover-123', 300);
        expect(url).toBe('folia-mod://fnmusic/_media/cover?coverId=cover-123&size=300');
        expect(url).not.toMatch(/base=|token=|127\.0\.0\.1/);
    });

    it('returns an empty string when there is no coverId', () => {
        expect(fnMusicCoverUrl('')).toBe('');
        expect(fnMusicCoverUrl(undefined as unknown as string)).toBe('');
    });
});

describe('fnmusic sign-in form', () => {
    it('declares the three fields, the button, the note and the errors by code, in the mod\'s own texts', () => {
        const form = fnmusicProvider().auth!.getLoginForm!();
        expect(form.fields.map(field => [field.key, field.type, field.required])).toEqual([
            ['base', 'url', true], ['username', 'text', true], ['password', 'password', true],
        ]);
        expect(form.fields.every(field => typeof field.labelKey === 'string' && field.labelKey.length > 0)).toBe(true);
        expect(Object.keys(form.errorKeys ?? {}).sort()).toEqual(['auth-required', 'invalid-response', 'network', 'unavailable']);
        expect(form.submitLabelKey).toBeTruthy();
        expect(form.noteKey).toBeTruthy();
    });

    it('sends the login operation without a device id (the main entry reuses or makes it) and no token comes back', async () => {
        bridge.request.mockResolvedValue({ ok: true, data: { user: { guid: 'u1', name: 'Tester' } } });
        await fnmusicProvider().auth!.submitLoginForm!({ base: 'http://192.168.1.10:5666', username: 'alice', password: 'secret' });
        expect(bridge.request).toHaveBeenCalledWith('login', { base: 'http://192.168.1.10:5666', username: 'alice', password: 'secret' });
    });

    it('fails a wrong password (120001) as auth-required, which the form shows as bad credentials', async () => {
        bridge.request.mockResolvedValue({ ok: false, status: 200, error: { code: 120001, message: 'bad password' } });
        await expect(fnmusicProvider().auth!.submitLoginForm!({ base: 'nas', username: 'a', password: 'b' }))
            .rejects.toMatchObject({ code: 'auth-required' });
    });

    it('fails an address that is not a server as unavailable, and an unreachable one as network', async () => {
        bridge.request.mockResolvedValueOnce({ ok: false, status: 0, error: { code: 'invalid-base', message: 'bad base' } });
        await expect(fnmusicProvider().auth!.submitLoginForm!({ base: 'ftp://x', username: 'a', password: 'b' })).rejects.toMatchObject({ code: 'unavailable' });
        bridge.request.mockResolvedValueOnce({ ok: false, status: 0, error: { code: 'network', message: 'ECONNREFUSED' } });
        await expect(fnmusicProvider().auth!.submitLoginForm!({ base: 'nas', username: 'a', password: 'b' })).rejects.toMatchObject({ code: 'network' });
    });

    it('lets a failure of the main entry itself go up as it is, not as an unreachable server', async () => {
        const broken = new Error('rpc-not-found');
        bridge.request.mockRejectedValueOnce(broken);
        const caught: unknown = await fnmusicProvider().auth!.submitLoginForm!({ base: 'nas', username: 'a', password: 'b' }).catch((error: unknown) => error);
        expect(caught).toBe(broken);
    });
});

describe('fnmusic account', () => {
    const status = (extra: Record<string, unknown>) => ({
        ok: true,
        data: { available: true, configured: true, authenticated: true, base: 'http://192.168.1.10:5666', username: 'admin', userId: null, nickname: null, ...extra },
    });

    it('reads the account as the NAS user guid and nickname saved at sign-in', async () => {
        bridge.request.mockResolvedValue(status({ userId: 'user-guid-1', nickname: 'Alice' }));
        await expect(fnmusicProvider().auth!.getLoginStatus!()).resolves.toMatchObject({ id: 'user-guid-1', nickname: 'Alice' });
        expect(bridge.request).toHaveBeenCalledWith('getStatus', {});
    });

    it('without a guid, the same sign-in name on two servers is two accounts', async () => {
        bridge.request.mockResolvedValueOnce(status({}));
        const first = await fnmusicProvider().auth!.getLoginStatus!();
        bridge.request.mockResolvedValueOnce(status({ base: 'https://nas.example.com:5667' }));
        const second = await fnmusicProvider().auth!.getLoginStatus!();
        expect(first).toMatchObject({ id: 'admin@192.168.1.10:5666', nickname: 'admin' });
        expect(second?.id).toBe('admin@nas.example.com:5667');
    });

    it('is signed out when the bridge holds no token', async () => {
        bridge.request.mockResolvedValue(status({ authenticated: false }));
        await expect(fnmusicProvider().auth!.getLoginStatus!()).resolves.toBeNull();
    });

    it('signs out through the main entry', async () => {
        await fnmusicProvider().auth!.logout();
        expect(bridge.request).toHaveBeenCalledWith('logout', {});
    });
});

describe('fnmusic playback', () => {
    it('lists one quality level and asks the main entry for the original file without a quality', async () => {
        expect(fnmusicProvider().playback!.audioQualityLevels).toEqual(['standard']);
        bridge.request.mockResolvedValue({ ok: true, data: { url: 'folia-mod://fnmusic/_media/stream?guid=track-1' } });
        const source = await fnmusicProvider().playback!.getAudioSource(hostSong({ guid: 'track-1' }), 'standard');
        expect(source?.url).toBe('folia-mod://fnmusic/_media/stream?guid=track-1');
        expect(bridge.request).toHaveBeenCalledWith('stream', { trackId: 'track-1' });
    });

    it('reads a song by id from track/metadata', async () => {
        bridge.request.mockResolvedValue({ ok: true, data: { track: { guid: 'track-9', title: 'Nine' } } });
        const song = await fnmusicProvider().playback!.getSongDetail!('track-9');
        expect(song).toMatchObject({ id: 'track-9', name: 'Nine' });
        expect(bridge.request).toHaveBeenCalledWith('request', expect.objectContaining({ path: '/music/api/v1/track/metadata', params: { trackGUID: 'track-9' } }));
    });
});

describe('fnmusic lyrics', () => {
    it('asks lyric/list by the track and takes the preferred document first', async () => {
        bridge.request.mockResolvedValue({ ok: true, data: { preferred: 1, list: [{ lyric: '[00:01.00]first' }, { lyric: '[00:02.00]preferred' }] } });
        const result = await fnmusicProvider().lyrics!.getLyrics(hostSong({ guid: 'track-1' }));
        expect(bridge.request).toHaveBeenCalledWith('request', expect.objectContaining({ path: '/music/api/v1/lyric/list', params: { trackGUID: 'track-1' } }));
        expect(result.mainText).toBe('[00:02.00]preferred');
    });

    it('has no lyrics when the list is empty', async () => {
        bridge.request.mockResolvedValue({ ok: true, data: { list: [] } });
        const result = await fnmusicProvider().lyrics!.getLyrics(hostSong({ guid: 'track-1' }));
        expect(result.lyrics).toBeNull();
    });
});

describe('fnmusic library and catalog', () => {
    it('pages the playlists by page and size, with covers from the cover route', async () => {
        bridge.request.mockResolvedValue({ ok: true, data: { total: 3, list: [{ guid: 'p1', name: 'One', coverId: 'c1', trackCount: 2 }] } });
        const page = await fnmusicProvider().library!.getUserPlaylists('u', 1, 2);
        expect(bridge.request).toHaveBeenCalledWith('request', expect.objectContaining({ path: '/music/api/v1/playlist/list', params: { page: 3, size: 1 } }));
        expect(page).toMatchObject({ total: 3, hasMore: false, nextOffset: 3 });
        expect(page.items[0]).toMatchObject({ id: 'p1', name: 'One', type: 'playlist', trackCount: 2 });
        expect(page.items[0].coverUrl).toMatch(/^folia-mod:\/\/fnmusic\/_media\/cover\?coverId=c1&size=/);
    });

    it('reads the liked ids to the end before saying whole', async () => {
        bridge.request.mockResolvedValueOnce({ ok: true, data: { total: 2, list: [{ trackGUID: 'a' }, { trackGUID: 'b' }] } });
        await expect(fnmusicProvider().library!.getLikedSongIds!('u')).resolves.toEqual({ ids: ['a', 'b'], whole: true });
        bridge.request.mockResolvedValueOnce({ ok: false, status: 500, error: { code: 'network', message: 'down' } });
        await expect(fnmusicProvider().library!.getLikedSongIds!('u')).resolves.toEqual({ ids: [], whole: false });
    });

    it('adds songs to a playlist and likes a song with the track guids', async () => {
        await fnmusicProvider().mutations!.updatePlaylistTracks!('add', 'p1', ['t1', hostSong({ guid: 't2' })]);
        expect(bridge.request).toHaveBeenLastCalledWith('request', expect.objectContaining({
            path: '/music/api/v1/playlist/add-track', method: 'POST', body: { guid: 'p1', trackGUIDs: ['t1', 't2'] },
        }));
        await fnmusicProvider().mutations!.likeSong!(hostSong({ guid: 't3' }), false);
        expect(bridge.request).toHaveBeenLastCalledWith('request', expect.objectContaining({
            path: '/music/api/v1/favorite-track/delete', method: 'POST', body: { trackGUID: 't3' },
        }));
    });

    it('has no playlist saving', () => {
        expect(fnmusicProvider().capabilities.playlistSubscription).toBe(false);
    });
});

describe('normalizeFnMusicSong', () => {
    it('normalizes the web adapter fields and keeps coverId in providerData', () => {
        const song = hostSong({
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
        expect(song.album.coverUrl).toMatch(/^folia-mod:\/\/fnmusic\/_media\/cover\?coverId=cover-1&size=/);
        if (song.sourceRef.kind !== 'online') throw new Error('expected an online source');
        expect(song.sourceRef.providerData?.coverId).toBe('cover-1');
    });

    it('leaves the name and cover empty when the record has only a guid', () => {
        const song = hostSong({ guid: 'track-2' });
        expect(song.name).toBe('');
        expect(song.album.coverUrl ?? '').toBe('');
    });

    it('refuses a record without a guid', () => {
        expect(() => normalizeFnMusicSong({ title: 'x' })).toThrow();
    });
});
