import { describe, expect, it } from 'vitest';
import {
    createScriptLibrary, MAX_SCRIPT_BYTES, MAX_SCRIPTS, normalizeLxScript, parseLxHeader, sanitizeDeclaredSources, validateLxScript,
} from '../../../sources/lxmusic/main/scripts';
import type { LxImportError, LxScriptRecord } from '../../../sources/lxmusic/main/scripts';
import {
    CatalogError, collectionIdOf, createCatalog, normalizeCover, normalizeKuwoCover, parseCollectionId, parseLooseJson, parseSongId, songIdOf,
} from '../../../sources/lxmusic/main/catalog';
import { buildMusicInfo, pickLxQuality } from '../../../sources/lxmusic/main/musicInfo';

// test/unit/lxmusic/scriptsAndCatalog.test.ts
// 洛雪音源不联网的两块：脚本的静态处理与脚本库（scripts.ts），曲库的 id、归一化与各家的请求地址（catalog.ts，
// 请求换成假应答；应答的形状照 PR #1177 里实测记下的字段拼，证明的是归一化，不是真实接口）。

const SCRIPT = `/**
 * @name 测试源
 * @description 给单测用的
 * @version 1.2.3
 * @author someone
 * @homepage https://example.com
 */
const { EVENT_NAMES, on, send } = globalThis.lx;
on(EVENT_NAMES.request, () => 'http://example.com/a.mp3');
send(EVENT_NAMES.inited, { sources: {} });`;

describe('LX script files', () => {
    it('reads the header comment, and falls back to the file name', () => {
        expect(parseLxHeader(SCRIPT, 'file')).toEqual({
            name: '测试源', description: '给单测用的', version: '1.2.3', author: 'someone', homepage: 'https://example.com',
        });
        expect(parseLxHeader('const a = "@name not in a comment";', 'my-source')).toEqual({ name: 'my-source' });
        expect(parseLxHeader(`/* @name ${'长'.repeat(100)} */`, 'x').name).toHaveLength(48);
    });

    it('unwraps a script distributed as JSON', () => {
        expect(normalizeLxScript(JSON.stringify({ name: 'x', script: SCRIPT }))).toBe(SCRIPT);
        expect(normalizeLxScript(`\uFEFF  ${SCRIPT}  `)).toBe(SCRIPT);
        expect(normalizeLxScript('{ not json }')).toBe('{ not json }');
    });

    it('refuses what is plainly not a script, and one that is too large', () => {
        expect(() => validateLxScript(SCRIPT)).not.toThrow();
        expect(() => validateLxScript("const lx = globalThis['\\x6c\\x78']; lx['\\x73end']('inited', {});")).not.toThrow();
        const code = (work: () => void) => { try { work(); } catch (error) { return (error as LxImportError).code; } return null; };
        expect(code(() => validateLxScript('<!DOCTYPE html><html><body>globalThis request send</body></html>'))).toBe('not-a-script');
        expect(code(() => validateLxScript('short'))).toBe('not-a-script');
        expect(code(() => validateLxScript('console.log("nothing of the custom source interface in here at all");'))).toBe('not-a-script');
        expect(code(() => validateLxScript(`globalThis.lx;${' '.repeat(MAX_SCRIPT_BYTES)}`))).toBe('too-large');
    });

    it('keeps only the platforms, actions and qualities it knows from what a script declares', () => {
        expect(sanitizeDeclaredSources({
            kw: { name: 'kw', type: 'music', actions: ['musicUrl', 'lyric', 'evil'], qualitys: ['320k', '128k', '999k'] },
            tx: { actions: ['musicUrl'], qualitys: [] },
            kg: { actions: ['lyric'], qualitys: ['128k'] },
            wy: 'yes',
            mg: { actions: ['musicUrl'], qualitys: ['128k'] },
            __proto__: { actions: ['musicUrl'] },
        })).toEqual({
            kw: { actions: ['musicUrl', 'lyric'], qualities: ['128k', '320k'] },
            tx: { actions: ['musicUrl'], qualities: ['128k'] },
        });
        expect(sanitizeDeclaredSources(null)).toEqual({});
        expect(sanitizeDeclaredSources('kw')).toEqual({});
    });
});

const memoryStorage = () => {
    const data = new Map<string, unknown>();
    return {
        data,
        get: async <T>(key: string) => data.get(key) as T | undefined,
        set: async (key: string, value: unknown) => { data.set(key, JSON.parse(JSON.stringify(value))); },
        delete: async (key: string) => { data.delete(key); },
    };
};
const record = (id: string, sources: LxScriptRecord['sources']): LxScriptRecord => (
    { id, info: { name: `script ${id}` }, sources, importedAt: 1, fileName: `${id}.js` }
);
const KW = { actions: ['musicUrl' as const], qualities: ['128k' as const] };

describe('the script library', () => {
    it('starts empty: no script, no platform', async () => {
        expect(await createScriptLibrary(memoryStorage()).state()).toEqual({ scripts: [], active: null, platform: null, platforms: [] });
    });

    it('keeps scripts in the mod storage, the last imported one current, and survives a restart', async () => {
        const storage = memoryStorage();
        const library = createScriptLibrary(storage);
        await library.add(record('a', { kw: KW }), 'code a');
        await library.add(record('b', { tx: KW, wy: KW }), 'code b');
        expect((await library.state()).active?.id).toBe('b');
        expect((await library.state()).platform).toBe('tx');
        expect((await library.state()).platforms).toEqual(['tx', 'wy']);
        await library.setPlatform('wy');
        const again = createScriptLibrary(storage);
        expect(await again.state()).toMatchObject({ active: { id: 'b' }, platform: 'wy' });
        expect(await again.code('a')).toBe('code a');
        expect([...storage.data.keys()].sort()).toEqual(['activeScript', 'platform', 'script:a', 'script:b', 'scripts']);
    });

    it('falls back to a platform the current script serves, and to another script when the current one is removed', async () => {
        const library = createScriptLibrary(memoryStorage());
        await library.add(record('a', { kw: KW }), 'code a');
        await library.add(record('b', { tx: KW }), 'code b');
        await library.setPlatform('tx');
        expect(await library.select('a')).toBe(true);
        expect((await library.state()).platform).toBe('kw');
        expect(await library.select('missing')).toBe(false);
        expect(await library.remove('a')).toBe(true);
        expect(await library.state()).toMatchObject({ active: { id: 'b' }, platform: 'tx' });
        expect(await library.code('a')).toBeNull();
        expect(await library.remove('b')).toBe(true);
        expect(await library.state()).toEqual({ scripts: [], active: null, platform: null, platforms: [] });
    });

    it('holds a limited number of scripts', async () => {
        const library = createScriptLibrary(memoryStorage());
        for (let index = 0; index < MAX_SCRIPTS; index += 1) await library.add(record(`s${index}`, { kw: KW }), 'code');
        await expect(library.add(record('one-more', { kw: KW }), 'code')).rejects.toMatchObject({ code: 'too-many' });
    });
});

describe('what a script is handed', () => {
    it('picks the nearest quality the script serves: lower first, then higher', () => {
        expect(pickLxQuality('flac', ['128k', '320k', 'flac'])).toBe('flac');
        expect(pickLxQuality('flac24bit', ['128k', '320k'])).toBe('320k');
        expect(pickLxQuality('128k', ['320k', 'flac'])).toBe('320k');
        expect(pickLxQuality('320k', [])).toBeNull();
    });

    it('builds musicInfo with the fields LX scripts read', () => {
        const info = buildMusicInfo('tx', '003abc', {
            id: 'tx:003abc', title: '歌名', artists: [{ id: '', name: '甲' }, { id: '', name: '乙' }],
            album: { id: 'tx:a:9', name: '专辑', coverUrl: 'https://img.example/c.jpg' }, durationMs: 185_400,
            data: { platform: 'tx', albumId: '9', albumMid: '00xyz', mediaMid: '00media', songId: '12345' },
        });
        expect(info).toMatchObject({
            name: '歌名', singer: '甲、乙', source: 'tx', songmid: '003abc', songId: '12345', interval: '03:05', duration: 185,
            albumName: '专辑', albumId: '9', img: 'https://img.example/c.jpg', strMediaMid: '00media', albumMid: '00xyz',
        });
        expect(buildMusicInfo('kg', 'abcdef', { id: 'kg:abcdef', title: 't', artists: [] })).toMatchObject({ hash: 'abcdef', songmid: 'abcdef', interval: '00:00' });
    });
});

describe('catalog ids and normalizing', () => {
    it('writes and reads song and collection ids', () => {
        expect(parseSongId(songIdOf('kw', '123'))).toEqual({ platform: 'kw', nativeId: '123' });
        expect(parseSongId('tx:003:abc')).toEqual({ platform: 'tx', nativeId: '003:abc' });
        expect(parseSongId('netease:1')).toBeNull();
        expect(parseSongId('kw:')).toBeNull();
        expect(parseSongId('123')).toBeNull();
        expect(parseCollectionId(collectionIdOf('wy', 'chart', '3778678'))).toEqual({ platform: 'wy', kind: 'chart', nativeId: '3778678' });
        expect(parseCollectionId('kg:a:55')).toEqual({ platform: 'kg', kind: 'album', nativeId: '55' });
        expect(parseCollectionId('kg:x:55')).toBeNull();
        expect(parseCollectionId('qq:p:55')).toBeNull();
    });

    it('turns covers into https addresses', () => {
        expect(normalizeCover('http://imge.kugou.com/stdmusic/{size}/a.jpg')).toBe('https://imge.kugou.com/stdmusic/240/a.jpg');
        expect(normalizeCover('//y.gtimg.cn/a.jpg')).toBe('https://y.gtimg.cn/a.jpg');
        expect(normalizeCover('https://img1.kwcdn.kuwo.cn/star/a.jpg')).toBe('https://img1.kuwo.cn/star/a.jpg');
        expect(normalizeCover('javascript:alert(1)')).toBeUndefined();
        expect(normalizeCover('')).toBeUndefined();
        expect(normalizeKuwoCover('120/85/1/4091887608.jpg')).toBe('https://img1.kuwo.cn/star/albumcover/120/85/1/4091887608.jpg');
        expect(normalizeKuwoCover('star/albumcover/120/a.jpg')).toBe('https://img1.kuwo.cn/star/albumcover/120/a.jpg');
    });

    it("reads Kuwo's single-quoted JSON", () => {
        expect(parseLooseJson("{'abslist':[{'SONGNAME':'a'}]}")).toEqual({ abslist: [{ SONGNAME: 'a' }] });
        expect(parseLooseJson('<html>')).toBeNull();
    });
});

/** A catalog whose requests are answered from `routes` (the first whose key the address contains). */
const fakeCatalog = (routes: Record<string, unknown>) => {
    const asked: Array<{ url: string; referer?: string }> = [];
    const catalog = createCatalog(async (url, options) => {
        asked.push({ url, referer: options?.referer });
        const key = Object.keys(routes).find(part => url.includes(part));
        if (!key) throw new CatalogError('network', `no fake answer for ${url}`);
        const answer = routes[key];
        return typeof answer === 'string' ? answer : JSON.stringify(answer);
    });
    return { catalog, asked };
};

describe('the catalog of the four platforms', () => {
    it('searches NetEase songs with covers, artists, album and duration', async () => {
        const { catalog, asked } = fakeCatalog({
            '/api/cloudsearch/pc': { code: 200, result: { songCount: 321, songs: [
                { id: 186016, name: '晴天', ar: [{ id: 6452, name: '周杰伦' }], al: { id: 18905, name: '叶惠美', picUrl: 'http://p1.music.126.net/a.jpg' }, dt: 269000 },
                { id: 0, name: '' },
            ] } },
        });
        const page = await catalog.searchSongs('wy', '晴天 & more', 30, 60);
        expect(asked[0].url).toBe('https://music.163.com/api/cloudsearch/pc?s=%E6%99%B4%E5%A4%A9%20%26%20more&type=1&limit=30&offset=60');
        expect(page).toEqual({
            hasMore: false, total: 321,
            items: [{
                id: 'wy:186016', title: '晴天', artists: [{ id: '', name: '周杰伦', ref: false }],
                album: { id: 'wy:a:18905', name: '叶惠美', coverUrl: 'https://p1.music.126.net/a.jpg' },
                durationMs: 269000, coverUrl: 'https://p1.music.126.net/a.jpg', data: { platform: 'wy', albumId: '18905' },
            }],
        });
    });

    it('does not pass a NetEase risk-control answer off as an empty list', async () => {
        const { catalog } = fakeCatalog({ '/api/playlist/detail': { code: -462, message: 'verify' } });
        await expect(catalog.tracks('wy:p:1', 30, 0)).rejects.toMatchObject({ code: 'unavailable' });
    });

    it('searches Kugou, splitting the file name where the fields are missing, and keeps the hash as the id', async () => {
        const { catalog, asked } = fakeCatalog({
            '/api/v3/search/song': { data: { total: 2, info: [
                { hash: 'ABCDEF0123', filename: '<em>歌手甲</em> - 歌名', duration: 200, album_id: '77', album_name: '专辑', trans_param: { union_cover: 'http://imge.kugou.com/{size}/c.jpg' }, audio_id: 99 },
            ] } },
        });
        const page = await catalog.searchSongs('kg', 'x', 20, 20);
        expect(asked[0].url).toContain('page=2&pagesize=20');
        expect(page.items[0]).toEqual({
            id: 'kg:abcdef0123', title: '歌名', artists: [{ id: '', name: '歌手甲', ref: false }],
            album: { id: 'kg:a:77', name: '专辑', coverUrl: 'https://imge.kugou.com/240/c.jpg' },
            durationMs: 200000, coverUrl: 'https://imge.kugou.com/240/c.jpg', data: { platform: 'kg', albumId: '77', audioId: '99' },
        });
    });

    it('searches QQ Music by mid with its referer, and Kuwo with single-quoted JSON and no album page', async () => {
        const qq = fakeCatalog({
            'client_search_cp': { data: { song: { totalnum: 9, list: [
                { songmid: '003OUlho2HcRHC', songid: 97773, songname: '晴天', singer: [{ name: '周杰伦' }], albummid: '000MkMni19ClKG', albumid: 8220, albumname: '叶惠美', interval: 269, strMediaMid: '002media' },
            ] } } },
        });
        const qqPage = await qq.catalog.searchSongs('tx', '晴天', 10, 0);
        expect(qq.asked[0].referer).toBe('https://y.qq.com/');
        expect(qqPage.items[0]).toMatchObject({
            id: 'tx:003OUlho2HcRHC', durationMs: 269000,
            album: { id: 'tx:a:8220', coverUrl: 'https://y.qq.com/music/photo_new/T002R300x300M000000MkMni19ClKG.jpg' },
            data: { platform: 'tx', albumId: '8220', albumMid: '000MkMni19ClKG', mediaMid: '002media', songId: '97773' },
        });

        const kuwo = fakeCatalog({
            'search.kuwo.cn/r.s': "{'TOTAL':'1','abslist':[{'MUSICRID':'MUSIC_228908','SONGNAME':'晴天&nbsp;(Live)','ARTIST':'周杰伦&amp;某人','ALBUM':'叶惠美','ALBUMID':'1293','DURATION':'269','web_albumpic_short':'120/85/1/4091887608.jpg'}]}",
        });
        const kuwoPage = await kuwo.catalog.searchSongs('kw', '晴天', 10, 0);
        expect(kuwo.asked[0].url).toContain('pn=0&rn=10');
        expect(kuwoPage.items[0]).toEqual({
            id: 'kw:228908', title: '晴天 (Live)',
            artists: [{ id: '', name: '周杰伦', ref: false }, { id: '', name: '某人', ref: false }],
            album: { id: '', name: '叶惠美', ref: false, coverUrl: 'https://img1.kuwo.cn/star/albumcover/120/85/1/4091887608.jpg' },
            durationMs: 269000, coverUrl: 'https://img1.kuwo.cn/star/albumcover/120/85/1/4091887608.jpg', data: { platform: 'kw', albumId: '1293' },
        });
    });

    it('lists playlists, charts and their songs, sliced locally where a platform answers the whole list', async () => {
        const tracks = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, name: `song ${index + 1}`, artists: [{ name: 'a' }], album: { id: 1, name: 'al' }, duration: 1000 }));
        const { catalog, asked } = fakeCatalog({
            '/api/search/get/web': { code: 200, result: { playlists: [{ id: 24381616, name: '歌单', coverImgUrl: 'http://p1.music.126.net/p.jpg', trackCount: 5, playCount: 10, creator: { nickname: '某人' } }] } },
            '/api/toplist': { code: 200, list: [{ id: 3778678, name: '热歌榜', coverImgUrl: 'http://p1.music.126.net/t.jpg' }] },
            '/api/playlist/detail': { code: 200, result: { tracks } },
        });
        expect((await catalog.searchPlaylists('wy', 'x', 30, 0)).items).toEqual([{
            id: 'wy:p:24381616', type: 'playlist', name: '歌单', coverUrl: 'https://p1.music.126.net/p.jpg', trackCount: 5, playCount: 10,
            creator: { id: '', nickname: '某人' }, data: { platform: 'wy', kind: 'playlist' },
        }]);
        expect(await catalog.charts('wy')).toEqual([{
            id: 'wy:c:3778678', type: 'playlist', name: '热歌榜', coverUrl: 'https://p1.music.126.net/t.jpg', data: { platform: 'wy', kind: 'chart' },
        }]);
        const page = await catalog.tracks('wy:c:3778678', 2, 2);
        expect(asked.at(-1)?.url).toBe('https://music.163.com/api/playlist/detail?id=3778678');
        expect(page.items.map(song => song.id)).toEqual(['wy:3', 'wy:4']);
        expect(page).toMatchObject({ total: 5, hasMore: true });
        expect((await catalog.searchPlaylists('kw', 'x', 30, 0))).toEqual({ items: [], hasMore: false });
        expect((await catalog.searchAlbums('kg', 'x', 30, 0))).toEqual({ items: [], hasMore: false });
    });

    it('falls back to its fixed charts where NetEase lists none, and has fixed ones for Kuwo', async () => {
        const { catalog, asked } = fakeCatalog({});
        expect((await catalog.charts('wy')).map(chart => chart.id)).toContain('wy:c:3778678');
        expect((await catalog.charts('kw')).map(chart => chart.id)).toContain('kw:c:16');
        // Kuwo's are a fixed table: nothing was asked for them.
        expect(asked.filter(request => request.url.includes('kuwo'))).toEqual([]);
    });

    it('refuses an id that is not its own, and an album of a platform with no album endpoint', async () => {
        const { catalog, asked } = fakeCatalog({});
        await expect(catalog.tracks('netease:123', 30, 0)).rejects.toMatchObject({ code: 'unsupported' });
        await expect(catalog.tracks('kw:a:1', 30, 0)).rejects.toMatchObject({ code: 'unsupported' });
        expect(await catalog.song('kw:1')).toBeNull();
        expect(await catalog.lyric('kg:abc')).toBeNull();
        expect(asked).toEqual([]);
    });

    it('reads lyrics from the public endpoints of NetEase and Kuwo', async () => {
        const { catalog } = fakeCatalog({
            '/api/song/lyric': { code: 200, lrc: { lyric: '[00:01.00]a' }, tlyric: { lyric: '[00:01.00]甲' }, romalrc: { lyric: '' } },
            'songinfoandlrc': { data: { lrclist: [{ time: '1.5', lineLyric: '一' }, { time: '62.25', lineLyric: '二' }] } },
        });
        expect(await catalog.lyric('wy:1')).toEqual({ lyric: '[00:01.00]a', translation: '[00:01.00]甲' });
        expect(await catalog.lyric('kw:1')).toEqual({ lyric: '[00:01.50]一\n[01:02.25]二' });
    });
});
