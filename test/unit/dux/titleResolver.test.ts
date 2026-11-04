import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// Apple Music 交给 MPRIS 的是翻译后的标题（"Spring Thief" 而不是 春泥棒）。iTunes 日本区目录能换回
// 原名；这里钉住搜索 URL、候选排序和缓存，避免每次都多打一次网络。

const require = createRequire(import.meta.url);
const { createTitleResolver, rankCandidates, searchUrl } = require('../../../electron/dux/titleResolver.cjs') as {
    createTitleResolver: (options: { fetchImpl: unknown; countries?: string[]; log?: unknown }) => {
        resolve: (query: { title: string; artist: string; album?: string; durationSec?: number }, options?: { signal?: AbortSignal }) => Promise<Array<{ title: string; artist: string; album: string; durationSec: number }>>;
    };
    rankCandidates: (query: { title: string; artist: string; album?: string; durationSec?: number }, results: unknown[]) => Array<{ title: string; artist: string; score: number }>;
    searchUrl: (title: string, artist: string, country: string) => string;
};

describe('searchUrl', () => {
    it('asks the Japanese storefront for songs', () => {
        const url = new URL(searchUrl('Spring Thief', 'Yorushika', 'jp'));
        expect(url.searchParams.get('term')).toBe('Spring Thief Yorushika');
        expect(url.searchParams.get('country')).toBe('jp');
        expect(url.searchParams.get('entity')).toBe('song');
    });
});

describe('rankCandidates', () => {
    it('prefers the original Japanese title over game-size and remix versions', () => {
        const candidates = rankCandidates(
            { title: 'Alka Tail', artist: 'Konomi Suzuki', album: 'Summer Pockets (Original SoundTrack)', durationSec: 289.879 },
            [
                { trackName: 'アルカテイル (Game Size Ver)', artistName: '鈴木このみ', collectionName: 'Summer Pockets (Original SoundTrack)', trackTimeMillis: 133373 },
                { trackName: 'アルカテイル', artistName: '鈴木このみ', collectionName: 'Summer Pockets (Original SoundTrack)', trackTimeMillis: 289880 },
                { trackName: 'アルカテイル (Hamu 20th Anniversary Remix)', artistName: '鈴木このみ', collectionName: 'Key BEST SELECTION', trackTimeMillis: 287013 },
            ],
        );
        expect(candidates[0]).toMatchObject({ title: 'アルカテイル', artist: '鈴木このみ' });
        expect(candidates.map(candidate => candidate.title)).not.toContain('アルカテイル (Game Size Ver)');
    });

    it('accepts a translated pair only when the duration is very close', () => {
        expect(rankCandidates(
            { title: 'Spring Thief', artist: 'Yorushika', album: 'Spring Thief - Single', durationSec: 290.279 },
            [{ trackName: '春泥棒', artistName: 'ヨルシカ', collectionName: '春泥棒 - Single', trackTimeMillis: 290279 }],
        )[0]).toMatchObject({ title: '春泥棒', artist: 'ヨルシカ' });
        expect(rankCandidates(
            { title: 'Local Song', artist: 'Local Band', album: 'Local Album', durationSec: 200 },
            [{ trackName: 'Some Other Song', artistName: 'Some Other Artist', collectionName: 'Other Album', trackTimeMillis: 201000 }],
        )).toEqual([]);
    });

    it('does not accept a same-title cover by another Latin artist', () => {
        expect(rankCandidates(
            { title: 'Song', artist: 'Artist', album: 'Album', durationSec: 200 },
            [{ trackName: 'Song', artistName: 'Cover Band', collectionName: 'Other Album', trackTimeMillis: 200500 }],
        )).toEqual([]);
    });

    it('does not switch an unmarked track to a remix or live version', () => {
        expect(rankCandidates(
            { title: 'Song', artist: 'Artist', album: 'Album', durationSec: 200 },
            [{ trackName: 'Song (Live)', artistName: 'Artist', collectionName: 'Album', trackTimeMillis: 200000 }],
        )).toEqual([]);
    });

    it('drops a result whose title is the query title', () => {
        expect(rankCandidates(
            { title: 'spiral', artist: 'LONGMAN', durationSec: 231 },
            [{ trackName: 'spiral', artistName: 'LONGMAN', collectionName: 'spiral - Single', trackTimeMillis: 231000 }],
        )).toEqual([]);
    });
});

describe('createTitleResolver', () => {
    it('returns the original title and caches it', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                results: [
                    { trackName: '春泥棒', artistName: 'ヨルシカ', collectionName: '春泥棒 - Single', trackTimeMillis: 290279 },
                ],
            }),
        }));
        const resolver = createTitleResolver({ fetchImpl, countries: ['jp'], log: { info: () => {} } });
        const query = { title: 'Spring Thief', artist: 'Yorushika', album: 'Spring Thief - Single', durationSec: 290.279 };
        const first = await resolver.resolve(query);
        expect(first[0]).toMatchObject({ title: '春泥棒', artist: 'ヨルシカ' });
        await resolver.resolve(query);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('returns an empty list when the catalog is unreachable', async () => {
        const resolver = createTitleResolver({
            fetchImpl: async () => { throw new Error('offline'); },
            countries: ['jp'],
            log: { info: () => {} },
        });
        await expect(resolver.resolve({ title: 'Spring Thief', artist: 'Yorushika' })).resolves.toEqual([]);
    });

    it('retries after a failed lookup instead of pinning the miss', async () => {
        let calls = 0;
        const fetchImpl = async () => {
            calls += 1;
            if (calls <= 2) throw new Error('temporary');
            return {
                ok: true,
                json: async () => ({
                    results: [{ trackName: '春泥棒', artistName: 'ヨルシカ', collectionName: '春泥棒 - Single', trackTimeMillis: 290279 }],
                }),
            };
        };
        const resolver = createTitleResolver({ fetchImpl, countries: ['jp'], log: { info: () => {} } });
        const query = { title: 'Spring Thief', artist: 'Yorushika', album: 'Spring Thief - Single', durationSec: 290.279 };
        await expect(resolver.resolve(query)).resolves.toEqual([]);
        const second = await resolver.resolve(query);
        expect(second[0]).toMatchObject({ title: '春泥棒' });
        expect(calls).toBe(3);
    });

    it('stops when the lyric request is aborted', async () => {
        const controller = new AbortController();
        const resolver = createTitleResolver({
            fetchImpl: (url: string, options: { signal: AbortSignal }) => new Promise((_, reject) => {
                options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            }),
            countries: ['jp'],
            log: { info: () => {} },
        });
        const pending = resolver.resolve({ title: 'Spring Thief', artist: 'Yorushika' }, { signal: controller.signal });
        controller.abort();
        await expect(pending).resolves.toEqual([]);
    });
});
