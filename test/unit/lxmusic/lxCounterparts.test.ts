import { describe, expect, it } from 'vitest';
import type { FoliumSourceForeignSong } from '@folia/folium';
import { counterpartOf, counterpartSourcesOf, counterpartsOf, LX_PLATFORM_OF_SOURCE } from '../../../sources/lxmusic/client/lxCounterparts';
import { createLxSource } from '../../../sources/lxmusic/client/lxProvider';
import type { LxTransport } from '../../../sources/lxmusic/client/lxTransport';
import { parseSongId } from '../../../sources/lxmusic/main/catalog';
import { buildMusicInfo } from '../../../sources/lxmusic/main/musicInfo';

// test/unit/lxmusic/lxCounterparts.test.ts
// 洛雪的「对应歌曲」：网易云、QQ、酷狗的歌只凭 id 换成洛雪的歌，不联网；id 的样子不对就没有。

const ALL = ['kw', 'kg', 'tx', 'wy'];
const HASH = 'AB12CD34EF56AB12CD34EF56AB12CD34';
const foreign = (patch: Partial<FoliumSourceForeignSong> & Pick<FoliumSourceForeignSong, 'sourceId' | 'id'>): FoliumSourceForeignSong => ({
    title: 'Title',
    artists: ['Singer', 'Other'],
    album: 'Album',
    durationMs: 200000.4,
    coverUrl: 'https://img.example/c.jpg',
    ...patch,
});

describe('which sources the LX source answers for', () => {
    it('follows the platforms the script in use serves', () => {
        expect(LX_PLATFORM_OF_SOURCE).toEqual({ netease: 'wy', qq: 'tx', kugou: 'kg' });
        expect(counterpartSourcesOf(ALL)).toEqual(['netease', 'qq', 'kugou']);
        expect(counterpartSourcesOf(['kw', 'wy'])).toEqual(['netease']);
        expect(counterpartSourcesOf([])).toEqual([]);
    });
});

describe('counterpartOf', () => {
    it('maps a NetEase song to wy:<id> with what it was shown', () => {
        expect(counterpartOf(foreign({ sourceId: 'netease', id: '186016' }), ALL)).toEqual({
            id: 'wy:186016',
            title: 'Title',
            artists: [{ id: '', name: 'Singer', ref: false }, { id: '', name: 'Other', ref: false }],
            album: { id: '', name: 'Album', ref: false, coverUrl: 'https://img.example/c.jpg' },
            durationMs: 200000,
            coverUrl: 'https://img.example/c.jpg',
            data: { platform: 'wy' },
        });
    });

    it('maps a QQ song to tx:<songmid>, and keeps the numeric id the scripts may need', () => {
        const found = counterpartOf(foreign({ sourceId: 'qq', id: '003OUlho2HcRHC', publicId: '97773' }), ALL);
        expect(found).toMatchObject({ id: 'tx:003OUlho2HcRHC', data: { platform: 'tx', songId: '97773' } });
        // 没有 songmid 的歌（那边拿数字 id 顶上的）换不了。
        expect(counterpartOf(foreign({ sourceId: 'qq', id: '97773000' }), ALL)).toBeNull();
        expect(counterpartOf(foreign({ sourceId: 'qq', id: '977' }), ALL)).toBeNull();
        // 全是数字的 songmid 只在另有数字 id 时才认。
        expect(counterpartOf(foreign({ sourceId: 'qq', id: '00312345678901', publicId: '5' }), ALL)?.id).toBe('tx:00312345678901');
    });

    it('maps a Kugou song to kg:<lowercase hash>', () => {
        expect(counterpartOf(foreign({ sourceId: 'kugou', id: HASH }), ALL)).toMatchObject({ id: `kg:${HASH.toLowerCase()}`, data: { platform: 'kg' } });
        expect(counterpartOf(foreign({ sourceId: 'kugou', id: 'not-a-hash' }), ALL)).toBeNull();
        expect(counterpartOf(foreign({ sourceId: 'kugou', id: '12345' }), ALL)).toBeNull();
    });

    it('answers ids the main entry reads back as the same song', () => {
        for (const song of [
            foreign({ sourceId: 'netease', id: '186016' }),
            foreign({ sourceId: 'qq', id: '003OUlho2HcRHC', publicId: '97773' }),
            foreign({ sourceId: 'kugou', id: HASH }),
        ]) {
            const found = counterpartOf(song, ALL)!;
            const parsed = parseSongId(found.id);
            expect(parsed).not.toBeNull();
            expect(parsed!.platform).toBe(LX_PLATFORM_OF_SOURCE[song.sourceId]);
            // 脚本拿到的 musicInfo 能照常拼出来。
            const info = buildMusicInfo(parsed!.platform, parsed!.nativeId, found);
            expect(info.name).toBe('Title');
        }
    });

    it('has none for a source it does not know, a platform the script does not serve, or a song without a title', () => {
        expect(counterpartOf(foreign({ sourceId: 'spotify', id: '186016' }), ALL)).toBeNull();
        expect(counterpartOf(foreign({ sourceId: 'constructor', id: '186016' }), ALL)).toBeNull();
        expect(counterpartOf(foreign({ sourceId: 'netease', id: '186016' }), ['kw', 'tx'])).toBeNull();
        expect(counterpartOf(foreign({ sourceId: 'netease', id: '186016', title: '' }), ALL)).toBeNull();
        expect(counterpartOf(foreign({ sourceId: 'netease', id: '0186016' }), ALL)).toBeNull();
        expect(counterpartOf(foreign({ sourceId: 'netease', id: '18 6016' }), ALL)).toBeNull();
        expect(counterpartOf(null, ALL)).toBeNull();
    });

    it('never matches by title and artist', () => {
        // 同名同歌手、id 的样子不对：没有。
        expect(counterpartOf(foreign({ sourceId: 'netease', id: 'abc' }), ALL)).toBeNull();
    });

    it('drops a cover that is not http(s) and survives odd input', () => {
        const found = counterpartOf({
            sourceId: 'netease', id: '5', title: 'T', artists: 'x' as unknown as string[], coverUrl: 'javascript:alert(1)', durationMs: Number.NaN,
        }, ALL);
        expect(found).toEqual({ id: 'wy:5', title: 'T', artists: [], data: { platform: 'wy' } });
    });

    it('answers a batch in order', () => {
        const batch = [foreign({ sourceId: 'netease', id: '1' }), foreign({ sourceId: 'kugou', id: 'x' }), foreign({ sourceId: 'qq', id: '003OUlho2HcRHC' })];
        expect(counterpartsOf(batch, ALL).map(found => found?.id ?? null)).toEqual(['wy:1', null, 'tx:003OUlho2HcRHC']);
        expect(counterpartsOf('nope' as unknown as FoliumSourceForeignSong[], ALL)).toEqual([]);
    });
});

describe('the source', () => {
    it('answers without a request, for the platforms of the script in use only', async () => {
        const requests: string[] = [];
        const transport = { request: async (_channel: string, operation: string) => { requests.push(operation); return null; } } as unknown as LxTransport;
        let platforms: string[] = ['wy'];
        let configured = true;
        const source = createLxSource({
            transport,
            text: key => key,
            isConfigured: () => configured,
            platform: () => 'wy',
            platforms: () => platforms,
        });
        const songs = source.capabilities['songs@1']!;
        expect(songs.counterpartSources).toEqual(['netease']);
        const batch = [foreign({ sourceId: 'netease', id: '1' }), foreign({ sourceId: 'qq', id: '003OUlho2HcRHC' })];
        expect((await songs.getCounterparts!(batch)).map(found => found?.id ?? null)).toEqual(['wy:1', null]);
        platforms = [];
        expect(songs.counterpartSources).toEqual([]);
        expect(await songs.getCounterparts!(batch)).toEqual([null, null]);
        // 没有脚本：三家照样声明（宿主看到「没配好」不会来问，界面能提示去导入），真问了全答没有。
        configured = false;
        expect(songs.counterpartSources).toEqual(['netease', 'qq', 'kugou']);
        expect(source.getAvailability?.().configured).toBe(false);
        expect(await songs.getCounterparts!(batch)).toEqual([null, null]);
        expect(requests).toEqual([]);
    });
});
