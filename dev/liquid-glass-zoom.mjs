import { chromium } from 'playwright';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const out = process.argv[2];
const browser = await chromium.launch({ executablePath: '/Users/nero/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 3 });
await page.goto('http://localhost:3000/dev-probe.html?probe=playerBottomBar', { waitUntil: 'networkidle' });
await wait(1200);
await page.evaluate(() => {
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;z-index:5;pointer-events:none;background:repeating-linear-gradient(0deg,#e33 0 14px,#fff 14px 28px,#33e 28px 42px,#ff0 42px 56px)';
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
console.log('targets:', targets.length);
const pad = 16;
const t = targets[0];
await page.screenshot({ path: out, clip: { x: t.x - pad, y: t.y - pad, width: t.w + pad*2, height: t.h + pad*2 } });
await browser.close();
