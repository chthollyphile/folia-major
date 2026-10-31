import { afterEach, describe, it, expect, vi } from 'vitest';
import { normalizeQishuiSong, normalizeQishuiCollection } from '@/services/onlineMusic/qishui/qishuiNormalize';
import { parseQishuiLyrics } from '@/services/onlineMusic/qishui/qishuiLyrics';
import { requestQishui } from '@/services/onlineMusic/qishui/qishuiTransport';
import { qishuiProvider } from '@/services/onlineMusic/qishui/qishuiProvider';
import { track } from './fixtures';

// Source identity, timing and bridge error propagation exercised independently of the network.
afterEach(() => vi.unstubAllGlobals());
describe('Qishui Omni adapter', () => {
    it('preserves large string IDs and milliseconds, without inventing album navigation or a takedown', () => {
        const song = normalizeQishuiSong({ ...track(), commerce_info: { payment_type: 3 } });
        expect(song).toMatchObject({ id: '7676337516358617115', durationMs: 200000, sourceRef: { providerId: 'qishui', mediaId: '7676337516358617115' } });
        expect(song.album.catalogRef).toBeUndefined();
        expect(qishuiProvider.playback?.getAvailability?.(song)).toEqual({ state: 'unknown' });
        expect(normalizeQishuiSong(song)).toBe(song);
    });
    it('keeps playlist ownership and opaque owner ID in collection metadata', () => {
        expect(normalizeQishuiCollection({ base_info: { id: '11', title: 'Playlist', owner_id: '22' }, isOwned: false }))
            .toMatchObject({ id: '11', name: 'Playlist', isOwned: false, providerData: { ownerId: '22' } });
    });
    // The searched playlist is the same playlist entity user_playlists hands over; one without an id is skipped, not the page.
    it('searches playlists through search_playlists and skips an entry without an id', async () => {
        const request = vi.fn(async () => ({ ok: true, data: {
            items: [
                { base_info: { id: '11', title: 'Jay 精选', owner_id: '22' }, display_info: {}, resource_cnt: { track_cnt: 40 } },
                { title: 'no id' },
            ],
            hasMore: true,
            nextOffset: 2,
        } }));
        vi.stubGlobal('window', { electron: { qishuiRequest: request } });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const page = await qishuiProvider.search!.searchPlaylists!('周杰伦', 30, 0);

        expect(request).toHaveBeenCalledWith('search_playlists', { query: '周杰伦', limit: 30, offset: 0 });
        expect(page).toMatchObject({ hasMore: true, nextOffset: 2, items: [{ providerId: 'qishui', id: '11', type: 'playlist', name: 'Jay 精选', trackCount: 40 }] });
        expect(page.items).toHaveLength(1);
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();

        await expect(qishuiProvider.search!.searchPlaylists!('   ', 30, 0)).resolves.toEqual({ items: [], hasMore: false, nextOffset: 0 });
        expect(request).toHaveBeenCalledTimes(1);
    });
    it('parses relative KRC word timings and translation lines by time', () => {
        const result = parseQishuiLyrics({ lyric_entity: { type: 'krc', content: '[1000,1000]<0,400,0>你<400,600,0>好\u0000' },
            lang_translations: { 'zh-CN': { type: 'krc', content: '[1000,1000]<0,1000,0>Hello' } } });
        expect(result.lyrics?.isWordByWord).toBe(true);
        expect(result.lyrics?.lines[0]).toMatchObject({ startTime: 1, endTime: 2, fullText: '你好', translation: 'Hello' });
        expect(result.lyrics?.lines[0].words[1]).toMatchObject({ startTime: 1.4, endTime: 2 });
    });
    it('treats absent lyrics as absent instead of asserting that the song is instrumental', () => {
        expect(parseQishuiLyrics({})).toMatchObject({ lyrics: null, isPureMusic: false });
    });
    it('identifies an account-read failure and includes its safe stage in diagnostics', async () => {
        vi.stubGlobal('window', { electron: { qishuiRequest: async () => ({ ok: false,
            error: { code: 'invalid-response', message: 'Qishui did not identify the account', stage: 'account' } }) } });
        let failure: unknown;
        try { await requestQishui('login_qr_check', { key: 'test-session' }); } catch (error) { failure = error; }
        expect(qishuiProvider.auth?.describeLoginFailure?.('check', failure)).toMatchObject({ case: 'account-not-read', mainCode: 'account' });
        const lines = await qishuiProvider.auth?.getLoginDiagnostics?.();
        expect(lines?.[0].text).toContain('stage=account code=invalid-response');
    });
    it('declares the desktop runtime requirement and preserves bridge error codes', async () => {
        vi.stubGlobal('window', {});
        expect(qishuiProvider.getAvailability?.()).toMatchObject({ configured: false });
        await expect(requestQishui('search', { query: 'test' })).rejects.toMatchObject({ code: 'unavailable' });
        vi.stubGlobal('window', { electron: { qishuiRequest: async () => ({ ok: false, error: { code: 'auth-required', message: 'Sign in' } }) } });
        await expect(requestQishui('user_playlists')).rejects.toMatchObject({ code: 'auth-required', providerId: 'qishui' });
    });
});
