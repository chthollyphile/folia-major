import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ProviderErrorCode } from '../../../types/onlineMusic';
import type { QishuiOperation, QishuiParams, QishuiBridgeResult } from 'qishui-music-api';

// Typed renderer boundary for the car bridge; credentials and player models stay in the main process.
export type { QishuiOperation, QishuiParams, QishuiBridgeResult } from 'qishui-music-api';
// What a request fails with where this page has no desktop bridge (the web build), and where the bridge
// itself failed (the main process threw). qishuiFailure.ts tells both apart by them.
export const QISHUI_NEEDS_DESKTOP = 'Qishui requires the desktop app';
export const QISHUI_BRIDGE_FAILED = 'Qishui desktop request failed';
const STAGES = ['access-code', 'ticket', 'account'] as const;
export type QishuiLoginStage = typeof STAGES[number];
// The last failure of a sign-in operation (login_*), for the sign-in diagnostics. Other requests made
// while signing in (lyrics, radio, covers) are not the sign-in's, and are not kept here.
let lastFailure: { stage: QishuiLoginStage | null; code: ProviderErrorCode; upstreamCode?: string } | null = null;
export const getQishuiLastFailure = () => lastFailure;
const isLoginOperation = (operation: QishuiOperation) => operation.startsWith('login_');
export class QishuiRequestError extends OnlineProviderError {
    constructor(code: ProviderErrorCode, message: string, public readonly stage: QishuiLoginStage | null, public readonly upstreamCode?: string) {
        super(code, message, 'qishui');
    }
}
const getWebApiBase = (): string => {
    const viteValue = typeof import.meta !== 'undefined' && import.meta.env?.MODE !== 'test'
        ? String((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_QISHUI_API_BASE || '')
        : '';
    const processValue = typeof process !== 'undefined'
        ? String(process.env?.VITE_QISHUI_API_BASE || '')
        : '';
    const value = viteValue || processValue;
    return value.trim().replace(/\/$/, '');
};

export const QISHUI_API_BASE_MISSING = 'VITE_QISHUI_API_BASE is not configured';

export const getQishuiAvailability = () => {
    if (typeof window !== 'undefined' && typeof window.electron?.qishuiRequest === 'function') {
        return { configured: true } as const;
    }
    return getWebApiBase()
        ? { configured: true } as const
        : { configured: false, reason: 'runtime-unavailable' } as const;
};

async function handleBridgeResult<T>(result: QishuiBridgeResult, operation: QishuiOperation): Promise<T> {
    if (!result.ok) {
        const stage = STAGES.find(stage => stage === result.error.stage) ?? null;
        const upstreamCode = typeof result.error.upstreamCode === 'string' && /^\d{1,12}$/.test(result.error.upstreamCode) ? result.error.upstreamCode : undefined;
        if (isLoginOperation(operation)) lastFailure = { stage, code: result.error.code, upstreamCode };
        throw new QishuiRequestError(result.error.code, result.error.message, stage, upstreamCode);
    }
    return result.data as T;
}

export async function requestQishui<T = unknown>(operation: QishuiOperation, params: QishuiParams = {}): Promise<T> {
    if (operation === 'login_qr_key') lastFailure = null;
    if (!getQishuiAvailability().configured) {
        throw new OnlineProviderError('unavailable', QISHUI_NEEDS_DESKTOP, 'qishui');
    }

    // Electron desktop: route through the main-process bridge.
    if (typeof window !== 'undefined' && typeof window.electron?.qishuiRequest === 'function') {
        let result: QishuiBridgeResult;
        try { result = await window.electron!.qishuiRequest(operation, params); }
        catch (error) { throw new OnlineProviderError('network', QISHUI_BRIDGE_FAILED, 'qishui', error); }
        return handleBridgeResult<T>(result, operation);
    }

    // Web build: call the self-hosted qishui-api HTTP service.
    const base = getWebApiBase();
    if (!base) {
        throw new OnlineProviderError('unavailable', QISHUI_API_BASE_MISSING, 'qishui');
    }
    let response: Response;
    try {
        response = await fetch(`${base}/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ operation, params }),
        });
    } catch (error) {
        throw new OnlineProviderError('network', 'Qishui web API request failed', 'qishui', error);
    }
    if (!response.ok) {
        throw new OnlineProviderError('network', `Qishui web API returned ${response.status}`, 'qishui');
    }
    let result: QishuiBridgeResult;
    try {
        result = await response.json() as QishuiBridgeResult;
    } catch (error) {
        throw new OnlineProviderError('invalid-response', 'Qishui web API returned an unreadable body', 'qishui', error);
    }
    return handleBridgeResult<T>(result, operation);
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
