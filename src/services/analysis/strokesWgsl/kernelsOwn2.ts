import { ELEMENT_HEAD, UPSAMPLE, type Kernel } from './kernels';

// src/services/analysis/strokesWgsl/kernelsOwn2.ts
// WGSL of own2's glue (~/bihua hf/code/ownhead.py; the convs, GroupNorm, attention and query MLP are the shared
// kernels): the pen queries sampled from Fm, full6's s0 tap stored per glyph, own2's pooled 4-channel input, the concatenations of its U-Net
// (full6's channel-last fmap at 64 x 64, a bilinear x2 of the coarser level with skips and the s0 tap), the
// 16 x 16 tokens plus full6's image tokens, the pen logits at 128 x 128 and the per-ink-pixel assignment:
// logits bilinear x2 to 256 x 256, argmax, then the owner pen's nearest point (PEN_PROJECT).
//
// Element kernels run one invocation an element over `total` (flat() workgroups); every tensor is [z, C, H, W]
// f32 unless said otherwise. A chunk's glyphs are z = 0..chunk-1; full6's buffers are bound at the chunk's slots.

/** Pens a glyph may have: one logits pass keeps its queries in workgroup memory. */
export const OWN_MAX_PENS = 48;

/**
 * WGSL of ownInput.nearestOnPolyline over `verts` (x, y, along, time) lo..hi: the nearest point to (u, v) on
 * the pen's segments (projection clamped to each, first of equals) -> (along, time) there.
 */
export const PEN_PROJECT = /* wgsl */ `
fn nearestOnPen(lo: u32, hi: u32, u: f32, v: f32) -> vec2f {
  let w = verts[lo];
  var best = (u - w.x) * (u - w.x) + (v - w.y) * (v - w.y);
  var res = vec2f(w.z, w.w);
  for (var i = lo; i + 1u < hi; i++) {
    let a = verts[i];
    let b = verts[i + 1u];
    let ex = b.x - a.x;
    let ey = b.y - a.y;
    let len2 = ex * ex + ey * ey;
    var f = 0.0;
    if (len2 > 0.0) { f = clamp(((u - a.x) * ex + (v - a.y) * ey) / len2, 0.0, 1.0); }
    let du = u - (a.x + f * ex);
    let dv = v - (a.y + f * ey);
    let d = du * du + dv * dv;
    if (d < best || i == lo) { best = d; res = vec2f(a.z + f * (b.z - a.z), a.w + f * (b.w - a.w)); }
  }
  return res;
}
`;

/**
 * The pen queries, one workgroup (64, a channel each) per pen: Fm (channel-major [64, 128, 128]) of image
 * pz[pen] sampled (grid_sample, bilinear, zeros, align_corners=False) at its 32 resampled points -> [mean,
 * pt 0, 10, 21, 31] (5 x 64) + the host's 8 extras = 328 inputs of q.0.
 */
const querySide = 128;
export const OWN2_QUERY: Kernel = {
    bindings: ['fm', 'pens', 'extra', 'pz', 'qin'],
    uniform: false,
    code: /* wgsl */ `
@group(0) @binding(0) var<storage, read> fm: array<f32>;
@group(0) @binding(1) var<storage, read> pens: array<f32>;
@group(0) @binding(2) var<storage, read> extra: array<f32>;
@group(0) @binding(3) var<storage, read> pz: array<u32>;
@group(0) @binding(4) var<storage, read_write> qin: array<f32>;
fn tap(base: u32, y: f32, x: f32) -> f32 {
  if (x < 0.0 || x > ${querySide - 1}.0 || y < 0.0 || y > ${querySide - 1}.0) { return 0.0; }
  return fm[base + u32(y) * ${querySide}u + u32(x)];
}
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) c: u32) {
  let pen = wg.x;
  let base = (pz[pen] * 64u + c) * ${querySide * querySide}u;
  var mean = 0.0;
  for (var i = 0u; i < 32u; i++) {
    let ix = ((pens[(pen * 32u + i) * 2u] + 1.0) * ${querySide}.0 - 1.0) / 2.0;
    let iy = ((pens[(pen * 32u + i) * 2u + 1u] + 1.0) * ${querySide}.0 - 1.0) / 2.0;
    let x0 = floor(ix);
    let y0 = floor(iy);
    let x1 = x0 + 1.0;
    let y1 = y0 + 1.0;
    let v = tap(base, y0, x0) * ((x1 - ix) * (y1 - iy)) + tap(base, y0, x1) * ((ix - x0) * (y1 - iy))
      + tap(base, y1, x0) * ((x1 - ix) * (iy - y0)) + tap(base, y1, x1) * ((ix - x0) * (iy - y0));
    mean += v;
    if (i == 0u) { qin[pen * 328u + 64u + c] = v; }
    if (i == 10u) { qin[pen * 328u + 128u + c] = v; }
    if (i == 21u) { qin[pen * 328u + 192u + c] = v; }
    if (i == 31u) { qin[pen * 328u + 256u + c] = v; }
  }
  qin[pen * 328u + c] = mean / 32.0;
  if (c < 8u) { qin[pen * 328u + 320u + c] = extra[pen * 8u + c]; }
}
`,
};

/** full6's s0 output (enc.s0.3, a chunk's [z, 48, 128, 128]) kept per glyph: y = x, f16 storage when `half`. */
export const tapStoreKernel = (half: boolean): Kernel => ({
    bindings: ['x', 'y'],
    uniform: true,
    code: /* wgsl */ `
${half ? 'enable f16;' : ''}
struct P { total: u32 }
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read_write> y: array<${half ? 'f16' : 'f32'}>;
@group(0) @binding(2) var<uniform> p: P;
${ELEMENT_HEAD}
  y[i] = ${half ? 'f16(x[i])' : 'x[i]'};
}
`,
});

/**
 * own2's input avg_pool2d(x, 2) [z, 4, 128, 128]: channels 0, 1 (ink, inside distance) pooled from full6's
 * img [z, 3, 256, 256], 2, 3 the host-pooled trajectory maps traj [z, 2, 128, 128].
 */
export const OWN2_POOL: Kernel = {
    bindings: ['img', 'traj', 'y'],
    uniform: true,
    code: /* wgsl */ `
struct P { total: u32 }
@group(0) @binding(0) var<storage, read> img: array<f32>;
@group(0) @binding(1) var<storage, read> traj: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
${ELEMENT_HEAD}
  let z = i / 65536u;
  let c = (i / 16384u) % 4u;
  let q = i % 16384u;
  if (c >= 2u) { y[i] = traj[(z * 2u + c - 2u) * 16384u + q]; return; }
  let b = (z * 3u + c) * 65536u + (q / 128u) * 512u + (q % 128u) * 2u;
  y[i] = (img[b] + img[b + 1u] + img[b + 256u] + img[b + 257u]) * 0.25;
}
`,
};

/** m64's input cat[a [z, 64, 64, 64], fmap] [z, 192, 64, 64], fmap full6's channel-last [z][4096][128] (f16 when `half`). */
export const catFmapKernel = (half: boolean): Kernel => ({
    bindings: ['a', 'fm', 'y'],
    uniform: true,
    code: /* wgsl */ `
${half ? 'enable f16;' : ''}
struct P { total: u32 }
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> fm: array<${half ? 'f16' : 'f32'}>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
${ELEMENT_HEAD}
  let z = i / (192u * 4096u);
  let r = i - z * 192u * 4096u;
  let ch = r / 4096u;
  let q = r - ch * 4096u;
  if (ch < 64u) { y[i] = a[(z * 64u + ch) * 4096u + q]; return; }
  y[i] = f32(fm[(z * 4096u + q) * 128u + ch - 64u]);
}
`,
});

/**
 * cat[bilinear x2(h) (ca channels from side w / 2), s (cb), t (cc)] at side w: u64's input (cc = 0) and fuse's
 * (s = full6's s0 tap, f16 when `sHalf`, t = h128). Bilinear as F.interpolate(scale_factor=2, align_corners=False).
 */
export const upCatKernel = (sHalf: boolean): Kernel => ({
    bindings: ['h', 's', 't', 'y'],
    uniform: true,
    code: /* wgsl */ `
${sHalf ? 'enable f16;' : ''}
struct P { total: u32, w: u32, ca: u32, cb: u32, cc: u32 }
@group(0) @binding(0) var<storage, read> h: array<f32>;
@group(0) @binding(1) var<storage, read> s: array<${sHalf ? 'f16' : 'f32'}>;
@group(0) @binding(2) var<storage, read> t: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
${UPSAMPLE}
${ELEMENT_HEAD}
  let plane = p.w * p.w;
  let cs = p.ca + p.cb + p.cc;
  let z = i / (cs * plane);
  let r = i - z * cs * plane;
  let ch = r / plane;
  let q = r - ch * plane;
  if (ch >= p.ca + p.cb) { y[i] = t[(z * p.cc + ch - p.ca - p.cb) * plane + q]; return; }
  if (ch >= p.ca) { y[i] = f32(s[(z * p.cb + ch - p.ca) * plane + q]); return; }
  let size = p.w / 2u;
  let iy = upIndex(q / p.w, 0.5, size);
  let ix = upIndex(q % p.w, 0.5, size);
  let base = (z * p.ca + ch) * size * size;
  let r0 = base + u32(iy.x) * size;
  let r1 = base + u32(iy.y) * size;
  let v00 = h[r0 + u32(ix.x)];
  let v01 = h[r0 + u32(ix.y)];
  let v10 = h[r1 + u32(ix.x)];
  let v11 = h[r1 + u32(ix.y)];
  let h1 = iy.z;
  let w1 = ix.z;
  y[i] = (1.0 - h1) * ((1.0 - w1) * v00 + w1 * v01) + h1 * ((1.0 - w1) * v10 + w1 * v11);
}
`,
});

/**
 * The attention input: tokens [z, 256, 192] = d16's map [z, 192, 16, 16] (row-major positions) + full6's image
 * tokens g(c) + gpos, which are full6's memory rows [z][296][192] 0..255 minus kind[0] (`kind`, 192 f32).
 */
export const OWN2_TOKENS: Kernel = {
    bindings: ['x', 'mem', 'kind', 'y'],
    uniform: true,
    code: /* wgsl */ `
struct P { total: u32, memRows: u32 }
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> mem: array<f32>;
@group(0) @binding(2) var<storage, read> kind: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
${ELEMENT_HEAD}
  let z = i / 49152u;
  let r = i - z * 49152u;
  let t = r / 192u;
  let c = r - t * 192u;
  y[i] = x[(z * 192u + c) * 256u + t] + (mem[(z * p.memRows + t) * 192u + c] - kind[c]);
}
`,
};

/**
 * Pen logits at 128 x 128, one invocation a pixel of the chunk's image z: lg[z * MAXP + k][px] = Fm[z, :, px] .
 * q[z * MAXP + k] * 0.125 for its n = info[base + z] pens (rows past n are not written).
 */
export const OWN2_LOGITS: Kernel = {
    bindings: ['fm', 'qv', 'info', 'lg'],
    uniform: true,
    code: /* wgsl */ `
struct P { base: u32 }
@group(0) @binding(0) var<storage, read> fm: array<f32>;
@group(0) @binding(1) var<storage, read> qv: array<f32>;
@group(0) @binding(2) var<storage, read> info: array<u32>;
@group(0) @binding(3) var<storage, read_write> lg: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
var<workgroup> qs: array<f32, ${OWN_MAX_PENS * 64}>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let z = wg.y;
  let n = info[p.base + z];
  let first = z * ${OWN_MAX_PENS}u;
  for (var e = li; e < n * 64u; e += 256u) { qs[e] = qv[first * 64u + e]; }
  workgroupBarrier();
  let px = wg.x * 256u + li;
  let base = z * 64u * 16384u + px;
  var f: array<f32, 64>;
  for (var d = 0u; d < 64u; d++) { f[d] = fm[base + d * 16384u]; }
  for (var k = 0u; k < n; k++) {
    var s = 0.0;
    for (var d = 0u; d < 64u; d++) { s += f[d] * qs[k * 64u + d]; }
    lg[(first + k) * 16384u + px] = s * 0.125;
  }
}
`,
};

/**
 * The assignment, one invocation a 256 x 256 pixel of the chunk's image z (character g = base + z): off the ink
 * (img channel 0 <= 0.1, or no pens) (-1, -1, -1, 0); on it the pens' logits bilinear x2 from 128 x 128
 * (F.interpolate of the logits, as ownhead.py: upsampled before the argmax, never the owner map after), argmax
 * (first max), the top-1 minus top-2 gap (1e4 with one pen), then the owner's nearest point (PEN_PROJECT):
 * out[g] = (pen, along 0..1, reveal 0..1, gap). pmeta[(g * MAXP + k) * 2] = pen k's vertex range in verts.
 */
export const OWN2_ASSIGN: Kernel = {
    bindings: ['img', 'lg', 'info', 'verts', 'pmeta', 'out'],
    uniform: true,
    code: /* wgsl */ `
struct P { base: u32 }
@group(0) @binding(0) var<storage, read> img: array<f32>;
@group(0) @binding(1) var<storage, read> lg: array<f32>;
@group(0) @binding(2) var<storage, read> info: array<u32>;
@group(0) @binding(3) var<storage, read> verts: array<vec4f>;
@group(0) @binding(4) var<storage, read> pmeta: array<u32>;
@group(0) @binding(5) var<storage, read_write> out: array<vec4f>;
@group(0) @binding(6) var<uniform> p: P;
${UPSAMPLE}
${PEN_PROJECT}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let z = wg.y;
  let g = p.base + z;
  let px = wg.x * 256u + li;
  let at = g * 65536u + px;
  let n = info[g];
  if (n == 0u || img[g * 196608u + px] <= 0.1) { out[at] = vec4f(-1.0, -1.0, -1.0, 0.0); return; }
  let iy = upIndex(px / 256u, 0.5, 128u);
  let ix = upIndex(px % 256u, 0.5, 128u);
  let r0 = u32(iy.x) * 128u;
  let r1 = u32(iy.y) * 128u;
  let c0 = u32(ix.x);
  let c1 = u32(ix.y);
  let h1 = iy.z;
  let w1 = ix.z;
  let first = z * ${OWN_MAX_PENS}u;
  var best = -3.0e38;
  var second = -3.0e38;
  var arg = 0u;
  for (var k = 0u; k < n; k++) {
    let b = (first + k) * 16384u;
    let s = (1.0 - h1) * ((1.0 - w1) * lg[b + r0 + c0] + w1 * lg[b + r0 + c1]) + h1 * ((1.0 - w1) * lg[b + r1 + c0] + w1 * lg[b + r1 + c1]);
    if (s > best) { second = best; best = s; arg = k; } else if (s > second) { second = s; }
  }
  let m = (g * ${OWN_MAX_PENS}u + arg) * 2u;
  let u = (f32(px % 256u) + 0.5) / 256.0 * 2.0 - 1.0;
  let v = (f32(px / 256u) + 0.5) / 256.0 * 2.0 - 1.0;
  let hit = nearestOnPen(pmeta[m], pmeta[m + 1u], u, v);
  out[at] = vec4f(f32(arg), hit.x, hit.y, select(1.0e4, best - second, n > 1u));
}
`,
};
