import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/sodaProvider.test.ts

const request = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/soda/sodaTransport', () => ({
    requestSoda: request,
    getSodaTransportAvailability: () => ({ configured: true }),
}));

import { sodaProvider } from '@/services/onlineMusic/soda/sodaProvider';
import {
    normalizeSodaCollection,
    normalizeSodaSong,
    sodaLyricsOf,
    sodaPage,
    sodaPreview,
} from '@/services/onlineMusic/soda/sodaNormalize';

const cover = { uri: 'tos-cn-i-x/abc', urls: ['https://p3-luna.douyinpic.com/img/', 'https://p6-luna.douyinpic.com/img/'], template_prefix: 'tplv-b829550vbb' };
const track = {
    id: 7678897838486882344,
    name: '晴天（杰伦）',
    duration: 75840,
    artists: [{ id: 9, name: '哇欣' }],
    album: { id: 5, name: '晴天（杰伦）', url_cover: cover },
};

beforeEach(() => request.mockReset());

describe('Soda normalize', () => {
    it('joins the cover with the template prefix that every bucket answers', () => {
        expect(normalizeSodaSong(track).album.coverUrl)
            .toBe('https://p3-luna.douyinpic.com/img/tos-cn-i-x/abc~tplv-b829550vbb-crop-center:500:500.jpg');
    });

    it('keeps the identity every song carries', () => {
        const song = normalizeSodaSong(track);
        expect(song.id).toBe('7678897838486882344');
        expect(song.sourceRef).toEqual({ kind: 'online', providerId: 'soda', mediaId: '7678897838486882344' });
        expect(song.artists.map((artist) => artist.name)).toEqual(['哇欣']);
        expect(song.durationMs).toBe(75840);
    });

    it('makes a collection of a playlist', () => {
        expect(normalizeSodaCollection({ id: 7200303561195061287, title: '热歌', count_tracks: 249, url_cover: cover }))
            .toMatchObject({ providerId: 'soda', id: '7200303561195061287', type: 'playlist', name: '热歌', trackCount: 249 });
    });

    it('stops at the total the answer names, and hands out the rest by offset', () => {
        expect(sodaPage([{ id: 'a' }, { id: 'b' }] as never, 20, 10)).toMatchObject({ total: 20, hasMore: true, nextOffset: 12 });
        expect(sodaPage([{ id: 'a' }, { id: 'b' }] as never, 12, 10)).toMatchObject({ hasMore: false, nextOffset: 12 });
        expect(sodaPage([], 0, 0)).toMatchObject({ hasMore: false, nextOffset: 0 });
    });

    it('calls a window narrower than the song a preview', () => {
        expect(sodaPreview({ previewStart: 0, previewEnd: 75.84, duration: 75.84 })).toBe(false);
        expect(sodaPreview({ previewStart: 4.992, previewEnd: 34.993, duration: 35.808 })).toBe(true);
    });
});

describe('Soda lyrics', () => {
    const sentences = [
        { startMs: 0, endMs: 5000, text: '作曲：哇欣', words: [{ text: '作曲：哇欣', startMs: 0 }] },
        { startMs: 5000, endMs: 9000, text: '故事的小黄花', words: [{ text: '故事', startMs: 5000 }, { text: '的小黄花', startMs: 6500 }] },
    ];

    it('writes line tags for every sentence', () => {
        expect(sodaLyricsOf({ lyrics: { sentences } }).mainText)
            .toBe('[00:00.00]作曲：哇欣\n[00:05.00]故事的小黄花\n');
    });

    it('writes word tags only where the answer times words', () => {
        expect(sodaLyricsOf({ lyrics: { sentences } }).wordByWordText)
            .toBe('[00:00.00]作曲：哇欣\n[00:05.00]<00:05.000>故事<00:06.500>的小黄花<00:09.000>\n');
    });

    it('offers no word track when no sentence is word-timed', () => {
        const oneWord = [{ startMs: 0, endMs: 5000, text: '只有一行', words: [{ text: '只有一行', startMs: 0 }] }];
        expect(sodaLyricsOf({ lyrics: { sentences: oneWord } }).wordByWordText).toBeUndefined();
    });

    it('answers no lyrics for a track without sentences', () => {
        expect(sodaLyricsOf({ lyrics: { sentences: [] } })).toMatchObject({ lyrics: null, isPureMusic: false });
    });
});

describe('Soda provider', () => {
    it('takes at most 20 rows and reports the rest as a next batch', async () => {
        const rows = Array.from({ length: 20 }, (_, index) => ({ entity: { track: { ...track, id: index } } }));
        request.mockResolvedValueOnce({ group: { data: rows, has_more: true, next_cursor: 20 } });
        const page = await sodaProvider.search!.searchSongs('晴天', 5, 0);
        expect(page.items).toHaveLength(5);
        expect(page.hasMore).toBe(true);
        expect(page.nextOffset).toBe(5);
        expect(request).toHaveBeenCalledWith('search', expect.objectContaining({ query: '晴天', cursor: 0, count: 5 }));
    });

    it('marks a clip as a preview so it is never stored as the song', async () => {
        request.mockResolvedValueOnce({ track: { url: 'https://v.example/x.m4a', previewStart: 4.992, previewEnd: 34.993, duration: 35.808 } });
        const source = await sodaProvider.playback!.getAudioSource({ id: 'clip' } as never, 'standard');
        expect(source).toMatchObject({ url: 'https://v.example/x.m4a', preview: true, quality: 'standard' });
    });

    it('hands the whole song out unmarked', async () => {
        request.mockResolvedValueOnce({ track: { url: 'https://v.example/x.m4a', previewStart: 0, previewEnd: 239.832, duration: 239.832 } });
        const source = await sodaProvider.playback!.getAudioSource({ id: 'whole' } as never, 'standard');
        expect(source).not.toHaveProperty('preview');
    });

    it('answers null where the share page has no address', async () => {
        request.mockResolvedValueOnce({ track: { url: '' } });
        expect(await sodaProvider.playback!.getAudioSource({ id: '2' } as never, 'standard')).toBeNull();
    });
});
