// src/components/visualizer/nebbia/nebbiaBubbleGlsl.ts
// 水族箱里的气泡（GLSL，nebbiaAquaGlsl.ts 拼进去）：像温泉，海底零散几个泉眼一股股往上冒细泡（窗外「雨」那一项：斜着、竖直、不冒），
// 偶尔一个大泡慢慢晃着浮上去（「车灯」那一项）。uBubbles 是多少（设置里的滑杆）。
// 智能动感模式「舞潮踏拍」的气泡一项：每拍从沙底冒出一排大泡，先冲一下再慢慢浮（每排的位置、时刻由 nebbiaAquarium.ts 给）；
// 开着时不冒随机的大泡，细泡照常一直冒。
// 一颗泡边缘按菲涅尔变亮、上沿受光，里面略暗，左上高光、右下反高光、底部聚起一小团光；很小的泡只是一个亮点。
// 雾后面细泡看不清，只算每股一道淡淡的光；模糊时泡的光和压暗按面积摊薄，不会糊成暗心的光圈。
export const NEBBIA_BUBBLE_GLSL = /* glsl */ `
uniform float uBubbles;
// 跟拍冒的每排：x、冒出的时刻、大小（0 是空格）、种子
uniform vec4 uBurst[12];
uniform int uBurstN;
// 1 时舞潮踏拍的气泡一项开着：不冒随机的大泡
uniform float uBeatRows;
// 一颗泡（d 是到泡心的偏移，y 朝下）：rgb 加上去的光，a 泡里压暗多少
vec4 aqBubble(vec2 d, float rad, float b) {
  float l = length(d), aa = max(b, 0.0005);
  float keep = rad * rad / (rad * rad + b * b * 4.0);
  float disc = smoothstep(rad + aa, rad - aa, l);
  float up = 0.5 + 0.5 * clamp(-d.y / max(l, 1e-5), -1.0, 1.0);
  float fres = pow(clamp(l / rad, 0.0, 1.0), 5.0) * disc * (0.35 + 0.65 * up);
  float spec = glowPt(d + vec2(rad * 0.36, rad * 0.4), rad * 0.15, b, 0.0);
  float spec2 = glowPt(d - vec2(rad * 0.32, rad * 0.42), rad * 0.1, b, 0.0) * 0.3;
  float caus = glowPt(d - vec2(0.0, rad * 0.5), rad * 0.32, b, 0.0) * 0.14;
  vec4 big = vec4(vec3(fres * 0.9 * keep + spec * 1.3 + spec2 + caus), disc * 0.14 * keep);
  vec4 tiny = vec4(vec3(glowPt(d, rad * 0.6, b, 0.0) * 1.3 + spec * 1.2), 0.0);
  return mix(tiny, big, smoothstep(0.0018, 0.0034, rad));
}
vec3 aqBubbles(vec3 col, vec2 q, float b, vec3 bc) {
  float t = uTime;
  float drift = sceneryOn(SCN_RAIN_SLANT) ? 0.1 : 0.0;
  float fade = smoothstep(0.93, 0.8, q.y);
  float qx = q.x + (0.92 - q.y) * drift;
  // 细泡：每股从一个泉眼冒出，越往上越散、泡越大一点
  if (sceneryOn(SCN_RAIN)) {
    float cw = 0.055, cx = floor(qx / cw);
    for (float k = -1.0; k <= 1.0; k++) {
      float n = cx + k;
      if (h1(n * 2.3 + 1.0) > uBubbles * 0.9) continue;
      float src = (n + 0.5) * cw + (h1(n + 3.0) - 0.5) * cw * 0.5;
      float sp = 0.14 + 0.1 * h1(n + 7.0), ch = 0.014 + 0.01 * h1(n + 5.0);
      float rise = clamp((0.92 - q.y) / 0.9, 0.0, 1.0);
      float sw = 0.003 + 0.016 * rise, swe = sqrt(sw * sw + b * b);
      float sx = qx - src;
      col += bc * exp(-sx * sx / (swe * swe)) * 0.03 * fade * (sw / swe + 0.3);
      if (b > 0.02) continue;
      float v = q.y + t * sp, iy = floor(v / ch);
      for (float j = -1.0; j <= 1.0; j++) {
        float m = iy + j, hb = h1(m * 1.31 + n * 17.0);
        if (hb > 0.85) continue;
        // 每颗在格子里上下错一点、左右散开，不排成一串珠子
        float y = (m + 0.2 + 0.6 * h1(m * 2.7 + n)) * ch - t * sp;
        float up = clamp((0.92 - y) / 0.9, 0.0, 1.0);
        float rad = 0.0012 + 0.003 * hb * hb * hb + 0.0012 * up;
        vec2 c = vec2(src + sin(m * 2.1 + t * 6.0) * (0.0015 + 0.006 * up) + (h1(m + n) - 0.5) * (0.006 + 0.03 * up), y);
        vec4 bub = aqBubble(vec2(qx, q.y) - c, rad, b);
        col = col * (1.0 - bub.a * fade) + bc * bub.rgb * fade * (0.6 + 0.4 * h1(m * 5.0 + n));
      }
    }
  }
  // 大泡：少、慢，上下略扁，边缘一边浮一边轻轻晃
  if (sceneryOn(SCN_CARS) && uBeatRows < 0.5) {
    float bw = 0.13, bx = floor(qx / bw);
    for (float k = -1.0; k <= 1.0; k++) {
      float n = bx + k;
      float sp = 0.07 + 0.04 * h1(n + 41.0), ch = 0.42;
      float iy = floor((q.y + t * sp) / ch);
      for (float j = -1.0; j <= 0.0; j++) {
        float m = iy + j;
        if (h1(m * 3.7 + n * 11.0) > min(1.1 * uBubbles, 0.85)) continue;
        float rad = 0.008 + 0.016 * pow(h1(m + n * 5.0), 1.5);
        vec2 c = vec2((n + 0.2 + 0.6 * h1(m * 7.0 + n)) * bw + sin(t * 1.3 + m) * 0.02, (m + 0.5) * ch - t * sp);
        vec2 d = vec2(qx, q.y) - c;
        // 按方向缩放偏移，轮廓就晃：sin(3θ + φ)、sin(2θ - φ') 用方向的余弦正弦展开，不用 atan
        vec2 u = d / max(length(d), 1e-5);
        float c2 = u.x * u.x - u.y * u.y, s2 = 2.0 * u.x * u.y;
        float c3 = u.x * (4.0 * u.x * u.x - 3.0), s3 = u.y * (3.0 - 4.0 * u.y * u.y);
        float f1 = t * 4.0 + m, f2 = t * 3.0;
        float shape = 1.0 + 0.03 * (s3 * cos(f1) + c3 * sin(f1)) + 0.02 * (s2 * cos(f2) - c2 * sin(f2));
        vec4 bub = aqBubble(vec2(d.x, d.y * 1.18) / shape, rad, b);
        col = col * (1.0 - bub.a * fade) + bc * (bub.rgb + glowPt(d, rad * 1.4, b, 0.0) * 0.04) * fade;
      }
    }
  }
  // 跟拍冒的一排排大泡：一排六颗，冒出时从小涨到全大，先冲一下再慢慢浮；离这一排远的像素直接跳过。
  // 每颗带一圈光晕，雾后面糊开也是一排亮点，看得出跟拍
  for (int i = 0; i < 12; i++) {
    if (i >= uBurstN) break;
    vec4 B = uBurst[i];
    float a = t - B.y;
    if (B.z <= 0.0 || a < 0.0) continue;
    float y0 = 0.9 - 0.2 * a - 0.28 * (1.0 - exp(-a * 3.0));
    if (abs(q.y - y0) > 0.08 + b * 3.0) continue;
    float grow = smoothstep(0.0, 0.15, a) * (0.55 + 0.45 * B.z);
    for (float k = 0.0; k < 6.0; k++) {
      float h = h1(B.w + k * 7.3), h2 = h1(B.w * 1.7 + k * 3.1);
      float rad = (0.008 + 0.012 * h) * grow;
      vec2 c = vec2(B.x + (k - 2.5) * 0.05 + (h2 - 0.5) * 0.02 + sin(a * 3.0 + k * 1.7) * 0.004 * a, y0 + (h - 0.5) * 0.04);
      vec2 d = vec2(qx, q.y) - c;
      vec4 bub = aqBubble(vec2(d.x, d.y * 1.18), rad, b);
      col = col * (1.0 - bub.a * fade) + bc * (bub.rgb + glowPt(d, rad * 2.0 + 0.004, b, 0.0) * 0.22) * fade;
    }
  }
  return col;
}
`;
