import { expect, test } from './fixtures';

// test/component/settingsHelpActions.spec.ts

test.beforeEach(async ({ mount }) => {
    await mount('settingsHelpActions');
});

test('版本更新按钮打开当前 release notes，并可关闭返回 Help', async ({ page }) => {
    await page.getByTestId('help-release-notes').click();
    await expect(page.getByTestId('release-notes-dialog')).toBeVisible();
    await page.getByTestId('release-notes-close').click();
    await expect(page.getByTestId('release-notes-dialog')).toHaveCount(0);
});

// 它挂着 data-folia-keyboard-window，全局热键的 Esc 都会让路，关闭只能靠它自己的监听。
test('release notes 按 Esc 关闭', async ({ page }) => {
    await page.getByTestId('help-release-notes').click();
    await expect(page.getByTestId('release-notes-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('release-notes-dialog')).toHaveCount(0);
});

test('Help Ponder 按钮打开的是导航页，不是直接开一段教程', async ({ page }) => {
    await page.getByTestId('help-page-ponder').click();
    const nav = page.getByTestId('ponder-navigation');
    await expect(nav).toBeVisible();
    // 教程不该自己开起来 —— 导航页的意义就是让人先挑一条。
    await expect(page.getByTestId('ponder-stage')).toHaveCount(0);

    // 每一条都是一张卡，卡上声明自己教的是哪个目标。
    await expect(nav.locator('[data-ponder-nav-target]').first()).toBeVisible();
});

test('导航页上点一张卡，直接进那一条的教程', async ({ page }) => {
    await page.getByTestId('help-page-ponder').click();
    await page.locator('[data-ponder-nav-target="player-bar"]').click();

    await expect(page.getByTestId('ponder-stage')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Bottom control bar' })).toBeVisible();
});

test('导航页上悬停一张卡，长按 G 进的是那一条', async ({ page }) => {
    await page.getByTestId('help-page-ponder').click();
    const card = page.locator('[data-ponder-nav-target="player-bar"]');
    // 教程是一列行，这一条在第一屏之外：先滚到看得见，指针才落得到它身上。
    await card.scrollIntoViewIfNeeded();
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // 和在真实组件上完全一样：600ms 出胶囊，长按 G 进去。
    await expect(page.getByTestId('ponder-hint-capsule')).toBeVisible({ timeout: 3000 });
    await page.keyboard.down('g');
    await expect(page.getByTestId('ponder-stage')).toBeVisible({ timeout: 3000 });
    await page.keyboard.up('g');
    await expect(page.getByRole('dialog', { name: 'Bottom control bar' })).toBeVisible();
});

test('导航页上按 Ctrl+G 进的是四章「认识 Folia」', async ({ page }) => {
    await page.getByTestId('help-page-ponder').click();
    await expect(page.getByTestId('ponder-navigation')).toBeVisible();

    await page.keyboard.down('Control');
    await page.keyboard.down('KeyG');
    await expect(page.getByTestId('ponder-stage')).toBeVisible({ timeout: 2000 });
    await page.keyboard.up('KeyG');
    await page.keyboard.up('Control');

    await expect(page.getByRole('dialog', { name: 'Getting to know Folia' })).toBeVisible();
    await expect(page.getByTestId('ponder-stage').getByText('1 / 4').first()).toBeVisible();
});

test('长按 Ctrl+G 在 Help 覆盖层中打开同一个 help-page', async ({ page }) => {
    // Ctrl+G 和悬停长按 G 一样要按满 400ms，press() 那种按下即松会被当成放弃。
    await page.keyboard.down('Control');
    await page.keyboard.down('KeyG');
    await expect(page.getByTestId('ponder-stage')).toBeVisible({ timeout: 2000 });
    await page.keyboard.up('KeyG');
    await page.keyboard.up('Control');
    await expect(page.getByRole('dialog', { name: 'Getting to know Folia' })).toBeVisible();
});

test('Ctrl+G 按不满就松手，只留下擦除过的胶囊，不进教程', async ({ page }) => {
    await page.keyboard.down('Control');
    await page.keyboard.down('KeyG');
    await expect(page.getByTestId('ponder-hint-capsule')).toHaveAttribute('data-ponder-hint-placement', 'page');
    await page.keyboard.up('KeyG');
    await page.keyboard.up('Control');

    await page.waitForTimeout(600);
    await expect(page.getByTestId('ponder-stage')).toHaveCount(0);
    await expect(page.getByTestId('ponder-hint-capsule')).toHaveCount(0);
});

type CloseAction = { key: string } | { click: string };

/**
 * 在页面里关掉它，量出它关掉之后还在 DOM 里留了多久；3 秒还没走则返回 -1。
 *
 * 从测试端「关掉 → 等 80ms → 查还在不在」要走好几次往返，并行跑全量时这几次往返本身就能
 * 超过 240ms 的退场，于是有退场也会被判成没有。关闭和计时都在页面里做就不受往返影响。
 * 关闭也得在页面里触发：教程层在 capture 阶段把按键 stopImmediatePropagation 掉，
 * 页面里再挂监听是等不到那一下的。
 */
const lingerAfterClose = (page: import('@playwright/test').Page, testId: string, close: CloseAction) => page.evaluate(
    ({ id, action }) => new Promise<number>(resolve => {
        let closedAt = 0;
        const observer = new MutationObserver(() => {
            if (document.querySelector(`[data-testid="${id}"]`)) return;
            observer.disconnect();
            resolve(performance.now() - closedAt);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        window.setTimeout(() => { observer.disconnect(); resolve(-1); }, 3000);
        closedAt = performance.now();
        if ('key' in action) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: action.key, code: action.key, bubbles: true, cancelable: true }));
        } else {
            (document.querySelector(action.click) as HTMLElement).click();
        }
    }),
    { id: testId, action: close },
);

/**
 * 覆盖层的退场靠 AnimatePresence 撑住那不到 300ms。
 *
 * 「条件为假就 return null」那种写法一关就整棵树消失，退场动画没有机会播 —— 从截图上看不出
 * 区别，只有「关掉之后它还在不在 DOM 里」这一条能把它钉住。
 */
const expectAnimatedExit = async (page: import('@playwright/test').Page, testId: string, close: CloseAction) => {
    await expect(page.getByTestId(testId)).toBeAttached();
    const lingeredMs = await lingerAfterClose(page, testId, close);
    expect(lingeredMs, `${testId} 关掉后立刻就没了，等于没有退场动画`).toBeGreaterThan(80);
    await expect(page.getByTestId(testId)).toHaveCount(0);
};

test('新版本功能页面有进出场过渡，不是直接出现和直接消失', async ({ page }) => {
    await page.getByTestId('help-release-notes').click();
    const dialog = page.getByTestId('release-notes-dialog');
    await expect(dialog).toBeAttached();
    // 外框是共用的 Sheet：淡入淡出在它的面板（role=dialog）上，这个 id 在面板里面的内容上。
    const panel = page.getByRole('dialog').filter({ has: dialog });
    // 入场：第一帧还没到终态。
    const enteringOpacity = await panel.evaluate(node => Number(getComputedStyle(node).opacity));
    expect(enteringOpacity).toBeLessThan(1);

    await expect(panel).toHaveCSS('opacity', '1', { timeout: 2000 });
    await expectAnimatedExit(page, 'release-notes-dialog', { click: '[data-testid="release-notes-close"]' });
});

test('思索教程层有进出场过渡，关掉时先播完退场', async ({ page }) => {
    await page.keyboard.down('Control');
    await page.keyboard.down('KeyG');
    await expect(page.getByTestId('ponder-stage')).toBeVisible({ timeout: 2000 });
    await page.keyboard.up('KeyG');
    await page.keyboard.up('Control');

    await expect(page.getByTestId('ponder-stage')).toHaveCSS('opacity', '1', { timeout: 2000 });
    await expectAnimatedExit(page, 'ponder-stage', { key: 'Escape' });
});
