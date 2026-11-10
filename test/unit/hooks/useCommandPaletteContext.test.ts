// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recommendationPreferencesCommand } from '@/components/command-palette/commands/recommendationPreferencesCommand';
import { useCommandPalette } from '@/components/command-palette/useCommandPalette';
import { useCommandPaletteContext, type CommandPaletteContextDeps } from '@/hooks/useCommandPaletteContext';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { usePersonalFmModeStore } from '@/stores/usePersonalFmModeStore';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { DEFAULT_PERSONAL_FM_CATALOG } from '@/services/onlineMusic/fmModes';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import type { CommandPaletteContext } from '@/components/command-palette/types';
import type { LyricSegmentationActions } from '@/components/app/playback/createLyricSegmentationActions';
import type { SongResult } from '@/types';
import type { OnlineMusicProvider } from '@/types/onlineMusic';

// A provider switch must invalidate the memo even when playback and both cached catalogues stay put.
vi.mock('react-i18next', async importOriginal => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    const t = (key: string, fallback?: string) => fallback || key;
    return { ...actual, useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('@/components/command-palette/commandRegistry', async importOriginal => {
    const actual = await importOriginal<typeof import('@/components/command-palette/commandRegistry')>();
    const { recommendationPreferencesCommand } = await import('@/components/command-palette/commands/recommendationPreferencesCommand');
    return { ...actual, COMMAND_PALETTE_COMMANDS: [recommendationPreferencesCommand] };
});
vi.mock('@/components/app/command-palette-context/buildSearchCommandContext', () => ({ buildSearchCommandContext: () => ({}) }));
vi.mock('@/components/app/command-palette-context/buildSettingsCommandContext', () => ({ buildSettingsCommandContext: () => ({}) }));
vi.mock('@/components/app/command-palette-context/buildVisualizerCommandContext', () => ({ buildVisualizerCommandContext: () => ({}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); container?.remove(); });

describe('command palette provider snapshot', () => {
    it.each(['local', 'navidrome'])('updates FM choices while %s playback remains selected', kind => {
        const catalog = { ...DEFAULT_PERSONAL_FM_CATALOG, scenes: [{ id: '33', category: 'activity', labelKey: '', labelFallback: 'Driving', keywords: [] }] };
        usePlaybackStore.setState({ currentSong: { id: 'kept', sourceRef: { kind, mediaId: 'kept' } } as unknown as SongResult });
        useOnlineProviderAccountStore.setState({ activeProviderId: 'netease' });
        usePersonalFmModeStore.setState({ catalogs: { netease: DEFAULT_PERSONAL_FM_CATALOG, qishui: catalog },
            providerSelections: { qishui: { mode: 'SCENE_RCMD', scene: '33' } } });
        const deps = { isPersonalFmModeSupported: true } as CommandPaletteContextDeps;
        const actions = {} as LyricSegmentationActions;
        let context!: CommandPaletteContext;
        const Probe = () => { context = useCommandPaletteContext(deps, actions); return null; };
        container = document.body.appendChild(document.createElement('div'));
        root = createRoot(container);
        act(() => root!.render(createElement(Probe)));
        const original = context;
        expect(context.playback.personalFmCatalog).toBe(DEFAULT_PERSONAL_FM_CATALOG);
        act(() => useOnlineProviderAccountStore.getState().setActiveProviderId('qishui'));
        expect(context).not.toBe(original);
        expect(context.playback.personalFmCatalog).toBe(catalog);
        expect(context.playback.personalFmSelection).toEqual({ mode: 'SCENE_RCMD', scene: '33' });
        act(() => useOnlineProviderAccountStore.getState().setActiveProviderId('netease'));
        expect(context.playback.personalFmCatalog).toBe(DEFAULT_PERSONAL_FM_CATALOG);
    });
});

describe('recommendation preferences command visibility', () => {
    const providerId = 'preferences-context-test';
    const register = (supported: boolean, id = providerId) => {
        const provider: OnlineMusicProvider = {
            id,
            displayName: id,
            capabilities: {
                search: false, playback: false, lyrics: false, auth: true, userLibrary: false,
                playlists: false, albums: false, artists: false, recommendations: true,
                mutations: false, wordByWordLyrics: false, recommendationPreferences: supported,
            },
            normalizeSong: () => { throw new Error('not used'); },
            recommendations: {
                getRecommendationPreferences: async () => ({ items: [] }),
                saveRecommendationPreferences: async () => ({ confirmed: true }),
            },
        };
        registerOnlineMusicProvider(provider);
    };
    const signIn = (id = 'first') => useOnlineProviderAccountStore.getState().updateAccount(providerId, {
        status: 'authenticated', user: { id, nickname: id },
    });
    const mount = () => {
        const deps = {} as CommandPaletteContextDeps;
        const actions = {} as LyricSegmentationActions;
        let palette!: ReturnType<typeof useCommandPalette>;
        let renders = 0;
        const Probe = () => {
            renders += 1;
            const context = useCommandPaletteContext(deps, actions);
            palette = useCommandPalette({ context, isBlocked: false });
            return null;
        };
        container = document.body.appendChild(document.createElement('div'));
        root = createRoot(container);
        act(() => root!.render(createElement(Probe)));
        act(() => palette.open());
        return {
            isOffered: () => palette.availableCommands.includes(recommendationPreferencesCommand),
            renderCount: () => renders,
        };
    };

    afterEach(() => {
        act(() => {
            unregisterOnlineMusicProvider(providerId);
            unregisterOnlineMusicProvider(`${providerId}-other`);
            useOnlineProviderAccountStore.getState().clearAccount(providerId);
            useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
        });
    });

    it('updates the open palette when the current account signs in and out', () => {
        register(true);
        useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);
        const palette = mount();
        expect(palette.isOffered()).toBe(false);

        act(() => signIn());
        expect(palette.isOffered()).toBe(true);

        act(() => useOnlineProviderAccountStore.getState().clearAccount(providerId));
        expect(palette.isOffered()).toBe(false);
    });

    it('updates the open palette when the current provider changes its capability', () => {
        register(false);
        useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);
        signIn();
        const palette = mount();
        expect(palette.isOffered()).toBe(false);

        act(() => register(true));
        expect(palette.isOffered()).toBe(true);

        act(() => unregisterOnlineMusicProvider(providerId));
        expect(palette.isOffered()).toBe(false);
    });

    it('does not re-render the palette for account and provider changes that keep visibility', () => {
        register(true);
        useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);
        signIn();
        const palette = mount();
        const renders = palette.renderCount();
        expect(palette.isOffered()).toBe(true);

        act(() => signIn('second'));
        act(() => register(true, `${providerId}-other`));
        act(() => register(true));
        expect(palette.renderCount()).toBe(renders);
        expect(palette.isOffered()).toBe(true);
    });
});
