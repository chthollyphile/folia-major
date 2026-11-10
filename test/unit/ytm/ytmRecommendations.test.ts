import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/ytm/ytmRecommendations.test.ts — the radio tab for YouTube Music: which songs the
// personal FM hands out, and where the recommended playlists come from.

const request = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/ytm/ytmTransport', () => ({
    requestYtm: request, getYtmTransportAvailability: () => ({ configured: true }),
}));
import { ytmExplore } from '@/services/onlineMusic/ytm/ytmExplore';
import { resetYtmRecommendations, ytmRecommendations } from '@/services/onlineMusic/ytm/ytmRecommendations';
import { OnlineProviderError } from '@/types/onlineMusic';

const song = (id: string) => ({ id, name: `song ${id}`, artists: [], album: { id: '', name: '', coverUrl: '' }, durationMs: 1000 });
const list = (id: string, extra: Record<string, unknown> = {}) => ({ kind: 'collection', collection: { id, type: 'playlist', name: `list ${id}`, coverUrl: '', ...extra } });
// A radio as YouTube Music lists it: the song asked with first.
const radios: Record<string, string[]> = {
    a: ['a', 'a-0', 'a-1', 'a-2', 'a-3'],
    b: ['b', 'a-0', 'a-1', 'b-0', 'b-1'],
};
const page = {
    sections: [
        { title: 'Mixed for you', items: [list('RDmix', { mix: true, videoId: 'v' }), { kind: 'collection', collection: { id: 'MPREalbum', type: 'album', name: 'album', coverUrl: '' } }, { kind: 'song', song: song('s') }] },
        { title: 'Listen again', items: [list('PLheard')] },
        { title: 'More', items: [list('PLone'), list('RDmix', { mix: true })] },
    ],
};
// What the desktop side answers; `liked` is the first rows of the liked-music list.
const answer = (liked: string[] | Error) => request.mockImplementation(async (operation: string, params: { videoId?: string } = {}) => {
    if (operation === 'playlist') {
        if (liked instanceof Error) throw liked;
        return { items: liked.map(song) };
    }
    if (operation === 'mix') return { items: (radios[params.videoId ?? ''] ?? []).map(song) };
    if (operation === 'explore') return page;
    throw new Error(`unexpected ${operation}`);
});
const fm = async () => (await ytmRecommendations.getPersonalFm!()).map(handed => String(handed.id));

beforeEach(() => {
    request.mockReset();
    resetYtmRecommendations();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('YouTube Music personal FM', () => {
    it('hands out a song radio two songs a call, without the song it was asked with, for two requests', async () => {
        answer(['a']);
        expect([...await fm(), ...await fm()]).toEqual(['a-0', 'a-1', 'a-2', 'a-3']);
        expect(request.mock.calls).toEqual([['playlist', { id: 'LM' }], ['mix', { id: 'RDAMVMa', videoId: 'a' }]]);
    });

    it('drops what was left of a trashed song\'s radio, and hands no song out twice', async () => {
        answer(['a', 'b']);
        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        expect(await fm()).toEqual(['a-0', 'a-1']);
        expect(await ytmRecommendations.dislikeSong!('a-1')).toEqual({});
        // The radio of `b` lists two songs the radio of `a` already gave.
        expect(await fm()).toEqual(['b-0', 'b-1']);
        expect(await fm()).toEqual([]);
        // YouTube was told nothing of the trash.
        expect(request.mock.calls.map(([operation]) => operation)).toEqual(['playlist', 'mix', 'mix', 'playlist']);
        random.mockRestore();
    });

    it('has no song without a song to ask with, and fails only offline', async () => {
        answer([]);
        expect(await fm()).toEqual([]);
        answer(new OnlineProviderError('auth-required', 'signed out', 'ytm'));
        expect(await fm()).toEqual([]);
        answer(new OnlineProviderError('network', 'offline', 'ytm'));
        await expect(fm()).rejects.toMatchObject({ code: 'network' });
    });
});

describe('YouTube Music recommended playlists', () => {
    it('takes the playlists and mixes of the music page as the explore page read it, and reads it only where none was read', async () => {
        answer([]);
        await ytmExplore.getFeed(undefined, []);
        request.mockClear();
        const lists = await ytmRecommendations.getRecommendedCollections!(35);
        // No album, no song, nothing of the account's own listening, a list once.
        expect(lists.map(found => found.id)).toEqual(['RDmix', 'PLone']);
        expect(lists[0].providerData).toMatchObject({ mix: true, videoId: 'v' });
        expect(request).not.toHaveBeenCalled();

        resetYtmRecommendations();
        expect((await ytmRecommendations.getRecommendedCollections!(1)).map(found => found.id)).toEqual(['RDmix']);
        expect(request.mock.calls).toEqual([['explore', {}]]);
    });
});
