import { parseColorChannels } from '../colorMix';
import {
    buildPendoloClockworkCacheKey,
    buildPendoloClockworkCachedScene,
    fillPendoloTransformTables,
    PENDOLO_MAX_PARTS,
    PENDOLO_MESH_STRIDE,
    type PendoloCachedScene,
    type PendoloMotionSample,
} from './pendoloClockworkMeshes';
import { resolvePendoloClockworkAnchors, type PendoloClockworkFrameInput } from './pendoloClockworkScene';
import {
    buildPendoloBeatFxOverlay,
    PENDOLO_OVERLAY_MAX_VERTICES,
    PENDOLO_OVERLAY_STRIDE,
    resolvePendoloWaveUniform,
    type PendoloBeatFxDrawFrame,
} from './pendoloBeatFxDraw';
import { PENDOLO_WAVE_TINT } from './pendoloBeatFx';
import { invertPendoloProjectionMatrix } from './pendoloDialProjection';

// src/components/visualizer/pendolo/pendoloClockworkWebGL.ts
// WebGL2 renderer for Pendolo clockwork; falls back when context/shaders fail.
//
// 智能动感模式 (pendoloBeatFx.ts / pendoloBeatFxDraw.ts) adds two things: the shockwave lens in the
// mesh shader (`u_wave`, all zero when no wave is on - every vertex and colour then exactly as
// before), and an additive overlay pass for the lit ticks, jewel flares and sparks, drawn only on
// frames that have any.

/** 投影的近平面（w，焦点处是 1）：比它更贴近相机的被裁掉，深度从这里起算。写成 GLSL 浮点字面量。 */
const PENDOLO_PROJECTION_NEAR = '0.02';

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;
layout(location = 2) in float a_part;
uniform vec2 u_resolution;
uniform float u_dpr;
uniform vec2 u_origins[${PENDOLO_MAX_PARTS}];
uniform float u_rotations[${PENDOLO_MAX_PARTS}];
// 各部件离表盘平面的高度（CSS px）；不倾斜时全是 0
uniform float u_heights[${PENDOLO_MAX_PARTS}];
// 遮挡面那一遍把面往下压一点（CSS px），和面同高的线、填色才不会被自己的面挡住
uniform float u_depthBias;
// Shockwave lens: centre (CSS px), and crest radius, width, push share, light share.
uniform vec2 u_waveCenter;
uniform vec4 u_wave;
// 表盘投影（pendoloDialProjection.ts）：镜像 / 倾斜时 u_projOn = 1，平面上相对轮心的点 p 投到
// u_hub + (M·p).xy / (M·p).z；关着时不碰顶点，画面和原来一样。
uniform float u_projOn;
uniform vec2 u_hub;
uniform mat3 u_proj;
// 分层视差：离表盘平面高 hgt（CSS px，朝观看者）的点先在平面内缩 1 - hgt/f，再加上抬高方向；
// hgt = 0 时就是平面本身的投影（pendoloDialProjection.ts 的 buildPendoloLayerProjection 同一个式子）。
uniform vec3 u_lift;
uniform float u_invFocal;
vec3 projectDial(vec2 world, float hgt) {
  return u_proj * vec3((world - u_hub) * (1.0 - hgt * u_invFocal), 1.0) + hgt * u_lift;
}
// 投影后的齐次坐标直接交给 GPU：透视除法和 w ≤ 0（轮心视角时相机背后）的裁剪都由它做，
// 跨过相机平面的三角形不会被拉成长刺。深度 z/w = 1 - 2·near/w 是 1/w 的线性函数，近处小；
// 只有分层视差的遮挡打开深度测试时才用得上。w 比 near 还小的（贴着相机）被近平面裁掉。
vec4 projectedClip(vec3 h) {
  float w = h.z;
  vec2 px = (u_hub * w + h.xy) * u_dpr;
  return vec4(
    (px.x / u_resolution.x) * 2.0 - w,
    w - (px.y / u_resolution.y) * 2.0,
    w - ${PENDOLO_PROJECTION_NEAR} * 2.0,
    w
  );
}
out vec4 v_color;
out float v_light;
void main() {
  v_color = a_color;
  int id = int(a_part + 0.5);
  vec2 origin = u_origins[id];
  float rotation = u_rotations[id];
  float c = cos(rotation);
  float s = sin(rotation);
  vec2 world = vec2(a_pos.x * c - a_pos.y * s, a_pos.x * s + a_pos.y * c) + origin;
  v_light = 0.0;
  if (u_wave.y > 0.0) {
    vec2 rel = world - u_waveCenter;
    float u = (length(rel) - (u_wave.x - u_wave.y)) / u_wave.y;
    if (u > 0.0 && u < 1.0) {
      float b = sin(3.14159265 * u);
      b *= b;
      world += rel * (u_wave.z * b);
      v_light = u_wave.w * b;
    }
  }
  if (u_projOn > 0.5) {
    vec3 h = projectDial(world, u_heights[id] - u_depthBias);
    gl_Position = projectedClip(h);
    return;
  }
  vec2 px = world * u_dpr;
  vec2 clip = vec2(
    (px.x / u_resolution.x) * 2.0 - 1.0,
    1.0 - (px.y / u_resolution.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;
in vec4 v_color;
in float v_light;
uniform vec3 u_waveColor;
uniform float u_waveTint;
out vec4 outColor;
void main() {
  // The lens lights what it passes, like the frame added onto itself, and tints it toward the effect
  // colour; v_light is 0 outside it, where both are exact no-ops (mix by 0 is the colour itself).
  float a = min(1.0, v_color.a * (1.0 + v_light));
  vec3 rgb = mix(v_color.rgb, u_waveColor, min(1.0, u_waveTint * v_light));
  outColor = vec4(rgb * a, a);
}
`;

// Beat FX overlay: premultiplied colour; uv < -1 is a solid quad, otherwise a radial glow.
const FX_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;
layout(location = 2) in vec2 a_uv;
// 分层视差的高度（轮盘半径的比例）：刻度、火花贴着刻度，宝石亮斑和各自的宝石同高
layout(location = 3) in float a_height;
uniform vec2 u_resolution;
uniform float u_dpr;
// 高度比例换成 CSS px 的倍数（视差强度乘轮盘半径）
uniform float u_fxHeight;
// 表盘投影（pendoloDialProjection.ts）：镜像 / 倾斜时 u_projOn = 1，平面上相对轮心的点 p 投到
// u_hub + (M·p).xy / (M·p).z；关着时不碰顶点，画面和原来一样。
uniform float u_projOn;
uniform vec2 u_hub;
uniform mat3 u_proj;
// 分层视差：离表盘平面高 hgt（CSS px，朝观看者）的点先在平面内缩 1 - hgt/f，再加上抬高方向；
// hgt = 0 时就是平面本身的投影（pendoloDialProjection.ts 的 buildPendoloLayerProjection 同一个式子）。
uniform vec3 u_lift;
uniform float u_invFocal;
vec3 projectDial(vec2 world, float hgt) {
  return u_proj * vec3((world - u_hub) * (1.0 - hgt * u_invFocal), 1.0) + hgt * u_lift;
}
// 投影后的齐次坐标直接交给 GPU：透视除法和 w ≤ 0（轮心视角时相机背后）的裁剪都由它做，
// 跨过相机平面的三角形不会被拉成长刺。深度 z/w = 1 - 2·near/w 是 1/w 的线性函数，近处小；
// 只有分层视差的遮挡打开深度测试时才用得上。w 比 near 还小的（贴着相机）被近平面裁掉。
vec4 projectedClip(vec3 h) {
  float w = h.z;
  vec2 px = (u_hub * w + h.xy) * u_dpr;
  return vec4(
    (px.x / u_resolution.x) * 2.0 - w,
    w - (px.y / u_resolution.y) * 2.0,
    w - ${PENDOLO_PROJECTION_NEAR} * 2.0,
    w
  );
}
out vec4 v_color;
out vec2 v_uv;
void main() {
  v_color = a_color;
  v_uv = a_uv;
  vec2 world = a_pos;
  if (u_projOn > 0.5) {
    gl_Position = projectedClip(projectDial(world, a_height * u_fxHeight));
    return;
  }
  vec2 px = world * u_dpr;
  gl_Position = vec4((px.x / u_resolution.x) * 2.0 - 1.0, 1.0 - (px.y / u_resolution.y) * 2.0, 0.0, 1.0);
}
`;

const FX_FRAG = `#version 300 es
precision highp float;
in vec4 v_color;
in vec2 v_uv;
out vec4 outColor;
void main() {
  float a = 1.0;
  if (v_uv.x > -1.5) {
    a = clamp(1.0 - length(v_uv), 0.0, 1.0);
    a *= a;
  }
  outColor = v_color * a;
}
`;

const GRAD_VERT = `#version 300 es
precision highp float;
const vec2 pos[4] = vec2[4](
  vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0)
);
out vec2 v_uv;
void main() {
  v_uv = pos[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
}
`;

const GRAD_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_center;
uniform float u_radius;
uniform vec2 u_resolution;
uniform vec3 u_bg;
// 镜像 / 倾斜时从屏幕像素反查回表盘平面（u_projInv 是投影的逆，CSS px 相对轮心），渐变跟着表盘变成椭圆
uniform float u_projOn;
uniform float u_gdpr;
uniform mat3 u_projInv;
out vec4 outColor;
// Match Canvas2D stops: 0→0.72, 0.35→0.52, 0.7→0.20, 1→0
float radialAlpha(float t) {
  if (t <= 0.35) return mix(0.72, 0.52, t / 0.35);
  if (t <= 0.7) return mix(0.52, 0.20, (t - 0.35) / 0.35);
  return mix(0.20, 0.0, (t - 0.7) / 0.3);
}
void main() {
  // u_center is measured from the top like every CSS coordinate here; v_uv.y runs bottom-up.
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution;
  float dist = distance(px, u_center);
  if (u_projOn > 0.5) {
    vec3 q = u_projInv * vec3((px - u_center) / u_gdpr, 1.0);
    if (q.z <= 0.0) discard;
    dist = length(q.xy / q.z) * u_gdpr;
  }
  float t = clamp(dist / max(u_radius, 1.0), 0.0, 1.0);
  float a = radialAlpha(t);
  outColor = vec4(u_bg * a, a);
}
`;

const COVER_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
uniform vec2 u_resolution;
uniform float u_dpr;
// 表盘投影（pendoloDialProjection.ts）：镜像 / 倾斜时 u_projOn = 1，平面上相对轮心的点 p 投到
// u_hub + (M·p).xy / (M·p).z；关着时不碰顶点，画面和原来一样。
uniform float u_projOn;
uniform vec2 u_hub;
uniform mat3 u_proj;
// 分层视差：离表盘平面高 hgt（CSS px，朝观看者）的点先在平面内缩 1 - hgt/f，再加上抬高方向；
// hgt = 0 时就是平面本身的投影（pendoloDialProjection.ts 的 buildPendoloLayerProjection 同一个式子）。
uniform vec3 u_lift;
uniform float u_invFocal;
vec3 projectDial(vec2 world, float hgt) {
  return u_proj * vec3((world - u_hub) * (1.0 - hgt * u_invFocal), 1.0) + hgt * u_lift;
}
// 投影后的齐次坐标直接交给 GPU：透视除法和 w ≤ 0（轮心视角时相机背后）的裁剪都由它做，
// 跨过相机平面的三角形不会被拉成长刺。深度 z/w = 1 - 2·near/w 是 1/w 的线性函数，近处小；
// 只有分层视差的遮挡打开深度测试时才用得上。w 比 near 还小的（贴着相机）被近平面裁掉。
vec4 projectedClip(vec3 h) {
  float w = h.z;
  vec2 px = (u_hub * w + h.xy) * u_dpr;
  return vec4(
    (px.x / u_resolution.x) * 2.0 - w,
    w - (px.y / u_resolution.y) * 2.0,
    w - ${PENDOLO_PROJECTION_NEAR} * 2.0,
    w
  );
}
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  vec2 world = a_pos;
  if (u_projOn > 0.5) {
    // 齐次坐标交给 GPU 做透视除法，贴图按透视正确插值
    gl_Position = projectedClip(projectDial(world, 0.0));
    return;
  }
  vec2 px = world * u_dpr;
  vec2 clip = vec2(
    (px.x / u_resolution.x) * 2.0 - 1.0,
    1.0 - (px.y / u_resolution.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

const COVER_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_opacity;
out vec4 outColor;
void main() {
  vec2 c = v_uv * 2.0 - 1.0;
  if (dot(c, c) > 1.0) discard;
  vec4 tex = texture(u_tex, v_uv);
  float a = tex.a * u_opacity;
  outColor = vec4(tex.rgb * a, a);
}
`;

const compileShader = (gl: WebGL2RenderingContext, type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('[pendoloClockworkWebGL] shader compile', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
};

const linkProgram = (gl: WebGL2RenderingContext, vert: string, frag: string) => {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vert);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('[pendoloClockworkWebGL] program link', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
};

interface ProjectionUniforms {
    on: WebGLUniformLocation | null;
    hub: WebGLUniformLocation | null;
    proj: WebGLUniformLocation | null;
    lift: WebGLUniformLocation | null;
    invFocal: WebGLUniformLocation | null;
}

const getProjectionUniforms = (gl: WebGL2RenderingContext, program: WebGLProgram): ProjectionUniforms => ({
    on: gl.getUniformLocation(program, 'u_projOn'),
    hub: gl.getUniformLocation(program, 'u_hub'),
    proj: gl.getUniformLocation(program, 'u_proj'),
    lift: gl.getUniformLocation(program, 'u_lift'),
    invFocal: gl.getUniformLocation(program, 'u_invFocal'),
});

/** 把表盘投影交给一个着色器；没有投影时只把开关置 0，顶点原样走。 */
const setProjectionUniforms = (gl: WebGL2RenderingContext, locs: ProjectionUniforms | null, input: PendoloClockworkFrameInput) => {
    if (!locs) return;
    const m = input.projection;
    gl.uniform1f(locs.on, m ? 1 : 0);
    if (!m) return;
    gl.uniform2f(locs.hub, input.centerX, input.centerY);
    // 矩阵是行主序，GLSL 的 mat3 按列读，所以上传时转置
    gl.uniformMatrix3fv(locs.proj, true, m);
    // 分层视差：没有高度时抬高方向也给 0，各层都按平面本身投影
    const lift = input.parallaxScalePx ? input.parallaxLift : null;
    gl.uniform3f(locs.lift, lift?.[0] ?? 0, lift?.[1] ?? 0, lift?.[2] ?? 0);
    gl.uniform1f(locs.invFocal, lift ? input.parallaxInvFocal ?? 0 : 0);
};

const colorToRgb = (color: string): [number, number, number] => {
    const ch = parseColorChannels(color);
    if (!ch) return [0, 0, 0];
    return [ch.r / 255, ch.g / 255, ch.b / 255];
};


/**
 * Lightweight WebGL2 clockwork renderer; the canvas component falls back to Canvas2D when it is
 * not ready. Gear geometry is cached per layout and theme, and each frame only uploads the part
 * transforms, so steady-state frames make no buffer uploads.
 */
export class PendoloClockworkRenderer {
    private gl: WebGL2RenderingContext | null = null;

    private meshProgram: WebGLProgram | null = null;

    private gradProgram: WebGLProgram | null = null;

    private coverProgram: WebGLProgram | null = null;

    /** Beat FX overlay; created on the first frame that has any, never for a user who has none. */
    private fxProgram: WebGLProgram | null = null;

    private fxVbo: WebGLBuffer | null = null;

    private fxVao: WebGLVertexArrayObject | null = null;

    private fxUniformRes: WebGLUniformLocation | null = null;

    private fxUniformDpr: WebGLUniformLocation | null = null;

    private fxProjection: ProjectionUniforms | null = null;

    private meshProjection: ProjectionUniforms | null = null;

    private coverProjection: ProjectionUniforms | null = null;

    private gradUniformProjOn: WebGLUniformLocation | null = null;

    private gradUniformDpr: WebGLUniformLocation | null = null;

    private gradUniformProjInv: WebGLUniformLocation | null = null;

    /** 上一次求逆用的投影和结果；投影只随布局 / 设置变，不必每帧求逆。 */
    private gradInverseSource: Float32Array | null = null;

    private gradInverse: Float32Array | null = null;

    private fxVerts: Float32Array | null = null;

    private fxFailed = false;

    private meshUniformWaveCenter: WebGLUniformLocation | null = null;

    private meshUniformWave: WebGLUniformLocation | null = null;
    private meshUniformWaveColor: WebGLUniformLocation | null = null;
    private meshUniformWaveTint: WebGLUniformLocation | null = null;

    private meshVbo: WebGLBuffer | null = null;

    private meshVao: WebGLVertexArrayObject | null = null;

    private coverVbo: WebGLBuffer | null = null;

    private coverVao: WebGLVertexArrayObject | null = null;

    private fullscreenVao: WebGLVertexArrayObject | null = null;

    private coverTex: WebGLTexture | null = null;

    /** The image currently in `coverTex`; uploads are keyed on the image, not its URL. */
    private coverSource: CanvasImageSource | null = null;

    /**
     * An image whose upload threw (a cross-origin cover without CORS taints WebGL, where Canvas2D
     * would still draw it). It is not retried, so a bad cover costs one failed upload, not one
     * per frame.
     */
    private failedCoverSource: CanvasImageSource | null = null;

    /** The cover quad as last uploaded: centre and radius in CSS pixels. */
    private coverQuadKey = '';

    private cachedScene: PendoloCachedScene | null = null;

    private meshUniformRes: WebGLUniformLocation | null = null;

    private meshUniformDpr: WebGLUniformLocation | null = null;

    private meshUniformOrigins: WebGLUniformLocation | null = null;

    private meshUniformRotations: WebGLUniformLocation | null = null;

    private gradUniformCenter: WebGLUniformLocation | null = null;

    private gradUniformRadius: WebGLUniformLocation | null = null;

    private gradUniformRes: WebGLUniformLocation | null = null;

    private gradUniformBg: WebGLUniformLocation | null = null;

    private coverUniformRes: WebGLUniformLocation | null = null;

    private coverUniformDpr: WebGLUniformLocation | null = null;

    private coverUniformTex: WebGLUniformLocation | null = null;

    private coverUniformOpacity: WebGLUniformLocation | null = null;

    private originTable = new Float32Array(PENDOLO_MAX_PARTS * 2);

    private rotationTable = new Float32Array(PENDOLO_MAX_PARTS);

    /** 各部件的视差高度（CSS px）；不倾斜时全是 0。 */
    private heightTable = new Float32Array(PENDOLO_MAX_PARTS);

    private meshUniformHeights: WebGLUniformLocation | null = null;

    private meshUniformDepthBias: WebGLUniformLocation | null = null;

    private faceVbo: WebGLBuffer | null = null;

    private faceVao: WebGLVertexArrayObject | null = null;

    /** faceVbo 里现在是哪个场景的遮挡面。 */
    private faceSceneKey = '';

    private fxUniformHeight: WebGLUniformLocation | null = null;

    private coverVerts = new Float32Array(16);

    /** 上下文真的带了深度和模板缓冲，分层视差的遮挡才做。 */
    private canOcclude = false;

    /**
     * `antialias` 是上下文的 MSAA（#929，默认开）。建上下文时就定了，一块画布只认第一次拿到的上下文，
     * 所以改它要换一块新画布、建一个新的渲染器（PendoloClockworkCanvas 按它给画布换 key）。
     */
    constructor(readonly canvas: HTMLCanvasElement, antialias = true, depthStencil = false) {
        const gl = canvas.getContext('webgl2', {
            alpha: true,
            premultipliedAlpha: true,
            antialias,
            // 分层视差的遮挡：深度缓冲记齿轮顶面，模板缓冲从面上抠洞。只在倾斜且开视差时要，
            // 平放时不多占这两块缓冲（开 MSAA 时还是多重采样的）；变了换画布（同 antialias）
            depth: depthStencil,
            stencil: depthStencil,
            powerPreference: 'high-performance',
        });
        if (!gl) return;
        this.gl = gl;
        // 上下文属性只是请求，实际拿没拿到要问；缺一个就不做遮挡，免得洞抠不出来整块面挡住
        const attributes = gl.getContextAttributes();
        this.canOcclude = Boolean(depthStencil && attributes?.depth && attributes.stencil);
        this.meshProgram = linkProgram(gl, VERT, FRAG);
        this.gradProgram = linkProgram(gl, GRAD_VERT, GRAD_FRAG);
        this.coverProgram = linkProgram(gl, COVER_VERT, COVER_FRAG);
        if (this.meshProgram) {
            this.meshUniformRes = gl.getUniformLocation(this.meshProgram, 'u_resolution');
            this.meshUniformDpr = gl.getUniformLocation(this.meshProgram, 'u_dpr');
            this.meshUniformOrigins = gl.getUniformLocation(this.meshProgram, 'u_origins');
            this.meshUniformRotations = gl.getUniformLocation(this.meshProgram, 'u_rotations');
            this.meshUniformWaveCenter = gl.getUniformLocation(this.meshProgram, 'u_waveCenter');
            this.meshUniformWave = gl.getUniformLocation(this.meshProgram, 'u_wave');
            this.meshUniformWaveColor = gl.getUniformLocation(this.meshProgram, 'u_waveColor');
            this.meshUniformWaveTint = gl.getUniformLocation(this.meshProgram, 'u_waveTint');
            this.meshProjection = getProjectionUniforms(gl, this.meshProgram);
            this.meshUniformHeights = gl.getUniformLocation(this.meshProgram, 'u_heights');
            this.meshUniformDepthBias = gl.getUniformLocation(this.meshProgram, 'u_depthBias');
        }
        if (this.gradProgram) {
            this.gradUniformCenter = gl.getUniformLocation(this.gradProgram, 'u_center');
            this.gradUniformRadius = gl.getUniformLocation(this.gradProgram, 'u_radius');
            this.gradUniformRes = gl.getUniformLocation(this.gradProgram, 'u_resolution');
            this.gradUniformBg = gl.getUniformLocation(this.gradProgram, 'u_bg');
            this.gradUniformProjOn = gl.getUniformLocation(this.gradProgram, 'u_projOn');
            this.gradUniformDpr = gl.getUniformLocation(this.gradProgram, 'u_gdpr');
            this.gradUniformProjInv = gl.getUniformLocation(this.gradProgram, 'u_projInv');
        }
        if (this.coverProgram) {
            this.coverUniformRes = gl.getUniformLocation(this.coverProgram, 'u_resolution');
            this.coverUniformDpr = gl.getUniformLocation(this.coverProgram, 'u_dpr');
            this.coverUniformTex = gl.getUniformLocation(this.coverProgram, 'u_tex');
            this.coverUniformOpacity = gl.getUniformLocation(this.coverProgram, 'u_opacity');
            this.coverProjection = getProjectionUniforms(gl, this.coverProgram);
        }
        this.meshVbo = gl.createBuffer();
        this.meshVao = gl.createVertexArray();
        gl.bindVertexArray(this.meshVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshVbo);
        const strideBytes = PENDOLO_MESH_STRIDE * 4;
        gl.enableVertexAttribArray(0);
        gl.enableVertexAttribArray(1);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, strideBytes, 0);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, strideBytes, 8);
        gl.vertexAttribPointer(2, 1, gl.FLOAT, false, strideBytes, 24);
        gl.bindVertexArray(null);

        this.coverVbo = gl.createBuffer();
        this.coverVao = gl.createVertexArray();
        gl.bindVertexArray(this.coverVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.coverVbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.coverVerts.byteLength, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
        gl.bindVertexArray(null);

        this.fullscreenVao = gl.createVertexArray();
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    get isReady() {
        return Boolean(
            this.gl
            && !this.gl.isContextLost()
            && this.meshProgram
            && this.gradProgram
            && this.coverProgram
            && this.meshVbo
            && this.meshVao,
        );
    }

    dispose() {
        const gl = this.gl;
        if (!gl) return;
        // After a context loss every handle is already gone; deleting them is a harmless no-op.
        if (this.meshVao) gl.deleteVertexArray(this.meshVao);
        if (this.coverVao) gl.deleteVertexArray(this.coverVao);
        if (this.fullscreenVao) gl.deleteVertexArray(this.fullscreenVao);
        if (this.meshVbo) gl.deleteBuffer(this.meshVbo);
        if (this.faceVbo) gl.deleteBuffer(this.faceVbo);
        if (this.faceVao) gl.deleteVertexArray(this.faceVao);
        this.faceVbo = null;
        this.faceVao = null;
        this.faceSceneKey = '';
        if (this.coverVbo) gl.deleteBuffer(this.coverVbo);
        if (this.meshProgram) gl.deleteProgram(this.meshProgram);
        if (this.gradProgram) gl.deleteProgram(this.gradProgram);
        if (this.coverProgram) gl.deleteProgram(this.coverProgram);
        if (this.fxVao) gl.deleteVertexArray(this.fxVao);
        if (this.fxVbo) gl.deleteBuffer(this.fxVbo);
        if (this.fxProgram) gl.deleteProgram(this.fxProgram);
        this.fxVao = null;
        this.fxVbo = null;
        this.fxProgram = null;
        if (this.coverTex) gl.deleteTexture(this.coverTex);
        this.coverTex = null;
        this.coverSource = null;
        this.cachedScene = null;
        this.gl = null;
    }

    /**
     * Disposes and, once the canvas has left the document, gives the context back to the
     * browser. Chromium keeps only about 16 live WebGL contexts and drops the oldest past that,
     * which may belong to another visualizer. A canvas still in the document (StrictMode's
     * simulated unmount) keeps its context, so the remount can attach to it again.
     */
    release() {
        const gl = this.gl;
        this.dispose();
        if (gl && !this.canvas.isConnected && !gl.isContextLost()) {
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
    }

    /** Whether this cover image could not be uploaded (a cross-origin cover without CORS). */
    isCoverRejected(image: CanvasImageSource | null) {
        return image !== null && image === this.failedCoverSource;
    }

    /** Uploads cover art when the decoded image changes; returns whether a cover is ready. */
    private syncCoverImage(image: CanvasImageSource | null) {
        const gl = this.gl!;
        if (!image || image === this.failedCoverSource) {
            if (this.coverTex) {
                gl.deleteTexture(this.coverTex);
                this.coverTex = null;
            }
            this.coverSource = null;
            return false;
        }
        if (image === this.coverSource && this.coverTex) return true;
        if (!this.coverTex) this.coverTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.coverTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image as TexImageSource);
        } catch {
            this.failedCoverSource = image;
            gl.deleteTexture(this.coverTex);
            this.coverTex = null;
            this.coverSource = null;
            return false;
        }
        this.coverSource = image;
        return true;
    }

    private resize(pixelWidth: number, pixelHeight: number) {
        const gl = this.gl!;
        if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
            this.canvas.width = pixelWidth;
            this.canvas.height = pixelHeight;
        }
        gl.viewport(0, 0, pixelWidth, pixelHeight);
    }

    /**
     * Draws one clockwork frame. Positions in the mesh are CSS pixels. `beatFx` is 智能动感模式'
     * frame; absent, the frame is exactly the one drawn before it existed.
     */
    draw(options: {
        input: PendoloClockworkFrameInput;
        cssWidth: number;
        cssHeight: number;
        dpr: number;
        beatFx?: PendoloBeatFxDrawFrame | null;
    }) {
        const gl = this.gl;
        if (!gl || !this.isReady) return;
        const { input, cssWidth, cssHeight, dpr, beatFx = null } = options;
        const pixelW = Math.round(cssWidth * dpr);
        const pixelH = Math.round(cssHeight * dpr);
        if (pixelW <= 0 || pixelH <= 0) return;
        this.resize(pixelW, pixelH);
        const hasCover = input.showCover && this.syncCoverImage(input.coverImage);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (input.showCenterGradient) {
            this.drawGradient(input, pixelW, pixelH, dpr);
        }
        if (hasCover) {
            this.drawCover(input, pixelW, pixelH, dpr);
        }
        if (input.showGearDecor !== 'none') {
            this.drawMesh(input, pixelW, pixelH, dpr, beatFx);
            if (beatFx) this.drawBeatFx(input, beatFx, pixelW, pixelH, dpr);
        }
    }

    /** Builds the overlay program on first use; false (and never again) if it cannot. */
    private ensureFx() {
        if (this.fxProgram) return true;
        if (this.fxFailed) return false;
        const gl = this.gl!;
        this.fxProgram = linkProgram(gl, FX_VERT, FX_FRAG);
        if (!this.fxProgram) {
            this.fxFailed = true;
            return false;
        }
        this.fxUniformRes = gl.getUniformLocation(this.fxProgram, 'u_resolution');
        this.fxUniformDpr = gl.getUniformLocation(this.fxProgram, 'u_dpr');
        this.fxProjection = getProjectionUniforms(gl, this.fxProgram);
        this.fxUniformHeight = gl.getUniformLocation(this.fxProgram, 'u_fxHeight');
        this.fxVerts = new Float32Array(PENDOLO_OVERLAY_MAX_VERTICES * PENDOLO_OVERLAY_STRIDE);
        this.fxVbo = gl.createBuffer();
        this.fxVao = gl.createVertexArray();
        gl.bindVertexArray(this.fxVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fxVbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.fxVerts.byteLength, gl.DYNAMIC_DRAW);
        const strideBytes = PENDOLO_OVERLAY_STRIDE * 4;
        gl.enableVertexAttribArray(0);
        gl.enableVertexAttribArray(1);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, strideBytes, 0);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, strideBytes, 8);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, strideBytes, 24);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 1, gl.FLOAT, false, strideBytes, 32);
        gl.bindVertexArray(null);
        return true;
    }

    /** The additive overlay: lit ticks, jewel flares, sparks. Nothing at all on a frame without any. */
    private drawBeatFx(
        input: PendoloClockworkFrameInput,
        beatFx: PendoloBeatFxDrawFrame,
        pixelW: number,
        pixelH: number,
        dpr: number,
    ) {
        if (!this.fxVerts && !this.ensureFx()) return;
        const verts = this.fxVerts!;
        const count = buildPendoloBeatFxOverlay(verts, input, beatFx);
        if (count === 0) return;
        const gl = this.gl!;
        gl.useProgram(this.fxProgram);
        gl.bindVertexArray(this.fxVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fxVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts, 0, count * PENDOLO_OVERLAY_STRIDE);
        gl.uniform2f(this.fxUniformRes, pixelW, pixelH);
        gl.uniform1f(this.fxUniformDpr, dpr);
        setProjectionUniforms(gl, this.fxProjection, input);
        gl.uniform1f(this.fxUniformHeight, input.parallaxScalePx ?? 0);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.TRIANGLES, 0, count);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(null);
    }

    private drawGradient(
        input: PendoloClockworkFrameInput,
        pixelW: number,
        pixelH: number,
        dpr: number,
    ) {
        const gl = this.gl!;
        const anchors = resolvePendoloClockworkAnchors(input);
        gl.useProgram(this.gradProgram);
        gl.bindVertexArray(this.fullscreenVao);
        const rgb = colorToRgb(input.backgroundColor || '#000000');
        gl.uniform2f(this.gradUniformCenter, input.centerX * dpr, input.centerY * dpr);
        gl.uniform1f(this.gradUniformRadius, anchors.gradientR * dpr);
        gl.uniform2f(this.gradUniformRes, pixelW, pixelH);
        gl.uniform3f(this.gradUniformBg, rgb[0], rgb[1], rgb[2]);
        const m = input.projection;
        gl.uniform1f(this.gradUniformProjOn, m ? 1 : 0);
        if (m) {
            if (this.gradInverseSource !== m || !this.gradInverse) {
                this.gradInverseSource = m;
                this.gradInverse = invertPendoloProjectionMatrix(m);
            }
            gl.uniform1f(this.gradUniformDpr, dpr);
            gl.uniformMatrix3fv(this.gradUniformProjInv, true, this.gradInverse);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    private drawCover(
        input: PendoloClockworkFrameInput,
        pixelW: number,
        pixelH: number,
        dpr: number,
    ) {
        const gl = this.gl!;
        const anchors = resolvePendoloClockworkAnchors(input);
        const r = anchors.coverRadius;
        const { centerX, centerY, showGearDecor } = input;
        const opacity = 0.42 * (showGearDecor === 'full' ? 1.0 : 0.6);
        gl.useProgram(this.coverProgram);
        gl.bindVertexArray(this.coverVao);
        // The quad only moves with the layout, so it is re-uploaded then and not every frame.
        // 镜像时投影已把表盘翻过，贴图的 u 再翻回来，封面里的字不是反的
        const flipU = input.mirrored === true;
        const quadKey = `${centerX}|${centerY}|${r}|${flipU ? 1 : 0}`;
        if (quadKey !== this.coverQuadKey) {
            this.coverQuadKey = quadKey;
            const u0 = flipU ? 1 : 0;
            const u1 = flipU ? 0 : 1;
            this.coverVerts.set([
                centerX - r, centerY - r, u0, 0,
                centerX + r, centerY - r, u1, 0,
                centerX - r, centerY + r, u0, 1,
                centerX + r, centerY + r, u1, 1,
            ]);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.coverVbo);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.coverVerts);
        }
        gl.uniform2f(this.coverUniformRes, pixelW, pixelH);
        gl.uniform1f(this.coverUniformDpr, dpr);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.coverTex);
        gl.uniform1i(this.coverUniformTex, 0);
        gl.uniform1f(this.coverUniformOpacity, opacity);
        setProjectionUniforms(gl, this.coverProjection, input);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    private ensureCachedScene(input: PendoloClockworkFrameInput) {
        const key = buildPendoloClockworkCacheKey(input);
        if (this.cachedScene?.key === key) return this.cachedScene;
        const next = buildPendoloClockworkCachedScene(input);
        const gl = this.gl!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.meshVbo);
        gl.bufferData(gl.ARRAY_BUFFER, next.data, gl.STATIC_DRAW);
        this.cachedScene = next;
        return next;
    }

    private drawMesh(
        input: PendoloClockworkFrameInput,
        pixelW: number,
        pixelH: number,
        dpr: number,
        beatFx: PendoloBeatFxDrawFrame | null,
    ) {
        const gl = this.gl!;
        const scene = this.ensureCachedScene(input);
        if (scene.vertexCount === 0 || scene.parts.length === 0) return;

        const motion: PendoloMotionSample = {
            escapementAngle: input.escapementAngle,
            phase: input.phase,
            bassOscillation: input.bassOscillation,
            secondGearAngle: input.secondGearAngle,
            transBeatAngle: input.transBeatAngle,
        };
        fillPendoloTransformTables(scene.parts, motion, this.originTable, this.rotationTable);

        gl.useProgram(this.meshProgram);
        gl.bindVertexArray(this.meshVao);
        gl.uniform2f(this.meshUniformRes, pixelW, pixelH);
        gl.uniform1f(this.meshUniformDpr, dpr);
        gl.uniform2fv(this.meshUniformOrigins, this.originTable);
        gl.uniform1fv(this.meshUniformRotations, this.rotationTable);
        const wave = resolvePendoloWaveUniform(beatFx?.wave ?? null);
        // 波心是屏幕上的偏移；镜像时表盘平面左右是反的，横向偏移跟着取反
        const waveSide = input.mirrored ? -1 : 1;
        gl.uniform2f(this.meshUniformWaveCenter, input.centerX + waveSide * (beatFx?.wave?.x ?? 0), input.centerY + (beatFx?.wave?.y ?? 0));
        setProjectionUniforms(gl, this.meshProjection, input);
        const heightScale = input.projection ? input.parallaxScalePx ?? 0 : 0;
        for (let i = 0; i < scene.parts.length; i++) this.heightTable[i] = scene.parts[i].height * heightScale;
        gl.uniform1fv(this.meshUniformHeights, this.heightTable);
        gl.uniform4f(this.meshUniformWave, wave[0], wave[1], wave[2], wave[3]);
        const tint = beatFx?.wave ? beatFx.color : null;
        gl.uniform3f(this.meshUniformWaveColor, tint ? tint[0] / 255 : 0, tint ? tint[1] / 255 : 0, tint ? tint[2] / 255 : 0);
        gl.uniform1f(this.meshUniformWaveTint, tint ? PENDOLO_WAVE_TINT : 0);
        gl.uniform1f(this.meshUniformDepthBias, 0);
        const occluding = this.canOcclude && heightScale > 0 && Boolean(scene.faces?.length)
            && this.drawOccluders(scene, heightScale);
        gl.bindVertexArray(this.meshVao);
        gl.drawArrays(gl.TRIANGLES, 0, scene.vertexCount);
        if (occluding) {
            gl.disable(gl.DEPTH_TEST);
            gl.depthMask(true);
        }
        gl.bindVertexArray(null);
    }

    /**
     * 分层视差的遮挡：先把各齿轮的顶面写进深度缓冲（不出颜色），每块面先用模板把自己的洞标出来、
     * 写深度时跳过洞；之后的线和填色按深度测试画，被上层齿轮挡住的就不画。网格程序和高度表已经设好。
     */
    private drawOccluders(scene: PendoloCachedScene, heightScale: number) {
        const gl = this.gl;
        if (!gl || !scene.faceData || !scene.faces) return false;
        if (!this.faceVbo) {
            this.faceVbo = gl.createBuffer();
            this.faceVao = gl.createVertexArray();
            gl.bindVertexArray(this.faceVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.faceVbo);
            const strideBytes = PENDOLO_MESH_STRIDE * 4;
            gl.enableVertexAttribArray(0);
            gl.enableVertexAttribArray(1);
            gl.enableVertexAttribArray(2);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, strideBytes, 0);
            gl.vertexAttribPointer(1, 4, gl.FLOAT, false, strideBytes, 8);
            gl.vertexAttribPointer(2, 1, gl.FLOAT, false, strideBytes, 24);
        }
        gl.bindVertexArray(this.faceVao);
        if (this.faceSceneKey !== scene.key) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.faceVbo);
            gl.bufferData(gl.ARRAY_BUFFER, scene.faceData, gl.STATIC_DRAW);
            this.faceSceneKey = scene.key;
        }
        // 写入遮罩会影响 clear，先放开再清
        gl.depthMask(true);
        gl.stencilMask(0xff);
        gl.clearDepth(1);
        gl.clearStencil(0);
        gl.clear(gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.STENCIL_TEST);
        // 面本身有填色的写透明，没填色的齿轮写一层淡底色（在建网格时定好），洞的颜色是透明
        // 面往下压的量：远小于最小的层间距（0.01 倍半径乘强度），又不至于小到和同高的线打架
        gl.uniform1f(this.meshUniformDepthBias, Math.max(0.02, 0.0025 * heightScale));
        scene.faces.forEach((face, index) => {
            const ref = (index % 255) + 1;
            if (face.holeCount > 0) {
                gl.disable(gl.DEPTH_TEST);
                gl.depthMask(false);
                gl.stencilFunc(gl.ALWAYS, ref, 0xff);
                gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
                gl.drawArrays(gl.TRIANGLES, face.holeStart, face.holeCount);
                gl.enable(gl.DEPTH_TEST);
            }
            gl.depthMask(true);
            gl.depthFunc(gl.LESS);
            gl.stencilFunc(gl.NOTEQUAL, ref, 0xff);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
            gl.drawArrays(gl.TRIANGLES, face.fanStart, face.fanCount);
        });
        gl.disable(gl.STENCIL_TEST);
        gl.uniform1f(this.meshUniformDepthBias, 0);
        // 线和填色只测不写：同高的过，低处被面盖住的不过
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        return true;
    }
}
