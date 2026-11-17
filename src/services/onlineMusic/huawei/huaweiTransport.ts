import type { ProviderErrorCode } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { notifyProviderSessionChanged } from '../account/sessionChanges';

// src/services/onlineMusic/huawei/huaweiTransport.ts

export type HuaweiOperation =
    | 'login_start' | 'login_open' | 'login_check' | 'login_cancel' | 'login_status' | 'logout'
    | 'search' | 'album' | 'artist' | 'audio' | 'song_detail' | 'lyrics'
    | 'library_playlists' | 'library_albums' | 'playlist_tracks' | 'recommendations' | 'similar_songs';

export type HuaweiParams = Record<string, unknown>;

export interface HuaweiBridgeError {
    code: string;
    message: string;
    upstreamCode?: string;
    httpStatus?: number;
}

export type HuaweiBridgeResult = (
    | { ok: true; data: unknown }
    | { ok: false; error: HuaweiBridgeError }
) & { sessionEnded?: boolean };

export const HUAWEI_NEEDS_DESKTOP = 'Huawei Music requires the desktop app';
export const HUAWEI_BRIDGE_FAILED = 'Huawei Music desktop request failed';

const PROVIDER_ERROR_CODES: ReadonlySet<string> = new Set<ProviderErrorCode>([
    'auth-required', 'unsupported', 'not-public', 'unavailable', 'not-playable', 'preview-only',
    'subscription-required', 'region-restricted', 'network', 'invalid-response',
]);

const toProviderErrorCode = (code: string): ProviderErrorCode => (
    PROVIDER_ERROR_CODES.has(code) ? code as ProviderErrorCode : 'invalid-response'
);

export const getHuaweiTransportAvailability = () => (
    typeof window !== 'undefined' && typeof window.electron?.huaweiRequest === 'function'
        ? { configured: true } as const
        : { configured: false, reason: 'runtime-unavailable' } as const
);

export async function requestHuawei<T = unknown>(operation: HuaweiOperation, params: HuaweiParams = {}): Promise<T> {
    if (!getHuaweiTransportAvailability().configured) {
        throw new OnlineProviderError('unavailable', HUAWEI_NEEDS_DESKTOP, 'huawei');
    }
    const bridge = window.electron?.huaweiRequest;
    if (typeof bridge !== 'function') {
        throw new OnlineProviderError('unavailable', HUAWEI_NEEDS_DESKTOP, 'huawei');
    }
    let result: HuaweiBridgeResult;
    try {
        result = await bridge(operation, params);
    } catch (error) {
        throw new OnlineProviderError('network', HUAWEI_BRIDGE_FAILED, 'huawei', error);
    }
    if (!result.ok) {
        if (result.sessionEnded) notifyProviderSessionChanged('huawei');
        throw new OnlineProviderError(
            toProviderErrorCode(result.error.code),
            result.error.message || 'Huawei Music request failed',
            'huawei',
            { upstreamCode: result.error.upstreamCode, httpStatus: result.error.httpStatus },
            result.error.httpStatus,
        );
    }
    if (result.sessionEnded) notifyProviderSessionChanged('huawei');
    return result.data as T;
}
