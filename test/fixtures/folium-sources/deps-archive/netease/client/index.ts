import type { FoliumClientApi } from '@folia/folium';
// test/fixtures/folium-sources/deps-archive/netease/client/index.ts
// 依赖归档样例的 client 入口：构建要求音源模组有 client，样例只验 main 一侧从归档加载上游库，这里不注册音源。

/** client 入口：只记一行。 */
export default function activate(folium: FoliumClientApi): void {
    folium.log.info('deps archive sample: nothing to register');
}
