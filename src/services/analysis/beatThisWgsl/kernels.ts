// src/services/analysis/beatThisWgsl/kernels.ts
// WGSL sources for the hand-written Beat This! forward pass, fp32. RMSNorm and RoPE have no kernels
// of their own: the norm's gamma is folded into the next Linear's weights at export, and the matmul
// scales each output row by 1/||x|| from the sum of squares of the A rows it already reads; RoPE is
// applied to the q/k columns in the QKV matmul's epilogue. Bias, GELU and the residual add are
// matmul epilogues too, and the gate is the attention's epilogue. The fp16 variants (f16 storage and
// multiplies, f32 for the sum of squares, the softmax sum and long accumulations) are measured
// against this path.
//
// Activation layout everywhere in the frontend is [F, T, C] row-major (channel-last): a token is one
// (frequency, frame) pair, so every Linear is a plain [tokens, C] matmul, and the frequency- and
// time-directed attentions read the same buffer with different strides instead of transposing it.

/** Exact GELU through erf, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7) - the form ORT's own WGSL uses. */
const GELU = /* wgsl */ `
fn erf_f32(v: f32) -> f32 {
  let a = abs(v);
  let x = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - ((((1.061405429 * x - 1.453152027) * x + 1.421413741) * x - 0.284496736) * x + 0.254829592) * x * exp(-a * a);
  return select(-y, y, v >= 0.0);
}
fn gelu(v: f32) -> f32 { return 0.5 * v * (1.0 + erf_f32(v * 0.7071067811865476)); }
`;

/** Eval-mode BatchNorm1d over the 128 mel bins, written as the [F=128, T, C=1] input of the stem conv. */
export const STEM_BN = /* wgsl */ `
struct P { frames: u32, bins: u32 }
@group(0) @binding(0) var<storage, read> mel: array<f32>;      // [T, bins]
@group(0) @binding(1) var<storage, read> scale: array<f32>;
@group(0) @binding(2) var<storage, read> shift: array<f32>;
@group(0) @binding(3) var<storage, read_write> out: array<f32>; // [bins, T]
@group(0) @binding(4) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= p.frames * p.bins) { return; }
  let f = i / p.frames;
  let t = i % p.frames;
  out[i] = mel[t * p.bins + f] * scale[f] + shift[f];
}
`;

/**
 * Conv2d with kernel (kf, 3), stride (kf, 1), padding (0, 1), BatchNorm folded into the weights, then
 * GELU. [Fin, T, Cin] -> [Fin / kf, T, Cout], computed as an implicit GEMM: rows are output tokens
 * (fo, t), K runs over (df, dt, ci) and the A tile is gathered straight from the input (zero where
 * the time tap falls off either end), so no im2col buffer exists. Same 64x64 tiling as MATMUL.
 */
export const CONV_GELU = /* wgsl */ `
${GELU}
struct P { fout: u32, frames: u32, cin: u32, cout: u32, kf: u32 }
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> w: array<f32>;   // [kf, 3, cin, cout] = [K, cout]
@group(0) @binding(2) var<storage, read> b: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
var<workgroup> as_: array<f32, 1024>; // [64 rows][16 k]
var<workgroup> bs_: array<f32, 1024>; // [16 k][64 cols]

fn gather(row: u32, k: u32) -> f32 {
  let ci = k % p.cin;
  let tap = k / p.cin;
  let dt = tap % 3u;
  let df = tap / 3u;
  let t = row % p.frames;
  let fo = row / p.frames;
  let ti = i32(t) + i32(dt) - 1;
  if (ti < 0 || ti >= i32(p.frames)) { return 0.0; }
  return x[((fo * p.kf + df) * p.frames + u32(ti)) * p.cin + ci];
}

@compute @workgroup_size(16, 16)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u, @builtin(local_invocation_index) li: u32) {
  let m = p.fout * p.frames;
  let kTotal = p.kf * 3u * p.cin;
  let row0 = wg.y * 64u;
  let col0 = wg.x * 64u;
  var acc: array<array<f32, 4>, 4>;
  for (var k0 = 0u; k0 < kTotal; k0 += 16u) {
    for (var i = 0u; i < 4u; i++) {
      let idx = li + i * 256u;
      let ar = row0 + idx / 16u;
      let ak = k0 + idx % 16u;
      var av = 0.0;
      if (ar < m && ak < kTotal) { av = gather(ar, ak); }
      as_[idx] = av;
      let bk = k0 + idx / 64u;
      let bc = col0 + idx % 64u;
      var bv = 0.0;
      if (bk < kTotal && bc < p.cout) { bv = w[bk * p.cout + bc]; }
      bs_[idx] = bv;
    }
    workgroupBarrier();
    for (var kk = 0u; kk < 16u; kk++) {
      var a: array<f32, 4>;
      var bb: array<f32, 4>;
      for (var i = 0u; i < 4u; i++) { a[i] = as_[(l.y * 4u + i) * 16u + kk]; }
      for (var j = 0u; j < 4u; j++) { bb[j] = bs_[kk * 64u + l.x * 4u + j]; }
      for (var i = 0u; i < 4u; i++) {
        for (var j = 0u; j < 4u; j++) { acc[i][j] += a[i] * bb[j]; }
      }
    }
    workgroupBarrier();
  }
  for (var i = 0u; i < 4u; i++) {
    let r = row0 + l.y * 4u + i;
    if (r >= m) { continue; }
    for (var j = 0u; j < 4u; j++) {
      let c = col0 + l.x * 4u + j;
      if (c >= p.cout) { continue; }
      y[r * p.cout + c] = gelu(acc[i][j] + b[c]);
    }
  }
}
`;

/** MATMUL epilogue flags, combined with |. */
export const MATMUL_GELU = 1;
export const MATMUL_RESIDUAL = 2;
export const MATMUL_NORM = 4;
export const MATMUL_ROPE = 8;

/**
 * Y[M, N] = X[M, K] . W[K, N] + bias, with optional fused steps picked by `flags`:
 * - NORM: RMSNorm of each X row folded in. The gamma is already in W's rows (export_weights.py),
 *   so the row only needs scaling by 1/max(||x||, 1e-12); the sum of squares is gathered from the
 *   A elements this workgroup loads anyway, so the normalised input is never written out.
 * - ROPE: interleaved rotary embedding on the q and k columns (the first 2 * dmodel), applied after
 *   the bias. An invocation's four adjacent columns hold two whole (even, odd) pairs. The row's
 *   position along the attended axis is (row / posDiv) % posMod; cos/sin come from a CPU-built
 *   table with torch's f32 angle (position * freq), so large positions round alike.
 * - GELU, then RESIDUAL: add into Y (the residual stream, updated in place).
 * 64x64 output tile per workgroup, 4x4 per invocation, K in steps of 16 through workgroup memory.
 * The A tile is stored transposed so an invocation's four rows are one vec4 read, and its four
 * columns of B another: two workgroup-memory reads per 16 FMAs.
 * W rows are padded to `wStride` (a multiple of 4) columns at export, so each column quad of B is
 * one aligned load: a vec4f from the f32 export (MATMUL), two packed u32 from the --f16 export
 * (MATMUL_F16W, unpacked to f32; the arithmetic is the same).
 *
 * The shader-f16 variants (--f16 export) keep both tiles in workgroup memory as f16, which halves
 * the tile traffic. MATMUL_F16 converts them back and does the FMAs in f32 (M4 Pro: 53.3 -> 49.1 ms
 * per chunk with the attention unchanged, logits ~80 dB against f32). MATMUL_F16_MATH multiplies in
 * f16 too, summing each 16-deep K step in f16 and that partial into the f32 accumulator (47.1 ms,
 * ~75 dB) - only worth it where f16 math has twice the f32 rate, which Apple GPUs do not. X stays
 * f32 in memory and its sum of squares is taken in f32 before rounding. With NORM the A elements
 * are the raw residual stream (|x| up to ~200 times |w| up to ~9), so they are scaled by 1/64
 * (exact) on the way to f16 and the row scale takes the 64 back.
 */
const matmulSource = (weights: string, mode: 'f32' | 'storage' | 'math' = 'f32') => {
  const f16 = mode !== 'f32';
  return /* wgsl */ `
${f16 ? 'enable f16;' : ''}
${GELU}
struct P { m: u32, n: u32, k: u32, flags: u32, posDiv: u32, posMod: u32, dmodel: u32, wStride: u32 }
@group(0) @binding(0) var<storage, read> x: array<f32>;
${weights}
@group(0) @binding(2) var<storage, read> bias: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<storage, read> table: array<f32>; // [pos][16][cos, sin]
@group(0) @binding(5) var<uniform> p: P;
${f16 ? `var<workgroup> as_: array<vec4h, 256>; // [16 k][16 row quads]
var<workgroup> bs_: array<vec4h, 256>; // [16 k][16 col quads]
var<workgroup> sums_: array<vec4f, 256>; // per-loader row sums of squares
const A_SCALE = 64.0;` : `var<workgroup> as_: array<vec4f, 256>; // [16 k][16 row quads]; afterwards the per-loader row sums of squares
var<workgroup> bs_: array<vec4f, 256>; // [16 k][16 col quads]`}
@compute @workgroup_size(16, 16)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u, @builtin(local_invocation_index) li: u32) {
  let row0 = wg.y * 64u;
  let col0 = wg.x * 64u;
  var acc: array<vec4f, 4>; // acc[j] = rows 4*l.y..+3 of column 4*l.x + j
  // Loader roles: A - invocation li reads k = li % 16 of row quad li / 16; B - k = li / 16, col quad li % 16.
  let aK = li % 16u;
  let aQuad = li / 16u;
  let bK = li / 16u;
  let bQuad = li % 16u;
  var squares = vec4f(0.0);
  for (var k0 = 0u; k0 < p.k; k0 += 16u) {
    var av = vec4f(0.0);
    let ak = k0 + aK;
    if (ak < p.k) {
      for (var r = 0u; r < 4u; r++) {
        let row = row0 + aQuad * 4u + r;
        if (row < p.m) { av[r] = x[row * p.k + ak]; }
      }
    }
    squares = fma(av, av, squares);
    as_[aK * 16u + aQuad] = ${f16 ? 'vec4h(select(av, av / A_SCALE, (p.flags & 4u) != 0u))' : 'av'};
    var bv = ${f16 ? 'vec4h' : 'vec4f'}(0.0);
    let bk = k0 + bK;
    let bc = col0 + bQuad * 4u;
    if (bk < p.k && bc < p.n) { bv = weightQuad((bk * p.wStride + bc) / 4u); }
    bs_[bK * 16u + bQuad] = bv;
    workgroupBarrier();
${f16 ? `${mode === 'math' ? '    var part: array<vec4h, 4>;\n' : ''}    for (var kk = 0u; kk < 16u; kk++) {
      let a = as_[kk * 16u + l.y];
      let b = bs_[kk * 16u + l.x];
${mode === 'math' ? `      part[0] = fma(a, vec4h(b.x), part[0]);
      part[1] = fma(a, vec4h(b.y), part[1]);
      part[2] = fma(a, vec4h(b.z), part[2]);
      part[3] = fma(a, vec4h(b.w), part[3]);
    }
    for (var j = 0u; j < 4u; j++) { acc[j] += vec4f(part[j]); }` : `      let af = vec4f(a);
      let bf = vec4f(b);
      acc[0] = fma(af, vec4f(bf.x), acc[0]);
      acc[1] = fma(af, vec4f(bf.y), acc[1]);
      acc[2] = fma(af, vec4f(bf.z), acc[2]);
      acc[3] = fma(af, vec4f(bf.w), acc[3]);
    }`}` : `    for (var kk = 0u; kk < 16u; kk++) {
      let a = as_[kk * 16u + l.y];
      let b = bs_[kk * 16u + l.x];
      acc[0] = fma(a, vec4f(b.x), acc[0]);
      acc[1] = fma(a, vec4f(b.y), acc[1]);
      acc[2] = fma(a, vec4f(b.z), acc[2]);
      acc[3] = fma(a, vec4f(b.w), acc[3]);
    }`}
    workgroupBarrier();
  }
  // The 16 loaders of row quad q are invocations 16q..16q+15; their partial sums meet in ${f16 ? 'sums_' : 'as_'}.
  ${f16 ? 'sums_' : 'as_'}[li] = squares;
  workgroupBarrier();
  var rowScale = vec4f(1.0);
  if ((p.flags & 4u) != 0u) {
    var total = vec4f(0.0);
    for (var t = 0u; t < 16u; t++) { total += ${f16 ? 'sums_' : 'as_'}[l.y * 16u + t]; }
    rowScale = ${f16 ? 'A_SCALE' : '1.0'} / max(sqrt(total), vec4f(1e-12));
  }
  for (var i = 0u; i < 4u; i++) {
    let r = row0 + l.y * 4u + i;
    if (r >= p.m) { continue; }
    var v: array<f32, 4>;
    for (var j = 0u; j < 4u; j++) {
      let c = min(col0 + l.x * 4u + j, p.n - 1u);
      v[j] = acc[j][i] * rowScale[i] + bias[c];
    }
    let c0 = col0 + l.x * 4u;
    if ((p.flags & 8u) != 0u && c0 < 2u * p.dmodel) {
      let pos = (r / p.posDiv) % p.posMod;
      for (var pair = 0u; pair < 2u; pair++) {
        let t = (pos * 16u + ((c0 + 2u * pair) % 32u) / 2u) * 2u;
        let cs = table[t];
        let sn = table[t + 1u];
        let x0 = v[2u * pair];
        let x1 = v[2u * pair + 1u];
        v[2u * pair] = x0 * cs - x1 * sn;
        v[2u * pair + 1u] = x1 * cs + x0 * sn;
      }
    }
    for (var j = 0u; j < 4u; j++) {
      let c = c0 + j;
      if (c >= p.n) { continue; }
      var res = v[j];
      let o = r * p.n + c;
      if ((p.flags & 1u) != 0u) { res = gelu(res); }
      if ((p.flags & 2u) != 0u) { res += y[o]; }
      y[o] = res;
    }
  }
}
`;
};

export const MATMUL = matmulSource(/* wgsl */ `
@group(0) @binding(1) var<storage, read> w: array<vec4f>;
fn weightQuad(i: u32) -> vec4f { return w[i]; }`);

export const MATMUL_F16W = matmulSource(/* wgsl */ `
@group(0) @binding(1) var<storage, read> w: array<vec2u>; // four fp16 columns per element
fn weightQuad(i: u32) -> vec4f { let q = w[i]; return vec4f(unpack2x16float(q.x), unpack2x16float(q.y)); }`);

const F16_WEIGHTS = /* wgsl */ `
@group(0) @binding(1) var<storage, read> w: array<vec4h>;
fn weightQuad(i: u32) -> vec4h { return w[i]; }`;
export const MATMUL_F16 = matmulSource(F16_WEIGHTS, 'storage');
export const MATMUL_F16_MATH = matmulSource(F16_WEIGHTS, 'math');

/**
 * Gated multi-head attention, head dim 32, FlashAttention-style: keys and values stream through
 * workgroup memory in tiles of 32, and each tile is handled as a block - all 32 scores first, one
 * max, one rescale of the running sum and accumulator, then the 32 weighted values - so the
 * 1500x1500 score matrix is never stored and the exp/rescale cost is per tile, not per key.
 * One invocation per query, 64 queries of one (batch, head) per workgroup, vec4 throughout the
 * inner loops. Query row = batch * batchStride + index * seqStride.
 *
 * ATTENTION_F16 keeps the K and V tiles in workgroup memory as f16; scores, softmax and the P.V
 * sums stay f32, since one head of the last layer magnifies score errors ~25 dB on frames next to a
 * beat (M4 Pro: 23.1 -> 18.7 ms, logits ~79 dB against f32 with MATMUL_F16). ATTENTION_F16_MATH
 * also does P.V in f16, each tile's 32 terms summed in f16 then added to the f32 accumulator
 * (18.0 ms, ~77 dB). K in f16 with V in f32 is slower than all-f32: the conversions cost more than
 * the halved tile saves.
 */
const attentionSource = (f16: { k: boolean; pv: boolean } | null) => /* wgsl */ `
${f16 ? 'enable f16;' : ''}
struct P { n: u32, heads: u32, width: u32, dmodel: u32, seqStride: u32, batchStride: u32 }
@group(0) @binding(0) var<storage, read> qkv: array<f32>;
@group(0) @binding(1) var<storage, read_write> o: array<f32>; // [rows, dmodel]
@group(0) @binding(2) var<uniform> p: P;
const TILE = 32u;
var<workgroup> ks: array<${f16?.k ? 'vec4h' : 'vec4f'}, 256>; // [TILE keys][8 x vec4]
var<workgroup> vs: array<${f16 ? 'vec4h' : 'vec4f'}, 256>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u) {
  let b = wg.z;
  let h = wg.y;
  let qi = wg.x * 64u + l.x;
  let valid = qi < p.n;
  let qrow = b * p.batchStride + min(qi, p.n - 1u) * p.seqStride;
  var q: array<vec4f, 8>;
  var acc: array<vec4f, 8>;
  let qBase = qrow * p.width + h * 32u;
  for (var d = 0u; d < 8u; d++) {
    q[d] = vec4f(qkv[qBase + 4u * d], qkv[qBase + 4u * d + 1u], qkv[qBase + 4u * d + 2u], qkv[qBase + 4u * d + 3u]) * 0.17677669529663687;
    acc[d] = vec4f(0.0);
  }
  var m = -3.0e38;
  var sum = 0.0;
  for (var k0 = 0u; k0 < p.n; k0 += TILE) {
    // 32 keys x 8 vec4 = 256 vec4 each for K and V, four per invocation.
    for (var i = 0u; i < 4u; i++) {
      let idx = l.x + i * 64u;
      let kj = k0 + idx / 8u;
      var kv = vec4f(0.0);
      var vv = vec4f(0.0);
      if (kj < p.n) {
        let base = (b * p.batchStride + kj * p.seqStride) * p.width + h * 32u + (idx % 8u) * 4u;
        let kb = base + p.dmodel;
        let vb = base + 2u * p.dmodel;
        kv = vec4f(qkv[kb], qkv[kb + 1u], qkv[kb + 2u], qkv[kb + 3u]);
        vv = vec4f(qkv[vb], qkv[vb + 1u], qkv[vb + 2u], qkv[vb + 3u]);
      }
      ks[idx] = ${f16?.k ? 'vec4h(kv)' : 'kv'};
      vs[idx] = ${f16 ? 'vec4h(vv)' : 'vv'};
    }
    workgroupBarrier();
    // Constant trip counts so the compiler unrolls and keeps s[] in registers; keys past the end
    // of the sequence get a score of -3e38, whose exp is exactly 0.
    var s: array<f32, 32>;
    var tileMax = -3.0e38;
    for (var j = 0u; j < TILE; j++) {
      var dotv = vec4f(0.0);
      for (var d = 0u; d < 8u; d++) { dotv = fma(q[d], ${f16?.k ? 'vec4f(ks[j * 8u + d])' : 'ks[j * 8u + d]'}, dotv); }
      s[j] = select(-3.0e38, dotv.x + dotv.y + dotv.z + dotv.w, k0 + j < p.n);
      tileMax = max(tileMax, s[j]);
    }
    let mNew = max(m, tileMax);
    let r = exp(m - mNew);
    sum *= r;
    for (var d = 0u; d < 8u; d++) { acc[d] *= r; }
    m = mNew;
${f16?.pv ? `    var part: array<vec4h, 8>;
    for (var j = 0u; j < TILE; j++) {
      let e = exp(s[j] - m);
      sum += e;
      let eh = vec4h(f16(e));
      for (var d = 0u; d < 8u; d++) { part[d] = fma(eh, vs[j * 8u + d], part[d]); }
    }
    for (var d = 0u; d < 8u; d++) { acc[d] += vec4f(part[d]); }` : `    for (var j = 0u; j < TILE; j++) {
      let e = exp(s[j] - m);
      sum += e;
      for (var d = 0u; d < 8u; d++) { acc[d] = fma(vec4f(e), ${f16 ? 'vec4f(vs[j * 8u + d])' : 'vs[j * 8u + d]'}, acc[d]); }
    }`}
    workgroupBarrier();
  }
  if (!valid) { return; }
  let gate = 1.0 / (1.0 + exp(-qkv[qrow * p.width + 3u * p.dmodel + h]));
  let scale = gate / sum;
  let oBase = qrow * p.dmodel + h * 32u;
  for (var d = 0u; d < 8u; d++) {
    let v = acc[d] * scale;
    o[oBase + 4u * d] = v.x;
    o[oBase + 4u * d + 1u] = v.y;
    o[oBase + 4u * d + 2u] = v.z;
    o[oBase + 4u * d + 3u] = v.w;
  }
}
`;

export const ATTENTION = attentionSource(null);
export const ATTENTION_F16 = attentionSource({ k: true, pv: false });
export const ATTENTION_F16_MATH = attentionSource({ k: true, pv: true });

/** [F, T, C] -> [T, F * C]: the frontend's final flatten, in the (f c) order the exported linear expects. */
export const FLATTEN = /* wgsl */ `
struct P { freqs: u32, frames: u32, channels: u32 }
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read_write> y: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= p.freqs * p.frames * p.channels) { return; }
  let c = i % p.channels;
  let t = (i / p.channels) % p.frames;
  let f = i / (p.channels * p.frames);
  y[(t * p.freqs + f) * p.channels + c] = x[i];
}
`;

/** SumHead: [T, 2] logits -> beat = l0 + l1, downbeat = l1, written as [2, T]. */
export const SUM_HEAD = /* wgsl */ `
struct P { frames: u32 }
@group(0) @binding(0) var<storage, read> l: array<f32>;
@group(0) @binding(1) var<storage, read_write> out: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let t = id.x;
  if (t >= p.frames) { return; }
  out[t] = l[t * 2u] + l[t * 2u + 1u];
  out[p.frames + t] = l[t * 2u + 1u];
}
`;
