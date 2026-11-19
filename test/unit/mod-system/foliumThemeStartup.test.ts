// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// The saved custom theme preference, there before any store module is imported.
vi.hoisted(() => {
    const items = new Map<string, string>([['custom_theme_preferred', 'true']]);
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
import { createFoliumClientApi } from '@/mods/folium/api';
import { installFoliumHostTheme } from '@/mods/runtime/theme/hostTheme';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';
import { useThemeOverrideStore } from '@/stores/useThemeOverrideStore';
import { clientApiOptions } from './clientApiOptions';

// test/unit/mod-system/foliumThemeStartup.test.ts
// Folium 1.10: mods activate before the App mounts, so before the theme controller mirrors the custom theme
// preference. The override store reads the saved preference itself: an `apply` in `activate` is refused
// `custom-preferred` rather than accepted, announced and then taken off unseen.

installFoliumHostTheme();

describe('folium.theme.apply before the first screen', () => {
    it('is refused while the saved preference is the custom theme', () => {
        const mod: ModRuntimeInfo = {
            id: 'wallpaper', name: 'Wallpaper', version: '1.0.0', author: null, description: null, permissions: ['theme.write'],
            status: 'loaded', error: null, enabled: true, trustStale: false, signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null }, devSource: false, experimental: [], embedOrigins: [],
            folia: null, hasMain: false, clientUrl: null,
        };
        const theme = createFoliumClientApi(mod, clientApiOptions('main')).theme;
        expect(theme.getOverride()).toEqual({ modId: null, writable: false });
        expect(theme.apply({ light: {}, dark: {} })).toEqual({ ok: false, reason: 'custom-preferred' });
        expect(useThemeOverrideStore.getState().override).toBeNull();
        expect(useStatusMessageStore.getState().message).toBeNull();
    });
});
