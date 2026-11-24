import type { FoliumClientApi } from '@folia/folium';
import { createSource } from '../core';

// sources/kugou/client/index.ts
// 酷狗音源模组的 client 入口：core 的 createSource 拿 folium 拼出的 env，请求经 folium.rpc 交给 main 入口
// （main/index.ts），名字、登录窗口、云盘和听歌排行的文字来自模组自己的语言表；在第一个 await 之前注册（方案 §5.4）。

/** client 入口。 */
export default function activate(folium: FoliumClientApi): void {
    folium.sources.register(createSource({
        modId: folium.modId,
        call: <T>(name: string, ...args: unknown[]) => folium.rpc.call<T>(name, ...args),
        text: (key, params) => folium.i18n.key(key, params),
        translate: (key, params) => folium.i18n.text(key, params),
        error: (code, message, details) => folium.sources.error(code, message, details),
        isPureMusicText: text => folium.lyrics.isPureMusicText(text),
        pageStore: sourceId => folium.sources.pageStore(sourceId),
    }));
}
