import type {
    FoliumSourceAudio, FoliumSourceCollection, FoliumSourceDef, FoliumSourcePage, FoliumSourceSong, FoliumText,
} from '@folia/folium';
import { counterpartSourcesOf, counterpartsOf, LX_PLATFORM_OF_SOURCE } from './lxCounterparts';
import type { LxTransport } from './lxTransport';

// sources/lxmusic/client/lxProvider.ts
// 洛雪音源的定义（folium.sources.register 收的那份）。它是一家不用登录的音源：搜歌、歌单、专辑、榜单来自 main
// 入口请求的公开接口，播放地址来自用户导入的自定义源脚本（跑在 main 入口的沙箱里）。歌都是它自己的，
// 不接管别家音源的歌。没导入脚本时 getAvailability 答「没配好」，宿主就不来问别的。

/** main 入口给的歌词。 */
interface LxLyric {
    lyric: string;
    translation?: string;
    romanization?: string;
}

export interface LxSourceEnv {
    transport: LxTransport;
    text(key: string, params?: Record<string, string | number>): FoliumText;
    /** 有没有导入脚本；同步，宿主画行时问。 */
    isConfigured(): boolean;
    /** 当前搜的平台键（榜单区块的标题里要它的名字）。 */
    platform(): string | null;
    /** 当前脚本支持的平台键；没有脚本时是空的。「对应歌曲」只答这些平台的。 */
    platforms(): readonly string[];
}

const songPage = (transport: LxTransport, operation: string, params: Record<string, unknown>) => (
    transport.request<FoliumSourcePage<FoliumSourceSong>>('catalog', operation, params)
);
const collectionPage = (transport: LxTransport, operation: string, params: Record<string, unknown>) => (
    transport.request<FoliumSourcePage<FoliumSourceCollection>>('catalog', operation, params)
);

/** 清单 `sources[0]`（id `lxmusic`）的音源。 */
export const createLxSource = (env: LxSourceEnv): FoliumSourceDef => {
    const { transport } = env;
    return {
        id: 'lxmusic',
        displayName: env.text('name.full'),
        shortName: env.text('name.short'),
        // 记号只用字和颜色。
        mark: { letter: '洛', color: '#2f9e6e' },
        getAvailability: () => (env.isConfigured()
            ? { configured: true }
            : { configured: false, reason: 'not-configured', message: env.text('availability.noScript') }),
        capabilities: {
            'search@1': {
                searchSongs: (query, limit, offset) => songPage(transport, 'searchSongs', { query, limit, offset }),
                searchPlaylists: (query, limit, offset) => collectionPage(transport, 'searchPlaylists', { query, limit, offset }),
                searchAlbums: (query, limit, offset) => collectionPage(transport, 'searchAlbums', { query, limit, offset }),
            },
            'songs@1': {
                getSong: id => transport.request<FoliumSourceSong | null>('catalog', 'song', { id }),
                // 「对应歌曲」：网易云、QQ、酷狗的歌只凭 id 换成洛雪的歌（lxCounterparts.ts），不发请求。
                // 能答哪几家跟着当前脚本支持的平台变，所以是 getter；脚本换了由 index.ts 调 handle.changed()。
                // 还没导入脚本时三家都报：宿主看到「没配好」不会来问，界面上能提示去导入脚本。
                get counterpartSources() {
                    return env.isConfigured() ? counterpartSourcesOf(env.platforms()) : Object.keys(LX_PLATFORM_OF_SOURCE);
                },
                getCounterparts: songs => Promise.resolve(counterpartsOf(songs, env.platforms())),
            },
            'playback.audio@1': {
                // 洛雪的四档：128k、320k、flac、flac24bit。脚本没有的档由 main 入口落到最近的一档，答里写明实际的档。
                audioQualityLevels: ['standard', 'high', 'lossless', 'hires'],
                getAudioSource: (song, quality) => transport.request<FoliumSourceAudio>('audio', song, quality),
            },
            'lyrics@1': {
                async getLyrics(song) {
                    const lyric = await transport.request<LxLyric | null>('lyric', song);
                    if (!lyric) return null;
                    return {
                        main: {
                            format: 'lrc',
                            text: lyric.lyric,
                            ...(lyric.translation ? { translationText: lyric.translation } : {}),
                            ...(lyric.romanization ? { romanizationText: lyric.romanization } : {}),
                        },
                    };
                },
            },
            'catalog@1': {
                // 歌带着自己专辑的 id（能开的那几家）；歌手没有页面。
                canResolveSongCatalogRefs: () => true,
                resolveSongCatalogRefs: song => Promise.resolve(song),
                getPlaylistTracks: (id, limit, offset) => songPage(transport, 'tracks', { id, limit, offset }),
                getPlaylistDetail: (_id, collection) => Promise.resolve(collection ?? null),
                getAlbumTracks: (id, limit = 50, offset = 0) => songPage(transport, 'tracks', { id, limit, offset }),
                getAlbumDetail: (_id, collection) => Promise.resolve(collection ?? null),
            },
            'explore@1': {
                async getFeed(cursor) {
                    if (cursor) return { sections: [] };
                    const charts = await transport.request<FoliumSourceCollection[]>('catalog', 'charts', {});
                    if (charts.length === 0) return { sections: [] };
                    return {
                        sections: [{
                            id: 'charts',
                            title: env.text(`explore.charts.${env.platform() ?? 'other'}`),
                            items: charts.map(collection => ({ kind: 'collection', collection })),
                        }],
                    };
                },
            },
        },
    };
};
