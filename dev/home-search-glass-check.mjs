// 首页搜索框液态玻璃的局部截图：打开真实首页路由，关掉欢迎弹窗，
// 把条纹层垫进玻璃表面所在的 stacking context（`absolute inset-0 z-10` 包装层的
// 第一个子节点）后截取 backdrop-filter 含 liquid-glass 的搜索表单区域。
// 注意不能把条纹挂在 body 上：首页应用根是 fixed 容器，body 层的正 z-index
// 条纹会盖在应用内容上面，玻璃效果被遮住、截图全是最原始的条纹。
// 用法: node dev/home-search-glass-check.mjs <输出路径前缀>
import { chromium } from 'playwright';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const prefix = process.argv[2] || '/tmp/home-search-glass';
const browser = await chromium.launch({
    // headless shell 的 backdrop url() 合成有缺陷，必须用完整 Chromium
    executablePath: '/Users/nero/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
await wait(1500);
for (const label of ['我知道了', '知道了']) {
    const btn = page.getByText(label, { exact: false }).first();
    if (await btn.count() > 0) { await btn.click().catch(() => {}); break; }
}
await wait(400);
await page.evaluate(() => {
    const layer = document.createElement('div');
    layer.style.cssText = `position: absolute; inset: 0; pointer-events: none;
        background: repeating-linear-gradient(0deg, #e33 0 10px, #fff 10px 20px, #33e 20px 30px, #ff0 30px 40px);`;
    const host = [...document.querySelectorAll('div')].find(el => el.className === 'absolute inset-0 z-10');
    if (host) host.insertBefore(layer, host.firstChild);
});
await wait(600);
const targets = await page.evaluate(() => {
    const els = [];
    for (const el of document.querySelectorAll('form')) {
        const bf = el.style.backdropFilter || getComputedStyle(el).backdropFilter;
        if (bf && bf.includes('liquid-glass')) {
            const r = el.getBoundingClientRect();
            if (r.width > 0) els.push({ x: r.x, y: r.y, w: r.width, h: r.height });
        }
    }
    return els;
});
console.log('glass search forms:', JSON.stringify(targets));
let i = 0;
for (const t of targets) {
    i += 1;
    const pad = 40;
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
process.exit(targets.length > 0 ? 0 : 1);
