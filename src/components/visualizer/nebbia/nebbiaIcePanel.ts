import { iceParams, iceStats } from './nebbiaSnowWater';

// src/components/visualizer/nebbia/nebbiaIcePanel.ts
// 水珠结冰原型的滑块面板：右上角一块，改 iceParams（nebbiaSnowWater.ts）。只给原型用，不进设置。

type NumKey = Exclude<keyof typeof iceParams, 'off' | 'spawnBig'>;
const SLIDERS: [NumKey, string, number, number, number][] = [
    ['freezeAfter', '停多久开始冻（秒）', 1, 60, 0.5],
    ['freezeDur', '多久冻透（秒）', 2, 90, 1],
    ['slide', '往下挪的速度', 1, 60, 0.5],
    ['minR', '多大的水珠才冻', 1, 12, 0.5],
    ['grow', '冻的时候挂霜长大（倍）', 1, 4, 0.1],
    ['spinR', '多大的冰珠滑时转', 2, 20, 0.5],
    ['spin', '转的幅度（弧度）', 0, 1.2, 0.05],
];

/** 挂上面板，返回卸掉它的函数。 */
export const mountIcePanel = () => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:56px;right:16px;z-index:99999;background:rgba(10,12,16,.82);color:#dde;font:12px/1.5 system-ui;'
        + 'padding:10px 12px;border-radius:8px;width:230px;-webkit-app-region:no-drag;pointer-events:auto';
    box.innerHTML = '<div style="font-weight:600;margin-bottom:6px">水珠结冰（原型）</div>';
    for (const [key, label, min, max, step] of SLIDERS) {
        const row = document.createElement('label');
        row.style.cssText = 'display:block;margin:4px 0';
        const value = document.createElement('span');
        value.style.float = 'right';
        const input = document.createElement('input');
        Object.assign(input, { type: 'range', min, max, step, value: String(iceParams[key]) });
        input.style.width = '100%';
        input.dataset.ice = key;
        const show = () => { value.textContent = String(+input.value); };
        input.oninput = () => { iceParams[key] = +input.value; show(); };
        show();
        row.append(label, value, input);
        box.append(row);
    }
    const off = document.createElement('button');
    const showOff = () => { off.textContent = iceParams.off ? '打开结冰' : '关掉对比'; };
    off.onclick = () => { iceParams.off = !iceParams.off; showOff(); };
    showOff();
    const big = document.createElement('button');
    big.textContent = '放一颗大冰珠';
    big.style.marginLeft = '8px';
    big.onclick = () => { iceParams.spawnBig += 1; };
    box.append(off, big);
    const stats = document.createElement('div');
    stats.style.cssText = 'margin-top:6px;opacity:.75';
    stats.dataset.iceStats = '';
    box.append(stats);
    (window as unknown as { __iceStats: typeof iceStats }).__iceStats = iceStats;
    const timer = setInterval(() => {
        stats.textContent = `水珠 ${iceStats.drops}，在冻 ${iceStats.freezing}，在滑 ${iceStats.sliding}，最大半径 ${iceStats.maxR.toFixed(1)}`;
    }, 500);
    document.body.append(box);
    return () => { clearInterval(timer); box.remove(); };
};
