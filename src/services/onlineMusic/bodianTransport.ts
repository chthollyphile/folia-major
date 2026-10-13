import { OnlineProviderError } from '../../types/onlineMusic';
import type { BodianOperation, BodianParams, BodianResult } from 'bodian-music-api';
import { toBodianProviderError } from './bodianErrors';

// src/services/onlineMusic/bodianTransport.ts

export type { BodianOperation, BodianParams } from 'bodian-music-api';
export type BodianBridgeResult = BodianResult;

export const getBodianTransportAvailability = () => (
    typeof window !== 'undefined' && typeof window.electron?.bodianRequest === 'function'
        ? { configured: true } as const
        : { configured: false, reason: 'runtime-unavailable' } as const
);

export async function requestBodian<T = unknown>(operation: BodianOperation, params: BodianParams = {}): Promise<T> {
    if (!getBodianTransportAvailability().configured) {
        // 网页版没有桌面桥：重试不会变好，transient:false 让播放侧显示「未配置」而不是「稍后再试」。
        throw new OnlineProviderError('unavailable', 'Bodian requires the desktop app', 'bodian',
            undefined, undefined, undefined, { stage: 'runtime', transient: false });
    }
    let result: BodianBridgeResult;
    // Omni consumers request 150/1000-row batches; Bodian serves at most 100 and returns its own cursor.
    const boundedParams = Number.isSafeInteger(params.limit) && Number(params.limit) > 100
        ? { ...params, limit: 100 } : params;
    try { result = await window.electron!.bodianRequest(operation, boundedParams); }
    // IPC 被拒是本地桌面进程的故障，不是网络故障。
    catch (error) {
        throw new OnlineProviderError('unavailable', 'Bodian desktop request failed', 'bodian',
            error, undefined, undefined, { stage: 'ipc' });
    }
    // 包的 message 模板在 bodianErrors.ts 细分；auth-required 始终原样保留，useBodianLibrary 靠它清理会话。
    if (!result.ok) throw toBodianProviderError(result.error);
    return result.data as T;
}
