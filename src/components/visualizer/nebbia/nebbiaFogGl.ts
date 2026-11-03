import { FOG_DIV } from './nebbiaConstants';
import { makeTex, type Tex } from './nebbiaGlUtils';

// src/components/visualizer/nebbia/nebbiaFogGl.ts
// 雾的预渲染（从 nebbiaGl.ts 拆出）：雾后面两层模糊的窗外各画进一张 RGBA16F，主画面放大采样。
// 模糊半径 0.03 那层 1/4 画布分辨率；0.09 那层糊得多（2K 屏上约 180 像素），1/8 就够。
// 用雾的预渲染程序（nebbiaShaders.ts 的 NEBBIA_FOG_FS）画，一层画一次。不能渲染到浮点纹理时（`ok` 为假，
// nebbiaPrograms.ts 的 canRenderFogToFloat）不分配、不画，主画面自己算雾。
// 凝露玻璃再多一层清晰的（模糊 0.006，和主画面里水珠折射现算的一样）：细水珠折射时读它，不逐像素重算窗外。

interface FogLayer { tex: Tex; fb: WebGLFramebuffer | null; div: number; b: number; w: number; h: number }

/** 清晰那层的分辨率（画布的几分之一）：模糊半径 0.006 屏高在 2K 屏上约 11 像素，1/4 的一格只有 4 像素，同一帧放大对比看不出差别。 */
const SHARP_DIV = 4;

export class NebbiaFogGl {
    /** 两层：0.03 的（主画面的 uFogBlur）、0.09 的（uFogGlow），纹理挂在 `unit`、`unit + 1`；凝露玻璃再加清晰的一层（uFogSharp）挂在 `sharpUnit`。 */
    readonly layers: FogLayer[];

    constructor(private readonly gl: WebGL2RenderingContext, unit: number, private readonly ok: boolean, sharpUnit: number | null = null) {
        this.layers = [
            { tex: makeTex(gl, unit), fb: ok ? gl.createFramebuffer() : null, div: FOG_DIV, b: 0.03, w: 1, h: 1 },
            { tex: makeTex(gl, unit + 1), fb: ok ? gl.createFramebuffer() : null, div: FOG_DIV * 2, b: 0.09, w: 1, h: 1 },
        ];
        if (ok && sharpUnit !== null) this.layers.push({ tex: makeTex(gl, sharpUnit), fb: gl.createFramebuffer(), div: SHARP_DIV, b: 0.006, w: 1, h: 1 });
    }

    /** 画布的像素尺寸。帧缓冲能不能拼起来在建上下文时已经试过，这里不再同步查状态。 */
    resize(canvasW: number, canvasH: number) {
        const { gl } = this;
        if (!this.ok) return;
        for (const L of this.layers) {
            L.w = Math.max(1, Math.ceil(canvasW / L.div)); L.h = Math.max(1, Math.ceil(canvasH / L.div));
            gl.activeTexture(gl.TEXTURE0 + L.tex.unit);
            gl.bindTexture(gl.TEXTURE_2D, L.tex.t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, L.w, L.h, 0, gl.RGBA, gl.HALF_FLOAT, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, L.fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, L.tex.t, 0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * 每帧在主画面之前调：雾的预渲染程序是当前程序、街景 uniform 已设好、全屏四边形已绑好；`uFogB` 是那个程序里模糊半径的位置。
     * 预渲染程序只采样楼群缓存，画进雾纹理不会和采样单元成反馈环。
     */
    draw(uFogB: WebGLUniformLocation | null) {
        const { gl } = this;
        if (!this.ok) return;
        for (const L of this.layers) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, L.fb);
            gl.viewport(0, 0, L.w, L.h);
            gl.uniform1f(uFogB, L.b);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
}
