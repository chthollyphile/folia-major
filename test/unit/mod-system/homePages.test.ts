// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModRuntimeInfo } from '@/mods/types';
import { createFoliumClientApi, addFoliumTeardownRegistries, listFoliumHostRegistries } from '@/mods/folium/api';
import { createFoliumExperimental, EXPERIMENTAL_REGISTRIES } from '@/mods/folium/experimental';
import { registerFoliumHostActions, type FoliumHostActions } from '@/mods/folium/services';
import { closeOwnedHomePage, homePagesRegistry, openHomePage, useHomePageStore, type HomePageDefinition } from '@/mods/folium/homePages';

// test/unit/mod-system/homePages.test.ts
// Ownership, opt-in and teardown boundaries for isolated, append-only home pages.
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

const definition = (): HomePageDefinition => ({ id: 'notes', label: { en: 'Notes' }, mountNavigation: vi.fn(), mountPage: vi.fn() });
const mod = (experimental: string[] = []): ModRuntimeInfo => ({
    id: 'mod-a', name: 'A', version: '1.0.0', author: null, description: null, permissions: [],
    status: 'loaded', error: null, enabled: true, trustStale: false,
    signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false, experimental, embedOrigins: [], folia: null, hasMain: false, clientUrl: null,
});
type PageApi = { register: (def: HomePageDefinition) => { unregister(): void }; open: (id: string) => boolean; close: (id: string) => boolean };
const api = () => createFoliumExperimental(mod(['home.pages']))['home.pages'] as PageApi;
afterEach(() => {
    homePagesRegistry.unregisterAll('mod-a'); homePagesRegistry.unregisterAll('mod-b');
    registerFoliumHostActions(null); vi.restoreAllMocks();
});
describe('home.pages', () => {
    it('requires experimental opt-in without adding to the stable registries or UI service', () => {
        const plain = mod();
        const client = createFoliumClientApi(plain, { context: 'main', internals: null, experimental: createFoliumExperimental(plain) });
        expect(() => client.experimental['home.pages']).toThrow('experimental-not-declared:home.pages');
        expect(client.registries).not.toHaveProperty('homeTabs');
        expect(client.registries).not.toHaveProperty('homePages');
        expect(client.ui).not.toHaveProperty('openHomeTab');
        const optedIn = mod(['home.pages']);
        const enabled = createFoliumClientApi(optedIn, { context: 'main', internals: null, experimental: createFoliumExperimental(optedIn) });
        (enabled.experimental['home.pages'] as PageApi).register(definition());
        expect(homePagesRegistry.list().map(entry => entry.id)).toEqual(['mod-a:notes']);
        const exported = createFoliumClientApi(optedIn, { context: 'export', internals: null });
        expect(() => exported.experimental['home.pages']).toThrow('experimental-unknown:home.pages');
    });
    it('requires both mounts and a readable localized label', () => {
        for (const field of ['mountNavigation', 'mountPage'] as const) {
            expect(() => api().register({ ...definition(), [field]: null as never })).toThrow(field === 'mountPage' ? 'mountPage' : 'mountNavigation');
        }
        for (const label of [{}, { en: '' }, 'Notes', { en: 1 }]) {
            expect(() => api().register({ ...definition(), label: label as never })).toThrow('label');
        }
    });
    it('appends only owned entries in registration order and copies accepted definitions', () => {
        const def = definition();
        homePagesRegistry.register('mod-b', { ...def, id: 'playlist' });
        homePagesRegistry.register('mod-a', def);
        def.label.en = 'Changed';
        def.mountPage = vi.fn();
        expect(homePagesRegistry.list().map(entry => entry.id)).toEqual(['mod-b:playlist', 'mod-a:notes']);
        expect(homePagesRegistry.get('mod-a:notes')?.def.label.en).toBe('Notes');
        expect(Object.isFrozen(homePagesRegistry.get('mod-a:notes')?.def)).toBe(true);
        expect(Object.keys(api())).toEqual(['register', 'open', 'close']);
        expect(() => api().register(definition())).toThrow('duplicate');
    });
    it('opens only its owner after navigation and cannot close another owner', () => {
        const navigate = vi.fn(() => useHomePageStore.setState({ activeId: null }));
        registerFoliumHostActions({ navigate } as unknown as FoliumHostActions);
        homePagesRegistry.register('mod-b', definition());
        expect(api().open('notes')).toBe(false);
        expect(api().open('mod-b:notes')).toBe(false);
        expect(navigate).not.toHaveBeenCalled();
        api().register(definition());
        expect(api().open('notes')).toBe(true);
        expect(navigate).toHaveBeenCalledWith('home');
        expect(useHomePageStore.getState().activeId).toBe('mod-a:notes');
        openHomePage(homePagesRegistry.get('mod-b:notes')!);
        expect(api().close('notes')).toBe(false);
        expect(useHomePageStore.getState().activeId).toBe('mod-b:notes');
        expect(closeOwnedHomePage(homePagesRegistry.get('mod-b:notes')!)).toBe(true);
        expect(useHomePageStore.getState().activeId).toBeNull();
    });
    it('falls back on active owner teardown without closing another owner', () => {
        addFoliumTeardownRegistries(EXPERIMENTAL_REGISTRIES);
        api().register(definition()); homePagesRegistry.register('mod-b', definition());
        openHomePage(homePagesRegistry.get('mod-a:notes')!);
        listFoliumHostRegistries().forEach(registry => registry.unregisterAll('mod-b'));
        expect(useHomePageStore.getState().activeId).toBe('mod-a:notes');
        listFoliumHostRegistries().forEach(registry => registry.unregisterAll('mod-a'));
        expect(useHomePageStore.getState().activeId).toBeNull();
        expect(homePagesRegistry.list()).toEqual([]);
    });
    it('stale handles and contexts cannot remove, reopen or close a replacement', () => {
        const handle = homePagesRegistry.register('mod-a', definition());
        const stale = homePagesRegistry.get('mod-a:notes')!;
        handle.unregister(); api().register(definition());
        const fresh = homePagesRegistry.get('mod-a:notes')!;
        openHomePage(fresh); handle.unregister();
        expect(homePagesRegistry.get(fresh.id)).toBe(fresh);
        expect(closeOwnedHomePage(stale)).toBe(false);
        expect(openHomePage(stale)).toBe(false);
        expect(useHomePageStore.getState().activeId).toBe(fresh.id);
    });
    it('does not select an entry removed synchronously during host navigation', () => {
        const handle = api().register(definition());
        registerFoliumHostActions({ navigate: () => handle.unregister() } as unknown as FoliumHostActions);
        expect(api().open('notes')).toBe(false);
        expect(useHomePageStore.getState().activeId).toBeNull();
    });
});
