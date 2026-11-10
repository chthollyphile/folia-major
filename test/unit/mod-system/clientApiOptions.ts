import type { FoliumClientApiOptions } from '@/mods/folium/api';
import type { FoliumContextKind } from '@/mods/folium/contract';

// test/unit/mod-system/clientApiOptions.ts
// The options createFoliumClientApi requires, with nothing behind them: no experimental surfaces,
// releases dropped, never stopped. A test that builds a client API by hand starts from these and
// overrides what it is about.
export const clientApiOptions = (
    context: FoliumContextKind,
    overrides: Partial<Omit<FoliumClientApiOptions, 'context'>> = {},
): FoliumClientApiOptions => ({
    context,
    experimental: {},
    onRelease: () => {},
    stopped: () => false,
    ...overrides,
});
