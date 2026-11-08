// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandPaletteContext } from '@/components/command-palette/types';

// test/unit/settings/libraryGridOnlySettings.test.ts
// 设置里只对一种资料库界面起作用的项，在别的界面下不出现：首页卡片样式、记住首页卡片位置、「网格卡片」整组、
// 海报墙按钮的滑动去向只在网格生效时出现；正在播放卡片的「在首页显示」在 bravais（墙）下不出现（卡片在墙上常在）。
// 这里钉住设置搜索与对应命令的可用性，页面本身与它们读同一个谓词。

const echo = (key: string) => key;

afterEach(async () => {
    const { useLibrarySuiteStore } = await import('@/library/core/suite/useLibrarySuiteStore');
    useLibrarySuiteStore.setState({ suite: 'grid' });
});

const useSuite = async (suite: 'grid' | 'bravais') => {
    const { useLibrarySuiteStore } = await import('@/library/core/suite/useLibrarySuiteStore');
    useLibrarySuiteStore.setState({ suite });
};

const searchTargets = async () => {
    const { SETTINGS_PAGE_OPTIONS } = await import('@/components/modal/settings/pages');
    const { buildSettingsNavGroups } = await import('@/components/modal/settings/navigation/settingsNavModel');
    const { buildSettingsSearchEntries } = await import('@/components/modal/settings/navigation/settingsNavSearch');
    return new Set(buildSettingsSearchEntries(
        buildSettingsNavGroups(echo, { isElectron: false }),
        SETTINGS_PAGE_OPTIONS,
        echo,
        { isElectron: false },
    ).map(entry => entry.targetId));
};

const GRID_ONLY_TARGETS = ['grid3dCardStyle', 'rememberHomeCardPosition', 'gridViewCardSettings', 'gridViewFullBleedCover', 'gridSlideTarget'];

describe('settings that only one library UI reads', () => {
    it('are found by the search only under the UI that reads them', async () => {
        await useSuite('grid');
        const underGrid = await searchTargets();
        for (const target of GRID_ONLY_TARGETS) expect(underGrid.has(target), target).toBe(true);
        expect(underGrid.has('stageTrackPillOnHome')).toBe(true);

        await useSuite('bravais');
        const underBravais = await searchTargets();
        for (const target of GRID_ONLY_TARGETS) expect(underBravais.has(target), target).toBe(false);
        expect(underBravais.has('stageTrackPillOnHome')).toBe(false);
        // What every UI reads stays: the home entries, and the S key on a filtering surface.
        expect(underBravais.has('homeTabsVisibility')).toBe(true);
        expect(underBravais.has('gridPaletteHotkey')).toBe(true);
        // The search module loads the whole command registry the first time.
    }, 30000);

    it('offer their commands only while the grid is the effective suite', async () => {
        const { settingsCommands } = await import('@/components/command-palette/commands/settingsCommands');
        const ids = [
            'settings-grid-card-style',
            'home-card-position-toggle',
            'settings-grid-action-button',
            'settings-gridview-cards',
            'settings-toggle-gridview-full-bleed-cover',
            'settings-toggle-gridview-square-cards',
        ];
        const commands = ids.map(id => settingsCommands.find(command => command.id === id)!);
        expect(commands.every(Boolean)).toBe(true);
        const contextFor = (isGridLibraryActive: boolean) => ({
            settings: { isGridLibraryActive: () => isGridLibraryActive, canUseGridViewSquareCards: () => true },
        }) as unknown as CommandPaletteContext;

        for (const command of commands) {
            expect(command.isAvailable?.(contextFor(true)), command.id).toBe(true);
            expect(command.isAvailable?.(contextFor(false)), command.id).toBe(false);
        }
    }, 30000);
});
