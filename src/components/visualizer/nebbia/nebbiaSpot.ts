import { clamp, smooth } from './nebbiaConstants';
import type { LaidChar, LaidLine } from './nebbiaScene';

// src/components/visualizer/nebbia/nebbiaSpot.ts
// 聚光灯：远处楼底下两盏（左右对称）打向正在写的字，强调色；这句写完（且唱完）0.8 秒后慢慢熄灭。
// 目标点沿着字连续移动（写第 i 个字的过程中从第 i 个字滑向第 i+1 个字），用临界阻尼弹簧去追，速度也连续；
// 播放时间是一跳一跳更新的，用自己平滑过的时钟。每换一个字就瞬移目标、一阶指数追，快歌里会一抽一抽。

// 一个字开始出现的时刻：手指书写按 c.wt（和 nebbiaInk.ts 的 drawChar 一致，写字节奏不跟每个字唱的那一点），慢慢显现的按 c.t
const startOf = (c: LaidChar) => (c.appearDur > 0 ? c.t : c.wt);
// 一个字出现完的时刻：写完，或显现完
const doneOf = (c: LaidChar) => startOf(c) + (c.appearDur > 0 ? c.appearDur : c.wd);
// 一句全部出现完的时刻，不早于唱完；排版定了就不变，按句缓存（重排出来的是新对象）
const doneAt = new WeakMap<LaidLine, number>();
const lineDoneOf = (line: LaidLine) => {
    let end = doneAt.get(line);
    if (end === undefined) {
        end = line.end;
        for (const c of line.chars) if (c.glyph) end = Math.max(end, doneOf(c));
        doneAt.set(line, end);
    }
    return end;
};

// 当前正在写的字，以及同一句里它后面的下一个字。两句同时在写（上一句还没写完、下一句已开写）时只跟后一句，
// 不在两句之间来回跳；一句里取最晚开始出现的那个字
const currentWritingChar = (laid: LaidLine[], T: number): { c: LaidChar; next: LaidChar | null } | null => {
    for (let li = laid.length - 1; li >= 0; li -= 1) {
        const line = laid[li];
        // 一句可以一直写到下一句开唱（片尾歌手还要等曲名写完），按写完的时刻熄灯，不按唱完
        if (T < line.t - 0.05 || T > lineDoneOf(line) + 0.8) continue;
        let k = -1;
        line.chars.forEach((c, i) => { if (c.glyph && startOf(c) <= T && (k < 0 || startOf(c) >= startOf(line.chars[k]))) k = i; });
        if (k < 0) continue;
        let next: LaidChar | null = null;
        for (let i = k + 1; i < line.chars.length && !next; i += 1) if (line.chars[i].glyph) next = line.chars[i];
        return { c: line.chars[k], next };
    }
    return null;
};

export class NebbiaSpot {
    x = 0; y = 0; r = 0; i = 0;
    private vx = 0; private vy = 0; private vr = 0;
    private t = 0;
    private init = false;

    /** 一帧：T 是播放时间，dt 是真实流逝的秒数（暂停时 0）。 */
    update(laid: LaidLine[], T: number, dt: number) {
        // 平滑时钟：离播放时间太远（拖进度、暂停）就直接对齐，否则慢慢往播放时间靠
        this.t += dt;
        if (Math.abs(T - this.t) > 0.25 || dt === 0) this.t = T;
        else this.t += (T - this.t) * (1 - Math.exp(-dt / 0.3));
        const cur = currentWritingChar(laid, this.t);
        if (cur) {
            const { c, next } = cur;
            const u = next ? smooth(clamp((this.t - startOf(c)) / Math.max(0.05, startOf(next) - startOf(c)))) : 0;
            const gx = next ? c.x + (next.x - c.x) * u : c.x, gy = next ? c.y + (next.y - c.y) * u : c.y, gr = next ? c.s + (next.s - c.s) * u : c.s;
            if (!this.init || dt === 0) {
                this.x = gx; this.y = gy; this.r = gr;
                this.vx = this.vy = this.vr = 0;
                this.init = true;
            }
            // 临界阻尼弹簧，分几步积分保证稳定；时间常数约 0.1 秒
            const w = 1 / 0.1, n = Math.ceil(dt / 0.008);
            for (let j = 0; j < n; j += 1) {
                const h = dt / n;
                this.vx += (w * w * (gx - this.x) - 2 * w * this.vx) * h; this.x += this.vx * h;
                this.vy += (w * w * (gy - this.y) - 2 * w * this.vy) * h; this.y += this.vy * h;
                this.vr += (w * w * (gr - this.r) - 2 * w * this.vr) * h; this.r += this.vr * h;
            }
        }
        if (dt === 0) this.i = cur ? 1 : 0;
        else this.i += ((cur ? 1 : 0) - this.i) * (1 - Math.exp(-dt / (cur ? 0.15 : 0.5)));
    }

    reset() {
        this.init = false;
        this.i = 0;
    }
}
