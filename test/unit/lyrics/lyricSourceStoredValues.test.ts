// @builtin-sources
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n/config';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { autoMatchBestLyric } from '@/utils/lyrics/autoMatchBestLyric';
import { fetchLyricsForMatchSource } from '@/utils/lyrics/lyricMatchSources';
import { getLyricProviderLabel } from '@/utils/lyrics/lyricSourceLabels';
import { fetchAmllDbLyrics } from '@/utils/lyrics/providers/amllDbProvider';

// test/unit/lyrics/lyricSourceStoredValues.test.ts
// Pins what is stored about lyric sources: the preferred-source setting (its key and its values)
// and the source name, song id and AMLL DB platform kept with a song's lyric choice. A source's
// name is stored as text, so none of the five may ever read as another or stop being known.
// The other ids a match hands over are pinned in autoMatchBestLyric.test.ts.

vi.mock('@/utils/lyrics/providers/amllDbProvider', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/utils/lyrics/providers/amllDbProvider')>(),
    fetchAmllDbLyrics: vi.fn(),
}));

const STORED_NAMES = ['netease', 'amll', 'qq', 'kugou', 'spotify'] as const;
// Each one's name. NetEase's, KuGou's and QQ's are their source mods' own (sources/<id>/locales, lyrics@1.crossSource.name); Spotify's is
// its source mod's short name (sources/spotify/locales, name.short).
const LABEL_KEYS: Record<typeof STORED_NAMES[number], string> = {
    netease: 'folium-mod/netease:name.lyrics',
    amll: 'lyricProvider.amll',
    qq: 'folium-mod/qq:name.lyrics',
    kugou: 'folium-mod/kugou:name.lyrics',
    spotify: 'folium-mod/spotify:name.short',
};
const SETTING_KEY = 'preferred_alternative_lyric_source_v2';
const LEGACY_SETTING_KEY = 'preferred_alternative_lyric_source';

const lyrics = (isWordByWord: boolean, isChorus = false) => ({
    lines: [{ fullText: 'Test lyric', startTime: 0, endTime: 1, words: [], isChorus }],
    isWordByWord,
});

describe('the source name stored with a song\'s lyric choice', () => {
    it.each(STORED_NAMES)('reads "%s" as that source\'s own name', (name) => {
        expect(getLyricProviderLabel(name)).toBe(i18n.t(LABEL_KEYS[name]));
    });

    it('keeps the five names apart', () => {
        expect(new Set(STORED_NAMES.map(name => getLyricProviderLabel(name))).size).toBe(STORED_NAMES.length);
    });

    it('reads a choice stored without a name as NetEase\'s', () => {
        expect(getLyricProviderLabel(undefined)).toBe(i18n.t('folium-mod/netease:name.lyrics'));
    });

    it('reads the AMLL DB platform stored beside the name', () => {
        expect(getLyricProviderLabel('amll', 'ncm')).toBe(`${i18n.t('lyricProvider.amll')} · ${i18n.t('folium-mod/netease:name.lyrics')}`);
        expect(getLyricProviderLabel('amll', 'qq')).toBe(`${i18n.t('lyricProvider.amll')} · ${i18n.t('folium-mod/qq:name.lyrics')}`);
    });
});

describe('what a lyric match hands over to be stored', () => {
    const song = { name: 'Song Title', durationMs: 200000, artists: [{ id: 1, name: 'Artist Name' }], album: { id: 0, name: '' } };

    beforeEach(() => {
        vi.resetAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // A KuGou song's id is its hash, and a local song keeps this id with the verdict. The two are
    // told apart here, which they never are in the app, to pin that the id is the one handed over.
    it('names KuGou and the song\'s id when KuGou says the song is pure music', async () => {
        const kugou = getOnlineMusicProvider('kugou')!;
        const kugouSong = { ...song, id: 'SONGID1', kgHash: 'HASH123', sourceRef: { kind: 'online' as const, providerId: 'kugou', mediaId: 'SONGID1' } };
        vi.spyOn(kugou.search!, 'searchSongs').mockResolvedValue({ items: [kugouSong], hasMore: false, nextOffset: 1 });
        vi.spyOn(kugou.lyrics!, 'getLyrics').mockResolvedValue({ lyrics: null, isPureMusic: true });

        expect(await autoMatchBestLyric('Song Title', 'Artist Name', 200000, { preferredSource: 'kugou' }))
            .toEqual({ isPureMusic: true, source: 'kugou', id: 'SONGID1' });
    });

    it('gives the AMLL DB platform of a lyric picked by hand, and none for any other source', async () => {
        vi.mocked(fetchAmllDbLyrics).mockResolvedValue(lyrics(true, true));
        vi.spyOn(getOnlineMusicProvider('qq')!.lyrics!, 'getLyrics').mockResolvedValue({ lyrics: lyrics(true), isPureMusic: false });

        expect(await fetchLyricsForMatchSource('amll', { ...song, id: 101, amllDbPlatform: 'ncm' }))
            .toMatchObject({ isPureMusic: false, matchedLyricsProviderPlatform: 'ncm' });
        expect(await fetchLyricsForMatchSource('amll', { ...song, id: 202, qqMid: 'mid', amllDbPlatform: 'qq' }))
            .toMatchObject({ isPureMusic: false, matchedLyricsProviderPlatform: 'qq' });
        const fromQq = await fetchLyricsForMatchSource('qq', { ...song, id: 'mid', qqMid: 'mid', sourceRef: { kind: 'online' as const, providerId: 'qq', mediaId: 'mid' } });
        expect(fromQq).toMatchObject({ isPureMusic: false });
        expect(fromQq?.matchedLyricsProviderPlatform).toBeUndefined();
    });
});

// Last: its vi.resetModules() loads i18n anew, which drops the source mods' texts the setup gave it (KuGou's and QQ's names).
describe('the preferred lyric source setting', () => {
    let values: Map<string, string>;

    const loadStore = async () => (await import('@/stores/useLyricSettingsStore')).useLyricSettingsStore;

    beforeEach(() => {
        values = new Map();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        };
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it.each(STORED_NAMES)('reads the stored text "%s" as that source and leaves it as it is', async (name) => {
        values.set(SETTING_KEY, name);

        expect((await loadStore()).getState().preferredAlternativeLyricSource).toBe(name);
        expect(values.get(SETTING_KEY)).toBe(name);
    });

    it.each(STORED_NAMES)('stores the source "%s" as that text', async (name) => {
        (await loadStore()).getState().handleSetPreferredAlternativeLyricSource(name);

        expect(values.get(SETTING_KEY)).toBe(name);
    });

    // Folium 2.0 方案 §7、§7.1：歌词来源表是开放的登记表，存着的选择不改写。没有注册的来源（音源没启用、模组还没加载）
    // 按缺失条目处理：值留着，匹配时用下一个能用的来源，它回来后自动用回它。只有根本不像来源 id 的值才换成默认。
    it('reads nothing stored as QQ and stores that; keeps a text that names no registered source as it is', async () => {
        expect((await loadStore()).getState().preferredAlternativeLyricSource).toBe('qq');
        expect(values.get(SETTING_KEY)).toBe('qq');

        values.set(SETTING_KEY, 'no-such-source');
        vi.resetModules();
        expect((await loadStore()).getState().preferredAlternativeLyricSource).toBe('no-such-source');
        expect(values.get(SETTING_KEY)).toBe('no-such-source');

        values.set(SETTING_KEY, '');
        vi.resetModules();
        expect((await loadStore()).getState().preferredAlternativeLyricSource).toBe('qq');
    });

    it('takes the older key over only while the newer one holds nothing', async () => {
        values.set(LEGACY_SETTING_KEY, 'kugou');
        expect((await loadStore()).getState().preferredAlternativeLyricSource).toBe('kugou');
        expect(values.get(SETTING_KEY)).toBe('kugou');
        expect(values.get(LEGACY_SETTING_KEY)).toBe('kugou');

        values.set(SETTING_KEY, 'netease');
        vi.resetModules();
        expect((await loadStore()).getState().preferredAlternativeLyricSource).toBe('netease');
    });
});
