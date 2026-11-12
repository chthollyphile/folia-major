import { FIREFLY_FLOATS, fireflyParams } from './nebbiaFireflies';

// src/components/visualizer/nebbia/nebbiaFireflyGl.ts
// 凝露玻璃上的萤虫在 WebGL 里画（nebbiaGl.ts 在主画面之后调），每只一个实例，预乘透明度叠上去。
// 虫子按头的朝向画：淡淡的白色身子，两边两片半透明的翅膀，飞的时候翅膀张开快速扇、看着是一团糊影，停在玻璃上收拢；没对上焦（还在飞远）时整只糊开。
// 尾巴尖上一点自己发的光（主题的灯光色，加色，外面带一小圈光晕），亮多少按 nebbiaFireflies.ts 排的节奏。
// 身子的光照照融雪最早那版雪花（提交 71446614）：身子不自己发光，颜色、亮度取身后雾的光晕层（uFogGlow），暗处压暗，灯边亮过雾，外面散一圈大的柔光（大小可调）。
// 透明、或不能预渲染雾时没有光晕层，按中等亮度、不上色画。

export const NEBBIA_FIREFLY_VS = /* glsl */ `#version 300 es
in vec2 aCorner; in vec4 aA; in vec4 aB; in vec4 aC;
uniform vec2 uView; uniform float uHalo;
out vec2 vLocal; out vec2 vFu; flat out vec4 vP; flat out vec4 vGlow;
void main() {
  // 方块要盖住糊开的虫子和柔光：柔光到方块边上要淡到看不出（低于 1/255），不然灯下看得见方框
  float ext = max(2.6, 4.1 * uHalo);
  vec2 c = (aCorner * 2.0 - 1.0) * ext;
  // 按身子朝向转：vLocal 是虫子自己的坐标（x 朝头，单位是半径）
  float cs = cos(aB.z), sn = sin(aB.z);
  vec2 off = c * aA.z;
  vec2 p = aA.xy + vec2(off.x * cs - off.y * sn, off.x * sn + off.y * cs);
  vLocal = c; vP = vec4(aA.w, aB.x, aB.y, aB.w); vGlow = aC;
  // 雾的预渲染纹理第 0 行是屏幕底部
  vFu = vec2(p.x / uView.x, 1.0 - p.y / uView.y);
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`;

export const NEBBIA_FIREFLY_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D uGlow;
// uHalo 两边都用：和顶点着色器的精度要一样
uniform bool uLit; uniform highp float uHalo;
in vec2 vLocal; in vec2 vFu; flat in vec4 vP; flat in vec4 vGlow;
out vec4 o;
// 一个椭圆（中心 c、半轴 ab、转 a 弧度）的覆盖，边缘宽 e
float blob(vec2 q, vec2 c, vec2 ab, float a, float e) {
  q -= c;
  float cs = cos(a), sn = sin(a);
  q = vec2(q.x * cs + q.y * sn, -q.x * sn + q.y * cs) / ab;
  return 1.0 - smoothstep(1.0 - e, 1.0 + e, length(q));
}
void main() {
  float p = vP.y, flap = vP.w;
  vec2 q = vLocal;
  // 没对上焦：边缘糊开
  float e = 0.18 + 0.9 * (1.0 - p);
  // 身子：头、胸、长一点的肚子
  float body = max(max(blob(q, vec2(0.62, 0.0), vec2(0.17, 0.15), 0.0, e),
                       blob(q, vec2(0.3, 0.0), vec2(0.22, 0.2), 0.0, e)),
                   blob(q, vec2(-0.25, 0.0), vec2(0.48, 0.19), 0.0, e));
  // 翅膀：收拢时盖在背上往后，张开时往两边摆；扇得快，看着是一片半透明的糊影
  float wa = 0.12 + 1.2 * flap, we = e + 0.3 * flap;
  float wing = max(blob(q, vec2(-0.15 + 0.2 * flap, 0.08 + 0.45 * flap), vec2(0.62, 0.17), wa, we),
                   blob(q, vec2(-0.15 + 0.2 * flap, -0.08 - 0.45 * flap), vec2(0.62, 0.17), -wa, we));
  // 身后的光：颜色带大半，亮度跟着走：暗处压得很暗，灯下亮过雾
  vec3 L = uLit ? texture(uGlow, vFu).rgb : vec3(0.42);
  float lum = dot(L, vec3(0.3, 0.59, 0.11));
  vec3 hue = clamp(mix(vec3(1.0), L / max(lum, 0.02), 0.8), 0.0, 2.2);
  vec3 lit = hue * clamp(0.22 + 2.5 * lum, 0.0, 1.4);
  // 身子淡淡的白；翅膀更薄、透光，叠在身子上面
  float ab = body * 0.5, aw = wing * (0.3 - 0.1 * flap);
  float ca = (aw + ab * (1.0 - aw)) * vP.x;
  vec3 rgb = (vec3(0.95, 0.97, 1.0) * aw + vec3(0.86, 0.88, 0.92) * ab * (1.0 - aw)) * lit * vP.x;
  float d = length(q);
  // 还没飘到焦点上：外面套一圈糊的
  float ha = 0.35 * (1.0 - p) * max(0.0, 1.0 - d / (1.6 - 0.6 * p)) * vP.x;
  rgb = vec3(0.92, 0.95, 1.0) * lit * ha + rgb * (1.0 - ha);
  float a = ha + ca * (1.0 - ha);
  // 靠近亮光：散一圈很淡的柔光（只加颜色）；没有光照（透明）时不加
  // 身后已经很亮（聚光灯正照着）时柔光收掉大半：再往亮处加光只会叠成一片白
  float soft = float(uLit) * smoothstep(0.12, 0.6, lum) * (1.0 - 0.75 * smoothstep(0.6, 1.2, lum)) * 0.45 * exp(-d * d * 0.3 / (uHalo * uHalo)) * vP.z;
  // 尾巴的光：肚子尖上一小团，外面一小圈光晕，只加颜色（自己发光，不挡后面）；没对上焦时糊大
  float dt = length(q - vec2(-0.55, 0.0)), gr = 0.45 + 0.35 * (1.0 - p);
  float lamp = (1.0 - smoothstep(0.0, gr, dt)) + 0.8 * exp(-dt * dt * 0.7);
  // 中心偏白一点（亮到发白），外圈是灯光色
  vec3 tint = mix(vGlow.yzw, vec3(1.0), 0.35 * (1.0 - smoothstep(0.0, gr, dt)));
  vec3 glow = tint * lamp * vGlow.x * vP.x * mix(0.5, 1.0, p);
  o = vec4(rgb + min(L, vec3(1.2)) * soft + glow, a);
}`;

export class NebbiaFireflyGl {
    private readonly vao: WebGLVertexArrayObject;
    private readonly buf: WebGLBuffer;
    private prog: WebGLProgram | null = null;
    private uView: WebGLUniformLocation | null = null;
    private uHalo: WebGLUniformLocation | null = null;

    constructor(private readonly gl: WebGL2RenderingContext) {
        this.vao = gl.createVertexArray()!;
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        this.buf = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        const stride = FIREFLY_FLOATS * 4;
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(2, 1);
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 32); gl.vertexAttribDivisor(3, 1);
        gl.bindVertexArray(null);
    }

    /** 程序编好时调：取 uniform 位置，指好雾的光晕层（glowUnit）；lit 为假时不取光。 */
    attach(prog: WebGLProgram, glowUnit: number, lit: boolean) {
        const { gl } = this;
        this.prog = prog;
        gl.useProgram(prog);
        this.uView = gl.getUniformLocation(prog, 'uView');
        this.uHalo = gl.getUniformLocation(prog, 'uHalo');
        gl.uniform1i(gl.getUniformLocation(prog, 'uGlow'), glowUnit);
        gl.uniform1i(gl.getUniformLocation(prog, 'uLit'), lit ? 1 : 0);
    }

    /** 叠到当前帧缓冲上：data 里 count 只，W、H 是 CSS 像素。 */
    draw(data: Float32Array, count: number, W: number, H: number) {
        const { gl } = this;
        if (!this.prog || !count) return;
        gl.useProgram(this.prog);
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
        gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * FIREFLY_FLOATS), gl.DYNAMIC_DRAW);
        gl.uniform2f(this.uView, W, H);
        gl.uniform1f(this.uHalo, Math.max(0.05, fireflyParams.halo));
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
    }
}
