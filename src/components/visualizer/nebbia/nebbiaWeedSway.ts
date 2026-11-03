// src/components/visualizer/nebbia/nebbiaWeedSway.ts
// 舞潮踏拍的水草一项（nebbiaAquarium.ts 每帧调）：水草梢的横向偏移是一个欠阻尼的弹簧，每拍推一下（左右交替），
// 摇过去再弹回来、慢慢停。每拍直接换成新的摆动速度，不和上一下叠加（反着叠会互相抵掉、那一拍看不出），位置照旧连续，不会跳。着色器从根到梢按高度取弹簧前 0–0.15 秒的位置，
// 梢比根晚到，看起来是一道从根往上传的波；所以这里留着最近 0.15 秒每 1/120 秒的位置。

/** 弹簧：约每秒摆 2 下，阻尼比 0.3。 */
const OMEGA = 2 * Math.PI * 2;
const DAMP = 2 * 0.3 * OMEGA;
/** 推一下给的速度：一下满力的推，最大偏到约 ±1。 */
const KICK_V = OMEGA * 1.25;
const STEP = 1 / 120;
/** 历史：着色器取现在、0.05、0.1、0.15 秒前（每隔 SPACING 步）。 */
const SPACING = 6;
const HISTORY = SPACING * 3 + 1;

export class NebbiaWeedSway {
    private x = 0;
    private v = 0;
    private side = 1;
    private carry = 0;
    private readonly history = new Float32Array(HISTORY);
    private head = 0;

    /** 推一下：amount 是这一拍的力度乘强度（0..2）。 */
    kick(amount: number) {
        this.side = -this.side;
        this.v = this.side * amount * KICK_V;
    }

    /** 走 dt 秒（暂停时 0），把现在、0.05、0.1、0.15 秒前的位置写进 out。 */
    step(dt: number, out: Float32Array) {
        this.carry += Math.min(dt, 0.1);
        while (this.carry >= STEP) {
            this.carry -= STEP;
            this.v += (-OMEGA * OMEGA * this.x - DAMP * this.v) * STEP;
            this.x += this.v * STEP;
            this.head = (this.head + 1) % HISTORY;
            this.history[this.head] = this.x;
        }
        for (let k = 0; k < 4; k += 1) out[k] = this.history[(this.head - k * SPACING + HISTORY * 2) % HISTORY];
    }
}
