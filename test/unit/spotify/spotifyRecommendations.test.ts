import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/spotifyRecommendations.test.ts — the radio tab for Spotify, where using the
// app does not show the rule: which songs the personal FM hands out (none twice, a trashed song's
// radio dropped, none made up), which of Spotify's lists is the daily one, and the quality level
// a provider is asked for under a preference it does not list.

const request = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/spotify/spotifyTransport', () => ({
    requestSpotify: request,
    querySpotify: (name: string, variables: Record<string, unknown> = {}) => request('query', { name, variables }),
    getSpotifyTransportAvailability: () => ({ configured: true }),
}));
import { omni } from '@/services/onlineMusic/omni';
import { spotifyProvider } from '@/services/onlineMusic/spotify/spotifyProvider';
import { clearSpotifyCatalogCache } from '@/services/onlineMusic/spotify/spotifyCatalog';
import { resetSpotifyRecommendations } from '@/services/onlineMusic/spotify/spotifyRecommendations';
import type { UnifiedSong } from '@/types';

const id = (name: string) => name.replace('-', '').padEnd(22, 'Z');
const track = (name: string) => ({
    __typename: 'Track', uri: `spotify:track:${id(name)}`, name,
    artists: { items: [{ uri: `spotify:artist:${id('artist')}`, profile: { name: 'Artist' } }] },
    albumOfTrack: { uri: `spotify:album:${id('album')}`, name: 'Album', coverArt: { sources: [{ url: 'https://i.scdn.co/image/cover', width: 640 }] } },
    duration: { totalMilliseconds: 200000 },
});
const card = (list: string) => ({ content: { data: { __typename: 'Playlist', uri: `spotify:playlist:${list}`, name: list, ownerV2: { data: { name: 'Spotify' } } } } });
const DAILY_ONE = '37i9dQZF1E3'.padEnd(22, 'a');
const DAILY_TWO = '37i9dQZF1E3'.padEnd(22, 'b');

// Spotify as the account has it: the liked songs, the playlists by id (the radio of the song
// `x` is the playlist `radio-x`), and the lists made for the account.
const serve = ({ liked = [], lists = {}, made = [] }: { liked?: string[]; lists?: Record<string, string[]>; made?: string[] }) => {
    request.mockImplementation(async (operation: string, params: any) => {
        if (operation === 'radio') {
            const seed = Object.keys(lists).find(name => name.startsWith('radio-') && id(name.slice(6)) === params.id);
            return seed ? { uri: `spotify:playlist:${id(seed)}` } : null;
        }
        if (operation === 'audio') return { url: 'folia-spotify://audio/1', format: 'OGG_VORBIS_320' };
        if (operation !== 'query') throw new Error(`unexpected ${operation}`);
        if (params.name === 'fetchLibraryTracks') {
            return { me: { library: { tracks: { totalCount: liked.length, items: liked.map(name => ({ track: { _uri: `spotify:track:${id(name)}`, data: track(name) } })) } } } };
        }
        if (params.name === 'fetchPlaylist') {
            const list = Object.keys(lists).find(name => params.variables.uri === `spotify:playlist:${id(name)}` || params.variables.uri === `spotify:playlist:${name}`);
            const rows = (list ? lists[list] : []).map(name => ({ itemV2: { data: track(name) } }));
            return { playlistV2: { content: { totalCount: rows.length, items: rows } } };
        }
        if (params.name === 'browsePage') {
            return { browse: { sections: { items: [{ uri: 'spotify:section:made', data: { title: { transformedLabel: 'Made' } }, sectionItems: { totalCount: made.length, items: made.map(card) } }] } } };
        }
        if (params.name === 'home') return { home: { sectionContainer: { sections: { items: [] } } } };
        throw new Error(`unexpected query ${params.name}`);
    });
};
const asked = (operation: string) => request.mock.calls.filter(call => call[0] === operation || (call[0] === 'query' && call[1].name === operation));
const fm = async () => (await spotifyProvider.recommendations!.getPersonalFm!()).map(song => song.name);
const trash = (name: string) => spotifyProvider.recommendations!.dislikeSong!(id(name));

beforeEach(() => {
    request.mockReset();
    clearSpotifyCatalogCache();
    resetSpotifyRecommendations();
    // The song asked with is picked at random; here it is always the first of the ones left.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Spotify personal FM', () => {
    it('hands out the next songs of a radio, none of them twice, then the radio of another song', async () => {
        serve({ liked: ['a', 'b'], lists: { 'radio-a': ['a', 'x1', 'x2', 'x3', 'x4'], 'radio-b': ['b', 'x4', 'y1', 'y2', 'y3'] } });
        // Two calls at once take turns. The song asked with is not handed out, nor is a song of an earlier radio.
        expect(await Promise.all([fm(), fm()])).toEqual([['x1', 'x2'], ['x3', 'x4']]);
        expect([await fm(), await fm()]).toEqual([['y1', 'y2'], ['y3']]);
        // Every song was asked with and every radio is used up: the liked songs are read again, and bring nothing new.
        expect(await fm()).toEqual([]);
        expect(asked('radio')).toHaveLength(2);
        expect(asked('fetchLibraryTracks')).toHaveLength(2);
    });

    it('drops what is left of a trashed song\'s radio, and hands a trashed song out no more', async () => {
        serve({ liked: ['a', 'b'], lists: { 'radio-a': ['a', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6'], 'radio-b': ['b', 'x1', 'x5', 'y1', 'y2', 'y3', 'y4'] } });
        expect(await fm()).toEqual(['x1', 'x2']);
        expect(await trash('x2')).toEqual({});
        // x3, x4 and x6 went with the radio; x5 is also of the next radio, and was never trashed.
        expect(await fm()).toEqual(['x5', 'y1']);
        // A song trashed before it was handed out is skipped; the radio it would have come from stays.
        await trash('y3');
        expect(await fm()).toEqual(['y2', 'y4']);
    });

    it('is nothing without a song to ask with', async () => {
        serve({});
        expect(await fm()).toEqual([]);
        expect(asked('radio')).toHaveLength(0);
    });

    it('asks with the songs played in the app too, once the explore page was handed them', async () => {
        serve({ lists: { 'radio-p': ['p', 'z1'] } });
        await spotifyProvider.explore!.getFeed(undefined, [spotifyProvider.normalizeSong(track('p'))]);
        expect(await fm()).toEqual(['z1']);
        // Another account's FM begins with nothing of this one's.
        resetSpotifyRecommendations();
        expect(await fm()).toEqual([]);
    });
});

describe('Spotify personal FM without the liked songs', () => {
    it('hands out nothing and does not fail where Spotify refuses the liked songs, and asks for them again on the next call', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        serve({ liked: ['a'], lists: { 'radio-a': ['a', 'x1', 'x2'] } });
        const answer = request.getMockImplementation()!;
        let refused = true;
        request.mockImplementation(async (operation: string, params: any) => {
            if (refused && params?.name === 'fetchLibraryTracks') throw new Error('PersistedQueryNotFound');
            return answer(operation, params);
        });
        expect(await fm()).toEqual([]);
        refused = false;
        expect(await fm()).toEqual(['x1', 'x2']);
    });
});

describe('Spotify daily songs and recommended playlists', () => {
    it('takes the first daily mix as the daily songs and lists the other lists made for the account', async () => {
        serve({ made: [id('weekly'), DAILY_ONE, DAILY_TWO], lists: { [DAILY_ONE]: ['d1', 'd2'] } });
        const [songs, lists] = await Promise.all([spotifyProvider.recommendations!.getDailySongs!(), spotifyProvider.recommendations!.getRecommendedCollections!(35)]);
        expect(songs.map(song => song.name)).toEqual(['d1', 'd2']);
        expect(lists.map(list => list.id)).toEqual([id('weekly'), DAILY_TWO]);
        expect(asked('browsePage')).toHaveLength(1);
    });

    it('has no daily songs where none of the lists is a daily mix', async () => {
        serve({ made: [id('weekly')] });
        expect(await spotifyProvider.recommendations!.getDailySongs!()).toEqual([]);
        expect(asked('fetchPlaylist')).toHaveLength(0);
    });
});

describe('quality levels', () => {
    it('lists two levels for Spotify and asks for the nearest one at or below the preference', async () => {
        expect(omni.getAudioQualityLevels('spotify')).toEqual(['standard', 'high']);
        expect((['standard', 'high', 'lossless', 'hires'] as const).map(level => omni.resolveAudioQuality('spotify', level))).toEqual(['standard', 'high', 'high', 'high']);
        serve({});
        await omni.getAudioSource(spotifyProvider.normalizeSong(track('a')) as UnifiedSong, 'lossless');
        expect(asked('audio')[0][1]).toEqual({ id: id('a'), quality: 'high' });
    });

    it('leaves a provider that lists no levels with all four', () => {
        expect(omni.getAudioQualityLevels('netease')).toEqual(['standard', 'high', 'lossless', 'hires']);
        expect(omni.resolveAudioQuality('netease', 'hires')).toBe('hires');
    });
});
