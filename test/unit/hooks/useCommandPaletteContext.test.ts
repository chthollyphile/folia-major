// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCommandPaletteContext, type CommandPaletteContextDeps } from '@/hooks/useCommandPaletteContext';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { usePersonalFmModeStore } from '@/stores/usePersonalFmModeStore';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { DEFAULT_PERSONAL_FM_CATALOG } from '@/services/onlineMusic/fmModes';
import type { CommandPaletteContext } from '@/components/command-palette/types';
import type { LyricSegmentationActions } from '@/components/app/playback/createLyricSegmentationActions';
import type { SongResult } from '@/types';

// A provider switch must invalidate the memo even when playback and both cached catalogues stay put.
vi.mock('react-i18next', async importOriginal => {
    const actual = await importOriginal<typeof import('react-i18next')>();
    const t = (key: string, fallback?: string) => fallback || key;
    return { ...actual, useTranslation: () => ({ t }) };
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
