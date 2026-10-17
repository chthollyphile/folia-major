#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <vector>
#if defined(__aarch64__) || defined(_M_ARM64)
#include <arm_neon.h>
#define FOLIA_NEON 1
#elif defined(__SSE2__) || defined(_M_X64)
#include <emmintrin.h>
#if defined(__FMA__) || defined(__AVX2__)
#include <immintrin.h>
#define FOLIA_FMA 1
#endif
#define FOLIA_SSE 1
#endif

// native/folia-mnn/dconv_kernels.hpp
// FoliaDConv's arithmetic (folia_dconv.cpp has the op and why it exists), free of MNN.
//
// Included once per instruction set into a translation unit of its own - dconv_kernels_*.cpp -
// inside the namespace that file names in FOLIA_DCONV_NS, so the SSE2 and the AVX2+FMA copies of
// every function here are different symbols. That is not tidiness: two inline functions of one name
// compiled with different flags are one function to the linker, which keeps either copy, and a
// machine without AVX2 then dies on the first FMA. Everything below is therefore inside the
// namespace, and nothing here may be declared outside it.
//
// fp32 throughout. On x86 the AVX2 build adds fused multiply-adds to the same 4-lane code; the
// lanes, the block shapes and the summation order are the same, so the two differ only by FMA
// rounding.

#ifndef FOLIA_DCONV_NS
#error "include from dconv_kernels_*.cpp, which names the namespace"
#endif

namespace FOLIA_DCONV_NS {

// ------------------------------------------------------------------------------------------ 4 lanes
#if defined(FOLIA_NEON)
using v4 = float32x4_t;
inline v4 vld(const float* p) { return vld1q_f32(p); }
inline void vst(float* p, v4 v) { vst1q_f32(p, v); }
inline v4 vdup(float f) { return vdupq_n_f32(f); }
inline v4 vadd(v4 a, v4 b) { return vaddq_f32(a, b); }
inline v4 vfma(v4 acc, v4 a, v4 b) { return vfmaq_f32(acc, a, b); }  // acc + a*b
inline v4 vmin(v4 a, v4 b) { return vminq_f32(a, b); }
inline v4 vmax(v4 a, v4 b) { return vmaxq_f32(a, b); }
inline v4 vround(v4 a) { return vrndnq_f32(a); }
inline v4 vsub(v4 a, v4 b) { return vsubq_f32(a, b); }
inline v4 vmul(v4 a, v4 b) { return vmulq_f32(a, b); }
inline v4 vpow2i(v4 n) { return vreinterpretq_f32_s32(vshlq_n_s32(vaddq_s32(vcvtq_s32_f32(n), vdupq_n_s32(127)), 23)); }
// 1/d: estimate and one Newton step, 1.5e-5 relative
inline v4 vrecip(v4 d) {
    const v4 r = vrecpeq_f32(d);
    return vmulq_f32(r, vrecpsq_f32(d, r));
}
inline float vsum(v4 a) { return vaddvq_f32(a); }
#elif defined(FOLIA_SSE)
using v4 = __m128;
inline v4 vld(const float* p) { return _mm_loadu_ps(p); }
inline void vst(float* p, v4 v) { _mm_storeu_ps(p, v); }
inline v4 vdup(float f) { return _mm_set1_ps(f); }
inline v4 vadd(v4 a, v4 b) { return _mm_add_ps(a, b); }
#if defined(FOLIA_FMA)
inline v4 vfma(v4 acc, v4 a, v4 b) { return _mm_fmadd_ps(a, b, acc); }
#else
inline v4 vfma(v4 acc, v4 a, v4 b) { return _mm_add_ps(acc, _mm_mul_ps(a, b)); }
#endif
inline v4 vmin(v4 a, v4 b) { return _mm_min_ps(a, b); }
inline v4 vmax(v4 a, v4 b) { return _mm_max_ps(a, b); }
// round to nearest for |a| < 2^22 without SSE4.1: add and subtract 1.5 * 2^23
inline v4 vround(v4 a) {
    const v4 m = _mm_set1_ps(12582912.0f);
    return _mm_sub_ps(_mm_add_ps(a, m), m);
}
inline v4 vsub(v4 a, v4 b) { return _mm_sub_ps(a, b); }
inline v4 vmul(v4 a, v4 b) { return _mm_mul_ps(a, b); }
inline v4 vpow2i(v4 n) { return _mm_castsi128_ps(_mm_slli_epi32(_mm_add_epi32(_mm_cvtps_epi32(n), _mm_set1_epi32(127)), 23)); }
inline v4 vrecip(v4 d) { return _mm_div_ps(_mm_set1_ps(1.0f), d); }
inline float vsum(v4 a) {
    alignas(16) float t[4];
    _mm_store_ps(t, a);
    return (t[0] + t[1]) + (t[2] + t[3]);
}
#else
#error "FoliaDConv needs NEON or SSE2"
#endif

// 2^d for d in [-126, 126]: 2^n by exponent bits times a degree-5 polynomial for 2^f, f in [-1/2, 1/2]
// (2.4e-6 relative).
inline v4 vexp2(v4 d) {
    d = vmax(vmin(d, vdup(126.0f)), vdup(-126.0f));
    const v4 n = vround(d);
    const v4 f = vsub(d, n);
    v4 p = vdup(1.3333558146428443e-3f);
    p = vfma(vdup(9.6181291076284772e-3f), p, f);
    p = vfma(vdup(5.5504108664821580e-2f), p, f);
    p = vfma(vdup(2.4022650695910071e-1f), p, f);
    p = vfma(vdup(6.9314718055994531e-1f), p, f);
    p = vfma(vdup(1.0f), p, f);
    return vmul(p, vpow2i(n));
}

// sum and sum of squares of n values, in fp32 lanes, into doubles
inline void moments(const float* p, int n, double& sum, double& sq) {
    v4 a0 = vdup(0), a1 = a0, b0 = a0, b1 = a0;
    int i = 0;
    for (; i + 8 <= n; i += 8) {
        const v4 u = vld(p + i), w = vld(p + i + 4);
        a0 = vadd(a0, u); a1 = vadd(a1, w);
        b0 = vfma(b0, u, u); b1 = vfma(b1, w, w);
    }
    float s = vsum(vadd(a0, a1)), q = vsum(vadd(b0, b1));
    for (; i < n; ++i) { const float v = p[i]; s += v; q += v * v; }
    sum += s;
    sq += q;
}

inline float dot(const float* a, const float* b, int n) {
    v4 s0 = vdup(0), s1 = s0;
    int i = 0;
    for (; i + 8 <= n; i += 8) {
        s0 = vfma(s0, vld(a + i), vld(b + i));
        s1 = vfma(s1, vld(a + i + 4), vld(b + i + 4));
    }
    float s = vsum(vadd(s0, s1));
    for (; i < n; ++i) s += a[i] * b[i];
    return s;
}

// ------------------------------------------------------------------------------------------ kernels
constexpr int kOB = 6;     // outputs per block: H = C/8 and 2C are multiples of 6 for every layer here
constexpr int kCols = 16;  // columns per block

// acc[o][q] (o < 6, q < kQ quads of 4 columns from column c0) = sum_k wp[k][o] * rows[k][c0 + 4q ..]
// NEON keeps all 16 columns (24 accumulators of 32 registers); SSE's 16 registers take 8 at a time.
#if defined(FOLIA_NEON)
constexpr int kQ = 4;
#else
constexpr int kQ = 2;
#endif
inline void blockSums(const float* const* rows, int K, const float* wb, int c0, v4 (&acc)[kOB][kQ]) {
    for (int k = 0; k < K; ++k) {
        const float* x = rows[k] + c0;
        const float* w = wb + (size_t)k * 8;
        v4 xv[kQ];
        for (int q = 0; q < kQ; ++q) xv[q] = vld(x + 4 * q);
#if defined(FOLIA_NEON)
        const float32x4_t w0 = vld1q_f32(w), w1 = vld1q_f32(w + 4);
#define FOLIA_ROW(o, wv, l) for (int q = 0; q < kQ; ++q) acc[o][q] = vfmaq_laneq_f32(acc[o][q], xv[q], wv, l);
        FOLIA_ROW(0, w0, 0) FOLIA_ROW(1, w0, 1) FOLIA_ROW(2, w0, 2) FOLIA_ROW(3, w0, 3) FOLIA_ROW(4, w1, 0) FOLIA_ROW(5, w1, 1)
#undef FOLIA_ROW
#else
        for (int o = 0; o < kOB; ++o) {
            const v4 wv = vdup(w[o]);
            for (int q = 0; q < kQ; ++q) acc[o][q] = vfma(acc[o][q], xv[q], wv);
        }
#endif
    }
}

// out[o * ldo + i] = bias[o] + sum_k W[o, k] * rows[k][tb + i], o < O, i < 16
inline void convBlock(const float* const* rows, int K, const float* wp, int O, const float* bias, int tb, float* out, int ldo) {
    for (int ob = 0; ob < O / kOB; ++ob)
        for (int c0 = 0; c0 < kCols; c0 += 4 * kQ) {
            v4 acc[kOB][kQ];
            for (int o = 0; o < kOB; ++o)
                for (int q = 0; q < kQ; ++q) acc[o][q] = vdup(bias[ob * kOB + o]);
            blockSums(rows, K, wp + (size_t)ob * K * 8, tb + c0, acc);
            for (int o = 0; o < kOB; ++o)
                for (int q = 0; q < kQ; ++q) vst(out + (size_t)(ob * kOB + o) * ldo + c0 + 4 * q, acc[o][q]);
        }
}

// aff = [Aa | Ba | Ag | Bg] per channel with bias, GroupNorm, LayerScale s and -log2(e) folded in:
// s*a = Aa*sum_a + Ba and -g*log2(e) = Ag*sum_g + Bg, so y = x + s*a*sigmoid(g) = x + (Aa*sum_a + Ba) / (1 + 2^(Ag*sum_g + Bg)).
// Columns tb..tb+w (w <= 16) of rows c of x and y, which are ld apart.
inline void gluBlock(const float* const* rows, int K, const float* wp, int C, const float* aff, int tb, int w,
                     const float* x, float* y, size_t ld) {
    for (int cb = 0; cb < C / 3; ++cb)
        for (int c0 = 0; c0 < kCols && c0 < w; c0 += 4 * kQ) {
            v4 acc[kOB][kQ];
            for (int o = 0; o < kOB; ++o)
                for (int q = 0; q < kQ; ++q) acc[o][q] = vdup(0);
            blockSums(rows, K, wp + (size_t)cb * K * 8, tb + c0, acc);
            const int wq = std::min(4 * kQ, w - c0);  // valid columns in this part
            for (int j = 0; j < 3; ++j) {
                const int c = cb * 3 + j;
                const v4 Aa = vdup(aff[c]), Ba = vdup(aff[C + c]), Ag = vdup(aff[2 * C + c]), Bg = vdup(aff[3 * C + c]);
                const float* xr = x + (size_t)c * ld + tb + c0;
                float* yr = y + (size_t)c * ld + tb + c0;
                float tx[4 * kQ], ty[4 * kQ];
                if (wq < 4 * kQ) {
                    std::memset(tx, 0, sizeof(tx));
                    std::memcpy(tx, xr, sizeof(float) * wq);
                    xr = tx;
                }
                float* yo = wq < 4 * kQ ? ty : yr;
                for (int q = 0; q < kQ; ++q) {
                    const v4 av = vfma(Ba, acc[j][q], Aa);
                    const v4 den = vadd(vdup(1.0f), vexp2(vfma(Bg, acc[j + 3][q], Ag)));
                    vst(yo + 4 * q, vfma(vld(xr + 4 * q), av, vrecip(den)));
                }
                if (yo == ty) std::memcpy(yr, ty, sizeof(float) * wq);
            }
        }
}

} // namespace FOLIA_DCONV_NS
