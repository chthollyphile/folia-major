// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
            key: (index: number) => Array.from(items.keys())[index] ?? null,
            get length() { return items.size; },
        },
    });
});

// A source's lyrics parse in the lyrics worker; run the same parser inline.
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

import type { ModRuntimeInfo } from '@/mods/types';
import type { FoliumClientApi, FoliumClientModule } from '@/mods/folium/contract';
import type { UnifiedSong } from '@/types';
import type { OmniCollection } from '@/types/onlineMusic';
import { createFoliumClientApi } from '@/mods/folium/api';
import { createFoliumPageStore, getFoliumSourceCapability, registerFoliumSource, sourcesRegistry } from '@/mods/folium/registries/sources';
import { markFoliumSourceMod } from '@/mods/runtime/guard';
import { omni } from '@/services/onlineMusic/omni';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { participants } from '@/services/onlineMusic/crossSource';
import { canSourceMatchOnly } from '@/services/onlineMusic/sourceStates';
import { getLyricSource } from '@/utils/lyrics/lyricSources';
import { getLyricSourceAccess } from '@/utils/lyrics/lyricMatchSources';
import { getCoverIdentity, getOriginalCoverUrl, getSizedCoverUrl } from '@/utils/coverUrl';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import i18n from '@/i18n/config';
import { clientApiOptions } from './clientApiOptions';
import { checkFoliumMod } from '../../../dev/folium/check.mjs';
import path from 'node:path';

// test/unit/mod-system/foliumSampleSourceFull.test.ts
// The gate of Folium 2.0 S3 (plan §10): dev/folium/sample-source-full, a source that implements every family of
// standard capabilities, registers through folium.sources.register with no change to the host, and omni then
// searches it, looks its songs up, gets their audio, plays its other source's songs in an external player,
// reads lyrics, signs in, reads the library, the catalog, the recommendations and the explore page, changes a
// playlist, sizes its covers and calls its raw endpoints: one case per family, all through omni and the host's
// own readers, never through the mod's objects.

const MOD_ID = 'sample-source-full';
const SOURCE = 'folium.sample-source-full.fixture';
const EXTERNAL = 'folium.sample-source-full.fixture-external';

const mod: ModRuntimeInfo = {
    id: MOD_ID, name: '契约测试音源（样例）', version: '1.0.0', author: null, description: null, permissions: [],
    status: 'loaded', error: null, enabled: true, trustStale: false,
    signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false, experimental: [], embedOrigins: [], folia: null, hasMain: true, clientUrl: null,
    folium: 2, tier: 'repo', kind: 'source', contexts: null, locales: 'locales',
    sources: [
        { id: SOURCE, localId: 'fixture', name: 'fixture', state: 'enabled', keepForMatching: false, takeover: false, requires: [] },
        { id: EXTERNAL, localId: 'fixture-external', name: 'fixture-external', state: 'enabled', keepForMatching: false, takeover: false, requires: [] },
    ],
};

let api: FoliumClientApi;
let dispose: (() => void) | void;

const first = async (query: string, providerId = SOURCE): Promise<UnifiedSong> => {
    const page = await omni.searchProviderSongs(providerId, query, { limit: 10, offset: 0 });
    expect(page.items.length).toBeGreaterThan(0);
    return page.items[0];
};

beforeAll(async () => {
    // The mod's locale files, as the client loader would load them (runtime/modLocales.ts).
    const fs = await import('node:fs');
    for (const language of ['zh-CN', 'en']) {
        const file = path.resolve(__dirname, '../../../dev/folium/sample-source-full/locales', `${language}.json`);
        i18n.addResourceBundle(language, `folium-mod/${MOD_ID}`, JSON.parse(fs.readFileSync(file, 'utf8')), true, true);
    }
    markFoliumSourceMod(MOD_ID, true);
    const stopped = () => false;
    api = createFoliumClientApi(mod, clientApiOptions('main', {
        sources: { register: (def) => registerFoliumSource({ mod, stopped }, def), capability: getFoliumSourceCapability, pageStore: createFoliumPageStore },
    }));
    const module = await import('../../../dev/folium/sample-source-full/client.mjs') as unknown as FoliumClientModule;
    dispose = await module.default(api) as (() => void) | void;
});

afterAll(() => {
    if (typeof dispose === 'function') dispose();
    sourcesRegistry.unregisterAll(MOD_ID);
    markFoliumSourceMod(MOD_ID, false);
});

describe('sample-source-full through omni', () => {
    it('passes folium:check', () => {
        const result = checkFoliumMod(path.resolve(__dirname, '../../../dev/folium/sample-source-full'));
        expect(result.problems).toEqual([]);
        expect(result.ok).toBe(true);
    });

    it('registers both sources, with names from its own locale files and flags from its capabilities', () => {
        expect(api.host.folium).toEqual({ major: 2, minor: 0 });
        const summary = omni.getProviderSummaries().find((entry) => entry.providerId === SOURCE);
        expect(summary).toBeDefined();
        expect(i18n.t(summary!.shortNameKey!, { lng: 'zh-CN' })).toBe('契约测试');
        expect(i18n.t(summary!.shortNameKey!, { lng: 'en' })).toBe('Fixture');
        expect(omni.getProviderMark(SOURCE)).toEqual({ letter: '契', color: '#6b7cff' });
        expect(omni.getProviderCapabilities(SOURCE)).toMatchObject({
            search: true, playback: true, lyrics: true, auth: true, userLibrary: true, playlists: true, albums: true, artists: true,
            recommendations: true, mutations: true, personalFmModes: false, likes: true, playlistTrackMutations: true,
            userAlbums: true, playbackReports: true, explore: true, externalPlayback: false, songDetail: true,
            historyRecommendations: false, dailyStyleRecommendations: false, recommendationPreferences: false, playlistSubscription: false,
        });
        expect(omni.getProviderCapabilities(EXTERNAL)).toMatchObject({ search: true, playback: false, externalPlayback: true, songDetail: true, auth: false });
    });

    it('search@1: songs, albums and playlists', async () => {
        const song = await first('城市灯火');
        expect(song).toMatchObject({
            id: 's-3', name: '城市灯火', durationMs: 6000,
            artists: [{ id: 'ar-1', name: '晨雾乐队', catalogRef: { providerId: SOURCE, kind: 'artist', id: 'ar-1' } }],
            album: { id: 'al-1', name: '雾中的城', catalogRef: { providerId: SOURCE, kind: 'album', id: 'al-1' } },
            sourceRef: { kind: 'online', providerId: SOURCE, mediaId: 's-3' },
        });
        expect(omni.getProviderSearchKinds(SOURCE)).toEqual(['song', 'album', 'playlist']);
        const albums = await omni.searchProviderCollections(SOURCE, 'album', 'Paper', { limit: 5, offset: 0 });
        expect(albums.items.map((item) => item.id)).toEqual(['al-2']);
    });

    it('songs@1: by id, many at once, availability, replacement and page', async () => {
        expect((await omni.getSongDetail(SOURCE, 's-4'))?.name).toBe('Paper Lanterns');
        const details = await omni.getSongDetails(SOURCE, ['s-1', 'nope', 's-7']);
        expect(details.map((detail) => detail.status)).toEqual(['found', 'missing', 'found']);
        const restricted = (await omni.getSongDetail(SOURCE, 's-9'))!;
        expect(omni.getSongAvailability(restricted)).toEqual({ state: 'unknown', reason: 'restricted' });
        expect(omni.getSongAvailability(restricted)).toBe(omni.getSongAvailability(restricted));
        expect((await omni.getSongReplacement(restricted))?.song.id).toBe('s-8');
        expect(omni.getSongPageUrl(restricted)).toBe('https://sample-source.invalid/song/s-9');
    });

    it('playback.audio@1: an address at a level it lists', async () => {
        const song = await first('灯塔');
        expect(omni.getAudioQualityLevels(SOURCE)).toEqual(['standard', 'high']);
        const source = await omni.getAudioSource(song, 'hires');
        expect(source?.url).toMatch(/^data:audio\/wav;base64,/);
        expect(source?.quality).toBe('high');
        expect(i18n.t(omni.previewNoticeKey(SOURCE), { lng: 'en' })).toBe('A preview clip of the contract test source');
    });

    it('playback.external@1: play, follow the clock, pause, seek', async () => {
        const song = await first('城市灯火', EXTERNAL);
        expect(omni.canPlayExternally(song)).toBe(true);
        await omni.playSongExternally(song, 1);
        const status = await omni.getExternalPlaybackStatus(song);
        expect(status).toMatchObject({ mediaId: 's-3', isPlaying: true, durationMs: 6000, ended: false });
        expect(omni.isExternalPlaybackStatusForSong(song, status)).toBe(true);
        await omni.pauseExternalPlayback(song);
        expect((await omni.getExternalPlaybackStatus(song)).isPlaying).toBe(false);
        await omni.seekExternalPlayback(song, 5.5);
        expect((await omni.getExternalPlaybackStatus(song)).positionMs).toBe(5500);
    });

    it('reports@1: a finished play reaches the source', async () => {
        const song = await first('回声');
        expect(omni.canReportPlayback(song)).toBe(true);
        await omni.reportPlayback(song, { playedSeconds: 5, totalSeconds: 6 });
        const stats = api.omni.capability(SOURCE, 'x.sample-source-full.stats@1') as { reportCount(): number };
        expect(stats.reportCount()).toBe(1);
        expect(api.omni.capability(SOURCE, 'x.other.stats@1')).toBeNull();
    });

    it('lyrics@1: tracks parsed by the host, word-by-word shown, chorus from the source', async () => {
        const song = await first('潮汐');
        const result = await omni.getLyrics(song);
        expect(result.lyrics?.isWordByWord).toBe(true);
        expect(result.lyrics?.lines.map((line) => line.fullText)).toEqual(['潮汐', '北岸 · 潮汐表', '契约测试的第三行', '最后一行']);
        expect(result.lyrics?.lines[0].translation).toBe('(1) 潮汐');
        expect(result.mainText).toContain('[00:00.00]潮汐');
        expect(result.wordByWordText).toContain('(0,');
        expect(result.lyrics?.lines.filter((line) => line.isChorus).map((line) => line.fullText)).toEqual(['契约测试的第三行']);
        expect(await omni.getChorusRanges(song)).toEqual([{ startTime: 3, endTime: 4.5 }]);
        expect(await omni.getLyricSearchAlias(song)).toMatchObject({ title: '潮汐 (sample)', artist: '北岸' });
        expect(await omni.getAlternateArtistName(await first('Slow River'))).toBe('Lumen 三重奏');
    });

    it('lyrics@1.crossSource and songs@1.metadataMatch: a lyric source and a metadata source of their own', async () => {
        expect(getLyricSource(SOURCE)).toMatchObject({ id: SOURCE, platform: true, localMetadataIdentity: true });
        expect(participants('lyrics').ready).toContain(SOURCE);
        expect(participants('metadata').ready).toContain(SOURCE);
        expect(participants('search').ready).toContain(SOURCE);
        expect(canSourceMatchOnly(SOURCE)).toBe(true);
        expect(canSourceMatchOnly(EXTERNAL)).toBe(false);
        const found = await getLyricSourceAccess(SOURCE).search('Night Market', 5, { title: 'Night Market', artist: 'Lumen Trio', durationMs: 6000 });
        expect(found.map((song) => song.id)).toEqual(['s-6']);
    });

    it('auth@1: a sign-in by code, the account, and signing out', async () => {
        expect(i18n.t(omni.getLoginTexts(SOURCE)!.title, { lng: 'zh-CN' })).toBe('登录契约测试音源');
        const { key, imageUrl } = await omni.startLogin(SOURCE);
        expect(imageUrl).toMatch(/^data:image\/svg\+xml,/);
        expect(omni.getLoginTtlMs(SOURCE)).toBe(120000);
        expect((await omni.checkLogin(SOURCE, key)).state).toBe('waiting');
        expect((await omni.checkLogin(SOURCE, key)).state).toBe('scanned');
        expect((await omni.checkLogin(SOURCE, key)).state).toBe('confirmed');
        expect(await getOnlineMusicProvider(SOURCE)!.auth!.getLoginStatus()).toEqual({ id: 'fixture-user', nickname: 'Fixture Listener' });
        const diagnostics = await omni.getLoginDiagnostics(SOURCE);
        expect(diagnostics.map((line) => line.text)).toEqual(['fixture.catalog: 9']);
        await omni.signOutAccount(SOURCE);
        expect(await getOnlineMusicProvider(SOURCE)!.auth!.getLoginStatus()).toBeNull();
    });

    it('library@1, catalog@1, recommendations@1, explore@1 and mutations@1, as the active source', async () => {
        // Signed in again for the account's own lists.
        const { key } = await omni.startLogin(SOURCE);
        for (let check = 0; check < 3; check += 1) await omni.checkLogin(SOURCE, key);
        useOnlineProviderAccountStore.getState().setActiveProviderId(SOURCE);
        expect(useOnlineProviderAccountStore.getState().activeProviderId).toBe(SOURCE);

        const playlists = await omni.getUserPlaylists('fixture-user', { limit: 10, offset: 0 });
        expect(playlists.items.map((item) => [item.id, item.isOwned])).toEqual([['pl-1', true]]);
        const own = playlists.items[0] as OmniCollection;
        expect((await omni.getUserAlbums('fixture-user', { limit: 10, offset: 0 })).items.map((item) => item.id)).toEqual(['al-1']);

        // catalog@1
        const tracks = await omni.getCollectionTracks(own, { limit: 10, offset: 0 });
        expect(tracks.items.map((song) => song.id)).toEqual(['s-1', 's-4', 's-7']);
        const album = (await omni.getAlbumDetail({ providerId: SOURCE, id: 'al-2', name: '', type: 'album' }))!;
        expect(album).toMatchObject({ name: 'Paper Lanterns', trackCount: 3, artists: [{ id: 'ar-2', name: 'Lumen Trio' }] });
        const artist = (await omni.getArtistDetail({ providerId: SOURCE, id: 'ar-3', name: '', type: 'artist' }))!;
        expect(artist).toMatchObject({ name: '北岸', albumCount: 1 });
        expect((await omni.getArtistSongs(artist, { limit: 10, offset: 0 })).items.map((song) => song.id)).toEqual(['s-7', 's-8', 's-9']);
        expect((await omni.getArtistAlbums(artist, { limit: 10, offset: 0 })).items.map((item) => item.id)).toEqual(['al-3']);

        // recommendations@1
        expect((await omni.getDailySongs()).map((song) => song.id)).toEqual(['s-3', 's-6', 's-9']);
        expect((await omni.getPersonalFm()).map((song) => song.id)).toEqual(['s-2', 's-5']);
        const home = await omni.getHomeFeed(5);
        expect(home.recommendedCollections.map((item) => item.id)).toEqual(['pl-1', 'pl-2']);
        expect(home.dailySongs.map((item) => item.id)).toEqual(['s-3', 's-6', 's-9']);

        // explore@1
        expect(omni.supportsExplore(SOURCE)).toBe(true);
        const feed = await omni.getExploreFeed();
        expect(feed.sections.map((section) => section.id)).toEqual(['new-albums', 'songs']);
        expect(feed.sections[1].items[0]).toMatchObject({ kind: 'song', song: { id: 's-1' } });
        expect((await omni.getExploreSectionItems('songs-more')).items.map((item) => item.kind === 'song' && item.song.id)).toEqual(['s-2', 's-6']);

        // mutations@1
        const song = (await omni.getSongDetail(SOURCE, 's-6'))!;
        expect(omni.canAddSongToPlaylist(song)).toBe(true);
        await omni.addSongsToPlaylist([song], own);
        expect((await omni.getCollectionTracks(own, { limit: 10, offset: 0 })).items.map((item) => item.id)).toEqual(['s-1', 's-4', 's-7', 's-6']);
        await omni.updateCollectionTracks(own, 'del', [song]);
        expect((await omni.getCollectionTracks(own, { limit: 10, offset: 0 })).items.map((item) => item.id)).toEqual(['s-1', 's-4', 's-7']);
        await omni.likeSong(song, true);
        expect((await omni.getProviderLikedSongIds(SOURCE, 'fixture-user')).ids).toEqual(['s-6']);
        await omni.createPlaylistWithSongs([song], '新歌单');
        expect((await omni.getUserPlaylists('fixture-user', { limit: 10, offset: 0 })).items.map((item) => item.name)).toEqual(['契约测试歌单', '新歌单']);
    });

    it('covers@1: its picture host is sized, named and taken back to the original by its rule', () => {
        const url = 'https://covers.sample-source.invalid/al-1.png?size=300';
        expect(getSizedCoverUrl(url, 640)).toBe('https://covers.sample-source.invalid/al-1.png?size=640');
        expect(getCoverIdentity(url)).toBe('sample-source:/al-1.png');
        expect(getCoverIdentity('https://covers.sample-source.invalid/al-1.png?size=1200')).toBe('sample-source:/al-1.png');
        expect(getOriginalCoverUrl(url)).toBe('https://covers.sample-source.invalid/al-1.png');
        // Other hosts are not its to answer: NetEase's rule still stands.
        expect(getSizedCoverUrl('https://p1.music.126.net/a.jpg', 100)).toBe('https://p1.music.126.net/a.jpg?param=100y100');
    });

    it('raw@1: its endpoint table and requests, as platform.raw reaches them', async () => {
        expect(omni.getRawRequestInfo(SOURCE)).toEqual({ backend: { name: 'sample-source-full', version: '1.0.0' }, reservedParams: ['session'] });
        expect(omni.describeRawEndpoint(SOURCE, 'echo')).toEqual({ access: 'read' });
        expect(omni.describeRawEndpoint(SOURCE, 'nope')).toBeNull();
        const answer = await omni.requestProviderRaw(SOURCE, 'echo', { q: 1 }, new AbortController().signal);
        expect(answer).toMatchObject({ endpoint: 'echo', params: { q: 1 }, catalog: 9 });
    });

    it('goes when the mod stops: providers, lyric source, cover rule and declarations', () => {
        sourcesRegistry.unregisterAll(MOD_ID);
        expect(getOnlineMusicProvider(SOURCE)).toBeNull();
        expect(getOnlineMusicProvider(EXTERNAL)).toBeNull();
        expect(getLyricSource(SOURCE)).toBeUndefined();
        expect(participants('metadata').ready).not.toContain(SOURCE);
        expect(getSizedCoverUrl('https://covers.sample-source.invalid/al-1.png?size=300', 640)).toBe('https://covers.sample-source.invalid/al-1.png?size=300');
        expect(api.omni.capability(SOURCE, 'x.sample-source-full.stats@1')).toBeNull();
    });
});
