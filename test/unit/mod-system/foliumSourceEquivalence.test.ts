// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

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

// Both paths parse in the lyrics worker; run the same parser inline for both.
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
import type { FoliumSourceDef } from '@/mods/folium/sources/contract';
import { OnlineProviderError, type ProviderLyricsResult } from '@/types/onlineMusic';
import { registerFoliumSource, sourcesRegistry } from '@/mods/folium/registries/sources';
import { toHostCollection, toHostSong, toSourceSong } from '@/mods/folium/registries/sourceDtos';
import { createFoliumSourceError } from '@/mods/folium/sources/errors';
import { resolveFoliumSourceLyricsResult } from '@/mods/folium/lyricsSource';
import { markFoliumSourceMod } from '@/mods/runtime/guard';
import { omni } from '@/services/onlineMusic/omni';
import { onlineFailureOf } from '@/services/onlineMusic/failure/onlineFailureCase';
import { normalizeQishuiCollection, normalizeQishuiSong } from '@/services/onlineMusic/qishui/qishuiNormalize';
import { parseQishuiLyrics } from '@/services/onlineMusic/qishui/qishuiLyrics';
import { processNeteaseLyrics } from '@/utils/lyrics/neteaseProcessing';
import { resolveProviderLyricsChorus } from '@/utils/lyrics/chorusResolver';
import { parseAwlrc, parseLyricsByFormat } from '@/utils/lyrics/parserCore';
import { applyDetectedChorusEffects } from '@/utils/lyrics/chorusEffects';
import { isPureMusicLyricText } from '@/utils/lyrics/pureMusic';
import { buildFoliaLyricDocument, parseFoliaLyricDocument, serializeFoliaLyricDocument } from '@/utils/lyrics/foliaLyricDocument';

// test/unit/mod-system/foliumSourceEquivalence.test.ts
// Gate 5 of Folium 2.0 S3 (plan §11, "契约等价"): for one operation, a source made by the adapter and a built-in
// provider give the same shape of identity, result and error. The lyrics are held to it with platform answers
// as the built-in providers get them (recorded payload shapes): the built-in path's LyricData against the one
// the new path parses from the same text handed over as a source's tracks.

// The built-in Bodian provider's lyric step as it was before Bodian became a source mod (src/utils/lyrics/bodianLyrics.ts
// until Folium 2.0 S5): the old path the source's tracks are held to.
const parseBodianLyrics = ({ mainText, wordByWordText }: { mainText: string; wordByWordText: string | null }): ProviderLyricsResult => {
    const wordLyrics = wordByWordText ? parseAwlrc(wordByWordText) : null;
    const lyrics = wordLyrics?.lines.length ? wordLyrics : parseLyricsByFormat('lrc', mainText);
    return {
        lyrics: lyrics.lines.length ? lyrics : null,
        mainText, wordByWordText: wordLyrics?.lines.length ? wordByWordText : undefined,
        isPureMusic: isPureMusicLyricText(mainText),
    };
};

const MOD_ID = 'equiv-mod';
const mod: ModRuntimeInfo = {
    id: MOD_ID, name: 'E', version: '1.0.0', author: null, description: null, permissions: [], status: 'loaded', error: null,
    enabled: true, trustStale: false, signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false, experimental: [], embedOrigins: [], folia: null, hasMain: false, clientUrl: null,
    folium: 2, kind: 'source', sources: [{ id: 'folium.equiv-mod.src', localId: 'src', name: 'src', state: 'enabled', keepForMatching: false, takeover: false, requires: [] }],
};
const register = (def: Omit<FoliumSourceDef, 'id' | 'displayName'>) => registerFoliumSource({ mod, stopped: () => false }, { id: 'src', displayName: 'Equivalence', ...def });

afterEach(() => {
    sourcesRegistry.unregisterAll(MOD_ID);
    markFoliumSourceMod(MOD_ID, false);
});

// A Qishui track as its car API answers it (the shape normalizeQishuiSong reads).
const QISHUI_TRACK = {
    base_info: { id: '7234567890123456789', name: '晚风', duration_ms: 213000 },
    related_info: {
        album_link: { id: '7111', name: '晚风集' },
        artist_links: [{ id: '501', name: '甲' }, { id: '', name: '乙' }],
    },
    display_info: { cover_url: { urls: ['https://p3.qishui.example/'], uri: 'cover/7111', template_prefix: 'tpl' } },
};

describe('identity: a source song has the shape of a built-in one', () => {
    it('as Qishui normalizes its track, from the same answer handed over as a DTO', () => {
        const builtIn = normalizeQishuiSong(QISHUI_TRACK);
        const fromSource = toHostSong('qishui', {
            id: '7234567890123456789',
            title: '晚风',
            durationMs: 213000,
            artists: [{ id: '501', name: '甲' }, { id: '', name: '乙' }],
            album: { id: '7111', name: '晚风集', coverUrl: builtIn.album.coverUrl, ref: false },
        });
        expect(fromSource).toEqual(builtIn);
        // And back: what the source reads of it is what it gave.
        expect(toSourceSong(builtIn)).toMatchObject({ id: '7234567890123456789', title: '晚风', album: { id: '7111', ref: false } });
    });

    it('as Qishui normalizes a playlist', () => {
        const raw = {
            base_info: { id: 'pl9', title: '夜行', desc: '一张歌单', owner_id: 'u1' },
            display_info: { url_cover: 'https://p3.qishui.example/pl9.jpg' },
            resource_cnt: { track_cnt: 12 },
            relation_info: { owner: { id: 'u1', nickname: '我' } },
            isOwned: true,
        };
        const fromSource = toHostCollection('qishui', {
            id: 'pl9', type: 'playlist', name: '夜行', coverUrl: 'https://p3.qishui.example/pl9.jpg', description: '一张歌单',
            trackCount: 12, creator: { id: 'u1', nickname: '我' }, isOwned: true, data: { ownerId: 'u1' },
        });
        expect(fromSource).toEqual(normalizeQishuiCollection(raw));
    });

    it('keeps old top-level platform fields and other sources\' ids on the way to the source and back', () => {
        const old = {
            ...toHostSong('netease', { id: '1', title: 'x', artists: [{ id: '2', name: 'y' }] }),
            fee: 8, privilege: { st: 0 }, qqMid: 'qqmid1', kgHash: 'hash1',
        };
        expect(toSourceSong(old)).toMatchObject({ data: { fee: 8, privilege: { st: 0 } }, lyricIds: { qq: 'qqmid1', kugou: 'hash1' } });
        const back = toHostSong('qq', { id: 'm1', title: 'x', artists: [], lyricIds: { qq: 'm1', kugou: 'h1', other: 'o1' } });
        expect(back).toMatchObject({ qqMid: 'm1', kgHash: 'h1', sourceRef: { providerData: { '@lyricIds': { qq: 'm1', kugou: 'h1', other: 'o1' } } } });
        expect(toSourceSong(back).lyricIds).toEqual({ qq: 'm1', kugou: 'h1', other: 'o1' });
        expect(toSourceSong(back).data).toBeUndefined();
    });
});

describe('results: pages and songs through omni', () => {
    it('a search page has the keys a built-in page has', async () => {
        markFoliumSourceMod(MOD_ID, true);
        register({
            capabilities: {
                'search@1': { searchSongs: async () => ({ items: [{ id: 'a', title: 'A', artists: [] }, { title: 'no id' } as never], total: 7, hasMore: true }) },
            },
        });
        const page = await omni.searchProviderSongs('folium.equiv-mod.src', 'q', { limit: 2, offset: 4 });
        expect(Object.keys(page).sort()).toEqual(['hasMore', 'items', 'nextOffset', 'total']);
        expect(page).toMatchObject({ total: 7, hasMore: true, nextOffset: 6 });
        expect(page.items.map((song) => song.id)).toEqual(['a']);
    });
});

describe('errors: a source error reads as a built-in provider\'s', () => {
    it('is the host\'s OnlineProviderError of that source, and is sorted into the same case', async () => {
        markFoliumSourceMod(MOD_ID, true);
        register({
            capabilities: {
                'songs@1': { getSong: async () => null },
                'playback.audio@1': {
                    getAudioSource: async () => {
                        throw createFoliumSourceError('subscription-required', 'paying accounts only', { httpStatus: 402, retryAfterMs: 5 });
                    },
                },
            },
        });
        const song = toHostSong('folium.equiv-mod.src', { id: 'a', title: 'A', artists: [] });
        const failure = await omni.getAudioSource(song, 'high').catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(OnlineProviderError);
        expect(failure).toMatchObject({ code: 'subscription-required', providerId: 'folium.equiv-mod.src', httpStatus: 402, retryAfterMs: 5 });
        const builtIn = new OnlineProviderError('subscription-required', 'paying accounts only', 'qishui', undefined, 402, 5);
        const asSource = onlineFailureOf({ operation: 'audio', providerId: 'folium.equiv-mod.src' }, { error: failure });
        const asBuiltIn = onlineFailureOf({ operation: 'audio', providerId: 'qishui' }, { error: builtIn });
        expect({ ...asSource, providerId: 'x' }).toEqual({ ...asBuiltIn, providerId: 'x' });
    });

    it('refuses a code the host does not have', () => {
        expect(() => createFoliumSourceError('teapot' as never, 'no')).toThrow(/code must be one of/);
    });
});

/* The new path, then the host's chorus step, as omni.getLyrics runs them. */
const throughHost = async (tracks: unknown, providerId: string): Promise<ProviderLyricsResult> => (
    (await resolveProviderLyricsChorus(await resolveFoliumSourceLyricsResult(tracks, providerId), { providerId, songId: 1 })).result
);
const builtInThroughHost = async (result: ProviderLyricsResult, providerId: string): Promise<ProviderLyricsResult> => (
    (await resolveProviderLyricsChorus(result, { providerId, songId: 1 })).result
);

describe('lyrics: the built-in path and the new path parse the same answer to the same lyrics', () => {
    it('NetEase: LRC with translation and romanization, and YRC with its own translation', async () => {
        const answer = {
            type: 'netease' as const,
            lrc: { lyric: '[00:01.00]第一句\n[00:03.50]第二句\n[00:06.00]第三句' },
            tlyric: { lyric: '[00:01.00]one\n[00:03.50]two\n[00:06.00]three' },
            romalrc: { lyric: '[00:01.00]di yi ju\n[00:03.50]di er ju\n[00:06.00]di san ju' },
            yrc: { lyric: '[1000,2500](1000,800,0)第(1800,800,0)一(2600,900,0)句\n[3500,2500](3500,1200,0)第二(4700,1300,0)句\n[6000,2000](6000,2000,0)第三句' },
            ytlrc: { lyric: '[00:01.00]ONE\n[00:03.50]TWO\n[00:06.00]THREE' },
        };
        const processed = await processNeteaseLyrics(answer);
        const builtIn = await builtInThroughHost({
            lyrics: processed.lyrics, mainText: processed.mainLrc, wordByWordText: processed.yrcLrc,
            translationText: processed.transLrc, romanizationText: processed.romanizationLrc, isPureMusic: processed.isPureMusic,
        }, 'netease');
        const fromSource = await throughHost({
            main: { format: 'lrc', text: answer.lrc.lyric, translationText: answer.tlyric.lyric, romanizationText: answer.romalrc.lyric },
            wordByWord: { format: 'yrc', text: answer.yrc.lyric, translationText: answer.ytlrc.lyric },
        }, 'netease');
        expect(fromSource.lyrics).toEqual(builtIn.lyrics);
        expect(fromSource.lyrics?.isWordByWord).toBe(true);
        expect(fromSource.lyrics?.lines[0].translation).toBe('ONE');
        expect([fromSource.mainText, fromSource.wordByWordText, fromSource.translationText])
            .toEqual([builtIn.mainText, builtIn.wordByWordText, builtIn.translationText]);
    });

    it('NetEase: an LRC-only answer', async () => {
        const answer = { type: 'netease' as const, lrc: { lyric: '[00:00.50]只有\n[00:02.00]逐行' }, tlyric: { lyric: '[00:00.50]only\n[00:02.00]lines' } };
        const processed = await processNeteaseLyrics(answer);
        const fromSource = await throughHost({ main: { format: 'lrc', text: answer.lrc.lyric, translationText: answer.tlyric.lyric } }, 'netease');
        const builtIn = await builtInThroughHost({ lyrics: processed.lyrics, mainText: processed.mainLrc, isPureMusic: false }, 'netease');
        expect(fromSource.lyrics).toEqual(builtIn.lyrics);
        expect(fromSource.lyrics?.isWordByWord).toBe(false);
    });

    it('Qishui: KRC with a KRC translation laid on by start time', async () => {
        const answer = {
            lyric_entity: { type: 'krc', content: '[1000,1000]<0,400,0>你<400,600,0>好\n[2500,1500]<0,700,0>再<700,800,0>见\u0000' },
            lang_translations: { 'zh-CN': { type: 'krc', content: '[1000,1000]<0,1000,0>Hello\n[2500,1500]<0,1500,0>Bye' } },
        };
        const builtIn = await builtInThroughHost(parseQishuiLyrics(answer), 'qishui');
        const content = answer.lyric_entity.content.replace(/\u0000/g, '');
        const fromSource = await throughHost({
            wordByWord: { format: 'krc', text: content, translationText: answer.lang_translations['zh-CN'].content, translationFormat: 'krc' },
        }, 'qishui');
        expect(fromSource.lyrics).toEqual(builtIn.lyrics);
        expect(fromSource.lyrics?.lines.map((line) => line.translation)).toEqual(['Hello', 'Bye']);
    });

    it('Bodian: a word-timed awlrc track with its line track, pure music marked from the text', async () => {
        const mainText = '[00:29.264]甲乙丙\n[00:32.000]丁戊';
        const wordByWordText = '[00:29.264]<0,390>甲<390,392>乙<782,448>丙\n[00:32.000]<0,500>丁<500,500>戊';
        const builtIn = await builtInThroughHost(parseBodianLyrics({ mainText, wordByWordText }), 'bodian');
        const fromSource = await throughHost({
            main: { format: 'lrc', text: mainText },
            wordByWord: { format: 'awlrc', text: wordByWordText },
            isPureMusic: isPureMusicLyricText(mainText),
        }, 'bodian');
        expect(fromSource.lyrics).toEqual(builtIn.lyrics);
        expect(fromSource.isPureMusic).toBe(builtIn.isPureMusic);
    });

    it('Bodian: pure music and lyrics together (plan §4.5, third rule)', async () => {
        const mainText = '[00:00.000]纯音乐，请欣赏';
        const builtIn = parseBodianLyrics({ mainText, wordByWordText: null });
        const fromSource = await resolveFoliumSourceLyricsResult({ main: { format: 'lrc', text: mainText }, isPureMusic: true }, 'bodian');
        expect(builtIn.isPureMusic).toBe(true);
        expect(fromSource.isPureMusic).toBe(true);
        expect(fromSource.lyrics?.lines.map((line) => line.fullText)).toEqual(builtIn.lyrics?.lines.map((line) => line.fullText));
    });

    it('QQ: QRC with translation; the host\'s chorus step marks the same lines QQ marks itself (plan §4.5, sixth rule)', async () => {
        const qrc = [
            '[0,2000]主(0,1000)歌(1000,1000)',
            '[2000,2000]副(2000,1000)歌(3000,1000)',
            '[4000,2000]第(4000,1000)二(5000,1000)',
            '[6000,2000]副(6000,1000)歌(7000,1000)',
            '[8000,2000]结(8000,1000)尾(9000,1000)',
            '[10000,2000]副(10000,1000)歌(11000,1000)',
        ].join('\n');
        const translation = '[00:00.00]verse\n[00:02.00]chorus\n[00:04.00]second\n[00:06.00]chorus\n[00:08.00]end\n[00:10.00]chorus';
        // QQ's built-in fetch (qqLyricProvider.fetchQQLyrics): parse, mark it word by word, find the chorus in the text.
        const parsed = parseLyricsByFormat('qrc', qrc, translation, {});
        parsed.isWordByWord = true;
        const builtIn = await builtInThroughHost({ lyrics: applyDetectedChorusEffects(parsed, qrc), isPureMusic: false }, 'qq');
        const fromSource = await throughHost({ wordByWord: { format: 'qrc', text: qrc, translationText: translation } }, 'qq');
        expect(fromSource.lyrics?.lines.map((line) => Boolean(line.isChorus))).toEqual([false, true, false, true, false, true]);
        expect(fromSource.lyrics?.lines.map((line) => Boolean(line.isChorus))).toEqual(builtIn.lyrics?.lines.map((line) => Boolean(line.isChorus)));
        // The effect of a chorus line is picked at random; everything else is the same.
        const withoutEffect = (lyrics: ProviderLyricsResult['lyrics']) => lyrics?.lines.map(({ chorusEffect: _effect, ...line }) => line);
        expect(withoutEffect(fromSource.lyrics)).toEqual(withoutEffect(builtIn.lyrics));
        expect(fromSource.lyrics?.isWordByWord).toBe(true);
    });

    it('fnmusic: a Folia lyric document', async () => {
        const source = parseLyricsByFormat('lrc', '[00:01.00]飞牛\n[00:02.00]文档');
        const text = serializeFoliaLyricDocument(buildFoliaLyricDocument(source));
        const builtIn = await builtInThroughHost({ lyrics: parseFoliaLyricDocument(text), mainText: text, isPureMusic: false }, 'fnmusic');
        const fromSource = await throughHost({ main: { format: 'folia', text } }, 'fnmusic');
        expect(fromSource.lyrics).toEqual(builtIn.lyrics);
    });
});
