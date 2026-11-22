import type { FoliumClientApi, FoliumSourceHandle, FoliumSourcePageStore } from '@folia/folium';
import { createLxCommands } from './lxCommands';
import { createLxSource } from './lxProvider';
import { createLxTransport } from './lxTransport';
import type { LxState } from './lxTransport';

// sources/lxmusic/client/index.ts
// 洛雪音源模组的 client 入口：在第一个 await 之前注册音源（方案 §5.4 末尾的约定），再登记脚本管理的命令，
// 然后向 main 入口问一次脚本库的状态。「有没有脚本」「搜哪家平台」记在音源的页面存储里：宿主画行时同步地问
// getAvailability，等不了一次 rpc。问状态只读模组自己的存储，不联网。当前脚本支持哪些平台也记在那里：
// 「对应歌曲」能答哪几家（songs@1.counterpartSources）宿主也是同步读的。

/** client 入口。 */
export default function activate(folium: FoliumClientApi): void {
    const transport = createLxTransport({
        call: <T>(name: string, ...args: unknown[]) => folium.rpc.call<T>(name, ...args),
        error: (code, message, details) => folium.sources.error(code, message, details),
    });
    // 页面存储只有主窗口有；别处（导出窗口）register 本身也会抛，这里先不让它抢在前面抛。
    let store: FoliumSourcePageStore | null = null;
    try { store = folium.sources.pageStore('lxmusic'); } catch { /* 下面的 register 会说为什么 */ }
    let configured = store?.get('configured') === '1';
    let platform = store?.get('platform') ?? null;
    let platforms: string[] = (store?.get('platforms') ?? '').split(',').filter(Boolean);

    const handle: FoliumSourceHandle = folium.sources.register(createLxSource({
        transport,
        text: (key, params) => folium.i18n.key(key, params),
        isConfigured: () => configured,
        platform: () => platform,
        platforms: () => (configured ? platforms : []),
    }));

    let refreshCommands: (state: LxState) => void = () => undefined;
    const onState = (state: LxState) => {
        const nowConfigured = state.activeId !== null;
        const nowPlatforms = Array.isArray(state.platforms) ? state.platforms.filter(key => typeof key === 'string' && key !== '') : [];
        const changed = nowConfigured !== configured || state.platform !== platform || nowPlatforms.join(',') !== platforms.join(',');
        configured = nowConfigured;
        platform = state.platform;
        platforms = nowPlatforms;
        store?.set('configured', configured ? '1' : null);
        store?.set('platform', platform);
        store?.set('platforms', platforms.length > 0 ? platforms.join(',') : null);
        refreshCommands(state);
        // 宿主同步读的东西（能不能用）变了：让它重读这家音源。
        if (changed) handle.changed();
    };
    refreshCommands = createLxCommands({
        transport,
        register: def => folium.registries.commands.register(def),
        translate: (key, params) => folium.i18n.text(key, params),
        onState,
    });

    transport.request<LxState>('state').then(onState, (error: unknown) => {
        folium.log.warn('[LxMusic] could not read the script library', error);
    });
}
