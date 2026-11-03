import { makeTex, type Tex } from './nebbiaGlUtils';

// src/components/visualizer/nebbia/nebbiaBuildingCache.ts
// 窗外楼群的缓存：楼群只跟横向位置（随车速平移）和纵向位置有关，不随时间变，所以远近两层 × 三档模糊
// （主画面清晰的 0.0012，雾的 0.03、0.09）各存一张横向环形的纹理（预乘颜色），车往前开时每帧只补画新露出来的几列，
// 主画面和雾的预渲染从缓存取，不再每个像素现算楼群。清晰那档存半分辨率（窗格边略软），约 17 MB（2K 屏）。
// 整张重画（刚开始、改尺寸、换配色、车速突变）一帧最多一张，还没画好的那档着色器照旧现算。
// 补画用自己的程序（nebbiaShaders.ts 的 NEBBIA_BLD_FILL_FS）；取样的 uBldOn、uBldGeo 由 nebbiaGl.ts 设到用缓存的程序上。

interface Level { b: number; y0: number; y1: number; fog: boolean }
/** 三档模糊和各自要存的纵向范围（屏高比例）：上面高过最高的天线，下面过了楼底以后每行都一样（取样夹到边上）。 */
const LEVELS: Level[] = [
    { b: 0.0012, y0: 0.03, y1: 0.63, fog: false },
    { b: 0.03, y0: 0.0, y1: 0.66, fog: true },
    { b: 0.09, y0: -0.06, y1: 0.73, fog: true },
];
/** 远近两层的平移速度，和着色器 building() 里的一样。 */
const SPEED = [0.02, 0.035];
/** 清晰那档相对画布的分辨率。 */
const SHARP_SCALE = 0.5;
/** 屏幕左右各多留的宽度（颠簸会取到屏外一点），和环形缓存比需要的多出的宽度。 */
const MARGIN = 0.15, SLACK = 0.2;

/**
 * 世界横坐标 [a, b) 落在宽 w 像素、周期 span 的环形缓存上的列：起始世界坐标 x0（着色器按它把每列换回世界坐标）
 * 和一到两段 [起始列, 列数]（折回开头时两段）。x0 取在列的边界上，每列中心离 [x0, x0 + span) 两端都有半列，
 * 单精度的 fract 不会把哪一列算到另一个周期去。
 */
export const ringColumns = (a: number, b: number, span: number, w: number) => {
    const ca = Math.floor(a / span * w), n = Math.min(w, Math.ceil(b / span * w) - ca);
    const start = ((ca % w) + w) % w, first = Math.min(Math.max(n, 0), w - start);
    const runs: [number, number][] = n <= 0 ? [] : n > first ? [[start, first], [0, n - first]] : [[start, n]];
    return { x0: ca * span / w, runs };
};

interface Cache { tex: Tex; fb: WebGLFramebuffer; level: number; layer: number; w: number; h: number; lo: number; hi: number; valid: boolean }
type Locations = Record<string, WebGLUniformLocation | null>;
/** 补画程序的 uniform。 */
export const BLD_FILL_UNIFORMS = ['uFillB', 'uFillLayer', 'uFillX0', 'uFillGeo', 'uFillSize'];
/** 用缓存的程序要设的：每档画好了没有、每档的 (y0, y1, 横向周期)。 */
export interface NebbiaBuildingState { on: [number, number, number]; geo: number[] }

export class NebbiaBuildingCache {
    private readonly caches: Cache[] = [];
    private span = 1;
    private aspect = 1;

    constructor(private readonly gl: WebGL2RenderingContext, firstUnit: number) {
        LEVELS.forEach((_, level) => SPEED.forEach((__, layer) => {
            const tex = makeTex(gl, firstUnit + level * 2 + layer);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            this.caches.push({ tex, fb: gl.createFramebuffer()!, level, layer, w: 1, h: 1, lo: 0, hi: 0, valid: false });
        }));
    }

    /** 用缓存的程序（编好后）：采样器 uBld0..5 指到各自的单元。 */
    bindSamplers(prog: WebGLProgram) {
        const { gl } = this;
        gl.useProgram(prog);
        this.caches.forEach((c, i) => gl.uniform1i(gl.getUniformLocation(prog, `uBld${i}`), c.tex.unit));
    }

    /** 配色变了：全部重画。 */
    invalidate() { for (const c of this.caches) c.valid = false; }

    /** 画布、雾的预渲染的像素高度（fogH 是 1/4 分辨率那张的高）。 */
    resize(canvasW: number, canvasH: number, fogH: number) {
        const { gl } = this;
        this.aspect = canvasW / canvasH;
        this.span = this.aspect + 2 * MARGIN + SLACK;
        const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
        for (const c of this.caches) {
            const L = LEVELS[c.level];
            // 每屏高多少像素；太宽的屏按纹理上限收
            const dens = Math.min(L.fog ? fogH : canvasH * SHARP_SCALE, maxSize / this.span);
            c.w = Math.max(1, Math.ceil(this.span * dens)); c.h = Math.max(1, Math.ceil((L.y1 - L.y0) * dens));
            gl.activeTexture(gl.TEXTURE0 + c.tex.unit);
            gl.bindTexture(gl.TEXTURE_2D, c.tex.t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, c.w, c.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, c.fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, c.tex.t, 0);
            c.valid = false;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * 每帧在雾的预渲染之前调（全屏四边形已绑好），t = uTime × uBus：用补画程序 `prog`（uniform 位置 `F`）补画缓存，
     * 返回取样要的 uBldOn、uBldGeo。调完当前程序可能是补画程序。
     */
    update(t: number, prog: WebGLProgram, F: Locations): NebbiaBuildingState {
        const { gl } = this;
        // 整张重画一帧只画一档（远近两层一起，一档要两层都画好才用得上）
        let fullLevel = -1, drawing = false;
        for (const c of this.caches) {
            const off = t * SPEED[c.layer], lo = off - MARGIN, hi = off + this.aspect + MARGIN;
            if (c.valid && lo >= c.lo && hi <= c.hi) continue;
            const ahead = c.valid && lo >= c.lo && hi - c.hi < this.span / 2;
            if (!ahead && fullLevel >= 0 && fullLevel !== c.level) { c.valid = false; continue; }
            if (!drawing) { gl.useProgram(prog); gl.enable(gl.SCISSOR_TEST); drawing = true; }
            if (ahead) {
                // 往前开了一点：只补新露出来的那几列，最旧的几列被覆盖掉
                const next = hi + SLACK / 4;
                this.fill(c, c.hi, next, F);
                c.hi = next; c.lo = next - this.span;
            } else {
                // 第一次、尺寸或配色变了、车速突变跳得太远：整张重画
                fullLevel = c.level;
                c.lo = lo - SLACK / 4; c.hi = c.lo + this.span;
                this.fill(c, c.lo, c.hi, F);
                c.valid = true;
            }
        }
        if (drawing) { gl.disable(gl.SCISSOR_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
        const on = LEVELS.map((_, level) => (this.caches[level * 2].valid && this.caches[level * 2 + 1].valid ? 1 : 0));
        return { on: [on[0], on[1], on[2]], geo: LEVELS.flatMap(L => [L.y0, L.y1, this.span]) };
    }

    // 补画世界横坐标 [a, b) 这一段
    private fill(c: Cache, a: number, b: number, U: Locations) {
        const { gl } = this;
        const L = LEVELS[c.level];
        const { x0, runs } = ringColumns(a, b, this.span, c.w);
        if (!runs.length) return;
        // 画进这张时先从采样单元上卸下，不然算反馈环
        gl.activeTexture(gl.TEXTURE0 + c.tex.unit);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, c.fb);
        gl.viewport(0, 0, c.w, c.h);
        gl.uniform1f(U.uFillB, L.b); gl.uniform1f(U.uFillLayer, c.layer); gl.uniform1f(U.uFillX0, x0);
        gl.uniform3f(U.uFillGeo, L.y0, L.y1, this.span); gl.uniform2f(U.uFillSize, c.w, c.h);
        for (const [start, n] of runs) {
            gl.scissor(start, 0, n, c.h);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        gl.bindTexture(gl.TEXTURE_2D, c.tex.t);
    }
}
