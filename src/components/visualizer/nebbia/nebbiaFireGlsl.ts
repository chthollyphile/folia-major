// src/components/visualizer/nebbia/nebbiaFireGlsl.ts
// 冰的火彩（色散），nebbiaSnowGl.ts 画雪花和结了冰的水珠的冰芯（也排成雪花实例）时用：不按时间随机闪，只在固定的几何关系下出现——
// 冰面的斜面方向和身后亮光照过来的方向（雾光晕层亮度的梯度）的夹角，落在这块冰面自己固定的折射角附近时，
// 这一小段角度按色散从红到紫分开。光不动、冰不动，颜色就不变；窗外的灯移过去，彩色才沿着冰棱扫过。

export const NEBBIA_FIRE_GLSL = /* glsl */ `
// glow：雾的光晕层；fu：屏幕 uv（y 向上）；n：冰面斜面（屏幕方向，y 向上）；seed：这块冰面的随机数（定它的折射角）
vec3 fixedFire(sampler2D glow, vec2 fu, vec2 n, float seed) {
  const vec3 W = vec3(0.3, 0.59, 0.11);
  vec2 e = vec2(0.025, 0.0);
  vec2 lg = vec2(dot(textureLod(glow, fu + e.xy, 0.0).rgb - textureLod(glow, fu - e.xy, 0.0).rgb, W),
                 dot(textureLod(glow, fu + e.yx, 0.0).rgb - textureLod(glow, fu - e.yx, 0.0).rgb, W));
  float ll = length(lg), nl = length(n);
  if (ll < 1e-4 || nl < 1e-4) return vec3(0.0);
  float x = (dot(n / nl, lg / ll) - mix(0.6, 0.95, seed)) / 0.05;
  if (abs(x) >= 1.0) return vec3(0.0);
  float h = (x * 0.5 + 0.5) * 0.75;
  vec3 spec = clamp(abs(fract(h + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return spec * (1.0 - x * x) * smoothstep(0.002, 0.03, ll);
}
`;
