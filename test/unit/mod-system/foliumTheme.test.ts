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
    FoliumDualThemeInput,
    FoliumThemeHelpers,
    FoliumThemeOverride,
    FoliumThemeOverrideChangeOrigin,
} from '@/mods/folium/contract';
import { createFoliumClientApi } from '@/mods/folium/api';
import { addFoliumEventHandler, removeFoliumEventHandlers } from '@/mods/folium/events';
import { resetFoliumThemeWriteLimitsForTest } from '@/mods/folium/theme/service';
import { reconcileFoliumClients } from '@/mods/runtime/clientLoader';
import { installFoliumHostTheme, noteFoliumCurrentTheme } from '@/mods/runtime/theme/hostTheme';
import { resolveControllerTheme } from '@/hooks/useThemeController';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '@/services/baseThemes';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';
import { endThemeOverrideForUserChoice, useThemeOverrideStore } from '@/stores/useThemeOverrideStore';
import type { DualTheme, Theme } from '@/types';
import { clientApiOptions } from './clientApiOptions';

// test/unit/mod-system/foliumTheme.test.ts
// Folium 1.10 `folium.theme`: the theme on screen, a theme made from colors, and a mod's theme laid over the
// song's theme through the theme override store. The checks in the contract's order, the allowance, the
// layer ending for the user and for the mod going away, the event a mod steps back by, and the controller
// showing the layer over every theme source but the preferred custom theme.

installFoliumHostTheme();

const flush = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });

const modInfo = (id: string, overrides: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
    id, name: `Mod ${id}`, version: '1.0.0', author: null, description: null, permissions: ['theme.write'],
    status: 'loaded', error: null, enabled: true, trustStale: false, signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null }, devSource: false, experimental: [], embedOrigins: [],
    folia: null, hasMain: false, clientUrl: null,
    ...overrides,
});

const themeOf = (mod: ModRuntimeInfo, options = clientApiOptions('main')): FoliumThemeHelpers => (
    createFoliumClientApi(mod, options).theme
);
const wallpaper = () => themeOf(modInfo('wallpaper'));
const other = () => themeOf(modInfo('other'));
const reader = () => themeOf(modInfo('reader', { permissions: [] }));

const feedModList = (mods: ModRuntimeInfo[]) => {
    void reconcileFoliumClients(mods, 'main');
};
const DEFAULT_LIST = () => [modInfo('wallpaper'), modInfo('other')];

const BLUE: FoliumDualThemeInput = {
    light: { backgroundColor: '#dde8f5', primaryColor: '#102030', accentColor: '#2266cc', secondaryColor: '#405060' },
    dark: { backgroundColor: '#0a1830', primaryColor: '#e8f0ff', accentColor: '#66aaff', secondaryColor: '#a0b0c0' },
};
const RED: FoliumDualThemeInput = {
    light: { backgroundColor: '#f5e0dd', name: 'Rose' },
    dark: { backgroundColor: '#301010', name: 'Ember' },
};

const seen: Array<{ override: FoliumThemeOverride; origin: FoliumThemeOverrideChangeOrigin }> = [];
const toast = () => useStatusMessageStore.getState().message;

let now = 1_000_000;

beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    storage.clear();
    useThemeOverrideStore.setState({ override: null, origin: { kind: 'host' }, customPreferred: false });
    feedModList(DEFAULT_LIST());
    await flush();
    useStatusMessageStore.setState({ message: null });
    addFoliumEventHandler('listener-mod', 'theme.overrideChanged', (event) => { seen.push(event); });
    seen.length = 0;
});

afterEach(() => {
    removeFoliumEventHandlers('listener-mod');
    resetFoliumThemeWriteLimitsForTest();
    vi.restoreAllMocks();
    now += 10 * 60_000;
});

describe('folium.theme reads', () => {
    it('reads the theme the App renders, frozen, in the mode it is shown in', () => {
        noteFoliumCurrentTheme(DAYLIGHT_THEME, true);
        const current = reader().getCurrent();
        expect(current.backgroundColor).toBe(DAYLIGHT_THEME.backgroundColor);
        expect(current.isDaylight).toBe(true);
        expect(Object.isFrozen(current)).toBe(true);
        expect(reader().getCurrent()).toBe(current);
    });

    it('reports no override and writable at first, with no permission needed', () => {
        expect(reader().getOverride()).toEqual({ modId: null, writable: true });
    });

    it('keeps the font helpers', () => {
        expect(typeof reader().resolveFontStack({ fontStyle: 'sans' })).toBe('string');
    });

    it('throws outside the main window, except for fromColors and the font helpers', () => {
        const exported = themeOf(modInfo('wallpaper'), clientApiOptions('export'));
        expect(() => exported.getCurrent()).toThrow('theme-unavailable-in-export-context');
        expect(() => exported.getOverride()).toThrow('theme-unavailable-in-export-context');
        expect(() => exported.apply(BLUE)).toThrow('theme-unavailable-in-export-context');
        expect(exported.fromColors(['#3366aa']).dark.isDaylight).toBe(false);
    });
});

describe('folium.theme.fromColors', () => {
    it('makes a frozen pair of full themes from hex colors', () => {
        const made = reader().fromColors(['#3a5f7d', '#d9c8a0']);
        expect(Object.isFrozen(made)).toBe(true);
        expect(made.light.isDaylight).toBe(true);
        expect(made.dark.isDaylight).toBe(false);
        for (const side of [made.light, made.dark]) {
            expect(side.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i);
            expect(side.name.length).toBeGreaterThan(0);
        }
    });

    it('refuses anything but 1-8 hex colors', () => {
        expect(() => reader().fromColors([])).toThrow('invalid-arguments');
        expect(() => reader().fromColors(Array(9).fill('#000000'))).toThrow('invalid-arguments');
        expect(() => reader().fromColors(['rgb(0, 0, 0)'])).toThrow('invalid-arguments: colors[0]');
        expect(() => reader().fromColors('#000000' as unknown as string[])).toThrow('invalid-arguments');
    });
});

describe('folium.theme.apply and release', () => {
    it('needs theme.write', () => {
        expect(() => reader().apply(BLUE)).toThrow('permission-denied:theme.write');
        expect(() => reader().release()).toThrow('permission-denied:theme.write');
    });

    it('checks the argument', () => {
        expect(() => wallpaper().apply(null as unknown as FoliumDualThemeInput)).toThrow('invalid-arguments');
        expect(() => wallpaper().apply({ light: BLUE.light } as FoliumDualThemeInput)).toThrow('invalid-arguments: theme.dark');
        expect(() => wallpaper().apply({ ...BLUE, dark: { backgroundColor: 'navy' } })).toThrow('theme.dark.backgroundColor');
        expect(() => wallpaper().apply({ ...BLUE, light: { wordColors: [{ word: 'x', color: 'red' }] } })).toThrow('wordColors[0]');
        expect(useThemeOverrideStore.getState().override).toBeNull();
    });

    it('lays the theme in the store, sanitized and named after the mod by default, and announces the takeover once', async () => {
        const result = wallpaper().apply({ light: { backgroundColor: '#ABC' }, dark: BLUE.dark });
        expect(result).toEqual({ ok: true, override: { modId: 'wallpaper', writable: true } });
        const { override } = useThemeOverrideStore.getState();
        expect(override?.modId).toBe('wallpaper');
        expect(override?.theme.light.backgroundColor).toBe('#aabbcc');
        expect(override?.theme.light.name).toBe('Mod wallpaper');
        expect(override?.theme.dark.accentColor).toBe('#66aaff');
        expect(toast()?.text).toContain('Mod wallpaper');

        await flush();
        expect(seen).toEqual([{ override: { modId: 'wallpaper', writable: true }, origin: { kind: 'mod', modId: 'wallpaper' } }]);

        // Another theme from the same mod: no new toast, and no overrideChanged (whose theme it is did not change).
        useStatusMessageStore.setState({ message: null });
        now += 2000;
        expect(wallpaper().apply(RED).ok).toBe(true);
        expect(useThemeOverrideStore.getState().override?.theme.dark.name).toBe('Ember');
        expect(toast()).toBeNull();
        await flush();
        expect(seen).toHaveLength(1);
    });

    it('accepts the same theme again without counting it', () => {
        expect(wallpaper().apply(BLUE).ok).toBe(true);
        // Within the same second: a counted write would be rate-limited.
        expect(wallpaper().apply(BLUE)).toEqual({ ok: true, override: { modId: 'wallpaper', writable: true } });
        expect(wallpaper().apply(RED)).toEqual({ ok: false, reason: 'rate-limited' });
    });

    it('allows 20 counted writes a minute, one a second', () => {
        for (let index = 0; index < 20; index += 1) {
            now += 1000;
            expect(wallpaper().apply(index % 2 ? BLUE : RED).ok).toBe(true);
        }
        // The last one laid was BLUE: RED changes something, so it would count.
        now += 1000;
        expect(wallpaper().apply(RED)).toEqual({ ok: false, reason: 'rate-limited' });
    });

    it('is refused while the user prefers their custom theme, after the stopped check', () => {
        useThemeOverrideStore.getState().setCustomPreferred(true);
        expect(wallpaper().getOverride()).toEqual({ modId: null, writable: false });
        expect(wallpaper().apply(BLUE)).toEqual({ ok: false, reason: 'custom-preferred' });
        const stopped = themeOf(modInfo('wallpaper'), clientApiOptions('main', { stopped: () => true }));
        expect(stopped.apply(BLUE)).toEqual({ ok: false, reason: 'stopped' });
        expect(stopped.release()).toBe(false);
    });

    it('releases only its own theme', async () => {
        wallpaper().apply(BLUE);
        // Laid and taken off in one task would end where it began, and fire nothing.
        await flush();
        expect(other().release()).toBe(false);
        expect(wallpaper().release()).toBe(true);
        expect(wallpaper().release()).toBe(false);
        expect(useThemeOverrideStore.getState().override).toBeNull();
        await flush();
        expect(seen.at(-1)).toEqual({ override: { modId: null, writable: true }, origin: { kind: 'mod', modId: 'wallpaper' } });
    });

    it('lets another mod take the theme over', async () => {
        wallpaper().apply(BLUE);
        await flush();
        expect(other().apply(RED).ok).toBe(true);
        await flush();
        expect(seen.at(-1)).toEqual({ override: { modId: 'other', writable: true }, origin: { kind: 'mod', modId: 'other' } });
    });
});

describe('the override ends', () => {
    it('when the user chooses a theme', async () => {
        wallpaper().apply(BLUE);
        await flush();
        endThemeOverrideForUserChoice();
        expect(useThemeOverrideStore.getState().override).toBeNull();
        await flush();
        expect(seen.at(-1)).toEqual({ override: { modId: null, writable: true }, origin: { kind: 'user', modId: null } });
    });

    it('when its mod is disabled or removed, not when it reloads', async () => {
        wallpaper().apply(BLUE);
        await flush();
        feedModList([modInfo('wallpaper', { version: '1.0.1' }), modInfo('other')]);
        expect(useThemeOverrideStore.getState().override?.modId).toBe('wallpaper');
        feedModList([modInfo('wallpaper', { enabled: false, status: 'disabled' }), modInfo('other')]);
        expect(useThemeOverrideStore.getState().override).toBeNull();
        await flush();
        expect(seen.at(-1)?.origin).toEqual({ kind: 'host', modId: null });

        feedModList(DEFAULT_LIST());
        now += 2000;
        wallpaper().apply(BLUE);
        feedModList([modInfo('other')]);
        expect(useThemeOverrideStore.getState().override).toBeNull();
    });

    it('fires writable again when the custom preference goes off', async () => {
        useThemeOverrideStore.getState().setCustomPreferred(true);
        await flush();
        useThemeOverrideStore.getState().setCustomPreferred(false);
        await flush();
        expect(seen.map((event) => event.override.writable)).toEqual([false, true]);
        expect(seen.every((event) => event.origin.kind === 'host')).toBe(true);
    });
});

describe('resolveControllerTheme with a mod theme', () => {
    const theme = (name: string, backgroundColor: string): Theme => ({
        name, backgroundColor, primaryColor: '#111111', accentColor: '#222222', secondaryColor: '#333333', fontStyle: 'sans', animationIntensity: 'normal',
    });
    const MOD: DualTheme = { light: theme('mod light', '#eeeeff'), dark: theme('mod dark', '#000011') };
    const AI: DualTheme = { light: theme('ai light', '#ffffff'), dark: theme('ai dark', '#000000') };
    const CUSTOM: DualTheme = { light: theme('custom light', '#eeeeee'), dark: theme('custom dark', '#101010') };
    const resolve = (overrides: Partial<Parameters<typeof resolveControllerTheme>[0]>) => resolveControllerTheme({
        bgMode: 'ai', aiTheme: AI, legacyTheme: null, customTheme: CUSTOM, isDaylight: false,
        defaultTheme: DEFAULT_THEME, daylightTheme: DAYLIGHT_THEME, previousTheme: DEFAULT_THEME,
        ...overrides,
    });

    it('shows the mod theme over every source, in the mode on screen', () => {
        for (const bgMode of ['default', 'ai', 'custom'] as const) {
            expect(resolve({ bgMode, overrideTheme: MOD }).name).toBe('mod dark');
            expect(resolve({ bgMode, overrideTheme: MOD, isDaylight: true }).name).toBe('mod light');
        }
    });

    it('lends the keyword colors and icons of a released mod theme to nothing', () => {
        const previousTheme: Theme = { ...MOD.dark, provider: 'mod:wallpaper', wordColors: [{ word: 'x', color: '#ff0000' }], lyricsIcons: ['star'] };
        const fallback = resolve({ aiTheme: null, previousTheme });
        expect(fallback.wordColors).toEqual([]);
        expect(fallback.lyricsIcons).toEqual([]);
        const kept = resolve({ aiTheme: null, previousTheme: { ...previousTheme, provider: 'AI' } });
        expect(kept.lyricsIcons).toEqual(['star']);
    });

    it('steps aside while the user prefers their custom theme', () => {
        expect(resolve({ bgMode: 'custom', overrideTheme: MOD, customPreferred: true }).name).toBe('custom dark');
        expect(resolve({ overrideTheme: null }).name).toBe('ai dark');
    });
});
