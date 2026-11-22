import { describe, expect, it, vi } from 'vitest';
import {
    SONG_COUNTERPARTS_PER_CALL,
    getSongCounterpartSources,
    listSongCounterpartTargets,
    resolveSongCounterparts,
    toForeignSongQuery,
    type SongCounterpartsDeps,
} from '@/services/onlineMusic/songCounterparts';
import type { SongResult, UnifiedSong } from '@/types';
import type { ForeignSongQuery, OnlineMusicProvider } from '@/types/onlineMusic';

// test/unit/onlineMusic/songCounterparts.test.ts
// 「对应歌曲」宿主这一侧：什么时候问、问的时候给音源看什么、批量与时限、答回来的东西收不收。

const SECRET = 'cookie=very-secret';
const song = (providerId: string, mediaId: string, patch: Partial<UnifiedSong> = {}): SongResult => ({
    id: mediaId,
    name: `song ${mediaId}`,
    artists: [{ id: 1, name: 'Singer' }, { id: 2, name: 'Other' }],
    album: { id: 9, name: 'Album', coverUrl: 'https://img.example/c.jpg' },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId, mediaId, providerData: { token: SECRET, mediaMid: 'private' } },
    ...patch,
} as SongResult);
const targetSong = (query: ForeignSongQuery): UnifiedSong => song('target', `x:${query.id}`, { name: query.title }) as UnifiedSong;

type Provider = Pick<OnlineMusicProvider, 'id' | 'getAvailability' | 'playback'>;
const provider = (patch: Partial<NonNullable<Provider['playback']>> = {}, configured = true): Provider => ({
    id: 'target',
    getAvailability: () => (configured ? { configured: true } : { configured: false, reason: 'not-configured' }),
    playback: {
        counterpartSources: ['netease', 'qq'],
        getCounterparts: async queries => queries.map(targetSong),
        ...patch,
    } as NonNullable<Provider['playback']>,
} as Provider);
const deps = (found: Provider | null, patch: Partial<SongCounterpartsDeps> = {}): Partial<SongCounterpartsDeps> => ({
    getProvider: id => (id === 'target' ? found : null),
    isSwitchedOn: () => true,
    ...patch,
});

describe('toForeignSongQuery', () => {
    it('gives the ids and the public details, and nothing of the source’s own data', () => {
        const query = toForeignSongQuery(song('qq', '003abcDEF', { id: 12345 }));
        expect(query).toEqual({
            sourceId: 'qq',
            id: '003abcDEF',
            publicId: '12345',
            title: 'song 003abcDEF',
            artists: ['Singer', 'Other'],
            album: 'Album',
            durationMs: 200000,
            coverUrl: 'https://img.example/c.jpg',
        });
        expect(JSON.stringify(query)).not.toContain('secret');
        expect(JSON.stringify(query)).not.toContain('private');
    });

    it('is null for a cloud song or an item that is not a song, and survives a song with fields missing', () => {
        const cloud = song('netease', '5');
        expect(toForeignSongQuery({ ...cloud, sourceRef: { ...cloud.sourceRef, variant: 'cloud' } } as SongResult)).toBeNull();
        expect(toForeignSongQuery({ ...song('netease', '5'), itemKind: 'video' } as SongResult)).toBeNull();
        const bare = { id: '6', name: 'n', durationMs: 0, sourceRef: { kind: 'online', providerId: 'netease', mediaId: '6' } } as unknown as SongResult;
        expect(toForeignSongQuery(bare)).toEqual({ sourceId: 'netease', id: '6', title: 'n', artists: [] });
    });

    it('leaves publicId out when it is the id, and is null for a song that is not online', () => {
        expect(toForeignSongQuery(song('netease', '77'))).not.toHaveProperty('publicId');
        expect(toForeignSongQuery({ ...song('netease', '1'), sourceRef: { kind: 'local', mediaId: 'a' } } as SongResult)).toBeNull();
        expect(toForeignSongQuery({ ...song('netease', '1'), sourceRef: { kind: 'navidrome', mediaId: 'a' } } as SongResult)).toBeNull();
    });
});

describe('when a source is asked', () => {
    const songs = [song('netease', '1'), song('qq', 'mid00001')];

    it('is not asked when it is not registered, switched off, not configured or does not answer this', async () => {
        const getCounterparts = vi.fn(async (queries: ForeignSongQuery[]) => queries.map(targetSong));
        const cases: Array<[Partial<SongCounterpartsDeps>, string]> = [
            [deps(null), 'not-registered'],
            [deps(provider({ getCounterparts }), { isSwitchedOn: () => false }), 'switched-off'],
            [deps(provider({ getCounterparts }, false)), 'not-configured'],
            // 没配好的音源说不出能答哪些来源：原因还是「没配好」。
            [deps(provider({ getCounterparts, counterpartSources: [] }, false)), 'not-configured'],
            [deps(provider({ getCounterparts, counterpartSources: [] })), 'unsupported'],
            [deps(provider({ getCounterparts: undefined })), 'unsupported'],
            [deps({ id: 'target', getAvailability: () => ({ configured: true }) } as Provider), 'unsupported'],
        ];
        for (const [overrides, reason] of cases) {
            const answer = await resolveSongCounterparts('target', songs, overrides);
            expect(answer, reason).toEqual({ songs: [null, null], unavailable: reason, asked: 0, failed: 0 });
        }
        expect(getCounterparts).not.toHaveBeenCalled();
    });

    it('takes a source whose declaration throws as one that declares none', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const found = provider();
        Object.defineProperty(found.playback, 'counterpartSources', { get: () => { throw new Error('bad getter'); } });
        expect(getSongCounterpartSources('target', { getProvider: () => found, isSwitchedOn: () => true })).toEqual({ sources: [], unavailable: 'unsupported' });
        vi.restoreAllMocks();
    });

    it('says which sources it answers for, without itself', () => {
        const found = provider({ counterpartSources: ['netease', 'target'] });
        expect(getSongCounterpartSources('target', { getProvider: () => found, isSwitchedOn: () => true })).toEqual({ sources: ['netease'] });
    });

    it('is asked only for online songs of the sources it declared', async () => {
        const getCounterparts = vi.fn(async (queries: ForeignSongQuery[]) => queries.map(targetSong));
        const mixed = [
            song('netease', '1'),
            song('kugou', 'abc'),
            { ...song('netease', '2'), sourceRef: { kind: 'local', mediaId: 'l' } } as SongResult,
            song('target', 'own'),
            song('qq', 'mid00001'),
        ];
        const answer = await resolveSongCounterparts('target', mixed, deps(provider({ getCounterparts })));
        expect(getCounterparts).toHaveBeenCalledTimes(1);
        expect(getCounterparts.mock.calls[0][0].map(query => `${query.sourceId}:${query.id}`)).toEqual(['netease:1', 'qq:mid00001']);
        // 给音源看的东西里没有原音源自己的数据。
        expect(JSON.stringify(getCounterparts.mock.calls[0][0])).not.toContain('secret');
        expect(answer.songs.map(found => found?.id ?? null)).toEqual(['x:1', null, null, null, 'x:mid00001']);
        expect(answer).toMatchObject({ asked: 2, failed: 0 });
        expect(answer.unavailable).toBeUndefined();
    });
});

describe('batches and time limits', () => {
    const many = Array.from({ length: 450 }, (_, index) => song('netease', String(index + 1)));

    it('asks for a whole playlist in a few calls', async () => {
        const getCounterparts = vi.fn(async (queries: ForeignSongQuery[]) => queries.map(targetSong));
        const answer = await resolveSongCounterparts('target', many, deps(provider({ getCounterparts })));
        expect(getCounterparts.mock.calls.map(call => call[0].length)).toEqual([SONG_COUNTERPARTS_PER_CALL, SONG_COUNTERPARTS_PER_CALL, 50]);
        expect(answer.songs.every(Boolean)).toBe(true);
        expect(answer.songs[449]?.id).toBe('x:450');
    });

    it('counts a batch that rejects as none and goes on, and stops asking after one that runs out of time', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        let call = 0;
        const rejecting = vi.fn((queries: ForeignSongQuery[]) => {
            call += 1;
            return call === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(queries.map(targetSong));
        });
        const first = await resolveSongCounterparts('target', many, deps(provider({ getCounterparts: rejecting })));
        expect(first).toMatchObject({ asked: 450, failed: 200 });
        expect(first.songs.slice(0, 200).every(found => found === null)).toBe(true);
        expect(first.songs.slice(200).every(Boolean)).toBe(true);

        call = 0;
        const hanging = vi.fn((queries: ForeignSongQuery[]) => {
            call += 1;
            return call === 2 ? new Promise<UnifiedSong[]>(() => {}) : Promise.resolve(queries.map(targetSong));
        });
        const second = await resolveSongCounterparts('target', many, deps(provider({ getCounterparts: hanging }), { callTimeoutMs: 20 }));
        expect(hanging).toHaveBeenCalledTimes(2);
        expect(second).toMatchObject({ asked: 450, failed: 250 });
        expect(second.songs.slice(0, 200).every(Boolean)).toBe(true);
        expect(second.songs.slice(200).every(found => found === null)).toBe(true);
        vi.restoreAllMocks();
    });

    it('stops asking when the whole time is used up', async () => {
        let now = 0;
        const getCounterparts = vi.fn(async (queries: ForeignSongQuery[]) => {
            now += 40;
            return queries.map(targetSong);
        });
        const answer = await resolveSongCounterparts('target', many, deps(provider({ getCounterparts }), { now: () => now, totalTimeoutMs: 50 }));
        expect(getCounterparts).toHaveBeenCalledTimes(2);
        expect(answer).toMatchObject({ asked: 450, failed: 50 });
    });
});

describe('what it takes from the answer', () => {
    it('takes only the target’s own songs, one for each song asked', async () => {
        const getCounterparts = async (queries: ForeignSongQuery[]) => [
            song('netease', queries[0].id) as UnifiedSong,
            null,
            { nonsense: true } as unknown as UnifiedSong,
        ];
        const songs = [song('netease', '1'), song('netease', '2'), song('netease', '3'), song('netease', '4')];
        const answer = await resolveSongCounterparts('target', songs, deps(provider({ getCounterparts })));
        expect(answer.songs).toEqual([null, null, null, null]);

        const notAList = await resolveSongCounterparts('target', songs, deps(provider({
            getCounterparts: (async () => 'nope') as unknown as NonNullable<Provider['playback']>['getCounterparts'],
        })));
        expect(notAList.songs).toEqual([null, null, null, null]);
    });
});

describe('listSongCounterpartTargets', () => {
    it('lists the sources that answer for an origin, and says when one is not configured', () => {
        const providers: Record<string, Provider> = {
            a: { ...provider(), id: 'a' },
            b: { ...provider({}, false), id: 'b' },
            c: { ...provider({ counterpartSources: ['kugou'] }), id: 'c' },
            d: { ...provider(), id: 'd' },
            netease: { ...provider(), id: 'netease' },
        };
        const targets = listSongCounterpartTargets('netease', {
            getProvider: id => providers[id] ?? null,
            isSwitchedOn: id => id !== 'd',
            listSourceIds: () => Object.keys(providers),
        });
        expect(targets).toEqual([{ sourceId: 'a' }, { sourceId: 'b', unavailable: 'not-configured' }]);
    });
});
