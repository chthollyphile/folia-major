import type { FoliumClientApi } from '@folia/folium';
import { connectQishuiTransport } from './qishuiTransport';
import { createQishuiSource } from './qishuiProvider';

// sources/qishui/client/index.ts
// 汽水音源模组的 client 入口：请求经 folium.rpc 交给 main 入口，名字、登录窗口、私人 FM 模式和「最近播放」的文字
// 来自模组自己的语言表，在第一个 await 之前注册（方案 §5.4 末尾的约定）。

/** client 入口。 */
export default function activate(folium: FoliumClientApi): void {
    connectQishuiTransport({
        call: <T>(name: string, ...args: unknown[]) => folium.rpc.call<T>(name, ...args),
        error: (code, message, details) => folium.sources.error(code, message, details),
    });
    folium.sources.register(createQishuiSource({
        text: key => folium.i18n.key(key),
        translate: key => folium.i18n.text(key),
    }));
}
