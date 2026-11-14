import type { FoliumSourceDef, FoliumSourceSong, FoliumText } from '@folia/folium';
import { errorMessage } from '@folia/folium-source-kit';
// test/fixtures/folium-sources/fixture-source/core/index.ts
// 构建夹具音源的核心（Folium 2.0 方案 §8 的 core 形态）：createSource(env) 交回音源定义，不认识桌面还是测试，
// 到 main 入口的调用和文字都由 env 注入。桌面上 client 入口注入 folium.rpc 与 folium.i18n；单测由
// test/unit/helpers/builtinSources.ts 注入测试用的 env。

/** core 要的环境：和 test/unit/helpers/builtinSources.ts 的 BuiltinSourceTestEnv 同形。 */
export interface FixtureSourceEnv {
    /** 调 main 入口登记的处理器。 */
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    /** 模组自己语言表里的一条文字。 */
    text(key: string, params?: Record<string, string | number>): FoliumText;
}

/** main 入口答的一行。 */
export interface ProbeRow {
    id: string;
    title: string;
    artist: string;
}

const toSong = (row: ProbeRow): FoliumSourceSong => ({
    id: row.id,
    title: row.title,
    artists: [{ id: `artist-${row.artist}`, name: row.artist }],
    durationMs: 6000,
});

/** 夹具音源 `probe`：搜索和按 id 取歌，答案全由 main 入口经各种依赖拼出来。 */
export const createSource = (env: FixtureSourceEnv): FoliumSourceDef => ({
    id: 'probe',
    displayName: env.text('source.name'),
    shortName: env.text('source.short'),
    mark: { letter: '构', color: '#3a9d6e' },
    capabilities: {
        'search@1': {
            access: 'anonymous',
            searchSongs: async (query, limit, offset) => {
                let rows: ProbeRow[];
                try {
                    rows = await env.call<ProbeRow[]>('search', query);
                } catch (error) {
                    throw new Error(`probe search failed: ${errorMessage(error)}`, { cause: error });
                }
                return { items: rows.slice(offset, offset + limit).map(toSong), total: rows.length, hasMore: offset + limit < rows.length };
            },
        },
        'songs@1': {
            access: 'anonymous',
            getSong: async (id) => {
                const row = await env.call<ProbeRow | null>('song', id);
                return row ? toSong(row) : null;
            },
        },
    },
});
