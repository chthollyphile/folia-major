// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { HifiRuntimeStatus, PlaybackRoute } from '@/types/hifi';

// test/unit/hifi/useHifiAutomixGate.test.ts
// 智能过渡的 HiFi 闸门：正在 HiFi 上、当前这首或下一首（按 handleNextTrack 的下标规则，私人 FM 不绕回）会走 HiFi 时关掉；
// 以及挂在 React 里时，设置、运行时、熔断一变就重新判。

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key), clear: () => values.clear(),
    } });
});

const { hifiBlocksAutomix, useHifiAutomixGate } = await import('@/components/hifi/useHifiAutomixGate');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');
const { useHifiSettingsStore } = await import('@/stores/useHifiSettingsStore');
const { useHifiEngineStore, hifiEngine } = await import('@/services/hifi/hifiEngine');

const local = (id: string) => ({ id, name: id, isLocal: true, localRef: { songId: id }, sourceRef: { kind: 'local', mediaId: id } }) as unknown as SongResult;
const navidrome = (id: string) => ({ id, name: id, isNavidrome: true, sourceRef: { kind: 'navidrome', mediaId: id } }) as unknown as SongResult;
const online = (id: string) => ({ id, name: id, sourceRef: { kind: 'online', providerId: 'netease', mediaId: id } }) as unknown as SongResult;
const stage = (id: string) => ({ id, name: id, sourceRef: { kind: 'stage', mediaId: id } }) as unknown as SongResult;

/** 本地一律走 HiFi，Navidrome 看 navidromeOn；记下被问到的歌。 */
const routeFor = (navidromeOn = true) => vi.fn((kind: 'local' | 'navidrome', _songKey: string): PlaybackRoute => (
    kind === 'local' || navidromeOn ? 'hifi' : 'web'
));

const gate = (input: Partial<Parameters<typeof hifiBlocksAutomix>[0]>, route = routeFor()) => hifiBlocksAutomix({
    playbackRoute: 'web',
    playQueue: [],
    currentSong: null,
    loopMode: 'off',
    isFmMode: false,
    ...input,
}, route);

describe('hifiBlocksAutomix', () => {
    it('blocks while the HiFi route plays, whatever comes next', () => {
        expect(gate({ playbackRoute: 'hifi', playQueue: [online('a'), online('b')], currentSong: online('a') })).toBe(true);
    });

    it('blocks when the next queued song would play on HiFi, and not for online or stage songs', () => {
        const queue = [online('a'), local('b'), online('c'), navidrome('d'), stage('e')];
        expect(gate({ playQueue: queue, currentSong: queue[0] })).toBe(true);
        expect(gate({ playQueue: queue, currentSong: queue[1] })).toBe(true);
        expect(gate({ playQueue: queue, currentSong: queue[2] })).toBe(true);
        expect(gate({ playQueue: queue, currentSong: queue[2] }, routeFor(false))).toBe(false);
        expect(gate({ playQueue: [online('a'), stage('e')], currentSong: online('a') })).toBe(false);
        expect(gate({ playQueue: [online('a'), online('b')], currentSong: online('a') })).toBe(false);
    });

    it('asks the route by the song key the forced-Web memory uses', () => {
        const route = routeFor();
        gate({ playQueue: [online('a'), local('b')], currentSong: online('a') }, route);
        expect(route).toHaveBeenCalledWith('local', 'local:b');
    });

    it('blocks for the current song too, before its route has switched', () => {
        expect(gate({ playQueue: [local('a'), online('b')], currentSong: local('a') })).toBe(true);
    });

    it('wraps to the first song only with loop all, and never in Personal FM', () => {
        const queue = [local('a'), online('b')];
        expect(gate({ playQueue: queue, currentSong: queue[1], loopMode: 'off' })).toBe(false);
        expect(gate({ playQueue: queue, currentSong: queue[1], loopMode: 'one' })).toBe(false);
        expect(gate({ playQueue: queue, currentSong: queue[1], loopMode: 'all' })).toBe(true);
        expect(gate({ playQueue: queue, currentSong: queue[1], loopMode: 'all', isFmMode: true })).toBe(false);
    });

    it('takes the head of the queue as next when the current song is not in it', () => {
        expect(gate({ playQueue: [local('a')], currentSong: online('x') })).toBe(true);
        expect(gate({ playQueue: [], currentSong: online('x') })).toBe(false);
    });

    it('follows a song that fell back to the Web engine', () => {
        const route = vi.fn((_kind: 'local' | 'navidrome', songKey: string): PlaybackRoute => (songKey === 'local:b' ? 'web' : 'hifi'));
        expect(gate({ playQueue: [online('a'), local('b')], currentSong: online('a') }, route)).toBe(false);
    });
});

const runtime = (available: boolean): HifiRuntimeStatus => ({
    available,
    path: available ? '/usr/bin/mpv' : null,
    version: available ? '0.41.0' : null,
    source: available ? 'system' : null,
    errorCode: available ? null : 'MPV_NOT_FOUND',
    manualPathRejected: false,
    platform: 'linux',
    arch: 'x64',
    download: { supported: false, version: null, installedVersion: null, updateAvailable: false, installing: false },
    dopCapable: false,
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

describe('useHifiAutomixGate', () => {
    beforeEach(() => {
        usePlaybackStore.setState({ playbackRoute: 'web', playQueue: [online('a'), local('b')], currentSong: online('a'), isFmMode: false });
        useAudioSettingsStore.setState({ loopMode: 'off' });
        useHifiSettingsStore.setState({ enabled: true, navidrome: true });
        useHifiEngineStore.setState({ supported: true, runtime: runtime(true), circuitOpen: false });
        hifiEngine.clearForcedWeb();
    });

    afterEach(() => {
        act(() => root?.unmount());
        root = null;
    });

    const mount = () => {
        let value: boolean | null = null;
        function Probe() {
            value = useHifiAutomixGate();
            return null;
        }
        root = createRoot(document.createElement('div'));
        act(() => root!.render(React.createElement(Probe)));
        return () => value;
    };

    it('judges again when the settings, the runtime, the circuit or the queue change', () => {
        const read = mount();
        expect(read()).toBe(true);

        act(() => useHifiSettingsStore.setState({ enabled: false }));
        expect(read()).toBe(false);
        act(() => useHifiSettingsStore.setState({ enabled: true }));
        expect(read()).toBe(true);

        act(() => useHifiEngineStore.setState({ runtime: runtime(false) }));
        expect(read()).toBe(false);
        act(() => useHifiEngineStore.setState({ runtime: runtime(true) }));

        act(() => useHifiEngineStore.setState({ circuitOpen: true }));
        expect(read()).toBe(false);
        act(() => useHifiEngineStore.setState({ circuitOpen: false }));

        act(() => usePlaybackStore.setState({ playQueue: [online('a'), online('c')] }));
        expect(read()).toBe(false);
        act(() => usePlaybackStore.setState({ playbackRoute: 'hifi' }));
        expect(read()).toBe(true);
    });

    it('lets automix run when the next song is a Navidrome one and HiFi leaves Navidrome alone', () => {
        usePlaybackStore.setState({ playQueue: [online('a'), navidrome('d')] });
        const read = mount();
        expect(read()).toBe(true);
        act(() => useHifiSettingsStore.setState({ navidrome: false }));
        expect(read()).toBe(false);
    });
});
