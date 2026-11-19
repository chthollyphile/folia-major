// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
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

import type { ModRuntimeInfo } from '@/mods/types';
import type { FoliumClientApi, FoliumClientModule } from '@/mods/folium/contract';
import type { UnifiedSong } from '@/types';
import { createFoliumClientApi } from '@/mods/folium/api';
import { createFoliumPageStore, getFoliumSourceCapability, registerFoliumSource, sourcesRegistry } from '@/mods/folium/registries/sources';
import { markFoliumSourceMod } from '@/mods/runtime/guard';
import { omni } from '@/services/onlineMusic/omni';
import { itemTraits } from '@/services/onlineMusic/itemTraits';
import {
    beginExternalPlayback,
    handOverExternalPlayback,
    handOverExternalPlaybackDuringRestore,
    isExternalRoute,
    pauseExternalPlayback,
    reclaimExternalPlayback,
    restartSurfaceAfterHandoff,
    resumeExternalPlayback,
    seekExternalPlayback,
    setExternalPlaybackVolume,
    yieldExternalPlayback,
} from '@/services/onlineMusic/externalPlayback';
import { attachSurfaceBox } from '@/components/app/playback/surface/surfaceMount';
import { isSurfaceShowing, setSurfaceBoxShown } from '@/components/app/playback/surface/surfaceShowing';
import { externalBlocksAutomix } from '@/components/app/playback/externalPlaybackGate';
import { clientApiOptions } from './clientApiOptions';
import { checkFoliumMod } from '../../../dev/folium/check.mjs';
import path from 'node:path';

// test/unit/mod-system/foliumSampleVideoSource.test.ts
// The gate of Folium 2.0 S6 (plan §10): dev/folium/sample-video-source, a source with playback.surface@1, registers
// with no change to the host; its clips play on the external route with their picture in the surface box (put in
// before the player is told to play, taken out when the route lets the song go), are driven through the contract's
// members (pause, seek, volume, another clip), are paused when the window hands them over and resumed when it takes
// them back, and start again at a position in a new window. Its song plays as the host's audio (`routeOf`), and its
// videos' traits (`itemKinds`) keep lyrics, likes and reports away from them. jsdom has no media playback: the
// <video> is a stand-in that keeps playing, position and level as the element would.

const MOD_ID = 'sample-video-source';
const SOURCE = `folium.${MOD_ID}.clips`;

const mod: ModRuntimeInfo = {
    id: MOD_ID, name: '示范视频源（样例）', version: '1.0.0', author: null, description: null, permissions: [],
    status: 'loaded', error: null, enabled: true, trustStale: false,
    signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false, experimental: [], embedOrigins: [], folia: null, hasMain: true, clientUrl: null,
    folium: 2, tier: 'repo', kind: 'source', contexts: null, locales: null,
    sources: [{ id: SOURCE, localId: 'clips', name: 'clips', state: 'enabled', keepForMatching: false, takeover: false, requires: [] }],
};

// ---- a <video> that plays as far as these tests look
const playing = new WeakSet<HTMLMediaElement>();
/** Whether each element was on the page when play() was called. */
const connectedAtPlay: boolean[] = [];
const positions = new WeakMap<HTMLMediaElement, number>();
Object.defineProperties(HTMLMediaElement.prototype, {
    paused: { configurable: true, get(this: HTMLMediaElement) { return !playing.has(this); } },
    currentTime: {
        configurable: true,
        get(this: HTMLMediaElement) { return positions.get(this) ?? 0; },
        set(this: HTMLMediaElement, value: number) { positions.set(this, value); },
    },
    duration: { configurable: true, get: () => 12 },
    play: {
        configurable: true,
        value(this: HTMLMediaElement) {
            connectedAtPlay.push(this.isConnected);
            playing.add(this);
            this.dispatchEvent(new Event('playing'));
            return Promise.resolve();
        },
    },
    pause: { configurable: true, value(this: HTMLMediaElement) { playing.delete(this); } },
});

let api: FoliumClientApi;
let box: HTMLDivElement;
let detachBox: () => void;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const find = async (query: string): Promise<UnifiedSong> => {
    const page = await omni.searchProviderSongs(SOURCE, query, { limit: 10, offset: 0 });
    expect(page.items.length).toBeGreaterThan(0);
    return page.items[0];
};

/** The <video> in the box now, with the song its picture is of. */
const picture = () => {
    const element = box.querySelector<HTMLElement>('[data-surface-song]');
    return { songKey: element?.dataset.surfaceSong ?? null, video: element?.querySelector('video') ?? null };
};

beforeAll(async () => {
    markFoliumSourceMod(MOD_ID, true);
    const stopped = () => false;
    api = createFoliumClientApi(mod, clientApiOptions('main', {
        sources: { register: (def) => registerFoliumSource({ mod, stopped }, def), capability: getFoliumSourceCapability, pageStore: createFoliumPageStore },
    }));
    const module = await import('../../../dev/folium/sample-video-source/client.mjs') as unknown as FoliumClientModule;
    await module.default(api);
    box = document.createElement('div');
    document.body.append(box);
    detachBox = attachSurfaceBox(box);
    // The player page is the view: the box is shown (SurfacePlaybackHost).
    setSurfaceBoxShown(true);
});

afterAll(() => {
    yieldExternalPlayback('the test is over');
    detachBox();
    setSurfaceBoxShown(false);
    sourcesRegistry.unregisterAll(MOD_ID);
    markFoliumSourceMod(MOD_ID, false);
});

describe('sample-video-source through omni and the external route', () => {
    it('passes folium:check, and the host says it implements playback.surface@1', () => {
        const result = checkFoliumMod(path.resolve(__dirname, '../../../dev/folium/sample-video-source'));
        expect(result.problems).toEqual([]);
        expect(api.sources.supports('playback.surface', 1)).toBe(true);
        expect(omni.getProviderCapabilities(SOURCE)).toMatchObject({ search: true, playback: true, externalPlayback: true, lyrics: false });
    });

    it('routeOf: its videos play on the surface, its song as the host\'s audio', async () => {
        const video = await find('测试图卡 A');
        expect(video.itemKind).toBe('video');
        expect(omni.canPlayExternally(video)).toBe(true);
        expect(omni.playsOnSurface(video)).toBe(true);
        const song = await find('间奏');
        expect(song.itemKind).toBeUndefined();
        expect(omni.canPlayExternally(song)).toBe(false);
        expect(omni.playsOnSurface(song)).toBe(false);
        expect(omni.canPlaySong(song)).toBe(true);
        expect((await omni.getAudioSource(song, 'standard'))?.url).toMatch(/^data:audio\/wav;base64,/);
    });

    it('itemKinds: a video has no lyrics, no like, no report, and keeps automix and the audio cache away', async () => {
        const video = await find('彩条');
        expect(itemTraits(video)).toEqual({ kind: 'video', lyrics: 'none', likable: false, reported: false, route: 'surface' });
        const song = await find('间奏');
        expect(itemTraits(song)).toEqual({ kind: 'song', lyrics: 'match', likable: true, reported: true, route: 'audio' });
        expect(externalBlocksAutomix({ playbackRoute: 'web', playQueue: [song, video], currentSong: song, loopMode: 'off', isFmMode: false })).toBe(true);
        expect(externalBlocksAutomix({ playbackRoute: 'web', playQueue: [song], currentSong: song, loopMode: 'off', isFmMode: false })).toBe(false);
    });

    it('puts the picture in before the player is told to play, and drives the player through the contract', async () => {
        const video = await find('测试图卡 A');
        connectedAtPlay.length = 0;
        await beginExternalPlayback(video, 2);
        // The <video> was in the box (on the page) when the player was told to play.
        expect(connectedAtPlay).toEqual([true]);
        expect(isExternalRoute()).toBe(true);
        expect(isSurfaceShowing()).toBe(true);
        // Off the player page the box hides, and the stage keeps its own background.
        setSurfaceBoxShown(false);
        expect(isSurfaceShowing()).toBe(false);
        setSurfaceBoxShown(true);
        const shown = picture();
        expect(shown.songKey).toBe(`online:${SOURCE}:v-a`);
        expect(shown.video?.src).toBe(`folia-mod://${MOD_ID}/_media/clips/clip-a.webm`);
        expect(shown.video?.paused).toBe(false);
        expect(shown.video?.currentTime).toBe(2);
        expect(await omni.getExternalPlaybackStatus(video)).toMatchObject({ mediaId: 'v-a', isPlaying: true, positionMs: 2000, durationMs: 12000 });

        pauseExternalPlayback();
        await settle();
        expect(shown.video?.paused).toBe(true);
        resumeExternalPlayback();
        await settle();
        expect(shown.video?.paused).toBe(false);
        seekExternalPlayback(7);
        await settle();
        expect(shown.video?.currentTime).toBe(7);
        setExternalPlaybackVolume(0.25);
        await settle();
        expect(shown.video?.volume).toBe(0.25);
    });

    it('moves the picture to the next clip, and pauses it as the window hands it over', async () => {
        const next = await find('彩条');
        await beginExternalPlayback(next, 0);
        const shown = picture();
        expect(shown.songKey).toBe(`online:${SOURCE}:v-b`);
        expect(box.querySelectorAll('[data-surface-song]')).toHaveLength(1);
        expect(shown.video?.src).toBe(`folia-mod://${MOD_ID}/_media/clips/clip-b.webm`);

        // The rebuild: the player goes with this window, so it stops sounding here; the picture stays until it goes.
        handOverExternalPlayback();
        await settle();
        expect(shown.video?.paused).toBe(true);
        expect(picture().songKey).toBe(`online:${SOURCE}:v-b`);
        // Not replaced after all: it sounds again.
        reclaimExternalPlayback('the rebuild was refused');
        await settle();
        expect(shown.video?.paused).toBe(false);
    });

    it('takes the picture out when another engine takes the song', async () => {
        yieldExternalPlayback('another song started');
        expect(isExternalRoute()).toBe(false);
        expect(isSurfaceShowing()).toBe(false);
        expect(box.querySelector('[data-surface-song]')).toBeNull();
    });

    it('starts a handed-over clip again at the position the snapshot left it', async () => {
        const video = await find('测试图卡 C');
        expect(await restartSurfaceAfterHandoff(video, 3, () => true)).toBe(true);
        const shown = picture();
        expect(shown.songKey).toBe(`online:${SOURCE}:v-c`);
        expect(shown.video?.currentTime).toBe(3);
        expect(shown.video?.paused).toBe(false);
        // An audio song is not one: nothing starts.
        expect(await restartSurfaceAfterHandoff(await find('间奏'), 3, () => true)).toBe(false);
    });

    it('keeps paused a clip the listener paused while it was handed over, when the window is not replaced', async () => {
        await beginExternalPlayback(await find('彩条'), 1);
        const shown = picture();
        handOverExternalPlayback();
        await settle();
        pauseExternalPlayback();
        reclaimExternalPlayback('the rebuild was refused');
        await settle();
        expect(shown.video?.paused).toBe(true);
    });

    it('pauses a restart that this window was replaced in the middle of', async () => {
        const video = await find('测试图卡 A');
        const restarting = restartSurfaceAfterHandoff(video, 4, () => true);
        handOverExternalPlaybackDuringRestore();
        expect(await restarting).toBe(true);
        await settle();
        const shown = picture();
        expect(shown.songKey).toBe(`online:${SOURCE}:v-a`);
        expect(shown.video?.paused).toBe(true);
        reclaimExternalPlayback('the test is over');
        await settle();
        expect(shown.video?.paused).toBe(false);
    });
});
