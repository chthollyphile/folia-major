// src/components/visualizer/nebbia/nebbiaSceneGlsl.ts
// 公交车侧窗外的雨夜街景（GLSL，主着色器和雾的预渲染共用）：远近两层楼群、主题色霓虹散景、路灯招牌、湿路面倒影、
// 车灯、斜着落的雨，和打向正在唱的字的两盏聚光灯。scene(q, b) 里 b 是模糊半径（屏高的比例），雾后面的窗外用大的 b。
// 着色器从原型（feat/fog-write-prototype 分支 dev/prototypes/fog-write/index.html）原样搬来，没有改画面。
export const NEBBIA_SCENE_GLSL = /* glsl */ `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float h1(float n) { return fract(sin(n * 127.1 + 3.7) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
vec3 pick(float h) { return h < 0.34 ? uLa : (h < 0.67 ? uLb : uLc); }
// 高斯光点：r 光点半径，b 模糊半径，streak 横向拖影半长；模糊越大越暗、越散
float glowPt(vec2 d, float r, float b, float streak) {
  d.x = sign(d.x) * max(abs(d.x) - streak, 0.0);
  float s2 = r * r + b * b;
  return (r * r / s2) * exp(-dot(d, d) / s2 * 1.6);
}
// 软边矩形：size 半宽高，soft 模糊半径
float softBox(vec2 d, vec2 size, float soft) {
  vec2 q = abs(d) - size;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float k = min(size.x, size.y);
  return (1.0 - smoothstep(-soft * 0.5, soft, sd)) * k / (k + soft * 0.6);
}
const float HZ = 0.6, ROAD = 0.7;
const float WIND = 0.6;   // 车速 1 时，雨相对车身每往下 1 就往后 0.6（和 JS 里的 WIND_DRIFT 对应）
const vec3 SODIUM = vec3(1.0, 0.68, 0.32);
// 路灯和招牌（倒影也用它）
vec3 lampsSigns(vec2 q, float b, float t) {
  vec3 c = vec3(0.0);
  // 招牌、店面：近，移动快，带横向拖影
  float xs = q.x + t * 0.42, cw = 0.34, streak = 0.012 * uBus;
  float cs = floor(xs / cw);
  for (float k = -1.0; k <= 1.0; k++) {
    float n = cs + k, hx = h1(n), hy = h1(n + 17.0);
    // 招牌、店面的灯：都画成圆的散景光斑（远处的灯失焦后是圆的），不画方块
    vec2 cen = vec2((n + 0.2 + 0.6 * hx) * cw, 0.46 + 0.1 * hy);
    if (h1(n + 33.0) < 0.75) c += pick(h1(n + 2.0)) * glowPt(vec2(xs, q.y) - cen, 0.006 + 0.01 * h1(n + 5.0), b + 0.002, streak) * 1.6;
    // 店面：底层一两团暖光
    vec2 shop = vec2((n + 0.5) * cw, 0.645);
    if (h1(n + 41.0) < 0.6) c += mix(SODIUM, pick(h1(n + 8.0)), 0.3) * glowPt(vec2(xs, q.y) - shop, 0.016 + 0.01 * h1(n + 3.0), b + 0.003, streak) * 0.9;
  }
  // 路灯：中景，灯头 + 雨里的大光晕
  float xl = q.x + t * 0.22, lw = 0.55;
  float cl = floor(xl / lw);
  for (float k = -1.0; k <= 1.0; k++) {
    vec2 d = vec2(xl - (cl + k + 0.5) * lw, q.y - 0.36);
    c += SODIUM * (glowPt(d, 0.007, b, 0.004 * uBus) * 2.6 + glowPt(d, 0.07, b, 0.0) * 0.3);
  }
  return c;
}
// 一层楼群（layer 0 = 远，1 = 近）。返回 rgb = 颜色，a = 覆盖度。
// 每格一栋：宽度、高度随机，一半带收分的顶层，少数顶上有天线；立面下亮上暗（被街灯照）、一侧有一道边光；
// 窗是小格子，每栋亮灯比例不同，有的整层全黑，亮着的窗分暖白、冷白和主题色，亮度不一。
vec4 building(vec2 q, float b, float t, float layer) {
  float near = layer;
  float x = q.x + t * mix(0.02, 0.035, near) + layer * 7.7;
  float cw = mix(0.065, 0.12, near), aa = max(b, 0.0012);
  float c0 = floor(x / cw);
  vec4 res = vec4(0.0);
  for (float k = -1.0; k <= 1.0; k++) {
    float n = c0 + k + layer * 100.0;
    float w = cw * (0.72 + 0.26 * h1(n));
    float left = (c0 + k) * cw + (cw - w) * h1(n + 1.0);
    float lx = x - left;
    float hgt = mix(0.07, 0.11, near) + mix(0.16, 0.27, near) * pow(h1(n + 2.0), 1.5);
    float base = HZ + near * 0.015;
    float top = base - hgt;
    // 收分的顶层
    bool tier = h1(n + 3.0) < 0.5;
    float tw = w * (0.5 + 0.25 * h1(n + 4.0)), tl = (w - tw) * 0.5, th = hgt * (0.12 + 0.15 * h1(n + 5.0));
    float body = smoothstep(-aa, aa, lx) * smoothstep(-aa, aa, w - lx) * smoothstep(-aa, aa, q.y - top);
    float up = tier ? smoothstep(-aa, aa, lx - tl) * smoothstep(-aa, aa, tl + tw - lx) * smoothstep(-aa, aa, q.y - (top - th)) : 0.0;
    float roof = tier ? top - th : top;
    // 天线
    float ant = h1(n + 6.0) < 0.3 ? smoothstep(0.0012 + aa, 0.0, abs(lx - w * 0.5)) * smoothstep(-aa, aa, q.y - (roof - 0.04 - 0.03 * h1(n + 7.0))) : 0.0;
    float cov = max(max(body, up), ant);
    if (cov <= 0.0) continue;
    // 立面：暗色，按楼略有差别；越往下越被街面的灯照亮；左侧一道细边光
    vec3 fac = mix(uSky0, vec3(0.015, 0.018, 0.025), 0.55) * (0.7 + 0.6 * h1(n + 8.0));
    float lowLit = pow(clamp((q.y - roof) / (base - roof), 0.0, 1.0), 2.5);
    fac += mix(SODIUM, uLa, 0.5) * 0.1 * lowLit;
    fac += mix(uSky1, uLb, 0.3) * 0.12 * smoothstep(0.003 + aa, 0.0, lx) * body;
    // 窗格
    float fh = mix(0.0075, 0.012, near), wc = mix(0.0055, 0.0085, near);
    vec2 g = vec2((lx - wc * 0.6) / wc, (q.y - roof - fh * 0.8) / fh);
    vec2 id = floor(g), f = fract(g);
    float dens = 0.15 + 0.5 * h1(n + 9.0);
    float floorOn = step(0.18, hash(vec2(id.y, n)));
    float on = step(hash(id + n * 3.7), dens) * floorOn;
    // 窗区边界跟着模糊半径变软，糊开时不出硬边
    float inside = smoothstep(-aa, aa, lx - wc * 0.6) * smoothstep(-aa, aa, w - wc * 0.6 - lx) * smoothstep(-aa, aa, q.y - roof - fh * 0.8) * smoothstep(-aa, aa, base - fh - q.y);
    float pane = smoothstep(0.32, 0.22, abs(f.x - 0.5)) * smoothstep(0.3, 0.2, abs(f.y - 0.5));
    // 被雾糊开时窗格变成平均亮度，不闪
    float blurMix = clamp(b / (wc * 0.8), 0.0, 1.0);
    float win = mix(pane * on, 0.3 * dens * 0.82, blurMix) * inside * max(body, up);
    float hc = hash(id + n * 1.3);
    vec3 wcol = hc < 0.5 ? vec3(1.0, 0.78, 0.5) : (hc < 0.8 ? vec3(0.78, 0.88, 1.0) : pick(hash(id + 5.0)));
    // 糊开时每格的颜色、亮度也换成平均值，否则会出现马赛克
    wcol = mix(wcol * (0.55 + 0.6 * hash(id + 2.9)), vec3(0.95, 0.82, 0.66) * 0.85, blurMix);
    vec3 bc = fac + wcol * win * mix(0.7, 1.0, near);
    // 远层被大气冲淡，往天色靠
    bc = mix(bc, mix(uSky0, uSky1, 0.7), mix(0.45, 0.12, near));
    res = vec4(mix(res.rgb, bc, cov), max(res.a, cov));
  }
  return res;
}
// 主题色霓虹（照雨湖的远处灯光）：楼群之间密密的彩色小散景，偶尔一大团霓虹带一圈很大的光晕。
// 颜色取这首歌的三个灯光色；移动速度介于楼群和路灯之间。倒影也用它。
vec3 neonLights(vec2 q, float b, float t) {
  vec3 c = vec3(0.0);
  float bb = b + 0.003;   // 散景本身就是虚的
  // 小散景：两排格子，每格最多一颗，落在楼群那一段高度里
  for (float row = 0.0; row < 2.0; row++) {
    float x = q.x + t * (0.06 + row * 0.03) + row * 7.3, cw = 0.045 - row * 0.012;
    float c0 = floor(x / cw);
    for (float k = -1.0; k <= 1.0; k++) {
      float n = c0 + k + row * 300.0;
      if (h1(n + 11.0) > 0.85) continue;
      vec2 cen = vec2((c0 + k + 0.15 + 0.7 * h1(n)) * cw, HZ - 0.02 - 0.2 * pow(h1(n + 3.0), 1.6));
      float r = 0.004 + 0.008 * pow(h1(n + 6.0), 3.0);
      c += pick(h1(n + 9.0)) * glowPt(vec2(x, q.y) - cen, r, bb, 0.0) * (1.0 + 1.8 * h1(n + 13.0));
    }
  }
  // 大霓虹：稀疏，一个亮核 + 一圈很大的同色光晕（雨湖左边那盏洋红灯）
  float xb = q.x + t * 0.1, bw = 0.75, cb = floor(xb / bw);
  for (float k = -1.0; k <= 1.0; k++) {
    float n = cb + k + 500.0;
    vec2 d = vec2(xb - (cb + k + 0.2 + 0.6 * h1(n)) * bw, q.y - (HZ - 0.08 - 0.12 * h1(n + 2.0)));
    vec3 lc = pick(h1(n + 4.0));
    c += lc * (glowPt(d, 0.014, bb, 0.0) * 2.0 + glowPt(d, 0.13, b, 0.0) * 0.4);
  }
  return c;
}
// 聚光灯光柱：从楼底的光源射向玻璃上的光斑，越近越宽越亮；b 是模糊半径（雾后面看光柱更散）
float beamFrom(vec2 src, vec2 q, float b) {
  vec2 d = uSpotTgt - src;
  float L = length(d);
  if (uSpotI <= 0.0 || L < 1e-3) return 0.0;
  d /= L;
  vec2 rel = q - src;
  float along = dot(rel, d);
  // 到「光源—光斑」这条线段的距离，不是到无限长中轴线的：末端是以光斑为圆心的圆头。
  // 原来按中轴线算、再沿光柱方向平切，末端是一道和光柱一样宽的平口；两盏灯从不同角度打到同一处，
  // 两个平口的角露在光斑两侧，看着像个 X
  float perp = length(rel - d * clamp(along, 0.0, L));
  float k = clamp(along / L, 0.0, 1.0);
  float w = mix(0.004, uSpotR * 0.9, k) + b;
  float body = exp(-perp * perp / (w * w)) * smoothstep(-0.01, 0.04, along) * (0.25 + 0.75 * k * k);
  // 光源本身：楼底一颗很亮的灯
  float lamp = exp(-dot(rel, rel) / (0.00004 + b * b * 0.25)) * 2.5 / (1.0 + b * 50.0);
  return (body * 0.7 + lamp) * uSpotI;
}
// 左右两盏，光源左右对称，打到同一个字上
float spotBeam(vec2 q, float b) { return beamFrom(uSpotSrc, q, b) + beamFrom(uSpotSrc2, q, b); }
// 公交车侧窗外的雨夜街景：远处楼群慢、路灯中速、招牌和车灯快
vec3 scene(vec2 q, float b) {
  float t = uTime * uBus;
  vec3 col = mix(uSky0, uSky1, smoothstep(0.0, HZ, q.y));
  col += mix(uLa, SODIUM, 0.4) * 0.14 * exp(-abs(q.y - HZ + 0.12) * 6.0);
  // 楼群：远近两层，远层矮、淡、窗小；近层高、细节多
  float aa = max(b, 0.0015), c0;
  vec4 bf = building(q, b, t, 0.0);
  col = mix(col, bf.rgb, bf.a);
  vec4 bn = building(q, b, t, 1.0);
  col = mix(col, bn.rgb, bn.a);
  // 主题色霓虹压在楼群前面；天边再铺一层很宽的主题色辉光
  col += (neonLights(q, b, t) + uLa * 0.12 * exp(-abs(q.y - HZ + 0.1) * 5.0)) * uNeon;
  col += lampsSigns(q, b, t);
  // 湿路面和倒影
  float road = smoothstep(ROAD - aa, ROAD + aa, q.y);
  col = mix(col, uSky0 * 0.5, road * 0.85);
  // 倒影都乘 road，路面以上恰好是 0：直接跳过，画面不变，省掉屏上大半像素的两整套招牌、霓虹计算
  if (road > 0.0) {
    vec2 qr = vec2(q.x, ROAD - (q.y - ROAD) * 0.55);
    col += lampsSigns(qr, b + 0.012, t) * road * 0.35;
    // 霓虹倒影：纵向压得更扁，所以在湿路面上拉成竖直的光柱（雨湖的倒影做法）
    vec2 qn = vec2(q.x, HZ - (q.y - ROAD) * 0.22);
    col += neonLights(qn, b + 0.008, t) * road * 0.45 * uNeon;
  }
  // 车灯：同向车道尾灯（红），对向车道前灯（白），快速掠过拖出长影
  for (float lane = 0.0; lane < 2.0; lane++) {
    float sp = lane < 0.5 ? 0.55 : -1.1, ly = lane < 0.5 ? 0.76 : 0.83, ww = 0.9;
    float xc = q.x + t * sp, cc = floor(xc / ww);
    vec3 lc = lane < 0.5 ? vec3(1.0, 0.18, 0.12) : vec3(1.0, 0.95, 0.85);
    for (float k = -1.0; k <= 1.0; k++) {
      float n = cc + k + lane * 50.0;
      if (h1(n) > 0.6) continue;
      float cx = (cc + k + 0.2 + 0.6 * h1(n + 4.0)) * ww;
      float st = abs(sp) * 0.03 * uBus;
      c0 = glowPt(vec2(xc - cx + 0.035, q.y - ly), 0.004, b, st) + glowPt(vec2(xc - cx - 0.035, q.y - ly), 0.004, b, st);
      col += lc * c0 * 2.2;
      col += lc * glowPt(vec2(xc - cx, (q.y - ly) * 3.0 - 0.03), 0.02, b * 2.0, st) * road * 0.3;
    }
  }
  // 窗外的雨：相对车身的速度 = 往下落 + 往后（车往右开，窗外往左走），车越快越斜；停站时竖直落
  vec2 rd = normalize(vec2(-WIND * uBus, 1.0));
  vec2 r = vec2(dot(q, rd), dot(q, vec2(-rd.y, rd.x)));
  float colId = floor(r.y / 0.007), hr = h1(colId);
  float seg = fract(r.x * (1.5 + hr) - uTime * (2.5 + hr * 2.0) * (1.0 + 0.4 * uBus) + hr * 10.0);
  float line = smoothstep(0.0012 + b, 0.0, abs(fract(r.y / 0.007) - 0.5) * 0.007) * smoothstep(0.0, 0.1, seg) * smoothstep(0.3, 0.1, seg);
  // 聚光灯：光柱叠在最前面；光柱里的雨丝被照亮
  float beam = spotBeam(q, b);
  col += uLa * beam + mix(uLa, vec3(1.0), 0.5) * line * beam * 1.6 * step(0.3, hr) * (1.0 - clamp(b * 40.0, 0.0, 1.0));
  return col;
}
`;
