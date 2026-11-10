// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/hooks/useAudioOutputDevice.test.ts
// The chosen output device is put back on every new source without asking anyone. When that fails the
// sound comes out of the system default while the settings still name the chosen device: say so, once
// per device, and say again only after it worked or another device was chosen.

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key), clear: () => values.clear(),
    } });
});

vi.mock('react-i18next', async importOriginal => ({
    ...await importOriginal<typeof import('react-i18next')>(),
    useTranslation: () => ({ t: (key: string) => key }),
}));

const { useAudioOutputDevice } = await import('@/hooks/useAudioOutputDevice');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

type SinkElement = HTMLAudioElement & { sinkId: string; setSinkId: (id: string) => Promise<void> };

const notFound = () => Object.assign(new DOMException('Requested device not found', 'NotFoundError'));

const mountWith = (setSinkId: (id: string) => Promise<void>) => {
    const element = document.createElement('audio') as SinkElement;
    element.sinkId = '';
    element.setSinkId = vi.fn(setSinkId);
    const audioRef = { current: element };
    function Probe() {
        useAudioOutputDevice({ audioRef, audioContextRef: { current: null }, gainNodeRef: { current: null } });
        return null;
    }
    root = createRoot(document.createElement('div'));
    act(() => root!.render(React.createElement(Probe)));
    return element;
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const message = () => useStatusMessageStore.getState().message;

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useStatusMessageStore.setState({ message: null });
    usePlaybackStore.setState({ audioSrc: 'blob:one' });
});

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    vi.restoreAllMocks();
});

describe('useAudioOutputDevice', () => {
    it('says once that a device it could not put back is missing, and that the default plays instead', async () => {
        useAudioSettingsStore.setState({ audioOutputDeviceId: 'dac-gone' });
        const element = mountWith(async () => { throw notFound(); });
        await act(flush);
        expect(element.setSinkId).toHaveBeenCalledWith('dac-gone');
        expect(message()).toEqual({ type: 'error', text: 'options.audioOutputMissing', note: 'options.audioOutputFallbackNote' });

        // The next source tries again, quietly this time.
        useStatusMessageStore.setState({ message: null });
        await act(async () => {
            element.dispatchEvent(new Event('loadedmetadata'));
            await flush();
        });
        expect(element.setSinkId).toHaveBeenCalledTimes(2);
        expect(message()).toBeNull();
    });

    it('calls any other failure a device it could not switch to', async () => {
        useAudioSettingsStore.setState({ audioOutputDeviceId: 'dac-held' });
        mountWith(async () => { throw new DOMException('The operation could not be performed', 'NotAllowedError'); });
        await act(flush);
        expect(message()).toEqual({ type: 'error', text: 'options.audioOutputNotApplied', note: 'options.audioOutputFallbackNote' });
    });
});
