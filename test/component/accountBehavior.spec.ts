import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
    ACCOUNT_ALPHA,
    ACCOUNT_BETA,
    ACCOUNT_CANCEL_COOLDOWN_MS,
    ACCOUNT_GAMMA,
    ACCOUNT_MODO,
    ACCOUNT_NETEASE,
    ACCOUNT_QQ,
    ACCOUNT_QUILL,
    accountRule,
} from '../../dev/probes/accountBehavior/accountFixtureRules';
import type { AccountCall, AccountCallOp, AccountQrState, AccountSelfCheckScript } from '../../dev/probes/accountBehavior/probeApi';
import '../../dev/probes/accountBehavior/probeApi';

// test/component/accountBehavior.spec.ts
// 在线账户的行为回归闸门（Library v2 账户重构 A0 起每一步都跑）：扫码登录、选平台、切换确认、登出。
//
// 断言的是语义：调用账（要码 / 轮询 / keyed 取消 / 账户刷新 / 宿主登出 / 切换清理，见 dev/probes/accountBehavior/probeApi.ts）、
// 账户 store、当前平台、待确认切换，再加上界面上用户能看到的结果（登录界面、状态文案、诊断入口、确认）。
// 界面操作集中在下面按 suite 分的驱动里（A6 起参数化）：
// - grid：切换器菜单 / 连接面板、登录弹窗、ConfirmDialog，全部用鼠标点；
// - tui：首页在线页签的平台列表（未登录时就是页签内容，已登录时 F2 打开）、TUI 的登录框与确认，全部用按键
//   （↑↓ / Home 移动、Enter 主动作、Esc 关闭 / 取消、Delete 登出）。
// 两套共用的定位（登录框是 role=dialog 且 accessible name = 标题、二维码图片 alt、状态文案、按钮的 accessible name）
// 在驱动之外。标题前缀 `[grid]` / `[tui]` 的用例对两个 suite 各跑一遍（`[${suite}]`），网格特有的切换器 / 连接面板细节
// 只在 grid 那一遍断言；`[grid-only]` 依赖网格的层叠（切换器盖在弹窗之上）；`[switch]` 在两套之间切换。
// bravais 没有自己的账户界面了：首页窄缝里的账户入口只打开共用的登录窗口（src/components/login，探针照 App 挂了 LoginHost），
// 所以它不再参数化；最后的 `[bravais]` 用例只看入口在、点了窗口打开、没有替用的人选平台。
//
// 时序：二维码每 2 秒轮询一次（core/account/providerLoginSession.service 的 PROVIDER_LOGIN_POLL_INTERVAL_MS），探针用真实时钟，所以
// 编排的状态要在要码之前排好，每一步最多等一个轮询周期。
// test.fixme 记录的是现状缺陷，注释里写明由哪一步转正。

const SUITES = ['grid', 'tui'] as const;
type Suite = (typeof SUITES)[number];

const shortName = (providerId: string) => accountRule(providerId)!.shortName;

// ---- 探针接口 ----
const calls = (page: Page, op?: AccountCallOp, providerId?: string): Promise<AccountCall[]> => page.evaluate(
    ([callOp, callProvider]) => window.__accountProbe!.calls().filter(call => (
        (callOp === null || call.op === callOp) && (callProvider === null || call.providerId === callProvider)
    )),
    [op ?? null, providerId ?? null] as const,
);
const countCalls = async (page: Page, op: AccountCallOp, providerId?: string) => (await calls(page, op, providerId)).length;
const lastKey = async (page: Page, providerId: string) => (await calls(page, 'create', providerId)).at(-1)?.key;
const activeProvider = (page: Page) => page.evaluate(() => window.__accountProbe!.activeProvider());
const accountStatus = (page: Page, providerId: string) => page.evaluate(id => window.__accountProbe!.accountStatus(id), providerId);
const pendingSwitch = (page: Page) => page.evaluate(() => window.__accountProbe!.pendingSwitch());
const requestGeneration = (page: Page) => page.evaluate(() => window.__accountProbe!.requestGeneration());
const scriptQr = (page: Page, providerId: string, states: AccountQrState[]) => page.evaluate(
    ([id, queued]) => window.__accountProbe!.scriptQr(id, queued),
    [providerId, states] as const,
);
const setQrTtl = (page: Page, providerId: string, ttlMs: number | null) => page.evaluate(
    ([id, ttl]) => window.__accountProbe!.setQrTtl(id, ttl),
    [providerId, ttlMs] as const,
);
const setSelfCheck = (page: Page, providerId: string, script: AccountSelfCheckScript | null) => page.evaluate(
    ([id, value]) => window.__accountProbe!.setSelfCheck(id, value),
    [providerId, script] as const,
);
const setAccount = (page: Page, providerId: string, status: 'authenticated' | 'anonymous') => page.evaluate(
    ([id, value]) => window.__accountProbe!.setAccount(id, value),
    [providerId, status] as const,
);
const setActive = (page: Page, providerId: string) => page.evaluate(id => window.__accountProbe!.setActive(id), providerId);
const startLogin = (page: Page, providerId: string) => page.evaluate(id => window.__accountProbe!.startLogin(id), providerId);
const requestSwitch = (page: Page, providerId: string) => page.evaluate(id => window.__accountProbe!.requestSwitch(id), providerId);
const switchResult = (page: Page) => page.evaluate(() => window.__accountProbe!.switchResult());

// ---- 两套共用的定位：登录界面（网格的弹窗与 TUI 的登录框都是 role=dialog，accessible name = 标题） ----
const loginDialog = (page: Page) => page.getByRole('dialog');
const qrImage = (page: Page) => loginDialog(page).getByAltText('QR Code');
const expectQrKey = async (page: Page, key: string | undefined) => {
    expect(key).toBeTruthy();
    await expect(qrImage(page)).toHaveAttribute('src', new RegExp(encodeURIComponent(key!).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
};
const retryButton = (page: Page) => loginDialog(page).getByRole('button', { name: 'Refresh QR code' });
const diagnosticsButton = (page: Page) => loginDialog(page).getByRole('button', { name: 'Copy diagnostics' });
const methodButton = (page: Page, label: 'QQ scan' | 'WeChat scan') => loginDialog(page).getByRole('button', { name: label });
const restartButton = (page: Page) => loginDialog(page).getByRole('button', { name: /Restart backend|Restarting…/ });
const STATUS = {
    waiting: 'Please scan the QR code',
    scanned: 'Scanned! Confirm on your phone.',
    expired: 'QR Code expired. Refresh to try again.',
    error: 'Login Error',
} as const;
const statusText = (page: Page, key: keyof typeof STATUS) => loginDialog(page).getByText(STATUS[key], { exact: true });

// ---- grid 驱动的定位：切换器、连接面板、App 同形的确认框（ConfirmDialog，标题是「切换在线音乐平台」） ----
const switcher = (page: Page) => page.getByTestId('online-provider-switcher');
const switcherToggle = (page: Page) => switcher(page).getByRole('button', { name: 'Switch online music provider' });
const menu = (page: Page) => switcher(page).getByRole('menu');
const menuItem = (page: Page, providerId: string) => (
    menu(page).getByRole('menuitemradio').filter({ hasText: shortName(providerId) })
);
const openSwitcher = async (page: Page) => {
    if (await switcherToggle(page).getAttribute('aria-expanded') !== 'true') await switcherToggle(page).click();
    await expect(menu(page)).toBeVisible();
};
const closeSwitcher = async (page: Page) => {
    if (await switcherToggle(page).getAttribute('aria-expanded') === 'true') await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
};
const gridLogoutButtons = (page: Page) => menu(page).getByRole('button', { name: 'Logout' });
const gridCloseButton = (page: Page) => loginDialog(page).getByRole('button', { name: 'Close login' });
// TUI 的账户层也挂 data-folia-keyboard-window、标题也是这句，所以排除掉它（[data-tui-account]）；bravais 的缝同理（[data-bravais-seam]）。
const gridConfirmDialog = (page: Page): Locator => (
    page.locator('[data-folia-keyboard-window]:not([data-tui-account]):not([data-bravais-seam])')
        .filter({ has: page.getByRole('heading', { name: 'Switch online music provider' }) })
);
const gridConnectPanel = (page: Page) => page.getByRole('group', { name: 'Connect platform accounts' });

// ---- tui 驱动的定位：平台列表、登录框里的登录方式、确认 ----
const tuiHome = (page: Page) => page.locator('[data-library-home="tui"]');
const tuiAccounts = (page: Page) => page.locator('[data-tui-accounts]');
const tuiAccountRow = (page: Page, providerId: string) => tuiAccounts(page).locator(`[data-tui-account-provider="${providerId}"]`);
const tuiLogoutButtons = (page: Page) => tuiAccounts(page).locator('[data-tui-account-logout]');
const tuiConfirm = (page: Page) => page.locator('[data-tui-account-confirm]');
/** 打开平台列表：未登录时它就是在线页签的内容，已登录时按 F2。 */
const tuiOpenAccounts = async (page: Page) => {
    if (await tuiAccounts(page).count() === 0) await page.keyboard.press('F2');
    await expect(tuiAccounts(page)).toBeVisible();
};
/** 平台列表里把焦点移到某个平台上：Home 回到第一行，再按 ↓。 */
const tuiFocusProvider = async (page: Page, providerId: string) => {
    await tuiOpenAccounts(page);
    const ids = await tuiAccounts(page).locator('[data-tui-account-provider]')
        .evaluateAll(rows => rows.map(row => row.getAttribute('data-tui-account-provider')));
    const index = ids.indexOf(providerId);
    expect(index, `${providerId} in ${ids.join(', ')}`).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Home');
    for (let step = 0; step < index; step += 1) await page.keyboard.press('ArrowDown');
    await expect(tuiAccountRow(page, providerId)).toHaveAttribute('data-focused', 'true');
};

// ---- bravais：首页窄缝里的账户入口（未登录时是「连接在线平台」），点了打开共用的登录窗口 ----
const bravaisStage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const bravaisSwitcher = (page: Page) => page.locator('[data-bravais-account-slot] [data-bravais-account]');
const bravaisConnect = (page: Page) => page.locator('[data-bravais-account-toggle="connect"]');
/** 共用的登录窗口（LoginHost，探针照 App 挂了一个）：平台那一列是 listbox，每个平台一行 option。 */
const loginWindowPlatforms = (page: Page) => loginDialog(page).getByRole('listbox', { name: 'Online music provider' });

type AccountDriver = {
    suite: Suite;
    /** 首页挂好、账户入口可用。 */
    ready: (page: Page) => Promise<void>;
    /** 在首页的平台入口里选一个平台（网格：切换器菜单；TUI：平台列表 + Enter），与连接面板同一个 selectProvider。 */
    selectProvider: (page: Page, providerId: string) => Promise<void>;
    /** 当前平台未登录时首页上的平台入口（网格：连接面板；TUI：未登录的平台列表）。 */
    guestPicker: (page: Page) => Locator;
    /** 在未登录的平台入口里选一个平台（网格：连接面板第一下展开、第二下选中）。 */
    selectFromGuestPicker: (page: Page, providerId: string) => Promise<void>;
    /** 平台入口里标着某个平台为当前平台。 */
    expectCurrent: (page: Page, providerId: string) => Promise<void>;
    /** 平台入口里的登出按钮（打开入口之后）。 */
    openLogoutEntries: (page: Page) => Promise<Locator>;
    /** 登出按钮在哪个平台上。 */
    expectLogoutOn: (page: Page, providerId: string) => Promise<void>;
    /** 登出当前平台。 */
    logoutCurrent: (page: Page, providerId: string) => Promise<void>;
    /** 收起平台入口（网格的菜单；TUI 的 F2 列表——未登录时它是页签内容，留着）。 */
    closePicker: (page: Page) => Promise<void>;
    /** 换一个登录方式（网格：点；TUI：↓ 移到它再 Enter）。 */
    chooseMethod: (page: Page, label: 'QQ scan' | 'WeChat scan') => Promise<void>;
    retry: (page: Page) => Promise<void>;
    restart: (page: Page) => Promise<void>;
    expectRestartLabel: (page: Page, label: 'Restart backend' | 'Restarting…') => Promise<void>;
    closeLogin: (page: Page) => Promise<void>;
    confirmDialog: (page: Page) => Locator;
};

const GRID_DRIVER: AccountDriver = {
    suite: 'grid',
    ready: async page => {
        await expect(switcher(page)).toBeVisible();
    },
    selectProvider: async (page, providerId) => {
        await openSwitcher(page);
        await menuItem(page, providerId).click();
    },
    guestPicker: page => gridConnectPanel(page),
    selectFromGuestPicker: async (page, providerId) => {
        const provider = accountRule(providerId)!;
        const label = provider.initial === 'authenticated' || !provider.auth
            ? `Switch to ${provider.shortName}`
            : `Log in to ${provider.shortName}`;
        const button = gridConnectPanel(page).getByRole('button', { name: label, exact: true });
        await button.click();
        await button.click();
    },
    expectCurrent: async (page, providerId) => {
        await openSwitcher(page);
        await expect(menuItem(page, providerId)).toHaveAttribute('aria-checked', 'true');
    },
    openLogoutEntries: async page => {
        await openSwitcher(page);
        return gridLogoutButtons(page);
    },
    expectLogoutOn: async (page, providerId) => {
        await expect(menuItem(page, providerId).locator('xpath=..').getByRole('button', { name: 'Logout' })).toHaveCount(1);
    },
    logoutCurrent: async page => {
        await gridLogoutButtons(page).click();
        await expect(menu(page)).toHaveCount(0);
    },
    closePicker: closeSwitcher,
    chooseMethod: async (page, label) => {
        await methodButton(page, label).click();
    },
    retry: async page => {
        await retryButton(page).click();
    },
    restart: async page => {
        await restartButton(page).click();
    },
    expectRestartLabel: async (page, label) => {
        await expect(restartButton(page)).toHaveText(label);
    },
    closeLogin: async page => {
        await gridCloseButton(page).click();
    },
    confirmDialog: gridConfirmDialog,
};

const TUI_DRIVER: AccountDriver = {
    suite: 'tui',
    ready: async page => {
        await expect(tuiHome(page)).toBeVisible();
    },
    selectProvider: async (page, providerId) => {
        await tuiFocusProvider(page, providerId);
        await page.keyboard.press('Enter');
    },
    guestPicker: page => page.locator('[data-tui-accounts="guest"]'),
    selectFromGuestPicker: async (page, providerId) => {
        await expect(page.locator('[data-tui-accounts="guest"]')).toBeVisible();
        await tuiFocusProvider(page, providerId);
        await page.keyboard.press('Enter');
    },
    expectCurrent: async (page, providerId) => {
        await tuiOpenAccounts(page);
        await expect(tuiAccountRow(page, providerId)).toHaveAttribute('data-current', 'true');
        await expect(tuiAccounts(page).locator('[data-current="true"]')).toHaveCount(1);
    },
    openLogoutEntries: async page => {
        await tuiOpenAccounts(page);
        return tuiLogoutButtons(page);
    },
    expectLogoutOn: async (page, providerId) => {
        await expect(tuiAccountRow(page, providerId).locator('[data-tui-account-logout]')).toHaveCount(1);
    },
    logoutCurrent: async (page, providerId) => {
        await tuiFocusProvider(page, providerId);
        await page.keyboard.press('Delete');
    },
    closePicker: async page => {
        if (await page.locator('[data-tui-accounts="panel"]').count() > 0) await page.keyboard.press('Escape');
        await expect(page.locator('[data-tui-accounts="panel"]')).toHaveCount(0);
    },
    chooseMethod: async (page, label) => {
        const options = loginDialog(page).locator('[data-tui-login-method]');
        const focused = loginDialog(page).locator('[data-tui-login-method][data-focused="true"]');
        const count = await options.count();
        for (let step = 0; step < count && !(await focused.textContent())?.includes(label); step += 1) {
            await page.keyboard.press('ArrowDown');
        }
        await expect(focused).toContainText(label);
        await page.keyboard.press('Enter');
    },
    retry: async page => {
        await expect(retryButton(page)).toBeVisible();
        await page.keyboard.press('Enter');
    },
    restart: async page => {
        await expect(restartButton(page)).toBeEnabled();
        await page.keyboard.press('Enter');
    },
    expectRestartLabel: async (page, label) => {
        await expect(restartButton(page)).toHaveAccessibleName(label);
    },
    closeLogin: async page => {
        await page.keyboard.press('Escape');
    },
    confirmDialog: tuiConfirm,
};

const DRIVERS: Record<Suite, AccountDriver> = { grid: GRID_DRIVER, tui: TUI_DRIVER };

const setSuite = async (page: Page, suite: Suite) => {
    await page.evaluate(id => window.__accountProbe!.setSuite(id), suite);
    await expect.poll(() => page.evaluate(() => window.__accountProbe!.suite())).toBe(suite);
    await DRIVERS[suite].ready(page);
};

/** 挂探针、等网格首页（切换器）出现；要 TUI 时再换过去（与 DEV 浮层同一个 store）。 */
const mountAccount = async (mount: (id: string) => Promise<unknown>, page: Page, suite: Suite = 'grid') => {
    await mount('accountBehavior');
    await expect.poll(() => page.evaluate(() => window.__accountProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await GRID_DRIVER.ready(page);
    if (suite !== 'grid') await setSuite(page, suite);
};

/** 切换不再先问：没有确认框、没有待确认请求，当前平台直接换过去。 */
const expectSwitchedWithoutAsking = async (page: Page, driver: AccountDriver, providerId: string) => {
    await expect.poll(() => activeProvider(page)).toBe(providerId);
    await expect(driver.confirmDialog(page)).toHaveCount(0);
    expect(await pendingSwitch(page)).toBeNull();
};

for (const suite of SUITES) {
const driver = DRIVERS[suite];
const isGrid = suite === 'grid';
// 失败帮助的入口：网格先给简单办法，诊断与反馈收在「还是不行？」下面；TUI 直接给复制按钮（F4）。
const foldsDiagnostics = suite !== 'tui';
const failureHelpEntry = (page: Page) => (foldsDiagnostics
    ? loginDialog(page).getByRole('button', { name: 'Still not working? Send us the diagnostics' })
    : diagnosticsButton(page));
// 不管反馈去向、只问「诊断给没给」的入口：否定断言都用它，换了去向也不会空过。探针页没有 Electron 桥，
// 报告环境按网页版算（useLibraryAccount 的 LOGIN_REPORT_ENVIRONMENT），要码就失败会被当成部署问题，
// 展开项换成「See diagnostics」；探针用 store 模拟的内嵌后端只在桌面版存在，桌面版走「Send us」
// 由单测 qrLoginFailureHelpPresentation 覆盖。
const anyFailureHelpEntry = (page: Page) => (foldsDiagnostics
    ? loginDialog(page).getByRole('button', { name: /^Still not working\?/ })
    : diagnosticsButton(page));
const tipsList = (page: Page) => loginDialog(page).getByText('Restart Folia, then scan again.');

test.describe(`[${suite}] switching`, () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, suite);
    });

    test(`[${suite}] switching to a signed-in provider switches at once and leaves the old provider once`, async ({ page }) => {
        const generation = await requestGeneration(page);

        // 选当前平台：同一个 provider，直接结束，不问也不清理。
        await driver.selectProvider(page, ACCOUNT_ALPHA);
        if (isGrid) await expect(menu(page)).toHaveCount(0);
        await expect(driver.confirmDialog(page)).toHaveCount(0);
        expect(await pendingSwitch(page)).toBeNull();
        expect(await countCalls(page, 'switch-cleanup')).toBe(0);

        await driver.selectProvider(page, ACCOUNT_BETA);
        // 能直接切的平台：不问（队列留着，切换不拿走什么），登录界面也不出现（网格的菜单随之关掉）。
        if (isGrid) await expect(menu(page)).toHaveCount(0);
        await expectSwitchedWithoutAsking(page, driver, ACCOUNT_BETA);
        await expect(loginDialog(page)).toHaveCount(0);
        // 离开旧平台恰好一次、目标是新平台；提交前作废一次在途请求；提交后刷新新平台的账户（App 的 switchProvider 带 refresh）。
        expect((await calls(page, 'switch-cleanup')).map(call => call.providerId)).toEqual([ACCOUNT_BETA]);
        expect(await requestGeneration(page)).toBe(generation + 1);
        await expect.poll(() => calls(page, 'refresh')).toEqual([expect.objectContaining({ providerId: ACCOUNT_BETA, ok: true })]);
        await driver.expectCurrent(page, ACCOUNT_BETA);
    });

    test(`[${suite}] a provider without accounts switches at once too`, async ({ page }) => {
        await driver.selectProvider(page, ACCOUNT_MODO);
        if (isGrid) await expect(menu(page)).toHaveCount(0);
        await expectSwitchedWithoutAsking(page, driver, ACCOUNT_MODO);
        await expect(loginDialog(page)).toHaveCount(0);
        expect(await countCalls(page, 'resolve-methods')).toBe(0);
        expect(await countCalls(page, 'create')).toBe(0);
        expect((await calls(page, 'switch-cleanup')).map(call => call.providerId)).toEqual([ACCOUNT_MODO]);
        // mod 源没有宿主刷新器（App 的刷新表只有内置 provider）。
        expect(await countCalls(page, 'refresh')).toBe(0);
    });

    test(`[${suite}] the signed-out home picker follows the same rules as the switcher`, async ({ page }) => {
        // 当前平台未登录时首页显示平台入口（网格：连接面板，第一下展开、第二下选中；TUI：在线页签就是平台列表）。
        await setActive(page, ACCOUNT_GAMMA);
        await expect(driver.guestPicker(page)).toBeVisible();

        await driver.selectFromGuestPicker(page, ACCOUNT_QUILL);
        await expect(loginDialog(page)).toBeVisible();
        await expect(driver.confirmDialog(page)).toHaveCount(0);
        await expect.poll(() => countCalls(page, 'resolve-methods', ACCOUNT_QUILL)).toBe(1);
        expect(await activeProvider(page)).toBe(ACCOUNT_GAMMA);
    });

    test(`[${suite}] picking a signed-in provider on the signed-out home switches at once`, async ({ page }) => {
        await setActive(page, ACCOUNT_GAMMA);
        await expect(driver.guestPicker(page)).toBeVisible();

        await driver.selectFromGuestPicker(page, ACCOUNT_BETA);
        await expectSwitchedWithoutAsking(page, driver, ACCOUNT_BETA);
        await expect(loginDialog(page)).toHaveCount(0);
    });
});

test.describe(`[${suite}] signing in`, () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, suite);
    });

    test(`[${suite}] signing in to another provider opens the login first, then switches to it`, async ({ page }) => {
        await scriptQr(page, ACCOUNT_GAMMA, ['scanned', 'confirmed']);
        await driver.selectProvider(page, ACCOUNT_GAMMA);

        // 未登录的平台：先登录，不确认。网格现状：要登录时切换器菜单不收起（只有能直接切时才收）。
        await expect(loginDialog(page)).toBeVisible();
        if (isGrid) await expect(switcherToggle(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(driver.confirmDialog(page)).toHaveCount(0);
        expect(await pendingSwitch(page)).toBeNull();
        // 现状：未知 provider 的登录文案回落到网易的（LOGIN_COPY_BY_PROVIDER 只有 kugou / qq / bodian）。
        await expect(loginDialog(page)).toHaveAccessibleName('Scan with Netease App');
        await expect(statusText(page, 'waiting')).toBeVisible();
        await expect.poll(() => calls(page, 'create', ACCOUNT_GAMMA)).toEqual([
            expect.objectContaining({ methodId: null }),
        ]);
        const key = await lastKey(page, ACCOUNT_GAMMA);
        await expectQrKey(page, key);

        await expect(statusText(page, 'scanned')).toBeVisible();
        // 确认后：登录界面收起 → 刷新账户（账户先写进 store）→ 不是当前平台，直接切过去（不问）。
        await expectSwitchedWithoutAsking(page, driver, ACCOUNT_GAMMA);
        await expect(loginDialog(page)).toHaveCount(0);
        expect(await accountStatus(page, ACCOUNT_GAMMA)).toBe('authenticated');
        // 离开旧平台恰好一次；激活这一步不再刷新：登录事务里的那一次刷新就是全部。
        expect((await calls(page, 'switch-cleanup')).map(call => call.providerId)).toEqual([ACCOUNT_GAMMA]);
        expect((await calls(page, 'refresh')).map(call => call.providerId)).toEqual([ACCOUNT_GAMMA]);
        // 已确认的会话换成了登录凭据，不再取消。
        expect(await countCalls(page, 'cancel', ACCOUNT_GAMMA)).toBe(0);
    });

    test(`[${suite}] signing in to the current provider needs no confirmation`, async ({ page }) => {
        await setActive(page, ACCOUNT_GAMMA);
        await scriptQr(page, ACCOUNT_GAMMA, ['confirmed']);
        await driver.selectProvider(page, ACCOUNT_GAMMA);
        await expect(loginDialog(page)).toBeVisible();

        await expect.poll(() => accountStatus(page, ACCOUNT_GAMMA)).toBe('authenticated');
        await expect(loginDialog(page)).toHaveCount(0);
        await expect(driver.confirmDialog(page)).toHaveCount(0);
        expect(await pendingSwitch(page)).toBeNull();
        expect(await activeProvider(page)).toBe(ACCOUNT_GAMMA);
        expect(await countCalls(page, 'switch-cleanup')).toBe(0);
    });

    test(`[${suite}] a failed account refresh after confirmation reopens the login with the failure and diagnostics`, async ({ page }) => {
        await page.evaluate(id => window.__accountProbe!.failRefresh(id, 1), ACCOUNT_GAMMA);
        await scriptQr(page, ACCOUNT_GAMMA, ['confirmed']);
        await driver.selectProvider(page, ACCOUNT_GAMMA);

        await expect.poll(() => calls(page, 'refresh')).toEqual([expect.objectContaining({ providerId: ACCOUNT_GAMMA, ok: false })]);
        await expect(loginDialog(page)).toBeVisible();
        await expect(statusText(page, 'error')).toBeVisible();
        await expect(failureHelpEntry(page)).toBeVisible();
        await expect(retryButton(page)).toBeVisible();
        await expect(driver.confirmDialog(page)).toHaveCount(0);
        expect(await accountStatus(page, ACCOUNT_GAMMA)).toBe('anonymous');
        expect(await activeProvider(page)).toBe(ACCOUNT_ALPHA);
    });

    test(`[${suite}] several sign-in methods: no QR before a choice, one live session across choices`, async ({ page }) => {
        await driver.selectProvider(page, ACCOUNT_QUILL);
        await expect(loginDialog(page)).toBeVisible();
        // 步骤一：占位框，不要码，没有状态文案和重试。
        await expect(loginDialog(page).getByText('Pick a sign-in method to generate the QR code')).toBeVisible();
        await expect.poll(() => countCalls(page, 'resolve-methods', ACCOUNT_QUILL)).toBe(1);
        await expect(methodButton(page, 'QQ scan')).toHaveAttribute('aria-pressed', 'false');
        await expect(retryButton(page)).toHaveCount(0);
        await page.waitForTimeout(500);
        expect(await countCalls(page, 'create')).toBe(0);

        await driver.chooseMethod(page, 'QQ scan');
        await expect.poll(() => calls(page, 'create', ACCOUNT_QUILL)).toEqual([expect.objectContaining({ methodId: 'qq' })]);
        const first = await lastKey(page, ACCOUNT_QUILL);
        await expectQrKey(page, first);
        await expect(methodButton(page, 'QQ scan')).toHaveAttribute('aria-pressed', 'true');
        await expect(loginDialog(page).getByText('Current method: QQ scan')).toBeVisible();
        await expect(statusText(page, 'waiting')).toBeVisible();

        // 换方式：旧会话按自己的 provider 取消，再要新码；任何时候只有一个活跃会话。
        await driver.chooseMethod(page, 'WeChat scan');
        await expect.poll(() => calls(page, 'create', ACCOUNT_QUILL)).toHaveLength(2);
        const second = await lastKey(page, ACCOUNT_QUILL);
        expect((await calls(page, 'create', ACCOUNT_QUILL))[1].methodId).toBe('wechat');
        await expect.poll(() => calls(page, 'cancel')).toEqual([expect.objectContaining({ providerId: ACCOUNT_QUILL, key: first })]);
        await expectQrKey(page, second);

        // 后端报过期（没扫过）：不算失败；重试沿用已选的方式，并取消过期的那个会话。
        await scriptQr(page, ACCOUNT_QUILL, ['expired']);
        await expect(statusText(page, 'expired')).toBeVisible();
        await expect(anyFailureHelpEntry(page)).toHaveCount(0);
        await driver.retry(page);
        await expect.poll(() => calls(page, 'create', ACCOUNT_QUILL)).toHaveLength(3);
        expect((await calls(page, 'create', ACCOUNT_QUILL))[2].methodId).toBe('wechat');
        expect((await calls(page, 'cancel')).map(call => call.key)).toEqual([first, second]);
        const third = await lastKey(page, ACCOUNT_QUILL);

        await driver.closeLogin(page);
        await expect(loginDialog(page)).toHaveCount(0);
        await expect.poll(async () => (await calls(page, 'cancel')).map(call => call.key)).toEqual([first, second, third]);
    });
});

test.describe(`[${suite}] QR lifetime`, () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, suite);
    });

    test(`[${suite}] the TTL expires and cancels the code; an unscanned expiry is not a failure`, async ({ page }) => {
        await setQrTtl(page, ACCOUNT_GAMMA, 1200);
        await driver.selectProvider(page, ACCOUNT_GAMMA);
        await expect(statusText(page, 'waiting')).toBeVisible();
        const key = await lastKey(page, ACCOUNT_GAMMA);

        await expect(statusText(page, 'expired')).toBeVisible();
        await expect.poll(() => calls(page, 'cancel')).toEqual([expect.objectContaining({ providerId: ACCOUNT_GAMMA, key })]);
        await expect(retryButton(page)).toBeVisible();
        await expect(anyFailureHelpEntry(page)).toHaveCount(0);
        // 到点即停：之后不再轮询。
        const checks = await countCalls(page, 'check');
        await page.waitForTimeout(2_500);
        expect(await countCalls(page, 'check')).toBe(checks);

        await setQrTtl(page, ACCOUNT_GAMMA, null);
        await driver.retry(page);
        await expect.poll(() => countCalls(page, 'create', ACCOUNT_GAMMA)).toBe(2);
        await expect(statusText(page, 'waiting')).toBeVisible();
        await expectQrKey(page, await lastKey(page, ACCOUNT_GAMMA));
    });

    test(`[${suite}] expiring after a scan counts as a failure and offers diagnostics`, async ({ page }) => {
        // TTL 计时：第一次轮询（约 2 秒）报已扫码，3.5 秒到点。
        await setQrTtl(page, ACCOUNT_GAMMA, 3_500);
        await scriptQr(page, ACCOUNT_GAMMA, ['scanned']);
        await driver.selectProvider(page, ACCOUNT_GAMMA);
        const key = await lastKey(page, ACCOUNT_GAMMA);
        await expect(statusText(page, 'scanned')).toBeVisible();
        await expect(statusText(page, 'expired')).toBeVisible();
        await expect(failureHelpEntry(page)).toBeVisible();
        await expect(tipsList(page)).toBeVisible();
        // 扫过码才过期的那句提示在诊断与反馈里：网格要先展开「还是不行？」。
        if (foldsDiagnostics) await failureHelpEntry(page).click();
        await expect(loginDialog(page).getByText(/If you confirmed on your phone but were still not signed in/)).toBeVisible();
        expect((await calls(page, 'cancel')).map(call => call.key)).toEqual([key]);

        // 后端报的过期同理：扫过才算失败。
        await setQrTtl(page, ACCOUNT_GAMMA, null);
        await scriptQr(page, ACCOUNT_GAMMA, ['scanned', 'expired']);
        await driver.retry(page);
        await expect(statusText(page, 'scanned')).toBeVisible();
        await expect(anyFailureHelpEntry(page)).toHaveCount(0);
        await expect(statusText(page, 'expired')).toBeVisible();
        await expect(failureHelpEntry(page)).toBeVisible();
    });
});

test.describe(`[${suite}] QQ diagnostics`, () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, suite);
    });

    // QQ 的扫码失败和别的平台一样给复制报告 / 反馈入口；grid 的诊断区块与 TUI 的诊断行和 F4 都看
    // core 的 canShowLoginDiagnostics（对照组 gamma）。失败后由会话自动跑一次自检，结论显示在诊断区块里。
    test(`[${suite}] a login canceled on the phone says so and holds the retry until the backend cooldown ends`, async ({ page }) => {
        await scriptQr(page, ACCOUNT_GAMMA, ['canceled']);
        await driver.selectProvider(page, ACCOUNT_GAMMA);
        await expect(loginDialog(page).getByText(/^Login was canceled on your phone\. You can get a new QR code in \d+s\.$/)).toBeVisible();
        // 用户自己取消的，没有要排查的东西。
        await expect(anyFailureHelpEntry(page)).toHaveCount(0);
        // 冷却中：网格的重试按钮在但不能点；TUI 不给重试，Enter 不要码。
        if (suite !== 'tui') {
            await expect(retryButton(page)).toBeDisabled();
        } else {
            await expect(retryButton(page)).toHaveCount(0);
            await page.keyboard.press('Enter');
        }
        expect(await countCalls(page, 'create', ACCOUNT_GAMMA)).toBe(1);

        // 冷却结束：状态行换成不带秒数的文案，重试恢复。
        await expect(loginDialog(page).getByText('Login was canceled on your phone. You can get a new QR code.', { exact: true }))
            .toBeVisible({ timeout: ACCOUNT_CANCEL_COOLDOWN_MS + 2_000 });
        await scriptQr(page, ACCOUNT_GAMMA, ['waiting']);
        await driver.retry(page);
        await expect.poll(() => countCalls(page, 'create', ACCOUNT_GAMMA)).toBe(2);
        await expect(statusText(page, 'waiting')).toBeVisible();
    });

    test(`[${suite}] a failed QQ sign-in offers retry and diagnostics like other providers`, async ({ page }) => {
        await scriptQr(page, ACCOUNT_GAMMA, ['error']);
        await driver.selectProvider(page, ACCOUNT_GAMMA);
        await expect(statusText(page, 'error')).toBeVisible();
        await expect(failureHelpEntry(page)).toBeVisible();
        await driver.closeLogin(page);
        await expect(loginDialog(page)).toHaveCount(0);

        await scriptQr(page, ACCOUNT_QQ, ['scanned', 'error']);
        await driver.selectProvider(page, ACCOUNT_QQ);
        await expect(statusText(page, 'scanned')).toBeVisible();
        await expect(statusText(page, 'error')).toBeVisible();
        await expect(retryButton(page)).toBeVisible();
        await expect(failureHelpEntry(page)).toBeVisible();
        if (suite === 'tui') {
            await expect(loginDialog(page).locator('[data-tui-login-diagnostics]')).toHaveCount(1);
            // F4 复制 QQ 的诊断报告：换掉剪贴板写入，读回写进去的内容。
            await page.evaluate(() => {
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: { writeText: async (text: string) => { (window as unknown as { __copied?: string }).__copied = text; } },
                });
            });
            await page.keyboard.press('F4');
            await expect(loginDialog(page).locator('[data-tui-login-diagnostics-copy]')).toHaveAttribute('data-tui-login-diagnostics-copy', 'copied');
            const copied = await page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? '');
            expect(copied).toContain('### Folia QR login diagnostics');
            expect(copied).toContain(`provider: ${ACCOUNT_QQ}`);
        }

        // 重试后新会话失败同样给诊断。
        await scriptQr(page, ACCOUNT_QQ, ['error']);
        await driver.retry(page);
        await expect.poll(() => countCalls(page, 'create', ACCOUNT_QQ)).toBe(2);
        await expect(statusText(page, 'error')).toBeVisible();
        await expect(failureHelpEntry(page)).toBeVisible();
    });

    test(`[${suite}] a failed sign-in runs the automatic check once and shows where the connection broke`, async ({ page }) => {
        await setSelfCheck(page, ACCOUNT_GAMMA, 'tls-reset');
        await scriptQr(page, ACCOUNT_GAMMA, ['error']);
        await driver.selectProvider(page, ACCOUNT_GAMMA);
        await expect(statusText(page, 'error')).toBeVisible();

        // 先给简单办法（重启；换网络再重启），自检结论在它后面。
        await expect(tipsList(page)).toBeVisible();
        await expect(loginDialog(page).getByText('Switch to another network (for example a phone hotspot), then restart Folia.')).toBeVisible();
        const verdict = loginDialog(page).getByText(/The connection to the Gamma servers was cut during the encryption handshake \(probe\.example 203\.0\.113\.7 \(IPv4\): ECONNRESET\)/);
        await expect(verdict).toBeVisible();
        await expect(loginDialog(page).getByText(/IPv4 connection: probe\.example: ECONNRESET \(tls\)/)).toBeVisible();
        await expect(failureHelpEntry(page)).toBeVisible();
        expect(await countCalls(page, 'self-check', ACCOUNT_GAMMA)).toBe(1);

        // 报告里带着同一个结论与逐层的结果。
        await page.evaluate(() => {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: async (text: string) => { (window as unknown as { __copied?: string }).__copied = text; } },
            });
        });
        if (foldsDiagnostics) {
            // 诊断一开始收着：展开之后才有复制与反馈。
            await expect(diagnosticsButton(page)).toHaveCount(0);
            await failureHelpEntry(page).click();
            await diagnosticsButton(page).click();
        } else {
            await page.keyboard.press('F4');
        }
        await expect.poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? '')).toContain('verdict: tls-reset');
        const copied = await page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? '');
        expect(copied).toContain('v4 203.0.113.7: tcp 10ms → ECONNRESET at tls: read ECONNRESET');
        expect(copied).toContain('probe: acct-gamma diagnostics');
    });

    test(`[${suite}] no automatic check for a login canceled on the phone, and a check that fails says so`, async ({ page }) => {
        await setSelfCheck(page, ACCOUNT_GAMMA, 'network-ok');
        await scriptQr(page, ACCOUNT_GAMMA, ['canceled']);
        await driver.selectProvider(page, ACCOUNT_GAMMA);
        await expect(loginDialog(page).getByText(/^Login was canceled on your phone\./)).toBeVisible();
        await page.waitForTimeout(300);
        expect(await countCalls(page, 'self-check', ACCOUNT_GAMMA)).toBe(0);
        await driver.closeLogin(page);
        await expect(loginDialog(page)).toHaveCount(0);

        await setSelfCheck(page, ACCOUNT_QQ, 'error');
        await scriptQr(page, ACCOUNT_QQ, ['error']);
        await driver.selectProvider(page, ACCOUNT_QQ);
        await expect(statusText(page, 'error')).toBeVisible();
        await expect(loginDialog(page).getByText('The automatic check could not finish: probe: self-check unavailable')).toBeVisible();
        await expect(failureHelpEntry(page)).toBeVisible();
    });
});

test.describe(`[${suite}] closing`, () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, suite);
    });

    test(`[${suite}] closing the login cancels the session and stops polling`, async ({ page }) => {
        await driver.selectProvider(page, ACCOUNT_GAMMA);
        await expect(statusText(page, 'waiting')).toBeVisible();
        const key = await lastKey(page, ACCOUNT_GAMMA);
        await driver.closeLogin(page);
        await expect(loginDialog(page)).toHaveCount(0);
        await expect.poll(() => calls(page, 'cancel')).toEqual([expect.objectContaining({ providerId: ACCOUNT_GAMMA, key })]);
        const checks = await countCalls(page, 'check');
        await page.waitForTimeout(2_500);
        expect(await countCalls(page, 'check')).toBe(checks);
        expect(await activeProvider(page)).toBe(ACCOUNT_ALPHA);
    });
});

test.describe(`[${suite}] NetEase backend`, () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, suite);
    });

    test(`[${suite}] a backend failure shows the cause and restart instead of retry; a successful restart asks for a code`, async ({ page }) => {
        await page.evaluate(() => window.__accountProbe!.setNeteaseBackend({
            supported: true,
            status: 'error',
            error: 'probe: xeapi key missing',
        }));

        // 只有网易读后端状态：别的平台照常出码。
        await driver.selectProvider(page, ACCOUNT_GAMMA);
        await expect(statusText(page, 'waiting')).toBeVisible();
        await expect(restartButton(page)).toHaveCount(0);
        await driver.closeLogin(page);
        await expect(loginDialog(page)).toHaveCount(0);

        await driver.selectProvider(page, ACCOUNT_NETEASE);
        await expect(loginDialog(page)).toHaveAccessibleName('Scan with Netease App');
        await expect(loginDialog(page).getByText('The local NetEase service is not running')).toBeVisible();
        await expect(loginDialog(page).getByText('probe: xeapi key missing')).toBeVisible();
        await driver.expectRestartLabel(page, 'Restart backend');
        // 要码照常发出（后端没起来所以失败）：重试与状态文案被后端故障盖住，诊断照样给——
        // 报告里有拉起的每一步与错误原文，重启解决不了时用户可以直接反馈。
        await expect.poll(() => countCalls(page, 'create', ACCOUNT_NETEASE)).toBe(1);
        await expect(retryButton(page)).toHaveCount(0);
        await expect(anyFailureHelpEntry(page)).toBeVisible();
        await expect(statusText(page, 'error')).toHaveCount(0);
        await expect(qrImage(page)).toHaveCount(0);

        // 重启失败：故障留着，不要码。
        await page.evaluate(() => window.__accountProbe!.setBackendRestart('error', 300));
        await driver.restart(page);
        await expect.poll(() => countCalls(page, 'backend-restart')).toBe(1);
        await driver.expectRestartLabel(page, 'Restart backend');
        await expect(loginDialog(page).getByText('The local NetEase service is not running')).toBeVisible();
        expect(await countCalls(page, 'create', ACCOUNT_NETEASE)).toBe(1);

        // 重启成功：故障消失，自动要码。
        await page.evaluate(() => window.__accountProbe!.setBackendRestart('running', 600));
        await driver.restart(page);
        await driver.expectRestartLabel(page, 'Restarting…');
        await expect(restartButton(page)).toBeDisabled();
        await expect(loginDialog(page).getByText('The local NetEase service is not running')).toHaveCount(0);
        await expect.poll(() => countCalls(page, 'create', ACCOUNT_NETEASE)).toBe(2);
        await expect(statusText(page, 'waiting')).toBeVisible();
        await expectQrKey(page, await lastKey(page, ACCOUNT_NETEASE));
        expect(await countCalls(page, 'backend-restart')).toBe(2);
    });
});

test.describe(`[${suite}] logout`, () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, suite);
    });

    test(`[${suite}] only the current signed-in provider offers logout, and it runs that provider's injected logout`, async ({ page }) => {
        const logoutEntries = await driver.openLogoutEntries(page);
        // beta 也已登录，但不是当前平台：没有登出入口。
        await expect(logoutEntries).toHaveCount(1);
        await driver.expectLogoutOn(page, ACCOUNT_ALPHA);

        await driver.logoutCurrent(page, ACCOUNT_ALPHA);
        await expect.poll(() => calls(page, 'host-logout')).toEqual([expect.objectContaining({ providerId: ACCOUNT_ALPHA })]);
        await expect.poll(() => calls(page, 'auth-logout')).toEqual([expect.objectContaining({ providerId: ACCOUNT_ALPHA })]);
        // 退出只把这个平台的歌移出播放器，一次。
        expect((await calls(page, 'drop-songs')).map(call => call.providerId)).toEqual([ACCOUNT_ALPHA]);
        await expect.poll(() => accountStatus(page, ACCOUNT_ALPHA)).toBe('anonymous');
        expect(await activeProvider(page)).toBe(ACCOUNT_ALPHA);
        expect(await accountStatus(page, ACCOUNT_BETA)).toBe('authenticated');
        await expect(driver.confirmDialog(page)).toHaveCount(0);

        // 当前平台登出后（未登录）：没有任何登出入口。
        await expect(await driver.openLogoutEntries(page)).toHaveCount(0);
        await driver.closePicker(page);
    });
});
}

test.describe('[grid-only] stacking', () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, 'grid');
    });

    // 网格的切换器盖在登录弹窗之上，弹窗开着时还能选别的平台；TUI 的登录框是模态的（按键独占），没有这条路径。
    test('[grid-only] a new sign-in stops the previous session first, keyed to the provider that started it', async ({ page }) => {
        // 先给 gamma 要了码，再在菜单里选 quill（多方式，停在选方式、不要码）。
        await GRID_DRIVER.selectProvider(page, ACCOUNT_GAMMA);
        await expect(statusText(page, 'waiting')).toBeVisible();
        const key = await lastKey(page, ACCOUNT_GAMMA);
        await GRID_DRIVER.selectProvider(page, ACCOUNT_QUILL);
        // A4 起（A3 的有意变化「单一在途登录」）：开始新的登录时先停掉旧会话——取消的是 gamma 的会话、交给 gamma，
        // 而不是等到关窗；原先 gamma 的会话会在后台一直轮询，确认后替 gamma 登录。
        await expect.poll(() => calls(page, 'cancel')).toEqual([expect.objectContaining({ providerId: ACCOUNT_GAMMA, key })]);
        await expect(loginDialog(page).getByText('Pick a sign-in method to generate the QR code')).toBeVisible();
        expect(await countCalls(page, 'create', ACCOUNT_QUILL)).toBe(0);
        // 旧会话停了就不再轮询。
        const checks = await countCalls(page, 'check', ACCOUNT_GAMMA);
        await page.waitForTimeout(2_500);
        expect(await countCalls(page, 'check', ACCOUNT_GAMMA)).toBe(checks);

        // 关窗时没有活着的会话可取消：取消记录仍只有 gamma 那一条。
        await gridCloseButton(page).click();
        await expect(loginDialog(page)).toHaveCount(0);
        await page.waitForTimeout(300);
        expect(await calls(page, 'cancel')).toEqual([expect.objectContaining({ providerId: ACCOUNT_GAMMA, key })]);
    });
});

// 登录会话在账户 controller 里（宿主持有，换 suite 不重建）：换 suite 只换 account surface，新 suite 接着显示同一个会话。
// A6 起 TUI 有自己的 account surface，不再回退网格。切换不再先问，哪个 suite 都不出确认框。
test.describe('[switch] grid and TUI share the account flows', () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, 'grid');
    });

    test('[switch] with the TUI selected, its own account surface (not the grid fallback) answers a sign-in, and switches ask nothing', async ({ page }) => {
        await setSuite(page, 'tui');
        await expect(switcher(page)).toHaveCount(0);

        // 登录：TUI 的登录框（不是网格弹窗），扫码确认后直接切到登录的平台。
        await scriptQr(page, ACCOUNT_GAMMA, ['scanned', 'confirmed']);
        expect(await startLogin(page, ACCOUNT_GAMMA)).toBe('started');
        await expect(loginDialog(page)).toBeVisible();
        await expect(loginDialog(page)).toHaveAttribute('data-tui-account-login', ACCOUNT_GAMMA);
        await expect(loginDialog(page)).toHaveAccessibleName('Scan with Netease App');
        await expectQrKey(page, await lastKey(page, ACCOUNT_GAMMA));
        await expect(statusText(page, 'scanned')).toBeVisible();
        await expectSwitchedWithoutAsking(page, TUI_DRIVER, ACCOUNT_GAMMA);
        await expect(gridConfirmDialog(page)).toHaveCount(0);
        await expect(loginDialog(page)).toHaveCount(0);
        expect((await calls(page, 'switch-cleanup')).map(call => call.providerId)).toEqual([ACCOUNT_GAMMA]);
        expect(await accountStatus(page, ACCOUNT_GAMMA)).toBe('authenticated');

        // 切换：不问，直接切过去，离开旧平台一次。
        await requestSwitch(page, ACCOUNT_ALPHA);
        await expect.poll(() => switchResult(page)).toBe('switched');
        await expectSwitchedWithoutAsking(page, TUI_DRIVER, ACCOUNT_ALPHA);
        expect((await calls(page, 'switch-cleanup')).map(call => call.providerId)).toEqual([ACCOUNT_GAMMA, ACCOUNT_ALPHA]);
        await expect(tuiHome(page)).toBeVisible();
    });

    test('[switch] the QQ-style two-step sign-in works in the TUI with keys only', async ({ page }) => {
        await setSuite(page, 'tui');

        expect(await startLogin(page, ACCOUNT_QUILL)).toBe('started');
        await expect(loginDialog(page)).toHaveAttribute('data-tui-account-login', ACCOUNT_QUILL);
        // 第一步：还没选方式，不要码；↓ 移到微信、Enter 选它。
        expect(await countCalls(page, 'create', ACCOUNT_QUILL)).toBe(0);
        await TUI_DRIVER.chooseMethod(page, 'WeChat scan');
        await expect.poll(() => calls(page, 'create', ACCOUNT_QUILL)).toEqual([
            expect.objectContaining({ methodId: 'wechat' }),
        ]);
        await expectQrKey(page, await lastKey(page, ACCOUNT_QUILL));
        await TUI_DRIVER.closeLogin(page);
        await expect(loginDialog(page)).toHaveCount(0);
        await expect.poll(() => countCalls(page, 'cancel', ACCOUNT_QUILL)).toBe(1);
    });

    test('[switch] a sign-in started on the grid keeps its session in the TUI and completes there', async ({ page }) => {
        await GRID_DRIVER.selectProvider(page, ACCOUNT_GAMMA);
        await expect(loginDialog(page)).toBeVisible();
        await expect.poll(() => countCalls(page, 'create', ACCOUNT_GAMMA)).toBe(1);
        const key = await lastKey(page, ACCOUNT_GAMMA);

        // 换到 TUI：网格首页卸载，TUI 的登录框接着显示同一个二维码会话，不取消、不重新要码。
        await setSuite(page, 'tui');
        await expect(loginDialog(page)).toHaveAttribute('data-tui-account-login', ACCOUNT_GAMMA);
        await expectQrKey(page, key);
        expect(await countCalls(page, 'cancel', ACCOUNT_GAMMA)).toBe(0);
        expect(await countCalls(page, 'create', ACCOUNT_GAMMA)).toBe(1);

        // 回到网格：弹窗回到网格首页的账户层里，会话仍是同一个。
        await setSuite(page, 'grid');
        await expect(loginDialog(page)).toBeVisible();
        await expect(page.locator('[data-tui-account-login]')).toHaveCount(0);
        await expectQrKey(page, key);
        expect(await countCalls(page, 'cancel', ACCOUNT_GAMMA)).toBe(0);

        // 再到 TUI 扫码确认：直接切到登录的平台；整个过程只有一次要码、没有取消。
        await setSuite(page, 'tui');
        await expectQrKey(page, key);
        await scriptQr(page, ACCOUNT_GAMMA, ['confirmed']);
        await expectSwitchedWithoutAsking(page, TUI_DRIVER, ACCOUNT_GAMMA);
        expect(await countCalls(page, 'create', ACCOUNT_GAMMA)).toBe(1);
        expect(await countCalls(page, 'cancel', ACCOUNT_GAMMA)).toBe(0);
        expect((await calls(page, 'switch-cleanup')).map(call => call.providerId)).toEqual([ACCOUNT_GAMMA]);
    });
});

test.describe('[bravais] the seam account entry opens the shared login window', () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, 'grid');
        await page.evaluate(() => window.__accountProbe!.setSuite('bravais'));
        // bravais 的首页与 stage 是 lazy chunk：等墙上出现首页层。
        await expect(bravaisStage(page)).toHaveAttribute('data-bravais-layer', /^home:/);
    });

    // fb3 / fb8：未登录时首页窄缝里只有一个「连接在线平台」入口：连接图标 + 文案，状态只在可访问名里；
    // 「先搜几首喜欢的歌试试看」那行在 bravais 里不显示。点了打开登录窗口，不替用的人选平台。
    test('[bravais] signed out, the seam shows one connect entry that opens the login window without a platform', async ({ page }) => {
        await setActive(page, ACCOUNT_GAMMA);
        await expect(bravaisSwitcher(page)).toHaveAttribute('data-bravais-account', 'guest');
        await expect(bravaisConnect(page)).toHaveText('Connect a streaming service');
        await expect(bravaisConnect(page).locator('[data-bravais-account-avatar="connect"] svg')).toBeVisible();
        await expect(bravaisConnect(page)).toHaveAccessibleName(/^Connect a streaming service · .+ · Not signed in$/);
        await expect(page.locator('[data-library-stage="bravais"] [data-bravais-seam]').getByText('Try searching a few songs first')).toHaveCount(0);
        await expect(loginDialog(page)).toHaveCount(0);

        await bravaisConnect(page).click();
        await expect(loginWindowPlatforms(page)).toBeVisible();
        // 不替用的人选平台：没有哪一行被选中，也没有开始登录。
        await expect(loginWindowPlatforms(page).locator('[role="option"][aria-selected="true"]')).toHaveCount(0);
        expect(await countCalls(page, 'create')).toBe(0);
    });
});

test.describe('account tab', () => {
    const accountTab = (page: Page) => page.locator('[data-probe-account-tab]');

    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, 'grid');
    });

    test('[account-tab] NetEase logout runs the host logout', async ({ page }) => {
        await setAccount(page, ACCOUNT_NETEASE, 'authenticated');
        await setActive(page, ACCOUNT_NETEASE);
        await page.evaluate(() => window.__accountProbe!.showAccountTab(true));
        await accountTab(page).getByRole('button', { name: 'Logout' }).click();
        await expect.poll(() => calls(page, 'host-logout')).toEqual([expect.objectContaining({ providerId: ACCOUNT_NETEASE })]);
        await expect.poll(() => accountStatus(page, ACCOUNT_NETEASE)).toBe('anonymous');
    });

    test('[account-tab] non-NetEase logout signs the provider out', async ({ page }) => {
        await page.evaluate(() => window.__accountProbe!.showAccountTab(true));
        await accountTab(page).getByRole('button', { name: 'Logout' }).click();
        await expect.poll(() => calls(page, 'auth-logout')).toEqual([expect.objectContaining({ providerId: ACCOUNT_ALPHA })]);
        await expect.poll(() => accountStatus(page, ACCOUNT_ALPHA)).toBe('anonymous');
    });

    // A0 记下的缺陷：AccountTab 的非网易登出直接 omni.logout + clearAccount，绕过了平台注入的 per-provider 登出
    // （酷狗的 clearAuthState 等），与切换器的登出路径不一致。A4 让 AccountTab 改走账户 controller 的 logout 后转正。
    test('[account-tab] non-NetEase logout runs that provider\'s injected logout, like the switcher', async ({ page }) => {
        await page.evaluate(() => window.__accountProbe!.showAccountTab(true));
        await accountTab(page).getByRole('button', { name: 'Logout' }).click();
        await expect.poll(() => calls(page, 'host-logout')).toEqual([expect.objectContaining({ providerId: ACCOUNT_ALPHA })]);
    });
});
