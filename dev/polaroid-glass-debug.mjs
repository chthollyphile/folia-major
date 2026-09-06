// 回首页后扫描右下角可点击元素
import { chromium } from 'playwright';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()[0];
await page.bringToFront();
await wait(2500);
const onPlayer = await page.evaluate(() => location.hash.includes('player'));
if (onPlayer) {
    await page.mouse.move(60, 60);
    await wait(600);
    await page.mouse.click(44, 44);
    await wait(1500);
}
const result = await page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const hits = [];
    for (const el of document.querySelectorAll('button, [role="button"], a')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > vw - 280 && r.bottom > vh - 220) {
            hits.push({
                cls: String(el.className).slice(0, 110),
                title: el.getAttribute('title') || el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 24),
                rect: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) },
            });
        }
    }
    return { hash: location.hash, vw, vh, hits };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(0);
