import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { qishuiCatalog } from '@/services/onlineMusic/qishui/qishuiCatalog';
import { qishuiLibrary } from '@/services/onlineMusic/qishui/qishuiCatalog';
import { qishuiMutations } from '@/services/onlineMusic/qishui/qishuiMutations';
import { normalizeQishuiSong } from '@/services/onlineMusic/qishui/qishuiNormalize';
import { qishuiRecommendations } from '@/services/onlineMusic/qishui/qishuiRecommendations';
import type { QishuiApiOptions } from 'qishui-music-api';
import { track } from './fixtures';

// Run the actual npm package through the host bridge and renderer adapter; replace only HTTP responses.
const { createQishuiApiBridge } = createRequire(import.meta.url)('../../../electron/qishui/qishuiApiBridge.cjs');
const { createQishuiApi } = createRequire(import.meta.url)('qishui-music-api');

// Only generated fixture credentials enter the real package; every HTTP request is intercepted.
function accountBridge(fetch: typeof globalThis.fetch) {
    const values = new Map<string, unknown>();
    const store = { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value), delete: (key: string) => values.delete(key) };
    return createQishuiApiBridge({ store, fetch, warn: vi.fn(), apiFactory(options: QishuiApiOptions) {
        const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        options.sessions.set({ deviceId: options.deviceId, userId: 'fixture-account', user: { id: 'fixture-account', nickname: 'Listener', isVip: false },
            ticket: 'fixture-ticket', guardKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), guardCert: 'fixture-cert',
            guardTsSign: 'fixture-signature', accessCode: 'fixture-access', openId: 'fixture-open', expiresAt: Date.now() + 3600000 });
        return createQishuiApi(options);
    } });
}
afterEach(() => vi.unstubAllGlobals());
describe('Qishui package-to-adapter paging', () => {
    it('keeps unread recent tracks on the final package page and reads complete hearts', async () => {
        const bridge = accountBridge(vi.fn(async (raw: RequestInfo | URL) => {
            const path = new URL(String(raw)).pathname;
            if (path.endsWith('/client/token/get/')) return Response.json({ client_token: 'fixture-client-token' });
            if (path.endsWith('/me/playlist/')) return Response.json({ data: { playlists: [{ base_info: { id: '99', type: 1 } }], has_more: false } });
            if (path.endsWith('/playlist/detail/')) return Response.json({ data: { media_entities: [{ track_entity: track('7') }], has_more: false } });
            expect(path.endsWith('/me/recent-played/')).toBe(true);
            return Response.json({ data: { media: ['1', '2', '3'].map(id => ({ media: { track_entity: track(id) } })), has_more: false } });
        }));
        vi.stubGlobal('window', { electron: { qishuiRequest: bridge.request } });
        const first = await qishuiCatalog.getPlaylistTracks!('recent-played', 1, 0);
        expect(first).toMatchObject({ items: [{ id: '1' }], hasMore: true, nextOffset: 1 });
        const last = await qishuiCatalog.getPlaylistTracks!('recent-played', 2, first.nextOffset);
        expect(last.items.map(song => song.id)).toEqual(['2', '3']);
        expect(last.hasMore).toBe(false);
        await expect(qishuiLibrary.getLikedSongIds!('fixture-account')).resolves.toEqual({ ids: ['7'], whole: true });
    });
    it('passes all new account write operations through the package allowlist', async () => {
        const paths: string[] = [];
        const bridge = accountBridge(vi.fn(async (raw: RequestInfo | URL) => {
            const path = new URL(String(raw)).pathname;
            paths.push(path.slice(path.indexOf('/platform/') + 9));
            return Response.json({ err_no: 0 });
        }));
        vi.stubGlobal('window', { electron: { qishuiRequest: bridge.request } });
        const song = normalizeQishuiSong(track('1'));
        const playlist = { providerId: 'qishui', id: '99', name: 'List', type: 'playlist', isOwned: true };
        await qishuiMutations.likeSong!(song, true);
        await qishuiMutations.likeSong!(song, false);
        await qishuiMutations.updatePlaylistTracks!('add', playlist, [song]);
        await qishuiMutations.updatePlaylistTracks!('del', playlist, [song]);
        await qishuiRecommendations.dislikeSong!('1');
        expect(paths).toEqual(['/media/collect/', '/media/cancel/collect/', '/playlist/append/', '/playlist/delete/', '/dislike/']);
    });
    it('uses opaque upstream cursors while exposing exact row offsets to the library', async () => {
        const values = new Map<string, unknown>();
        const store = { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value), delete: (key: string) => values.delete(key) };
        const cursors: string[] = [];
        const fetch = vi.fn(async (raw: string, options: { body?: string }) => {
            const url = new URL(raw);
            if (url.pathname.endsWith('/client/token/get/')) return Response.json({ client_token: 'fixture-client-token' });
            expect(url.pathname.endsWith('/playlist/detail/')).toBe(true);
            const body = JSON.parse(options.body!);
            cursors.push(body.cursor);
            return Response.json({ data: body.cursor === '0'
                ? { media_entities: [1, 2, 3].map(id => ({ track_entity: track(String(id)) })), has_more: true, next_cursor: 'opaque:next' }
                : { media_entities: [4, 5].map(id => ({ track_entity: track(String(id)) })), has_more: false } });
        });
        const bridge = createQishuiApiBridge({ store, fetch });
        vi.stubGlobal('window', { electron: { qishuiRequest: bridge.request } });
        const page = await qishuiCatalog.getPlaylistTracks!('99', 3, 2);
        expect(page.items.map(song => String(song.id))).toEqual(['3', '4', '5']);
        expect(page).toMatchObject({ hasMore: false, nextOffset: 5 });
        expect(cursors).toEqual(['0', 'opaque:next']);
    });
});
