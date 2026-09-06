// 临时验证脚本：挂 playerBottomBar 探针后 hover 胶囊触发展开态，
// 截取播放/暂停玻璃按钮局部。用法: node dev/glass-play-button-check.mjs <输出前缀>
import { chromium } from 'playwright';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const prefix = process.argv[2] || '/tmp/play-button';
const browser = await chromium.launch({
    executablePath: '/Users/nero/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:3000/dev-probe.html?probe=playerBottomBar', { waitUntil: 'networkidle' });
await wait(1200);
await page.evaluate(() => {
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
// hover 胶囊触发展开态动画，等弹簧落定
await page.hover('div[style*="liquid-glass"]');
await wait(1500);
const targets = await page.evaluate(() => {
    const els = [];
    // 播放按钮不再嵌套玻璃滤镜（会渲染成黑块），按"胶囊内第一个圆形按钮"定位
    const pill = document.querySelector('div[style*="liquid-glass"]');
    if (pill) {
        const btn = pill.querySelector('button');
        if (btn) {
            const r = btn.getBoundingClientRect();
            if (r.width > 0) els.push({ x: r.x, y: r.y, w: r.width, h: r.height });
        }
    }
    return els;
});
console.log('glass buttons:', JSON.stringify(targets));
for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const pad = 24;
    await page.screenshot({
        path: `${prefix}-${i}.png`,
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
