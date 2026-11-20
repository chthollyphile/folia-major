import type { FoliumSourceDef } from '@folia/folium';
import { setQqEnv, type QqSourceEnv } from './qqEnv';
import { createQqSource, resetQqProviderRuntimeCache } from './qqProvider';
import { resetQqTransportRuntimeCache } from './qqTransport';

// sources/qq/core/index.ts
// QQ 音乐音源的 core（方案 §8）：createSource(env) 交回音源定义，三处用它：桌面版模组的 client（client/index.ts，env 由
// folium 拼出）、网页版（src/services/onlineMusic/web/qq.ts，env 由宿主拼出，另给 `web`）、单测
// （test/unit/helpers/builtinSources.ts 的测试 env）。只 import @folia/folium 的类型和 kit。
// core 的各个文件照迁之前的样子把状态放在模块里，所以 env 也放在模块里（qqEnv.ts）：最后一次 createSource 的那个算数，
// 它先丢掉上一个音源留下的东西。

export type { QqSourceEnv, QqWebEnv } from './qqEnv';
export type { QqBackendStatus, QqMusicuAnswer, QqMusicuRequest, QqOperation, QqParams } from './qqTransport';
export { QQ_OPERATIONS, QQ_MUSICU_URL, forgetQqBackendPort } from './qqTransport';
// The picture hosts covers@1 knows, and those the web build fetches through the lyric proxy (no CORS headers). Under
// names without the platform's, so the web build's file (src/services/onlineMusic/web/) names it no more than it must.
export { QQ_COVER_HOSTS as COVER_HOSTS, QQ_PROXIED_COVER_HOSTS as PROXIED_COVER_HOSTS } from './qqCovers';

/** The source (`qq`). */
export const createSource = (env: QqSourceEnv): FoliumSourceDef => {
    setQqEnv(env);
    resetQqTransportRuntimeCache();
    resetQqProviderRuntimeCache();
    return createQqSource();
};

/**
 * What the source leaves when it stops: the hourly session refresh (a timer the module keeps, which would go on asking
 * a closed port, or start the backend of a source only used for matching), the backend's port and the cached answers.
 */
export const disposeSource = (): void => {
    resetQqProviderRuntimeCache();
    resetQqTransportRuntimeCache();
};
