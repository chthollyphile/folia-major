// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// test/unit/hooks/useAccountReads.test.ts
// The start-up account read (Folium 2.0 plan §2 item 3, §7 row 3): a platform that registers after the app
// started has its account read when it registers, once; the ones there at the start are not read again.

const summaries: Array<{ providerId: string; requiresAccount?: boolean }> = [];
const providerListeners = new Set<() => void>();
const readAccount = vi.fn(async () => undefined);

vi.mock('@/i18n/config', () => ({ default: { t: (key: string) => key, on: () => {}, language: 'en' } }));
vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        getProviderSummaries: () => summaries.map(summary => ({ ...summary })),
        getActiveProviderSummary: () => undefined,
        subscribeProviders: (listener: () => void) => {
            providerListeners.add(listener);
            return () => { providerListeners.delete(listener); };
        },
        readAccount,
        accountMoment: async () => undefined,
        songsInPlay: () => undefined,
    },
}));

const { useAccountReads } = await import('@/hooks/useAccountReads');

const Probe = () => {
    useAccountReads();
    return null;
};

const announce = () => providerListeners.forEach(listener => listener());

describe('useAccountReads · the start-up read', () => {
    let root: Root | null = null;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        summaries.splice(0, summaries.length, { providerId: 'netease', requiresAccount: true }, { providerId: 'modo', requiresAccount: false });
        readAccount.mockClear();
    });

    afterEach(() => {
        act(() => root?.unmount());
        root = null;
    });

    it('reads every platform with accounts at the start, and one that registers later when it registers', () => {
        root = createRoot(document.createElement('div'));
        act(() => root!.render(React.createElement(Probe)));
        expect(readAccount.mock.calls).toEqual([['netease', 'start']]);

        summaries.push({ providerId: 'qq', requiresAccount: true });
        act(() => announce());
        expect(readAccount.mock.calls).toEqual([['netease', 'start'], ['qq', 'start']]);

        // Another change of the list (a platform going away) reads nobody again.
        summaries.splice(1, 1);
        act(() => announce());
        expect(readAccount).toHaveBeenCalledTimes(2);
    });

    it('stops listening for platforms once unmounted', () => {
        root = createRoot(document.createElement('div'));
        act(() => root!.render(React.createElement(Probe)));
        act(() => root!.unmount());
        root = null;
        expect(providerListeners.size).toBe(0);
    });
});
