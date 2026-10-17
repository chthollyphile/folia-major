import { OnlineProviderError } from '../../../types/onlineMusic';

// src/services/onlineMusic/soda/sodaTransport.ts

// 汽水的接口只在主进程发出（api.qishui.com 带 Origin 头答 403），这一层是到 electron/soda/sodaApiBridge.cjs
// 的受限 IPC 边界：操作清单在这里，别处不碰 window.electron。

export type SodaOperation =
    | 'search' | 'playlist_search' | 'playlist_detail' | 'share'
    | 'status' | 'login_qr_create' | 'login_qr_poll' | 'logout' | 'profile' | 'membership'
    | 'user_playlists' | 'liked_ids' | 'like'
    | 'playlist_create' | 'playlist_append' | 'playlist_remove';

export interface SodaParams {
    query?: string;
    cursor?: number;
    count?: number;
    limit?: number;
    playlistId?: string;
    trackId?: string;
    token?: string;
    songId?: string;
    liked?: boolean;
    name?: string;
    description?: string;
    trackIds?: string[];
}

export type SodaBridgeResult =
    | { ok: true; data: unknown }
    | { ok: false; error: { code: string; message: string } };

export const SODA_NEEDS_DESKTOP = '汽水音乐需要桌面版';

export const getSodaTransportAvailability = () => (
    typeof window !== 'undefined' && typeof window.electron?.sodaRequest === 'function'
        ? { configured: true } as const
        : { configured: false, reason: 'runtime-unavailable' } as const
);

export async function requestSoda<T = unknown>(operation: SodaOperation, params: SodaParams = {}): Promise<T> {
    if (!getSodaTransportAvailability().configured) {
        throw new OnlineProviderError('unavailable', SODA_NEEDS_DESKTOP, 'soda');
    }
    let result: SodaBridgeResult;
    try {
        result = await window.electron!.sodaRequest(operation, params);
    } catch (error) {
        throw new OnlineProviderError('network', '汽水音乐请求失败', 'soda', error);
    }
    if (!result.ok) throw new OnlineProviderError(result.error.code, result.error.message, 'soda');
    return result.data as T;
}
