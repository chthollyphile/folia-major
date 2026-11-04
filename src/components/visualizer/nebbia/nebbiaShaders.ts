import { NEBBIA_AQUA_GLSL } from './nebbiaAquaGlsl';
import { NEBBIA_SCENE_GLSL } from './nebbiaSceneGlsl';
import type { NebbiaGlass, NebbiaWindowScene } from './types';

// src/components/visualizer/nebbia/nebbiaShaders.ts
// 雾笺的着色器：雾的预渲染（两层模糊的窗外各画一次，写进 1/4、1/8 分辨率的两张浮点纹理）、主画面（雾、擦痕、水珠折射合成，
// 照搬 raindrop-fx 的 compose.glsl；不支持浮点渲染目标时用自己算雾的那一版）、往楼群缓存里补画（nebbiaBuildingCache.ts）、
// 算静态噪声纹理（nebbiaNoiseTex.ts），和画水珠精灵的实例化着色器。
// 窗外选了水族箱时，雾的预渲染和主画面换成水族箱的场景（nebbiaAquaGlsl.ts）编，见 nebbiaSceneShaders；街景的源码不变。
// 预渲染和主画面分成两个程序、各只有一个输出：合在一个程序里（带回退分支、两个输出）时，D3D11 上链接要 3 秒、
// 第一次画进两张纹理时还要再编 3 秒多；分开后链接不到 1 秒，第一次画不再重编（nebbiaPrograms.ts 在后台编）。

export const NEBBIA_VS = /* glsl */ `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; vUv.y = 1.0 - vUv.y; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// 窗外场景（nebbiaSceneGlsl.ts 或 nebbiaAquaGlsl.ts）读的 uniform，几个程序共用
const sceneUniforms = (sceneGlsl: string) => /* glsl */ `precision highp float;
uniform vec2 uRes, uSceneShift; uniform float uTime, uBus, uNeon;
uniform vec3 uSky0, uSky1, uLa, uLb, uLc;
// 聚光灯：光源（远处楼底）、照到玻璃上的点、光斑半径，都在 scene 坐标；uSpotI 强度
uniform vec2 uSpotSrc, uSpotSrc2, uSpotTgt; uniform float uSpotR, uSpotI;
// 窗外画哪几样（位见 nebbiaSceneGlsl.ts 的 SCN_*）
uniform int uScenery;
// 楼群缓存（nebbiaBuildingCache.ts）：三档模糊 × 远近两层，预乘颜色；uBldOn 每档画好了没有，uBldGeo 每档 (y0, y1, 横向周期)
uniform bvec3 uBldOn; uniform sampler2D uBld0, uBld1, uBld2, uBld3, uBld4, uBld5; uniform vec3 uBldGeo[3];
in vec2 vUv; layout(location = 0) out vec4 outColor;
${sceneGlsl}`;
const SCENE_UNIFORMS = sceneUniforms(NEBBIA_SCENE_GLSL);
const AQUA_UNIFORMS = sceneUniforms(NEBBIA_AQUA_GLSL);

/**
 * 雾的预渲染：雾里的两层窗外（模糊半径 uFogB = 0.03、0.09 屏高）本来就很糊，在 1/4、1/8 分辨率下算好、主画面放大采样，
 * 结果几乎一样，却省掉每个像素两次完整的场景计算（2880×1800 下约 8 毫秒）。一层画一次（nebbiaFogGl.ts）。
 */
const fogFs = (uniforms: string) => /* glsl */ `#version 300 es
${uniforms}
uniform float uFogB;
void main() {
  vec2 s0 = vUv + uSceneShift, q0 = vec2(s0.x * uRes.x / uRes.y, s0.y);
  outColor = vec4(scene(q0, uFogB), 1.0);
}`;
export const NEBBIA_FOG_FS = fogFs(SCENE_UNIFORMS);

/**
 * 往楼群缓存里补画一段：缓存的一格像素对应的世界横坐标，取落在 [uFillX0, uFillX0 + 周期) 里的那一个。
 * uFillGeo 同 uBldGeo，uFillSize 是缓存的像素尺寸。只用到 building()，街景的其余部分（和缓存的采样器）编译时都去掉。
 */
export const NEBBIA_BLD_FILL_FS = /* glsl */ `#version 300 es
${SCENE_UNIFORMS}
uniform float uFillB, uFillLayer, uFillX0; uniform vec3 uFillGeo; uniform vec2 uFillSize;
void main() {
  float span = uFillGeo.z;
  float xw = uFillX0 + fract((gl_FragCoord.x / uFillSize.x * span - uFillX0) / span) * span;
  vec4 r = building(vec2(xw, mix(uFillGeo.x, uFillGeo.y, gl_FragCoord.y / uFillSize.y)), uFillB, 0.0, uFillLayer);
  outColor = vec4(r.rgb * r.a, r.a);
}`;

// 主画面里只跟像素位置有关的三个噪声：R 擦痕边细噪声、G 起雾的大块噪声、B 闪点（静态噪声纹理里存的也是它）
const STATIC_NOISE = /* glsl */ `
vec3 staticNoise(vec2 px) { return vec3(vnoise(px / 6.0) * 0.6 + vnoise(px / 2.2) * 0.4, vnoise(px / 55.0 + 3.1), vnoise(px / 1.6)); }`;

/** 静态噪声纹理（nebbiaNoiseTex.ts）：改尺寸时算一次。纹理的第 j 行存 px.y = j + 0.5，主画面按 px / uRes 取样，正好落在格子中心。 */
export const NEBBIA_NOISE_FS = /* glsl */ `#version 300 es
${SCENE_UNIFORMS}
${STATIC_NOISE}
void main() { outColor = vec4(staticNoise(gl_FragCoord.xy), 1.0); }`;

const MAIN_FS = (fogTex: boolean, uniforms = SCENE_UNIFORMS, dew = false) => /* glsl */ `#version 300 es
#define NEBBIA_FOG_TEX ${fogTex ? 1 : 0}
${dew ? '#define NEBBIA_DEW 1\n' : ''}${uniforms}
uniform sampler2D uMask, uDrop, uField;
#ifdef NEBBIA_DEW
// 凝露玻璃上冷凝水珠的高光（tuning.dewGlint）；细水珠折射的窗外（nebbiaFogGl.ts 预渲染的清晰的那层）
uniform float uDewGlint;
uniform sampler2D uFogSharp;
#endif
// 哈气的白气遮罩（R 形状、G 浓度，nebbiaBreath.ts）；屏上没有哈气时 uBreathOn 为假，不采样
uniform sampler2D uBreath; uniform bool uBreathOn; uniform float uBreathThick;
uniform vec2 uGlassShift; uniform float uMist, uEdge, uRefract, uGlint;
// 预渲染好的两层雾（NEBBIA_FOG_TEX 为 0 时主画面自己算：不支持浮点渲染目标时）
uniform sampler2D uFogBlur, uFogGlow;
// 静态噪声纹理（nebbiaNoiseTex.ts）：按 px 取样；uNoiseOn 为假（还没算好、画布超过纹理尺寸上限）时现算
uniform bool uNoiseOn; uniform sampler2D uNoise;
// 透明（窗外是共用背景或桌面）：不画窗外，输出预乘的透明度。雾是一层半透明的雾，擦开的地方全透明，
// 光（聚光灯、擦痕边、水珠高光）只加颜色不加不透明度，叠在后面的东西上。雾的颜色跟主题日夜：日间乳白、夜间深色
uniform bool uSeeThrough; uniform vec3 uMistTint;
${STATIC_NOISE}
void main() {
  // 颠簸：玻璃上的东西（雾、擦痕、水珠）跟车身一起晃，窗外晃得更多
  vec2 gv = vUv + uGlassShift, sv = vUv + uSceneShift;
  vec2 px = gv * uRes;
  float aspect = uRes.x / uRes.y;
  vec2 q = vec2(sv.x * aspect, sv.y);
  // 擦痕边缘：细噪声让边缘毛糙，大块噪声让重新起雾时一片片回来
  vec3 nz = uNoiseOn ? texture(uNoise, px / uRes).rgb : staticNoise(px);
  float fine = nz.r, blotch = nz.g;
  // 哈气：就是这一片的雾一下变密（更细密的一层水汽凝上来），不是另盖一层。边由大块噪声揉散成一卷卷的、
  // 细噪声让它发毛，散的时候从薄的地方先透。在白气上写的字照样擦开，水珠周围照样抹开一圈
  float breath = 0.0, melt = 0.0;
  if (uBreathOn) {
    vec3 bm = texture(uBreath, gv).rgb;
    if (bm.r > 0.003) {
      // 值噪声直接取阈值会露出横平竖直的格子：每层转一个角度、叠三层，边缘才是一卷卷的
      vec2 r1 = mat2(0.80, -0.60, 0.60, 0.80) * px, r2 = mat2(0.36, 0.93, -0.93, 0.36) * px;
      float bn = vnoise(r1 / 34.0 + 7.0) * 0.55 + vnoise(r2 / 15.0 + 2.3) * 0.3 + vnoise(px / 6.5) * 0.15;
      float bth = 0.3 + (bn - 0.5) * 0.5;
      float cover = smoothstep(bth - 0.2, bth + 0.25, bm.r);
      breath = cover * bm.g * uBreathThick;
      // 白气漫到哪，那儿被盖住的旧字跟着糊开（B 通道，只在鼓开的那一阵）
      melt = cover * bm.b;
    }
  }
  float m = texture(uMask, gv).r;
  // 被白气盖住的旧字：遮罩在周围一圈取几下（每个像素转一个角度，糊出来是颗粒的雾气，不是几道重影），字先糊开、边变软，
  // 再随 yieldFactor 淡进雾里
  if (melt > 0.01) {
    float rad = melt * 0.014 * uRes.y, a0 = hash(px) * 6.2832, acc = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = a0 + float(i) * 0.7854, rr = rad * ((i & 1) == 0 ? 1.0 : 0.5);
      acc += texture(uMask, gv + vec2(cos(a), sin(a)) * rr / uRes).r;
    }
    m = mix(m, acc / 8.0, melt);
  }
  float th = 0.3 + (fine - 0.5) * 0.22 * uEdge + (blotch - 0.5) * 0.12;
  float clear = smoothstep(th - 0.05 - 0.12 * melt, th + 0.06 + 0.06 * melt, m);
  // 白气铺开后，盖掉的旧字在遮罩上留着 BREATH_GHOST（nebbiaScene.ts）那么一点：比阈值低、不透出窗外，
  // 只让那儿的白气薄一点，糊糊的留个浅浅的印子。在周围四下取样糊开；新写的字在遮罩上是满的，取到的有一下超过 0.15
  // 就是挨着新字，不薄（不然新字外面也薄一圈）
  if (breath > 0.001) {
    float gr = 0.006 * uRes.y, ga = hash(px + 17.0) * 6.2832, gm = 0.0, gx = m;
    for (int i = 0; i < 4; i++) {
      float a = ga + float(i) * 1.5708, g = texture(uMask, gv + vec2(cos(a), sin(a)) * gr / uRes).r;
      gm += g; gx = max(gx, g);
    }
    breath *= 1.0 - 0.55 * smoothstep(0.0, 0.07, gm * 0.25) * (1.0 - smoothstep(0.1, 0.15, gx));
  }
  // 雾：模糊的窗外提亮发灰，光晕散得更开，加浓淡起伏和细颗粒，下半部分略浓
  float dens = uMist * (0.82 + 0.3 * vnoise(px / 380.0 + uTime * 0.015)) * (0.9 + 0.2 * vUv.y) + breath * 0.9;
  vec3 haze = vec3(0.70, 0.74, 0.78);
  vec3 blur = vec3(0.0), glow = vec3(0.0);
  if (!uSeeThrough) {
#if NEBBIA_FOG_TEX
  // 预渲染纹理的第 0 行是 vUv.y = 1（屏幕底部），所以纵向翻一下
  vec2 fu = vec2(vUv.x, 1.0 - vUv.y);
  blur = texture(uFogBlur, fu).rgb;
  glow = texture(uFogGlow, fu).rgb;
#else
  blur = scene(q, 0.03);
  glow = scene(q, 0.09);
#endif
  }
  // 密到普通雾的范围以上（哈气）时，窗外再暗一点、乳白再多一点
  vec3 fog = blur * max(0.08, 1.0 - 0.45 * dens - 0.25 * breath) + glow * 0.9 * dens + haze * (0.2 * dens + 0.25 * breath);
  // 透明时雾的浓淡就是不透明度，颜色是 uMistTint
  float alpha = 1.0;
  if (uSeeThrough) {
    // 深色的雾叠在暗桌面上不显，比白雾浓一点
    alpha = clamp((0.62 * dens + 0.3 * breath) * mix(1.3, 1.0, dot(uMistTint, vec3(0.333))), 0.0, 0.92);
    fog = uMistTint * alpha;
  }
  // 透明时颗粒乘不透明度：雾很淡的地方不在后面的东西上撒亮点
  fog += (hash(px) - 0.5) * 0.025 * alpha;
  // 聚光灯照到玻璃上：雾里的小水滴把光散开，字周围一圈雾被照成强调色
  vec2 sd = q - uSpotTgt;
  fog += uLa * uSpotI * exp(-dot(sd, sd) / (uSpotR * uSpotR * 2.2)) * (0.18 + 0.4 * dens);
  fog += smoothstep(0.78, 0.98, nz.b) * 0.05 * dens;
  // 水珠纹理：擦痕边 / 下淌的水珠 rd，雾上的凝结水珠 fd（擦开的地方没有）
  vec4 rd = texture(uDrop, gv);
  vec4 fd = texture(uField, gv) * (1.0 - clear);
  // 和 raindrop-fx 一样，水珠周围一圈的雾也被抹掉
  clear = max(clear, smoothstep(0.93, 1.0, rd.a));
  vec3 col = fog;
  if (clear > 0.001) {
    // 擦开的地方：清晰的窗外，留一层很薄的水膜
    vec3 wiped = (uSeeThrough ? vec3(0.0) : scene(q, 0.0012) * 1.05) + haze * 0.02 * dens;
    float rim = clear * (1.0 - clear) * 4.0;
    col = mix(fog, wiped, clear) + rim * haze * 0.16 * dens;
    if (uSeeThrough) alpha = mix(alpha, 0.02 * dens, clear) + rim * 0.16 * dens;
  }
  // 合成方式照搬 raindrop-fx 的 compose.glsl：阈值成形、按法线折射清晰的窗外、按光照明暗
  vec4 comp = vec4(rd.rgb + fd.rgb - 2.0 * rd.rgb * fd.rgb, max(rd.a, fd.a));
  float dmask = smoothstep(0.96, 0.99, comp.a);
  if (dmask > 0.001) {
    vec2 nn = comp.rg - 0.5;
    vec2 ruv = sv + vec2(-nn.x, nn.y) * (comp.b * 0.6 + 0.4) * uRefract;
    // 雾笺 demo 用的是轻度模糊的背景、漫反射 0.2–0.5、高光指数 48
    vec3 lens;
#if defined(NEBBIA_DEW) && NEBBIA_FOG_TEX
    // 凝露的细水珠又密又小，每个像素重算一遍窗外太贵：读预渲染好的同样模糊（0.006）的窗外，低分辨率下放大看不出差别。
    // 擦痕边的水珠（rd 占上风）照旧现算
    if (!uSeeThrough && fd.a > rd.a) lens = texture(uFogSharp, vec2(ruv.x - uSceneShift.x, 1.0 - ruv.y + uSceneShift.y)).rgb;
    else
#endif
    lens = scene(vec2(ruv.x * aspect, ruv.y), 0.006);
    vec3 normal = normalize(vec3(nn * 2.0, 1.0));
    vec3 lightDir = normalize(vec3(-1.0, 1.0, 2.0));
    float lambert = clamp(dot(lightDir, normal), 0.0, 1.0);
    float spec = pow(max(dot(normal, normalize(lightDir + vec3(0.0, 0.0, 1.0))), 0.0), 48.0);
    lens += (lambert - 0.8) * vec3(0.3, 0.3, 0.32) + spec * vec3(0.3, 0.3, 0.33) * uGlint;
    if (uSeeThrough) {
      // 和 raindrop-fx 一样，水珠是一颗透镜，里面是折射过来的背景。透明时拿不到窗后面的画面，折射的还是雾笺自己的
      // 窗外（选了水族箱折射水族箱，别的折射雨夜街景）。白雾时水珠不透明：街景比雾暗，和透出后面的字一样是暗的；
      // 深色雾时字透出的后面比雾亮，水珠也要以透出后面为主：街景留一半不到，边上一圈折射的暗边
      float dark = 1.0 - dot(uMistTint, vec3(0.333));
      float rimA = (1.0 - smoothstep(0.975, 0.995, comp.a)) * 0.21;
      float da = mix(1.0, 0.47 + rimA, dark);
      lens = max(lens, vec3(0.0)) * mix(1.0, 0.47, dark);
      alpha = mix(alpha, da, dmask);
    } else {
      // 车厢里的灯照在水珠表面：比纯透过去的窗外亮一点，不会在灰白的雾上显成黑点
      lens = max(lens, fog * 0.55) + haze * 0.08 * dens;
#ifdef NEBBIA_DEW
      // 凝露玻璃上的细小冷凝水珠（nebbiaCondensation.ts）：后面暗（水族箱的水、夜里的街）时照常画会像一粒粒脏点；
      // 按挂在玻璃上的水珠画，比雾亮一点、带一点高光。擦痕边的水珠（rd 占上风的地方）照旧
      float fine = step(rd.a, fd.a);
      lens = mix(lens, max(lens * 1.15, fog * (1.0 + 0.051 * uDewGlint)) + (spec * 0.544 + lambert * 0.068) * dens * uDewGlint, fine);
#endif
    }
    col = mix(col, lens, dmask);
  }
  outColor = uSeeThrough ? vec4(max(col, 0.0), alpha) : vec4(col, 1.0);
}`;

/** 主画面：用预渲染的雾。 */
export const NEBBIA_MAIN_FS = MAIN_FS(true);
/** 主画面：雾自己算（不支持浮点渲染目标时）。 */
export const NEBBIA_MAIN_FALLBACK_FS = MAIN_FS(false);

/**
 * 窗外场景和玻璃用的雾的预渲染和主画面（自己算雾的那一版也在）：街景配雨窗就是上面几个，水族箱换场景 GLSL 另拼一份；
 * 凝露玻璃的主画面多编一段冷凝水珠的画法（NEBBIA_DEW），雾的预渲染不看玻璃。
 */
export const nebbiaSceneShaders = (scene: NebbiaWindowScene, glass: NebbiaGlass = 'rain') => {
    const dew = glass === 'dew';
    if (scene === 'aquarium') return { fog: fogFs(AQUA_UNIFORMS), main: MAIN_FS(true, AQUA_UNIFORMS, dew), mainFallback: MAIN_FS(false, AQUA_UNIFORMS, dew) };
    if (dew) return { fog: NEBBIA_FOG_FS, main: MAIN_FS(true, SCENE_UNIFORMS, true), mainFallback: MAIN_FS(false, SCENE_UNIFORMS, true) };
    return { fog: NEBBIA_FOG_FS, main: NEBBIA_MAIN_FS, mainFallback: NEBBIA_MAIN_FALLBACK_FS };
};

// 水珠精灵：实例化四边形画进水珠纹理，混合方式同 raindrop-fx 的 "smoother"
export const NEBBIA_SPRITE_VS = /* glsl */ `#version 300 es
in vec2 aCorner; in vec4 aRect; in vec2 aParam;
uniform vec2 uView;
out vec2 vUV; out float vSize; out float vAlpha;
void main() {
  vec2 p = aRect.xy + (aCorner - 0.5) * aRect.zw;
  vUV = aCorner; vSize = aParam.x; vAlpha = aParam.y;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, p.y / uView.y * 2.0 - 1.0, 0.0, 1.0);
}`;

export const NEBBIA_SPRITE_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D uSprite;
in vec2 vUV; in float vSize; in float vAlpha; out vec4 o;
void main() {
  vec4 c = texture(uSprite, vUV);
  c.a *= vAlpha;
  o = vec4(c.rg * c.a, vSize * c.a, c.a);
}`;
