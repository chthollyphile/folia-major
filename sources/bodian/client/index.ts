import type { FoliumClientApi } from '@folia/folium';
import { connectBodianTransport } from './bodianTransport';
import { createBodianSource } from './bodianProvider';

// sources/bodian/client/index.ts
// 波点音源模组的 client 入口：请求经 folium.rpc 交给 main 入口，名字和登录窗口的文字来自模组自己的语言表，
// 在第一个 await 之前注册（方案 §5.4 末尾的约定）。

/** client 入口。 */
export default function activate(folium: FoliumClientApi): void {
    connectBodianTransport({
        call: <T>(name: string, ...args: unknown[]) => folium.rpc.call<T>(name, ...args),
        error: (code, message, details) => folium.sources.error(code, message, details),
    });
    folium.sources.register(createBodianSource({
        text: key => folium.i18n.key(key),
        isPureMusicText: text => folium.lyrics.isPureMusicText(text),
    }));
}
