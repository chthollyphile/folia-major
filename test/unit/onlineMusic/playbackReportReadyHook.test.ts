// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';

// test/unit/onlineMusic/playbackReportReadyHook.test.ts
// The settings page asks through usePlaybackReportReady whether listening reports can be turned
// on. The answer has to follow the account store: an account signing in or out while the page is
// shown changes it. (What the answer is for each kind of provider: playbackReportGate.test.ts.)

vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        getProviderSummaries: () => [{ providerId: 'reports', availability: { configured: true } }],
        getProviderCapabilities: () => ({ playbackReports: true }),
    },
}));

const { usePlaybackReportReady } = await import('@/services/onlineMusic/playbackReportGate');

it('a component that asks whether reports can be turned on hears of an account signing in and out', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const signIn = (...providerIds: string[]) => useOnlineProviderAccountStore.setState({
        accounts: Object.fromEntries(providerIds.map(providerId => [providerId, { status: 'authenticated' }])) as never,
    });
    signIn();
    const answers: boolean[] = [];
    const Asks = () => {
        answers.push(usePlaybackReportReady());
        return null;
    };
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    act(() => root.render(React.createElement(Asks)));
    expect(answers.at(-1)).toBe(false);
    act(() => signIn('reports'));
    expect(answers.at(-1)).toBe(true);
    act(() => signIn());
    expect(answers.at(-1)).toBe(false);
    act(() => root.unmount());
});
