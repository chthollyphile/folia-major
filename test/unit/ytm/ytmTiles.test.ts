import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// test/unit/ytm/ytmTiles.test.ts — two readers of YouTube Music pages: the catalog nodes
// youtubei.js parses (fixtures trimmed from public pages: an artist's top songs, a public
// album), and what the save buttons of a list's page say.

const require = createRequire(import.meta.url);
const tiles = require('../../../electron/ytm/tiles.cjs');
const catalog = require('../../../electron/ytm/catalog.cjs');

describe('YouTube Music catalog nodes', () => {
    const artist = { name: 'YOASOBI', channel_id: 'UCI6B8NkZKqlFWoiC_xE-hzA' };
    const searchRow = {
        type: 'MusicResponsiveListItem', item_type: 'song', id: 'm9SMT5ipbxk', title: 'アイドル',
        duration: { text: '3:34', seconds: 214 }, album: { id: 'MPREb_6h43ySO9duW', name: 'アイドル' }, artists: [artist],
        thumbnail: { contents: [
            { url: 'https://yt3.googleusercontent.com/art=w120-h120-l90-rj', width: 120, height: 120 },
            { url: 'https://yt3.googleusercontent.com/art=w60-h60-l90-rj', width: 60, height: 60 },
        ] },
    };

    it('maps a search row and asks for the art at a usable size', () => {
        expect(catalog.songFromListItem(searchRow)).toEqual({
            id: 'm9SMT5ipbxk', name: 'アイドル', artists: [{ id: 'UCI6B8NkZKqlFWoiC_xE-hzA', name: 'YOASOBI' }],
            album: { id: 'MPREb_6h43ySO9duW', name: 'アイドル', coverUrl: 'https://yt3.googleusercontent.com/art=w544-h544-l90-rj' },
            durationMs: 214000,
        });
        expect(catalog.songFromListItem({ ...searchRow, id: 'not-a-video-id!' })).toBeNull();
    });

    // Album and playlist rows of a search (shapes measured 2026-10-31): one author, list thumbnails,
    // and a playlist row leading to the page `VL` and the list's id.
    it('maps album and playlist rows of a search', () => {
        const thumbnail = { contents: [{ url: 'https://yt3.googleusercontent.com/art=w120-h120-l90-rj', width: 120, height: 120 }] };
        expect(catalog.albumFromSearchItem({
            type: 'MusicResponsiveListItem', item_type: 'album', id: 'MPREb_p6BGcsuOpGt', title: 'The Life of a Showgirl', year: '2025',
            author: { name: 'Taylor Swift', channel_id: 'UCPC0L1d253x-KuMNwa05TpA' }, thumbnail,
        })).toEqual({
            id: 'MPREb_p6BGcsuOpGt', type: 'album', name: 'The Life of a Showgirl',
            coverUrl: 'https://yt3.googleusercontent.com/art=w544-h544-l90-rj',
            artists: [{ id: 'UCPC0L1d253x-KuMNwa05TpA', name: 'Taylor Swift' }], publishedAt: Date.UTC(2025, 0, 1),
        });
        expect(catalog.albumFromSearchItem({ item_type: 'album', id: 'VLPLnot-an-album', title: 'x' })).toBeNull();

        expect(catalog.playlistFromSearchItem({
            type: 'MusicResponsiveListItem', item_type: 'playlist', id: 'VLPLU_O2trV7TDCISxt7rHHlTKcAHyZ-DESd', title: 'Top 50',
            author: { name: 'Batson', channel_id: 'UCXvepJ4vIFE2cVyILJMHSsg' }, thumbnail,
        })).toEqual({
            id: 'PLU_O2trV7TDCISxt7rHHlTKcAHyZ-DESd', type: 'playlist', name: 'Top 50',
            coverUrl: 'https://yt3.googleusercontent.com/art=w544-h544-l90-rj',
            artists: [{ id: 'UCXvepJ4vIFE2cVyILJMHSsg', name: 'Batson' }],
        });
        expect(catalog.playlistFromSearchItem({ item_type: 'playlist', id: 'MPREb_album', title: 'x' })).toBeNull();
    });

    it('caps a wide banner and leaves non-square or already large art alone', () => {
        const banner = [2880, 1920, 1440, 816, 540].map(width => ({ url: `https://yt3.googleusercontent.com/banner=w${width}-h${width / 2.4}-p-l90-rj`, width, height: width / 2.4 }));
        expect(catalog.thumbnailUrl(banner, 1000)).toBe('https://yt3.googleusercontent.com/banner=w816-h340-p-l90-rj');
        expect(catalog.thumbnailUrl([{ url: 'https://i.ytimg.com/vi/x/hq720.jpg', width: 800, height: 450 }])).toBe('https://i.ytimg.com/vi/x/hq720.jpg');
        expect(catalog.thumbnailUrl([{ url: 'https://example.test/huge.jpg', width: 4000, height: 4000 }])).toBe('https://example.test/huge.jpg');
        expect(catalog.thumbnailUrl(undefined)).toBe('');
    });

    it('maps the watch-queue entry that names a video\'s artist and album', () => {
        expect(catalog.songFromQueueItem({
            video_id: 'm9SMT5ipbxk', title: { toString: () => 'アイドル' }, artists: [artist], album: { id: 'MPREb_6h43ySO9duW', name: 'アイドル' },
            duration: { seconds: 214 }, thumbnail: [{ url: 'https://yt3.googleusercontent.com/art=w544-h544-l90-rj', width: 544, height: 544 }],
        })).toMatchObject({ id: 'm9SMT5ipbxk', name: 'アイドル', album: { id: 'MPREb_6h43ySO9duW' }, artists: [{ id: 'UCI6B8NkZKqlFWoiC_xE-hzA' }] });
        // A music video has no album; the entry still names the artist.
        expect(catalog.songFromQueueItem({ video_id: 'ZRtdQ81jPUQ', title: 'アイドル - Idol', artists: [artist] }))
            .toMatchObject({ album: { id: '', name: '' }, durationMs: 0 });
        expect(catalog.songFromQueueItem(undefined)).toBeNull();
    });

    it('builds an album page whose tracks inherit the album artist, name and cover', () => {
        const album = catalog.albumFromPage({
            url: 'https://music.youtube.com/playlist?list=OLAK5uy_fixture',
            header: {
                title: { toString: () => 'THE BOOK' }, subtitle: { toString: () => 'Album • 2021' },
                strapline_text_one: { toString: () => 'YOASOBI', runs: [{ text: 'YOASOBI', endpoint: { payload: { browseId: 'UCI6B8NkZKqlFWoiC_xE-hzA' } } }] },
                thumbnail: { contents: [{ url: 'https://yt3.googleusercontent.com/album=w544-h544-l90-rj', width: 544, height: 544 }] },
            },
            contents: [
                { type: 'MusicResponsiveListItem', id: 'EjaQdBcF6K4', title: 'オリオン - Orion', duration: { seconds: 207 } },
                { type: 'ContinuationItem' },
            ],
        }, 'MPREb_a5PIYyducZQ');
        expect(album.collection).toEqual({
            id: 'MPREb_a5PIYyducZQ', type: 'album', name: 'THE BOOK', coverUrl: 'https://yt3.googleusercontent.com/album=w544-h544-l90-rj',
            artists: [{ id: 'UCI6B8NkZKqlFWoiC_xE-hzA', name: 'YOASOBI' }], trackCount: 1, description: '', publishedAt: Date.UTC(2021, 0, 1),
            playlistId: 'OLAK5uy_fixture',
        });
        // An address that names no list, or is none, leaves the album without one.
        for (const url of ['https://music.youtube.com/browse/MPREb_a5PIYyducZQ', 'not an address', undefined]) {
            expect(catalog.albumFromPage({ url, header: {}, contents: [] }, 'MPREb_a5PIYyducZQ').collection).not.toHaveProperty('playlistId');
        }
        expect(album.items).toEqual([{
            id: 'EjaQdBcF6K4', name: 'オリオン - Orion', artists: [{ id: 'UCI6B8NkZKqlFWoiC_xE-hzA', name: 'YOASOBI' }],
            album: { id: 'MPREb_a5PIYyducZQ', name: 'THE BOOK', coverUrl: 'https://yt3.googleusercontent.com/album=w544-h544-l90-rj' },
            durationMs: 207000,
        }]);
    });

    it('builds an artist page: top songs, album shelves found by content, and the full-list endpoint', () => {
        const albumCard = (id: string, year: string) => ({ type: 'MusicTwoRowItem', item_type: 'album', id, title: { toString: () => `Album ${id}` }, year, artists: [], thumbnail: [] });
        const more = { payload: { browseId: 'MPADUCI6B8NkZKqlFWoiC_xE-hzA' } };
        const page = catalog.artistFromPage({
            header: { title: { toString: () => 'YOASOBI' }, description: { toString: () => 'A duo.' }, thumbnail: { contents: [{ url: 'https://yt3.googleusercontent.com/b=w816-h340-p', width: 816, height: 340 }] } },
            sections: [
                { type: 'MusicShelf', contents: [searchRow, { type: 'MusicResponsiveListItem', id: 'bad' }] },
                { type: 'MusicCarouselShelf', header: {}, contents: [albumCard('MPREb_one', '2026')] },
                { type: 'MusicCarouselShelf', header: { more_content: { endpoint: more } }, contents: [albumCard('MPREb_two', '2025'), { type: 'MusicTwoRowItem', item_type: 'album', id: 'OLAK-not-an-album-id' }] },
                { type: 'MusicCarouselShelf', header: { more_content: { endpoint: { payload: { browseId: 'VLOLAK5uy_videos' } } } }, contents: [{ type: 'MusicTwoRowItem', item_type: 'video', id: 'x' }] },
            ],
        }, 'UCI6B8NkZKqlFWoiC_xE-hzA');
        expect(page.collection).toEqual({ id: 'UCI6B8NkZKqlFWoiC_xE-hzA', type: 'artist', name: 'YOASOBI', coverUrl: 'https://yt3.googleusercontent.com/b=w816-h340-p', description: 'A duo.' });
        expect(page.songs.map((song: { id: string }) => song.id)).toEqual(['m9SMT5ipbxk']);
        expect(page.albumShelves).toHaveLength(2);
        expect(page.albumShelves[0]).toMatchObject({ more: null, items: [{ id: 'MPREb_one', publishedAt: Date.UTC(2026, 0, 1), artists: [{ id: 'UCI6B8NkZKqlFWoiC_xE-hzA', name: 'YOASOBI' }] }] });
        expect(page.albumShelves[1].more).toBe(more);
        expect(page.albumShelves[1].items.map((item: { id: string }) => item.id)).toEqual(['MPREb_two']);
    });
});

describe('the save buttons of a YouTube Music list page', () => {
    it('say whether the list is saved where they agree, and nothing where they do not or there is none', () => {
        const [saved, not] = [{ isToggled: true }, { isToggled: false }];
        expect(tiles.savedStateOn([saved])).toBe(true);
        expect(tiles.savedStateOn([not])).toBe(false);
        expect(tiles.savedStateOn([saved, saved])).toBe(true);
        expect(tiles.savedStateOn([saved, not])).toBeUndefined();
        expect(tiles.savedStateOn([])).toBeUndefined();
    });

    it('name the like that saves the list or takes it out: its list, and its parameters where it has some', () => {
        const like = (status: string, playlistId: unknown, params?: object) => ({ likeEndpoint: { status, target: { playlistId }, ...params } });
        const plain = { defaultServiceEndpoint: like('LIKE', 'OLAK5uy_save'), toggledServiceEndpoint: like('INDIFFERENT', 'OLAK5uy_remove') };
        // Saving is the button's first command, taking out its second, whichever state it shows.
        expect(tiles.saveCommandOn([plain], true)).toEqual({ playlistId: 'OLAK5uy_save' });
        expect(tiles.saveCommandOn([plain], false)).toEqual({ playlistId: 'OLAK5uy_remove' });
        // Wrapped in a list of commands; what a viewer who is not signed in would send is passed over.
        const wrapped = { defaultServiceEndpoint: { authDeterminedCommand: {
            unauthenticatedCommand: { commands: [like('LIKE', 'PLguest', { likeParams: 'guest' })] },
            authenticatedCommand: { commandExecutorCommand: { commands: [{ openPopupAction: {} }, like('LIKE', 'PLmember', { likeParams: 'member', removeLikeParams: 'other' })] } },
        } }, toggledServiceEndpoint: { commands: [like('INDIFFERENT', 'PLmember', { removeLikeParams: 'leave', likeParams: 'other' })] } };
        expect(tiles.saveCommandOn([wrapped], true)).toEqual({ playlistId: 'PLmember', params: 'member' });
        expect(tiles.saveCommandOn([wrapped], false)).toEqual({ playlistId: 'PLmember', params: 'leave' });
        // Parameters that are no text are left out.
        expect(tiles.saveCommandOn([{ defaultServiceEndpoint: like('LIKE', 'PLx', { likeParams: '' }) }], true)).toEqual({ playlistId: 'PLx' });
        expect(tiles.saveCommandOn([{ defaultServiceEndpoint: like('LIKE', 'PLx', { likeParams: 7 }) }], true)).toEqual({ playlistId: 'PLx' });
        // A command of the other state, a like of no list, a button with no command and no button name nothing.
        const crossed = { defaultServiceEndpoint: like('INDIFFERENT', 'PLx'), toggledServiceEndpoint: like('LIKE', 'PLx') };
        expect(tiles.saveCommandOn([crossed], true)).toBeUndefined();
        expect(tiles.saveCommandOn([crossed], false)).toBeUndefined();
        for (const playlistId of ['', 7, undefined]) expect(tiles.saveCommandOn([{ defaultServiceEndpoint: like('LIKE', playlistId) }], true)).toBeUndefined();
        expect(tiles.saveCommandOn([{}], true)).toBeUndefined();
        expect(tiles.saveCommandOn([], true)).toBeUndefined();
        // Several save buttons: taken where they name one list, left where they name different ones.
        const other = { defaultServiceEndpoint: like('LIKE', 'OLAK5uy_other'), toggledServiceEndpoint: like('INDIFFERENT', 'OLAK5uy_remove') };
        expect(tiles.saveCommandOn([plain, plain], true)).toEqual({ playlistId: 'OLAK5uy_save' });
        expect(tiles.saveCommandOn([plain, other], true)).toBeUndefined();
        expect(tiles.saveCommandOn([plain, other], false)).toEqual({ playlistId: 'OLAK5uy_remove' });
    });
});
