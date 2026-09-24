// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import type { SongResult } from '@/types';
import type { ModRuntimeInfo } from '@/mods/types';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { applyOmniAudioHook, applyOmniLyricsHook } from '@/services/hostExtensionHooks';
import { findPonderTarget } from '@/components/ponder/ponderRegistry';
import { createFoliumExperimental, ponderTargetsRegistry } from '@/mods/folium/experimental';
import { omniProvidersRegistry } from '@/mods/folium/registries/omniProviders';
import { createFoliumClientApi } from '@/mods/folium/api';
import { removeFoliumEventHandlers } from '@/mods/folium/events';

// test/unit/mod-system/foliumExperimental.test.ts
// The opt-in surfaces: a mod Omni provider adapted to the host contract, the
// Omni result hooks, Ponder targets, and the gate that keeps all of them out of
// reach without the manifest opt-in.

const mod = (overrides: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
    id: 'mod-a', name: 'A', version: '1.0.0', author: null, description: null, permissions: [],
    status: 'loaded', error: null, enabled: true, trustStale: false, experimental: [], embedOrigins: [],
    folia: null, hasMain: false, clientUrl: null, ...overrides,
});

afterEach(() => {
    omniProvidersRegistry.unregisterAll('mod-a');
    ponderTargetsRegistry.unregisterAll('mod-a');
    removeFoliumEventHandlers('mod-a');
});

describe('omni.providers', () => {
    it('adapts a mod provider to the host contract and removes it again', async () => {
        const handle = omniProvidersRegistry.register('mod-a', {
            id: 'radio',
            displayName: 'Mod Radio',
            search: async (query) => ({ items: [{ id: 's1', title: `${query}!`, artists: ['X', 'Y'] }], hasMore: false }),
            getAudioUrl: async (song) => ({ url: `https://cdn.example/${song.id}.mp3` }),
            getLyrics: async () => ({ lrc: '[00:01.00]hello\n[00:03.00]world' }),
        });
        const provider = getOnlineMusicProvider('folium.mod-a.radio');
        expect(provider?.capabilities).toMatchObject({ search: true, playback: true, lyrics: true, auth: false });

        const page = await provider!.search!.searchSongs('q', 10, 0);
        const song = page.items[0];
        expect(song.sourceRef).toEqual({ kind: 'online', providerId: 'folium.mod-a.radio', mediaId: 's1' });
        expect(song.artists.map((artist) => artist.name)).toEqual(['X', 'Y']);
        expect(page.nextOffset).toBe(1);

        const audio = await provider!.playback!.getAudioSource(song, 'high');
        expect(audio).toMatchObject({ url: 'https://cdn.example/s1.mp3', quality: 'high' });

        const lyrics = await provider!.lyrics!.getLyrics(song);
        expect(lyrics.lyrics?.lines.map((line) => line.fullText)).toEqual(['hello', 'world']);

        handle.unregister();
        expect(getOnlineMusicProvider('folium.mod-a.radio')).toBeNull();
    });

    it('refuses a provider with no capability', () => {
        expect(() => omniProvidersRegistry.register('mod-a', { id: 'empty', displayName: 'x' })).toThrow('at least one');
    });
});

describe('omni.hooks', () => {
    const song = { id: 1, name: 'S', artists: [], album: { id: 1, name: '' }, durationMs: 0 } as unknown as SongResult;

    it('passes through while nobody listens and applies handlers once they do', async () => {
        const source = { url: 'https://a.example/x.mp3', fetchedAt: 1, quality: 'high' as const };
        expect(await applyOmniAudioHook(song, source)).toBe(source);

        const experimental = createFoliumExperimental(mod({ experimental: ['omni.hooks'] }));
        (experimental['omni.hooks'] as { on: (type: string, handler: (event: any) => void) => void }).on('audioSourceResolved', (event) => {
            event.url = 'https://b.example/y.mp3';
        });
        (experimental['omni.hooks'] as { on: (type: string, handler: (event: any) => void) => void }).on('lyricsResolved', (event) => {
            event.lines = event.lines.map((line: { text: string }) => ({ ...line, text: line.text.toUpperCase() }));
        });

        expect(await applyOmniAudioHook(song, source)).toMatchObject({ url: 'https://b.example/y.mp3', quality: 'high' });
        const lyrics = await applyOmniLyricsHook(song, {
            lyrics: { lines: [{ words: [], startTime: 0, endTime: 1, fullText: 'hi' }] },
            isPureMusic: false,
        });
        expect(lyrics.lyrics?.lines[0].fullText).toBe('HI');
    });
});

describe('ponder.targets', () => {
    it('adds a namespaced target to the host Ponder registry', () => {
        ponderTargetsRegistry.register('mod-a', {
            id: 'panel',
            titleKey: 'My mod panel',
            category: 'player' as never,
            hoverSelector: null,
            scenes: [],
        });
        expect(findPonderTarget('mod-a:panel' as never)?.titleKey).toBe('My mod panel');
        ponderTargetsRegistry.unregisterAll('mod-a');
        expect(findPonderTarget('mod-a:panel' as never)).toBeNull();
    });
});

describe('experimental gate', () => {
    it('keeps undeclared surfaces and omni events out of reach', () => {
        const api = createFoliumClientApi(mod(), {
            context: 'main',
            internals: null,
            experimental: createFoliumExperimental(mod()),
        });
        expect(() => api.experimental['omni.providers']).toThrow('experimental-not-declared:omni.providers');
        expect(() => api.events.on('omni.audioSourceResolved', () => {})).toThrow('experimental-not-declared:omni.hooks');

        const optedIn = mod({ experimental: ['omni.providers'] });
        const allowed = createFoliumClientApi(optedIn, { context: 'main', internals: null, experimental: createFoliumExperimental(optedIn) });
        expect(allowed.experimental['omni.providers']).toHaveProperty('register');
    });
});
