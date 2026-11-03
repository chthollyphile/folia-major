import { FLAKE_FILL, FLAKE_STAGES } from './nebbiaSnowFlakes';
import { makeTex, type Tex } from './nebbiaGlUtils';
import { NEBBIA_FIRE_GLSL } from './nebbiaFireGlsl';

// src/components/visualizer/nebbia/nebbiaSnowGl.ts
// 雪窗的雪花在 WebGL 里画（nebbiaGl.ts 在主画面之后调）：全部阶段贴图拼成一张图集（nebbiaSnowFlakes.ts），每片雪一个实例，预乘透明度叠上去。
// 雪被身后窗外的光照着：取主画面已经预渲染好的那层大范围糊的窗外（雾的光晕层，uFogGlow），暖橙的灯下泛一点暖黄、蓝的地方带一点冷蓝、
// 暗的地方暗下去；逆光时像冰一样被照透，透过它看到身后折过来的窗外，冰棱和身后的光成固定角度时闪出色散的火彩（nebbiaFireGlsl.ts）；靠近亮光的雪外面再散一圈很淡、不大的柔光。透明、或不能预渲染雾时没有这层，雪按中等亮度、不上色画。
// 雪跟玻璃一起颠（和水珠纹理一样按 glassShift 挪）。

/** 一片雪的实例：x、y、半径（CSS 像素）、转角；融化阶段（0..STAGES-1）、图集里第几行、透明度、清楚的程度（1 = 贴上了、对上焦；飘过来时、窗外的雪小于 1，越小越糊）；横、竖压扁。 */
export const FLAKE_FLOATS = 10;
/** 火彩把贴图分成几乘几格（每格一块冰面，各有自己的折射角）。 */
const GLINT_GRID = '9.0';
/** 实例方块的半边长是雪花半径的几倍（要盖住整张贴图和飘过来时的糊光）。 */
const EXT = 2.6;

export const NEBBIA_FLAKE_VS = /* glsl */ `#version 300 es
in vec2 aCorner; in vec4 aA; in vec4 aB; in vec2 aC;
uniform vec2 uView, uShift;
out vec2 vLocal; out vec2 vHalo; out vec2 vFu; flat out vec4 vB; flat out float vR; flat out float vSeed;
void main() {
  vec2 c = (aCorner * 2.0 - 1.0) * ${EXT.toFixed(2)};
  float cs = cos(aA.w), sn = sin(aA.w);
  vec2 off = c * aA.z;
  vec2 p = aA.xy + vec2(off.x * cs - off.y * sn, off.x * sn + off.y * cs) + uShift;
  // vLocal：贴图里的坐标（单位是雪花半径，压扁之前）；vHalo：糊光、柔光用的（不压扁）
  vLocal = c / aC; vHalo = c; vB = aB; vR = aA.z;
  // 每片雪自己的随机数（闪光用）：贴上以后转角、种类都不再变
  vSeed = fract(sin(aA.w * 12.9898 + aB.y * 78.233) * 43758.5453);
  // 雾的预渲染纹理第 0 行是屏幕底部
  vFu = vec2(p.x / uView.x, 1.0 - p.y / uView.y);
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`;

export const NEBBIA_FLAKE_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D uAtlas, uGlow, uBehind;
uniform bool uLit; uniform vec2 uGrid; uniform highp vec2 uView;
in vec2 vLocal; in vec2 vHalo; in vec2 vFu; flat in vec4 vB; flat in float vR; flat in float vSeed;
out vec4 o;
${NEBBIA_FIRE_GLSL}
vec4 tile(float col, vec2 t, float bias) { return texture(uAtlas, (vec2(col, vB.y) + t) / uGrid, bias); }
void main() {
  float p = vB.w;
  vec2 t = 0.5 + vLocal * ${(FLAKE_FILL / 2).toFixed(3)};
  // 相邻两个融化阶段交叉；还没飘到焦点上的取更糊的一级。不放在分支里取（分支里取样的 mipmap 级别不可靠），格子外面乘 0
  float st = floor(vB.x), fr = vB.x - st, bias = 2.0 * (1.0 - p);
  vec2 tc = clamp(t, 0.0, 1.0);
  vec4 c = mix(tile(st, tc, bias), tile(min(st + 1.0, uGrid.x - 1.0), tc, bias), fr);
  c *= vB.z * float(t == tc);
  // 身后的光：颜色带大半（还看得出是白雪），亮度跟着走：暗处压得很暗，灯下亮过雾
  vec3 L = uLit ? texture(uGlow, vFu).rgb : vec3(0.42);
  float lum = dot(L, vec3(0.3, 0.59, 0.11));
  vec3 hue = clamp(mix(vec3(1.0), L / max(lum, 0.02), 0.8), 0.0, 2.2);
  vec3 lit = hue * clamp(0.22 + 2.5 * lum, 0.0, 1.4);
  vec3 rgb = c.rgb * lit;
  // 逆光（身后有亮光）：雪像冰一样被照透。冰晶的厚薄（贴图的不透明度）当成表面的起伏，斜的地方把身后的窗外往里折（取主画面那层稍糊的窗外，uBehind），
  // 透过来的光比四周亮一点；薄的边、斜面上再亮一道。暗处照旧是白雪。只在对上焦（贴上玻璃）后，化得越多越弱（化成水交给水珠去折射）
  float back = float(uLit) * smoothstep(0.08, 0.45, lum) * p * (1.0 - 0.7 * vB.x / ${(FLAKE_STAGES - 1).toFixed(1)});
  float a0 = c.a / max(vB.z, 0.001);
  vec2 n = vec2(dFdx(a0), dFdy(a0)) * vR;
  float edge = clamp(length(n) * 0.5, 0.0, 1.0);
  // 色散（比真冰放大了不少，要看得出）：红、绿、蓝折得不一样多，棱上再沿斜的方向分开一点，透过来的窗外在边上错出彩边、颜色加浓；
  vec2 bend = n * vR * 0.7 / uView, split = n / max(length(n), 0.001) * vR * 0.35 * edge / uView;
  vec3 through = vec3(texture(uBehind, vFu - bend * 0.8 - split).r, texture(uBehind, vFu - bend).g, texture(uBehind, vFu - bend * 1.25 + split).b);
  vec3 gray = vec3(dot(through, vec3(0.3333)));
  through = gray + (through - gray) * (1.0 + 1.5 * edge);
  vec3 ice = (through * (1.1 + 0.3 * edge) + min(L, vec3(1.2)) * edge * 0.3) * c.a + c.rgb * lit * 0.15;
  rgb = mix(rgb, ice, back * 0.85);
  float d = length(vHalo);
  // 还没飘到焦点上：外面套一圈糊的
  float ha = 0.35 * (1.0 - p) * max(0.0, 1.0 - d / (1.6 - 0.6 * p));
  rgb = vec3(0.92, 0.95, 1.0) * lit * ha + rgb * (1.0 - ha);
  float a = ha + c.a * (1.0 - ha);
  // 靠近亮光：外面散一圈很淡的柔光（只加颜色，比雪花大不了多少），化得越多越淡；没有光照（透明）时不加
  float soft = float(uLit) * smoothstep(0.12, 0.6, lum) * 0.45 * exp(-d * d * 2.4) * vB.z * (1.0 - vB.x / ${(FLAKE_STAGES - 1).toFixed(1)});
  // 火彩（色散）：贴图按格子分，每格一块冰面、有自己固定的折射角，只有冰棱上（斜面）的格子会出；颜色由斜面和光的方向定（nebbiaFireGlsl.ts），
  // 只加光，亮度按身后光的亮度给，不跟灯的颜色走；约四成格子有朝得对的冰面
  vec2 g = tc * ${GLINT_GRID}, gc = floor(g), gf = fract(g) - 0.5;
  float h = fract(sin(dot(gc, vec2(12.9898, 78.233)) + vSeed * 91.7) * 43758.5453);
  vec3 fire = fixedFire(uGlow, vFu, n, fract(h * 7.31)) * step(h, 0.4);
  float glint = back * exp(-dot(gf, gf) * 18.0) * edge * (0.6 + 2.0 * lum) * vB.z;
  o = vec4(rgb + min(L, vec3(1.2)) * soft + fire * glint * 2.2, a);
}`;

export class NebbiaSnowGl {
    private readonly vao: WebGLVertexArrayObject;
    private readonly buf: WebGLBuffer;
    private readonly atlas: Tex;
    private prog: WebGLProgram | null = null;
    private uView: WebGLUniformLocation | null = null;
    private uShift: WebGLUniformLocation | null = null;
    private uGrid: WebGLUniformLocation | null = null;
    private rows = 0;
    /** 实例缓冲分配了多少个数（只在要放的比这多时重新分配，平时每帧只覆盖内容）。 */
    private capacity = 0;

    constructor(private readonly gl: WebGL2RenderingContext, unit: number) {
        this.atlas = makeTex(gl, unit);
        this.vao = gl.createVertexArray()!;
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        this.buf = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        const stride = FLAKE_FLOATS * 4;
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(2, 1);
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 32); gl.vertexAttribDivisor(3, 1);
        gl.bindVertexArray(null);
    }

    /** 程序编好时调：取 uniform 位置、指好图集、雾的光晕层（glowUnit）和稍糊的窗外（behindUnit，冰折射用）；lit 为假时不取光。 */
    attach(prog: WebGLProgram, glowUnit: number, behindUnit: number, lit: boolean) {
        const { gl } = this;
        this.prog = prog;
        gl.useProgram(prog);
        this.uView = gl.getUniformLocation(prog, 'uView');
        this.uShift = gl.getUniformLocation(prog, 'uShift');
        this.uGrid = gl.getUniformLocation(prog, 'uGrid');
        gl.uniform1i(gl.getUniformLocation(prog, 'uAtlas'), this.atlas.unit);
        gl.uniform1i(gl.getUniformLocation(prog, 'uGlow'), glowUnit);
        gl.uniform1i(gl.getUniformLocation(prog, 'uBehind'), behindUnit);
        gl.uniform1i(gl.getUniformLocation(prog, 'uLit'), lit ? 1 : 0);
    }

    /** 上传图集（每种一行、每个阶段一格），带 mipmap：小雪花、飘过来时的糊都从这里取。 */
    setAtlas(canvas: HTMLCanvasElement, rows: number) {
        const { gl } = this;
        this.rows = rows;
        gl.activeTexture(gl.TEXTURE0 + this.atlas.unit);
        gl.bindTexture(gl.TEXTURE_2D, this.atlas.t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        // 再小格子就和隔壁的阶段混了
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 4);
    }

    /** 叠到当前帧缓冲上：data 里 count 片雪，W、H 是 CSS 像素，shift 是玻璃颠簸（CSS 像素）。 */
    draw(data: Float32Array, count: number, W: number, H: number, shift: [number, number]) {
        const { gl } = this;
        if (!this.prog || !this.rows || !count) return;
        gl.useProgram(this.prog);
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        // 按 data 的容量分配一次（它变大了才重新分配），之后每帧只传这一帧用到的那段
        if (data.length > this.capacity) {
            gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
            this.capacity = data.length;
        }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * FLAKE_FLOATS);
        gl.uniform2f(this.uView, W, H);
        gl.uniform2f(this.uShift, shift[0], shift[1]);
        gl.uniform2f(this.uGrid, FLAKE_STAGES, this.rows);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
    }
}
