import { expect, test } from './fixtures';
// test/component/liquidGlass.spec.ts

// 液态玻璃滤镜的回归保护，两层防线：
// 1. DOM 断言钉滤镜链结构——rim/色散/总开关各自该产出哪些 primitive，引擎无关、结果稳定；
// 2. 一张像素基线钉「折射弯曲 + 底色 + 高光」的整体观感。
//
// 像素基线的边界：backdrop-filter 的合成行为跟 Chromium 版本走（旧 headless 有
// feComposite/feMerge 合成缺陷，rim 层在无头引擎上可能缺失），基线在 macOS 无头
// Chromium 上生成，跨平台/跨引擎跑大概率要重建基线；结构层断言不受此影响。
// 条纹层是确定性 CSS，玻璃底下内容（探针的静态时间、固定文案）不随时间走。

const GLASS_FILTER = 'filter[id^="liquid-glass-"]';
/** 玻璃表面的 backdrop-filter 是 inline style，能直接当选择器用 */
const GLASS_PILL = 'div[style*="liquid-glass"]';

async function injectStripes(page: import('@playwright/test').Page) {
    // 彩色条纹垫在玻璃下，折射弯曲在像素基线里才可见
    await page.evaluate(() => {
        const layer = document.createElement('div');
        layer.id = 'glass-stripe-probe';
        layer.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:5', 'pointer-events:none',
            'background:repeating-linear-gradient(0deg,#e33 0 14px,#fff 14px 28px,#33e 28px 42px,#ff0 42px 56px)',
        ].join(';');
        document.body.appendChild(layer);
    });
}

test.describe('滤镜链结构', () => {
    test('默认配置产出 rim 高光 + 底边内阴影', async ({ mount, page }) => {
        await mount('playerBottomBar');
        const filter = page.locator(GLASS_FILTER).first();
        await expect(filter).toBeAttached();
        // 位移贴图铺满边框盒
        await expect(filter.locator('feImage')).toHaveAttribute('preserveAspectRatio', 'none');
        // 两盏光：左上方向高光 + 正下内阴影；白描边 + 黑阴影
        await expect(filter.locator('feSpecularLighting')).toHaveCount(2);
        await expect(filter.locator('feFlood')).toHaveCount(2);
        await expect(filter.locator('feComponentTransfer')).toHaveCount(1);
        // 色散默认关闭 → 单路位移；feBlend 仅 rim 内阴影的 multiply ×1
        await expect(filter.locator('feDisplacementMap')).toHaveCount(1);
        await expect(filter.locator('feBlend')).toHaveCount(1);
        // 采样区 userSpaceOnUse 按 px 外扩，x/y 为负
        expect(Number(await filter.getAttribute('x'))).toBeLessThan(0);
        expect(Number(await filter.getAttribute('y'))).toBeLessThan(0);
        // 玻璃表面真的挂上了滤镜
        await expect(page.locator(GLASS_PILL).first()).toBeVisible();
    });

    test('rimIntensity=0 时不产出 rim 段，折射模糊保留', async ({ mount, page }) => {
        // seed 必须走 addInitScript 且在 fixtures 的种子之后（auto fixture 先注册先执行）；
        // dispersion 一并关掉，排除色散 screen 合并的 feBlend 干扰
        await page.addInitScript(([key]) => {
            localStorage.setItem(key, JSON.stringify({ rimIntensity: 0, dispersion: false }));
        }, ['liquid_glass_tuning'] as const);
        await mount('playerBottomBar');
        const filter = page.locator(GLASS_FILTER).first();
        await expect(filter).toBeAttached();
        await expect(filter.locator('feSpecularLighting')).toHaveCount(0);
        await expect(filter.locator('feFlood')).toHaveCount(0);
        await expect(filter.locator('feBlend')).toHaveCount(0);
        // 位移与饱和仍在
        await expect(filter.locator('feDisplacementMap')).toHaveCount(1);
        await expect(page.locator(GLASS_PILL).first()).toBeVisible();
    });

    test('dispersion 显式关闭时走单路位移', async ({ mount, page }) => {
        await page.addInitScript(([key]) => {
            localStorage.setItem(key, JSON.stringify({ dispersion: false }));
        }, ['liquid_glass_tuning'] as const);
        await mount('playerBottomBar');
        const filter = page.locator(GLASS_FILTER).first();
        await expect(filter).toBeAttached();
        await expect(filter.locator('feDisplacementMap')).toHaveCount(1);
        // 仅剩 rim 内阴影的 multiply
        await expect(filter.locator('feBlend')).toHaveCount(1);
    });

    test('总开关关闭时完全回退普通毛玻璃', async ({ mount, page }) => {
        await page.addInitScript(([key]) => {
            localStorage.setItem(key, JSON.stringify({ enabled: false }));
        }, ['liquid_glass_tuning'] as const);
        await mount('playerBottomBar');
        await expect(page.locator(GLASS_FILTER)).toHaveCount(0);
        await expect(page.locator(GLASS_PILL)).toHaveCount(0);
    });
});

test('像素基线：胶囊玻璃在条纹层上的折射观感', async ({ mount, page }) => {
    await mount('playerBottomBar');
    const pill = page.locator(GLASS_PILL).first();
    await expect(pill).toBeVisible();
    // 进场动画落定
    await page.waitForTimeout(1500);
    await injectStripes(page);
    await page.waitForTimeout(400);

    const box = (await pill.boundingBox())!;
    const pad = 30;
    await expect(page).toHaveScreenshot('liquid-glass-pill.png', {
        clip: {
            x: Math.max(0, box.x - pad),
            y: Math.max(0, box.y - pad),
            width: box.width + pad * 2,
            height: box.height + pad * 2,
        },
    });
});
