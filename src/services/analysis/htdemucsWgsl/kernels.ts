// src/services/analysis/htdemucsWgsl/kernels.ts
// WGSL sources for the hand-written htdemucs forward pass (./runtime.ts). Activations are f32 in
// memory throughout; the GEMMs (every convolution, Linear and ConvTranspose, and attention's two
// products) also come in an fp16 variant (GemmMode 'f16', see gemmBody) for devices with shader-f16.
//
// Every activation is channel-major, [C, H, W] row-major: the frequency branch is [C, F, T] and the
// time branch [C, 1, L], the layout of the ONNX graph the weights come from. So one implicit-GEMM
// kernel (GEMM) covers every convolution - the encoders' stride-4 kernel 8, DConv's dilated kernel 3,
// the decoders' 3x3, and every 1x1 including each transformer Linear, whose tokens are just W - with
// rows = output channels and K = (ci, kh, kw); a second (GEMM_TR) covers the stride-4 ConvTranspose
// as four phase matrices (export_weights.py). The transformer keeps the layout too: a token is a
// column, LayerNorm reduces down a column, attention reads q/k/v rows of 64 per head.
//
// Attention is three steps - scores as a batched GEMM, a row softmax, the weighted sum as another GEMM -
// so every step keeps the GPU full (one invocation per query, flash-style, ran at a tenth of it).
//
// Norms are two-pass, in a separate pair of kernels (STATS_PARTIAL, STATS_FINAL) so a group of four
// million values is not one workgroup's loop; GroupNorm's affine and what follows it (GELU, or GLU +
// LayerScale + residual) is one elementwise pass. STFT and iSTFT are two-stage 64 x 64 DFTs.

/** Exact GELU through erf, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7), as in beatThisWgsl/kernels.ts. */
const GELU = /* wgsl */ `
fn erf_f32(v: f32) -> f32 {
  let a = abs(v);
  let x = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - ((((1.061405429 * x - 1.453152027) * x + 1.421413741) * x - 0.284496736) * x + 0.254829592) * x * exp(-a * a);
  return select(-y, y, v >= 0.0);
}
fn gelu(v: f32) -> f32 { return 0.5 * v * (1.0 + erf_f32(v * 0.7071067811865476)); }
`;

/** GEMM / GEMM_TR epilogue flags, combined with |. */
export const GEMM_GELU = 1;
/** y += side[row] * value: the LayerScale'd residual add of a transformer half-layer. */
export const GEMM_RESIDUAL = 2;

/** The weight read, from an f32 export or from fp16 pairs packed in u32 (the --f16 export). */
const weightRead = (f16: boolean) => (f16 ? /* wgsl */ `
@group(0) @binding(1) var<storage, read> w: array<u32>;
fn wload(e: u32) -> f32 {
  let pair = unpack2x16float(w[e >> 1u]);
  return select(pair.x, pair.y, (e & 1u) == 1u);
}` : /* wgsl */ `
@group(0) @binding(1) var<storage, read> w: array<f32>;
fn wload(e: u32) -> f32 { return w[e]; }`);

/**
 * How a GEMM multiplies. 'f32': f32 tiles and f32 FMAs. 'f16' (needs shader-f16): both tiles are kept
 * in workgroup memory as f16 - half the tile traffic - and each 16-deep K step is multiplied and
 * summed in f16, that partial then added into the f32 accumulator, so the rounding of a long K never
 * piles up in f16. Inputs, outputs and the epilogue stay f32.
 *
 * M4, one segment, GPU time: 152.5 ms with the scalar tiles this replaced, 141.7 ms 'f32', 128.0 ms
 * 'f16' (f16 tiles with f32 FMAs: 134 ms, about as far from f32 - not kept). 'f16' leaves the layers
 * 50-64 dB from the graph and the stem 58-77 dB under the mix; a near-silent stem then misses
 * red_line.py's 0.01 dB (0.018), but the drum hits are the f32 ones - on a whole track with drums,
 * 385 of 386 at the same frame and kind, strengths 0.0005 apart, the drum coverage identical.
 */
export type GemmMode = 'f32' | 'f16';

/**
 * The 16-deep K step shared by every GEMM here: tiles `as_` ([16 k][16 row quads]) and `bs_` ([16 k]
 * [16 column quads]) in workgroup memory, so an invocation's four rows are one vector read and its
 * four columns another - two reads per 16 FMAs. `acc` is the invocation's 4 x 4 block, a vec4f per row.
 * Each invocation fills one whole vector of each tile (4 x 256 = 1024 values): a write to one lane of
 * a shared vector is a read-modify-write of all four on Metal, and four invocations writing the lanes
 * of one vector race.
 * In f32 these are the scalar loop's FMAs in the same order, though Metal no longer returns them bit for
 * bit (red_line.py: the same 0.0006 dB and the same SNR against the graph).
 */
const tiles = (mode: GemmMode) => /* wgsl */ `
var<workgroup> as_: array<${mode === 'f16' ? 'vec4h' : 'vec4f'}, 256>;
var<workgroup> bs_: array<${mode === 'f16' ? 'vec4h' : 'vec4f'}, 256>;`;
const tileVector = (mode: GemmMode, value: string) => `${mode === 'f16' ? 'vec4h' : 'vec4f'}(${value})`;
const kStep = (mode: GemmMode) => (mode === 'f16' ? /* wgsl */ `
    var part: array<vec4h, 4>;
    for (var kk = 0u; kk < 16u; kk++) {
      let a = as_[kk * 16u + l.y];
      let bb = bs_[kk * 16u + l.x];
      for (var i = 0u; i < 4u; i++) { part[i] = fma(vec4h(a[i]), bb, part[i]); }
    }
    for (var i = 0u; i < 4u; i++) { acc[i] += vec4f(part[i]); }` : /* wgsl */ `
    for (var kk = 0u; kk < 16u; kk++) {
      let a = as_[kk * 16u + l.y];
      let bb = bs_[kk * 16u + l.x];
      for (var i = 0u; i < 4u; i++) { acc[i] = fma(vec4f(a[i]), bb, acc[i]); }
    }`);
const enableF16 = (mode: GemmMode) => (mode === 'f16' ? 'enable f16;' : '');

/**
 * The shared body of GEMM and GEMM_TR: Y[M, N] = W[M, K] . B[K, N] + bias[M], B gathered from the input
 * by `gather(k, n)` (no im2col buffer), each result written by `store(row, col, value)`. 64 x 64
 * output tile per workgroup, 4 x 4 per invocation, K in steps of 16 through workgroup memory.
 */
const gemmBody = (columns: string, mode: GemmMode) => /* wgsl */ `
${tiles(mode)}
@compute @workgroup_size(16, 16)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u, @builtin(local_invocation_index) li: u32) {
  let n = ${columns};
  let row0 = wg.y * 64u;
  let col0 = wg.x * 64u;
  var acc: array<vec4f, 4>;
  for (var k0 = 0u; k0 < p.k; k0 += 16u) {
    // Invocation li: rows 4 (li / 16).. at k li % 16 of A, columns 4 (li % 16).. at k li / 16 of B.
    let ak = k0 + li % 16u;
    var av = vec4f(0.0);
    let bk = k0 + li / 16u;
    var bv = vec4f(0.0);
    for (var c = 0u; c < 4u; c++) {
      let ar = row0 + (li / 16u) * 4u + c;
      if (ar < p.m && ak < p.k) { av[c] = wload(ar * p.k + ak); }
      let bc = col0 + (li % 16u) * 4u + c;
      if (bk < p.k && bc < n) { bv[c] = gather(bk, bc); }
    }
    as_[(li % 16u) * 16u + li / 16u] = ${tileVector(mode, 'av')};
    bs_[li] = ${tileVector(mode, 'bv')};
    workgroupBarrier();${kStep(mode)}
    workgroupBarrier();
  }
  for (var i = 0u; i < 4u; i++) {
    let r = row0 + l.y * 4u + i;
    if (r >= p.m) { continue; }
    for (var j = 0u; j < 4u; j++) {
      let c = col0 + l.x * 4u + j;
      if (c >= n) { continue; }
      store(r, c, acc[i][j]);
    }
  }
}
`;

/**
 * Conv2d as an implicit GEMM: [cin, hin, win] -> [m, hout, wout], weights [m, cin * kh * kw] (ONNX's
 * own order), any stride / padding / dilation per axis. Bias, then GELU (GEMM_GELU), then either
 * written or added into y scaled by side[row] (GEMM_RESIDUAL). A 1x1 over [cin, 1, tokens] is a Linear.
 */
export const gemmSource = (f16: boolean, mode: GemmMode = 'f32') => /* wgsl */ `
${enableF16(mode)}
${GELU}
struct P { m: u32, k: u32, cin: u32, kh: u32, kw: u32, sh: u32, sw: u32, ph: u32, pw: u32, dh: u32, dw: u32, hin: u32, win: u32, hout: u32, wout: u32, flags: u32 }
@group(0) @binding(0) var<storage, read> x: array<f32>;
${weightRead(f16)}
@group(0) @binding(2) var<storage, read> b: array<f32>;
@group(0) @binding(3) var<storage, read> side: array<f32>;
@group(0) @binding(4) var<storage, read_write> y: array<f32>;
@group(0) @binding(5) var<uniform> p: P;

fn gather(k: u32, n: u32) -> f32 {
  let taps = p.kh * p.kw;
  let ci = k / taps;
  let r = k - ci * taps;
  let a = r / p.kw;
  let c = r - a * p.kw;
  let ho = n / p.wout;
  let wo = n - ho * p.wout;
  let hi = i32(ho * p.sh + a * p.dh) - i32(p.ph);
  let wi = i32(wo * p.sw + c * p.dw) - i32(p.pw);
  if (hi < 0 || hi >= i32(p.hin) || wi < 0 || wi >= i32(p.win)) { return 0.0; }
  return x[(ci * p.hin + u32(hi)) * p.win + u32(wi)];
}

fn store(r: u32, c: u32, sum: f32) {
  var v = sum + b[r];
  if ((p.flags & ${GEMM_GELU}u) != 0u) { v = gelu(v); }
  let o = r * p.hout * p.wout + c;
  if ((p.flags & ${GEMM_RESIDUAL}u) != 0u) { y[o] = y[o] + side[r] * v; } else { y[o] = v; }
}
${gemmBody('p.hout * p.wout', mode)}
`;

/**
 * ConvTranspose (kernel 8, stride 4) along H (axis 0) or W (axis 1), then the graph's crop of 2 at
 * either end: [cin, hin, win] -> [cout, 4 hin, win] or [cout, hin, 4 win]. Rows are (co, phase),
 * K is (ci, t): output 4q + ph reads input q - t through tap ph + 4t, so the columns run over
 * q = 0..len (one more than the input, for the taps that reach past its end) and the crop drops what
 * falls outside. Bias, then GELU if GEMM_GELU.
 */
export const gemmTrSource = (f16: boolean, mode: GemmMode = 'f32') => /* wgsl */ `
${enableF16(mode)}
${GELU}
struct P { m: u32, k: u32, cin: u32, hin: u32, win: u32, axis: u32, flags: u32 }
@group(0) @binding(0) var<storage, read> x: array<f32>;
${weightRead(f16)}
@group(0) @binding(2) var<storage, read> b: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<uniform> p: P;

fn gather(k: u32, n: u32) -> f32 {
  let ci = k / 2u;
  let t = k - ci * 2u;
  if (p.axis == 0u) {
    let q = n / p.win;
    let w = n - q * p.win;
    if (q < t || q - t >= p.hin) { return 0.0; }
    return x[(ci * p.hin + q - t) * p.win + w];
  }
  let h = n / (p.win + 1u);
  let q = n - h * (p.win + 1u);
  if (q < t || q - t >= p.win) { return 0.0; }
  return x[(ci * p.hin + h) * p.win + q - t];
}

fn store(r: u32, c: u32, sum: f32) {
  let co = r / 4u;
  let ph = r - co * 4u;
  var v = sum + b[co];
  if ((p.flags & ${GEMM_GELU}u) != 0u) { v = gelu(v); }
  if (p.axis == 0u) {
    let q = c / p.win;
    let w = c - q * p.win;
    let o = 4u * q + ph;
    if (o < 2u || o - 2u >= 4u * p.hin) { return; }
    y[(co * 4u * p.hin + o - 2u) * p.win + w] = v;
  } else {
    let h = c / (p.win + 1u);
    let q = c - h * (p.win + 1u);
    let o = 4u * q + ph;
    if (o < 2u || o - 2u >= 4u * p.win) { return; }
    y[(co * p.hin + h) * 4u * p.win + o - 2u] = v;
  }
}
${gemmBody('select(p.hin * (p.win + 1u), (p.hin + 1u) * p.win, p.axis == 0u)', mode)}
`;

/**
 * First pass of a mean or a variance over groups: workgroup (part, group) sums its share of the
 * group's n = c * inner values, element (ch, i) at x[ch * cs + group * gs + i]. Mode 0 sums the
 * values; mode 1 sums squared deviations from the group's mean, already in stats[group * 4].
 */
export const STATS_PARTIAL = /* wgsl */ `
struct P { parts: u32, c: u32, inner: u32, cs: u32, gs: u32, mode: u32 }
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> stats: array<f32>;
@group(0) @binding(2) var<storage, read_write> partial: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
var<workgroup> sums: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let g = wg.y;
  let n = p.c * p.inner;
  let chunk = (n + p.parts - 1u) / p.parts;
  let lo = wg.x * chunk;
  let hi = min(n, lo + chunk);
  let mean = stats[g * 4u];
  var s = 0.0;
  for (var e = lo + li; e < hi; e += 256u) {
    let ch = e / p.inner;
    let v = x[ch * p.cs + g * p.gs + e - ch * p.inner];
    if (p.mode == 0u) { s += v; } else { let d = v - mean; s = fma(d, d, s); }
  }
  sums[li] = s;
  workgroupBarrier();
  for (var span = 128u; span > 0u; span >>= 1u) {
    if (li < span) { sums[li] += sums[li + span]; }
    workgroupBarrier();
  }
  if (li == 0u) { partial[g * p.parts + wg.x] = sums[0]; }
}
`;

/**
 * Second pass: one workgroup per group adds up its partials. Mode 0 writes the mean (stats[g*4]);
 * mode 1 the GroupNorm / LayerNorm reciprocal 1/sqrt(var + 1e-5) (stats[g*4+1]); mode 2 the
 * graph's input normalisation, 1/(std + 1e-5) with the unbiased std (stats[g*4+1], and the std
 * itself in stats[g*4+2], to scale the output back).
 */
export const STATS_FINAL = /* wgsl */ `
struct P { parts: u32, n: u32, mode: u32 }
@group(0) @binding(0) var<storage, read> partial: array<f32>;
@group(0) @binding(1) var<storage, read_write> stats: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
var<workgroup> sums: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let g = wg.x;
  var s = 0.0;
  for (var i = li; i < p.parts; i += 256u) { s += partial[g * p.parts + i]; }
  sums[li] = s;
  workgroupBarrier();
  for (var span = 128u; span > 0u; span >>= 1u) {
    if (li < span) { sums[li] += sums[li + span]; }
    workgroupBarrier();
  }
  if (li != 0u) { return; }
  let total = sums[0];
  let n = f32(p.n);
  if (p.mode == 0u) {
    stats[g * 4u] = total / n;
  } else if (p.mode == 1u) {
    stats[g * 4u + 1u] = 1.0 / sqrt(total / n + 1e-5);
  } else {
    let sd = sqrt(total / (n - 1.0));
    stats[g * 4u + 1u] = 1.0 / (sd + 1e-5);
    stats[g * 4u + 2u] = sd;
  }
}
`;

/**
 * GroupNorm's normalise-and-affine in place on [c, h, w], then GELU if `gelu`; stats per h row when
 * `perH` (the frequency branch's DConv, whose groups are one frequency each), else one group.
 */
export const GN_INPLACE = /* wgsl */ `
${GELU}
struct P { c: u32, h: u32, w: u32, perH: u32, gelu: u32 }
@group(0) @binding(0) var<storage, read_write> x: array<f32>;
@group(0) @binding(1) var<storage, read> stats: array<f32>;
@group(0) @binding(2) var<storage, read> gamma: array<f32>;
@group(0) @binding(3) var<storage, read> beta: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = id.x + id.y * groups.x * 256u;
  let plane = p.h * p.w;
  if (i >= p.c * plane) { return; }
  let ch = i / plane;
  let g = select(0u, (i - ch * plane) / p.w, p.perH == 1u);
  var v = (x[i] - stats[g * 4u]) * stats[g * 4u + 1u] * gamma[ch] + beta[ch];
  if (p.gelu == 1u) { v = gelu(v); }
  x[i] = v;
}
`;

/**
 * The second half of a DConv layer: GroupNorm over [2c, h, w], GLU over the channel halves, then
 * res += scale[ch] * that (LayerScale and the residual), for res's [c, h, w].
 */
export const GN_GLU_RESIDUAL = /* wgsl */ `
struct P { c: u32, h: u32, w: u32, perH: u32 }
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> stats: array<f32>;
@group(0) @binding(2) var<storage, read> gamma: array<f32>;
@group(0) @binding(3) var<storage, read> beta: array<f32>;
@group(0) @binding(4) var<storage, read> scale: array<f32>;
@group(0) @binding(5) var<storage, read_write> res: array<f32>;
@group(0) @binding(6) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = id.x + id.y * groups.x * 256u;
  let plane = p.h * p.w;
  if (i >= p.c * plane) { return; }
  let ch = i / plane;
  let at = i - ch * plane;
  let g = select(0u, at / p.w, p.perH == 1u);
  let mean = stats[g * 4u];
  let rstd = stats[g * 4u + 1u];
  let a = (x[i] - mean) * rstd * gamma[ch] + beta[ch];
  let gch = ch + p.c;
  let gate = (x[gch * plane + at] - mean) * rstd * gamma[gch] + beta[gch];
  res[i] = res[i] + scale[ch] * (a / (1.0 + exp(-gate)));
}
`;

/** GLU over the channel halves of [2c, h, w] -> [c, h, w]; with `emb`, plus emb[ch, row] (the frequency embedding). */
export const GLU = /* wgsl */ `
struct P { c: u32, h: u32, w: u32, emb: u32 }
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> emb: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = id.x + id.y * groups.x * 256u;
  let plane = p.h * p.w;
  if (i >= p.c * plane) { return; }
  var v = x[i] / (1.0 + exp(-x[i + p.c * plane]));
  if (p.emb == 1u) {
    let ch = i / plane;
    v += emb[ch * p.h + (i - ch * plane) / p.w];
  }
  y[i] = v;
}
`;

/** x += y, elementwise (a decoder's skip connection). */
export const ADD = /* wgsl */ `
struct P { n: u32 }
@group(0) @binding(0) var<storage, read_write> x: array<f32>;
@group(0) @binding(1) var<storage, read> y: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = id.x + id.y * groups.x * 256u;
  if (i < p.n) { x[i] = x[i] + y[i]; }
}
`;

/** (x - mean) / (std + 1e-5) in place, from stats[0..1] (STATS_FINAL mode 2): the graph's input normalisation. */
export const NORMALIZE = /* wgsl */ `
struct P { n: u32 }
@group(0) @binding(0) var<storage, read_write> x: array<f32>;
@group(0) @binding(1) var<storage, read> stats: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = id.x + id.y * groups.x * 256u;
  if (i < p.n) { x[i] = (x[i] - stats[0]) * stats[1]; }
}
`;

/**
 * LayerNorm down each column of a channel-major [c, n] (each token's c features), one invocation per
 * token, two-pass; with `pos`, plus pos[ch, token] after the affine (the positional embedding).
 */
export const LAYER_NORM = /* wgsl */ `
struct P { c: u32, n: u32, pos: u32 }
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> gamma: array<f32>;
@group(0) @binding(2) var<storage, read> beta: array<f32>;
@group(0) @binding(3) var<storage, read> pos: array<f32>;
@group(0) @binding(4) var<storage, read_write> y: array<f32>;
@group(0) @binding(5) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let t = id.x;
  if (t >= p.n) { return; }
  var s = 0.0;
  for (var ch = 0u; ch < p.c; ch++) { s += x[ch * p.n + t]; }
  let mean = s / f32(p.c);
  var q = 0.0;
  for (var ch = 0u; ch < p.c; ch++) { let d = x[ch * p.n + t] - mean; q = fma(d, d, q); }
  let rstd = 1.0 / sqrt(q / f32(p.c) + 1e-5);
  for (var ch = 0u; ch < p.c; ch++) {
    var v = (x[ch * p.n + t] - mean) * rstd * gamma[ch] + beta[ch];
    if (p.pos == 1u) { v += pos[ch * p.n + t]; }
    y[ch * p.n + t] = v;
  }
}
`;

/**
 * Attention, step 1 of 3, as a batched GEMM: scores s[head, i, j] = q_i . k_j over one head's 64 rows,
 * for heads head0.. (the dispatch's z) - q rows qr0.. of a channel-major [*, nq] buffer, already scaled
 * by 1/8 at export, k rows kr0.. of a [*, nk] buffer (the same buffer for self-attention). The
 * scores are written for the dispatch's heads only, [z, nq, nk].
 */
export const attnScoresSource = (mode: GemmMode = 'f32') => /* wgsl */ `
${enableF16(mode)}
struct P { nq: u32, nk: u32, qr0: u32, kr0: u32, head0: u32 }
@group(0) @binding(0) var<storage, read> q: array<f32>;
@group(0) @binding(1) var<storage, read> kv: array<f32>;
@group(0) @binding(2) var<storage, read_write> s: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
${tiles(mode)} // [16 d][16 query quads], [16 d][16 key quads]
@compute @workgroup_size(16, 16)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u, @builtin(local_invocation_index) li: u32) {
  let h = p.head0 + wg.z;
  let row0 = wg.y * 64u;
  let col0 = wg.x * 64u;
  var acc: array<vec4f, 4>;
  for (var d0 = 0u; d0 < 64u; d0 += 16u) {
    // Invocation li: queries and keys 4 (li % 16).. at dimension li / 16.
    let d = d0 + li / 16u;
    var av = vec4f(0.0);
    var bv = vec4f(0.0);
    for (var c = 0u; c < 4u; c++) {
      let e = (li % 16u) * 4u + c;
      let i = row0 + e;
      let j = col0 + e;
      av[c] = select(0.0, q[(p.qr0 + h * 64u + d) * p.nq + min(i, p.nq - 1u)], i < p.nq);
      bv[c] = select(0.0, kv[(p.kr0 + h * 64u + d) * p.nk + min(j, p.nk - 1u)], j < p.nk);
    }
    as_[li] = ${tileVector(mode, 'av')};
    bs_[li] = ${tileVector(mode, 'bv')};
    workgroupBarrier();${kStep(mode)}
    workgroupBarrier();
  }
  for (var i = 0u; i < 4u; i++) {
    let r = row0 + l.y * 4u + i;
    if (r >= p.nq) { continue; }
    for (var j = 0u; j < 4u; j++) {
      let c = col0 + l.x * 4u + j;
      if (c < p.nk) { s[(wg.z * p.nq + r) * p.nk + c] = acc[i][j]; }
    }
  }
}
`;

/** Attention, step 2 of 3: softmax along each row of the scores, in place, one workgroup per row. */
export const ATTN_SOFTMAX = /* wgsl */ `
struct P { nk: u32 }
@group(0) @binding(0) var<storage, read_write> s: array<f32>;
@group(0) @binding(1) var<uniform> p: P;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) groups: vec3u, @builtin(local_invocation_index) li: u32) {
  let base = (wg.x + wg.y * groups.x) * p.nk;
  var m = -3.0e38;
  for (var j = li; j < p.nk; j += 256u) { m = max(m, s[base + j]); }
  red[li] = m;
  workgroupBarrier();
  for (var span = 128u; span > 0u; span >>= 1u) {
    if (li < span) { red[li] = max(red[li], red[li + span]); }
    workgroupBarrier();
  }
  m = red[0];
  workgroupBarrier();
  var sum = 0.0;
  for (var j = li; j < p.nk; j += 256u) {
    let e = exp(s[base + j] - m);
    s[base + j] = e;
    sum += e;
  }
  red[li] = sum;
  workgroupBarrier();
  for (var span = 128u; span > 0u; span >>= 1u) {
    if (li < span) { red[li] += red[li + span]; }
    workgroupBarrier();
  }
  let inv = 1.0 / red[0];
  for (var j = li; j < p.nk; j += 256u) { s[base + j] *= inv; }
}
`;

/**
 * Attention, step 3 of 3: out[head * 64 + d, i] = sum over j of probabilities[head, i, j] v_j[d], v rows
 * vr0.. of the [*, nk] buffer. A GEMM with rows = queries, columns = the head's 64 dimensions,
 * K = keys; both tiles are read sixteen keys at a time, contiguous in memory.
 */
export const attnOutSource = (mode: GemmMode = 'f32') => /* wgsl */ `
${enableF16(mode)}
struct P { nq: u32, nk: u32, vr0: u32, head0: u32 }
@group(0) @binding(0) var<storage, read> s: array<f32>;
@group(0) @binding(1) var<storage, read> kv: array<f32>;
@group(0) @binding(2) var<storage, read_write> o: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
${tiles(mode)} // [16 keys][16 query quads], [16 keys][16 d quads]
@compute @workgroup_size(16, 16)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u, @builtin(local_invocation_index) li: u32) {
  let h = p.head0 + wg.z;
  let row0 = wg.y * 64u;
  var acc: array<vec4f, 4>;
  for (var j0 = 0u; j0 < p.nk; j0 += 16u) {
    // Invocation li: queries and dimensions 4 (li / 16).. at key li % 16.
    let jj = li % 16u;
    let j = j0 + jj;
    var a = vec4f(0.0);
    var b = vec4f(0.0);
    for (var c = 0u; c < 4u; c++) {
      let r = (li / 16u) * 4u + c;
      let i = row0 + r;
      if (j < p.nk) {
        if (i < p.nq) { a[c] = s[(wg.z * p.nq + i) * p.nk + j]; }
        b[c] = kv[(p.vr0 + h * 64u + r) * p.nk + j];
      }
    }
    as_[jj * 16u + li / 16u] = ${tileVector(mode, 'a')};
    bs_[jj * 16u + li / 16u] = ${tileVector(mode, 'b')};
    workgroupBarrier();${kStep(mode)}
    workgroupBarrier();
  }
  for (var i = 0u; i < 4u; i++) {
    let r = row0 + l.y * 4u + i;
    if (r >= p.nq) { continue; }
    for (var j = 0u; j < 4u; j++) {
      let d = l.x * 4u + j;
      o[(h * 64u + d) * p.nq + r] = acc[i][j];
    }
  }
}
`;

/**
 * The twiddles both DFT stages use: cos/sin of 2 pi j / 4096 for j < 4096 (an entry every 64 serves
 * the 64-point stage too), built in float64 on the CPU.
 */
export const TWIDDLE_N = 4096;

/**
 * STFT stage A, per (frame s = ch * frames + f, k1, n2): sum over n1 of the windowed sample
 * 64 n1 + n2 of STFT frame f + 2 times e^(-2 pi i k1 n1 / 64), times e^(-2 pi i k1 n2 / 4096). The
 * sample index folds the graph's two reflect pads (hop * 3 / 2, then n_fft / 2) back into the mix.
 */
export const STFT_A = /* wgsl */ `
struct P { frames: u32, len: u32 }
@group(0) @binding(0) var<storage, read> mix: array<f32>;      // [2, len]
@group(0) @binding(1) var<storage, read> win: array<f32>;
@group(0) @binding(2) var<storage, read> tw: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> y: array<vec2f>;  // [2 frames, 64 k1, 64 n2]
@group(0) @binding(4) var<uniform> p: P;
fn reflect(i: i32, n: i32) -> i32 {
  var j = select(i, -i, i < 0);
  return select(j, 2 * (n - 1) - j, j >= n);
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n2 = id.x;
  let k1 = id.y;
  let s = id.z;
  if (n2 >= 64u || k1 >= 64u || s >= 2u * p.frames) { return; }
  let ch = s / p.frames;
  let f = s - ch * p.frames;
  let padded = i32(p.len) + 3072;
  var acc = vec2f(0.0);
  for (var n1 = 0u; n1 < 64u; n1++) {
    let n = n1 * 64u + n2;
    let at = reflect(reflect(i32((f + 2u) * 1024u + n) - 2048, padded) - 1536, i32(p.len));
    let v = mix[ch * p.len + u32(at)] * win[n];
    let t = tw[((k1 * n1) % 64u) * 64u];
    acc += v * vec2f(t.x, -t.y);
  }
  let t = tw[k1 * n2];
  y[(s * 64u + k1) * 64u + n2] = vec2f(acc.x * t.x + acc.y * t.y, acc.y * t.x - acc.x * t.y);
}
`;

/**
 * STFT stage B, per (s, k1, k2 < 32): bin k1 + 64 k2 = sum over n2 of stage A times e^(-2 pi i k2 n2 / 64),
 * written as the graph's complex-as-channels spectrogram [ch * 2 + (re, im), 2048, frames].
 */
export const STFT_B = /* wgsl */ `
struct P { frames: u32 }
@group(0) @binding(0) var<storage, read> y: array<vec2f>;
@group(0) @binding(1) var<storage, read> tw: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> spec: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(32)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let k2 = id.x;
  let k1 = id.y;
  let s = id.z;
  if (k2 >= 32u || k1 >= 64u || s >= 2u * p.frames) { return; }
  var acc = vec2f(0.0);
  for (var n2 = 0u; n2 < 64u; n2++) {
    let v = y[(s * 64u + k1) * 64u + n2];
    let t = tw[((k2 * n2) % 64u) * 64u];
    acc += vec2f(v.x * t.x + v.y * t.y, v.y * t.x - v.x * t.y);
  }
  let ch = s / p.frames;
  let f = s - ch * p.frames;
  let k = k1 + 64u * k2;
  spec[((ch * 2u) * 2048u + k) * p.frames + f] = acc.x;
  spec[((ch * 2u + 1u) * 2048u + k) * p.frames + f] = acc.y;
}
`;

/**
 * iSTFT stage A, per (s = ch * frames + f, k1, n2): sum over k2 of the full spectrum's bin k1 + 64 k2
 * times e^(+2 pi i k2 n2 / 64), times e^(+2 pi i k1 n2 / 4096). The spectrum is one source's four
 * channels of the decoder's output (`source`), scaled back by the input spectrogram's std and mean
 * (stats[0], stats[2]); bin 2048 is zero (the graph's pad) and the upper half its Hermitian mirror.
 */
export const ISTFT_A = /* wgsl */ `
struct P { frames: u32, source: u32 }
@group(0) @binding(0) var<storage, read> z: array<f32>;     // [16, 2048, frames]
@group(0) @binding(1) var<storage, read> stats: array<f32>;
@group(0) @binding(2) var<storage, read> tw: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> y: array<vec2f>;
@group(0) @binding(4) var<uniform> p: P;
fn bin(ch: u32, f: u32, k: u32) -> vec2f {
  let kk = select(k, 4096u - k, k > 2048u);
  if (kk == 2048u) { return vec2f(0.0); }
  let base = (p.source * 4u + ch * 2u) * 2048u + kk;
  let re = z[base * p.frames + f] * stats[2] + stats[0];
  let im = z[(base + 2048u) * p.frames + f] * stats[2] + stats[0];
  return select(vec2f(re, im), vec2f(re, -im), k > 2048u);
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n2 = id.x;
  let k1 = id.y;
  let s = id.z;
  if (n2 >= 64u || k1 >= 64u || s >= 2u * p.frames) { return; }
  let ch = s / p.frames;
  let f = s - ch * p.frames;
  var acc = vec2f(0.0);
  for (var k2 = 0u; k2 < 64u; k2++) {
    let v = bin(ch, f, k1 + 64u * k2);
    let t = tw[((k2 * n2) % 64u) * 64u];
    acc += vec2f(v.x * t.x - v.y * t.y, v.x * t.y + v.y * t.x);
  }
  let t = tw[k1 * n2];
  y[(s * 64u + k1) * 64u + n2] = vec2f(acc.x * t.x - acc.y * t.y, acc.x * t.y + acc.y * t.x);
}
`;

/** iSTFT stage B, per (s, n = 64 n1 + n2): Re sum over k1 of stage A times e^(+2 pi i k1 n1 / 64), / 4096, times the window. */
export const ISTFT_B = /* wgsl */ `
struct P { frames: u32 }
@group(0) @binding(0) var<storage, read> y: array<vec2f>;
@group(0) @binding(1) var<storage, read> tw: array<vec2f>;
@group(0) @binding(2) var<storage, read> win: array<f32>;
@group(0) @binding(3) var<storage, read_write> out: array<f32>;  // [2 frames, 4096]
@group(0) @binding(4) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n2 = id.x;
  let n1 = id.y;
  let s = id.z;
  if (n2 >= 64u || n1 >= 64u || s >= 2u * p.frames) { return; }
  var acc = 0.0;
  for (var k1 = 0u; k1 < 64u; k1++) {
    let v = y[(s * 64u + k1) * 64u + n2];
    let t = tw[((k1 * n1) % 64u) * 64u];
    acc += v.x * t.x - v.y * t.y;
  }
  let n = n1 * 64u + n2;
  out[s * 4096u + n] = acc / 4096.0 * win[n];
}
`;

/**
 * The output, per (ch, sample j): the overlap-add of the iSTFT frames at padded position
 * 2048 + 1536 + j (frames f + 2, hop 1024), over the window-sum normaliser, plus the time branch's
 * same source scaled back by the mix's std and mean (tstats[2], tstats[0]).
 */
export const OVERLAP_ADD = /* wgsl */ `
struct P { frames: u32, len: u32, source: u32, out_at: u32 }
@group(0) @binding(0) var<storage, read> fr: array<f32>;
@group(0) @binding(1) var<storage, read> env: array<f32>;
@group(0) @binding(2) var<storage, read> xt: array<f32>;      // [8, len]
@group(0) @binding(3) var<storage, read> tstats: array<f32>;
@group(0) @binding(4) var<storage, read_write> out: array<f32>; // [2, len] at out_at (one per source asked for)
@group(0) @binding(5) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(num_workgroups) groups: vec3u) {
  let i = id.x + id.y * groups.x * 256u;
  if (i >= 2u * p.len) { return; }
  let ch = i / p.len;
  let j = i - ch * p.len;
  let pos = 3584u + j;
  var acc = 0.0;
  let last = pos / 1024u;
  for (var jj = select(0u, last - 3u, last >= 3u); jj <= last; jj++) {
    if (jj < 2u || jj >= p.frames + 2u) { continue; }
    let n = pos - jj * 1024u;
    if (n < 4096u) { acc += fr[(ch * p.frames + jj - 2u) * 4096u + n]; }
  }
  let t = xt[(p.source * 2u + ch) * p.len + j] * tstats[2] + tstats[0];
  out[p.out_at + i] = acc / env[1536u + j] + t;
}
`;
