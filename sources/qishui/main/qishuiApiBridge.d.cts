// sources/qishui/main/qishuiApiBridge.d.cts
// The types of qishuiApiBridge.cjs, for main/index.ts (sources/ compiles without allowJs).

import type { QishuiApiOptions, QishuiBridgeResult, QishuiOperation, QishuiParams } from 'qishui-music-api';
import type { QishuiSafeStorage, QishuiStore } from './session.cjs';

export interface QishuiApiBridge {
    request(operation: QishuiOperation | string, params?: QishuiParams): Promise<QishuiBridgeResult>;
}

export function createQishuiApiBridge(options: {
    store: QishuiStore;
    safeStorage: QishuiSafeStorage;
    /** The web fetch the package's requests go out through; the bridge adds `credentials: 'omit'` to each. */
    fetch?: (url: string, options?: Record<string, unknown>) => Promise<Response>;
    log?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    onAudioSource?: (url: string) => void;
    apiFactory?: (options: QishuiApiOptions) => { request(operation: QishuiOperation, params?: QishuiParams): Promise<QishuiBridgeResult> };
}): QishuiApiBridge;
