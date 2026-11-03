import { NEBBIA_SCENE_COMMON_GLSL } from './nebbiaSceneCommonGlsl';
import { NEBBIA_SPOT_GLSL } from './nebbiaSpotGlsl';

// src/components/visualizer/nebbia/nebbiaSceneGlsl.ts
// 公交车侧窗外的雨夜街景（GLSL，主着色器和雾的预渲染共用）：远近两层楼群、主题色霓虹散景、路灯招牌、湿路面倒影、
// 车灯、斜着落的雨，和打向正在唱的字的两盏聚光灯。scene(q, b) 里 b 是模糊半径（屏高的比例），雾后面的窗外用大的 b。
// 窗外每样都能在设置里单独关掉（uScenery）。
// 哈希、光点这些和水族箱共用的函数在 nebbiaSceneCommonGlsl.ts。
// 着色器从原型（feat/fog-write-prototype 分支 dev/prototypes/fog-write/index.html）搬来；格子伪随机数 h1 后来换成了纯算术哈希，分布不变、每格的样子和原型不同。
export const NEBBIA_SCENE_GLSL = /* glsl */ `${NEBBIA_SCENE_COMMON_GLSL}// 路灯和招牌（倒影也用它）
vec3 lampsSigns(vec2 q, float b, float t) {
  vec3 c = vec3(0.0);
  // 招牌、店面：近，移动快，带横向拖影
  float xs = q.x + t * 0.42, cw = 0.34, streak = 0.012 * uBus;
  float cs = floor(xs / cw);
  // 招牌的灯在 0.46–0.56 高、店面在 0.645（倒影调用时 q、b 不一样，各自判断）
  bool sg = abs(q.y - 0.51) < 0.05 + reach(0.016, b + 0.002), sh = abs(q.y - 0.645) < reach(0.026, b + 0.003);
  if (sg || sh) for (float k = -1.0; k <= 1.0; k++) {
    float n = cs + k;
    // 招牌、店面的灯：都画成圆的散景光斑（远处的灯失焦后是圆的），不画方块
    if (sg) {
      vec2 cen = vec2((n + 0.2 + 0.6 * h1(n)) * cw, 0.46 + 0.1 * h1(n + 17.0));
      if (h1(n + 33.0) < 0.75) c += pick(h1(n + 2.0)) * glowPt(vec2(xs, q.y) - cen, 0.006 + 0.01 * h1(n + 5.0), b + 0.002, streak) * 1.6;
    }
    // 店面：底层一两团暖光
    vec2 shop = vec2((n + 0.5) * cw, 0.645);
    if (sh && h1(n + 41.0) < 0.6) c += mix(SODIUM, pick(h1(n + 8.0)), 0.3) * glowPt(vec2(xs, q.y) - shop, 0.016 + 0.01 * h1(n + 3.0), b + 0.003, streak) * 0.9;
  }
  // 路灯：中景，灯头 + 雨里的大光晕（0.36 高，光晕半径 0.07）
  float xl = q.x + t * 0.22, lw = 0.55;
  float cl = floor(xl / lw);
  if (abs(q.y - 0.36) < reach(0.07, b)) for (float k = -1.0; k <= 1.0; k++) {
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
  // 每栋楼（连收分顶层、天线）都落在自己那一格里，左右邻居只在离格边不到模糊半径（再加天线宽）时才碰得到这个像素：
  // 离得更远时邻居的覆盖度必然是 0，跳过，画面不变。清晰窗外模糊半径很小，大部分像素只用算本格一栋
  float fx = x - c0 * cw, nbReach = aa + 0.0013;
  for (float k = -1.0; k <= 1.0; k++) {
    if ((k < 0.0 && fx > nbReach) || (k > 0.0 && cw - fx > nbReach)) continue;
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
// 从楼群缓存取一层（预乘颜色）：横向按这层的速度（building 里的 0.02、0.035）平移，环形取样
vec4 bldAt(sampler2D s, vec2 q, float t, float speed, vec3 g) {
  // 没有 mipmap；在分支里取样，用 textureLod 不依赖导数
  return textureLod(s, vec2((q.x + t * speed) / g.z, (q.y - g.x) / (g.y - g.x)), 0.0);
}
// 主题色霓虹（照雨湖的远处灯光）：楼群之间密密的彩色小散景，偶尔一大团霓虹带一圈很大的光晕。
// 颜色取这首歌的三个灯光色；移动速度介于楼群和路灯之间。倒影也用它。
vec3 neonLights(vec2 q, float b, float t) {
  vec3 c = vec3(0.0);
  float bb = b + 0.003;   // 散景本身就是虚的
  // 小散景：两排格子，每格最多一颗，落在楼群那一段高度里（0.38–0.58）
  if (abs(q.y - (HZ - 0.12)) < 0.1 + reach(0.012, bb)) for (float row = 0.0; row < 2.0; row++) {
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
  if (abs(q.y - (HZ - 0.14)) < 0.06 + reach(0.13, b)) for (float k = -1.0; k <= 1.0; k++) {
    float n = cb + k + 500.0;
    vec2 d = vec2(xb - (cb + k + 0.2 + 0.6 * h1(n)) * bw, q.y - (HZ - 0.08 - 0.12 * h1(n + 2.0)));
    vec3 lc = pick(h1(n + 4.0));
    c += lc * (glowPt(d, 0.014, bb, 0.0) * 2.0 + glowPt(d, 0.13, b, 0.0) * 0.4);
  }
  return c;
}
${NEBBIA_SPOT_GLSL}
// 公交车侧窗外的雨夜街景：远处楼群慢、路灯中速、招牌和车灯快
vec3 scene(vec2 q, float b) {
  float t = uTime * uBus;
  vec3 col = mix(uSky0, uSky1, smoothstep(0.0, HZ, q.y));
  col += mix(uLa, SODIUM, 0.4) * 0.14 * exp(-abs(q.y - HZ + 0.12) * 6.0);
  // 楼群：远近两层，远层矮、淡、窗小；近层高、细节多
  float aa = max(b, 0.0015), c0;
  // 楼群走缓存（nebbiaBuildingCache.ts）。水珠透镜（b = 0.006）折射得远，会取到缓存范围外面，照旧现算（只占几颗水珠的面积）；
  // 缓存还没画好的那档也现算
  bool bldOn = sceneryOn(SCN_BUILDINGS);
  bool cached = b < 0.002 ? uBldOn.x : (b > 0.05 ? uBldOn.z : (b > 0.02 ? uBldOn.y : false));
  if (bldOn && cached) {
    vec4 bf, bn;
    if (b > 0.05) { bf = bldAt(uBld4, q, t, 0.02, uBldGeo[2]); bn = bldAt(uBld5, q, t, 0.035, uBldGeo[2]); }
    else if (b > 0.02) { bf = bldAt(uBld2, q, t, 0.02, uBldGeo[1]); bn = bldAt(uBld3, q, t, 0.035, uBldGeo[1]); }
    else { bf = bldAt(uBld0, q, t, 0.02, uBldGeo[0]); bn = bldAt(uBld1, q, t, 0.035, uBldGeo[0]); }
    col = col * (1.0 - bf.a) + bf.rgb;
    col = col * (1.0 - bn.a) + bn.rgb;
  } else if (bldOn) {
    vec4 bf = building(q, b, t, 0.0);
    col = mix(col, bf.rgb, bf.a);
    vec4 bn = building(q, b, t, 1.0);
    col = mix(col, bn.rgb, bn.a);
  }
  // 主题色霓虹压在楼群前面；天边再铺一层很宽的主题色辉光
  bool lightsOn = sceneryOn(SCN_LIGHTS);
  if (lightsOn) {
    col += (neonLights(q, b, t) + uLa * 0.12 * exp(-abs(q.y - HZ + 0.1) * 5.0)) * uNeon;
    col += lampsSigns(q, b, t);
  }
  // 湿路面和倒影（路面关掉时车灯也没有倒影）
  float road = sceneryOn(SCN_ROAD) ? smoothstep(ROAD - aa, ROAD + aa, q.y) : 0.0;
  col = mix(col, uSky0 * 0.5, road * 0.85);
  // 倒影都乘 road，路面以上恰好是 0：直接跳过，画面不变，省掉屏上大半像素的两整套招牌、霓虹计算
  if (road > 0.0 && lightsOn) {
    vec2 qr = vec2(q.x, ROAD - (q.y - ROAD) * 0.55);
    col += lampsSigns(qr, b + 0.012, t) * road * 0.35;
    // 霓虹倒影：纵向压得更扁，所以在湿路面上拉成竖直的光柱（雨湖的倒影做法）
    vec2 qn = vec2(q.x, HZ - (q.y - ROAD) * 0.22);
    col += neonLights(qn, b + 0.008, t) * road * 0.45 * uNeon;
  }
  // 车灯：同向车道尾灯（红），对向车道前灯（白），快速掠过拖出长影
  if (sceneryOn(SCN_CARS)) for (float lane = 0.0; lane < 2.0; lane++) {
    float sp = lane < 0.5 ? 0.55 : -1.1, ly = lane < 0.5 ? 0.76 : 0.83, ww = 0.9;
    float xc = q.x + t * sp, cc = floor(xc / ww);
    vec3 lc = lane < 0.5 ? vec3(1.0, 0.18, 0.12) : vec3(1.0, 0.95, 0.85);
    // 车灯和它在路面上的倒影纵向都照不到这一行（倒影乘 road，路面以上本来就是 0）就跳过这条车道
    bool hd = abs(q.y - ly) < reach(0.004, b), rf = road > 0.0 && abs((q.y - ly) * 3.0 - 0.03) < reach(0.02, b * 2.0);
    if (!hd && !rf) continue;
    for (float k = -1.0; k <= 1.0; k++) {
      float n = cc + k + lane * 50.0;
      if (h1(n) > 0.6) continue;
      float cx = (cc + k + 0.2 + 0.6 * h1(n + 4.0)) * ww;
      float st = abs(sp) * 0.03 * uBus;
      if (hd) {
        c0 = glowPt(vec2(xc - cx + 0.035, q.y - ly), 0.004, b, st) + glowPt(vec2(xc - cx - 0.035, q.y - ly), 0.004, b, st);
        col += lc * c0 * 2.2;
      }
      if (rf) col += lc * glowPt(vec2(xc - cx, (q.y - ly) * 3.0 - 0.03), 0.02, b * 2.0, st) * road * 0.3;
    }
  }
  // 窗外的雨：相对车身的速度 = 往下落 + 往后（车往右开，窗外往左走），车越快越斜；停站时竖直落。
  // 雨丝只在聚光灯光柱里画（被照亮的那些）。设置里可以让它总是竖直落，或者不下（只剩光柱）
  float beam = spotBeam(q, b);
  if (!sceneryOn(SCN_RAIN)) return col + uLa * beam;
  vec2 rd = normalize(vec2(sceneryOn(SCN_RAIN_SLANT) ? -WIND * uBus : 0.0, 1.0));
  vec2 r = vec2(dot(q, rd), dot(q, vec2(-rd.y, rd.x)));
  float colId = floor(r.y / 0.007), hr = h1(colId);
  float seg = fract(r.x * (1.5 + hr) - uTime * (2.5 + hr * 2.0) * (1.0 + 0.4 * uBus) + hr * 10.0);
  float line = smoothstep(0.0012 + b, 0.0, abs(fract(r.y / 0.007) - 0.5) * 0.007) * smoothstep(0.0, 0.1, seg) * smoothstep(0.3, 0.1, seg);
  // 聚光灯：光柱叠在最前面；光柱里的雨丝被照亮
  col += uLa * beam + mix(uLa, vec3(1.0), 0.5) * line * beam * 1.6 * step(0.3, hr) * (1.0 - clamp(b * 40.0, 0.0, 1.0));
  return col;
}
`;
