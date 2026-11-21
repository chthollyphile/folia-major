import type { FoliumSourceError, FoliumSourceErrorCode, FoliumSourceErrorDetails } from '@folia/folium';

// sources/lxmusic/client/lxTransport.ts
// 洛雪音源到 main 入口的调用（folium.rpc）：main 入口每个调用回 { ok: true, data } 或 { ok: false, code, message }，
// 这里把失败换成宿主读的错误（folium.sources.error），并记着脚本库的状态（有没有脚本、搜哪家平台）。

/** main 入口答的脚本库状态。 */
export interface LxState {
    scripts: Array<{ id: string; name: string; version: string; author: string; fileName: string; platforms: string[] }>;
    activeId: string | null;
    /** 当前搜的平台键；没有脚本时是 null。 */
    platform: string | null;
    /** 当前脚本支持的平台键。 */
    platforms: string[];
}

type RpcResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

/** 导入脚本失败时 main 入口给的原因（`import:<原因>` 的后半截）。 */
export class LxImportFailed extends Error {
    readonly reason: string;
    constructor(reason: string, message: string) {
        super(message);
        this.name = 'LxImportFailed';
        this.reason = reason;
    }
}

export interface LxTransportEnv {
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    error(code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails): FoliumSourceError;
}

// main 入口的失败码 → 宿主的错误码。脚本没给出地址、给的地址被出口拦了，都是「这首歌放不了」。
const CODES: Record<string, FoliumSourceErrorCode> = {
    network: 'network',
    'invalid-response': 'invalid-response',
    unavailable: 'unavailable',
    unsupported: 'unsupported',
    blocked: 'not-playable',
    failed: 'not-playable',
};

export interface LxTransport {
    /** 调 main 入口；失败抛宿主的错误。 */
    request<T>(name: string, ...args: unknown[]): Promise<T>;
}

export const createLxTransport = (env: LxTransportEnv): LxTransport => ({
    async request<T>(name: string, ...args: unknown[]): Promise<T> {
        let result: RpcResult<T>;
        try {
            result = await env.call<RpcResult<T>>(name, ...args);
        } catch (error) {
            throw env.error('unavailable', 'LX Music source backend did not answer', { cause: error });
        }
        if (result.ok) return result.data;
        if (result.code.startsWith('import:')) throw new LxImportFailed(result.code.slice('import:'.length), result.message);
        throw env.error(CODES[result.code] ?? 'invalid-response', result.message);
    },
});
