import type { Locator, Page } from '@playwright/test';

// test/component/bravaisHomeNav.ts
// Bravais 首页两级页签的定位与切换（各 bravais 用例共用）。缝里一级那一排是组（data-bravais-tab：folia / online / local /
// navidrome，后面接模组的首页页面）；在线组的页（歌单 / 电台 / 专辑 / 探索）是缝里的二级切换（data-bravais-section，
// 与本地三行、Navidrome 的 section 同一个位置）。层名没变：`home:<页>`（home:playlist、home:radio、home:folia……）。

export type BravaisHomeGroup = 'folia' | 'online' | 'local' | 'navidrome';
export type BravaisOnlinePage = 'playlist' | 'radio' | 'albums' | 'explore';

const ONLINE_PAGES: readonly string[] = ['playlist', 'radio', 'albums', 'explore'];

/** 一级页签（组，或模组页面的 id）。 */
export const homeGroupTab = (page: Page, key: string): Locator => page.locator(`[data-bravais-seam] [data-bravais-tab="${key}"]`);

/** 在线组的二级切换里的一页。 */
export const onlinePageTab = (page: Page, key: BravaisOnlinePage): Locator => page.locator(`[data-bravais-seam] [data-bravais-section="${key}"]`);

/**
 * 切到在线组的某一页：先确保一级在在线组，再点二级。
 */
export const selectOnlinePage = async (page: Page, key: BravaisOnlinePage) => {
    const group = homeGroupTab(page, 'online');
    if (await group.getAttribute('aria-selected') !== 'true') await group.click();
    await onlinePageTab(page, key).click();
};

/** 按「页」切首页：在线的四页走二级切换，其余（folia / local / navidrome）就是一级页签。 */
export const selectHomePage = async (page: Page, key: BravaisOnlinePage | Exclude<BravaisHomeGroup, 'online'>) => {
    if (ONLINE_PAGES.includes(key)) await selectOnlinePage(page, key as BravaisOnlinePage);
    else await homeGroupTab(page, key).click();
};
