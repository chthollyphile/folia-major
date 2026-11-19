// @builtin-sources
import { afterEach, describe, it, expect, vi } from 'vitest';

// The host parses a source's tracks in the lyrics worker; run the same parser inline.
vi.mock('@/utils/lyrics/workerClient', async () => {
    const { parseLyricsByFormat } = await import('@/utils/lyrics/parserCore');
    return {
        parseLyricsAsync: vi.fn(async (
            format: Parameters<typeof parseLyricsByFormat>[0],
            content: string,
            translation: string,
            options: Parameters<typeof parseLyricsByFormat>[3],
            romanization: string,
        ) => parseLyricsByFormat(format, content, translation, options, romanization)),
    };
});

import { parseLyricsByFormat } from '@/utils/lyrics/parserCore';
import { answerQishuiRequests, hostQishuiCollection, hostQishuiSong, qishuiProvider, qishuiRefusal } from '../helpers/qishuiSource';
import { track } from './fixtures';

// Source identity, timing and bridge error propagation exercised independently of the network, through the
// registered source mod (sources/qishui/).
let off = () => {};
afterEach(() => { off(); vi.restoreAllMocks(); });
const answer = () => {
    const answered = answerQishuiRequests();
    off = answered.off;
    return answered.request;
};
const lyricsOf = async (raw: unknown) => {
    answer().mockResolvedValueOnce(raw);
    return qishuiProvider().lyrics!.getLyrics(hostQishuiSong(track()));
};
describe('Qishui Omni adapter', () => {
    it('preserves large string IDs and milliseconds, without inventing album navigation or a takedown', () => {
        const song = hostQishuiSong({ ...track(), commerce_info: { payment_type: 3 } });
        expect(song).toMatchObject({ id: '7676337516358617115', durationMs: 200000, sourceRef: { providerId: 'qishui', mediaId: '7676337516358617115' } });
        expect(song.album.catalogRef).toBeUndefined();
        expect(qishuiProvider().playback?.getAvailability?.(song)).toEqual({ state: 'unknown' });
    });
    it('keeps playlist ownership and opaque owner ID in collection metadata', () => {
        expect(hostQishuiCollection({ base_info: { id: '11', title: 'Playlist', owner_id: '22' }, isOwned: false }))
            .toMatchObject({ id: '11', name: 'Playlist', isOwned: false, providerData: { ownerId: '22' } });
    });
    // The searched playlist is the same playlist entity user_playlists hands over; one without an id is skipped, not the page.
    it('searches playlists through search_playlists and skips an entry without an id', async () => {
        const request = answer();
        request.mockResolvedValue({
            items: [
                { base_info: { id: '11', title: 'Jay 精选', owner_id: '22' }, display_info: {}, resource_cnt: { track_cnt: 40 } },
                { title: 'no id' },
            ],
            hasMore: true,
            nextOffset: 2,
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const page = await qishuiProvider().search!.searchPlaylists!('周杰伦', 30, 0);

        expect(request).toHaveBeenCalledWith('search_playlists', { query: '周杰伦', limit: 30, offset: 0 });
        expect(page).toMatchObject({ hasMore: true, nextOffset: 2, items: [{ providerId: 'qishui', id: '11', type: 'playlist', name: 'Jay 精选', trackCount: 40 }] });
        expect(page.items).toHaveLength(1);
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();

        await expect(qishuiProvider().search!.searchPlaylists!('   ', 30, 0)).resolves.toMatchObject({ items: [], hasMore: false, nextOffset: 0 });
        expect(request).toHaveBeenCalledTimes(1);
    });
    it('parses relative KRC word timings and translation lines by time', async () => {
        const result = await lyricsOf({ lyric_entity: { type: 'krc', content: '[1000,1000]<0,400,0>你<400,600,0>好\u0000' },
            lang_translations: { 'zh-CN': { type: 'krc', content: '[1000,1000]<0,1000,0>Hello' } } });
        expect(result.lyrics?.isWordByWord).toBe(true);
        expect(result.lyrics?.lines[0]).toMatchObject({ startTime: 1, endTime: 2, fullText: '你好', translation: 'Hello' });
        expect(result.lyrics?.lines[0].words[1]).toMatchObject({ startTime: 1.4, endTime: 2 });
    });
    // The built-in provider matched an LRC translation to the LRC lines by start time itself; the host does it now from
    // the raw tracks (translationFormat), and must come to the same lines (worked out here the way it used to be).
    it('reads LRC lyrics with an LRC translation as the built-in provider did', async () => {
        const content = '[00:01.00]第一行\n[00:03.50]第二行\n';
        const translation = '[00:01.00]First line\n[00:03.50]Second line\n';
        const result = await lyricsOf({ lyric_entity: { type: 'lrc', content }, lang_translations: { 'zh-CN': { type: 'lrc', content: translation } } });
        const before = parseLyricsByFormat('lrc', content);
        const byTime = new Map(parseLyricsByFormat('lrc', translation).lines.map(line => [line.startTime, line.fullText]));
        for (const line of before.lines) line.translation = byTime.get(line.startTime) || line.translation;
        expect(result.lyrics?.lines.map(line => [line.startTime, line.fullText, line.translation]))
            .toEqual(before.lines.map(line => [line.startTime, line.fullText, line.translation]));
        expect(result).toMatchObject({ mainText: content, translationText: translation, isPureMusic: false });
        expect(result.wordByWordText ?? null).toBeNull();
    });
    it('treats absent lyrics as absent instead of asserting that the song is instrumental', async () => {
        expect(await lyricsOf({})).toMatchObject({ lyrics: null, isPureMusic: false });
    });
    it('identifies an account-read failure and includes its safe stage in diagnostics', async () => {
        answer().mockImplementation(async (operation) => {
            if (operation === 'login_qr_key') return { key: 'test-session' };
            throw qishuiRefusal('invalid-response', 'Qishui did not identify the account', { stage: 'account' });
        });
        const auth = qishuiProvider().auth!;
        await auth.startLogin!();
        let failure: unknown;
        try { await auth.checkLogin!('test-session'); } catch (error) { failure = error; }
        expect(auth.describeLoginFailure?.('check', failure)).toMatchObject({ case: 'account-not-read', mainCode: 'account' });
        const lines = await auth.getLoginDiagnostics?.();
        expect(lines?.[0].text).toContain('stage=account code=invalid-response');
    });
    it('preserves bridge error codes, naming the source', async () => {
        answer().mockRejectedValue(qishuiRefusal('auth-required', 'Sign in'));
        await expect(qishuiProvider().library!.getUserPlaylists('account', 20, 0)).rejects.toMatchObject({ code: 'auth-required', providerId: 'qishui' });
    });
});
