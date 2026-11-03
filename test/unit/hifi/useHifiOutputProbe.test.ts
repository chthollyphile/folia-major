// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see hifiPlayerSurfaces.test.ts.
vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
            key: (index: number) => Array.from(items.keys())[index] ?? null,
            get length() { return items.size; },
        },
    });
});

import type { HifiEngineState, HifiMpvAudioParams, HifiPlaybackStatus } from '@/types/hifi';
import {
    OUTPUT_PROBE_PANEL_INTERVAL_MS,
    OUTPUT_PROBE_SETTLE_MS,
    audioOutParamsKey,
    shouldProbeOutput,
    useHifiOutputProbe,
} from '@/components/hifi/useHifiOutputProbe';
import { useHifiEngineStore } from '@/services/hifi/hifiEngineStore';
import { useHifiTrackStore } from '@/services/hifi/hifiTrackStore';
import { setPlaybackRoute } from '@/stores/usePlaybackStore';

// test/unit/hifi/useHifiOutputProbe.test.ts
// When the renderer asks main for a PipeWire probe: only on Linux, on the HiFi route, with mpv on the
// pipewire or pulse output and playing the current track; once 1.5 s after it starts playing and again
// after its output format or track changes (a gapless switch), every 2 s while the signal path is open,
// and never while nothing changed. Real stores, fake timers, a stand-in engine.

const params = (format: string, samplerate: number): HifiMpvAudioParams => ({ format, samplerate, channelCount: 2, channels: 'stereo' });

const engineState = (fields: Partial<HifiEngineState> = {}): HifiEngineState => ({
    status: 'playing',
    processRunning: true,
    trackKey: 'local:1#a',
    songKey: 'local:1',
    sourceKind: 'local',
    localSourceKey: 'source-1',
    durationSec: 200,
    positionSec: 0,
    paused: false,
    loopFile: false,
    audioParams: params('s32', 96000),
    audioOutParams: params('s32', 96000),
    currentAo: 'pipewire',
    audioDevice: 'auto',
    exclusive: false,
    spdif: null,
    volume: 100,
    track: null,
    next: null,
    errorCode: null,
    circuitOpen: false,
    seq: 1,
    ...fields,
});

const setCurrentTrack = (trackKey: string) => {
    useHifiTrackStore.setState({
        current: {
            trackKey,
            songKey: trackKey.split('#')[0],
            origin: 'local',
            song: { id: 1, name: 'Track', artists: [], album: { id: 1, name: 'Album' }, durationMs: 200000 } as never,
            localSourceKey: 'source-1',
            stillWanted: () => true,
        },
        loadState: 'ready',
        loadError: null,
        sourceSpec: null,
    });
};

const Probe: React.FC<{ panelOpen: boolean; engine: { probeOutput: (trackKey: string | null) => Promise<null> } }> = ({ panelOpen, engine }) => {
    useHifiOutputProbe(panelOpen, engine);
    return null;
};

describe('shouldProbeOutput', () => {
    const base = {
        platform: 'linux',
        isHifiRoute: true,
        trackKey: 'local:1#a',
        engineTrackKey: 'local:1#a',
        status: 'playing' as HifiPlaybackStatus,
        ao: 'pipewire',
    };

    it.each([
        ['on Linux, playing the current track through pipewire', {}, true],
        ['through pulse (pipewire-pulse)', { ao: 'pulse' }, true],
        ['on Windows', { platform: 'win32' }, false],
        ['in the web build', { platform: null }, false],
        ['on the web route', { isHifiRoute: false }, false],
        ['on an ALSA hw: device', { ao: 'alsa' }, false],
        ['before mpv reports its output driver', { ao: null }, false],
        ['while paused', { status: 'paused' as HifiPlaybackStatus }, false],
        ['while loading', { status: 'loading' as HifiPlaybackStatus }, false],
        ['while mpv still plays the previous track', { engineTrackKey: 'local:0#z' }, false],
        ['without a current track', { trackKey: null, engineTrackKey: null }, false],
    ])('%s → %s', (_name, overrides, expected) => {
        expect(shouldProbeOutput({ ...base, ...overrides })).toBe(expected);
    });

    it('keys the output format so a change of rate, format or channels counts', () => {
        expect(audioOutParamsKey(params('s32', 96000))).toBe('96000/s32/2/stereo');
        expect(audioOutParamsKey(null)).toBeNull();
        expect(audioOutParamsKey(params('s32', 96000))).not.toBe(audioOutParamsKey(params('s32', 48000)));
    });
});

describe('useHifiOutputProbe', () => {
    let root: Root;
    let place: HTMLElement;
    const probeOutput = vi.fn(async (_trackKey: string | null) => null);
    const engine = { probeOutput };
    const draw = (panelOpen = false) => act(() => root.render(React.createElement(Probe, { panelOpen, engine })));
    const wait = (ms: number) => act(() => {
        vi.advanceTimersByTime(ms);
    });
    const setEngine = (fields: Partial<HifiEngineState>) => act(() => {
        useHifiEngineStore.setState({ engine: engineState(fields) });
    });

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        probeOutput.mockClear();
        (window as { electron?: unknown }).electron = { platform: 'linux' };
        setCurrentTrack('local:1#a');
        useHifiEngineStore.setState({ engine: engineState() });
        setPlaybackRoute('hifi');
        place = document.body.appendChild(document.createElement('div'));
        root = createRoot(place);
    });

    afterEach(() => {
        act(() => root.unmount());
        place.remove();
        vi.useRealTimers();
        setPlaybackRoute('web');
        useHifiEngineStore.setState({ engine: null, outputProbe: null });
        useHifiTrackStore.setState({ current: null, loadState: 'idle', loadError: null, sourceSpec: null });
        delete (window as { electron?: unknown }).electron;
    });

    it('probes once, 1.5 s after the current track plays, and not again while nothing changes', () => {
        draw();
        wait(OUTPUT_PROBE_SETTLE_MS - 1);
        expect(probeOutput).not.toHaveBeenCalled();
        wait(1);
        expect(probeOutput).toHaveBeenCalledOnce();
        expect(probeOutput).toHaveBeenCalledWith('local:1#a');

        // A new engine state with the same track, driver and output format (a position push, say).
        setEngine({ positionSec: 30, seq: 2 });
        wait(10_000);
        expect(probeOutput).toHaveBeenCalledOnce();
    });

    it('waits until mpv plays: not while loading, then 1.5 s after it starts', () => {
        setEngine({ status: 'loading', audioOutParams: null });
        draw();
        wait(5000);
        expect(probeOutput).not.toHaveBeenCalled();

        setEngine({ status: 'playing' });
        wait(OUTPUT_PROBE_SETTLE_MS);
        expect(probeOutput).toHaveBeenCalledOnce();
    });

    it('probes again after mpv reopens the output in another format', () => {
        draw();
        wait(OUTPUT_PROBE_SETTLE_MS);
        setEngine({ audioParams: params('s32', 44100), audioOutParams: params('s32', 44100), seq: 2 });
        wait(OUTPUT_PROBE_SETTLE_MS - 1);
        expect(probeOutput).toHaveBeenCalledOnce();
        wait(1);
        expect(probeOutput).toHaveBeenCalledTimes(2);
    });

    it('probes for the next track after a gapless switch, and not for the old one', () => {
        draw();
        wait(OUTPUT_PROBE_SETTLE_MS);
        act(() => {
            setCurrentTrack('local:2#b');
            useHifiEngineStore.setState({ engine: engineState({ trackKey: 'local:2#b', songKey: 'local:2', seq: 2 }) });
        });
        wait(OUTPUT_PROBE_SETTLE_MS);
        expect(probeOutput.mock.calls).toEqual([['local:1#a'], ['local:2#b']]);
    });

    it('drops a pending probe when the track pauses before it fires, and probes once it plays again', () => {
        draw();
        wait(1000);
        setEngine({ status: 'paused', paused: true, seq: 2 });
        wait(5000);
        expect(probeOutput).not.toHaveBeenCalled();
        setEngine({ status: 'playing', seq: 3 });
        wait(OUTPUT_PROBE_SETTLE_MS);
        expect(probeOutput).toHaveBeenCalledOnce();
    });

    it.each([
        ['off Linux', () => { (window as { electron?: unknown }).electron = { platform: 'win32' }; }],
        ['on an ALSA hw: device', () => useHifiEngineStore.setState({ engine: engineState({ currentAo: 'alsa', audioDevice: 'alsa/hw:CARD=D10,DEV=0' }) })],
        ['on the web route', () => setPlaybackRoute('web')],
        ['while mpv still plays the previous track', () => useHifiEngineStore.setState({ engine: engineState({ trackKey: 'local:0#z' }) })],
    ])('never probes %s', (_name, arrange) => {
        act(arrange);
        draw(true);
        wait(10_000);
        expect(probeOutput).not.toHaveBeenCalled();
    });

    it('probes right away and every 2 s while the panel is open, and stops once it closes', () => {
        draw();
        wait(OUTPUT_PROBE_SETTLE_MS);
        expect(probeOutput).toHaveBeenCalledTimes(1);

        draw(true);
        expect(probeOutput).toHaveBeenCalledTimes(2);
        wait(OUTPUT_PROBE_PANEL_INTERVAL_MS * 3);
        expect(probeOutput).toHaveBeenCalledTimes(5);

        draw(false);
        wait(OUTPUT_PROBE_PANEL_INTERVAL_MS * 3);
        expect(probeOutput).toHaveBeenCalledTimes(5);
    });

    it('leaves no timer behind once unmounted', () => {
        draw(true);
        probeOutput.mockClear();
        act(() => root.unmount());
        wait(10_000);
        expect(probeOutput).not.toHaveBeenCalled();
        root = createRoot(place);
    });
});
