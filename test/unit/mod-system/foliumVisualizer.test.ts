// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
const storage = vi.hoisted(() => {
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
    return items;
});

import type { ModRuntimeInfo } from '@/mods/types';
import type {
    FoliumBeatEffectPatch,
    FoliumBeatEffectsState,
    FoliumLyricRenderQuality,
    FoliumRenderQualityChangeOrigin,
    FoliumTuningValue,
    FoliumVisualizerChangeOrigin,
    FoliumVisualizerService,
    FoliumVisualizerTuning,
} from '@/mods/folium/contract';
import { createFoliumClientApi } from '@/mods/folium/api';
import { addFoliumEventHandler, removeFoliumEventHandlers } from '@/mods/folium/events';
import {
    FOLIUM_LYRIC_ANTIALIAS_MODES,
    FOLIUM_LYRIC_RENDER_SCALES,
    registerFoliumVisualizerSource,
    resetFoliumVisualizerWriteLimitsForTest,
} from '@/mods/folium/visualizer/service';
import { FOLIUM_HOST_VISUALIZER_SOURCE, installFoliumHostVisualizer } from '@/mods/runtime/visualizer/hostVisualizer';
import { DEFAULT_LYRIC_RENDER_QUALITY, LYRIC_ANTIALIAS_MODES, LYRIC_RENDER_QUALITY_STORAGE_KEY, LYRIC_RENDER_SCALES } from '@/utils/lyricRenderQuality';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';
import { DEFAULT_SONNET_TUNING } from '@/types';
import { clientApiOptions } from './clientApiOptions';

// test/unit/mod-system/foliumVisualizer.test.ts
// Folium 1.8 `folium.visualizer` and `visualizer.renderQualityChanged`, end to end over the real visualizer
// settings store and the real host source: the frozen global level; a write that lands where the settings
// page's does; the checks in the contract's order, a write that changes nothing accepted whatever else
// holds; the allowance per mod; and one event per task, with the origin a mod can step back by. Then the same
// for the mode, the builtin modes' tuning keys and the beat effects, each with its permission and allowance.

installFoliumHostVisualizer();

const settings = () => useVisualizerSettingsStore.getState();
const initialSettings = settings();
const flush = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });

const modInfo = (id: string, overrides: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
    id, name: `Mod ${id}`, version: '1.0.0', author: null, description: null, permissions: ['visualizer.renderQuality', 'visualizer.mode', 'visualizer.tuning', 'visualizer.beatEffects'],
    status: 'loaded', error: null, enabled: true, trustStale: false, signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null }, devSource: false, experimental: [], embedOrigins: [],
    folia: null, hasMain: false, clientUrl: null,
    ...overrides,
});

const visualizerOf = (mod: ModRuntimeInfo, options = clientApiOptions('main')): FoliumVisualizerService => (
    createFoliumClientApi(mod, options).visualizer
);
const rqMod = () => visualizerOf(modInfo('rq-mod'));
const otherMod = () => visualizerOf(modInfo('other-mod'));

const seen: Array<{ quality: FoliumLyricRenderQuality; origin: FoliumRenderQualityChangeOrigin }> = [];
const listen = () => {
    addFoliumEventHandler('listener-mod', 'visualizer.renderQualityChanged', (event) => { seen.push(event); });
};

beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    storage.clear();
    useVisualizerSettingsStore.setState(initialSettings, true);
    useVisualizerSettingsStore.setState({ lyricRenderQuality: { ...DEFAULT_LYRIC_RENDER_QUALITY } });
    // What the resets set off goes out with no one listening.
    await flush();
    seen.length = 0;
});

afterEach(() => {
    removeFoliumEventHandlers('listener-mod');
    useStatusMessageStore.setState({ message: null });
    resetFoliumVisualizerWriteLimitsForTest();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('the contract\'s values', () => {
    it('are the host\'s, so every value the contract promises is one the store keeps', () => {
        expect([...FOLIUM_LYRIC_RENDER_SCALES]).toEqual([...LYRIC_RENDER_SCALES]);
        expect([...FOLIUM_LYRIC_ANTIALIAS_MODES]).toEqual([...LYRIC_ANTIALIAS_MODES]);
    });
});

describe('getRenderQuality', () => {
    it('reads the global level, frozen, the same object until it changes', () => {
        const quality = rqMod().getRenderQuality();
        expect(quality).toEqual({ scale: 1, antialias: 'auto' });
        expect(Object.isFrozen(quality)).toBe(true);
        expect(rqMod().getRenderQuality()).toBe(quality);
        settings().handleSetLyricRenderQuality({ scale: 1.5 });
        expect(rqMod().getRenderQuality()).toEqual({ scale: 1.5, antialias: 'auto' });
    });

    it('needs no permission', () => {
        expect(visualizerOf(modInfo('reader', { permissions: [] })).getRenderQuality()).toEqual({ scale: 1, antialias: 'auto' });
    });
});

describe('setRenderQuality', () => {
    it('changes the fields it is given, as the settings page does, and saves the level', () => {
        const result = rqMod().setRenderQuality({ scale: 2 });
        expect(result).toEqual({ ok: true, quality: { scale: 2, antialias: 'auto' } });
        expect(Object.isFrozen(result)).toBe(true);
        expect(settings().lyricRenderQuality).toEqual({ scale: 2, antialias: 'auto' });
        expect(JSON.parse(storage.get(LYRIC_RENDER_QUALITY_STORAGE_KEY)!)).toEqual({ scale: 2, antialias: 'auto' });
        vi.useFakeTimers();
        vi.setSystemTime(Date.now() + 2000);
        expect(rqMod().setRenderQuality({ antialias: 'off' })).toEqual({ ok: true, quality: { scale: 2, antialias: 'off' } });
    });

    it('takes every value the contract promises', () => {
        for (const scale of FOLIUM_LYRIC_RENDER_SCALES) {
            resetFoliumVisualizerWriteLimitsForTest();
            expect(rqMod().setRenderQuality({ scale }), String(scale)).toMatchObject({ ok: true, quality: { scale } });
        }
        for (const antialias of FOLIUM_LYRIC_ANTIALIAS_MODES) {
            resetFoliumVisualizerWriteLimitsForTest();
            expect(rqMod().setRenderQuality({ antialias }), antialias).toMatchObject({ ok: true, quality: { antialias } });
        }
    });

    it('throws a TypeError for a patch it cannot take, and changes nothing', () => {
        const bad = [null, 'high', 2, [2], { scale: 3 }, { scale: '2' }, { scale: Number.NaN }, { antialias: 'msaa' }, { antialias: true }, { scale: 2, antialias: 'smaa' }];
        for (const patch of bad) {
            expect(() => rqMod().setRenderQuality(patch as unknown as Partial<FoliumLyricRenderQuality>), JSON.stringify(patch)).toThrow(TypeError);
        }
        expect(() => rqMod().setRenderQuality({ scale: 3 } as unknown as Partial<FoliumLyricRenderQuality>)).toThrow(/^invalid-arguments: /);
        expect(settings().lyricRenderQuality).toEqual({ scale: 1, antialias: 'auto' });
    });

    it('ignores other keys, and takes {} as a write that changes nothing', () => {
        expect(rqMod().setRenderQuality({})).toEqual({ ok: true, quality: { scale: 1, antialias: 'auto' } });
        expect(rqMod().setRenderQuality({ scale: 0.5, fps: 30 } as unknown as Partial<FoliumLyricRenderQuality>)).toEqual({
            ok: true,
            quality: { scale: 0.5, antialias: 'auto' },
        });
    });
});

describe('the checks', () => {
    it('refuse a write without visualizer.renderQuality', () => {
        const reader = visualizerOf(modInfo('reader', { permissions: [] }));
        expect(() => reader.setRenderQuality({ scale: 2 })).toThrow('permission-denied:visualizer.renderQuality');
        // The permission comes before the arguments.
        expect(() => reader.setRenderQuality(null as unknown as Partial<FoliumLyricRenderQuality>)).toThrow('permission-denied:visualizer.renderQuality');
        expect(settings().lyricRenderQuality).toEqual({ scale: 1, antialias: 'auto' });
    });

    it('throw in the export window, the permission first', () => {
        const exported = visualizerOf(modInfo('rq-mod'), clientApiOptions('export'));
        expect(() => exported.getRenderQuality()).toThrow('visualizer-unavailable-in-export-context');
        expect(() => exported.setRenderQuality({ scale: 2 })).toThrow('visualizer-unavailable-in-export-context');
        const reader = visualizerOf(modInfo('reader', { permissions: [] }), clientApiOptions('export'));
        expect(() => reader.setRenderQuality({ scale: 2 })).toThrow('permission-denied:visualizer.renderQuality');
    });

    it('throw in the main window before the source is installed', () => {
        registerFoliumVisualizerSource(null);
        try {
            expect(() => rqMod().getRenderQuality()).toThrow('visualizer-unavailable-in-main-context');
            expect(() => rqMod().setRenderQuality({ scale: 2 })).toThrow('visualizer-unavailable-in-main-context');
        } finally {
            registerFoliumVisualizerSource(FOLIUM_HOST_VISUALIZER_SOURCE);
        }
    });

    it('answer `stopped` once the activation was torn down, after checking the arguments', () => {
        const stopped = visualizerOf(modInfo('rq-mod'), clientApiOptions('main', { stopped: () => true }));
        expect(stopped.setRenderQuality({ scale: 2 })).toEqual({ ok: false, reason: 'stopped' });
        expect(() => stopped.setRenderQuality({ scale: 3 } as unknown as Partial<FoliumLyricRenderQuality>)).toThrow(TypeError);
        expect(settings().lyricRenderQuality).toEqual({ scale: 1, antialias: 'auto' });
    });
});

describe('the allowance', () => {
    it('allows one counted write a second, per mod', () => {
        vi.useFakeTimers();
        const start = Date.parse('2026-10-31T10:00:00.000Z');
        vi.setSystemTime(start);
        expect(rqMod().setRenderQuality({ scale: 2 }).ok).toBe(true);
        vi.setSystemTime(start + 500);
        expect(rqMod().setRenderQuality({ scale: 0.5 })).toEqual({ ok: false, reason: 'rate-limited' });
        // Another mod has an allowance of its own.
        expect(otherMod().setRenderQuality({ scale: 0.5 }).ok).toBe(true);
        vi.setSystemTime(start + 1600);
        expect(rqMod().setRenderQuality({ scale: 0.75 }).ok).toBe(true);
    });

    it('allows 20 counted writes a minute, and lets the minute slide', () => {
        vi.useFakeTimers();
        const start = Date.parse('2026-10-31T11:00:00.000Z');
        for (let index = 0; index < 20; index += 1) {
            vi.setSystemTime(start + index * 1000);
            expect(rqMod().setRenderQuality({ scale: index % 2 === 0 ? 2 : 1 }).ok, String(index)).toBe(true);
        }
        vi.setSystemTime(start + 20_000);
        expect(rqMod().setRenderQuality({ scale: 0.5 })).toEqual({ ok: false, reason: 'rate-limited' });
        vi.setSystemTime(start + 60_000);
        expect(rqMod().setRenderQuality({ scale: 0.5 }).ok).toBe(true);
    });

    it('never counts or refuses a write that changes nothing', () => {
        vi.useFakeTimers();
        const start = Date.parse('2026-10-31T12:00:00.000Z');
        vi.setSystemTime(start);
        expect(rqMod().setRenderQuality({ scale: 2 }).ok).toBe(true);
        vi.setSystemTime(start + 100);
        expect(rqMod().setRenderQuality({ scale: 2, antialias: 'auto' })).toEqual({ ok: true, quality: { scale: 2, antialias: 'auto' } });
        expect(rqMod().setRenderQuality({})).toEqual({ ok: true, quality: { scale: 2, antialias: 'auto' } });
        vi.setSystemTime(start + 1100);
        expect(rqMod().setRenderQuality({ scale: 1 }).ok).toBe(true);
    });
});

describe('visualizer.renderQualityChanged', () => {
    it('names the mod that wrote, frozen', async () => {
        listen();
        rqMod().setRenderQuality({ scale: 1.5, antialias: 'on' });
        await flush();
        expect(seen).toEqual([{ quality: { scale: 1.5, antialias: 'on' }, origin: { kind: 'mod', modId: 'rq-mod' } }]);
        expect(Object.isFrozen(seen[0].quality)).toBe(true);
        expect(Object.isFrozen(seen[0].origin)).toBe(true);
    });

    it('names the user for a change made anywhere else', async () => {
        listen();
        settings().handleSetLyricRenderQuality({ antialias: 'off' });
        await flush();
        expect(seen).toEqual([{ quality: { scale: 1, antialias: 'off' }, origin: { kind: 'user', modId: null } }]);
    });

    it('comes once for the changes of one task, with the origin of the last', async () => {
        listen();
        rqMod().setRenderQuality({ scale: 2 });
        settings().handleSetLyricRenderQuality({ scale: 0.5 });
        await flush();
        expect(seen).toEqual([{ quality: { scale: 0.5, antialias: 'auto' }, origin: { kind: 'user', modId: null } }]);
    });

    it('does not come for a change that changes nothing, or that ends where it began', async () => {
        listen();
        settings().handleSetLyricRenderQuality({ scale: 1 });
        settings().handleSetLyricRenderQuality({ scale: 2 });
        settings().handleSetLyricRenderQuality({ scale: 1 });
        await flush();
        expect(seen).toEqual([]);
    });

    it('tells a mod that starts listening nothing of what came before', async () => {
        settings().handleSetLyricRenderQuality({ scale: 0.75 });
        await flush();
        listen();
        await flush();
        expect(seen).toEqual([]);
    });
});

// ---------------------------------------------------------------- Folium 1.8: modes, tunings, beat effects

/* Moves the clock past every allowance's one-second gap. */
const later = (() => {
    let at = Date.parse('2026-11-01T09:00:00.000Z');
    return () => {
        at += 2000;
        vi.setSystemTime(at);
    };
})();

const setEffectsFor = (mod: FoliumVisualizerService, patch: Record<string, unknown>) => (
    mod.setBeatEffects(patch as Record<string, FoliumBeatEffectPatch>)
);

describe('listModes', () => {
    it('lists every mode in the picker\'s order, frozen, with its tuning keys and beat effects', () => {
        const modes = rqMod().listModes();
        expect(Object.isFrozen(modes)).toBe(true);
        const sonnet = modes.find((mode) => mode.id === 'sonnet')!;
        expect(sonnet).toMatchObject({ kind: 'builtin', label: expect.any(String) });
        expect(Object.isFrozen(sonnet)).toBe(true);
        expect(sonnet.tuning.cameraIntensity).toEqual({ type: 'number', min: 0, max: 2, step: null, defaultValue: 1 });
        expect(sonnet.tuning.outerFrameMode).toEqual({ type: 'choice', options: ['none', 'frame', 'full'], defaultValue: 'full' });
        expect(sonnet.tuning.showGuide).toEqual({ type: 'boolean', defaultValue: true });
        expect(sonnet.tuning).not.toHaveProperty('render');
        expect(sonnet.tuning).not.toHaveProperty('textureResolution');
        expect(sonnet.beatEffects).toEqual([{ id: 'sonnet.lensTear', mode: 'sonnet', label: expect.any(String), source: 'beats', parts: [] }]);
        const nebbia = modes.find((mode) => mode.id === 'nebbia')!;
        expect(nebbia.beatEffects[0]).toMatchObject({ id: 'nebbia.drizzleRide', source: 'stems', parts: [{ key: 'rain' }, { key: 'bump' }] });
        // A mode with no options of its own offers no keys; one with no beat effects none of those.
        expect(modes.find((mode) => mode.id === 'still')).toMatchObject({ tuning: {}, beatEffects: [] });
        expect(modes.find((mode) => mode.id === 'cadenza')).toMatchObject({ tuning: {} });
        expect(modes.find((mode) => mode.id === 'diorama')!.tuning.particleDensity).toMatchObject({ type: 'number', step: 24 });
    });

    it('needs no permission', () => {
        expect(visualizerOf(modInfo('reader', { permissions: [] })).listModes().length).toBeGreaterThan(10);
    });
});

describe('setMode', () => {
    it('switches as the player panel does: no notice, and random-per-song goes off', () => {
        settings().handleToggleRandomVisualizerModePerSong(true, { notify: false });
        expect(rqMod().setMode('sonnet')).toEqual({ ok: true, mode: 'sonnet' });
        expect(rqMod().getMode()).toBe('sonnet');
        expect(settings().visualizerMode).toBe('sonnet');
        expect(settings().randomVisualizerModePerSong).toBe(false);
        expect(storage.get('visualizer_mode')).toBe('sonnet');
        expect(useStatusMessageStore.getState().message).toBeNull();
    });

    it('takes switching to the mode on screen as a write that changes nothing', () => {
        vi.useFakeTimers();
        later();
        expect(rqMod().setMode('machi').ok).toBe(true);
        vi.setSystemTime(Date.now() + 100);
        expect(rqMod().setMode('machi')).toEqual({ ok: true, mode: 'machi' });
        expect(rqMod().setMode('fume')).toEqual({ ok: false, reason: 'rate-limited' });
    });

    it('switches random-per-song off on a switch to the mode on screen, as the player panel does', () => {
        vi.useFakeTimers();
        later();
        settings().handleToggleRandomVisualizerModePerSong(true, { notify: false });
        const current = rqMod().getMode();
        expect(rqMod().setMode(current)).toEqual({ ok: true, mode: current });
        expect(settings().randomVisualizerModePerSong).toBe(false);
        // It was a write: it counted.
        vi.setSystemTime(Date.now() + 100);
        expect(rqMod().setMode('fume')).toEqual({ ok: false, reason: 'rate-limited' });
    });

    it('throws a TypeError for an id that is no mode, the permission first', () => {
        for (const id of ['nope', '', 3, null, 'mod:nobody:here']) {
            expect(() => rqMod().setMode(id as string), String(id)).toThrow(/^invalid-arguments: /);
        }
        expect(settings().visualizerMode).toBe(initialSettings.visualizerMode);
        const reader = visualizerOf(modInfo('reader', { permissions: ['visualizer.tuning'] }));
        expect(() => reader.setMode('nope')).toThrow('permission-denied:visualizer.mode');
        expect(reader.getMode()).toBe(initialSettings.visualizerMode);
    });

    it('fires visualizer.modeChanged once for each change, with who changed it', () => {
        const events: Array<{ mode: string; origin: FoliumVisualizerChangeOrigin }> = [];
        addFoliumEventHandler('listener-mod', 'visualizer.modeChanged', (event) => { events.push(event); });
        rqMod().setMode('tempera');
        settings().handleSetVisualizerMode('classic', { notify: false });
        expect(events).toEqual([
            { mode: 'tempera', origin: { kind: 'mod', modId: 'rq-mod' } },
            { mode: 'classic', origin: { kind: 'user', modId: null } },
        ]);
    });

    it('counts a write before it lands, so a setMode made from the modeChanged callback is rate-limited, not recursed', () => {
        vi.useFakeTimers();
        later();
        const inner: unknown[] = [];
        addFoliumEventHandler('listener-mod', 'visualizer.modeChanged', () => {
            if (inner.length) return;
            inner.push(rqMod().setMode('fume'));
        });
        expect(rqMod().setMode('tempera')).toEqual({ ok: true, mode: 'tempera' });
        expect(inner).toEqual([{ ok: false, reason: 'rate-limited' }]);
        expect(settings().visualizerMode).toBe('tempera');
    });

    it('gives back the count of a write that changes nothing once it has landed', () => {
        vi.useFakeTimers();
        later();
        // A source whose write lands nothing, as the real one answers when the store did not change.
        const sourceSetMode = vi.fn(() => false);
        registerFoliumVisualizerSource({ ...FOLIUM_HOST_VISUALIZER_SOURCE, setMode: sourceSetMode });
        try {
            expect(rqMod().setMode('tempera')).toEqual({ ok: true, mode: initialSettings.visualizerMode });
            expect(sourceSetMode).toHaveBeenCalledTimes(1);
        } finally {
            registerFoliumVisualizerSource(FOLIUM_HOST_VISUALIZER_SOURCE);
        }
        vi.setSystemTime(Date.now() + 100);
        expect(rqMod().setMode('fume')).toEqual({ ok: true, mode: 'fume' });
    });
});

describe('getTuning / setTuning', () => {
    const setSonnet = (patch: Record<string, unknown>, mod = rqMod()) => mod.setTuning('sonnet', patch as Record<string, FoliumTuningValue>);

    it('reads a builtin mode\'s declared keys only, frozen, the same object until it changes', () => {
        const tuning = rqMod().getTuning('sonnet');
        expect(Object.isFrozen(tuning)).toBe(true);
        expect(tuning.cameraIntensity).toBe(DEFAULT_SONNET_TUNING.cameraIntensity);
        expect(tuning).not.toHaveProperty('render');
        expect(rqMod().getTuning('sonnet')).toBe(tuning);
        expect(rqMod().getTuning('cadenza')).toEqual({});
        expect(() => rqMod().getTuning('nope')).toThrow(/^invalid-arguments: /);
        expect(visualizerOf(modInfo('reader', { permissions: [] })).getTuning('sonnet')).toBe(tuning);
    });

    it('writes through the mode\'s own setter, clamped, and answers what was kept and what was ignored', () => {
        const result = setSonnet({ cameraIntensity: 5, outerFrameMode: 'frame', render: { scale: 2 }, textureResolution: 4, nope: 1 });
        expect(result).toEqual({
            ok: true,
            tuning: expect.objectContaining({ cameraIntensity: 2, outerFrameMode: 'frame' }),
            ignored: ['render', 'textureResolution', 'nope'],
        });
        expect(Object.isFrozen(result)).toBe(true);
        expect(settings().sonnetTuning).toMatchObject({ cameraIntensity: 2, outerFrameMode: 'frame', textureResolution: DEFAULT_SONNET_TUNING.textureResolution });
        expect(settings().sonnetTuning.render).toEqual(DEFAULT_SONNET_TUNING.render);
        expect(JSON.parse(storage.get('sonnet_tuning')!)).toMatchObject({ cameraIntensity: 2, outerFrameMode: 'frame' });
    });

    it('lands a stepped key on its step, and moves an end past the other as the panel\'s slider does', () => {
        vi.useFakeTimers();
        later();
        expect(rqMod().setTuning('diorama', { particleDensity: 1000 })).toMatchObject({ ok: true, tuning: { particleDensity: 1008 } });
        later();
        // partita's slider takes the other end along (settingsPanels.tsx): the end the mod wrote keeps its value.
        expect(rqMod().setTuning('partita', { staggerMin: 150 })).toMatchObject({ ok: true, tuning: { staggerMin: 150, staggerMax: 150 } });
        later();
        expect(rqMod().setTuning('partita', { staggerMax: 10 })).toMatchObject({ ok: true, tuning: { staggerMin: 10, staggerMax: 10 } });
        later();
        // Both ends given out of order: put in order, as a stored or imported pair is.
        expect(rqMod().setTuning('partita', { staggerMin: 120, staggerMax: 40 })).toMatchObject({ ok: true, tuning: { staggerMin: 40, staggerMax: 120 } });
    });

    it('takes back what it read, also a value the key leaves to the user', () => {
        settings().handleSetCappellaTuning({ avatarSource: 'custom' });
        const saved = rqMod().getTuning('cappella');
        expect(saved.avatarSource).toBe('custom');
        expect(rqMod().setTuning('cappella', saved)).toMatchObject({ ok: true, tuning: { avatarSource: 'custom' } });
        vi.useFakeTimers();
        later();
        expect(rqMod().setTuning('cappella', { avatarSource: 'color' })).toMatchObject({ ok: true, tuning: { avatarSource: 'color' } });
        later();
        // Not the value held now: the declaration decides.
        expect(() => rqMod().setTuning('cappella', { avatarSource: 'custom' })).toThrow(/^invalid-arguments: /);
    });

    it('keeps the glass when only the window changes, as the panel and the command do, and takes a glass the mod names', () => {
        vi.useFakeTimers();
        later();
        const { glass } = rqMod().getTuning('nebbia');
        expect(rqMod().setTuning('nebbia', { behind: 'aquarium' })).toMatchObject({ ok: true, tuning: { behind: 'aquarium', glass } });
        later();
        expect(rqMod().setTuning('nebbia', { behind: 'night' })).toMatchObject({ ok: true, tuning: { behind: 'night', glass } });
        later();
        expect(rqMod().setTuning('nebbia', { behind: 'aquarium', glass: 'snow' })).toMatchObject({ ok: true, tuning: { behind: 'aquarium', glass: 'snow' } });
        later();
        expect(rqMod().setTuning('nebbia', { behind: 'night', glass: 'dew' })).toMatchObject({ ok: true, tuning: { behind: 'night', glass: 'dew' } });
        later();
        // A count lands on whole ones.
        expect(rqMod().setTuning('nebbia', { jellies: 5.6 })).toMatchObject({ ok: true, tuning: { jellies: 6 } });
    });

    it('writes a mode that is not on screen', () => {
        expect(settings().visualizerMode).not.toBe('machi');
        expect(rqMod().setTuning('machi', { weather: 'snow', motion: true })).toMatchObject({ ok: true, tuning: { weather: 'snow', motion: true } });
        expect(settings().machiTuning).toMatchObject({ weather: 'snow', motion: true });
    });

    it('throws a TypeError for a value it cannot take, and writes nothing of the patch', () => {
        const bad: Array<Record<string, unknown>> = [
            { cameraIntensity: '1' },
            { cameraIntensity: Number.NaN },
            { cameraIntensity: Number.POSITIVE_INFINITY },
            { showGuide: 1 },
            { outerFrameMode: 'square' },
            { cameraIntensity: 1.5, outerFrameMode: 'square' },
        ];
        for (const patch of bad) {
            expect(() => setSonnet(patch), JSON.stringify(patch)).toThrow(/^invalid-arguments: /);
        }
        for (const patch of [null, 'x', 3, ['cameraIntensity']]) {
            expect(() => setSonnet(patch as unknown as Record<string, unknown>), String(patch)).toThrow(TypeError);
        }
        expect(() => rqMod().setTuning('nope', {})).toThrow(/^invalid-arguments: /);
        expect(settings().sonnetTuning).toBe(initialSettings.sonnetTuning);
    });

    it('takes {} and the values already there as a write that changes nothing', () => {
        vi.useFakeTimers();
        later();
        expect(setSonnet({ mgDensity: 1.5 }).ok).toBe(true);
        vi.setSystemTime(Date.now() + 100);
        expect(setSonnet({})).toMatchObject({ ok: true, ignored: [] });
        expect(setSonnet({ mgDensity: 1.5, nope: 1 })).toMatchObject({ ok: true, ignored: ['nope'] });
        expect(setSonnet({ mgDensity: 1.25 })).toEqual({ ok: false, reason: 'rate-limited' });
    });

    it('needs visualizer.tuning, before the arguments', () => {
        const reader = visualizerOf(modInfo('reader', { permissions: ['visualizer.mode'] }));
        expect(() => setSonnet({ cameraIntensity: 2 }, reader)).toThrow('permission-denied:visualizer.tuning');
        expect(() => reader.setTuning('nope', null as unknown as Record<string, FoliumTuningValue>)).toThrow('permission-denied:visualizer.tuning');
    });

    it('fires visualizer.tuningChanged once a task per mode, with the origin of the last change', async () => {
        const events: Array<{ mode: string; tuning: FoliumVisualizerTuning; origin: FoliumVisualizerChangeOrigin }> = [];
        addFoliumEventHandler('listener-mod', 'visualizer.tuningChanged', (event) => { events.push(event); });
        setSonnet({ mgDensity: 0.5 });
        await flush();
        expect(events).toEqual([{ mode: 'sonnet', tuning: expect.objectContaining({ mgDensity: 0.5 }), origin: { kind: 'mod', modId: 'rq-mod' } }]);
        events.length = 0;
        settings().handleSetSonnetTuning({ mgDensity: 0.75 });
        settings().handleSetSonnetTuning({ mgDensity: 0.8 });
        await flush();
        expect(events).toEqual([{ mode: 'sonnet', tuning: expect.objectContaining({ mgDensity: 0.8 }), origin: { kind: 'user', modId: null } }]);
        events.length = 0;
        // A key mods cannot see changing fires none.
        settings().handleSetSonnetTuning({ textureResolution: 3 });
        await flush();
        expect(events).toEqual([]);
    });
});

describe('getBeatEffects / setBeatEffects', () => {
    const effectOf = (state: FoliumBeatEffectsState, id: string) => state.effects.find((effect) => effect.id === id)!;

    it('reads every builtin effect and the user\'s switch, frozen', () => {
        const state = rqMod().getBeatEffects();
        expect(Object.isFrozen(state)).toBe(true);
        expect(state.smartBeat).toBe(initialSettings.smartBeat.mode);
        expect(effectOf(state, 'sonnet.lensTear')).toEqual({ id: 'sonnet.lensTear', mode: 'sonnet', on: true, strength: 1, parts: {} });
        expect(effectOf(state, 'nebbia.drizzleRide').parts).toEqual({ rain: 1, bump: 1 });
        // Retired effects are not offered.
        expect(state.effects.map((effect) => effect.id)).not.toContain('pendolo.gearBeats');
        expect(rqMod().getBeatEffects()).toBe(state);
    });

    it('changes effects as the modes\' settings do, clamped, and never the switch', () => {
        settings().handleSetSmartBeat({ mode: 'cached' });
        const result = setEffectsFor(rqMod(), {
            'sonnet.lensTear': { on: false, strength: 3 },
            'nebbia.drizzleRide': { parts: { rain: 0.5, wind: 1 } },
            'nope.effect': { on: true },
            mode: 'on',
        });
        expect(result).toMatchObject({ ok: true, ignored: ['nebbia.drizzleRide:wind', 'nope.effect', 'mode'] });
        if (!result.ok) throw new Error('refused');
        expect(effectOf(result.state, 'sonnet.lensTear')).toMatchObject({ on: false, strength: 2 });
        expect(effectOf(result.state, 'nebbia.drizzleRide').parts).toEqual({ rain: 0.5, bump: 1 });
        expect(result.state.smartBeat).toBe('cached');
        expect(settings().smartBeat.mode).toBe('cached');
        expect(settings().smartBeat.effects['sonnet.lensTear']).toMatchObject({ on: false, strength: 2 });
    });

    it('throws a TypeError for a change it cannot take, and writes nothing of the patch', () => {
        const bad: Array<Record<string, unknown>> = [
            { 'sonnet.lensTear': true },
            { 'sonnet.lensTear': { on: 'yes' } },
            { 'sonnet.lensTear': { strength: Number.NaN } },
            { 'sonnet.lensTear': { on: false }, 'machi.neonPulse': { strength: '1' } },
            { 'nebbia.drizzleRide': { parts: { rain: null } } },
            { 'nebbia.drizzleRide': { parts: [1] } },
        ];
        for (const patch of bad) expect(() => setEffectsFor(rqMod(), patch), JSON.stringify(patch)).toThrow(/^invalid-arguments: /);
        expect(() => setEffectsFor(rqMod(), null as unknown as Record<string, unknown>)).toThrow(TypeError);
        expect(settings().smartBeat).toBe(initialSettings.smartBeat);
        expect(() => setEffectsFor(visualizerOf(modInfo('reader', { permissions: [] })), {})).toThrow('permission-denied:visualizer.beatEffects');
    });

    it('fires visualizer.beatEffectsChanged once a task, also for the user\'s switch', async () => {
        const events: Array<{ state: FoliumBeatEffectsState; origin: FoliumVisualizerChangeOrigin }> = [];
        addFoliumEventHandler('listener-mod', 'visualizer.beatEffectsChanged', (event) => { events.push(event); });
        setEffectsFor(rqMod(), { 'machi.neonPulse': { strength: 0.4 } });
        await flush();
        expect(events).toHaveLength(1);
        expect(events[0].origin).toEqual({ kind: 'mod', modId: 'rq-mod' });
        expect(effectOf(events[0].state, 'machi.neonPulse').strength).toBe(0.4);
        events.length = 0;
        settings().handleSetSmartBeat({ mode: 'on' });
        await flush();
        expect(events).toEqual([{ state: expect.objectContaining({ smartBeat: 'on' }), origin: { kind: 'user', modId: null } }]);
    });
});

describe('the allowances of the four kinds of write', () => {
    it('are each the kind\'s own: one write of each kind may follow another at once', () => {
        vi.useFakeTimers();
        later();
        expect(rqMod().setMode('sonnet').ok).toBe(true);
        expect(rqMod().setTuning('sonnet', { mgDensity: 0.3 }).ok).toBe(true);
        expect(setEffectsFor(rqMod(), { 'sonnet.lensTear': { strength: 0.3 } }).ok).toBe(true);
        expect(rqMod().setRenderQuality({ scale: 2 }).ok).toBe(true);
        vi.setSystemTime(Date.now() + 100);
        expect(rqMod().setMode('fume')).toEqual({ ok: false, reason: 'rate-limited' });
        expect(rqMod().setTuning('fume', { heroScale: 1.2 })).toEqual({ ok: false, reason: 'rate-limited' });
        expect(setEffectsFor(rqMod(), { 'sonnet.lensTear': { strength: 0.6 } })).toEqual({ ok: false, reason: 'rate-limited' });
        // Another mod has allowances of its own.
        expect(otherMod().setTuning('fume', { heroScale: 1.2 }).ok).toBe(true);
    });

    it('answer `stopped` for each kind once the activation was torn down', () => {
        const stopped = visualizerOf(modInfo('rq-mod'), clientApiOptions('main', { stopped: () => true }));
        expect(stopped.setMode('sonnet')).toEqual({ ok: false, reason: 'stopped' });
        expect(stopped.setTuning('sonnet', { mgDensity: 0.3 })).toEqual({ ok: false, reason: 'stopped' });
        expect(stopped.setBeatEffects({ 'sonnet.lensTear': { on: false } })).toEqual({ ok: false, reason: 'stopped' });
        expect(settings().visualizerMode).toBe(initialSettings.visualizerMode);
    });

    it('throw in the export window', () => {
        const exported = visualizerOf(modInfo('rq-mod'), clientApiOptions('export'));
        expect(() => exported.listModes()).toThrow('visualizer-unavailable-in-export-context');
        expect(() => exported.getMode()).toThrow('visualizer-unavailable-in-export-context');
        expect(() => exported.setMode('sonnet')).toThrow('visualizer-unavailable-in-export-context');
        expect(() => exported.getTuning('sonnet')).toThrow('visualizer-unavailable-in-export-context');
        expect(() => exported.getBeatEffects()).toThrow('visualizer-unavailable-in-export-context');
    });
});
