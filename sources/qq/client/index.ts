import type { FoliumClientApi } from '@folia/folium';
import { createSource, disposeSource, forgetQqBackendPort } from '../core';

// sources/qq/client/index.ts
// QQ 音乐音源模组的 client 入口：core 的 createSource 拿 folium 拼出的 env，后端请求直接发到 main 入口里内嵌
// qq-music-api 的端口（rpc `status` 给端口，第一次问时才拉起它），musicu、诊断快照与自检经 folium.rpc 交给 main 入口
// （main/index.ts）；名字、登录窗口、探索页、偏好与云盘的文字来自模组自己的语言表；在第一个 await 之前注册（方案 §5.4）。

/** client 入口。 */
export default function activate(folium: FoliumClientApi): () => void {
    folium.sources.register(createSource({
        modId: folium.modId,
        call: <T>(name: string, ...args: unknown[]) => folium.rpc.call<T>(name, ...args),
        text: (key, params) => folium.i18n.key(key, params),
        translate: (key, params) => folium.i18n.text(key, params),
        error: (code, message, details) => folium.sources.error(code, message, details),
        isPureMusicText: text => folium.lyrics.isPureMusicText(text),
        pageStore: sourceId => folium.sources.pageStore(sourceId),
    }));
    // The embedded backend's status changed (started, stopped, restarted on another port): the next request asks the
    // main entry for the port again.
    folium.rpc.on('status', () => {
        forgetQqBackendPort();
    });
    // Switched off and unloaded: the module's timer and port go with it.
    return disposeSource;
}
