import { enableF16, kStep, tileVector, tiles, type GemmMode } from '../htdemucsWgsl/kernels';

// src/services/analysis/strokesWgsl/kernels.ts
// WGSL for the stroke-order models' dense parts: one 64 x 64 tiled GEMM (htdemucsWgsl's tiles and 16-deep
// K step, so GemmMode 'f16' means the same there and here: f16 tiles and products over each K step, f32
// accumulation, f32 in memory) specialised two ways -
//   CONV: an implicit-GEMM Conv2d over a batch of channel-major images ([z, c, h, w], z = workgroup z),
//         optionally reading its input through GroupNorm + SiLU (the norm a Res / Block applies before
//         its conv folded into the gather, so the normalised tensor is never written);
//   LINEAR: token-major rows [rows, in] x weight [out, in]^T, optionally through a LayerNorm whose row
//           statistics the workgroup computes itself (one dispatch for pre-LN + Linear), with bias,
//           SiLU / ReLU, accumulate-into (residual), row tables, and a q|k|v store that writes k, v straight
//           into the decoder's KV cache at row t.
// - plus GroupNorm statistics (two passes, per-chunk mean / M2 merged as Chan et al.) and the few
// elementwise passes the encoders need (FPN fuse, pooling, nearest-upsample concat, token transposes).
//
// Every weight lives in one u32 buffer (packed.ts): f16 matrices read as unpack2x16float pairs, biases,
// norms and tables as bitcast f32, all addressed by word offsets in the uniforms.
// Rows of a decode-time LINEAR can be dynamic: rows = state.active * rowMul, the active count written by
// the host after each done-readback (full6.ts), so one recorded graph serves every batch size.

export type { GemmMode };

/** Weight-buffer access shared by every kernel here and in kernelsSeq.ts. */
export const WEIGHTS = /* wgsl */ `
@group(0) @binding(0) var<storage, read> W: array<u32>;
fn wf(i: u32) -> f32 { return bitcast<f32>(W[i]); }
fn wh(base: u32, e: u32) -> f32 {
  let pair = unpack2x16float(W[base + (e >> 1u)]);
  return select(pair.x, pair.y, (e & 1u) == 1u);
}
fn silu(v: f32) -> f32 { return v / (1.0 + exp(-v)); }
`;

/**
 * The shared GEMM body: Y[M, N] = A[M, K] . B[K, N] through aload / bload / store, 64 x 64 per workgroup, z = batch.
 * No early return for an idle workgroup: a row count read from storage is not uniform for the barriers, so
 * the host dispatches exactly ceil(M / 64) x ceil(N / 64) and the loads / stores are bounds-checked.
 */
const gemmBody = (mode: GemmMode, prologue: string) => /* wgsl */ `
${tiles(mode)}
var<private> zi: u32;
var<private> r0p: u32;
@compute @workgroup_size(16, 16)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u, @builtin(local_invocation_index) li: u32) {
  zi = wg.z;
  let M = dimM();
  let N = dimN();
  let K = dimK();
  let row0 = wg.y * 64u;
  let col0 = wg.x * 64u;
  r0p = row0;
  ${prologue}
  var acc: array<vec4f, 4>;
  for (var k0 = 0u; k0 < K; k0 += 16u) {
    let ak = k0 + li % 16u;
    var av = vec4f(0.0);
    let bk = k0 + li / 16u;
    var bv = vec4f(0.0);
    for (var c = 0u; c < 4u; c++) {
      let ar = row0 + (li / 16u) * 4u + c;
      if (ar < M && ak < K) { av[c] = aload(ar, ak); }
      let bc = col0 + (li % 16u) * 4u + c;
      if (bk < K && bc < N) { bv[c] = bload(bk, bc); }
    }
    as_[(li % 16u) * 16u + li / 16u] = ${tileVector(mode, 'av')};
    bs_[li] = ${tileVector(mode, 'bv')};
    workgroupBarrier();${kStep(mode)}
    workgroupBarrier();
  }
  for (var i = 0u; i < 4u; i++) {
    let r = row0 + l.y * 4u + i;
    if (r >= M) { continue; }
    for (var j = 0u; j < 4u; j++) {
      let c = col0 + l.x * 4u + j;
      if (c >= N) { continue; }
      store(r, c, acc[i][j]);
    }
  }
}
`;

export interface Kernel {
    code: string;
    /** Storage bindings in binding order (W is always 0); the uniform `p`, when there is one, comes after them. */
    bindings: string[];
    uniform: boolean;
}

/** CONV flags. */
export const CONV_ACCUM = 1;

/**
 * Conv2d as an implicit GEMM over a batch of images: x [z, cin, hin, win] -> y [z, m, hout, wout], weights
 * [m, cin*kh*kw]. `gn`: the input read through GroupNorm (8 groups, stats [z*8+g] = mean, rstd from
 * GN_STATS) + affine + SiLU, zero padding after it. CONV_ACCUM adds into y (a residual).
 */
export const convKernel = (mode: GemmMode, gn: boolean): Kernel => ({
    bindings: gn ? ['W', 'x', 'y', 'st'] : ['W', 'x', 'y'],
    uniform: true,
    code: /* wgsl */ `
${enableF16(mode)}
${WEIGHTS}
struct P { m: u32, k: u32, cin: u32, kh: u32, kw: u32, s: u32, pad: u32, hin: u32, win: u32, hout: u32, wout: u32, w: u32, b: u32, gg: u32, gb: u32, flags: u32 }
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
${gn ? '@group(0) @binding(3) var<storage, read> st: array<f32>;\n@group(0) @binding(4) var<uniform> p: P;' : '@group(0) @binding(3) var<uniform> p: P;'}
fn dimM() -> u32 { return p.m; }
fn dimN() -> u32 { return p.hout * p.wout; }
fn dimK() -> u32 { return p.k; }
fn aload(m: u32, k: u32) -> f32 { return wh(p.w, m * p.k + k); }
fn bload(k: u32, n: u32) -> f32 {
  let taps = p.kh * p.kw;
  let ci = k / taps;
  let r = k - ci * taps;
  let a = r / p.kw;
  let c = r - a * p.kw;
  let ho = n / p.wout;
  let wo = n - ho * p.wout;
  let hi = i32(ho * p.s + a) - i32(p.pad);
  let wi = i32(wo * p.s + c) - i32(p.pad);
  if (hi < 0 || hi >= i32(p.hin) || wi < 0 || wi >= i32(p.win)) { return 0.0; }
  let v = x[((zi * p.cin + ci) * p.hin + u32(hi)) * p.win + u32(wi)];
  ${gn ? `let g = zi * 8u + ci / (p.cin / 8u);
  return silu((v - st[g * 2u]) * st[g * 2u + 1u] * wf(p.gg + ci) + wf(p.gb + ci));` : 'return v;'}
}
fn store(r: u32, c: u32, sum: f32) {
  let v = sum + wf(p.b + r);
  let o = (zi * p.m + r) * p.hout * p.wout + c;
  if ((p.flags & ${CONV_ACCUM}u) != 0u) { y[o] = y[o] + v; } else { y[o] = v; }
}
${gemmBody(mode, '')}
`,
});

/** LINEAR flags. */
export const LIN_SILU = 1;
export const LIN_ACCUM = 2;
export const LIN_TAB = 4;
export const LIN_VEC = 8;
export const LIN_RELU = 16;
/** A is channel-major per group of rpz rows: x[((m / rpz) * K + k) * rpz + m % rpz] (the encoder's 16 x 16 map as tokens). */
export const LIN_CMAJOR = 32;
export const NO_BIAS = 0xffffffff;

export type LinearInput = 'plain' | 'ln' | 'lnAdd';
export type LinearOutput = 'f32' | 'f16' | 'kv32' | 'kv16';

/** The LayerNorm prologue: mean and rstd of A rows row0..row0+63 over K, four invocations a row, two passes. */
const LN_PROLOGUE = /* wgsl */ `
  {
    let tr = li / 4u;
    let part = li % 4u;
    let m = row0 + tr;
    var s = 0.0;
    if (m < M) { for (var k = part; k < K; k += 4u) { s += araw(m, k); } }
    lnRed[li] = s;
    workgroupBarrier();
    if (part == 0u) { lnMu[tr] = (lnRed[li] + lnRed[li + 1u] + lnRed[li + 2u] + lnRed[li + 3u]) / f32(K); }
    workgroupBarrier();
    let mu = lnMu[tr];
    s = 0.0;
    if (m < M) { for (var k = part; k < K; k += 4u) { let d = araw(m, k) - mu; s += d * d; } }
    lnRed[li] = s;
    workgroupBarrier();
    if (part == 0u) { lnRs[tr] = 1.0 / sqrt((lnRed[li] + lnRed[li + 1u] + lnRed[li + 2u] + lnRed[li + 3u]) / f32(K) + 1e-5); }
    workgroupBarrier();
  }`;

/**
 * Linear over token rows: y[orow(m), yoff + n] = act(A[m] . w[n] + b[n] (+ tab[m % tabRows][n]) (+ vec[n]))
 * for n < actN (act on), plain beyond; LIN_ACCUM adds into y. A rows come from x at xrow(m) (or channel-
 * major, LIN_CMAJOR), through LayerNorm (`ln`) and plus a2 (`lnAdd`: LN(q) + pos-MLP of the refine layer).
 * `dyn`: rows = state.active * rowMul. Outputs: f32 / f16 into y, or 'kv*': columns < d into y (q, f32),
 * the rest into the KV cache `kv` at row (slot's char * tmax + t) - the decoder's q|k|v in one dispatch.
 */
export const linearKernel = (mode: GemmMode, input: LinearInput, output: LinearOutput, dyn: boolean): Kernel => {
    const kv = output === 'kv32' || output === 'kv16';
    const half = output === 'f16' || output === 'kv16' || mode === 'f16';
    const bindings = ['W', 'x', 'y'];
    if (dyn || kv) bindings.push('st');
    if (input === 'lnAdd') bindings.push('a2');
    if (kv) bindings.push('kv');
    const at = (name: string) => bindings.indexOf(name);
    const yType = output === 'f16' ? 'f16' : 'f32';
    return {
        bindings,
        uniform: true,
        code: /* wgsl */ `
${half ? 'enable f16;' : ''}
${WEIGHTS}
struct P { m: u32, n: u32, k: u32, w: u32, b: u32, lg: u32, lb: u32, rpz: u32, xzs: u32, xoz: u32, ldx: u32, xoff: u32,
  ozs: u32, ooz: u32, ldy: u32, yoff: u32, tab: u32, tabRows: u32, vec: u32, flags: u32, rowMul: u32, ld2: u32, actN: u32, d: u32, tmax: u32, kvld: u32 }
@group(0) @binding(${at('x')}) var<storage, read> x: array<f32>;
@group(0) @binding(${at('y')}) var<storage, read_write> y: array<${yType}>;
${dyn || kv ? `@group(0) @binding(${at('st')}) var<storage, read> st: array<u32>;` : ''}
${input === 'lnAdd' ? `@group(0) @binding(${at('a2')}) var<storage, read> a2: array<f32>;` : ''}
${kv ? `@group(0) @binding(${at('kv')}) var<storage, read_write> kv: array<${output === 'kv16' ? 'f16' : 'f32'}>;` : ''}
@group(0) @binding(${bindings.length}) var<uniform> p: P;
var<workgroup> lnMu: array<f32, 64>;
var<workgroup> lnRs: array<f32, 64>;
var<workgroup> lnRed: array<f32, 256>;
fn dimM() -> u32 { return ${dyn ? 'st[1] * p.rowMul' : 'p.m'}; }
fn dimN() -> u32 { return p.n; }
fn dimK() -> u32 { return p.k; }
fn araw(m: u32, k: u32) -> f32 {
  let g = m / p.rpz;
  let i = m - g * p.rpz;
  if ((p.flags & ${LIN_CMAJOR}u) != 0u) { return x[(g * p.k + k) * p.rpz + i]; }
  return x[(g * p.xzs + p.xoz + i) * p.ldx + p.xoff + k];
}
fn aload(m: u32, k: u32) -> f32 {
  ${input === 'plain' ? 'return araw(m, k);' : `let t = m - r0p;
  var v = (araw(m, k) - lnMu[t]) * lnRs[t] * wf(p.lg + k) + wf(p.lb + k);
  ${input === 'lnAdd' ? 'v += a2[m * p.ld2 + k];' : ''}
  return v;`}
}
fn bload(k: u32, n: u32) -> f32 { return wh(p.w, n * p.k + k); }
fn store(m: u32, n: u32, sum: f32) {
  var v = sum;
  if (p.b != ${NO_BIAS}u) { v += wf(p.b + n); }
  if ((p.flags & ${LIN_TAB}u) != 0u) { v += wf(p.tab + (m % p.tabRows) * p.n + n); }
  if ((p.flags & ${LIN_VEC}u) != 0u) { v += wf(p.vec + n); }
  if (n < p.actN) {
    if ((p.flags & ${LIN_SILU}u) != 0u) { v = silu(v); }
    if ((p.flags & ${LIN_RELU}u) != 0u) { v = max(v, 0.0); }
  }
  ${kv ? `if (n >= p.d) {
    let ch = st[16u + m];
    kv[(ch * p.tmax + st[0]) * p.kvld + n - p.d] = ${output === 'kv16' ? 'f16(v)' : 'v'};
    return;
  }
  let o = m * p.ldy + p.yoff + n;` : `let g = m / p.rpz;
  let o = (g * p.ozs + p.ooz + m - g * p.rpz) * p.ldy + p.yoff + n;`}
  if ((p.flags & ${LIN_ACCUM}u) != 0u) { y[o] = y[o] + ${yType}(v); } else { y[o] = ${yType}(v); }
}
${gemmBody(mode, input === 'plain' ? '' : LN_PROLOGUE)}
`,
    };
};

/** Field order of linearKernel's uniform (all u32). */
export const LINEAR_FIELDS = ['m', 'n', 'k', 'w', 'b', 'lg', 'lb', 'rpz', 'xzs', 'xoz', 'ldx', 'xoff', 'ozs', 'ooz', 'ldy', 'yoff', 'tab', 'tabRows', 'vec', 'flags', 'rowMul', 'ld2', 'actN', 'd', 'tmax', 'kvld'] as const;
export type LinearParams = Partial<Record<(typeof LINEAR_FIELDS)[number], number>>;

/** A full uniform from the fields given; identity row mapping and no options by default. */
export const linearParams = (given: LinearParams): number[] => {
    const defaults: LinearParams = { rpz: 0x7fffffff, xoz: 0, ooz: 0, xoff: 0, yoff: 0, b: NO_BIAS, tabRows: 1, flags: 0, rowMul: 1, actN: 0xffffffff, d: 0, tmax: 0, kvld: 0, lg: 0, lb: 0, tab: 0, vec: 0, ld2: 0, m: 0 };
    const all = { ...defaults, ...given };
    // Group strides default to the group size: rows map to themselves unless a side is regrouped.
    all.xzs ??= all.rpz;
    all.ozs ??= all.rpz;
    if (all.ldx === undefined) all.ldx = all.k;
    if (all.ldy === undefined) all.ldy = all.n;
    return LINEAR_FIELDS.map((field) => {
        const value = all[field];
        if (value === undefined) throw new Error(`linear uniform: ${field} missing`);
        return value;
    });
};

/**
 * GroupNorm statistics, pass 1: workgroup (part, z*8+g) takes its chunk of the group's (C/8)*HW values
 * (contiguous in [z, C, HW]) and writes count, mean and M2 about that mean (two passes over the chunk).
 */
export const GN_PARTIAL: Kernel = {
    bindings: ['x', 'pt'],
    uniform: true,
    code: /* wgsl */ `
struct P { n: u32, parts: u32 }
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read_write> pt: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
var<workgroup> red: array<f32, 256>;
fn reduce(li: u32, v: f32) -> f32 {
  red[li] = v;
  workgroupBarrier();
  for (var span = 128u; span > 0u; span >>= 1u) {
    if (li < span) { red[li] += red[li + span]; }
    workgroupBarrier();
  }
  let total = red[0];
  workgroupBarrier();
  return total;
}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let chunk = (p.n + p.parts - 1u) / p.parts;
  let lo = min(p.n, wg.x * chunk);
  let hi = min(p.n, lo + chunk);
  let base = wg.y * p.n;
  var s = 0.0;
  for (var e = lo + li; e < hi; e += 256u) { s += x[base + e]; }
  let cnt = f32(hi - lo);
  let mean = reduce(li, s) / max(cnt, 1.0);
  s = 0.0;
  for (var e = lo + li; e < hi; e += 256u) { let d = x[base + e] - mean; s += d * d; }
  let m2 = reduce(li, s);
  if (li == 0u) {
    let o = (wg.y * p.parts + wg.x) * 3u;
    pt[o] = cnt;
    pt[o + 1u] = mean;
    pt[o + 2u] = m2;
  }
}
`,
};

/** GroupNorm statistics, pass 2: one invocation per (z, group) merges its parts (Chan) into mean, 1/sqrt(var + 1e-5). */
export const GN_FINAL: Kernel = {
    bindings: ['pt', 'st'],
    uniform: true,
    code: /* wgsl */ `
struct P { groups: u32, parts: u32 }
@group(0) @binding(0) var<storage, read> pt: array<f32>;
@group(0) @binding(1) var<storage, read_write> st: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let g = id.x;
  if (g >= p.groups) { return; }
  var n = 0.0;
  var mean = 0.0;
  var m2 = 0.0;
  for (var i = 0u; i < p.parts; i++) {
    let o = (g * p.parts + i) * 3u;
    let nb = pt[o];
    if (nb == 0.0) { continue; }
    let total = n + nb;
    let delta = pt[o + 1u] - mean;
    mean += delta * (nb / total);
    m2 += pt[o + 2u] + delta * delta * (n * nb / total);
    n = total;
  }
  st[g * 2u] = mean;
  st[g * 2u + 1u] = 1.0 / sqrt(m2 / n + 1e-5);
}
`,
};

/** GroupNorm applied ([z, C, HW] -> y): SiLU of it plus `skip` (own1's Block output) when `siluSkip`, else the plain norm written channel-last [z, HW, C] in `out` (full6's fmap, f32 or f16). */
export const gnApplyKernel = (siluSkip: boolean, half: boolean): Kernel => ({
    bindings: siluSkip ? ['W', 'x', 'st', 's', 'y'] : ['W', 'x', 'st', 'y'],
    uniform: true,
    code: /* wgsl */ `
${half ? 'enable f16;' : ''}
${WEIGHTS}
struct P { c: u32, hw: u32, total: u32, g: u32, b: u32, off: u32 }
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read> st: array<f32>;
${siluSkip ? `@group(0) @binding(3) var<storage, read> s: array<f32>;
@group(0) @binding(4) var<storage, read_write> y: array<f32>;
@group(0) @binding(5) var<uniform> p: P;` : `@group(0) @binding(3) var<storage, read_write> y: array<${half ? 'f16' : 'f32'}>;
@group(0) @binding(4) var<uniform> p: P;`}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nw: vec3u) {
  let i = id.x + id.y * nw.x * 256u;
  if (i >= p.total) { return; }
  ${siluSkip ? `let plane = p.c * p.hw;
  let z = i / plane;
  let ch = (i - z * plane) / p.hw;
  let g = z * 8u + ch / (p.c / 8u);
  y[i] = silu((x[i] - st[g * 2u]) * st[g * 2u + 1u] * wf(p.g + ch) + wf(p.b + ch)) + s[i];` : `let plane = p.c * p.hw;
  let z = i / plane;
  let r = i - z * plane;
  let q = r / p.c;
  let ch = r - q * p.c;
  let g = z * 8u + ch / (p.c / 8u);
  let v = (x[(z * p.c + ch) * p.hw + q] - st[g * 2u]) * st[g * 2u + 1u] * wf(p.g + ch) + wf(p.b + ch);
  y[p.off + i] = ${half ? 'f16(v)' : 'v'};`}
}
`,
});

/** Workgroups of 256 for n elements, folded into two dimensions past the per-dimension limit. */
export const flat = (n: number): [number, number, number] => {
    const groups = Math.ceil(n / 256);
    const x = Math.min(groups, 32768);
    return [x, Math.ceil(groups / x), 1];
};

const ELEMENT_HEAD = /* wgsl */ `
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) nw: vec3u) {
  let i = id.x + id.y * nw.x * 256u;
  if (i >= p.total) { return; }`;

/** PyTorch's bilinear upsample index (scale_factor given, align_corners=False) as (i0, i1, lambda1). */
const UPSAMPLE = /* wgsl */ `
fn upIndex(dst: u32, inv: f32, size: u32) -> vec3f {
  let src = max(inv * (f32(dst) + 0.5) - 0.5, 0.0);
  let i0 = u32(src);
  let i1 = select(i0, i0 + 1u, i0 < size - 1u);
  return vec3f(f32(i0), f32(i1), src - f32(i0));
}
`;

/** full6's FPN: f = a + bilinear x2(b) + bilinear x4(c) over [z, C, 64, 64] (b at 32^2, c at 16^2). */
export const FPN_FUSE: Kernel = {
    bindings: ['a', 'b', 'c', 'y'],
    uniform: true,
    code: /* wgsl */ `
struct P { total: u32, ch: u32 }
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read> c: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
${UPSAMPLE}
fn bil(t: u32, size: u32, inv: f32, zc: u32, oy: u32, ox: u32) -> f32 {
  let iy = upIndex(oy, inv, size);
  let ix = upIndex(ox, inv, size);
  let base = zc * size * size;
  let r0 = base + u32(iy.x) * size;
  let r1 = base + u32(iy.y) * size;
  var v00 = 0.0; var v01 = 0.0; var v10 = 0.0; var v11 = 0.0;
  if (t == 0u) { v00 = b[r0 + u32(ix.x)]; v01 = b[r0 + u32(ix.y)]; v10 = b[r1 + u32(ix.x)]; v11 = b[r1 + u32(ix.y)]; }
  else { v00 = c[r0 + u32(ix.x)]; v01 = c[r0 + u32(ix.y)]; v10 = c[r1 + u32(ix.x)]; v11 = c[r1 + u32(ix.y)]; }
  let h1 = iy.z;
  let w1 = ix.z;
  return (1.0 - h1) * ((1.0 - w1) * v00 + w1 * v01) + h1 * ((1.0 - w1) * v10 + w1 * v11);
}
${ELEMENT_HEAD}
  let zc = i / 4096u;
  let r = i - zc * 4096u;
  let oy = r / 64u;
  let ox = r - oy * 64u;
  y[i] = a[i] + bil(0u, 32u, 0.5, zc, oy, ox) + bil(1u, 16u, 0.25, zc, oy, ox);
}
`,
};

/** 2 x 2 average pool: [zc, H, W] -> [zc, H/2, W/2] (`total` output elements, `w` the output width). */
export const AVG_POOL: Kernel = {
    bindings: ['x', 'y'],
    uniform: true,
    code: /* wgsl */ `
struct P { total: u32, w: u32 }
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read_write> y: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
${ELEMENT_HEAD}
  let plane = p.w * p.w;
  let zc = i / plane;
  let r = i - zc * plane;
  let oy = r / p.w;
  let ox = r - oy * p.w;
  let b = zc * plane * 4u + oy * 2u * (2u * p.w) + ox * 2u;
  y[i] = (x[b] + x[b + 1u] + x[b + 2u * p.w] + x[b + 2u * p.w + 1u]) * 0.25;
}
`,
};

/** own1's up-path input: cat[nearest x2(h) (ca channels), skip (cb channels)] at side w, per image z. */
export const UP_CAT: Kernel = {
    bindings: ['h', 's', 'y'],
    uniform: true,
    code: /* wgsl */ `
struct P { total: u32, w: u32, ca: u32, cb: u32 }
@group(0) @binding(0) var<storage, read> h: array<f32>;
@group(0) @binding(1) var<storage, read> s: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
${ELEMENT_HEAD}
  let plane = p.w * p.w;
  let cc = p.ca + p.cb;
  let z = i / (cc * plane);
  let r = i - z * cc * plane;
  let ch = r / plane;
  let q = r - ch * plane;
  if (ch < p.ca) {
    let oy = q / p.w;
    let ox = q - oy * p.w;
    let hw = p.w / 2u;
    y[i] = h[((z * p.ca + ch) * hw + oy / 2u) * hw + ox / 2u];
  } else {
    y[i] = s[(z * p.cb + ch - p.ca) * plane + q];
  }
}
`,
};

/** Channel-major [z, C, T] <-> token-major [z, T, C]: `toTokens` adds pos[t][c] (own1's bottleneck). */
export const transposeKernel = (toTokens: boolean): Kernel => ({
    bindings: toTokens ? ['W', 'x', 'y'] : ['x', 'y'],
    uniform: true,
    code: /* wgsl */ `
${toTokens ? WEIGHTS : ''}
struct P { total: u32, c: u32, t: u32, pos: u32 }
@group(0) @binding(${toTokens ? 1 : 0}) var<storage, read> x: array<f32>;
@group(0) @binding(${toTokens ? 2 : 1}) var<storage, read_write> y: array<f32>;
@group(0) @binding(${toTokens ? 3 : 2}) var<uniform> p: P;
${ELEMENT_HEAD}
  let plane = p.c * p.t;
  let z = i / plane;
  let r = i - z * plane;
  ${toTokens ? `let t = r / p.c;
  let ch = r - t * p.c;
  y[i] = x[(z * p.c + ch) * p.t + t] + wf(p.pos + t * p.c + ch);` : `let ch = r / p.t;
  let t = r - ch * p.t;
  y[i] = x[(z * p.t + t) * p.c + ch];`}
}
`,
});
