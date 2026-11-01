// src/components/visualizer/nebbia/nebbiaSpotGlsl.ts
// 打向正在写的字的两盏聚光灯的光柱（GLSL，scene() 最后叠上去），从 nebbiaSceneGlsl.ts 拆出。
export const NEBBIA_SPOT_GLSL = /* glsl */ `
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
`;
