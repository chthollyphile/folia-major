// 在真实 Electron Chromium 上 A/B:完整链 vs rim-only,并截真实胶囊
import { chromium } from 'playwright';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages().find(p => p.url().startsWith('http://localhost:3000'));
await page.bringToFront();
await page.goto('http://localhost:3000/dev-probe.html?probe=playerBottomBar', { waitUntil: 'networkidle' });
await wait(1500);
// A/B 合成用例(深色底)
const abResult = await page.evaluate(async () => {
  const src = document.querySelector('filter');
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, parent) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); if (parent) parent.appendChild(el); return el; };
  const svg = mk('svg', { width: 0, height: 0 }, document.body);
  const href = src ? src.querySelector('feImage').getAttribute('href') : null;
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;width:900px;height:400px;background:#111;z-index:99';
  document.body.appendChild(host);
  if (!href) { host.textContent = 'no glass filter on page'; return { noFilter: true }; }
  const mkCommon = (f) => {
    mk('feImage', { href, x: 0, y: 0, width: 300, height: 60, preserveAspectRatio: 'none', result: 'map' }, f);
    mk('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: 24, xChannelSelector: 'R', yChannelSelector: 'G', result: 'displaced' }, f);
    mk('feGaussianBlur', { in: 'displaced', stdDeviation: 1, result: 'blurred' }, f);
    mk('feColorMatrix', { in: 'blurred', type: 'saturate', values: 1.6, result: 'toned' }, f);
    mk('feColorMatrix', { in: 'map', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0', result: 'bump' }, f);
    mk('feColorMatrix', { in: 'map', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 -1 1 0', result: 'rimMask' }, f);
    const spec = mk('feSpecularLighting', { in: 'bump', surfaceScale: 3, specularConstant: 3, specularExponent: 12, 'lighting-color': '#fff', result: 'rimSpec' }, f);
    mk('feDistantLight', { azimuth: 225, elevation: 60 }, spec);
    mk('feComposite', { in: 'rimSpec', in2: 'rimMask', operator: 'in', result: 'rimDirectional' }, f);
    mk('feComponentTransfer', { in: 'rimMask', result: 'rimRingMask' }, f).appendChild(mk('feFuncA', { type: 'gamma', amplitude: 1, exponent: 2, offset: 0 }));
    mk('feFlood', { 'flood-color': '#fff', 'flood-opacity': 0.9, result: 'rimFlood' }, f);
    mk('feComposite', { in: 'rimFlood', in2: 'rimRingMask', operator: 'in', result: 'rimRing' }, f);
  };
  const f1 = mk('filter', { id: 'abE', filterUnits: 'userSpaceOnUse', x: -20, y: -20, width: 340, height: 100, colorInterpolationFilters: 'sRGB' }, svg);
  mkCommon(f1);
  mk('feComposite', { in: 'rimRing', in2: 'rimDirectional', operator: 'over', result: 'rimAll' }, f1);
  mk('feComposite', { in: 'rimAll', in2: 'toned', operator: 'over' }, f1);
  const t1 = document.createElement('div');
  t1.style.cssText = 'position:absolute;left:20px;top:20px;width:300px;height:60px;border-radius:30px;backdrop-filter:url(#abE);background:rgba(0,0,0,0.15)';
  host.appendChild(t1);
  const f2 = mk('filter', { id: 'abF', filterUnits: 'userSpaceOnUse', x: -20, y: -20, width: 340, height: 100, colorInterpolationFilters: 'sRGB' }, svg);
  mkCommon(f2);
  mk('feComposite', { in: 'rimRing', in2: 'rimDirectional', operator: 'over' }, f2);
  const t2 = document.createElement('div');
  t2.style.cssText = 'position:absolute;left:20px;top:160px;width:300px;height:60px;border-radius:30px;backdrop-filter:url(#abF);background:rgba(0,0,0,0.15)';
  host.appendChild(t2);
  return { ok: true };
});
console.log('AB setup:', JSON.stringify(abResult));
await wait(800);
await page.screenshot({ path: '/tmp/electron-ab.png', clip: { x: 0, y: 0, width: 380, height: 260 } });
// 清掉 A/B 层,截真实胶囊完整链(当前代码 = feComposite 版,boost 参数)
await page.evaluate(() => { document.querySelector('div[style*="z-index:99"]')?.remove(); });
await wait(300);
await page.evaluate(() => {
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;z-index:5;pointer-events:none;background:repeating-linear-gradient(0deg,#e33 0 14px,#fff 14px 28px,#33e 28px 42px,#ff0 42px 56px)';
  document.body.appendChild(layer);
});
await wait(500);
const pr = await page.evaluate(() => {
  const pill = [...document.querySelectorAll('*')].find(el => {
    const bf = el instanceof HTMLElement ? el.style.backdropFilter : '';
    return bf && bf.includes('liquid-glass');
  });
  const r = pill.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.screenshot({ path: '/tmp/electron-pill.png', clip: { x: pr.x - 24, y: pr.y - 24, width: pr.w + 48, height: pr.h + 48 } });
await browser.close();
