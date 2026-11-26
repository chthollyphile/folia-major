import { MASK_SCALE } from './nebbiaConstants';
import { glObject, makeTex, type Tex } from './nebbiaGlUtils';
import { SEGMENT_FLOATS, TILE_FLOATS, type NebbiaSegments } from './nebbiaSegments';
import { FONT_TILE, type NebbiaFontInk } from './nebbiaFontStrokes';

// src/components/visualizer/nebbia/nebbiaMaskGl.ts
// 擦痕遮罩在 GPU 上画：nebbiaSegments.ts 收好的线段一次实例化画进一张 R8 纹理（半分辨率，亮 = 擦开），
// 混合取最大值，代替原来 2D 画布上每段三次 stroke 加 lighten（Windows 的 D3D11 上每次都要拷一份目标像素，很贵）
// 和每帧把画布上传成纹理。一段的三层由宽到窄、由暗到亮（原 strokePath 的 [1.3, 0.38] [1.0, 0.72] [0.62, 1]）在片元里一起算。
// 程序和别的雾笺程序一起在后台编（nebbiaPrograms.ts，属性位置 aCorner 0、aSeg 1、aParam 2），编好后 attach 进来。
// 笔顺模型给的字（nebbiaFontStrokes.ts）不画线段，画字块：字体自己的墨按书写位置显出来，同一张遮罩里取最大值。
// 字块放在一张二维纹理数组里（RG8：墨、书写位置，带 mipmap），第一次画到时上传，按需加层。

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

export const NEBBIA_MASK_INK_VS = /* glsl */ `#version 300 es
in vec2 aCorner; in vec4 aOrigin; in vec4 aAxisV; in vec2 aParam;
uniform vec2 uView;
out vec2 vUv; flat out vec4 vParam;
void main() {
  vec2 uv = aCorner * 0.5 + 0.5;
  vec2 p = aOrigin.xy + aOrigin.zw * uv.x + aAxisV.xy * uv.y;
  vUv = uv; vParam = vec4(aAxisV.zw, aParam);
  gl_Position = vec4(p / uView * 2.0 - 1.0, 0.0, 1.0);
}`;

export const NEBBIA_MASK_INK_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uInk;
in vec2 vUv; flat in vec4 vParam;
out vec4 o;
float level(float x) { return floor(x * 255.0 + 0.5) / 255.0; }
void main() {
  // vParam：贴图层、显到的书写位置、亮度、羽化宽
  vec2 t = texture(uInk, vec3(vUv, vParam.x)).rg;
  float shown = 1.0 - smoothstep(vParam.y - vParam.w, vParam.y, t.g - vParam.w * 0.5);
  o = vec4(level(vParam.z) * t.r * shown, 0.0, 0.0, 1.0);
}`;

/** 字体墨的贴图层：按字块 id 分层，第一次用到时上传；层不够时整张重建、重传。 */
class NebbiaInkAtlas {
    readonly t: WebGLTexture;
    private layers = new Map<number, number>();
    private kept: NebbiaFontInk[] = [];
    private depth = 0;
    private dirty = false;

    constructor(private readonly gl: WebGL2RenderingContext, readonly unit: number) {
        this.t = glObject(gl.createTexture(), 'texture');
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.t);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    /** 这个字块在第几层（没传过就传）。 */
    layerOf(ink: NebbiaFontInk): number {
        const hit = this.layers.get(ink.id);
        if (hit !== undefined) return hit;
        const { gl } = this;
        const layer = this.kept.length;
        if (layer >= this.depth) {
            this.depth = Math.max(32, this.depth * 2);
            gl.activeTexture(gl.TEXTURE0 + this.unit);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.t);
            gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RG8, FONT_TILE, FONT_TILE, this.depth, 0, gl.RG, gl.UNSIGNED_BYTE, null);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this.kept.forEach((k, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, FONT_TILE, FONT_TILE, 1, gl.RG, gl.UNSIGNED_BYTE, k.tile));
        }
        gl.activeTexture(gl.TEXTURE0 + this.unit);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.t);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, FONT_TILE, FONT_TILE, 1, gl.RG, gl.UNSIGNED_BYTE, ink.tile);
        this.kept.push(ink);
        this.layers.set(ink.id, layer);
        this.dirty = true;
        return layer;
    }

    /** 这一帧新传过字块：重算 mipmap。 */
    finish() {
        if (!this.dirty) return;
        const { gl } = this;
        gl.activeTexture(gl.TEXTURE0 + this.unit);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.t);
        gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
        this.dirty = false;
    }

    /** 换歌后旧字块用不上了：层数超过 limit 时整张清空，下次用到再传。 */
    trim(limit: number) {
        if (this.kept.length <= limit) return;
        this.kept = [];
        this.layers.clear();
        this.depth = 0;
    }

    destroy() {
        this.gl.deleteTexture(this.t);
    }
}

export class NebbiaMaskGl {
    /** 主程序 uMask 采样的那张纹理。 */
    readonly tex: Tex;
    private prog: WebGLProgram | null = null;
    private readonly vao: WebGLVertexArrayObject;
    private readonly buf: WebGLBuffer;
    private uView: WebGLUniformLocation | null = null;
    private readonly fb: WebGLFramebuffer;
    private w = 1; private h = 1;
    private inkProg: WebGLProgram | null = null;
    private readonly inkVao: WebGLVertexArrayObject;
    private readonly inkBuf: WebGLBuffer;
    private uInkView: WebGLUniformLocation | null = null;
    private readonly atlas: NebbiaInkAtlas;

    /** 纹理挂在采样单元 `unit` 上（主程序的 uMask 由 nebbiaGl.ts 编好后指过来）。 */
    /** inkUnit：字体墨贴图挂的采样单元（只有遮罩的字块程序读）。 */
    constructor(private readonly gl: WebGL2RenderingContext, unit: number, inkUnit: number) {
        this.tex = makeTex(gl, unit);
        this.atlas = new NebbiaInkAtlas(gl, inkUnit);
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
        // 字块：aCorner 0、aOrigin 1（左上角、u 边）、aAxisV 2（v 边、贴图层、显到的位置）、aParam 3（亮度、羽化）
        this.inkVao = glObject(gl.createVertexArray(), 'vertex array');
        gl.bindVertexArray(this.inkVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        this.inkBuf = glObject(gl.createBuffer(), 'buffer');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.inkBuf);
        const tileStride = TILE_FLOATS * 4;
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, tileStride, 0); gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, tileStride, 16); gl.vertexAttribDivisor(2, 1);
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, tileStride, 32); gl.vertexAttribDivisor(3, 1);
        gl.bindVertexArray(null);
    }

    /** 编好的遮罩程序（nebbiaPrograms.ts 的 `mask`）。 */
    attach(prog: WebGLProgram, inkProg: WebGLProgram) {
        const { gl } = this;
        this.prog = prog;
        this.uView = gl.getUniformLocation(prog, 'uView');
        this.inkProg = inkProg;
        this.uInkView = gl.getUniformLocation(inkProg, 'uView');
        gl.useProgram(inkProg);
        gl.uniform1i(gl.getUniformLocation(inkProg, 'uInk'), this.atlas.unit);
    }

    /** 换歌时：字块层数太多就清空重来。 */
    trimInk(limit = 256) {
        this.atlas.trim(limit);
    }

    destroy() {
        this.atlas.destroy();
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
        const n = segs.inks.length;
        if (n && this.inkProg) {
            for (let i = 0; i < n; i += 1) segs.tiles[i * TILE_FLOATS + 6] = this.atlas.layerOf(segs.inks[i]);
            this.atlas.finish();
            gl.useProgram(this.inkProg);
            gl.bindVertexArray(this.inkVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.inkBuf);
            gl.bufferData(gl.ARRAY_BUFFER, segs.tiles.subarray(0, n * TILE_FLOATS), gl.DYNAMIC_DRAW);
            gl.uniform2f(this.uInkView, this.w, this.h);
            gl.activeTexture(gl.TEXTURE0 + this.atlas.unit);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas.t);
            gl.enable(gl.BLEND);
            gl.blendEquation(gl.MAX);
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
            gl.blendEquation(gl.FUNC_ADD);
            gl.disable(gl.BLEND);
            gl.bindVertexArray(null);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
}
