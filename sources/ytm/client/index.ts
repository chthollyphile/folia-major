import type { FoliumClientApi, FoliumSourceHandle, FoliumSourcePageStore } from '@folia/folium';
import { connectYtmTransport } from './ytmTransport';
import { connectYtmAccount } from './ytmAccount';
import { createYtmSource } from './ytmProvider';

// sources/ytm/client/index.ts
// YouTube Music 音源模组的 client 入口：请求经 folium.rpc 交给 main 入口；短名、登录窗口的字和「与某首歌相似」
// 来自模组自己的语言表；Premium 与否和账号自己的歌单记在音源的页面存储里。在第一个 await 之前注册（方案 §5.4
// 末尾的约定）。

/** client 入口。 */
export default function activate(folium: FoliumClientApi): void {
    connectYtmTransport({
        call: <T>(name: string, ...args: unknown[]) => folium.rpc.call<T>(name, ...args),
        error: (code, message, details) => folium.sources.error(code, message, details),
    });
    // 页面存储只有主窗口有；别处（导出窗口）register 本身也会抛，这里先不让它抢在前面抛。
    let store: FoliumSourcePageStore | null = null;
    try { store = folium.sources.pageStore('ytm'); } catch { /* 下面的 register 会说为什么 */ }
    let handle: FoliumSourceHandle | null = null;
    // Premium 改变列出的音质档位：宿主在 `changed()` 之后重读。
    if (store) connectYtmAccount(store, () => handle?.changed());
    handle = folium.sources.register(createYtmSource({
        text: (key, params) => folium.i18n.key(key, params),
        translate: key => folium.i18n.text(key),
        store,
        isMac: typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent),
    }));
}
