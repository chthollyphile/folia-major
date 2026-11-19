import type { FoliumClientApi } from '@folia/folium';
import { connectFnMusicTransport } from './fnmusicTransport';
import { createFnMusicSource } from './fnmusicProvider';

// sources/fnmusic/client/index.ts
// 飞牛音源模组的 client 入口：请求经 folium.rpc 交给 main 入口，名字、登录窗口与登录表单的文字来自模组自己的
// 语言表，在第一个 await 之前注册（方案 §5.4 末尾的约定）。

/** client 入口。 */
export default function activate(folium: FoliumClientApi): void {
    connectFnMusicTransport({
        call: <T>(name: string, ...args: unknown[]) => folium.rpc.call<T>(name, ...args),
        error: (code, message, details) => folium.sources.error(code, message, details),
    });
    folium.sources.register(createFnMusicSource({ text: key => folium.i18n.key(key) }));
}
