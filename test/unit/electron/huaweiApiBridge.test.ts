import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/huaweiApiBridge.test.ts
// 华为音乐主进程桥的边界：只认白名单操作，搜索按签名头匿名发，播放要有会话，
// 歌词只读放行过的域名。网络答复用替身，不碰真实华为服务。

const require = createRequire(import.meta.url);
const { createHuaweiApiBridge } = require('../../../electron/huawei/huaweiApiBridge.cjs');
const { createSessionRepository, SESSION_KEY } = require('../../../electron/huawei/session.cjs');

const store = () => {
    const values = new Map<string, unknown>();
    return {
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => values.set(key, value),
        delete: (key: string) => values.delete(key),
    };
};

const cipher = () => ({
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'keychain',
    encryptString: (text: string) => Buffer.from(Buffer.from(text).map(byte => byte ^ 0xa5)),
    decryptString: (bytes: Buffer) => Buffer.from(bytes.map(byte => byte ^ 0xa5)).toString(),
});

type FetchLike = (url: string, options?: RequestInit) => Promise<Response>;

const bridgeOf = (fetch: FetchLike, warn = vi.fn(), saved = store()) => createHuaweiApiBridge({
    store: saved,
    safeStorage: cipher(),
    fetch,
    BrowserWindow: function BrowserWindow() {
        throw new Error('the login window is not opened in this test');
    },
    session: { fromPartition: () => ({ clearStorageData: async () => {} }) },
    parentWindow: () => null,
    warn,
});

const envelope = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('Huawei Music desktop bridge', () => {
    it('rejects an operation outside the table before any network read', async () => {
        const fetch = vi.fn();
        const bridge = bridgeOf(fetch);
        for (const operation of ['login', 'playlist', 'constructor']) {
            expect(await bridge.request(operation)).toMatchObject({ ok: false, error: { code: 'unsupported' } });
        }
        expect(fetch).not.toHaveBeenCalled();
    });

    it('sends an anonymous signed search and maps paging', async () => {
        const fetch = vi.fn(async () => envelope({
            result: { resultCode: '000000', resultMessage: 'Success!' },
            totalNum: '200',
            hasNextPage: '1',
            songSimpleInfos: [{ contentID: '1092974', contentName: '晴天' }],
        }));
        const bridge = bridgeOf(fetch);
        const result = await bridge.request('search', { query: '晴天', limit: 1, offset: 0 });
        expect(result).toMatchObject({
            ok: true,
            data: { total: 200, hasMore: true, nextOffset: 1, items: [{ contentID: '1092974', contentName: '晴天' }] },
        });
        const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        const headers = options.headers as Record<string, string>;
        expect(headers.Authorization).toMatch(/^Digest username=app-music-baseline, nonce=/);
        expect(headers.Authorization).not.toContain('token=');
        expect(JSON.parse(String(options.body))).toMatchObject({
            contentType: '1', correct: '1', queryWord: '晴天', start: '0', limit: '1',
        });
    });

    it('searches albums and playlists through the response field of each kind', async () => {
        const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
            const body = JSON.parse(String(options?.body));
            return envelope({
                result: { resultCode: '000000', resultMessage: 'Success!' },
                hasNextPage: '0',
                totalNum: '1',
                ...(body.contentType === '2'
                    ? { albumSimpleInfos: [{ contentID: '35239276', contentName: '太阳之子' }] }
                    : { musicListSimpleInfos: [{ contentID: '112927', contentName: '周杰伦精选' }] }),
            });
        });
        const bridge = bridgeOf(fetch);
        expect(await bridge.request('search', { query: '周杰伦', limit: 1, offset: 0, kind: 'album' }))
            .toMatchObject({ ok: true, data: { items: [{ contentID: '35239276' }] } });
        expect(await bridge.request('search', { query: '周杰伦', limit: 1, offset: 0, kind: 'playlist' }))
            .toMatchObject({ ok: true, data: { items: [{ contentID: '112927' }] } });
    });

    it('reads an album detail without an account', async () => {
        const fetch = vi.fn(async () => envelope({
            result: { resultCode: '000000', resultMessage: 'Success!' },
            albumInfoEx: {
                albumInfo: {
                    contentID: '101447',
                    contentName: '叶惠美',
                    totalCount: '11',
                    picture: { bigImgURL: 'https://contentcenter-drcn.dbankcdn.cn/cover.webp' },
                },
                songSimpleInfos: [{ contentID: '1092931', contentName: '以父之名' }],
            },
        }));
        const bridge = bridgeOf(fetch);
        const result = await bridge.request('album', { id: '101447', limit: 1, offset: 0 });
        expect(result).toMatchObject({
            ok: true,
            data: { id: '101447', name: '叶惠美', totalCount: 11, hasMore: true, nextOffset: 1 },
        });
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('refuses playback without a session, and never asks the network', async () => {
        const fetch = vi.fn();
        const bridge = bridgeOf(fetch);
        expect(await bridge.request('audio', { id: '1092974', quality: 'standard' })).toMatchObject({
            ok: false,
            error: { code: 'auth-required' },
        });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('maps a VIP refusal to subscription-required', async () => {
        const fetch = vi.fn(async () => envelope({ result: { resultCode: '142400', resultMessage: 'Only vip user can play or download the content!' } }));
        const bridge = bridgeOf(fetch);
        // The same result envelope is read on a public path, where no session is needed.
        const result = await bridge.request('search', { query: 'x', limit: 1, offset: 0 });
        expect(result).toMatchObject({ ok: false, error: { code: 'subscription-required', upstreamCode: '142400' } });
    });

    it('reads lyrics only from the allowed lyric hosts', async () => {
        const fetch = vi.fn();
        const bridge = bridgeOf(fetch);
        const result = await bridge.request('lyrics', { id: '1092974', lyricUrl: 'https://evil.example/song.lrc' });
        expect(result).toMatchObject({ ok: true, data: { lrc: '', hmrc: '' } });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('reads the account favorite albums', async () => {
        const saved = store();
        createSessionRepository({ store: saved, safeStorage: cipher(), warn: vi.fn() }).set({
            token: 'fixture-token', userId: 'fixture-user', expireTime: 'later', nickname: 'Listener',
        });
        const fetch = vi.fn(async () => envelope({
            result: { resultCode: '000000', resultMessage: 'Success!' },
            favoriteInfos: [
                { contentID: '101447', contentName: '叶惠美', artistName: '周杰伦', totalCount: '11', picture: { bigImgURL: 'https://cdn/album.webp' } },
            ],
        }));
        const bridge = bridgeOf(fetch, vi.fn(), saved);
        expect(await bridge.request('library_albums', { limit: 2, offset: 0 })).toMatchObject({
            ok: true,
            data: { items: [{ id: '101447', name: '叶惠美', kind: 'album', artistName: '周杰伦', trackCount: 11, coverUrl: 'https://cdn/album.webp' }], hasMore: false, nextOffset: 1 },
        });
        const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(String(options.body))).toMatchObject({ contentTypes: [2], start: 0, limit: 2 });
    });

    it("lists the account's playlists and reads an owned playlist without the full list", async () => {
        const saved = store();
        createSessionRepository({ store: saved, safeStorage: cipher(), warn: vi.fn() }).set({
            token: 'fixture-token', userId: 'fixture-user', expireTime: 'later', nickname: 'Listener',
        });
        const fetch = vi.fn(async (url: string) => {
            if (String(url).includes('/favorite/simple/all')) {
                return envelope({
                    result: { resultCode: '000000', resultMessage: 'Success!' },
                    favoriteInfos: [
                        { contentID: 'u.liked', contentName: '我喜欢的音乐', contentType: '5', totalCount: '174', picture: { bigImgURL: 'https://cdn/a.webp' } },
                        { contentID: 'LV.collected', contentName: '古风', contentType: '4', totalCount: '20' },
                        { contentID: 'chart', contentName: '榜单', contentType: '7' },
                    ],
                });
            }
            return envelope({
                result: { resultCode: '000000', resultMessage: 'Success!' },
                playListInfoEx: { playListSongInfoList: [
                    { contentID: '1092974', contentName: '晴天' },
                    { contentID: '1092975', contentName: '雨天' },
                    { contentID: '1092976', contentName: '阴天' },
                ] },
            });
        });
        const bridge = bridgeOf(fetch, vi.fn(), saved);
        const lists = await bridge.request('library_playlists');
        expect(lists).toMatchObject({ ok: true, data: { items: [
            { id: 'u.liked', name: '我喜欢的音乐', kind: 'owned', trackCount: 174, coverUrl: 'https://cdn/a.webp' },
            { id: 'LV.collected', name: '古风', kind: 'collected', trackCount: 20 },
        ] } });
        expect(await bridge.request('playlist_tracks', { id: 'u.liked', kind: 'owned', limit: 2, offset: 1 })).toMatchObject({
            ok: true,
            data: { total: 3, hasMore: false, nextOffset: 3, items: [{ contentName: '雨天' }, { contentName: '阴天' }] },
        });
    });

    it('refuses an unsupported playlist kind or a playlist without a session', async () => {
        const fetch = vi.fn();
        expect(await bridgeOf(fetch).request('playlist_tracks', { id: 'x', kind: 'owned', limit: 1, offset: 0 }))
            .toMatchObject({ ok: false, error: { code: 'auth-required' } });
        const saved = store();
        createSessionRepository({ store: saved, safeStorage: cipher(), warn: vi.fn() }).set({
            token: 'fixture-token', userId: 'fixture-user', expireTime: 'later', nickname: 'Listener',
        });
        expect(await bridgeOf(fetch, vi.fn(), saved).request('playlist_tracks', { id: 'x', kind: 'chart', limit: 1, offset: 0 }))
            .toMatchObject({ ok: false, error: { code: 'unsupported' } });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('seals the session with the OS store and refuses an unreadable one', () => {
        const saved = store();
        const sessions = createSessionRepository({ store: saved, safeStorage: cipher(), warn: vi.fn() });
        sessions.set({ token: 'fixture-token', userId: 'fixture-user', expireTime: 'later', nickname: 'Listener' });
        expect(sessions.get()).toMatchObject({ token: 'fixture-token', userId: 'fixture-user' });
        expect(saved.get(SESSION_KEY)).toMatch(/^[A-Za-z0-9+/=]+$/);
        expect(String(saved.get(SESSION_KEY))).not.toContain('fixture-token');
        const unavailable = createSessionRepository({
            store: saved,
            safeStorage: { ...cipher(), isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text' },
            warn: vi.fn(),
        });
        expect(unavailable.get()).toBeNull();
        expect(unavailable.unreadable()).toBe(true);
    });
});
