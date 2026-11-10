import { MASK_SCALE } from './nebbiaConstants';
import { makeTex, type Tex } from './nebbiaGlUtils';
import { SEGMENT_FLOATS, type NebbiaSegments } from './nebbiaSegments';

// src/components/visualizer/nebbia/nebbiaMaskGl.ts
// 擦痕遮罩在 GPU 上画：nebbiaSegments.ts 收好的线段一次实例化画进一张 R8 纹理（半分辨率，亮 = 擦开），
// 混合取最大值，代替原来 2D 画布上每段三次 stroke 加 lighten（Windows 的 D3D11 上每次都要拷一份目标像素，很贵）
// 和每帧把画布上传成纹理。一段的三层由宽到窄、由暗到亮（原 strokePath 的 [1.3, 0.38] [1.0, 0.72] [0.62, 1]）在片元里一起算。
// 程序和别的雾笺程序一起在后台编（nebbiaPrograms.ts，属性位置 aCorner 0、aSeg 1、aParam 2），编好后 attach 进来。

export const NEBBIA_MASK_VS = /* glsl */ `#version 300 es
in vec2 aCorner; in vec4 aSeg; in vec2 aParam;
uniform vec2 uView;
out vec2 vP; flat out vec4 vSeg; flat out vec2 vParam;
void main() {
  vec2 a = aSeg.xy, b = aSeg.zw, d = b - a;
  float l = length(d);
  vec2 t = l > 1e-5 ? d / l : vec2(1.0, 0.0), n = vec2(-t.y, t.x);
  // 最宽那层的半宽再留 1 像素抗锯齿
  float R = aParam.x * 0.65 + 1.0;
  vec2 p = (a + b) * 0.5 + t * aCorner.x * (l * 0.5 + R) + n * aCorner.y * R;
  vP = p; vSeg = aSeg; vParam = aParam;
  gl_Position = vec4(p / uView * 2.0 - 1.0, 0.0, 1.0);
}`;

export const NEBBIA_MASK_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vP; flat in vec4 vSeg; flat in vec2 vParam;
out vec4 o;
// 半宽 r 的线离像素中心 d 时的覆盖度（1 像素线性过渡，接近画布的抗锯齿）
float cover(float r, float d) { return clamp(r + 0.5 - d, 0.0, 1.0); }
// 画布的颜色是 8 位：先量化再乘覆盖度
float level(float x) { return floor(x * 255.0 + 0.5) / 255.0; }
void main() {
  vec2 a = vSeg.xy, ba = vSeg.zw - a, pa = vP - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * h), w = vParam.x * 0.5, v = vParam.y;
  // 三层按画布的 lighten 一层层叠：每层都比下面亮，覆盖度 a 的像素是 m + a × (这层 − m)
  float m = level(v * 0.38) * cover(w * 1.3, d);
  m += cover(w, d) * (level(v * 0.72) - m);
  m += cover(w * 0.62, d) * (level(v) - m);
  o = vec4(m, 0.0, 0.0, 1.0);
}`;

export class NebbiaMaskGl {
    /** 主程序 uMask 采样的那张纹理。 */
    readonly tex: Tex;
    private prog: WebGLProgram | null = null;
    private readonly vao: WebGLVertexArrayObject;
    private readonly buf: WebGLBuffer;
    private uView: WebGLUniformLocation | null = null;
    private readonly fb: WebGLFramebuffer;
    private w = 1; private h = 1;

    /** 纹理挂在采样单元 `unit` 上（主程序的 uMask 由 nebbiaGl.ts 编好后指过来）。 */
    constructor(private readonly gl: WebGL2RenderingContext, unit: number) {
        this.tex = makeTex(gl, unit);
        this.fb = gl.createFramebuffer()!;
        this.vao = gl.createVertexArray()!;
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        this.buf = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        const stride = SEGMENT_FLOATS * 4;
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(2, 1);
        gl.bindVertexArray(null);
    }

    /** 编好的遮罩程序（nebbiaPrograms.ts 的 `mask`）。 */
    attach(prog: WebGLProgram) {
        this.prog = prog;
        this.uView = this.gl.getUniformLocation(prog, 'uView');
    }

    /** W、H 是 CSS 像素，遮罩按 MASK_SCALE 缩（和原来的遮罩画布一样大）。 */
    resize(W: number, H: number) {
        const { gl } = this;
        this.w = Math.max(1, Math.round(W * MASK_SCALE));
        this.h = Math.max(1, Math.round(H * MASK_SCALE));
        gl.activeTexture(gl.TEXTURE0 + this.tex.unit);
        gl.bindTexture(gl.TEXTURE_2D, this.tex.t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, this.w, this.h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex.t, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /** 清成全雾，再把这一帧的线段画上去。画完恢复默认的加法混合（水珠那一趟只设混合因子）。 */
    draw(segs: NebbiaSegments) {
        const { gl } = this;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
        gl.viewport(0, 0, this.w, this.h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (segs.count && this.prog) {
            gl.useProgram(this.prog);
            gl.bindVertexArray(this.vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
            gl.bufferData(gl.ARRAY_BUFFER, segs.data.subarray(0, segs.count * SEGMENT_FLOATS), gl.DYNAMIC_DRAW);
            gl.uniform2f(this.uView, this.w, this.h);
            gl.enable(gl.BLEND);
            gl.blendEquation(gl.MAX);
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, segs.count);
            gl.blendEquation(gl.FUNC_ADD);
            gl.disable(gl.BLEND);
            gl.bindVertexArray(null);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
}
