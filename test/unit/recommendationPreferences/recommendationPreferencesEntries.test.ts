// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({ t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key) }),
}));

import { FmRecommendationPreferencesButton } from '@/components/recommendationPreferences/FmRecommendationPreferencesButton';
import { RECOMMENDATION_PREFERENCES_COMMAND_ID } from '@/components/command-palette/commands/recommendationPreferencesCommand';
import GridDailyRecommendationControls from '@/library/suites/grid/collection/GridDailyRecommendationControls';
import { BravaisSeamCollectionMeta } from '@/library/suites/bravais/BravaisSeamCollection';
import { EMPTY_COLLECTION_MUTATION_SNAPSHOT } from '@/library/core/collection/mutations/collectionMutationCapabilities';
import { omni } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useAppViewStore } from '@/stores/useAppViewStore';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type { CollectionMutationSnapshot } from '@/library/core/collection/mutations/mutations.contract';
import type { RecommendationPreferenceEntry } from '@/types/onlineMusic';
import FmTab from '@/components/panelTab/FmTab';
import { DEFAULT_PERSONAL_FM_SELECTION } from '@/services/onlineMusic/fmModes';
import { usePersonalFmModeStore } from '@/stores/usePersonalFmModeStore';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { PlayerState } from '@/types';

// test/unit/recommendationPreferences/recommendationPreferencesEntries.test.ts
// 私人 FM 页签、网格的每日推荐控制列和 Bravais 信息条的每日推荐区块上的「偏好设置」：平台声明了那一处、已经登录才出现，
// 点了打开命令面板里的偏好面板；没声明时一切照旧（网易云的「默认推荐 / 风格推荐」还在）。

const providerId = 'preferences-entries-test';
let root: Root | null = null;
let host: HTMLDivElement;

const register = (entries: RecommendationPreferenceEntry[] | null) => {
    registerOnlineMusicProvider({
        id: providerId,
        displayName: providerId,
        capabilities: {
            search: false, playback: false, lyrics: false, auth: true, userLibrary: false,
            playlists: false, albums: false, artists: false, recommendations: true,
            mutations: false, wordByWordLyrics: false, ...(entries ? { recommendationPreferences: true } : {}),
        },
        normalizeSong: () => { throw new Error('not used'); },
        recommendations: {
            preferenceEntries: entries ?? undefined,
            getRecommendationPreferences: async () => ({ items: [] }),
            saveRecommendationPreferences: async () => ({ confirmed: true }),
        },
    });
    const accounts = useOnlineProviderAccountStore.getState();
    accounts.setActiveProviderId(providerId);
    accounts.updateAccount(providerId, { status: 'authenticated', user: { id: 'u1', nickname: 'u1' } as never });
};

const render = async (element: React.ReactElement) => {
    await act(async () => {
        root = createRoot(host);
        root.render(element);
    });
};

const find = (selector: string) => host.querySelector<HTMLButtonElement>(selector);

const dailySnapshot = (overrides: Partial<CollectionMutationSnapshot> = {}): CollectionMutationSnapshot => ({
    ...EMPTY_COLLECTION_MUTATION_SNAPSHOT,
    capabilities: {
        ...EMPTY_COLLECTION_MUTATION_SNAPSHOT.capabilities,
        dailyDate: { supported: true, enabled: true, pending: false },
    },
    ...overrides,
});

const gridControls = (snapshot: CollectionMutationSnapshot) => React.createElement(GridDailyRecommendationControls, {
    mutations: null, snapshot, loading: false, isDaylight: false, theme: {} as never, onBeforeSwitch: () => undefined,
});

beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
});

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
    vi.restoreAllMocks();
    unregisterOnlineMusicProvider(providerId);
    useOnlineProviderAccountStore.getState().clearAccount(providerId);
    useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
    omni.invalidateActiveRequests();
});

describe('the personal FM entry', () => {
    it('shows where the provider declares it, and opens the preferences panel', async () => {
        const open = vi.spyOn(useAppViewStore.getState(), 'requestCommandPaletteCommand');
        register(['personal-fm']);
        await render(React.createElement(FmRecommendationPreferencesButton));
        const button = find('[data-testid="fm-recommendation-preferences"]');
        expect(button?.textContent).toBe('recommendationPreferences.open');
        act(() => button!.click());
        expect(open).toHaveBeenCalledWith(RECOMMENDATION_PREFERENCES_COMMAND_ID);
    });

    it('stays away where the provider declares other entries or none', async () => {
        register(['daily']);
        await render(React.createElement(FmRecommendationPreferencesButton));
        expect(find('[data-testid="fm-recommendation-preferences"]')).toBeNull();
        act(() => root?.unmount());
        unregisterOnlineMusicProvider(providerId);

        register(null);
        await render(React.createElement(FmRecommendationPreferencesButton));
        expect(find('[data-testid="fm-recommendation-preferences"]')).toBeNull();
    });

    it('goes away when the account signs out', async () => {
        register(['personal-fm']);
        await render(React.createElement(FmRecommendationPreferencesButton));
        expect(find('[data-testid="fm-recommendation-preferences"]')).not.toBeNull();
        await act(async () => {
            useOnlineProviderAccountStore.getState().updateAccount(providerId, { status: 'anonymous', user: null });
        });
        expect(find('[data-testid="fm-recommendation-preferences"]')).toBeNull();
    });
});

describe('the daily recommendations entry in the grid', () => {
    it('takes the place of the mode switch for a provider that declares it and has no style recommendations', async () => {
        const open = vi.spyOn(useAppViewStore.getState(), 'requestCommandPaletteCommand');
        register(['daily']);
        await render(gridControls(dailySnapshot()));
        const button = find('[data-testid="daily-recommendation-preferences"]');
        expect(button).not.toBeNull();
        expect(host.querySelector('[aria-label="home.dailyRecommendationMode"]')).toBeNull();
        act(() => button!.click());
        expect(open).toHaveBeenCalledWith(RECOMMENDATION_PREFERENCES_COMMAND_ID);
    });

    it('keeps the mode switch as it is where the provider does not declare it', async () => {
        register(['personal-fm']);
        await render(gridControls(dailySnapshot({ dailyStyleAvailable: true })));
        expect(find('[data-testid="daily-recommendation-preferences"]')).toBeNull();
        expect(host.querySelector('[aria-label="home.dailyRecommendationMode"]')).not.toBeNull();
    });

    it('shows both when a provider has style recommendations and declares the entry', async () => {
        register(['daily']);
        await render(gridControls(dailySnapshot({ dailyStyleAvailable: true })));
        expect(find('[data-testid="daily-recommendation-preferences"]')).not.toBeNull();
        expect(host.querySelector('[aria-label="home.dailyRecommendationMode"]')).not.toBeNull();
    });
});

describe('the daily recommendations entry in the Bravais seam', () => {
    const daily = {
        label: 'today', ariaLabel: 'date', disabled: false, refreshLabel: 'refresh',
    };

    it('draws the entry the seam is given and opens it', async () => {
        const onOpen = vi.fn();
        await render(React.createElement(BravaisSeamCollectionMeta, {
            collection: { menu: [], moreLabel: 'more', daily: { ...daily, preferences: { label: 'Preferences', onOpen } } },
        }));
        const button = find('[data-bravais-seam-action="daily-preferences"]');
        expect(button?.textContent).toBe('Preferences');
        act(() => button!.click());
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('draws none without it', async () => {
        await render(React.createElement(BravaisSeamCollectionMeta, { collection: { menu: [], moreLabel: 'more', daily } }));
        expect(find('[data-bravais-seam-action="daily-preferences"]')).toBeNull();
    });
});

describe('the personal FM tab while an extra station plays', () => {
    const fmTab = () => React.createElement(FmTab, {
        playerState: PlayerState.PAUSED,
        modeLabel: 'mode',
        onOpenModePicker: () => undefined,
        onTogglePlay: () => undefined,
        onNextTrack: () => undefined,
        onPrevTrack: () => undefined,
        onTrash: () => undefined,
        onLike: () => undefined,
        isLiked: false,
    });

    afterEach(() => {
        usePersonalFmModeStore.getState().endStation(providerId);
        usePlaybackStore.setState({ isFmMode: false });
    });

    it('shows only the mode button of the station on an extra station, and the preferences on the personal FM', async () => {
        register(['personal-fm']);
        usePlaybackStore.setState({ isFmMode: true });
        usePersonalFmModeStore.getState().startStation(providerId, 'station-a', DEFAULT_PERSONAL_FM_SELECTION);
        await render(fmTab());
        expect(find('[data-testid="fm-recommendation-preferences"]')).toBeNull();
        expect(host.textContent).toContain('mode');

        await act(async () => { usePersonalFmModeStore.getState().endStation(providerId); });
        expect(find('[data-testid="fm-recommendation-preferences"]')).not.toBeNull();
    });
});
