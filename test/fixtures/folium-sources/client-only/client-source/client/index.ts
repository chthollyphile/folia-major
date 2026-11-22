import type { FoliumClientApi } from '@folia/folium';
// test/fixtures/folium-sources/client-only/client-source/client/index.ts
// 没有 core 的音源：client 入口自己注册，按 id 取歌经 folium.rpc 问 main 入口（单测里由 setBuiltinSourceRpc 答）。

/** client 入口。 */
export default function activate(folium: FoliumClientApi): void {
    folium.sources.register({
        id: 'plain',
        displayName: 'Client-only fixture',
        capabilities: {
            'songs@1': {
                getSong: async (id) => {
                    const row = await folium.rpc.call<{ id: string; title: string } | null>('song', id);
                    return row ? { id: row.id, title: row.title, artists: [] } : null;
                },
            },
        },
    });
}
