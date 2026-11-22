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
// 在线账户的行为回归闸门（Library v2 账户重构 A0 起每一步都跑）：扫码登录、选平台、切换、登出。
//
// 断言的是语义：调用账（要码 / 轮询 / keyed 取消 / 读账号 / 宿主登出 / 切换清理，见 dev/probes/accountBehavior/probeApi.ts）、
// 账户 store、当前平台，再加上界面上用户能看到的结果（登录窗口的标题与那一句话、重试、详情里的诊断入口）。
//
// 登录、切换、退出登录都在共用的登录窗口里（src/components/login：App 挂一个 LoginHost，探针照着挂；窗口左边是平台那一列
// `listbox "Online music provider"`，右边是选中那一行的账号 / 登录）。各 suite 只是进这个窗口的门不同，用例按 suite 参数化的
// 就是这道门，集中在下面的驱动里：
// - grid：右下角的切换器（data-testid="online-provider-switcher"）只是一个按钮，点了打开登录窗口、开在正在用的平台上；
//   当前平台未登录时首页还有一个「Login」按钮，打开窗口但不替用的人选平台。选一行：已登录 / 不用登录的平台给「Switch to …」，
//   未登录的平台当场开始登录。全部用鼠标点。
// - tui：首页在线页签的平台列表（未登录时就是页签内容，已登录时 F2 打开），用按键（↑↓ / Home 移动、Enter 选、Delete 登出）。
//   选已登录的平台直接切；选未登录的平台打开同一个登录窗口。TUI 自己的登录框已经没有了。
// 标题前缀 `[grid]` / `[tui]` 的用例对两个 suite 各跑一遍（看的是「从这道门进去之后」的切换、登录、关窗、登出）；
// `[login-window]` 的用例只看窗口里面（二维码寿命、失败的情况与诊断、登录方式、本地后端），两个 suite 是同一个窗口，
// 只从网格进一遍；`[switch]` 在两套之间切换。
// bravais 没有自己的账户界面：首页窄缝里的账户入口只打开同一个登录窗口，最后的 `[bravais]` 用例只看入口在、点了窗口打开、
// 没有替用的人选平台。
//
// 时序：二维码每 2 秒轮询一次（core/account/providerLoginSession.service 的 PROVIDER_LOGIN_POLL_INTERVAL_MS），探针用真实时钟，所以
// 编排的状态要在要码之前排好，每一步最多等一个轮询周期。登录确认、账号读到之后窗口放一段登录成功的动画才关。

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
const requestSwitch = (page: Page, providerId: string) => page.evaluate(id => window.__accountProbe!.requestSwitch(id), providerId);
const switchResult = (page: Page) => page.evaluate(() => window.__accountProbe!.switchResult());

// ---- 登录窗口（两个 suite 共用）：role=dialog，accessible name = 标题（选中平台后是「Log in to 平台名」） ----
const loginDialog = (page: Page) => page.getByRole('dialog');
/** 平台那一列是 listbox，每个平台一行 option（data-row = 平台 id，选中的那一行 aria-selected）。 */
const loginWindowPlatforms = (page: Page) => loginDialog(page).getByRole('listbox', { name: 'Online music provider' });
const platformRow = (page: Page, providerId: string) => loginWindowPlatforms(page).locator(`[role="option"][data-row="${providerId}"]`);
/** 右边那一句标题：现在怎么了（等着扫、扫过了、哪一种失败）。 */
const headline = (page: Page) => loginDialog(page).getByRole('heading', { level: 3 });
/** 二维码图片（探针的假二维码把会话 key 写在图片里）；过期之后它淡淡地留在刷新按钮里。 */
const qrImage = (page: Page) => loginDialog(page).locator('img[src*="data-qr-key"]');
/** 等着扫的那一张：不在刷新按钮里。 */
const liveQrImage = (page: Page) => loginDialog(page).locator(':not(button) > img[src*="data-qr-key"]');
const expectQrKey = async (page: Page, key: string | undefined) => {
    expect(key).toBeTruthy();
    await expect(qrImage(page)).toHaveAttribute('src', new RegExp(encodeURIComponent(key!).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
};
const HEADLINE = {
    scanned: 'Scanned! Confirm on your phone.',
    /** 没扫就过期：不算失败，没有详情。 */
    expired: 'The QR code has expired',
    /** 扫过才过期：算失败，第二行才是「The QR code has expired」。 */
    expiredAfterScan: 'Not confirmed on the phone',
    /** 平台什么都没说的失败。 */
    failed: 'Sign-in failed',
    accountNotRead: 'Failed to read the account',
    chooseMethod: 'Choose sign-in method',
} as const;
/** 等着扫码：二维码在，标题是平台的登录标题（假 provider 没有自己的登录文案，就是「Log in to 平台名」）。 */
const expectWaitingForScan = async (page: Page, providerId: string) => {
    await expect(liveQrImage(page)).toBeVisible();
    await expect(headline(page)).toHaveText(`Log in to ${shortName(providerId)}`);
};
/** 重试：消息里的那个按钮。没扫就过期时二维码那一块上还有一个同名的刷新钮（在它前面），所以取最后一个。 */
const retryButton = (page: Page) => loginDialog(page).getByRole('button', { name: 'Refresh QR code' }).last();
/** 失败的详情（事实、自检结论、复制诊断与反馈）收在「Details」下面；有它就是「这一次给诊断」。 */
const detailsToggle = (page: Page) => loginDialog(page).getByRole('button', { name: 'Details' });
const diagnosticsButton = (page: Page) => loginDialog(page).getByRole('button', { name: 'Copy diagnostics' });
const methodButton = (page: Page, label: 'QQ scan' | 'WeChat scan') => loginDialog(page).getByRole('button', { name: label });
const restartButton = (page: Page) => loginDialog(page).getByRole('button', { name: /Restart backend|Restarting…/ });
const switchToButton = (page: Page, providerId: string) => (
    loginDialog(page).getByRole('button', { name: `Switch to ${shortName(providerId)}`, exact: true })
);
const windowLogoutButton = (page: Page) => loginDialog(page).getByRole('button', { name: 'Logout' });
const closeLogin = async (page: Page) => {
    await loginDialog(page).getByRole('button', { name: 'Close', exact: true }).click();
};
/** 换掉剪贴板写入，之后用 copiedText 读回写进去的内容。 */
const captureClipboard = (page: Page) => page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text: string) => { (window as unknown as { __copied?: string }).__copied = text; } },
    });
});
const copiedText = (page: Page) => page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? '');

// ---- grid 的门：右下角的切换器（一个按钮）与未登录首页的「Login」按钮 ----
const switcher = (page: Page) => page.getByTestId('online-provider-switcher');
const switcherToggle = (page: Page) => switcher(page).getByRole('button', { name: 'Switch online music provider' });
/** 切换器上画的平台（正在用的那个）。 */
const switcherPill = (page: Page) => switcher(page).locator('[data-login-pill]');
const gridGuestLogin = (page: Page) => page.getByRole('button', { name: 'Login', exact: true });
/** 打开登录窗口（已经开着就不动）：点切换器，窗口开在正在用的平台上。 */
const openLoginFromSwitcher = async (page: Page) => {
    if (await loginDialog(page).count() === 0) await switcherToggle(page).click();
    await expect(loginWindowPlatforms(page)).toBeVisible();
};

// ---- tui 的门：首页在线页签的平台列表 ----
const tuiHome = (page: Page) => page.locator('[data-library-home="tui"]');
const tuiAccounts = (page: Page) => page.locator('[data-tui-accounts]');
const tuiAccountRow = (page: Page, providerId: string) => tuiAccounts(page).locator(`[data-tui-account-provider="${providerId}"]`);
const tuiLogoutButtons = (page: Page) => tuiAccounts(page).locator('[data-tui-account-logout]');
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

// ---- 切换确认：现在切换不再先问，哪个 suite 都不该出现（网格的 ConfirmDialog 与 TUI 的确认层标题都是这一句） ----
const switchConfirm = (page: Page) => page.getByRole('heading', { name: 'Switch online music provider' });

// ---- bravais：首页窄缝里的账户入口（未登录时是「连接在线平台」），点了打开共用的登录窗口 ----
const bravaisStage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const bravaisSwitcher = (page: Page) => page.locator('[data-bravais-account-slot] [data-bravais-account]');
const bravaisConnect = (page: Page) => page.locator('[data-bravais-account-toggle="connect"]');

type AccountDriver = {
    suite: Suite;
    /** 首页挂好、账户入口可用。 */
    ready: (page: Page) => Promise<void>;
    /**
     * 从首页的入口选一个平台，走到头：能直接切的（已登录、不用登录）切过去，要登录的停在登录窗口里那个平台的登录上。
     * 网格：切换器 → 登录窗口里点那一行，给了「Switch to …」就点它；TUI：平台列表 + Enter。
     */
    selectProvider: (page: Page, providerId: string) => Promise<void>;
    /** 当前平台未登录时首页上的入口（网格：「Login」按钮；TUI：在线页签就是平台列表）。 */
    guestEntry: (page: Page) => Locator;
    /** 从未登录的入口选一个平台（网格的「Login」打开窗口但不替用的人选平台）。 */
    selectFromGuestEntry: (page: Page, providerId: string) => Promise<void>;
    /** 入口上标着某个平台为当前平台（网格：切换器上画的；TUI：平台列表里的当前标记）。 */
    expectCurrent: (page: Page, providerId: string) => Promise<void>;
    /** 打开入口，回里面的登出按钮（网格：登录窗口里选中那一行的「Logout」；TUI：平台列表里的）。 */
    openLogoutEntries: (page: Page) => Promise<Locator>;
    /** 登出按钮是哪个平台的。 */
    expectLogoutOn: (page: Page, providerId: string) => Promise<void>;
    /** 登出当前平台。 */
    logoutCurrent: (page: Page, providerId: string) => Promise<void>;
    /** 收起入口（网格的登录窗口；TUI 的 F2 列表——未登录时它是页签内容，留着）。 */
    closeEntry: (page: Page) => Promise<void>;
};

const GRID_DRIVER: AccountDriver = {
    suite: 'grid',
    ready: async page => {
        await expect(switcher(page)).toBeVisible();
    },
    selectProvider: async (page, providerId) => {
        await openLoginFromSwitcher(page);
        const row = platformRow(page, providerId);
        // 已经选中的那一行不再点：窗口开在它上面时登录已经开始了。
        if (await row.getAttribute('aria-selected') !== 'true') await row.click();
        await expect(row).toHaveAttribute('aria-selected', 'true');
        // 选中的行和右边那一幅是同一次渲染：有「Switch to …」就是能直接切的平台，切成了窗口自己关。
        const switchTo = switchToButton(page, providerId);
        if (await switchTo.count() > 0) {
            await switchTo.click();
            await expect(loginDialog(page)).toHaveCount(0);
        }
    },
    guestEntry: gridGuestLogin,
    selectFromGuestEntry: async (page, providerId) => {
        await gridGuestLogin(page).click();
        await expect(loginWindowPlatforms(page)).toBeVisible();
        // 不替用的人选平台：没有哪一行被选中，也没有开始登录。
        await expect(loginWindowPlatforms(page).locator('[role="option"][aria-selected="true"]')).toHaveCount(0);
        expect(await countCalls(page, 'create')).toBe(0);
        await GRID_DRIVER.selectProvider(page, providerId);
    },
    expectCurrent: async (page, providerId) => {
        await expect(switcherPill(page)).toHaveAttribute('data-login-pill', providerId);
    },
    openLogoutEntries: async page => {
        await openLoginFromSwitcher(page);
        return windowLogoutButton(page);
    },
    expectLogoutOn: async (page, providerId) => {
        await expect(platformRow(page, providerId)).toHaveAttribute('aria-selected', 'true');
    },
    logoutCurrent: async page => {
        await windowLogoutButton(page).click();
        // 真的退出了窗口才关。
        await expect(loginDialog(page)).toHaveCount(0);
    },
    closeEntry: async page => {
        if (await loginDialog(page).count() > 0) await closeLogin(page);
        await expect(loginDialog(page)).toHaveCount(0);
    },
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
    guestEntry: page => page.locator('[data-tui-accounts="guest"]'),
    selectFromGuestEntry: async (page, providerId) => {
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
    closeEntry: async page => {
        if (await page.locator('[data-tui-accounts="panel"]').count() > 0) await page.keyboard.press('Escape');
        await expect(page.locator('[data-tui-accounts="panel"]')).toHaveCount(0);
    },
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

/** 切换不先问：没有确认框、没有待确认请求，当前平台直接换过去。 */
const expectSwitchedWithoutAsking = async (page: Page, providerId: string) => {
    await expect.poll(() => activeProvider(page)).toBe(providerId);
    await expect(switchConfirm(page)).toHaveCount(0);
    expect(await pendingSwitch(page)).toBeNull();
};

for (const suite of SUITES) {
const driver = DRIVERS[suite];

test.describe(`[${suite}] switching`, () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, suite);
    });

    test(`[${suite}] switching to a signed-in provider switches at once and leaves the old provider once`, async ({ page }) => {
        const generation = await requestGeneration(page);

        // 选当前平台：同一个 provider，不问也不清理（网格：登录窗口开在它的账号那一幅上，没有「Switch to …」）。
        await driver.selectProvider(page, ACCOUNT_ALPHA);
        await expect(switchConfirm(page)).toHaveCount(0);
        expect(await pendingSwitch(page)).toBeNull();
        expect(await countCalls(page, 'switch-cleanup')).toBe(0);

        await driver.selectProvider(page, ACCOUNT_BETA);
        // 能直接切的平台：不问（队列留着，切换不拿走什么），不开始登录，登录窗口不留着。
        await expectSwitchedWithoutAsking(page, ACCOUNT_BETA);
        await expect(loginDialog(page)).toHaveCount(0);
        expect(await countCalls(page, 'create')).toBe(0);
        // 离开旧平台恰好一次、目标是新平台；提交前作废一次在途请求；提交后读一次新平台的账号。
        expect((await calls(page, 'switch-cleanup')).map(call => call.providerId)).toEqual([ACCOUNT_BETA]);
        expect(await requestGeneration(page)).toBe(generation + 1);
        await expect.poll(() => calls(page, 'refresh')).toEqual([expect.objectContaining({ providerId: ACCOUNT_BETA, ok: true })]);
        await driver.expectCurrent(page, ACCOUNT_BETA);
    });

    test(`[${suite}] a provider without accounts switches at once too`, async ({ page }) => {
        await driver.selectProvider(page, ACCOUNT_MODO);
        await expectSwitchedWithoutAsking(page, ACCOUNT_MODO);
        await expect(loginDialog(page)).toHaveCount(0);
        expect(await countCalls(page, 'resolve-methods')).toBe(0);
        expect(await countCalls(page, 'create')).toBe(0);
        expect((await calls(page, 'switch-cleanup')).map(call => call.providerId)).toEqual([ACCOUNT_MODO]);
        // 没有账户的源没有人可问：不读账号。
        expect(await countCalls(page, 'refresh')).toBe(0);
    });

    test(`[${suite}] the signed-out home entry follows the same rules as the switcher`, async ({ page }) => {
        // 当前平台未登录时首页上的入口（网格：「Login」按钮，打开登录窗口、不替用的人选平台；TUI：在线页签就是平台列表）。
        await setActive(page, ACCOUNT_GAMMA);
        await expect(driver.guestEntry(page)).toBeVisible();

        await driver.selectFromGuestEntry(page, ACCOUNT_QUILL);
        await expect(loginDialog(page)).toBeVisible();
        await expect(platformRow(page, ACCOUNT_QUILL)).toHaveAttribute('aria-selected', 'true');
        await expect(switchConfirm(page)).toHaveCount(0);
        await expect.poll(() => countCalls(page, 'resolve-methods', ACCOUNT_QUILL)).toBe(1);
        expect(await activeProvider(page)).toBe(ACCOUNT_GAMMA);
    });

    test(`[${suite}] picking a signed-in provider on the signed-out home switches at once`, async ({ page }) => {
        await setActive(page, ACCOUNT_GAMMA);
        await expect(driver.guestEntry(page)).toBeVisible();

        await driver.selectFromGuestEntry(page, ACCOUNT_BETA);
        await expectSwitchedWithoutAsking(page, ACCOUNT_BETA);
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

        // 未登录的平台：先登录，不确认；登录窗口开在这个平台上（TUI 打开的也是这一个窗口）。
        await expect(loginDialog(page)).toBeVisible();
        await expect(platformRow(page, ACCOUNT_GAMMA)).toHaveAttribute('aria-selected', 'true');
        await expect(switchConfirm(page)).toHaveCount(0);
        expect(await pendingSwitch(page)).toBeNull();
        await expect(loginDialog(page)).toHaveAccessibleName(`Log in to ${shortName(ACCOUNT_GAMMA)}`);
        await expectWaitingForScan(page, ACCOUNT_GAMMA);
        await expect.poll(() => calls(page, 'create', ACCOUNT_GAMMA)).toEqual([
            expect.objectContaining({ methodId: null }),
        ]);
        const key = await lastKey(page, ACCOUNT_GAMMA);
        await expectQrKey(page, key);

        await expect(headline(page)).toHaveText(HEADLINE.scanned);
        // 确认后：读账号（账户先写进 store）→ 不是当前平台，直接切过去（不问）→ 窗口放完登录成功的动画关掉。
        await expectSwitchedWithoutAsking(page, ACCOUNT_GAMMA);
        await expect(loginDialog(page)).toHaveCount(0);
        expect(await accountStatus(page, ACCOUNT_GAMMA)).toBe('authenticated');
        // 离开旧平台恰好一次；激活这一步不再读账号：登录事务里的那一次就是全部。
        expect((await calls(page, 'switch-cleanup')).map(call => call.providerId)).toEqual([ACCOUNT_GAMMA]);
        expect((await calls(page, 'refresh')).map(call => call.providerId)).toEqual([ACCOUNT_GAMMA]);
        // 已确认的会话换成了登录凭据，不再取消。
        expect(await countCalls(page, 'cancel', ACCOUNT_GAMMA)).toBe(0);
        await driver.expectCurrent(page, ACCOUNT_GAMMA);
    });

    test(`[${suite}] signing in to the current provider needs no confirmation`, async ({ page }) => {
        await setActive(page, ACCOUNT_GAMMA);
        await scriptQr(page, ACCOUNT_GAMMA, ['confirmed']);
        await driver.selectProvider(page, ACCOUNT_GAMMA);
        await expect(loginDialog(page)).toBeVisible();

        await expect.poll(() => accountStatus(page, ACCOUNT_GAMMA)).toBe('authenticated');
        await expect(loginDialog(page)).toHaveCount(0);
        await expect(switchConfirm(page)).toHaveCount(0);
        expect(await pendingSwitch(page)).toBeNull();
        expect(await activeProvider(page)).toBe(ACCOUNT_GAMMA);
        expect(await countCalls(page, 'switch-cleanup')).toBe(0);
        expect(await countCalls(page, 'create', ACCOUNT_GAMMA)).toBe(1);
    });
});

test.describe(`[${suite}] closing`, () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, suite);
    });

    test(`[${suite}] closing the login cancels the session and stops polling`, async ({ page }) => {
        await driver.selectProvider(page, ACCOUNT_GAMMA);
        await expectWaitingForScan(page, ACCOUNT_GAMMA);
        const key = await lastKey(page, ACCOUNT_GAMMA);
        await closeLogin(page);
        await expect(loginDialog(page)).toHaveCount(0);
        await expect.poll(() => calls(page, 'cancel')).toEqual([expect.objectContaining({ providerId: ACCOUNT_GAMMA, key })]);
        const checks = await countCalls(page, 'check');
        await page.waitForTimeout(2_500);
        expect(await countCalls(page, 'check')).toBe(checks);
        expect(await activeProvider(page)).toBe(ACCOUNT_ALPHA);
    });
});

test.describe(`[${suite}] logout`, () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, suite);
    });

    test(`[${suite}] logging out runs that provider's injected logout and leaves the other providers signed in`, async ({ page }) => {
        const logoutEntries = await driver.openLogoutEntries(page);
        // 入口打开时登出按钮只有一个，是当前平台的（TUI 的平台列表只在当前平台那一行放它；登录窗口开在当前平台上）。
        await expect(logoutEntries).toHaveCount(1);
        await driver.expectLogoutOn(page, ACCOUNT_ALPHA);
        if (suite === 'grid') {
            // 登录窗口里选中的任何一个已登录的平台都能退出（不只是当前平台）：选 beta，这一幅也有「Logout」，外加「Switch to」。
            await platformRow(page, ACCOUNT_BETA).click();
            await expect(switchToButton(page, ACCOUNT_BETA)).toBeVisible();
            await expect(logoutEntries).toHaveCount(1);
            await platformRow(page, ACCOUNT_ALPHA).click();
            await expect(platformRow(page, ACCOUNT_ALPHA)).toHaveAttribute('aria-selected', 'true');
            await expect(switchToButton(page, ACCOUNT_BETA)).toHaveCount(0);
        }

        await driver.logoutCurrent(page, ACCOUNT_ALPHA);
        await expect.poll(() => calls(page, 'host-logout')).toEqual([expect.objectContaining({ providerId: ACCOUNT_ALPHA })]);
        await expect.poll(() => calls(page, 'auth-logout')).toEqual([expect.objectContaining({ providerId: ACCOUNT_ALPHA })]);
        // 退出只把这个平台的歌移出播放器，一次。
        expect((await calls(page, 'drop-songs')).map(call => call.providerId)).toEqual([ACCOUNT_ALPHA]);
        await expect.poll(() => accountStatus(page, ACCOUNT_ALPHA)).toBe('anonymous');
        expect(await activeProvider(page)).toBe(ACCOUNT_ALPHA);
        expect(await accountStatus(page, ACCOUNT_BETA)).toBe('authenticated');
        await expect(switchConfirm(page)).toHaveCount(0);

        // 当前平台登出后（未登录）：入口里没有任何登出按钮（网格的窗口开在它的登录上）。
        await expect(await driver.openLogoutEntries(page)).toHaveCount(0);
        await driver.closeEntry(page);
    });
});
}

// 登录窗口里面的事：两个 suite 是同一个窗口，只从网格的切换器进一遍。
test.describe('[login-window] signing in', () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, 'grid');
    });

    test('[login-window] a failed account read after confirmation keeps the window on the failure with retry and diagnostics', async ({ page }) => {
        await page.evaluate(id => window.__accountProbe!.failRefresh(id, 1), ACCOUNT_GAMMA);
        await scriptQr(page, ACCOUNT_GAMMA, ['confirmed']);
        await GRID_DRIVER.selectProvider(page, ACCOUNT_GAMMA);

        await expect.poll(() => calls(page, 'refresh')).toEqual([expect.objectContaining({ providerId: ACCOUNT_GAMMA, ok: false })]);
        await expect(loginDialog(page)).toBeVisible();
        await expect(headline(page)).toHaveText(HEADLINE.accountNotRead);
        await expect(detailsToggle(page)).toBeVisible();
        await expect(retryButton(page)).toBeVisible();
        await expect(switchConfirm(page)).toHaveCount(0);
        // 没读到账号：不算登录上（账户 store 记下这一次没读成，平台那一行仍是未登录），也不切过去。
        expect(await accountStatus(page, ACCOUNT_GAMMA)).toBe('error');
        await expect(platformRow(page, ACCOUNT_GAMMA)).toContainText('Not signed in');
        expect(await activeProvider(page)).toBe(ACCOUNT_ALPHA);
        expect(await countCalls(page, 'switch-cleanup')).toBe(0);
    });

    test('[login-window] several sign-in methods: no QR before a choice, one live session across choices', async ({ page }) => {
        await GRID_DRIVER.selectProvider(page, ACCOUNT_QUILL);
        await expect(loginDialog(page)).toBeVisible();
        // 步骤一：占位框，不要码，没有重试。
        await expect(headline(page)).toHaveText(HEADLINE.chooseMethod);
        await expect(loginDialog(page).getByText('Pick a sign-in method to generate the QR code')).toBeVisible();
        await expect.poll(() => countCalls(page, 'resolve-methods', ACCOUNT_QUILL)).toBe(1);
        await expect(methodButton(page, 'QQ scan')).toHaveAttribute('aria-pressed', 'false');
        await expect(retryButton(page)).toHaveCount(0);
        await page.waitForTimeout(500);
        expect(await countCalls(page, 'create')).toBe(0);

        await methodButton(page, 'QQ scan').click();
        await expect.poll(() => calls(page, 'create', ACCOUNT_QUILL)).toEqual([expect.objectContaining({ methodId: 'qq' })]);
        const first = await lastKey(page, ACCOUNT_QUILL);
        await expectQrKey(page, first);
        // 选了之后登录方式还留着，可以再换。
        await expect(methodButton(page, 'QQ scan')).toHaveAttribute('aria-pressed', 'true');
        await expect(methodButton(page, 'WeChat scan')).toHaveAttribute('aria-pressed', 'false');
        await expectWaitingForScan(page, ACCOUNT_QUILL);

        // 换方式：旧会话按自己的 provider 取消，再要新码；任何时候只有一个活跃会话。
        await methodButton(page, 'WeChat scan').click();
        await expect.poll(() => calls(page, 'create', ACCOUNT_QUILL)).toHaveLength(2);
        const second = await lastKey(page, ACCOUNT_QUILL);
        expect((await calls(page, 'create', ACCOUNT_QUILL))[1].methodId).toBe('wechat');
        await expect.poll(() => calls(page, 'cancel')).toEqual([expect.objectContaining({ providerId: ACCOUNT_QUILL, key: first })]);
        await expectQrKey(page, second);

        // 后端报过期（没扫过）：不算失败，没有详情；重试沿用已选的方式，并取消过期的那个会话。
        await scriptQr(page, ACCOUNT_QUILL, ['expired']);
        await expect(headline(page)).toHaveText(HEADLINE.expired);
        await expect(detailsToggle(page)).toHaveCount(0);
        await retryButton(page).click();
        await expect.poll(() => calls(page, 'create', ACCOUNT_QUILL)).toHaveLength(3);
        expect((await calls(page, 'create', ACCOUNT_QUILL))[2].methodId).toBe('wechat');
        expect((await calls(page, 'cancel')).map(call => call.key)).toEqual([first, second]);
        const third = await lastKey(page, ACCOUNT_QUILL);

        await closeLogin(page);
        await expect(loginDialog(page)).toHaveCount(0);
        await expect.poll(async () => (await calls(page, 'cancel')).map(call => call.key)).toEqual([first, second, third]);
    });

    test('[login-window] choosing another platform stops the previous session first, keyed to the provider that started it', async ({ page }) => {
        // 先给 gamma 要了码，再在平台那一列选 quill（多方式，停在选方式、不要码）。
        await GRID_DRIVER.selectProvider(page, ACCOUNT_GAMMA);
        await expectWaitingForScan(page, ACCOUNT_GAMMA);
        const key = await lastKey(page, ACCOUNT_GAMMA);
        await GRID_DRIVER.selectProvider(page, ACCOUNT_QUILL);
        // 单一在途登录：开始新的登录时先停掉旧会话——取消的是 gamma 的会话、交给 gamma，而不是等到关窗。
        await expect.poll(() => calls(page, 'cancel')).toEqual([expect.objectContaining({ providerId: ACCOUNT_GAMMA, key })]);
        await expect(loginDialog(page).getByText('Pick a sign-in method to generate the QR code')).toBeVisible();
        expect(await countCalls(page, 'create', ACCOUNT_QUILL)).toBe(0);
        // 旧会话停了就不再轮询。
        const checks = await countCalls(page, 'check', ACCOUNT_GAMMA);
        await page.waitForTimeout(2_500);
        expect(await countCalls(page, 'check', ACCOUNT_GAMMA)).toBe(checks);

        // 关窗时没有活着的会话可取消：取消记录仍只有 gamma 那一条。
        await closeLogin(page);
        await expect(loginDialog(page)).toHaveCount(0);
        await page.waitForTimeout(300);
        expect(await calls(page, 'cancel')).toEqual([expect.objectContaining({ providerId: ACCOUNT_GAMMA, key })]);
    });
});

test.describe('[login-window] QR lifetime', () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, 'grid');
    });

    test('[login-window] the TTL expires and cancels the code; an unscanned expiry is not a failure', async ({ page }) => {
        await setQrTtl(page, ACCOUNT_GAMMA, 1200);
        await GRID_DRIVER.selectProvider(page, ACCOUNT_GAMMA);
        await expectWaitingForScan(page, ACCOUNT_GAMMA);
        const key = await lastKey(page, ACCOUNT_GAMMA);

        await expect(headline(page)).toHaveText(HEADLINE.expired);
        await expect.poll(() => calls(page, 'cancel')).toEqual([expect.objectContaining({ providerId: ACCOUNT_GAMMA, key })]);
        await expect(retryButton(page)).toBeVisible();
        await expect(detailsToggle(page)).toHaveCount(0);
        // 到点即停：之后不再轮询。
        const checks = await countCalls(page, 'check');
        await page.waitForTimeout(2_500);
        expect(await countCalls(page, 'check')).toBe(checks);

        await setQrTtl(page, ACCOUNT_GAMMA, null);
        await retryButton(page).click();
        await expect.poll(() => countCalls(page, 'create', ACCOUNT_GAMMA)).toBe(2);
        await expectWaitingForScan(page, ACCOUNT_GAMMA);
        await expectQrKey(page, await lastKey(page, ACCOUNT_GAMMA));
    });

    test('[login-window] expiring after a scan counts as a failure and offers diagnostics', async ({ page }) => {
        // TTL 计时：第一次轮询（约 2 秒）报已扫码，3.5 秒到点。
        await setQrTtl(page, ACCOUNT_GAMMA, 3_500);
        await scriptQr(page, ACCOUNT_GAMMA, ['scanned']);
        await GRID_DRIVER.selectProvider(page, ACCOUNT_GAMMA);
        const key = await lastKey(page, ACCOUNT_GAMMA);
        await expect(headline(page)).toHaveText(HEADLINE.scanned);
        await expect(headline(page)).toHaveText(HEADLINE.expiredAfterScan);
        await expect(loginDialog(page).getByText(HEADLINE.expired, { exact: true })).toBeVisible();
        // 扫过码才过期算失败：有详情，展开是这一次的事实和复制诊断。
        await expect(detailsToggle(page)).toBeVisible();
        await expect(diagnosticsButton(page)).toHaveCount(0);
        await detailsToggle(page).click();
        await expect(loginDialog(page).getByText('Not finished · expired-after-scan')).toBeVisible();
        await expect(diagnosticsButton(page)).toBeVisible();
        expect((await calls(page, 'cancel')).map(call => call.key)).toEqual([key]);

        // 后端报的过期同理：扫过才算失败。
        await setQrTtl(page, ACCOUNT_GAMMA, null);
        await scriptQr(page, ACCOUNT_GAMMA, ['scanned', 'expired']);
        await retryButton(page).click();
        await expect(headline(page)).toHaveText(HEADLINE.scanned);
        await expect(detailsToggle(page)).toHaveCount(0);
        await expect(headline(page)).toHaveText(HEADLINE.expiredAfterScan);
        await expect(detailsToggle(page)).toBeVisible();
    });
});

test.describe('[login-window] failures and diagnostics', () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, 'grid');
    });

    // 各平台的扫码失败走同一套规则（对照组 gamma，QQ 不例外）：标题说是哪一种情况，「Details」下面是事实、自检结论、
    // 复制诊断与反馈。失败后由会话自动跑一次自检。
    test('[login-window] a failure the platform asks to wait on holds the retry until the wait ends', async ({ page }) => {
        // 用户在手机上取消：平台报错并要求等一会儿（探针缩短到 ACCOUNT_CANCEL_COOLDOWN_MS）才能再要码。
        await scriptQr(page, ACCOUNT_GAMMA, ['canceled']);
        await GRID_DRIVER.selectProvider(page, ACCOUNT_GAMMA);
        await expect(headline(page)).toHaveText(`${shortName(ACCOUNT_GAMMA)}: try again later`);
        // 平台的原话引在标题下面。
        await expect(loginDialog(page).getByText('probe: canceled on device', { exact: true })).toBeVisible();
        // 等的时候重试是一个倒数的占位，不是按钮；这期间不要码。
        const countdown = loginDialog(page).getByText(/^Try again in \d+ s$/);
        await expect(countdown).toBeVisible();
        await expect(retryButton(page)).toHaveCount(0);
        expect(await countCalls(page, 'create', ACCOUNT_GAMMA)).toBe(1);

        // 等完：倒数换成重试按钮。
        await expect(retryButton(page)).toBeVisible({ timeout: ACCOUNT_CANCEL_COOLDOWN_MS + 2_000 });
        await expect(countdown).toHaveCount(0);
        expect(await countCalls(page, 'create', ACCOUNT_GAMMA)).toBe(1);
        await scriptQr(page, ACCOUNT_GAMMA, ['waiting']);
        await retryButton(page).click();
        await expect.poll(() => countCalls(page, 'create', ACCOUNT_GAMMA)).toBe(2);
        await expectWaitingForScan(page, ACCOUNT_GAMMA);
    });

    test('[login-window] a failed QQ sign-in offers retry and diagnostics like other providers', async ({ page }) => {
        await scriptQr(page, ACCOUNT_GAMMA, ['error']);
        await GRID_DRIVER.selectProvider(page, ACCOUNT_GAMMA);
        await expect(headline(page)).toHaveText(HEADLINE.failed);
        await expect(detailsToggle(page)).toBeVisible();
        await closeLogin(page);
        await expect(loginDialog(page)).toHaveCount(0);

        await scriptQr(page, ACCOUNT_QQ, ['scanned', 'error']);
        await GRID_DRIVER.selectProvider(page, ACCOUNT_QQ);
        await expect(headline(page)).toHaveText(HEADLINE.scanned);
        await expect(headline(page)).toHaveText(HEADLINE.failed);
        await expect(retryButton(page)).toBeVisible();
        await expect(detailsToggle(page)).toBeVisible();
        // 复制 QQ 的诊断报告：换掉剪贴板写入，读回写进去的内容。
        await captureClipboard(page);
        await detailsToggle(page).click();
        await diagnosticsButton(page).click();
        await expect.poll(() => copiedText(page)).toContain('### Folia QR login diagnostics');
        expect(await copiedText(page)).toContain(`provider: ${ACCOUNT_QQ}`);

        // 重试后新会话失败同样给诊断。
        await scriptQr(page, ACCOUNT_QQ, ['error']);
        await retryButton(page).click();
        await expect.poll(() => countCalls(page, 'create', ACCOUNT_QQ)).toBe(2);
        await expect(headline(page)).toHaveText(HEADLINE.failed);
        await expect(detailsToggle(page)).toBeVisible();
    });

    test('[login-window] a failed sign-in runs the automatic check once and shows where the connection broke', async ({ page }) => {
        await setSelfCheck(page, ACCOUNT_GAMMA, 'tls-reset');
        await scriptQr(page, ACCOUNT_GAMMA, ['error']);
        await GRID_DRIVER.selectProvider(page, ACCOUNT_GAMMA);
        await expect(headline(page)).toHaveText(HEADLINE.failed);
        await expect.poll(() => countCalls(page, 'self-check', ACCOUNT_GAMMA)).toBe(1);

        // 详情一开始收着：展开之后才有自检结论、复制与反馈。
        const verdict = loginDialog(page).getByText(/The connection to the Gamma servers was cut during the encryption handshake \(probe\.example 203\.0\.113\.7 \(IPv4\): ECONNRESET\)/);
        await expect(detailsToggle(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(diagnosticsButton(page)).toHaveCount(0);
        await detailsToggle(page).click();
        await expect(loginDialog(page).getByText('Automatic check', { exact: true })).toBeVisible();
        await expect(verdict).toBeVisible();
        // 官方构建、不是一开始就失败：照常去 GitHub 反馈。
        await expect(loginDialog(page).getByRole('button', { name: 'Report on GitHub' })).toBeVisible();
        expect(await countCalls(page, 'self-check', ACCOUNT_GAMMA)).toBe(1);

        // 报告里带着同一个结论与逐层的结果。
        await captureClipboard(page);
        await diagnosticsButton(page).click();
        await expect.poll(() => copiedText(page)).toContain('verdict: tls-reset');
        const copied = await copiedText(page);
        expect(copied).toContain('v4 203.0.113.7: tcp 10ms → ECONNRESET at tls: read ECONNRESET');
        expect(copied).toContain('probe: acct-gamma diagnostics');
    });

    test('[login-window] an automatic check that fails says so', async ({ page }) => {
        await setSelfCheck(page, ACCOUNT_QQ, 'error');
        await scriptQr(page, ACCOUNT_QQ, ['error']);
        await GRID_DRIVER.selectProvider(page, ACCOUNT_QQ);
        await expect(headline(page)).toHaveText(HEADLINE.failed);
        await detailsToggle(page).click();
        await expect(loginDialog(page).getByText('The automatic check could not finish: probe: self-check unavailable')).toBeVisible();
        expect(await countCalls(page, 'self-check', ACCOUNT_QQ)).toBe(1);
    });
});

test.describe('[login-window] NetEase backend', () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, 'grid');
    });

    test('[login-window] a backend failure shows the cause and restart instead of retry; a successful restart asks for a code', async ({ page }) => {
        const serviceDown = `The local ${shortName(ACCOUNT_NETEASE)} service is not running`;
        await page.evaluate(() => window.__accountProbe!.setNeteaseBackend({
            supported: true,
            status: 'error',
            error: 'probe: xeapi key missing',
        }));

        // 只有网易带着本地服务：别的平台照常出码。
        await GRID_DRIVER.selectProvider(page, ACCOUNT_GAMMA);
        await expectWaitingForScan(page, ACCOUNT_GAMMA);
        await expect(restartButton(page)).toHaveCount(0);
        await closeLogin(page);
        await expect(loginDialog(page)).toHaveCount(0);

        await GRID_DRIVER.selectProvider(page, ACCOUNT_NETEASE);
        await expect(loginDialog(page)).toHaveAccessibleName(`Log in to ${shortName(ACCOUNT_NETEASE)}`);
        await expect(headline(page)).toHaveText(serviceDown);
        // 平台没说话时引本地服务自己的错误原话。
        await expect(loginDialog(page).getByText('probe: xeapi key missing')).toBeVisible();
        await expect(restartButton(page)).toHaveText('Restart backend');
        // 要码照常发出（后端没起来所以失败）：重试被「重启后端」换掉，诊断照样给——
        // 报告里有拉起的每一步与错误原文，重启解决不了时用户可以直接反馈。
        await expect.poll(() => countCalls(page, 'create', ACCOUNT_NETEASE)).toBe(1);
        await expect(retryButton(page)).toHaveCount(0);
        await expect(detailsToggle(page)).toBeVisible();
        await expect(qrImage(page)).toHaveCount(0);

        // 重启失败：故障留着，不要码。
        await page.evaluate(() => window.__accountProbe!.setBackendRestart('error', 300));
        await restartButton(page).click();
        await expect.poll(() => countCalls(page, 'backend-restart')).toBe(1);
        await expect(restartButton(page)).toHaveText('Restart backend');
        await expect(restartButton(page)).toBeEnabled();
        await expect(headline(page)).toHaveText(serviceDown);
        expect(await countCalls(page, 'create', ACCOUNT_NETEASE)).toBe(1);

        // 重启成功：故障消失，自动要码。
        await page.evaluate(() => window.__accountProbe!.setBackendRestart('running', 600));
        await restartButton(page).click();
        await expect(restartButton(page)).toHaveText('Restarting…');
        await expect(restartButton(page)).toBeDisabled();
        await expect.poll(() => countCalls(page, 'create', ACCOUNT_NETEASE)).toBe(2);
        await expectWaitingForScan(page, ACCOUNT_NETEASE);
        await expect(restartButton(page)).toHaveCount(0);
        await expectQrKey(page, await lastKey(page, ACCOUNT_NETEASE));
        expect(await countCalls(page, 'backend-restart')).toBe(2);
    });
});

// 登录窗口挂在首页外面（App 最外层，探针照着挂），登录会话在账户 controller 里（宿主持有，换 suite 不重建）：
// 换 suite 只换首页，窗口与会话都留着。TUI 没有自己的登录框；切换不先问，哪个 suite 都不出确认框。
test.describe('[switch] grid and TUI share the login window', () => {
    test.beforeEach(async ({ page, mount }) => {
        await mountAccount(mount, page, 'grid');
    });

    test('[switch] with the TUI selected, the shared login window answers a sign-in, and switches ask nothing', async ({ page }) => {
        await setSuite(page, 'tui');
        await expect(switcher(page)).toHaveCount(0);

        // 登录：TUI 的平台列表打开共用的登录窗口（有平台那一列，不是 TUI 自己的登录框），扫码确认后直接切到登录的平台。
        await scriptQr(page, ACCOUNT_GAMMA, ['scanned', 'confirmed']);
        await TUI_DRIVER.selectProvider(page, ACCOUNT_GAMMA);
        await expect(loginDialog(page)).toBeVisible();
        await expect(platformRow(page, ACCOUNT_GAMMA)).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-tui-account-login]')).toHaveCount(0);
        await expect(loginDialog(page)).toHaveAccessibleName(`Log in to ${shortName(ACCOUNT_GAMMA)}`);
        await expectQrKey(page, await lastKey(page, ACCOUNT_GAMMA));
        await expect(headline(page)).toHaveText(HEADLINE.scanned);
        await expectSwitchedWithoutAsking(page, ACCOUNT_GAMMA);
        await expect(loginDialog(page)).toHaveCount(0);
        expect((await calls(page, 'switch-cleanup')).map(call => call.providerId)).toEqual([ACCOUNT_GAMMA]);
        expect(await accountStatus(page, ACCOUNT_GAMMA)).toBe('authenticated');

        // 切换（直接调 controller）：不问，直接切过去，离开旧平台一次。
        await requestSwitch(page, ACCOUNT_ALPHA);
        await expect.poll(() => switchResult(page)).toBe('switched');
        await expectSwitchedWithoutAsking(page, ACCOUNT_ALPHA);
        expect((await calls(page, 'switch-cleanup')).map(call => call.providerId)).toEqual([ACCOUNT_GAMMA, ACCOUNT_ALPHA]);
        await expect(tuiHome(page)).toBeVisible();
    });

    test('[switch] a sign-in started on the grid keeps its window and session in the TUI and completes there', async ({ page }) => {
        await GRID_DRIVER.selectProvider(page, ACCOUNT_GAMMA);
        await expect(loginDialog(page)).toBeVisible();
        await expect.poll(() => countCalls(page, 'create', ACCOUNT_GAMMA)).toBe(1);
        const key = await lastKey(page, ACCOUNT_GAMMA);
        await expectQrKey(page, key);

        // 换到 TUI：网格首页卸载，登录窗口留着，还是同一个二维码会话，不取消、不重新要码。
        await setSuite(page, 'tui');
        await expect(switcher(page)).toHaveCount(0);
        await expect(platformRow(page, ACCOUNT_GAMMA)).toHaveAttribute('aria-selected', 'true');
        await expectQrKey(page, key);
        expect(await countCalls(page, 'cancel', ACCOUNT_GAMMA)).toBe(0);
        expect(await countCalls(page, 'create', ACCOUNT_GAMMA)).toBe(1);

        // 回到网格：会话仍是同一个。
        await setSuite(page, 'grid');
        await expect(loginDialog(page)).toBeVisible();
        await expectQrKey(page, key);
        expect(await countCalls(page, 'cancel', ACCOUNT_GAMMA)).toBe(0);

        // 再到 TUI 扫码确认：直接切到登录的平台；整个过程只有一次要码、没有取消。
        await setSuite(page, 'tui');
        await expectQrKey(page, key);
        await scriptQr(page, ACCOUNT_GAMMA, ['confirmed']);
        await expectSwitchedWithoutAsking(page, ACCOUNT_GAMMA);
        await expect(loginDialog(page)).toHaveCount(0);
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
