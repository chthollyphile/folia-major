import { WEIGHTS, type Kernel } from './kernels';

// src/services/analysis/strokesWgsl/kernelsSeq.ts
// WGSL for the parts of full6's decode step that are not a GEMM: multi-head attention (the decoder's KV
// cache, the cross-attention over the per-character memory, the refine layers' 16-point self-attention;
// own2's bottleneck uses it too), the step's input embedding (seg_feat + grid_sample of fmap), the refine
// layers' deformable sampling, the continue / end decision and snap, and the step counter.
//
// Always f32 (HANDOFF_FOLIA.md §4, and the brief): sampling coordinates, fourier, coordinate accumulation
// and the decisions. Storage that may be f16 (KV caches, fmap) is read through `kvT` / `fmT`.
//
// The decode state buffer `st` (u32): st[0] = t, st[1] = active slots, st[16 + slot] = the slot's
// character. Per-step activations are slot-indexed; caches, memory and outputs character-indexed, so
// the host can drop finished characters by rewriting st[1] and the slot table between groups of steps;
// st[16 + capacity + char] is the character's done word (bit 0 done, length << 8), read back in groups.

/** Words before the slot table in the state buffer. */
export const STATE_HEAD = 16;
/** Most decode steps (seqinfer tmax) and rows per character in the KV cache and outputs. */
export const TMAX = 96;
/** Memory rows per character: 256 image tokens + 40 reference tokens. */
export const MEM_ROWS = 296;
/** Floats recorded per (character, step): refined pos 32, coarse 32, cont logit, end logit. */
export const REC = 66;

/**
 * sin and cos of an f32 angle up to a few thousand radians, to ~1 ulp: fourier's 2^7 pi * x reaches
 * ~400, where a GPU's native sin is far off. Cody-Waite reduction by pi/2 (three-part constant), then
 * Cephes' sinf / cosf polynomials on [-pi/4, pi/4].
 */
export const SINCOS = /* wgsl */ `
fn sincos(a: f32) -> vec2f {
  let n = round(a * 0.63661977236758134);
  var r = a - n * 1.5703125;
  r = r - n * 4.837512969970703125e-4;
  r = r - n * 7.54978995489188216e-8;
  let z = r * r;
  let s = r + r * z * (-1.6666654611e-1 + z * (8.3321608736e-3 + z * -1.9515295891e-4));
  let c = 1.0 - 0.5 * z + z * z * (4.166664568298827e-2 + z * (-1.388731625493765e-3 + z * 2.443315711809948e-5));
  let q = i32(n) & 3;
  if (q == 0) { return vec2f(s, c); }
  if (q == 1) { return vec2f(c, -s); }
  if (q == 2) { return vec2f(-s, -c); }
  return vec2f(-c, s);
}
`;

/** fourier's frequencies 2^i pi in f32 (exact: f32(pi) times a power of two). */
const FREQ = /* wgsl */ `
fn freq(i: u32) -> f32 { return 3.1415927410125732 * f32(1u << i); }
`;

/** grid_sample (bilinear, zeros, align_corners=False) of a channel-last map [side, side, C] at canvas (x, y), channel c. */
const gridSample = (name: string, side: number, channels: number) => /* wgsl */ `
fn ${name}Tap(base: u32, y: f32, x: f32, c: u32) -> f32 {
  if (x < 0.0 || x > ${side - 1}.0 || y < 0.0 || y > ${side - 1}.0) { return 0.0; }
  return f32(${name}[(base + u32(y) * ${side}u + u32(x)) * ${channels}u + c]);
}
fn ${name}Sample(base: u32, px: f32, py: f32, c: u32) -> f32 {
  let ix = ((px + 1.0) * ${side}.0 - 1.0) / 2.0;
  let iy = ((py + 1.0) * ${side}.0 - 1.0) / 2.0;
  let x0 = floor(ix);
  let y0 = floor(iy);
  let x1 = x0 + 1.0;
  let y1 = y0 + 1.0;
  let nw = (x1 - ix) * (y1 - iy);
  let ne = (ix - x0) * (y1 - iy);
  let sw = (x1 - ix) * (iy - y0);
  let se = (ix - x0) * (iy - y0);
  return ${name}Tap(base, y0, x0, c) * nw + ${name}Tap(base, y0, x1, c) * ne + ${name}Tap(base, y1, x0, c) * sw + ${name}Tap(base, y1, x1, c) * se;
}
`;

/** ATTN flags. */
export const ATT_SLOT = 1;
export const ATT_DYNK = 2;
export const ATT_MASK = 4;
export const ATTN_FIELDS = ['nq', 'ldq', 'qoff', 'ldkv', 'koff', 'voff', 'kvgs', 'nk', 'ldo', 'ooff', 'mgs', 'flags'] as const;

/**
 * softmax(q k^T / sqrt(32) + mask) v for one head of 32, NQB queries a workgroup: workgroup (query block,
 * head, group). Group g's queries are rows g * nq + i of Q; its keys rows kg * kvgs + j of KV (kg = g, or the
 * slot's character with ATT_SLOT), nk of them (st[0] + 1 with ATT_DYNK: the KV cache up to step t); the
 * additive mask (ATT_MASK) at mask[kg * mgs + j]. Scores live in workgroup memory, up to MAXK keys.
 */
export const attentionKernel = (nqb: 1 | 8, kvHalf: boolean): Kernel => {
    const maxk = 296;
    const lanes = 256 / nqb;
    const split = 256 / (nqb * 32);
    return {
        bindings: ['q', 'kv', 'o', 'st', 'mask'],
        uniform: true,
        code: /* wgsl */ `
${kvHalf ? 'enable f16;' : ''}
struct P { nq: u32, ldq: u32, qoff: u32, ldkv: u32, koff: u32, voff: u32, kvgs: u32, nk: u32, ldo: u32, ooff: u32, mgs: u32, flags: u32 }
@group(0) @binding(0) var<storage, read> q: array<f32>;
@group(0) @binding(1) var<storage, read> kv: array<${kvHalf ? 'f16' : 'f32'}>;
@group(0) @binding(2) var<storage, read_write> o: array<f32>;
@group(0) @binding(3) var<storage, read> st: array<u32>;
@group(0) @binding(4) var<storage, read> mask: array<f32>;
@group(0) @binding(5) var<uniform> p: P;
var<workgroup> qs: array<f32, ${nqb * 32}>;
var<workgroup> sc: array<f32, ${nqb * maxk}>;
var<workgroup> red: array<f32, 256>;
var<workgroup> invs: array<f32, ${nqb}>;
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let h = wg.y;
  let g = wg.z;
  let kg = select(g, st[${STATE_HEAD}u + g], (p.flags & ${ATT_SLOT}u) != 0u);
  let nk = select(p.nk, st[0] + 1u, (p.flags & ${ATT_DYNK}u) != 0u);
  let q0 = wg.x * ${nqb}u;
  for (var e = li; e < ${nqb * 32}u; e += 256u) {
    let qi = q0 + e / 32u;
    var v = 0.0;
    if (qi < p.nq) { v = q[(g * p.nq + qi) * p.ldq + p.qoff + h * 32u + e % 32u] * 0.17677669529663687; }
    qs[e] = v;
  }
  workgroupBarrier();
  let kbase = kg * p.kvgs;
  for (var e = li; e < ${nqb}u * nk; e += 256u) {
    let i = e / nk;
    let j = e - i * nk;
    let kr = (kbase + j) * p.ldkv + p.koff + h * 32u;
    var s = 0.0;
    for (var d = 0u; d < 32u; d++) { s += qs[i * 32u + d] * f32(kv[kr + d]); }
    if ((p.flags & ${ATT_MASK}u) != 0u) { s += mask[kg * p.mgs + j]; }
    sc[i * ${maxk}u + j] = s;
  }
  workgroupBarrier();
  let row = li / ${lanes}u;
  let lane = li % ${lanes}u;
  var m = -3.0e38;
  for (var j = lane; j < nk; j += ${lanes}u) { m = max(m, sc[row * ${maxk}u + j]); }
  red[li] = m;
  workgroupBarrier();
  for (var span = ${lanes / 2}u; span > 0u; span >>= 1u) {
    if (lane < span) { red[li] = max(red[li], red[li + span]); }
    workgroupBarrier();
  }
  m = red[row * ${lanes}u];
  workgroupBarrier();
  var s = 0.0;
  for (var j = lane; j < nk; j += ${lanes}u) {
    let e = exp(sc[row * ${maxk}u + j] - m);
    sc[row * ${maxk}u + j] = e;
    s += e;
  }
  red[li] = s;
  workgroupBarrier();
  for (var span = ${lanes / 2}u; span > 0u; span >>= 1u) {
    if (lane < span) { red[li] += red[li + span]; }
    workgroupBarrier();
  }
  if (lane == 0u) { invs[row] = 1.0 / red[li]; }
  workgroupBarrier();
  let oi = li / ${split}u;
  let part = li % ${split}u;
  let i = oi / 32u;
  let d = oi % 32u;
  var acc = 0.0;
  let vb = p.voff + h * 32u + d;
  for (var j = part; j < nk; j += ${split}u) { acc += sc[i * ${maxk}u + j] * f32(kv[(kbase + j) * p.ldkv + vb]); }
  ${split > 1 ? `red[li] = acc;
  workgroupBarrier();
  if (part == 0u) { for (var r = 1u; r < ${split}u; r++) { acc += red[li + r]; } }` : ''}
  if (part == 0u && q0 + i < p.nq) { o[(g * p.nq + q0 + i) * p.ldo + p.ooff + h * 32u + d] = acc * invs[i]; }
}
`,
    };
};

/**
 * The step's input token, one workgroup (128) a slot: t = 0 writes x = bos + tpos[0]; otherwise x =
 * cont_in[pc] + tpos[t] and the inputs of its GEMMs: seg_feat of the previous segment (segs[char][t-1])
 * and fmap sampled at its last two points (point-major, 2 x 128), which seg_in / loc_in then add to x.
 */
export const embedKernel = (fmHalf: boolean): Kernel => ({
    bindings: ['W', 'fm', 'segs', 'cont', 'st', 'feat', 'loc', 'x'],
    uniform: true,
    code: /* wgsl */ `
${fmHalf ? 'enable f16;' : ''}
${WEIGHTS}
${SINCOS}
${FREQ}
struct P { bos: u32, tpos: u32, contIn: u32 }
@group(0) @binding(1) var<storage, read> fm: array<${fmHalf ? 'f16' : 'f32'}>;
@group(0) @binding(2) var<storage, read> segs: array<f32>;
@group(0) @binding(3) var<storage, read> cont: array<u32>;
@group(0) @binding(4) var<storage, read> st: array<u32>;
@group(0) @binding(5) var<storage, read_write> feat: array<f32>;
@group(0) @binding(6) var<storage, read_write> loc: array<f32>;
@group(0) @binding(7) var<storage, read_write> x: array<f32>;
@group(0) @binding(8) var<uniform> p: P;
${gridSample('fm', 64, 128)}
@compute @workgroup_size(128)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let g = wg.x;
  let ch = st[${STATE_HEAD}u + g];
  let t = st[0];
  if (t == 0u) {
    for (var c = li; c < 192u; c += 128u) { x[g * 192u + c] = wf(p.bos + c) + wf(p.tpos + c); }
    return;
  }
  let pb = (ch * ${TMAX}u + t - 1u) * 32u;
  let pc = cont[ch * ${TMAX}u + t - 1u];
  for (var c = li; c < 192u; c += 128u) { x[g * 192u + c] = wf(p.contIn + pc * 192u + c) + wf(p.tpos + t * 192u + c); }
  if (li < 32u) { feat[g * 160u + li] = segs[pb + li]; }
  if (li < 64u) {
    let pt = li / 16u;
    let c = (li / 8u) % 2u;
    let i = li % 8u;
    let k = array<u32, 4>(0u, 5u, 10u, 15u)[pt];
    let sc = sincos(segs[pb + 2u * k + c] * freq(i));
    let o = g * 160u + 32u + pt * 32u + c * 16u + i;
    feat[o] = sc.x;
    feat[o + 8u] = sc.y;
  }
  let base = ch * 4096u;
  for (var e = 0u; e < 2u; e++) {
    loc[g * 256u + e * 128u + li] = fmSample(base, segs[pb + 28u + 2u * e], segs[pb + 29u + 2u * e], li);
  }
}
`,
});

/**
 * A refine layer's deformable sampling, one workgroup (128, a channel each) per point token: off / w
 * from q (Linear 192 -> 16 + 8 against f16 weights, f32), off = tanh * 0.12, softmax(w), then
 * sf[tok] = [sum_p w_p * grid_sample(fmap, pos + off_p) (128), fourier(pos) (32)] for loc and the pos MLP.
 * `init` (the first layer) first builds q = pt_in(h) + point[k] and pos = coarse from the head's outputs
 * (hh [slot][384] = silu(coarse.0) | pt_in, coarse [slot][32]).
 */
export const refineSampleKernel = (fmHalf: boolean): Kernel => ({
    bindings: ['W', 'fm', 'st', 'q', 'pos', 'hh', 'coarse', 'sf'],
    uniform: true,
    code: /* wgsl */ `
${fmHalf ? 'enable f16;' : ''}
${WEIGHTS}
${SINCOS}
${FREQ}
struct P { offw: u32, offb: u32, point: u32, init: u32 }
@group(0) @binding(1) var<storage, read> fm: array<${fmHalf ? 'f16' : 'f32'}>;
@group(0) @binding(2) var<storage, read> st: array<u32>;
@group(0) @binding(3) var<storage, read_write> q: array<f32>;
@group(0) @binding(4) var<storage, read_write> pos: array<f32>;
@group(0) @binding(5) var<storage, read> hh: array<f32>;
@group(0) @binding(6) var<storage, read> coarse: array<f32>;
@group(0) @binding(7) var<storage, read_write> sf: array<f32>;
@group(0) @binding(8) var<uniform> p: P;
${gridSample('fm', 64, 128)}
var<workgroup> qs: array<f32, 192>;
var<workgroup> ow: array<f32, 24>;
var<workgroup> wts: array<f32, 8>;
@compute @workgroup_size(128)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(num_workgroups) nw: vec3u, @builtin(local_invocation_index) li: u32) {
  let tok = wg.x + wg.y * nw.x;
  let g = tok / 16u;
  let k = tok % 16u;
  let ch = st[${STATE_HEAD}u + g];
  if (p.init != 0u) {
    for (var c = li; c < 192u; c += 128u) {
      let v = hh[g * 384u + 192u + c] + wf(p.point + k * 192u + c);
      q[tok * 192u + c] = v;
      qs[c] = v;
    }
    if (li < 2u) { pos[tok * 2u + li] = coarse[g * 32u + 2u * k + li]; }
  } else {
    for (var c = li; c < 192u; c += 128u) { qs[c] = q[tok * 192u + c]; }
  }
  workgroupBarrier();
  var px = pos[tok * 2u];
  var py = pos[tok * 2u + 1u];
  if (p.init != 0u) {
    px = coarse[g * 32u + 2u * k];
    py = coarse[g * 32u + 2u * k + 1u];
  }
  if (li < 24u) {
    var s = 0.0;
    for (var i = 0u; i < 192u; i++) { s += qs[i] * wh(p.offw, li * 192u + i); }
    ow[li] = s + wf(p.offb + li);
  }
  workgroupBarrier();
  if (li < 16u) { ow[li] = tanh(ow[li]) * 0.12; }
  if (li == 16u) {
    var m = ow[16];
    for (var i = 17u; i < 24u; i++) { m = max(m, ow[i]); }
    var sum = 0.0;
    for (var i = 0u; i < 8u; i++) { let e = exp(ow[16u + i] - m); wts[i] = e; sum += e; }
    for (var i = 0u; i < 8u; i++) { wts[i] = wts[i] / sum; }
  }
  workgroupBarrier();
  let base = ch * 4096u;
  var s = 0.0;
  for (var i = 0u; i < 8u; i++) { s += fmSample(base, px + ow[2u * i], py + ow[2u * i + 1u], li) * wts[i]; }
  sf[tok * 160u + li] = s;
  if (li < 16u) {
    let c = li / 8u;
    let i = li % 8u;
    let sc = sincos(select(px, py, c == 1u) * freq(i));
    sf[tok * 160u + 128u + c * 16u + i] = sc.x;
    sf[tok * 160u + 128u + c * 16u + 8u + i] = sc.y;
  }
}
`,
});

/**
 * The step's decision, one workgroup (64) a slot: cont / end logits from nf(x) in f32, recorded with
 * the refined and coarse points at rec[char][t]. Generating (`gen`): a character not yet done ends at
 * end > 0 (length t), else its segment is snapped (cont = cont > 0 and t > 0: start pulled to the last
 * segment's end, linspace(1, 0, 16) ramp) and written to segs[char][t] / cont[char][t], the next step's input.
 */
export const DECIDE: Kernel = {
    bindings: ['W', 'st', 'x', 'pos', 'coarse', 'segs', 'cont', 'rec'],
    uniform: true,
    code: /* wgsl */ `
${WEIGHTS}
struct P { nfg: u32, nfb: u32, dw: u32, db: u32, gen: u32, doneAt: u32 }
@group(0) @binding(1) var<storage, read_write> st: array<u32>;
@group(0) @binding(2) var<storage, read> x: array<f32>;
@group(0) @binding(3) var<storage, read> pos: array<f32>;
@group(0) @binding(4) var<storage, read> coarse: array<f32>;
@group(0) @binding(5) var<storage, read_write> segs: array<f32>;
@group(0) @binding(6) var<storage, read_write> cont: array<u32>;
@group(0) @binding(7) var<storage, read_write> rec: array<f32>;
@group(0) @binding(8) var<uniform> p: P;
var<workgroup> red: array<f32, 64>;
var<workgroup> red2: array<f32, 64>;
fn total(li: u32, v: f32) -> f32 {
  red[li] = v;
  workgroupBarrier();
  for (var span = 32u; span > 0u; span >>= 1u) {
    if (li < span) { red[li] += red[li + span]; }
    workgroupBarrier();
  }
  let s = red[0];
  workgroupBarrier();
  return s;
}
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let g = wg.x;
  let ch = st[${STATE_HEAD}u + g];
  let t = st[0];
  var v: array<f32, 3>;
  var s = 0.0;
  for (var i = 0u; i < 3u; i++) { v[i] = x[g * 192u + li + 64u * i]; s += v[i]; }
  let mean = total(li, s) / 192.0;
  s = 0.0;
  for (var i = 0u; i < 3u; i++) { let d = v[i] - mean; s += d * d; }
  let rstd = 1.0 / sqrt(total(li, s) / 192.0 + 1e-5);
  var lc = 0.0;
  var le = 0.0;
  for (var i = 0u; i < 3u; i++) {
    let c = li + 64u * i;
    let h = (v[i] - mean) * rstd * wf(p.nfg + c) + wf(p.nfb + c);
    lc += h * wh(p.dw, c);
    le += h * wh(p.dw, 192u + c);
  }
  lc = total(li, lc) + wf(p.db);
  le = total(li, le) + wf(p.db + 1u);
  let r = (ch * ${TMAX}u + t) * ${REC}u;
  if (li < 32u) {
    rec[r + li] = pos[g * 32u + li];
    rec[r + 32u + li] = coarse[g * 32u + li];
  }
  if (li == 0u) { rec[r + 64u] = lc; rec[r + 65u] = le; }
  if (p.gen == 0u || (st[p.doneAt + ch] & 1u) != 0u) { return; }
  if (le > 0.0) {
    if (li == 0u) { st[p.doneAt + ch] = 1u | (t << 8u); }
    return;
  }
  let snap = lc > 0.0 && t > 0u;
  if (li < 32u) {
    let k = li / 2u;
    var pv = pos[g * 32u + li];
    if (snap) {
      let step = -1.0 / 15.0;
      let ramp = select(0.0 - step * f32(15u - k), 1.0 + step * f32(k), k < 8u);
      pv = pv + (segs[(ch * ${TMAX}u + t - 1u) * 32u + 30u + li % 2u] - pos[g * 32u + li % 2u]) * ramp;
    }
    segs[(ch * ${TMAX}u + t) * 32u + li] = pv;
  }
  if (li == 0u) { cont[ch * ${TMAX}u + t] = select(0u, 1u, snap); }
}
`,
};

/** st[0] += 1: the GPU-side step counter, so steps can be queued without a host write in between. */
export const ADVANCE: Kernel = {
    bindings: ['st'],
    uniform: false,
    code: /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> st: array<u32>;
@compute @workgroup_size(1)
fn main() { st[0] = st[0] + 1u; }
`,
};
