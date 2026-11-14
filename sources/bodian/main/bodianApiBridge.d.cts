// sources/bodian/main/bodianApiBridge.d.cts
// The types of bodianApiBridge.cjs, for main/index.ts (sources/ compiles without allowJs).

import type { BodianOperation, BodianParams, BodianRequestFactory, BodianResult } from 'bodian-music-api';
import type { BodianSafeStorage, BodianStore } from './session.cjs';

export interface BodianApiBridge {
    request(operation: BodianOperation | string, params?: BodianParams): Promise<BodianResult>;
}

export function createBodianApiBridge(options: {
    store: BodianStore;
    safeStorage: BodianSafeStorage;
    requestFactory?: BodianRequestFactory;
    onAudioSource?: (url: string) => void;
    now?: () => number;
    warn?: (...args: unknown[]) => void;
}): BodianApiBridge;
