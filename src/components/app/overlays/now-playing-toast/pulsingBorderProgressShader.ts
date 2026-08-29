import { getShaderColorFromString, getShaderNoiseTexture, pulsingBorderMeta, ShaderFitOptions } from '@paper-design/shaders';
// src/components/app/overlays/now-playing-toast/pulsingBorderProgressShader.ts

/*
 * 本文件的片元着色器改自 Paper Shaders 的 pulsing-border。
 * 原始代码 Copyright 2026 Paper，Apache License 2.0，见 node_modules/@paper-design/shaders/LICENSE。
 * https://github.com/paper-design/shaders
 *
 * 相对原版的修改：
 * 1. 新增 u_progress / u_progressFade / u_progressHead：描边只画到进度处，端点按世界距离羽化，
 *    所以收尾是一个贴着描边衰减的软端点，而不是从圆心切下去的那条直线。
 * 2. 光斑的定位参数从极角换成沿边框周长的弧长，圆角矩形上的光斑和进度都是匀速走的。
 * 3. 新增 u_colorTrack / u_colorBase：整圈轨道底色 + 已完成段常亮底色，
 *    避免光斑绕到别处时整段弧暗下去（看起来像坏了）。
 */

export const pulsingBorderProgressFragmentShader = `#version 300 es
precision lowp float;

uniform float u_time;

uniform vec4 u_colorBack;
uniform vec4 u_colorTrack;
uniform vec4 u_colorBase;
uniform vec4 u_colors[${pulsingBorderMeta.maxColorCount}];
uniform float u_colorsCount;
uniform float u_roundness;
uniform float u_thickness;
uniform float u_marginLeft;
uniform float u_marginRight;
uniform float u_marginTop;
uniform float u_marginBottom;
uniform float u_softness;
uniform float u_intensity;
uniform float u_bloom;
uniform float u_spotSize;
uniform float u_spots;
uniform float u_pulse;
uniform float u_smoke;
uniform float u_smokeSize;
uniform float u_progress;
uniform float u_progressFade;
uniform float u_progressHead;

uniform sampler2D u_noiseTexture;

in vec2 v_responsiveUV;
in vec2 v_responsiveBoxGivenSize;
in vec2 v_patternUV;

out vec4 fragColor;

#define TWO_PI 6.28318530718
#define PI 3.14159265358979323846

float beat(float time) {
  float first = pow(abs(sin(time * TWO_PI)), 10.);
  float second = pow(abs(sin((time - .15) * TWO_PI)), 10.);

  return clamp(first + 0.6 * second, 0.0, 1.0);
}

float sst(float edge0, float edge1, float x) {
  return smoothstep(edge0, edge1, x);
}

float roundedBox(vec2 uv, vec2 halfSize, float distance, float cornerDistance, float thickness, float softness) {
  float borderDistance = abs(distance);
  float aa = 2. * fwidth(distance);
  float border = 1. - sst(min(mix(thickness, -thickness, softness), thickness + aa), max(mix(thickness, -thickness, softness), thickness + aa), borderDistance);
  float cornerFadeCircles = 0.;
  cornerFadeCircles = mix(1., cornerFadeCircles, sst(0., 1., length((uv + halfSize) / thickness)));
  cornerFadeCircles = mix(1., cornerFadeCircles, sst(0., 1., length((uv - vec2(-halfSize.x, halfSize.y)) / thickness)));
  cornerFadeCircles = mix(1., cornerFadeCircles, sst(0., 1., length((uv - vec2(halfSize.x, -halfSize.y)) / thickness)));
  cornerFadeCircles = mix(1., cornerFadeCircles, sst(0., 1., length((uv - halfSize) / thickness)));
  aa = fwidth(cornerDistance);
  float cornerFade = sst(0., mix(aa, thickness, softness), cornerDistance);
  cornerFade *= cornerFadeCircles;
  border += cornerFade;
  return border;
}

/**
 * 把边框附近的点映射成「从 12 点方向顺时针走过的周长」，单位与 UV 一致。
 * 圆角矩形拆成 4 段直边 + 4 段圆角弧逐段累加，所以长边和圆角上的推进速度一致；
 * 圆角吃满时退化成圆，等价于极角。out 参数返回整圈周长，调用方用它归一化。
 */
float perimeterCoord(vec2 p, vec2 halfSize, float radius, out float perimeter) {
  float rx = max(halfSize.x - radius, 0.);
  float ry = max(halfSize.y - radius, 0.);
  float arc = .5 * PI * radius;
  float edgeX = 2. * rx;
  float edgeY = 2. * ry;
  perimeter = 2. * (edgeX + edgeY) + 4. * arc;

  float c0 = rx;
  float c1 = c0 + arc;
  float c2 = c1 + edgeY;
  float c3 = c2 + arc;
  float c4 = c3 + edgeX;
  float c5 = c4 + arc;
  float c6 = c5 + edgeY;
  float c7 = c6 + arc;

  vec2 q = abs(p) - vec2(rx, ry);

  if (q.x > 0. && q.y > 0.) {
    if (p.x >= 0. && p.y >= 0.) return c0 + radius * atan(q.x, q.y);
    if (p.x >= 0.) return c2 + radius * atan(q.y, q.x);
    if (p.y < 0.) return c4 + radius * atan(q.x, q.y);
    return c6 + radius * atan(q.y, q.x);
  }
  if (q.x > q.y) {
    return (p.x >= 0.) ? c1 + (ry - p.y) : c5 + (p.y + ry);
  }
  if (p.y < 0.) return c3 + (rx - p.x);
  return (p.x >= 0.) ? p.x : c7 + (p.x + rx);
}

vec2 randomGB(vec2 p) {
  vec2 uv = floor(p) / 100. + .5;
  return texture(u_noiseTexture, fract(uv)).gb;
}

float randomG(vec2 p) {
  vec2 uv = floor(p) / 100. + .5;
  return texture(u_noiseTexture, fract(uv)).g;
}

float valueNoise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  float a = randomG(i);
  float b = randomG(i + vec2(1.0, 0.0));
  float c = randomG(i + vec2(0.0, 1.0));
  float d = randomG(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  float x1 = mix(a, b, u.x);
  float x2 = mix(c, d, u.x);
  return mix(x1, x2, u.y);
}

void main() {
  const float firstFrameOffset = 109.;
  float t = 1.2 * (u_time + firstFrameOffset);

  vec2 borderUV = v_responsiveUV;
  float pulse = u_pulse * beat(.18 * u_time);

  float canvasRatio = v_responsiveBoxGivenSize.x / v_responsiveBoxGivenSize.y;
  vec2 halfSize = vec2(.5);
  borderUV.x *= max(canvasRatio, 1.);
  borderUV.y /= min(canvasRatio, 1.);
  halfSize.x *= max(canvasRatio, 1.);
  halfSize.y /= min(canvasRatio, 1.);

  float mL = u_marginLeft;
  float mR = u_marginRight;
  float mT = u_marginTop;
  float mB = u_marginBottom;
  float mX = mL + mR;
  float mY = mT + mB;

  float thickness = .5 * u_thickness * min(halfSize.x, halfSize.y);

  halfSize.x *= (1. - mX);
  halfSize.y *= (1. - mY);

  vec2 centerShift = vec2(
  (mL - mR) * max(canvasRatio, 1.) * 0.5,
  (mB - mT) / min(canvasRatio, 1.) * 0.5
  );

  borderUV -= centerShift;
  halfSize -= mix(thickness, 0., u_softness);

  float radius = mix(0., min(halfSize.x, halfSize.y), u_roundness);
  vec2 d = abs(borderUV) - halfSize + radius;
  float outsideDistance = length(max(d, .0001)) - radius;
  float insideDistance = min(max(d.x, d.y), .0001);
  float cornerDistance = abs(min(max(d.x, d.y) - .45 * radius, .0));
  float distance = outsideDistance + insideDistance;

  float borderThickness = mix(thickness, 3. * thickness, u_softness);
  float border = roundedBox(borderUV, halfSize, distance, cornerDistance, borderThickness, u_softness);
  border = pow(border, 1. + u_softness);

  vec2 smokeUV = .3 * u_smokeSize * v_patternUV;
  float smoke = clamp(3. * valueNoise(2.7 * smokeUV + .5 * t), 0., 1.);
  smoke -= valueNoise(3.4 * smokeUV - .5 * t);
  float smokeThickness = thickness + .2;
  smokeThickness = min(.4, max(smokeThickness, .1));
  smoke *= roundedBox(borderUV, halfSize, distance, cornerDistance, smokeThickness, 1.);
  smoke = 30. * smoke * smoke;
  smoke *= mix(0., .5, pow(u_smoke, 2.));
  smoke *= mix(1., pulse, u_pulse);
  smoke = clamp(smoke, 0., 1.);
  border += smoke;

  border = clamp(border, 0., 1.);

  // 沿周长的位置，替代原版的极角：进度和光斑都按弧长走
  float perimeter;
  float travelled = perimeterCoord(borderUV, halfSize, radius, perimeter);
  perimeter = max(perimeter, 1e-6);
  float angle = travelled / perimeter;

  // 已完成弧段的遮罩：弧段外的像素按「到端点的周长距离」羽化，
  // 羽化距离与描边宽度同量级时，端点看起来是个圆头，而不是一刀切
  float progress = clamp(u_progress, 0., 1.);
  float headPosition = progress * perimeter;
  float outsideArc = (travelled <= headPosition) ? 0. : min(travelled - headPosition, perimeter - travelled);
  float fadeDistance = max(u_progressFade * perimeter, 1e-5);
  float progressMask = 1. - sst(0., fadeDistance, outsideArc);
  progressMask = mix(progressMask, 1., step(1., progress));
  progressMask *= sst(0., .004, progress);

  float shape = border;
  border *= progressMask;

  // 常亮描边：不带柔边的窄环，用来垫轨道和已完成段的底色
  float solidStroke = roundedBox(borderUV, halfSize, distance, cornerDistance, max(thickness, .002), 0.);

  vec3 trackPremul = u_colorTrack.rgb * u_colorTrack.a * solidStroke;
  float trackAlpha = u_colorTrack.a * solidStroke;
  vec3 basePremul = u_colorBase.rgb * u_colorBase.a * solidStroke * progressMask;
  float baseAlpha = u_colorBase.a * solidStroke * progressMask;

  vec3 blendColor = trackPremul + (1. - trackAlpha) * basePremul;
  float blendAlpha = trackAlpha + (1. - trackAlpha) * baseAlpha;
  vec3 addColor = blendColor;
  float addAlpha = blendAlpha;

  float bloom = 4. * u_bloom;
  float intensity = 1. + (1. + 4. * u_softness) * u_intensity;

  for (int colorIdx = 0; colorIdx < ${pulsingBorderMeta.maxColorCount}; colorIdx++) {
    if (colorIdx >= int(u_colorsCount)) break;
    float colorIdxF = float(colorIdx);

    vec3 c = u_colors[colorIdx].rgb * u_colors[colorIdx].a;
    float a = u_colors[colorIdx].a;

    for (int spotIdx = 0; spotIdx < ${pulsingBorderMeta.maxSpots}; spotIdx++) {
      if (spotIdx >= int(u_spots)) break;
      float spotIdxF = float(spotIdx);

      vec2 randVal = randomGB(vec2(spotIdxF * 10. + 2., 40. + colorIdxF));

      float time = (.1 + .15 * abs(sin(spotIdxF * (2. + colorIdxF)) * cos(spotIdxF * (2. + 2.5 * colorIdxF)))) * t + randVal.x * 3.;
      time *= mix(1., -1., step(.5, randVal.y));

      float mask = .5 + .5 * mix(
      sin(t + spotIdxF * (5. - 1.5 * colorIdxF)),
      cos(t + spotIdxF * (3. + 1.3 * colorIdxF)),
      step(mod(colorIdxF, 2.), .5)
      );

      float p = clamp(2. * u_pulse - randVal.x, 0., 1.);
      mask = mix(mask, pulse, p);

      float atg1 = fract(angle + time);
      float spotSize = .05 + .6 * pow(u_spotSize, 2.) + .05 * randVal.x;
      spotSize = mix(spotSize, .1, p);
      float sector = sst(.5 - spotSize, .5, atg1) * (1. - sst(.5, .5 + spotSize, atg1));

      sector *= mask;
      sector *= border;
      sector *= intensity;
      sector = clamp(sector, 0., 1.);

      vec3 srcColor = c * sector;
      float srcAlpha = a * sector;

      blendColor += ((1. - blendAlpha) * srcColor);
      blendAlpha = blendAlpha + (1. - blendAlpha) * srcAlpha;
      addColor += srcColor;
      addAlpha += srcAlpha;
    }
  }

  vec3 accumColor = mix(blendColor, addColor, bloom);
  float accumAlpha = mix(blendAlpha, addAlpha, bloom);
  accumAlpha = clamp(accumAlpha, 0., 1.);

  vec3 bgColor = u_colorBack.rgb * u_colorBack.a;
  vec3 color = accumColor + (1. - accumAlpha) * bgColor;
  float opacity = accumAlpha + (1. - accumAlpha) * u_colorBack.a;

  // 端点高光：贴着描边的一小段白热点，标出进度尖端；跑满和归零时收掉
  float headDistance = abs(travelled - headPosition);
  headDistance = min(headDistance, perimeter - headDistance);
  float head = u_progressHead * shape * (1. - sst(0., 2. * borderThickness, headDistance));
  head *= sst(0., .01, progress) * (1. - step(.999, progress));
  color += head;
  opacity = clamp(opacity + head, 0., 1.);

  color += 1. / 256. * (fract(sin(dot(.014 * gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453123) - .5);

  fragColor = vec4(color, opacity);
}`;

export interface ProgressBorderUniformInput {
    colors: string[];
    colorBack: string;
    colorTrack: string;
    /** 轨道整体不透明度，会乘到 colorTrack 的 alpha 上 */
    trackOpacity: number;
    colorBase: string;
    /** 已完成段底色不透明度，会乘到 colorBase 的 alpha 上 */
    baseOpacity: number;
    roundness: number;
    thickness: number;
    marginX: number;
    marginY: number;
    softness: number;
    intensity: number;
    bloom: number;
    spots: number;
    spotSize: number;
    pulse: number;
    smoke: number;
    smokeSize: number;
    /** 0-1 */
    progress: number;
    progressFade: number;
    progressHead: number;
}

/** 颜色字符串转 vec4 后再乘一个整体不透明度，方便用滑块调轨道/底色浓淡 */
const colorWithOpacity = (color: string, opacity: number): [number, number, number, number] => {
    const [r, g, b, a] = getShaderColorFromString(color);
    return [r, g, b, a * opacity];
};

/** 把组件参数翻译成着色器 uniform；sizing 部分固定用 object sizing 的默认值。 */
export const buildProgressBorderUniforms = (input: ProgressBorderUniformInput) => ({
    u_colorBack: getShaderColorFromString(input.colorBack),
    u_colorTrack: colorWithOpacity(input.colorTrack, input.trackOpacity),
    u_colorBase: colorWithOpacity(input.colorBase, input.baseOpacity),
    u_colors: input.colors.map(getShaderColorFromString),
    u_colorsCount: input.colors.length,
    u_roundness: input.roundness,
    u_thickness: input.thickness,
    u_marginLeft: input.marginX,
    u_marginRight: input.marginX,
    u_marginTop: input.marginY,
    u_marginBottom: input.marginY,
    u_softness: input.softness,
    u_intensity: input.intensity,
    u_bloom: input.bloom,
    u_spots: input.spots,
    u_spotSize: input.spotSize,
    u_pulse: input.pulse,
    u_smoke: input.smoke,
    u_smokeSize: input.smokeSize,
    u_progress: input.progress,
    u_progressFade: input.progressFade,
    u_progressHead: input.progressHead,
    u_noiseTexture: getShaderNoiseTexture(),
    u_fit: ShaderFitOptions.contain,
    u_rotation: 0,
    u_scale: 1,
    u_offsetX: 0,
    u_offsetY: 0,
    u_originX: 0.5,
    u_originY: 0.5,
    u_worldWidth: 0,
    u_worldHeight: 0,
});
