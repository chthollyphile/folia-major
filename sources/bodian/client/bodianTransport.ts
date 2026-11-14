import type { FoliumSourceError, FoliumSourceErrorCode, FoliumSourceErrorDetails } from '@folia/folium';
import type { BodianOperation, BodianParams, BodianResult } from 'bodian-music-api';

// sources/bodian/client/bodianTransport.ts
// 波点的请求：经 folium.rpc 交给 main 入口（main/index.ts 登记的 `request`），那边调 bodian-music-api。
// 包的错误码和原话原样交给宿主读（folium.sources.error），bodianFailure.ts 说它们的意思。

export type { BodianOperation, BodianParams } from 'bodian-music-api';
export type BodianBridgeResult = BodianResult;

// What a request fails with where the bridge itself failed (the main entry threw, or is not there):
// bodianFailure.ts tells it apart by it.
export const BODIAN_BRIDGE_FAILED = 'Bodian desktop request failed';

/** What the transport needs of the host: the main entry, and the host's errors. activate (index.ts) hands it in. */
export interface BodianTransportEnv {
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    error(code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails): FoliumSourceError;
}

let env: BodianTransportEnv | null = null;

/** Connects the transport to the host; the last one given is used. */
export const connectBodianTransport = (next: BodianTransportEnv): void => {
    env = next;
};

const host = (): BodianTransportEnv => {
    if (!env) throw new Error('[Bodian] the transport is not connected (activate has not run)');
    return env;
};

// The codes the host reads; the package gives only these (bodian-music-api@0.1.2, src/*.cjs). One it might add
// later is read as an answer that could not be read, as the host would not know it either.
const CODES: ReadonlySet<string> = new Set<FoliumSourceErrorCode>([
    'auth-required', 'unsupported', 'not-public', 'unavailable', 'not-playable', 'preview-only',
    'subscription-required', 'region-restricted', 'network', 'invalid-response',
]);

/** An error of the host's, with Bodian's code (or `invalid-response` for one the host does not know) and sentence. */
export const bodianError = (code: string, message: string, cause?: unknown): FoliumSourceError => (
    host().error(CODES.has(code) ? code as FoliumSourceErrorCode : 'invalid-response', message, cause === undefined ? undefined : { cause })
);

export async function requestBodian<T = unknown>(operation: BodianOperation, params: BodianParams = {}): Promise<T> {
    const transport = host();
    let result: BodianBridgeResult;
    // Omni consumers request 150/1000-row batches; Bodian serves at most 100 and returns its own cursor.
    const boundedParams = Number.isSafeInteger(params.limit) && Number(params.limit) > 100
        ? { ...params, limit: 100 } : params;
    try { result = await transport.call<BodianBridgeResult>('request', operation, boundedParams); }
    catch (error) { throw bodianError('network', BODIAN_BRIDGE_FAILED, error); }
    // The package's code and sentence go on as they are: bodianFailure.ts says what they mean.
    if (!result.ok) throw bodianError(result.error.code, result.error.message);
    return result.data as T;
}
