import type {
    FoliumSourceDef,
    FoliumSourceError,
    FoliumSourceErrorCode,
    FoliumSourceErrorDetails,
    FoliumSourcePageStore,
    FoliumText,
} from '@folia/folium';
import { createKugouSource } from './kugouProvider';
import { createDesktopKugouTransport, createWebKugouTransport, type KugouWebEnv } from './kugouTransport';

// sources/kugou/core/index.ts
// 酷狗音源的 core（方案 §8）：createSource(env) 交回音源定义，三处用它：桌面版模组的 client（client/index.ts，env 由
// folium 拼出）、网页版（src/services/onlineMusic/web/kugou.ts，env 由宿主拼出，另给 `web`）、单测
// （test/unit/helpers/builtinSources.ts 的测试 env）。只 import @folia/folium 的类型和 kit。

export type { KugouWebEnv } from './kugouTransport';
export type { KugouBridgeResult, KugouOperation, KugouParams } from './kugouTransport';
export { KUGOU_OPERATIONS } from './kugouTransport';
// The picture hosts covers@1 knows: the web build fetches their covers through the lyric proxy (no CORS headers). Under
// a name without the platform's, so the web build's file (src/services/onlineMusic/web/) names it no more than it must.
export { KUGOU_COVER_HOSTS as COVER_HOSTS } from './kugouCovers';

/** What createSource is handed: the desktop client's env, and on the web the web build's pieces. */
export interface KugouSourceEnv {
    modId: string;
    /** The main entry's rpc (folium.rpc.call); the web build has none, and gives `web`. */
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    text(key: string, params?: Record<string, string | number>): FoliumText;
    translate(key: string, params?: Record<string, string | number>): string;
    error(code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails): FoliumSourceError;
    isPureMusicText(text: string | null | undefined): boolean;
    pageStore(sourceId: string): FoliumSourcePageStore;
    /** The web build: KuGouMusicApi at a configured address instead of the main entry. */
    web?: KugouWebEnv;
}

/** The source (`kugou`). */
export const createSource = (env: KugouSourceEnv): FoliumSourceDef => {
    const transportEnv = {
        call: <T>(name: string, ...args: unknown[]) => env.call<T>(name, ...args),
        error: (...args: Parameters<KugouSourceEnv['error']>) => env.error(...args),
        pageStore: (sourceId: string) => env.pageStore(sourceId),
    };
    const transport = env.web ? createWebKugouTransport(transportEnv, env.web) : createDesktopKugouTransport(transportEnv);
    return createKugouSource({
        text: key => env.text(key),
        translate: key => env.translate(key),
        error: (...args: Parameters<KugouSourceEnv['error']>) => env.error(...args),
        isPureMusicText: text => env.isPureMusicText(text),
    }, transport);
};
