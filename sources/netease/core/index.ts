import type { FoliumSourceDef } from '@folia/folium';
import { setNeteaseEnv, type NeteaseSourceEnv } from './neteaseEnv';
import { createNeteaseSource, resetNeteaseProviderRuntimeCache } from './neteaseProvider';
import { resetNeteaseTransport } from './netease';
import { resetNeteaseLocalService } from './neteaseLocalService';

// sources/netease/core/index.ts
// 网易云音乐音源的 core（方案 §8）：createSource(env) 交回音源定义，三处用它：桌面版模组的 client（client/index.ts，
// env 由 folium 拼出）、网页版（src/services/onlineMusic/web/netease.ts，env 由宿主拼出，另给 `web`）、单测
// （test/unit/helpers/neteaseSource.ts 的测试 env）。只 import @folia/folium 的类型和 kit。
// core 的各个文件照迁之前的样子把状态放在模块里，所以 env 也放在模块里（neteaseEnv.ts）：最后一次 createSource 的那个
// 算数，它先丢掉上一个音源留下的东西。

export type { NeteaseSourceEnv, NeteaseWebEnv } from './neteaseEnv';
export type { NeteaseBackendStatus } from './netease';
export { noteNeteaseBackendStatus } from './neteaseLocalService';
// The picture hosts covers@1 knows, under a name without the platform's, so the web build's file names it no more
// than it must.
export { NETEASE_COVER_HOSTS as COVER_HOSTS } from './neteaseCovers';

/** The source (`netease`). */
export const createSource = (env: NeteaseSourceEnv): FoliumSourceDef => {
    setNeteaseEnv(env);
    disposeSource();
    return createNeteaseSource();
};

/** What the source leaves when it stops: the backend's port and state it was told, and the cached answers. */
export const disposeSource = (): void => {
    resetNeteaseTransport();
    resetNeteaseLocalService();
    resetNeteaseProviderRuntimeCache();
};
