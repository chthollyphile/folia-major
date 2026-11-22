// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/hooks/startupSourcesPrompt.test.ts
// Folium 2.0 S8: the start sequence asks the main process whether a fresh profile owes the sources page and opens the
// prompt with that page first; under the dev shortcut `?skipStartup` it neither asks nor opens, so nothing is recorded
// and every source stays enabled.

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key), clear: () => values.clear(),
    } });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const flags = vi.hoisted(() => ({ skipsStartupExperience: false }));
vi.mock('@/dev/devLaunchFlags', () => flags);

const ipc = vi.hoisted(() => ({
    getSourceStates: vi.fn(async () => ({
        states: {},
        sources: [{ sourceId: 'a', modId: 'a', tier: 'builtin', state: 'enabled', keepForMatching: true, takeover: false, loaded: true, mainState: 'ready' }],
        hasSourceMods: true,
        sourcesOnboarding: true,
    })),
    invokeAnswerSourcesOnboarding: vi.fn(),
}));
vi.mock('@/mods/ipc', () => ipc);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const mountGate = async () => {
    const { useStartupExperienceGate } = await import('@/hooks/useStartupExperienceGate');
    const Gate = () => {
        useStartupExperienceGate();
        return null;
    };
    container = document.createElement('div');
    root = createRoot(container);
    await act(async () => {
        root!.render(React.createElement(Gate));
    });
    // The main process's answer, then the effect that opens the prompt.
    await act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
    vi.resetModules();
    ipc.getSourceStates.mockClear();
    vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container = null;
    vi.restoreAllMocks();
});

describe('the sources page in the start sequence', () => {
    it('opens the prompt with the sources page first when a fresh profile owes it', async () => {
        flags.skipsStartupExperience = false;
        await mountGate();
        const { usePlaybackEntryViewStore } = await import('@/stores/usePlaybackEntryViewStore');
        expect(ipc.getSourceStates).toHaveBeenCalledTimes(1);
        expect(usePlaybackEntryViewStore.getState().isPlaybackEntryViewPromptOpen).toBe(true);
        expect(usePlaybackEntryViewStore.getState().promptPages[0]).toBe('sources');
    });

    it('under ?skipStartup neither asks the main process nor opens anything', async () => {
        flags.skipsStartupExperience = true;
        await mountGate();
        const { usePlaybackEntryViewStore } = await import('@/stores/usePlaybackEntryViewStore');
        expect(ipc.getSourceStates).not.toHaveBeenCalled();
        expect(usePlaybackEntryViewStore.getState().isPlaybackEntryViewPromptOpen).toBe(false);
        expect(ipc.invokeAnswerSourcesOnboarding).not.toHaveBeenCalled();
    });
});
