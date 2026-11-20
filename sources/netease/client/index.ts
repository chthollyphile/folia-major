import type { FoliumClientApi, FoliumSourceHandle } from '@folia/folium';
import { createSource, disposeSource, noteNeteaseBackendStatus, type NeteaseBackendStatus } from '../core';

// sources/netease/client/index.ts
// 网易云音乐音源模组的 client 入口：core 的 createSource 拿 folium 拼出的 env。API 跑在 main 入口的工作线程里
// （main/index.ts）：rpc `status` 给它的端口（还没起时拉起它），请求直接发到 127.0.0.1:<端口>；`restart`、诊断快照与
// 自检也经 folium.rpc。名字、登录窗口、探索页、私人 FM 的模式与云盘的文字来自模组自己的语言表；在第一个 await 之前
// 注册（方案 §5.4）。

/** client 入口。 */
export default function activate(folium: FoliumClientApi): () => void {
    let handle: FoliumSourceHandle | null = null;
    handle = folium.sources.register(createSource({
        modId: folium.modId,
        call: <T>(name: string, ...args: unknown[]) => folium.rpc.call<T>(name, ...args),
        text: (key, params) => folium.i18n.key(key, params),
        translate: (key, params) => folium.i18n.text(key, params),
        error: (code, message, details) => folium.sources.error(code, message, details),
        isPureMusicText: text => folium.lyrics.isPureMusicText(text),
        pageStore: sourceId => folium.sources.pageStore(sourceId),
        // A startup failure of the API is told once (neteaseLocalService.ts).
        notify: notice => handle?.notify(notice),
    }));
    // The embedded API's state changed (started, failed, restarted on another port): requests and the sign-in window
    // follow it.
    folium.rpc.on('status', (status) => {
        noteNeteaseBackendStatus((status ?? null) as NeteaseBackendStatus | null);
    });
    // Switched off and unloaded: the port and state go with it.
    return () => {
        handle = null;
        disposeSource();
    };
}
