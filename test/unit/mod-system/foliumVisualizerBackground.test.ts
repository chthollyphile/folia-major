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

import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ModRuntimeInfo } from '@/mods/types';
import type { FoliumAnimationIntensity, FoliumVisualizerChangeOrigin, FoliumVisualizerService } from '@/mods/folium/contract';
import { createFoliumClientApi, listFoliumHostRegistries } from '@/mods/folium/api';
import { addFoliumEventHandler, removeFoliumEventHandlers } from '@/mods/folium/events';
import { backgroundsRegistry } from '@/mods/folium/registries/backgrounds';
import { FOLIUM_ANIMATION_INTENSITIES, resetFoliumVisualizerWriteLimitsForTest } from '@/mods/folium/visualizer/service';
import { useFoliumAnimationIntensity } from '@/mods/runtime/visualizer/hostAnimationIntensity';
import { installFoliumHostVisualizer } from '@/mods/runtime/visualizer/hostVisualizer';
import { DEFAULT_THEME } from '@/services/baseThemes';
import { applyStoredAnimationIntensityToTheme, saveStoredAnimationIntensity } from '@/services/themePreferences';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import type { Theme } from '@/types';
import { BUILTIN_VISUALIZER_BACKGROUND_MODES, DEFAULT_VISUALIZER_BACKGROUND_MODE } from '@/types/visualizerModes';
import { clientApiOptions } from './clientApiOptions';

// test/unit/mod-system/foliumVisualizerBackground.test.ts
// Folium 1.9 on `folium.visualizer`: the background type, over the real visualizer settings store, and the
// animation intensity, over a theme held the way the App holds it. For each: the read, a write that lands
// where the user's does, the checks in the contract's order, an allowance of its own, and the event with the
// origin a mod can step back by.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installFoliumHostVisualizer();

const settings = () => useVisualizerSettingsStore.getState();
const initialSettings = settings();
const flush = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });

const ALL = ['visualizer.background', 'visualizer.animationIntensity'];
const modInfo = (id: string, overrides: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
    id, name: `Mod ${id}`, version: '1.0.0', author: null, description: null, permissions: ALL,
    status: 'loaded', error: null, enabled: true, trustStale: false, signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null }, devSource: false, experimental: [], embedOrigins: [],
    folia: null, hasMain: false, clientUrl: null,
    ...overrides,
});

const visualizerOf = (mod: ModRuntimeInfo, options = clientApiOptions('main')): FoliumVisualizerService => (
    createFoliumClientApi(mod, options).visualizer
);
const bgMod = () => visualizerOf(modInfo('bg-mod'));
const reader = () => visualizerOf(modInfo('reader', { permissions: [] }));

// The App's side of the animation intensity: a theme in state, set the way useThemeController sets one.
let setAppTheme: (theme: Theme) => void = () => {};
let appTheme: Theme = DEFAULT_THEME;
const ThemeHarness: React.FC = () => {
    const [theme, setTheme] = useState<Theme>(() => applyStoredAnimationIntensityToTheme(DEFAULT_THEME));
    const setThemeWithStoredIntensity = (next: Theme) => {
        saveStoredAnimationIntensity(next.animationIntensity);
        setTheme(applyStoredAnimationIntensityToTheme(next));
    };
    appTheme = theme;
    setAppTheme = setThemeWithStoredIntensity;
    useFoliumAnimationIntensity(theme, setThemeWithStoredIntensity);
    return null;
};

let root: Root | null = null;
const mountApp = () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(React.createElement(ThemeHarness)));
};

beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    storage.clear();
    useVisualizerSettingsStore.setState(initialSettings, true);
    useVisualizerSettingsStore.setState({ visualizerBackgroundMode: null });
    // What the resets set off goes out with no one listening.
    await flush();
});

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
    removeFoliumEventHandlers('listener-mod');
    listFoliumHostRegistries().forEach((registry) => registry.unregisterAll('bg-mod'));
    resetFoliumVisualizerWriteLimitsForTest();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('listBackgrounds / getBackground', () => {
    it('lists the builtin types in the picker\'s order, and a mod\'s while it is registered', () => {
        const builtin = reader().listBackgrounds();
        expect(builtin.map((background) => background.id).sort()).toEqual([...BUILTIN_VISUALIZER_BACKGROUND_MODES].sort());
        expect(builtin.every((background) => background.kind === 'builtin' && background.label.length > 0)).toBe(true);
        expect(Object.isFrozen(builtin) && Object.isFrozen(builtin[0])).toBe(true);

        const handle = backgroundsRegistry.register('bg-mod', { id: 'video', label: { en: 'Video' }, mount: () => () => {} });
        expect(reader().listBackgrounds()).toContainEqual({ id: 'mod:bg-mod:video', label: 'Video', kind: 'mod' });
        handle.unregister();
        expect(reader().listBackgrounds().some((background) => background.kind === 'mod')).toBe(false);
    });

    it('reads the type the user picked, the default while none was picked, without a permission', () => {
        expect(reader().getBackground()).toBe(DEFAULT_VISUALIZER_BACKGROUND_MODE);
        settings().handleSetVisualizerBackgroundMode('monet');
        expect(reader().getBackground()).toBe('monet');
    });
});

describe('setBackground', () => {
    it('switches the type as the background picker does, and saves it', () => {
        const result = bgMod().setBackground('nomand');
        expect(result).toEqual({ ok: true, background: 'nomand' });
        expect(Object.isFrozen(result)).toBe(true);
        expect(settings().visualizerBackgroundMode).toBe('nomand');
        expect(storage.get('visualizer_background_mode')).toBe('nomand');
    });

    it('takes a mod\'s background while it is registered', () => {
        backgroundsRegistry.register('bg-mod', { id: 'video', label: { en: 'Video' }, mount: () => () => {} });
        expect(bgMod().setBackground('mod:bg-mod:video')).toEqual({ ok: true, background: 'mod:bg-mod:video' });
    });

    it('checks the permission, then the id; a type that is none now throws and writes nothing', () => {
        expect(() => reader().setBackground('nomand')).toThrow('permission-denied:visualizer.background');
        expect(() => reader().setBackground('mod:gone:video')).toThrow('permission-denied:visualizer.background');
        expect(() => bgMod().setBackground('mod:gone:video')).toThrow(TypeError);
        expect(() => bgMod().setBackground(undefined as unknown as string)).toThrow('invalid-arguments');
        expect(settings().visualizerBackgroundMode).toBeNull();
    });

    it('accepts a write that changes nothing without counting it, and limits the others on an allowance of its own', () => {
        vi.useFakeTimers();
        const mod = bgMod();
        expect(mod.setBackground(DEFAULT_VISUALIZER_BACKGROUND_MODE)).toEqual({ ok: true, background: DEFAULT_VISUALIZER_BACKGROUND_MODE });
        // Not picked by anyone: reading the default as picked is no reason to write it.
        expect(settings().visualizerBackgroundMode).toBeNull();
        expect(mod.setBackground('nomand').ok).toBe(true);
        vi.setSystemTime(Date.now() + 100);
        expect(mod.setBackground('monet')).toEqual({ ok: false, reason: 'rate-limited' });
        expect(mod.setBackground('nomand')).toEqual({ ok: true, background: 'nomand' });
        // Another mod has an allowance of its own.
        expect(visualizerOf(modInfo('other-mod')).setBackground('monet').ok).toBe(true);
    });

    it('answers `stopped` once the activation was torn down, and throws in the export window', () => {
        const stopped = visualizerOf(modInfo('bg-mod'), clientApiOptions('main', { stopped: () => true }));
        expect(stopped.setBackground('nomand')).toEqual({ ok: false, reason: 'stopped' });
        const exported = visualizerOf(modInfo('bg-mod'), clientApiOptions('export'));
        expect(() => exported.listBackgrounds()).toThrow('visualizer-unavailable-in-export-context');
        expect(() => exported.getBackground()).toThrow('visualizer-unavailable-in-export-context');
        expect(() => exported.setBackground('nomand')).toThrow('visualizer-unavailable-in-export-context');
        expect(settings().visualizerBackgroundMode).toBeNull();
    });
});

describe('visualizer.backgroundChanged', () => {
    const seen: Array<{ background: string; origin: FoliumVisualizerChangeOrigin }> = [];
    beforeEach(() => {
        seen.length = 0;
        addFoliumEventHandler('listener-mod', 'visualizer.backgroundChanged', (event) => { seen.push(event); });
    });

    it('fires once a task, as the mod that wrote and as the user', async () => {
        bgMod().setBackground('nomand');
        await flush();
        expect(seen).toEqual([{ background: 'nomand', origin: { kind: 'mod', modId: 'bg-mod' } }]);

        settings().handleSetVisualizerBackgroundMode('monet');
        settings().handleSetVisualizerBackgroundMode('sora');
        await flush();
        expect(seen.slice(1)).toEqual([{ background: 'sora', origin: { kind: 'user', modId: null } }]);
    });

    it('fires none for changes that end where they began', async () => {
        settings().handleSetVisualizerBackgroundMode('monet');
        settings().handleResetVisualizerBackgroundMode();
        // The default, picked outright: the same background as none picked.
        settings().handleSetVisualizerBackgroundMode(DEFAULT_VISUALIZER_BACKGROUND_MODE);
        await flush();
        expect(seen).toEqual([]);
    });
});

describe('the animation intensity', () => {
    const seen: Array<{ intensity: FoliumAnimationIntensity; origin: FoliumVisualizerChangeOrigin }> = [];
    beforeEach(() => {
        seen.length = 0;
        addFoliumEventHandler('listener-mod', 'visualizer.animationIntensityChanged', (event) => { seen.push(event); });
    });

    it('lists every level the theme can carry', () => {
        const levels: Theme['animationIntensity'][] = ['calm', 'normal', 'chaotic'];
        expect([...FOLIUM_ANIMATION_INTENSITIES]).toEqual(levels);
    });

    it('reads the saved level without a permission', () => {
        expect(reader().getAnimationIntensity()).toBe('normal');
        saveStoredAnimationIntensity('calm');
        expect(reader().getAnimationIntensity()).toBe('calm');
    });

    it('sets the theme\'s level as the player panel does, saves it, and reports the mod as the origin', () => {
        mountApp();
        let result: ReturnType<FoliumVisualizerService['setAnimationIntensity']> | null = null;
        act(() => { result = bgMod().setAnimationIntensity('chaotic'); });
        expect(result).toEqual({ ok: true, intensity: 'chaotic' });
        expect(appTheme.animationIntensity).toBe('chaotic');
        expect(storage.get('theme_animation_intensity')).toBe('chaotic');
        expect(seen).toEqual([{ intensity: 'chaotic', origin: { kind: 'mod', modId: 'bg-mod' } }]);
    });

    it('reports a change the user made as the user\'s', () => {
        mountApp();
        act(() => setAppTheme({ ...appTheme, animationIntensity: 'calm' }));
        expect(seen).toEqual([{ intensity: 'calm', origin: { kind: 'user', modId: null } }]);
    });

    it('checks the permission, then the value, and accepts a write that changes nothing', () => {
        mountApp();
        expect(() => reader().setAnimationIntensity('calm')).toThrow('permission-denied:visualizer.animationIntensity');
        expect(() => reader().setAnimationIntensity('wild' as FoliumAnimationIntensity)).toThrow('permission-denied:visualizer.animationIntensity');
        expect(() => bgMod().setAnimationIntensity('wild' as FoliumAnimationIntensity)).toThrow(TypeError);
        act(() => { expect(bgMod().setAnimationIntensity('normal')).toEqual({ ok: true, intensity: 'normal' }); });
        expect(seen).toEqual([]);
    });

    it('has an allowance apart from the background\'s', () => {
        mountApp();
        vi.useFakeTimers();
        const mod = bgMod();
        act(() => { expect(mod.setAnimationIntensity('calm').ok).toBe(true); });
        expect(mod.setBackground('nomand').ok).toBe(true);
        vi.setSystemTime(Date.now() + 100);
        expect(mod.setAnimationIntensity('chaotic')).toEqual({ ok: false, reason: 'rate-limited' });
    });

    it('fails clearly, uncounted, while the App is not there to take the write', () => {
        const mod = bgMod();
        expect(() => mod.setAnimationIntensity('calm')).toThrow('visualizer-unavailable-in-main-context');
        mountApp();
        // The failed write left the allowance whole.
        act(() => { expect(mod.setAnimationIntensity('calm')).toEqual({ ok: true, intensity: 'calm' }); });
    });

    it('answers `stopped` once the activation was torn down, and throws in the export window', () => {
        mountApp();
        const stopped = visualizerOf(modInfo('bg-mod'), clientApiOptions('main', { stopped: () => true }));
        expect(stopped.setAnimationIntensity('calm')).toEqual({ ok: false, reason: 'stopped' });
        const exported = visualizerOf(modInfo('bg-mod'), clientApiOptions('export'));
        expect(() => exported.getAnimationIntensity()).toThrow('visualizer-unavailable-in-export-context');
        expect(() => exported.setAnimationIntensity('calm')).toThrow('visualizer-unavailable-in-export-context');
        expect(appTheme.animationIntensity).toBe('normal');
    });
});
