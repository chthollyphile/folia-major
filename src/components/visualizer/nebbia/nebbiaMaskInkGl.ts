import { SD_SCALE } from './nebbiaFontField';
import { glObject } from './nebbiaGlUtils';
import { FONT_TILE, type NebbiaFontInk } from './nebbiaFontGlyph';
import { TILE_FLOATS, type NebbiaSegments } from './nebbiaSegments';

// src/components/visualizer/nebbia/nebbiaMaskInkGl.ts
// 擦痕遮罩里笔顺模型给的字（nebbiaFontStrokesQueue.ts）：不画线段，画字块，字体自己的墨按书写位置显出来，同一张遮罩里取最大值。
// 字块放在一张二维纹理数组里（RGB8：墨、书写位置、到墨边的有符号距离，带 mipmap），第一次画到时上传，按需加层。
// 笔画粗细设置不为 0 时，墨边按有符号距离平移（外扩 / 内缩）再抗锯齿；为 0 时直接用墨通道，字体原样显出。
// 程序和别的雾笺程序一起在后台编（nebbiaPrograms.ts，属性位置 aCorner 0、aOrigin 1、aAxisV 2、aParam 3），编好后 attach 进来。

export const NEBBIA_MASK_INK_VS = /* glsl */ `#version 300 es
in vec2 aCorner; in vec4 aOrigin; in vec4 aAxisV; in vec3 aParam;
uniform vec2 uView;
out vec2 vUv; flat out vec4 vParam; flat out float vGrow;
void main() {
  vec2 uv = aCorner * 0.5 + 0.5;
  vec2 p = aOrigin.xy + aOrigin.zw * uv.x + aAxisV.xy * uv.y;
  vUv = uv; vParam = vec4(aAxisV.zw, aParam.xy); vGrow = aParam.z;
  gl_Position = vec4(p / uView * 2.0 - 1.0, 0.0, 1.0);
}`;

export const NEBBIA_MASK_INK_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uInk;
in vec2 vUv; flat in vec4 vParam; flat in float vGrow;
out vec4 o;
float level(float x) { return floor(x * 255.0 + 0.5) / 255.0; }
void main() {
  // vParam：贴图层、显到的书写位置、亮度、羽化宽；vGrow：墨边外扩（模型网格像素，0 = 字体原样）
  vec3 t = texture(uInk, vec3(vUv, vParam.x)).rgb;
  float ink = t.r;
  if (vGrow != 0.0) {
    // 有符号距离（墨内为正）加上外扩量，按一个遮罩像素宽的过渡抗锯齿
    float sd = (t.b * 255.0 - 128.0) / ${SD_SCALE.toFixed(6)} + vGrow;
    ink = clamp(sd / max(fwidth(sd), 1e-3) + 0.5, 0.0, 1.0);
  }
  float shown = 1.0 - smoothstep(vParam.y - vParam.w, vParam.y, t.g - vParam.w * 0.5);
  o = vec4(level(vParam.z) * ink * shown, 0.0, 0.0, 1.0);
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
            gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGB8, FONT_TILE, FONT_TILE, this.depth, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            this.kept.forEach((k, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, FONT_TILE, FONT_TILE, 1, gl.RGB, gl.UNSIGNED_BYTE, k.tile));
        }
        gl.activeTexture(gl.TEXTURE0 + this.unit);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.t);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, FONT_TILE, FONT_TILE, 1, gl.RGB, gl.UNSIGNED_BYTE, ink.tile);
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

/** 遮罩里的字块这一趟：字块实例、贴图层和绘制。 */
export class NebbiaMaskInkGl {
    private prog: WebGLProgram | null = null;
    private readonly vao: WebGLVertexArrayObject;
    private readonly buf: WebGLBuffer;
    private uView: WebGLUniformLocation | null = null;
    private readonly atlas: NebbiaInkAtlas;

    /** unit：字体墨贴图挂的采样单元（只有这个程序读）。 */
    constructor(private readonly gl: WebGL2RenderingContext, unit: number) {
        this.atlas = new NebbiaInkAtlas(gl, unit);
        // 字块：aCorner 0、aOrigin 1（左上角、u 边）、aAxisV 2（v 边、贴图层、显到的位置）、aParam 3（亮度、羽化、墨边外扩）
        this.vao = glObject(gl.createVertexArray(), 'vertex array');
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        this.buf = glObject(gl.createBuffer(), 'buffer');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        const stride = TILE_FLOATS * 4;
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(2, 1);
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 32); gl.vertexAttribDivisor(3, 1);
        gl.bindVertexArray(null);
    }

    attach(prog: WebGLProgram) {
        const { gl } = this;
        this.prog = prog;
        this.uView = gl.getUniformLocation(prog, 'uView');
        gl.useProgram(prog);
        gl.uniform1i(gl.getUniformLocation(prog, 'uInk'), this.atlas.unit);
    }

    /** 换歌时：字块层数太多就清空重来。 */
    trim(limit: number) {
        this.atlas.trim(limit);
    }

    destroy() {
        this.atlas.destroy();
    }

    /** 把这一帧的字块画进当前绑定的遮罩帧缓冲（w、h 是遮罩像素）。 */
    draw(segs: NebbiaSegments, w: number, h: number) {
        const n = segs.inks.length;
        if (!n || !this.prog) return;
        const { gl } = this;
        for (let i = 0; i < n; i += 1) segs.tiles[i * TILE_FLOATS + 6] = this.atlas.layerOf(segs.inks[i]);
        this.atlas.finish();
        gl.useProgram(this.prog);
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        gl.bufferData(gl.ARRAY_BUFFER, segs.tiles.subarray(0, n * TILE_FLOATS), gl.DYNAMIC_DRAW);
        gl.uniform2f(this.uView, w, h);
        gl.activeTexture(gl.TEXTURE0 + this.atlas.unit);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas.t);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.MAX);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
        gl.blendEquation(gl.FUNC_ADD);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
    }
}
