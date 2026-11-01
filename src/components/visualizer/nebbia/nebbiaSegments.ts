// src/components/visualizer/nebbia/nebbiaSegments.ts
// 擦痕遮罩的线段收集器：用法照 2D 画布（setTransform、moveTo / lineTo、stroke），但不光栅化，
// 只把每段折线变换到遮罩像素后记成「两端点 + 线宽 + 亮度」，每帧由 nebbiaMaskGl.ts 一次实例化画完。
// 圆头、圆角的折线描边正好是各段圆头线段的并集，所以按段拆开、在 GPU 上取最大值，和画布上 lighten 叠出来的一样
// （只有几笔交叠处的抗锯齿边缘有一两级的差别）。

/** 每段 6 个数：x0, y0, x1, y1, 线宽（遮罩像素）, 亮度 0..1。 */
export const SEGMENT_FLOATS = 6;

export class NebbiaSegments {
    data = new Float32Array(SEGMENT_FLOATS * 4096);
    /** 这一帧收了几段。 */
    count = 0;
    private a = 1; private b = 0; private c = 0; private d = 1; private e = 0; private f = 0;
    /** 当前变换的缩放（矩阵都是旋转 × 等比缩放）。 */
    private k = 1;
    /** 当前路径的点（已变换），一个子路径一段，NaN 分开。 */
    private path: number[] = [];

    /** 每帧开头清空。 */
    clear() {
        this.count = 0;
        this.path.length = 0;
    }

    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
        this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
        this.k = Math.hypot(a, b);
    }

    moveTo(x: number, y: number) {
        if (this.path.length) this.path.push(NaN, NaN);
        this.lineTo(x, y);
    }

    lineTo(x: number, y: number) {
        this.path.push(this.a * x + this.c * y + this.e, this.b * x + this.d * y + this.f);
    }

    /** 描当前路径（宽度在当前变换下），再清掉路径。只有一个点的子路径不画（和画布一样）。 */
    stroke(width: number, v: number) {
        const p = this.path, w = width * this.k;
        for (let i = 2; i < p.length; i += 2) {
            if (Number.isNaN(p[i]) || Number.isNaN(p[i - 2])) continue;
            this.push(p[i - 2], p[i - 1], p[i], p[i + 1], w, v);
        }
        p.length = 0;
    }

    private push(x0: number, y0: number, x1: number, y1: number, w: number, v: number) {
        if ((this.count + 1) * SEGMENT_FLOATS > this.data.length) {
            const grown = new Float32Array(this.data.length * 2);
            grown.set(this.data);
            this.data = grown;
        }
        const o = this.count * SEGMENT_FLOATS, dt = this.data;
        dt[o] = x0; dt[o + 1] = y0; dt[o + 2] = x1; dt[o + 3] = y1; dt[o + 4] = w; dt[o + 5] = v;
        this.count += 1;
    }
}
