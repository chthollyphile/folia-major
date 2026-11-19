import type { FoliumSourceError, FoliumSourceErrorCode, FoliumSourceErrorDetails } from '@folia/folium';
import type { QishuiOperation, QishuiParams, QishuiBridgeResult } from 'qishui-music-api';

// sources/qishui/client/qishuiTransport.ts
// 汽水的请求：经 folium.rpc 交给 main 入口（main/index.ts 登记的 `request`），那边调 qishui-music-api；凭据和
// 车机协议都留在主进程。包的错误码和原话原样交给宿主读（folium.sources.error），登录的阶段和平台自己的错误号
// 挂在错误的 cause 上（qishuiRefusalOf），qishuiFailure.ts 与登录失败的归类读它们。

export type { QishuiOperation, QishuiParams, QishuiBridgeResult } from 'qishui-music-api';

// What a request fails with where the bridge itself failed (the main entry threw, or is not there):
// qishuiFailure.ts tells it apart by it.
export const QISHUI_BRIDGE_FAILED = 'Qishui desktop request failed';
const STAGES = ['access-code', 'ticket', 'account'] as const;
export type QishuiLoginStage = typeof STAGES[number];

/** What the transport needs of the host: the main entry, and the host's errors. activate (index.ts) hands it in. */
export interface QishuiTransportEnv {
    call<T>(name: string, ...args: unknown[]): Promise<T>;
    error(code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails): FoliumSourceError;
}

let env: QishuiTransportEnv | null = null;

/** Connects the transport to the host; the last one given is used. */
export const connectQishuiTransport = (next: QishuiTransportEnv): void => {
    env = next;
};

const host = (): QishuiTransportEnv => {
    if (!env) throw new Error('[Qishui] the transport is not connected (activate has not run)');
    return env;
};

// The codes the host reads; the package gives only these (qishui-music-api@0.2.2, src/*.cjs). One it might add
// later is read as an answer that could not be read, as the host would not know it either.
const CODES: ReadonlySet<string> = new Set<FoliumSourceErrorCode>([
    'auth-required', 'unsupported', 'not-public', 'unavailable', 'not-playable', 'preview-only',
    'subscription-required', 'region-restricted', 'network', 'invalid-response',
]);

/**
 * What the package said besides its code and sentence when it refused: the sign-in stage that failed and the
 * platform's own error number. Rides on the error as its `cause`, which the host keeps when it names the source on
 * the error (a new object), so it is recognised by identity here, not by the error.
 */
export interface QishuiRefusal {
    readonly stage: QishuiLoginStage | null;
    readonly upstreamCode?: string;
}
const refusals = new WeakSet();

/** The refusal an error of a Qishui request carries, or null for any other error. */
export const qishuiRefusalOf = (error: unknown): QishuiRefusal | null => {
    const cause: unknown = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
    return typeof cause === 'object' && cause !== null && refusals.has(cause) ? cause as QishuiRefusal : null;
};

/** An error of the host's, with Qishui's code (or `invalid-response` for one the host does not know) and sentence. */
export const qishuiError = (code: string, message: string, cause?: unknown): FoliumSourceError => (
    host().error(CODES.has(code) ? code as FoliumSourceErrorCode : 'invalid-response', message, cause === undefined ? undefined : { cause })
);

// The last failure of a sign-in operation (login_*), for the sign-in diagnostics. Other requests made
// while signing in (lyrics, radio, covers) are not the sign-in's, and are not kept here.
let lastFailure: { stage: QishuiLoginStage | null; code: string; upstreamCode?: string } | null = null;
export const getQishuiLastFailure = () => lastFailure;
const isLoginOperation = (operation: QishuiOperation) => operation.startsWith('login_');

export async function requestQishui<T = unknown>(operation: QishuiOperation, params: QishuiParams = {}): Promise<T> {
    const transport = host();
    if (operation === 'login_qr_key') lastFailure = null;
    let result: QishuiBridgeResult;
    try { result = await transport.call<QishuiBridgeResult>('request', operation, params); }
    catch (error) { throw qishuiError('network', QISHUI_BRIDGE_FAILED, error); }
    if (!result.ok) {
        const stage = STAGES.find(stage => stage === result.error.stage) ?? null;
        const upstreamCode = typeof result.error.upstreamCode === 'string' && /^\d{1,12}$/.test(result.error.upstreamCode) ? result.error.upstreamCode : undefined;
        const code = CODES.has(result.error.code) ? result.error.code : 'invalid-response';
        if (isLoginOperation(operation)) lastFailure = { stage, code, upstreamCode };
        const refusal: QishuiRefusal = Object.freeze({ stage, ...(upstreamCode ? { upstreamCode } : {}) });
        refusals.add(refusal);
        throw qishuiError(code, result.error.message, refusal);
    }
    return result.data as T;
}

// The image type the bytes themselves say, for the formats a scene icon comes in; null when they say none of them.
function sniffImageType(bytes: Uint8Array): string | null {
    const starts = (...head: number[]) => head.every((byte, index) => bytes[index] === byte);
    if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
    if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
    if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
    if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return null;
}
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

// Scene artwork is public CDN content; it is fetched without any account headers or cookies.
// The data URL carries the image's own type: the CDN's template decides the format, not the address.
// The window reads it (the main entry's media rule lets an image read on the CDN's hosts through, mediaCors.cjs).
export async function readQishuiSceneIcon(raw: string): Promise<string> {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !/(?:^|\.)douyinpic\.com$/.test(url.hostname) || url.username || url.password) {
        throw new Error('Invalid scene artwork URL');
    }
    const response = await fetch(url.href, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000) });
    const declared = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (!response.ok || !declared.startsWith('image/')) throw new Error('Scene artwork is unavailable');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 512 * 1024) throw new Error('Scene artwork is too large');
    const type = sniffImageType(bytes) ?? (RASTER_TYPES.has(declared) ? declared : null);
    if (!type) throw new Error('Scene artwork is not a raster image');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:${type};base64,${btoa(binary)}`;
}
