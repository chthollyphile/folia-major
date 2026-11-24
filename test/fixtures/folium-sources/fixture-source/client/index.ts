import type { FoliumClientApi } from '@folia/folium';
import { createSource } from '../core/index';
// test/fixtures/folium-sources/fixture-source/client/index.ts
// 构建夹具音源的 client 入口：把 folium.rpc 与 folium.i18n 交给 core，在第一个 await 之前注册（方案 §5.4 末尾的约定）。

/** client 入口。 */
export default function activate(folium: FoliumClientApi): void {
    const handle = folium.sources.register(createSource({
        call: <T>(name: string, ...args: unknown[]) => folium.rpc.call<T>(name, ...args),
        text: (key, params) => folium.i18n.key(key, params),
    }));
    folium.log.info(`registered ${handle.id}`);
}
