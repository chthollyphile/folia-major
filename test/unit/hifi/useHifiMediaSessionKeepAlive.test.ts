// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/hifi/useHifiMediaSessionKeepAlive.test.ts
// HiFi 路线上的媒体会话保活（findings #9 / #30）：静音 WAV 的格式，什么时候算独占输出、什么时候放 / 停 / 拿掉，
// 保活元素本身（音量 0 而不是静音、循环、不是 deck、撤掉 Blob URL），以及挂在 App 里时跟着路线和 mpv 的播放状态走。

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key), clear: () => values.clear(),
    } });
});

const {
    KEEP_ALIVE_ATTRIBUTE,
    buildSilentWav,
    createMediaSessionKeepAlive,
    isExclusiveHifiOutput,
    keepAliveAction,
    useHifiMediaSessionKeepAlive,
} = await import('@/components/hifi/useHifiMediaSessionKeepAlive');
const { PLAYBACK_DECK_ATTRIBUTE } = await import('@/components/hifi/useWebEngineYield');
const { hifiMediaShim } = await import('@/services/hifi/hifiMediaShim');
const { useHifiTrackStore } = await import('@/services/hifi/hifiTrackStore');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useHifiSettingsStore } = await import('@/stores/useHifiSettingsStore');
const { useHifiMprisStatusStore } = await import('@/components/hifi/useHifiMpris');

const keepAliveElement = () => document.querySelector<HTMLAudioElement>(`audio[${KEEP_ALIVE_ATTRIBUTE}]`);

let playSpy: ReturnType<typeof vi.fn>;
let pauseSpy: ReturnType<typeof vi.fn>;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;
let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // jsdom's media elements never play: play / pause / load become state the test can read.
    const pausedOf = new WeakMap<HTMLMediaElement, boolean>();
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (this: HTMLMediaElement) {
        return pausedOf.get(this) ?? true;
    });
    playSpy = vi.fn(function (this: HTMLMediaElement) { pausedOf.set(this, false); return Promise.resolve(); });
    pauseSpy = vi.fn(function (this: HTMLMediaElement) { pausedOf.set(this, true); });
    HTMLMediaElement.prototype.play = playSpy as unknown as HTMLMediaElement['play'];
    HTMLMediaElement.prototype.pause = pauseSpy as unknown as HTMLMediaElement['pause'];
    HTMLMediaElement.prototype.load = vi.fn();
    createObjectURL = vi.fn(() => 'blob:silence');
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    (window as unknown as { electron?: unknown }).electron = { platform: 'linux' };
    usePlaybackStore.setState({ playbackRoute: 'web' });
    useHifiSettingsStore.setState({ exclusive: true, audioDevice: 'auto' });
    useHifiTrackStore.setState({ current: null });
    useHifiMprisStatusStore.setState({ registered: null });
    hifiMediaShim.reset();
});

afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    hifiMediaShim.reset();
    document.body.innerHTML = '';
    delete (window as unknown as { electron?: unknown }).electron;
    vi.restoreAllMocks();
});

describe('buildSilentWav', () => {
    it('is a 44.1 kHz 16-bit mono PCM WAV of silence, longer than 5 s', () => {
        const wav = buildSilentWav();
        const view = new DataView(wav);
        const ascii = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(wav, offset, length));
        expect(ascii(0, 4)).toBe('RIFF');
        expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
        expect(ascii(8, 4)).toBe('WAVE');
        expect(ascii(12, 4)).toBe('fmt ');
        expect(view.getUint16(20, true)).toBe(1);
        expect(view.getUint16(22, true)).toBe(1);
        expect(view.getUint32(24, true)).toBe(44100);
        expect(view.getUint32(28, true)).toBe(88200);
        expect(view.getUint16(32, true)).toBe(2);
        expect(view.getUint16(34, true)).toBe(16);
        expect(ascii(36, 4)).toBe('data');
        const dataBytes = view.getUint32(40, true);
        expect(dataBytes).toBe(wav.byteLength - 44);
        expect(dataBytes / 88200).toBeGreaterThan(5);
        expect(new Uint8Array(wav, 44).every(byte => byte === 0)).toBe(true);
    });
});

describe('isExclusiveHifiOutput', () => {
    it.each([
        ['win32', true, 'auto', true],
        ['win32', false, 'wasapi/{guid}', false],
        ['darwin', true, 'auto', true],
        ['darwin', false, 'coreaudio/BuiltIn', false],
        // PipeWire / PulseAudio mix whatever the switch says: a Chromium stream next to mpv is fine.
        ['linux', true, 'auto', false],
        ['linux', true, 'pipewire/alsa_output.usb', false],
        ['linux', false, 'alsa/hw:CARD=D10,DEV=0', true],
        ['linux', true, 'ALSA/hw:1,0', true],
        ['linux', true, 'alsa/default', false],
        [null, true, 'auto', false],
    ] as const)('%s, exclusive %s, %s → %s', (platform, exclusive, audioDevice, expected) => {
        expect(isExclusiveHifiOutput({ platform, exclusive, audioDevice })).toBe(expected);
    });
});

describe('keepAliveAction', () => {
    it.each([
        ['web', true, false, 'remove'],
        ['web', false, false, 'remove'],
        ['hifi', true, false, 'play'],
        ['hifi', false, false, 'pause'],
        ['hifi', true, true, 'remove'],
        ['hifi', false, true, 'remove'],
    ] as const)('route %s, playing %s, exclusive %s → %s', (route, enginePlaying, exclusiveOutput, expected) => {
        expect(keepAliveAction({ route, enginePlaying, exclusiveOutput })).toBe(expected);
    });

    it('removes it whenever main gives the system media controls (Linux MPRIS), playing or not', () => {
        expect(keepAliveAction({ route: 'hifi', enginePlaying: true, exclusiveOutput: false, mainProcessMediaControls: true })).toBe('remove');
        expect(keepAliveAction({ route: 'hifi', enginePlaying: false, exclusiveOutput: false, mainProcessMediaControls: true })).toBe('remove');
    });
});

describe('createMediaSessionKeepAlive', () => {
    it('builds its own hidden looping element at volume 0, not muted and not a deck, on the first play', () => {
        const keepAlive = createMediaSessionKeepAlive();
        expect(keepAlive.element()).toBeNull();
        expect(createObjectURL).not.toHaveBeenCalled();

        keepAlive.play();

        const element = keepAliveElement();
        expect(element).toBe(keepAlive.element());
        expect(element?.parentElement).toBe(document.body);
        expect(element?.hidden).toBe(true);
        expect(element?.loop).toBe(true);
        expect(element?.volume).toBe(0);
        // Chromium registers no media session for a muted element; volume 0 does register.
        expect(element?.muted).toBe(false);
        expect(element?.hasAttribute(PLAYBACK_DECK_ATTRIBUTE)).toBe(false);
        expect(element?.getAttribute('src')).toBe('blob:silence');
        expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe('audio/wav');
        expect(playSpy).toHaveBeenCalledOnce();

        keepAlive.play();
        expect(playSpy).toHaveBeenCalledOnce();
        expect(createObjectURL).toHaveBeenCalledOnce();
    });

    it('pauses, and on remove stops, unloads, detaches and revokes its URL', () => {
        const keepAlive = createMediaSessionKeepAlive();
        keepAlive.play();
        const element = keepAlive.element()!;

        keepAlive.pause();
        expect(element.paused).toBe(true);

        keepAlive.remove();
        expect(element.isConnected).toBe(false);
        expect(element.hasAttribute('src')).toBe(false);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:silence');
        expect(keepAlive.element()).toBeNull();

        keepAlive.remove();
        expect(revokeObjectURL).toHaveBeenCalledOnce();
    });

    it('logs a refused start and stays quiet about a play the next pause cut short', async () => {
        const warn = vi.mocked(console.warn);
        playSpy.mockImplementationOnce(() => Promise.reject(new DOMException('aborted', 'AbortError')));
        const keepAlive = createMediaSessionKeepAlive();
        keepAlive.play();
        await Promise.resolve();
        await Promise.resolve();
        expect(warn).not.toHaveBeenCalled();

        keepAlive.remove();
        playSpy.mockImplementationOnce(() => Promise.reject(new DOMException('no gesture', 'NotAllowedError')));
        createMediaSessionKeepAlive().play();
        await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[HiFi] the media session keep-alive could not start', expect.any(DOMException)));
    });
});

describe('useHifiMediaSessionKeepAlive', () => {
    const mount = () => {
        function Probe() {
            useHifiMediaSessionKeepAlive();
            return null;
        }
        root = createRoot(document.createElement('div'));
        act(() => root!.render(React.createElement(Probe)));
    };
    /** A HiFi track as beginHifiTrack shows it: the route on hifi, the shim on its trackKey. */
    const showHifiTrack = (trackKey: string) => act(() => {
        hifiMediaShim.beginTrack(trackKey);
        useHifiTrackStore.setState({ current: { trackKey, songKey: 'local:1', origin: 'local', song: {} as never, localSourceKey: 'k' } as never });
        usePlaybackStore.setState({ playbackRoute: 'hifi' });
    });

    it('plays while mpv plays, pauses with it, and goes away when the route leaves HiFi', () => {
        useHifiSettingsStore.setState({ exclusive: false });
        mount();
        expect(keepAliveElement()).toBeNull();

        showHifiTrack('t1');
        // Loaded, not playing yet: nothing has to keep a session alive.
        expect(keepAliveElement()).toBeNull();

        act(() => hifiMediaShim.markPlaying());
        expect(keepAliveElement()?.paused).toBe(false);

        act(() => hifiMediaShim.markPaused());
        expect(keepAliveElement()?.paused).toBe(true);

        act(() => hifiMediaShim.markPlaying());
        expect(keepAliveElement()?.paused).toBe(false);

        act(() => hifiMediaShim.markEnded());
        expect(keepAliveElement()?.paused).toBe(true);

        act(() => {
            hifiMediaShim.reset();
            useHifiTrackStore.setState({ current: null });
            usePlaybackStore.setState({ playbackRoute: 'web' });
        });
        expect(keepAliveElement()).toBeNull();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:silence');
    });

    it('stops when the next HiFi track takes over before it plays', () => {
        useHifiSettingsStore.setState({ exclusive: false });
        mount();
        showHifiTrack('t1');
        act(() => hifiMediaShim.markPlaying());
        expect(keepAliveElement()?.paused).toBe(false);

        // beginTrack fires no event of its own.
        showHifiTrack('t2');
        expect(keepAliveElement()?.paused).toBe(true);
    });

    it('never opens a Chromium stream next to an exclusive output (Windows, macOS, ALSA hw:)', () => {
        (window as unknown as { electron?: unknown }).electron = { platform: 'win32' };
        useHifiSettingsStore.setState({ exclusive: true });
        mount();
        showHifiTrack('t1');
        act(() => hifiMediaShim.markPlaying());
        expect(keepAliveElement()).toBeNull();
        expect(playSpy).not.toHaveBeenCalled();

        // Shared WASAPI: the keep-alive may run.
        act(() => useHifiSettingsStore.setState({ exclusive: false }));
        expect(keepAliveElement()?.paused).toBe(false);

        // A direct ALSA device on Linux, whatever the switch says.
        (window as unknown as { electron?: unknown }).electron = { platform: 'linux' };
        act(() => useHifiSettingsStore.setState({ audioDevice: 'alsa/hw:CARD=D10,DEV=0' }));
        expect(keepAliveElement()).toBeNull();
    });

    it('never opens a Chromium stream on Linux once main registers MPRIS: it would hold the PipeWire rate (#835)', () => {
        (window as unknown as { electron?: unknown }).electron = {
            platform: 'linux',
            hifi: { setMprisState: vi.fn(), setMprisArtwork: vi.fn(), onMprisCommand: vi.fn(() => () => {}) },
        };
        useHifiSettingsStore.setState({ exclusive: false, audioDevice: 'auto' });
        mount();
        showHifiTrack('t1');
        act(() => hifiMediaShim.markPlaying());
        expect(keepAliveElement()).toBeNull();
        expect(playSpy).not.toHaveBeenCalled();
    });

    it('falls back to the keep-alive on Linux when main reports it could not register MPRIS, and drops it once main can', () => {
        (window as unknown as { electron?: unknown }).electron = {
            platform: 'linux',
            hifi: { setMprisState: vi.fn(), setMprisArtwork: vi.fn(), onMprisCommand: vi.fn(() => () => {}) },
        };
        useHifiSettingsStore.setState({ exclusive: false, audioDevice: 'auto' });
        mount();
        showHifiTrack('t1');
        act(() => hifiMediaShim.markPlaying());
        expect(keepAliveElement()).toBeNull();

        act(() => useHifiMprisStatusStore.setState({ registered: false }));
        expect(keepAliveElement()?.paused).toBe(false);

        act(() => useHifiMprisStatusStore.setState({ registered: true }));
        expect(keepAliveElement()).toBeNull();
    });

    it('removes the element when App unmounts', () => {
        useHifiSettingsStore.setState({ exclusive: false });
        mount();
        showHifiTrack('t1');
        act(() => hifiMediaShim.markPlaying());
        expect(keepAliveElement()).not.toBeNull();

        act(() => root!.unmount());
        root = null;
        expect(keepAliveElement()).toBeNull();
    });
});
