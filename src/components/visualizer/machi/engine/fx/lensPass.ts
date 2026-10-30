import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { fullscreenMaterial, halfFloatTarget, type MachiSceneTarget } from './postPasses';

// src/components/visualizer/machi/engine/fx/lensPass.ts
// 町景的镜头 pass：按深度离焦的景深（散景），再加边缘色差、暗角、胶片颗粒；晴夜的星星画在景深之后（天空离焦最远，
// 先画的话会被虚掉）。
// 散景是“以收代散”的圆盘取样：每个像素按深度算出离焦圆的半径（CoC，全分辨率像素；对焦面之前为负、之后为正，
// 移轴按画面上下另算一份，当成后景）。先降到一半分辨率（离焦大时再一层层降，让最大的圆在那一层不超过十来个像素，
// 取样又够密又不贵），在那一层按黄金角螺旋在圆盘里取样：后景只收“自己的圆盖得到这里、而且不比中心清楚”的样，清楚的前景
// 不会被身后的虚景糊上；前景收所有盖得到这里的样并记下盖住的比例，虚掉的前景能盖到身后清楚的东西上。再做一次小的
// 帐篷模糊抹掉取样的颗粒，最后在全分辨率上按这个像素自己的 CoC 与前景盖住的比例，在清楚的原图和散景之间混合。
// 在色调映射之前的 HDR 上做：亮的灯、霓虹、雨里的反光虚成圆形的亮斑（大光圈的样子）。

/**
 * 散景那一层里最大的离焦圆不超过这么多像素（超过就再降一层分辨率）：圆越小取样越少，默认的 f/8 在 1080p 上
 * 留在一半分辨率，1440p 以上就降到四分之一，开销不比原来的高斯离焦层高多少。
 */
const LEVEL_MAX_COC = 8;
/** 离焦层最多降到全分辨率的 1/2、1/4……1/32（强度 2、f/1.4 在 4K 屏上也排得下）。 */
const LEVELS = 5;
/** 圆盘取样最多几个点（GLSL 的循环上限）。 */
const MAX_TAPS = 48;

/** 离焦圆的半径，景深的几道 pass 共用（uniform 也共用一份）。 */
const COC_GLSL = /* glsl */ `
uniform float uDepthRange;
uniform float uFocus;
uniform float uFocusBand;
uniform float uFocusFalloff;
uniform float uCocRadius;
uniform float uTiltRadius;
// 离焦圆的半径（全分辨率像素）：对焦面之前为负、之后为正；移轴按画面上下另算，当成后景。
float machiCoc(float depth01, vec2 uv) {
    float offset = depth01 * uDepthRange - uFocus;
    float coc = smoothstep(uFocusBand, uFocusBand + uFocusFalloff, abs(offset)) * uCocRadius * (offset < 0.0 ? -1.0 : 1.0);
    float tilt = smoothstep(0.2, 0.55, abs(uv.y - 0.5)) * uTiltRadius;
    return abs(coc) >= tilt ? coc : tilt;
}
`;

/** 全分辨率 → 一半：2×2 平均颜色，CoC 取四个里离焦最多的那个（带正负号），存在 alpha 里。 */
const PREFILTER_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 uSourceTexel;
varying vec2 vUv;
${COC_GLSL}
float widest(float a, float b) { return abs(a) >= abs(b) ? a : b; }
void main() {
    vec2 o = uSourceTexel * 0.5;
    vec2 p0 = vUv + vec2(-o.x, -o.y);
    vec2 p1 = vUv + vec2(o.x, -o.y);
    vec2 p2 = vUv + vec2(-o.x, o.y);
    vec2 p3 = vUv + vec2(o.x, o.y);
    vec3 color = (texture2D(tDiffuse, p0).rgb + texture2D(tDiffuse, p1).rgb + texture2D(tDiffuse, p2).rgb + texture2D(tDiffuse, p3).rgb) * 0.25;
    float coc = widest(
        widest(machiCoc(texture2D(tDepth, p0).x, p0), machiCoc(texture2D(tDepth, p1).x, p1)),
        widest(machiCoc(texture2D(tDepth, p2).x, p2), machiCoc(texture2D(tDepth, p3).x, p3))
    );
    gl_FragColor = vec4(color, coc);
}
`;

/** 再降一层：同样 2×2 平均颜色、CoC 取离焦最多的那个。 */
const DOWNSAMPLE_FRAGMENT = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uSourceTexel;
varying vec2 vUv;
float widest(float a, float b) { return abs(a) >= abs(b) ? a : b; }
void main() {
    vec2 o = uSourceTexel * 0.5;
    vec4 s0 = texture2D(tSource, vUv + vec2(-o.x, -o.y));
    vec4 s1 = texture2D(tSource, vUv + vec2(o.x, -o.y));
    vec4 s2 = texture2D(tSource, vUv + vec2(-o.x, o.y));
    vec4 s3 = texture2D(tSource, vUv + vec2(o.x, o.y));
    gl_FragColor = vec4((s0.rgb + s1.rgb + s2.rgb + s3.rgb) * 0.25, widest(widest(s0.a, s1.a), widest(s2.a, s3.a)));
}
`;

/**
 * 圆盘取样：uMaxCoc 是这一层里最大的离焦圆（像素），uLevelScale 是这一层一个像素合多少全分辨率像素（alpha 里的 CoC
 * 按全分辨率像素存）。输出散景的颜色，alpha 是前景盖住这里的比例。
 */
const GATHER_FRAGMENT = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;
uniform float uMaxCoc;
uniform float uLevelScale;
uniform float uTaps;
varying vec2 vUv;
// 每个取样点比上一个多转一个黄金角：方向用转一个黄金角的矩阵一路乘下去，不用每个点算一次 cos、sin。
const mat2 GOLDEN_TURN = mat2(-0.73736888, 0.67549029, -0.67549029, -0.73736888);
const float MARGIN = 1.2;
void main() {
    vec4 center = texture2D(tSource, vUv);
    float centerCoc = center.a / uLevelScale;
    vec4 far = vec4(0.0);
    vec4 near = vec4(0.0);
    vec2 direction = vec2(1.0, 0.0);
    for (int i = 0; i < ${MAX_TAPS}; i++) {
        if (float(i) >= uTaps) break;
        float radius = sqrt((float(i) + 0.5) / uTaps) * uMaxCoc;
        vec4 tap = texture2D(tSource, vUv + direction * radius * uTexel);
        direction = GOLDEN_TURN * direction;
        float tapCoc = tap.a / uLevelScale;
        // 后景：取样点的圆与中心的圆里小的那个盖得到这里才收（清楚的前景不被身后的虚景糊上）。
        float farCoc = max(min(centerCoc, tapCoc), 0.0);
        float farWeight = clamp((farCoc - radius + MARGIN) / MARGIN, 0.0, 1.0);
        // 前景：自己的圆盖得到这里就收；清楚的点不算前景。
        float nearWeight = clamp((-tapCoc - radius + MARGIN) / MARGIN, 0.0, 1.0) * step(1.0, -tapCoc);
        far += vec4(tap.rgb, 1.0) * farWeight;
        near += vec4(tap.rgb, 1.0) * nearWeight;
    }
    vec3 farColor = far.a > 0.0 ? far.rgb / far.a : center.rgb;
    vec3 nearColor = near.a > 0.0 ? near.rgb / near.a : center.rgb;
    // 前景盖住的比例：圆盘约三分之一的样是前景时就算全盖住。
    float nearAlpha = clamp(near.a * 3.14159 / uTaps, 0.0, 1.0);
    gl_FragColor = vec4(mix(farColor, nearColor, nearAlpha), nearAlpha);
}
`;

/** 抹掉取样的颗粒：四个对角的双线性取样（合起来是 3×3 的帐篷）。 */
const TENT_FRAGMENT = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
    vec2 o = uTexel * 0.5;
    gl_FragColor = (texture2D(tSource, vUv + vec2(-o.x, -o.y)) + texture2D(tSource, vUv + vec2(o.x, -o.y))
        + texture2D(tSource, vUv + vec2(-o.x, o.y)) + texture2D(tSource, vUv + vec2(o.x, o.y))) * 0.25;
}
`;

const LENS_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tBokeh;
uniform sampler2D tDepth;
uniform float uDofMix;
uniform vec2 uBlend;
uniform float uAberration;
uniform float uVignette;
uniform float uGrain;
uniform float uFade;
uniform float uStars;
uniform float uTime;
uniform float uAspect;
varying vec2 vUv;
${COC_GLSL}
float gHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
    vec2 centered = vUv - 0.5;
    float edge = dot(centered, centered);
    // 边缘色差：红蓝沿径向错开，中间不动。
    vec2 shift = centered * edge * uAberration;
    vec3 sharp = vec3(
        texture2D(tDiffuse, vUv + shift).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - shift).b
    );
    // 景深：这个像素自己离焦够多（超过散景那一层一两个像素）就用散景；虚掉的前景盖到这里也用散景。
    vec4 bokeh = texture2D(tBokeh, vUv);
    float depth01 = texture2D(tDepth, vUv).x;
    float own = smoothstep(uBlend.x, uBlend.y, abs(machiCoc(depth01, vUv)));
    float amount = (own + bokeh.a - own * bokeh.a) * uDofMix;
    vec3 color = mix(sharp, bokeh.rgb, clamp(amount, 0.0, 1.0));
    // 晴夜的星星：天空像素上格子里稀疏的亮点，各自慢慢闪。
    if (uStars > 0.001 && depth01 > 0.9999) {
        vec2 sp = vec2(vUv.x * uAspect, vUv.y) * 140.0;
        vec2 cell = floor(sp);
        float starSeed = gHash(cell);
        vec2 starAt = vec2(gHash(cell + 3.7), gHash(cell + 9.1)) * 0.6 + 0.2;
        float star = step(0.984, starSeed) * smoothstep(0.24, 0.0, length(fract(sp) - starAt))
            * (0.55 + 0.45 * sin(uTime * (0.8 + starSeed * 3.0) + starSeed * 60.0));
        color += vec3(0.85, 0.9, 1.0) * star * uStars * 1.3 * smoothstep(0.1, 0.55, vUv.y);
    }
    // 暗角。
    vec2 v = centered * vec2(uAspect, 1.0);
    float vignette = smoothstep(1.15, 0.35, length(v) * 1.15);
    color *= mix(1.0, vignette, uVignette);
    // 颗粒：跟亮度走，暗部更细。
    float grain = gHash(vUv * vec2(1733.0, 977.0) + fract(uTime * 7.31)) - 0.5;
    color += grain * uGrain * (0.25 + dot(color, vec3(0.3333)));
    gl_FragColor = vec4(max(color, 0.0) * uFade, 1.0);
}
`;

export interface MachiLensSettings {
    /** 对焦深度（离镜头的距离）、清晰的半宽、从清晰到最虚的过渡宽度（都是米）。 */
    focus: number;
    focusBand: number;
    focusFalloff: number;
    /** 离焦最多处的离焦圆半径、移轴那一份的半径（都按画面高度的比例；0 是不虚）。 */
    coc: number;
    tilt: number;
    aberration: number;
    vignette: number;
    grain: number;
    /** 晴夜的星星 0..1。 */
    stars?: number;
    /** 换场景时整幅画面淡到黑（0）再淡回来（1）。 */
    fade?: number;
}

/** 散景那一层用第几层（0 是一半分辨率）、最大的圆在那一层多少像素、取多少个样（纯函数，单测用）。 */
export const resolveMachiBokehLevel = (maxCocPx: number) => {
    let level = 0;
    let levelCoc = maxCocPx / 2;
    while (levelCoc > LEVEL_MAX_COC && level < LEVELS - 1) {
        level += 1;
        levelCoc /= 2;
    }
    // 取样点之间约隔 2 个像素（之后还有一道帐篷模糊）：小圆少取，大圆取满。
    const taps = Math.min(MAX_TAPS, Math.max(12, Math.ceil((Math.PI * levelCoc * levelCoc) / 4)));
    return { level, levelCoc, taps, scale: 2 ** (level + 1) };
};

/** 镜头：散景景深（降分辨率的圆盘取样，按深度与清楚的原图混合），再加色差、暗角、颗粒。 */
export class MachiLensPass extends Pass {
    /** 一半、四分之一……分辨率的离焦层（alpha 里是 CoC）。 */
    private readonly chain = Array.from({ length: LEVELS }, halfFloatTarget);
    /** 圆盘取样与帐篷模糊在用的那一层上来回用的两张。 */
    private readonly work = [halfFloatTarget(), halfFloatTarget()] as const;
    private readonly prefilter: THREE.ShaderMaterial;
    private readonly downsample: THREE.ShaderMaterial;
    private readonly gather: THREE.ShaderMaterial;
    private readonly tent: THREE.ShaderMaterial;
    readonly material: THREE.ShaderMaterial;
    private readonly quad = new FullScreenQuad();
    private readonly fullSize = new THREE.Vector2(1, 1);
    /** 画质允许景深（自动降级会关掉）。 */
    dofEnabled = true;
    /** 这一帧有景深或移轴：没有就不做离焦层。 */
    private dofActive = true;
    private bokeh = resolveMachiBokehLevel(0);

    constructor(private readonly scene: MachiSceneTarget) {
        super();
        // 离焦圆的参数：预滤与最后的混合共用同一份 uniform。
        const coc = {
            uDepthRange: { value: 100 },
            uFocus: { value: 60 },
            uFocusBand: { value: 3 },
            uFocusFalloff: { value: 7 },
            uCocRadius: { value: 0 },
            uTiltRadius: { value: 0 },
        };
        this.prefilter = fullscreenMaterial({
            uniforms: { ...coc, tDiffuse: { value: null }, tDepth: { value: null }, uSourceTexel: { value: new THREE.Vector2() } },
            fragmentShader: PREFILTER_FRAGMENT,
        });
        this.downsample = fullscreenMaterial({
            uniforms: { tSource: { value: null }, uSourceTexel: { value: new THREE.Vector2() } },
            fragmentShader: DOWNSAMPLE_FRAGMENT,
        });
        this.gather = fullscreenMaterial({
            uniforms: {
                tSource: { value: null },
                uTexel: { value: new THREE.Vector2() },
                uMaxCoc: { value: 1 },
                uLevelScale: { value: 2 },
                uTaps: { value: 12 },
            },
            fragmentShader: GATHER_FRAGMENT,
        });
        this.tent = fullscreenMaterial({
            uniforms: { tSource: { value: null }, uTexel: { value: new THREE.Vector2() } },
            fragmentShader: TENT_FRAGMENT,
        });
        this.material = fullscreenMaterial({
            uniforms: {
                ...coc,
                tDiffuse: { value: null },
                tBokeh: { value: null },
                tDepth: { value: null },
                uDofMix: { value: 0 },
                uBlend: { value: new THREE.Vector2(1, 3) },
                uAberration: { value: 0.012 },
                uVignette: { value: 0.55 },
                uGrain: { value: 0.035 },
                uStars: { value: 0 },
                uFade: { value: 1 },
                uTime: { value: 0 },
                uAspect: { value: 16 / 9 },
            },
            fragmentShader: LENS_FRAGMENT,
        });
    }

    setSize(width: number, height: number) {
        this.fullSize.set(Math.max(1, width), Math.max(1, height));
        this.chain.forEach((target, index) => {
            const divisor = 2 ** (index + 1);
            target.setSize(Math.max(1, Math.round(width / divisor)), Math.max(1, Math.round(height / divisor)));
        });
        this.material.uniforms.uAspect!.value = width / Math.max(1, height);
    }

    configure(settings: MachiLensSettings, depthRange: number, time: number) {
        const uniforms = this.material.uniforms;
        const height = this.fullSize.y;
        const cocPx = Math.max(0, settings.coc) * height;
        const tiltPx = Math.max(0, settings.tilt) * height;
        this.dofActive = this.dofEnabled && (cocPx > 0.5 || tiltPx > 0.5);
        this.bokeh = resolveMachiBokehLevel(Math.max(cocPx, tiltPx));
        uniforms.uDepthRange!.value = depthRange;
        uniforms.uFocus!.value = settings.focus;
        uniforms.uFocusBand!.value = settings.focusBand;
        uniforms.uFocusFalloff!.value = settings.focusFalloff;
        uniforms.uCocRadius!.value = this.dofActive ? cocPx : 0;
        uniforms.uTiltRadius!.value = this.dofActive ? tiltPx : 0;
        uniforms.uDofMix!.value = this.dofActive ? 1 : 0;
        // 离焦不到散景那一层的半个像素时用原图，到一个半像素时全用散景。
        (uniforms.uBlend!.value as THREE.Vector2).set(0.5 * this.bokeh.scale, 1.5 * this.bokeh.scale);
        uniforms.uAberration!.value = settings.aberration;
        uniforms.uVignette!.value = settings.vignette;
        uniforms.uGrain!.value = settings.grain;
        uniforms.uStars!.value = settings.stars ?? 0;
        uniforms.uFade!.value = settings.fade ?? 1;
        uniforms.uTime!.value = time;
    }

    private draw(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
        this.quad.material = material;
        renderer.setRenderTarget(target);
        this.quad.render(renderer);
    }

    render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
        const uniforms = this.material.uniforms;
        const depth = this.scene.target.depthTexture;
        uniforms.tBokeh!.value = readBuffer.texture;
        if (this.dofActive) {
            const { level, levelCoc, taps, scale } = this.bokeh;
            const [first] = this.chain as [THREE.WebGLRenderTarget];
            this.prefilter.uniforms.tDiffuse!.value = readBuffer.texture;
            this.prefilter.uniforms.tDepth!.value = depth;
            (this.prefilter.uniforms.uSourceTexel!.value as THREE.Vector2).set(1 / this.fullSize.x, 1 / this.fullSize.y);
            this.draw(renderer, this.prefilter, first);
            for (let index = 1; index <= level; index += 1) {
                const source = this.chain[index - 1]!;
                this.downsample.uniforms.tSource!.value = source.texture;
                (this.downsample.uniforms.uSourceTexel!.value as THREE.Vector2).set(1 / source.width, 1 / source.height);
                this.draw(renderer, this.downsample, this.chain[index]!);
            }
            const source = this.chain[level]!;
            const [gathered, smoothed] = this.work;
            gathered.setSize(source.width, source.height);
            smoothed.setSize(source.width, source.height);
            const gather = this.gather.uniforms;
            gather.tSource!.value = source.texture;
            (gather.uTexel!.value as THREE.Vector2).set(1 / source.width, 1 / source.height);
            gather.uMaxCoc!.value = levelCoc;
            gather.uLevelScale!.value = scale;
            gather.uTaps!.value = taps;
            this.draw(renderer, this.gather, gathered);
            this.tent.uniforms.tSource!.value = gathered.texture;
            (this.tent.uniforms.uTexel!.value as THREE.Vector2).set(1 / source.width, 1 / source.height);
            this.draw(renderer, this.tent, smoothed);
            uniforms.tBokeh!.value = smoothed.texture;
        }
        uniforms.tDiffuse!.value = readBuffer.texture;
        uniforms.tDepth!.value = depth;
        this.draw(renderer, this.material, this.renderToScreen ? null : writeBuffer);
    }

    dispose() {
        this.chain.forEach(target => target.dispose());
        this.work.forEach(target => target.dispose());
        this.prefilter.dispose();
        this.downsample.dispose();
        this.gather.dispose();
        this.tent.dispose();
        this.material.dispose();
        this.quad.dispose();
    }
}
