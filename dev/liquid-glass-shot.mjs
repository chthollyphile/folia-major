// 液态玻璃滤镜截图对比工具：挂 playerBottomBar 探针，注入彩色条纹背景后
// 截取所有玻璃表面（backdrop-filter 含 liquid-glass 的元素）局部。
// 用法: node dev/liquid-glass-shot.mjs <输出目录前缀>
import { chromium } from 'playwright';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const prefix = process.argv[2] || '/tmp/glass-shot';
const browser = await chromium.launch({
    // 本机缓存只有 1223 版，绕开 playwright 包的版本校验
    executablePath: '/Users/nero/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:3000/dev-probe.html?probe=playerBottomBar', { waitUntil: 'networkidle' });
await wait(1200);
await page.evaluate(() => {
    // 条纹 + 渐变层垫在玻璃下，折射弯曲和高光都可见
    const layer = document.createElement('div');
    layer.id = 'glass-stripe-probe';
    layer.style.cssText = `
        position: fixed; inset: 0; z-index: 5; pointer-events: none;
        background:
            repeating-linear-gradient(0deg, #e33 0 14px, #fff 14px 28px, #33e 28px 42px, #ff0 42px 56px),
            radial-gradient(circle at 30% 40%, #0f0, transparent 60%);
    `;
    document.body.appendChild(layer);
});
await wait(600);
const targets = await page.evaluate(() => {
    const els = [];
    for (const el of document.querySelectorAll('*')) {
        const bf = el instanceof HTMLElement ? el.style.backdropFilter || getComputedStyle(el).backdropFilter : '';
        if (bf && bf.includes('liquid-glass')) {
            const r = el.getBoundingClientRect();
            if (r.width > 0) els.push({ x: r.x, y: r.y, w: r.width, h: r.height });
        }
    }
    return els;
});
console.log('glass surfaces:', JSON.stringify(targets));
let i = 0;
for (const t of targets) {
    i += 1;
    const pad = 30;
    await page.screenshot({
        path: `${prefix}-surface${i}.png`,
        clip: {
            x: Math.max(0, t.x - pad),
            y: Math.max(0, t.y - pad),
            width: Math.min(1280, t.w + pad * 2),
            height: Math.min(800, t.h + pad * 2),
        },
    });
}
await page.screenshot({ path: `${prefix}-full.png` });
await browser.close();
process.exit(0);
