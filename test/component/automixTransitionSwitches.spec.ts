import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
// test/component/automixTransitionSwitches.spec.ts

// 一次混音的两个画法各有一个开关：屏幕正中的圆环、卡片边框上的描边。这一组钉的是「两个开关
// 互不相干」，以及它下面那条机制——广播只是叫一声，正在跑的那次记在模块里，谁要画自己去问。
//
// 三条用例对应三个真出过的毛病：只拨圆环那个开关什么都不出（圆环是被开关挂上来的，广播发出去
// 的时候它还不存在）、混音中途关掉描边开关它照样画完剩下的十几秒、中途拨上开关的那个从零重跑
// 一条和音频对不上的进度。

/** mount fixture 的结构类型：少声明的形参和更窄的返回值都能接上真实签名。 */
type Mount = (story: string) => Promise<Locator>;

const ring = (page: Page) => page.locator('div.fixed.inset-0.z-\\[170\\]');
const border = (page: Page) => page.locator('canvas');

/**
 * 两个开关都记在 localStorage 里，上一条用例留下的值会串进来，所以每次挂载前都写死初值。
 *
 * 走 addInitScript 而不是挂载后 evaluate + reload：开关是在模块 import 时读的，挂载完再写
 * 已经晚了一步。fixtures 里的种子脚本会先 localStorage.clear()，这条排在它之后才有意义。
 */
const open = async (page: Page, mount: Mount) => {
    await page.addInitScript(() => {
        localStorage.setItem('folia_transition_animation', 'false');
        localStorage.setItem('folia_transition_animation_card', 'false');
    });
    await mount('automixTransitionSwitches');
    await expect(page.locator('[data-probe-action="cue"]')).toBeVisible();
};

// 设置页是在同一个 click 里先写开关、下一行就广播预览，而 React 要等这次事件结束才提交，圆环
// 的懒加载 chunk 还得再晚一步。所以那条广播它必然收不到——拨上开关什么都不出，直到下一次广播
// （比如再去拨另一个开关）才一起冒出来，读起来就是两个开关耦在一起。
test('只拨圆环那个开关，圆环自己就演示一次', async ({ mount, page }) => {
    await open(page, mount);
    await expect(ring(page)).toHaveCount(0);

    await page.click('[data-probe-action="ring-switch"]');
    await expect(ring(page)).toBeVisible({ timeout: 10_000 });
    // 另一个开关没动，描边就不该出来
    await expect(border(page)).toHaveCount(0);
});

// 开关得是活的。只在 cue 到达那一刻读一次的写法下，混音跑到一半把它关掉，描边会自顾自画完剩下
// 的十几秒，卡片也被一起按住不退场——而圆环那边关开关是直接卸载、立刻停。
test('混音中途关掉描边开关，描边立刻停', async ({ mount, page }) => {
    await open(page, mount);

    await page.click('[data-probe-action="card-switch"]');
    await expect(border(page)).toBeVisible({ timeout: 10_000 });

    // 这次演示有十秒，远没跑完
    await page.click('[data-probe-action="card-switch"]');
    await expect(border(page)).toHaveCount(0, { timeout: 3_000 });
});

// 中途接手要从当前进度起步：这两个画法都是这次混音的钟，从零重跑会把进度放到音频不在的位置上，
// 而且会一直画到真混音结束之后。
for (const [name, which] of [['圆环', 'ring'], ['描边', 'card']] as const) {
    test(`混音跑到一半才拨上开关，${name}接着当前进度画完就走`, async ({ mount, page }) => {
        await open(page, mount);

        // 十秒的真混音，开关还关着
        await page.click('[data-probe-action="cue"]');
        await page.waitForTimeout(4000);
        const drawn = which === 'ring' ? ring(page) : border(page);
        await expect(drawn).toHaveCount(0);

        // 只点这一下：圆环任意左键点击就退场，多点一次就看不到要量的东西了
        await page.click(`[data-probe-action="${which}-switch"]`);
        await expect(drawn).toBeVisible({ timeout: 10_000 });

        // 混音在第 10 秒结束。从零重跑的话这时候还在画。
        await page.waitForTimeout(8000);
        await expect(drawn).toHaveCount(0);
    });
}

// 用户报的那一条：圆环开着的状态下去拨卡片那个开关，圆环又演示了一遍。广播是发给所有人的，
// 而演示只欠拨开关的那一个——没有收件人的时候，碰巧开着的那个就会跟着重放。
// 先等圆环自己那次演示走完再拨，否则看到的是「点击让圆环退场」那条既有规则，不是重放。
test('圆环开着时拨卡片开关，圆环不会重来一遍', async ({ mount, page }) => {
    await open(page, mount);

    await page.click('[data-probe-action="ring-switch"]');
    await expect(ring(page)).toBeVisible({ timeout: 10_000 });

    // 演示十秒，加上退场；等它彻底走完
    await expect(ring(page)).toHaveCount(0, { timeout: 15_000 });

    await page.click('[data-probe-action="card-switch"]');
    await expect(border(page)).toBeVisible({ timeout: 10_000 });
    await expect(ring(page)).toHaveCount(0);
    // 再看几秒，确认不是慢一拍才冒出来
    await page.waitForTimeout(2000);
    await expect(ring(page)).toHaveCount(0);
});

// 反过来那一半：描边正在画的时候拨圆环的开关，描边不能被打断。模块里只记得住最后广播的
// 那一条，所以「不是写给我的」必须是「维持原样」，不能当成「结束了」。
test('描边正在画时拨圆环开关，描边不被打断', async ({ mount, page }) => {
    await open(page, mount);

    await page.click('[data-probe-action="card-switch"]');
    await expect(border(page)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(2000);

    await page.click('[data-probe-action="ring-switch"]');
    await expect(ring(page)).toBeVisible({ timeout: 10_000 });
    await expect(border(page)).toBeVisible();
    await page.waitForTimeout(2000);
    await expect(border(page)).toBeVisible();
});

// 忽略别人的演示不能压过自己的关闭状态：描边在画时拨开圆环，active 会暂时记成圆环演示；
// 这时再关描边，旧实现会先走“圆环演示不关我的事”分支，把旧描边原样留到十秒结束。
test('圆环演示期间关掉描边开关，描边仍然立刻停', async ({ mount, page }) => {
    await open(page, mount);

    await page.click('[data-probe-action="card-switch"]');
    await expect(border(page)).toBeVisible({ timeout: 10_000 });

    await page.click('[data-probe-action="ring-switch"]');
    await expect(ring(page)).toBeVisible({ timeout: 10_000 });
    await expect(border(page)).toBeVisible();

    await page.click('[data-probe-action="card-switch"]');
    await expect(page.locator('[data-probe-action="card-switch"]')).toHaveAttribute('data-probe-card', 'off');
    await expect(border(page)).toHaveCount(0, { timeout: 3_000 });
});
