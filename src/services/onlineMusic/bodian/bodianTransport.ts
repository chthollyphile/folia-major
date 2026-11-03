import { OnlineProviderError } from '../../../types/onlineMusic';
import type { BodianOperation, BodianParams, BodianResult } from 'bodian-music-api';

// src/services/onlineMusic/bodian/bodianTransport.ts

export type { BodianOperation, BodianParams } from 'bodian-music-api';
export type BodianBridgeResult = BodianResult;

// What a request fails with where this page has no desktop bridge (the web build), and where the bridge
// itself failed (the main process threw). bodianFailure.ts tells both apart by them.
export const BODIAN_NEEDS_DESKTOP = 'Bodian requires the desktop app';
export const BODIAN_BRIDGE_FAILED = 'Bodian desktop request failed';

export const getBodianTransportAvailability = () => (
    typeof window !== 'undefined' && typeof window.electron?.bodianRequest === 'function'
        ? { configured: true } as const
        : { configured: false, reason: 'runtime-unavailable' } as const
);

export async function requestBodian<T = unknown>(operation: BodianOperation, params: BodianParams = {}): Promise<T> {
    if (!getBodianTransportAvailability().configured) {
        throw new OnlineProviderError('unavailable', BODIAN_NEEDS_DESKTOP, 'bodian');
    }
    let result: BodianBridgeResult;
    // Omni consumers request 150/1000-row batches; Bodian serves at most 100 and returns its own cursor.
    const boundedParams = Number.isSafeInteger(params.limit) && Number(params.limit) > 100
        ? { ...params, limit: 100 } : params;
    try { result = await window.electron!.bodianRequest(operation, boundedParams); }
    catch (error) { throw new OnlineProviderError('network', BODIAN_BRIDGE_FAILED, 'bodian', error); }
    // The package's code and sentence go on as they are: bodianFailure.ts says what they mean.
    if (!result.ok) throw new OnlineProviderError(result.error.code, result.error.message, 'bodian');
    return result.data as T;
}
