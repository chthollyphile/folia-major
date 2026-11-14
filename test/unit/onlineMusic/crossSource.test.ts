// @vitest-environment jsdom
// @builtin-sources
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    declaredParticipants,
    isParticipantReady,
    participantSkipReason,
    participants,
    resolveParticipants,
    type CrossSourceDeclaration,
    type CrossSourceState,
} from '@/services/onlineMusic/crossSource';
import {
    getOnlineMusicProvider,
    listOnlineMusicProviders,
    registerOnlineMusicProvider,
    unregisterOnlineMusicProvider,
} from '@/services/onlineMusic/providerRegistry';
import { omni } from '@/services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { resolveSearchSources } from '@/components/app/search/searchSources';
import { findAutomaticOnlineMetadataCandidate, searchOnlineMetadata } from '@/services/onlineMetadataSearchService';
import { autoMatchBestLyric } from '@/utils/lyrics/autoMatchBestLyric';
import { searchLyricsByMatchSource } from '@/utils/lyrics/lyricMatchSources';
import { buildLyricSourceOrder, migratePreferredLyricSource } from '@/utils/lyrics/sourcePriority';
import type { LocalSong } from '@/types';
import type { OnlineMusicProvider } from '@/types/onlineMusic';

// test/unit/onlineMusic/crossSource.test.ts
// Folium 2.0 plan §7.1 and the S1 gate: the one rule for the cross-source features (crossSource.ts), its five
// states, and the three features - federated search, metadata match, lyric match across sources - with each of
// the nine platforms taken away in turn: none of them throws, the platform is left out as `not-enabled`, and
// the stored choices (the preferred lyric source, a local song's online metadata source) are not written over.

vi.mock('@/services/onlineMusic/qq/qqLyricProvider', () => ({ searchQQLyrics: vi.fn(async () => []), fetchQQLyrics: vi.fn(async () => null) }));
vi.mock('@/utils/lyrics/providers/amllDbProvider', async (importOriginal) => ({
    ...await importOriginal<Record<string, unknown>>(),
    fetchAmllDbLyrics: vi.fn(async () => null),
    searchAmllDbSongs: vi.fn(async () => []),
}));

const NINE = ['netease', 'kugou', 'qq', 'bodian', 'ytm', 'spotify', 'qishui', 'appleMusic', 'fnmusic'] as const;

const declaration = (overrides: Partial<CrossSourceDeclaration> = {}): CrossSourceDeclaration => ({
    sourceId: 'alpha',
    access: 'anonymous',
    checksAvailability: true,
    ...overrides,
});
const state = (overrides: Partial<CrossSourceState> = {}): CrossSourceState => ({
    enabled: true,
    availability: { configured: true },
    signedIn: false,
    ...overrides,
});

describe('crossSource · the five states (plan §7.1)', () => {
    it('uses an enabled source that works anonymously, signed in or not', () => {
        expect(resolveParticipants([declaration()], () => state())).toEqual({ ready: ['alpha'], skipped: [] });
        expect(resolveParticipants([declaration()], () => state({ signedIn: true }))).toEqual({ ready: ['alpha'], skipped: [] });
    });

    it('uses an enabled source that needs an account while one is signed in', () => {
        expect(resolveParticipants([declaration({ access: 'account' })], () => state({ signedIn: true })).ready).toEqual(['alpha']);
    });

    it('skips an enabled source that needs an account while nobody is signed in: needs-account', () => {
        expect(resolveParticipants([declaration({ access: 'account' })], () => state()))
            .toEqual({ ready: [], skipped: [{ sourceId: 'alpha', reason: 'needs-account' }] });
    });

    it('skips an enabled source whose getAvailability says it is not set up or cannot run here, for that reason', () => {
        expect(resolveParticipants([declaration()], () => state({ availability: { configured: false, reason: 'runtime-unavailable' } })).skipped)
            .toEqual([{ sourceId: 'alpha', reason: 'runtime-unavailable' }]);
        expect(resolveParticipants([declaration()], () => state({ availability: { configured: false } })).skipped)
            .toEqual([{ sourceId: 'alpha', reason: 'not-configured' }]);
        // A source that is not declared to need its setup is not asked about it.
        expect(resolveParticipants([declaration({ checksAvailability: false })], () => state({ availability: { configured: false } })).ready)
            .toEqual(['alpha']);
    });

    it('skips a source that is not enabled (not registered, turned off, failed to start): not-enabled, before anything else', () => {
        expect(resolveParticipants([declaration({ access: 'account' })], () => state({ enabled: false, availability: { configured: false } })).skipped)
            .toEqual([{ sourceId: 'alpha', reason: 'not-enabled' }]);
    });

    it('keeps the declared order, lists a source once, and always uses the host\'s own source', () => {
        const result = resolveParticipants([
            declaration({ sourceId: 'c' }),
            declaration({ sourceId: 'host', hostOwned: true }),
            declaration({ sourceId: 'a', access: 'account' }),
            declaration({ sourceId: 'c' }),
            declaration({ sourceId: 'b' }),
        ], ({ sourceId }) => state({ enabled: sourceId !== 'host' }));
        expect(result).toEqual({ ready: ['c', 'host', 'b'], skipped: [{ sourceId: 'a', reason: 'needs-account' }] });
    });
});

describe('crossSource · what the sources declare today (the S1 seam)', () => {
    it('declares the lyric sources in their registry order, and the metadata match as NetEase, QQ, KuGou', () => {
        expect(declaredParticipants('lyrics').map(entry => entry.sourceId)).toEqual(['netease', 'amll', 'qq', 'kugou', 'qishui', 'spotify', 'appleMusic']);
        expect(declaredParticipants('lyrics').find(entry => entry.sourceId === 'amll')?.hostOwned).toBe(true);
        expect(declaredParticipants('metadata').map(entry => entry.sourceId)).toEqual(['netease', 'qq', 'kugou']);
        // Folium 2.0 S5: Bodian, a source mod now, registers after the platforms the host still registers at load.
        expect(declaredParticipants('search').map(entry => entry.sourceId)).toEqual([...NINE.filter(id => id !== 'bodian'), 'bodian']);
    });

    it('with all nine there and nobody signed in: the lyric sources that need an account are skipped, the rest ready', () => {
        const lyrics = participants('lyrics');
        expect(lyrics.ready).toEqual(expect.arrayContaining(['netease', 'amll', 'qq', 'kugou']));
        expect(lyrics.skipped).toEqual(expect.arrayContaining([
            { sourceId: 'spotify', reason: 'needs-account' },
        ]));
        expect(participants('metadata').ready).toEqual(['netease', 'qq', 'kugou']);
    });

    it('logs each skipped source once per reported run, and nothing for an unreported read', () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        participants('lyrics');
        expect(info).not.toHaveBeenCalled();
        participants('lyrics', { report: true });
        expect(info).toHaveBeenCalledWith('[crossSource] lyrics: spotify skipped (needs-account)');
        info.mockRestore();
    });
});

const localSong = (overrides: Partial<LocalSong> = {}): LocalSong => ({
    id: 'local-1',
    fileName: 'Song Title.flac',
    filePath: 'Music/Song Title.flac',
    title: 'Song Title',
    duration: 180_000,
    titleOrigin: 'import',
    importedMetadata: { artistNames: ['Singer'], albumName: 'Album' },
    onlineMetadata: { source: 'qq', songId: 'mid-1', title: 'Song Title', artists: [{ name: 'Singer' }] },
    ...overrides,
} as unknown as LocalSong);

describe('crossSource · each of the nine platforms taken away (the S1 gate)', () => {
    const removed = new Map<string, OnlineMusicProvider>();
    const spies: Array<{ mockRestore: () => void }> = [];

    beforeEach(() => {
        // No platform is reached: every search answers nothing and every lyric fetch has none.
        for (const provider of listOnlineMusicProviders()) {
            if (provider.search) spies.push(vi.spyOn(provider.search, 'searchSongs').mockResolvedValue({ items: [], hasMore: false, nextOffset: 0 }));
            if (provider.lyrics) spies.push(vi.spyOn(provider.lyrics, 'getLyrics').mockResolvedValue({ lyrics: null, isPureMusic: false }));
        }
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        removed.forEach(provider => registerOnlineMusicProvider(provider));
        removed.clear();
        spies.splice(0).forEach(spy => spy.mockRestore());
        vi.restoreAllMocks();
        useOnlineProviderAccountStore.setState({ accounts: {} });
    });

    const takeAway = (providerId: string) => {
        const provider = getOnlineMusicProvider(providerId);
        expect(provider).not.toBeNull();
        removed.set(providerId, provider!);
        unregisterOnlineMusicProvider(providerId);
    };

    it.each(NINE)('without %s: the federated search, the metadata match and the lyric match run and leave it out', async (providerId) => {
        // Everyone signed in, so that only the missing platform is left out.
        useOnlineProviderAccountStore.setState({
            accounts: Object.fromEntries(NINE.map(id => [id, {
                status: 'authenticated', user: { id: 1, nickname: id }, collections: [], likedSongIds: [], wantedLikes: {}, hydration: 'ready', freshness: 'fresh',
            }])),
        });
        takeAway(providerId);

        // Federated search: the platform is not among the sources, whichever is active.
        const summaries = omni.getProviderSummaries();
        expect(() => resolveSearchSources({ providers: summaries, activeProviderId: providerId, hasLocalSongs: true, navidromeReady: false })).not.toThrow();
        const sources = resolveSearchSources({ providers: summaries, activeProviderId: 'kugou', hasLocalSongs: true, navidromeReady: false });
        expect(sources).not.toContain(providerId);
        expect(participants('search').ready).not.toContain(providerId);

        // Metadata match: skipped as not-enabled where it takes part; the automatic match still answers.
        const metadata = participants('metadata');
        expect(metadata.ready).not.toContain(providerId);
        if (declaredParticipants('metadata').some(entry => entry.sourceId === providerId)) {
            expect(metadata.skipped).toContainEqual({ sourceId: providerId, reason: 'not-enabled' });
        }
        const song = localSong();
        await expect(findAutomaticOnlineMetadataCandidate(song)).resolves.toBeNull();
        // The automatic metadata match only reads the song; what the match writes back is pinned in
        // test/unit/services/localMusicLyricsMatch.test.ts (the source it matched with, not a fixed one).
        await expect(searchOnlineMetadata('netease', 'Song Title Singer', { title: 'Song Title', artist: 'Singer', durationMs: 180_000 })).resolves.toEqual([]);

        // Lyric match across sources: skipped as not-enabled where it is a lyric source; the automatic pick and a
        // match window search still answer, with the stored preference left as it is.
        expect(isParticipantReady('lyrics', providerId)).toBe(false);
        if (declaredParticipants('lyrics').some(entry => entry.sourceId === providerId)) {
            expect(participantSkipReason('lyrics', providerId)).toBe('not-enabled');
        }
        await expect(autoMatchBestLyric('Song Title', 'Singer', 180_000, { preferredSource: providerId })).resolves.toBeNull();
        await expect(searchLyricsByMatchSource(providerId, 'Song Title Singer', { title: 'Song Title', artist: 'Singer', durationMs: 180_000 })).resolves.toEqual([]);
        expect(migratePreferredLyricSource(providerId, null)).toBe(providerId);
        expect(buildLyricSourceOrder(providerId)[0]).toBe(providerId);
    });

    // 存着的首选来源缺席时，自动匹配用下一个 ready 的来源，首选的值不动；它回来后又先问它。
    it('matches lyrics from the next ready source while the preferred one is missing, and asks the preferred one again once it is back', async () => {
        const found = {
            id: 777, name: 'Song Title', artists: [{ id: 1, name: 'Singer' }], album: { id: 2, name: 'Album' }, durationMs: 180_000,
            sourceRef: { kind: 'online', providerId: 'netease', mediaId: '777' },
        };
        const lyrics = { lines: [{ fullText: 'Test lyric', startTime: 0, endTime: 1, words: [] }], isWordByWord: true };
        vi.mocked(getOnlineMusicProvider('netease')!.search!.searchSongs).mockResolvedValue({ items: [found] as never, hasMore: false, nextOffset: 0 });
        vi.mocked(getOnlineMusicProvider('netease')!.lyrics!.getLyrics).mockResolvedValue({ lyrics: lyrics as never, isPureMusic: false });
        const preferred = 'qq';
        takeAway('qq');

        const match = await autoMatchBestLyric('Song Title', 'Singer', 180_000, { preferredSource: preferred });
        expect(match).toMatchObject({ source: 'netease' });
        expect(preferred).toBe('qq');
        expect(buildLyricSourceOrder(migratePreferredLyricSource(preferred, null))[0]).toBe('qq');

        registerOnlineMusicProvider(removed.get('qq')!);
        removed.delete('qq');
        expect(isParticipantReady('lyrics', 'qq')).toBe(true);
    });

    it('takes a platform back into all three features once it registers again', () => {
        takeAway('qq');
        expect(participantSkipReason('lyrics', 'qq')).toBe('not-enabled');
        expect(participants('metadata').ready).toEqual(['netease', 'kugou']);
        registerOnlineMusicProvider(removed.get('qq')!);
        removed.delete('qq');
        expect(isParticipantReady('lyrics', 'qq')).toBe(true);
        expect(participants('metadata').ready).toEqual(['netease', 'qq', 'kugou']);
    });

    it('with no platform at all: every feature has no source, and none of them throws', async () => {
        for (const provider of listOnlineMusicProviders()) takeAway(provider.id);
        expect(participants('search')).toEqual({ ready: [], skipped: [] });
        expect(participants('metadata').ready).toEqual([]);
        // AMLL DB is the host's own and stays.
        expect(participants('lyrics').ready).toEqual(['amll']);
        expect(resolveSearchSources({ providers: [], activeProviderId: 'netease', hasLocalSongs: true, navidromeReady: false })).toEqual(['local']);
        await expect(findAutomaticOnlineMetadataCandidate(localSong())).resolves.toBeNull();
        await expect(autoMatchBestLyric('Song Title', 'Singer', 180_000, { preferredSource: 'qq' })).resolves.toBeNull();
    });
});
