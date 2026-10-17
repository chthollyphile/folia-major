#include <MNN/plugin/PluginKernel.hpp>
#include <MNN/plugin/PluginShapeInference.hpp>
#include <algorithm>
#include <cmath>
#include <functional>
#include <vector>
#include "backend/cpu/CPUBackend.hpp"
#include "core/BufferAllocator.hpp"
#include "core/TensorUtils.hpp"
#include "dconv_kernels.h"

// native/folia-mnn/folia_dconv.cpp
// FoliaDConv: one whole htdemucs DConv layer as a single MNN CPU operator.
//
//   FoliaDConv (x[B,C,L], W1[H,C,3], b1[H], g1[H], be1[H], W2[2C,H,1], b2[2C], g2[2C], be2[2C], scale[C])
//     -> x + scale * a * sigmoid(g),  [a; g] = GN(W2 . GELU(GN(conv3_dilated(x, W1) + b1)) + b2)
//   attrs: dilation, eps1, eps2.  GN is GroupNorm with one group (statistics over a sample's C x L).
//
// Why it exists: the layer's convolutions have H = C/8 outputs (6 at the first level) and a 1x1 over H
// inputs. MNN's GEMM tiles pad those to 64 outputs on SME2 and to 8 on NEON, mostly multiplying zeros,
// and every edge between the layer's eight operators was a layout conversion. On an M4 that was 27ms of
// a 145ms segment, and in fp32 the whole htdemucs window went from 4.2s to 3.1s with this operator -
// faster than the onnxruntime build it replaced, where without it MNN was 12% slower. The model's
// layers are built on it by folia_htdemucs.cpp (rewritten into it by build/htdemucs_mnn/make_model.py
// before that, removed); the result is identical to the unfused graph to float rounding (the red line
// in src/services/automix/MODELS.md §2.7).
//
// fp32 only: the model ships and is checked in fp32. The arithmetic is in dconv_kernels.hpp, compiled
// once per instruction set and chosen per CPU (dconv_kernels.h); this file is the operator around it.
//
// Three passes over units of (sample, column chunk), one barrier each, because both GroupNorms need a
// whole sample's statistics:
//   1  h = conv3(x) + b1 (fp32 scratch) and its moments;
//   2  hn = GELU(GN(h)) (fp32 scratch) and hn's moments S = sum hn_t, M = sum hn_t hn_t^T. z = W2 hn + b2
//      is linear in hn, so sum z = wbar.S + L beta and sum z^2 = <W2^T W2, M> + 2 (W2^T b2).S + L |b2|^2:
//      z's statistics without computing z (M costs H/(4C) = 1/32 of the conv);
//   3  z = W2 hn + b2 a 16-column block at a time, finished into y in registers: W2 is packed so a block
//      of 6 outputs is 3 'a' channels and their 3 'g' partners.
// Units split long samples (the time branch has B = 1) so every thread gets several. Scratch comes from
// MNN's pool in resize(), as MNN's own executions take theirs.

namespace MNN {
namespace plugin {
namespace {
using folia_dconv::kCols;
using folia_dconv::kOB;

// ------------------------------------------------------------------------------------------ helpers
int roundUp16(int v) { return (v + 15) & ~15; }

// erf as an odd rational x*P(x^2)/Q(x^2) on [-4, 4] (the form Eigen and XLA use for float): no exp,
// no table, no branch, so the loop over it vectorises.
inline float erfFast(float x) {
    x = std::min(4.0f, std::max(-4.0f, x));
    const float x2 = x * x;
    float p = -2.72614225801306e-10f;
    p = p * x2 + 2.77068142495902e-08f;
    p = p * x2 + -2.10102402082508e-06f;
    p = p * x2 + -5.69250639462346e-05f;
    p = p * x2 + -7.34990630326855e-04f;
    p = p * x2 + -2.95459980854025e-03f;
    p = p * x2 + -1.60960333262415e-02f;
    float q = -1.45660718464996e-05f;
    q = q * x2 + -2.13374055278905e-04f;
    q = q * x2 + -1.68282697438203e-03f;
    q = q * x2 + -7.37332916720468e-03f;
    q = q * x2 + -1.42647390514189e-02f;
    return x * p / q;
}

inline float gelu(float x) { return 0.5f * x * (1.0f + erfFast(x * 0.70710678118654752f)); }

// W[O, K] row-major -> blocks of 6 outputs, each K x 8 floats (lanes 6, 7 zero)
std::vector<float> packWeights(const std::vector<float>& W, int O, int K) {
    std::vector<float> p((size_t)(O / kOB) * K * 8, 0.0f);
    for (int o = 0; o < O; ++o)
        for (int k = 0; k < K; ++k) p[((size_t)(o / kOB) * K + k) * 8 + o % kOB] = W[(size_t)o * K + k];
    return p;
}

// W2[2C, K] -> blocks of (c, c+1, c+2, C+c, C+c+1, C+c+2): each block's 'a' and 'g' rows together
std::vector<float> packGlu(const std::vector<float>& W, int C, int K) {
    std::vector<float> p((size_t)(C / 3) * K * 8, 0.0f);
    for (int cb = 0; cb < C / 3; ++cb)
        for (int k = 0; k < K; ++k)
            for (int j = 0; j < 3; ++j) {
                p[((size_t)cb * K + k) * 8 + j] = W[(size_t)(cb * 3 + j) * K + k];
                p[((size_t)cb * K + k) * 8 + 3 + j] = W[(size_t)(C + cb * 3 + j) * K + k];
            }
    return p;
}

std::vector<float> loadParam(const Tensor* t) {
    const float* p = t->host<float>();
    return std::vector<float>(p, p + t->elementSize());
}

void parallelFor(Backend* bn, int n, const std::function<void(int)>& fn) {
    std::pair<std::function<void(int)>, int> task;
    task.first = fn;
    task.second = n;
    static_cast<CPUBackend*>(bn)->enqueue(task);
}

// ------------------------------------------------------------------------------------------ the op
class FoliaDConv : public CPUComputeKernel {
public:
    bool init(CPUKernelContext*) override { return true; }

    bool resize(CPUKernelContext* ctx) override {
        auto bn = ctx->backend();
        const Tensor* x = ctx->input(0);
        if (TensorUtils::getDescribe(x)->dimensionFormat == MNN_DATA_FORMAT_NC4HW4) {
            MNN_ERROR("FoliaDConv: packed (NC4HW4) input is not handled\n");
            return false;
        }
        if (CPUBackend::getBytes(bn, x) != 4) {
            MNN_ERROR("FoliaDConv: fp32 sessions only\n");
            return false;
        }
        B_ = x->length(0); C_ = x->length(1); L_ = x->elementSize() / (B_ * C_);
        H_ = ctx->input(1)->length(0);
        auto dil = ctx->getAttr("dilation");
        d_ = dil ? dil->i() : 1;
        if (H_ % kOB || C_ % 3 || ctx->input(5)->length(0) != 2 * C_ || ctx->input(1)->elementSize() != H_ * C_ * 3) {
            MNN_ERROR("FoliaDConv: unsupported shape C=%d H=%d\n", C_, H_);
            return false;
        }
        nt_ = static_cast<CPUBackend*>(bn)->threadNumber();
        // several units per thread; chunks a multiple of 16 columns
        const int parts = std::max(1, (4 * nt_ + B_ - 1) / B_);
        chunk_ = std::min(1024, std::max(16, roundUp16((L_ + parts - 1) / parts)));
        units_.clear();
        for (int b = 0; b < B_; ++b)
            for (int t0 = 0; t0 < L_; t0 += chunk_) units_.push_back({b, t0, std::min(L_, t0 + chunk_)});
        Lp_ = roundUp16(L_);
        ldx_ = chunk_ + 2 * d_;
        auto alloc = static_cast<CPUBackend*>(bn)->getBufferAllocator();
        hBuf_ = alloc->alloc((size_t)B_ * H_ * Lp_ * sizeof(float));
        hnBuf_ = alloc->alloc((size_t)B_ * H_ * Lp_ * sizeof(float));
        xpadBuf_ = alloc->alloc((size_t)nt_ * C_ * ldx_ * sizeof(float));
        for (auto* m : {&hBuf_, &hnBuf_, &xpadBuf_})
            if (m->invalid()) return false;
        for (auto* m : {&hBuf_, &hnBuf_, &xpadBuf_}) alloc->free(*m);
        rows1_.assign((size_t)nt_ * 3 * C_, nullptr);
        rows2_.assign((size_t)nt_ * H_, nullptr);
        aff_.assign((size_t)nt_ * 4 * C_, 0.0f);
        hs_.assign(units_.size(), 0.0);
        hq_.assign(units_.size(), 0.0);
        unitS_.assign(units_.size() * H_, 0.0);
        unitM_.assign(units_.size() * H_ * H_, 0.0);
        return true;
    }

    bool compute(CPUKernelContext* ctx) override {
        if (!packed_) pack(ctx);
        return run(ctx);
    }

private:
    struct Unit { int b, t0, t1; };

    void pack(CPUKernelContext* ctx) {
        const std::vector<float> W1 = loadParam(ctx->input(1)), W2 = loadParam(ctx->input(5));
        b1_ = loadParam(ctx->input(2)); g1_ = loadParam(ctx->input(3)); be1_ = loadParam(ctx->input(4));
        b2_ = loadParam(ctx->input(6)); g2_ = loadParam(ctx->input(7)); be2_ = loadParam(ctx->input(8));
        scale_ = loadParam(ctx->input(9));
        w1_ = packWeights(W1, H_, 3 * C_);
        w2_ = packGlu(W2, C_, H_);
        const int H = H_, C2 = 2 * C_;
        G_.assign(H * H, 0.0); wbar_.assign(H, 0.0); w2b_.assign(H, 0.0);
        beta_ = 0; b2sq_ = 0;
        for (int o = 0; o < C2; ++o) {
            const float* wr = W2.data() + (size_t)o * H;
            for (int i = 0; i < H; ++i) {
                wbar_[i] += wr[i];
                w2b_[i] += (double)wr[i] * b2_[o];
                for (int j = 0; j < H; ++j) G_[i * H + j] += (double)wr[i] * wr[j];
            }
            beta_ += b2_[o];
            b2sq_ += (double)b2_[o] * b2_[o];
        }
        packed_ = true;
    }

    void forUnits(Backend* bn, const std::function<void(int, const Unit&, int)>& body) {
        const int U = (int)units_.size();
        const int nt = std::max(1, std::min(nt_, U));
        parallelFor(bn, nt, [&](int t) {
            for (int u = (int)((long long)U * t / nt); u < (int)((long long)U * (t + 1) / nt); ++u) body(t, units_[u], u);
        });
    }

    static float rstdOf(double sum, double sq, double n, float eps, float& mean) {
        const double m = sum / n, var = std::max(0.0, sq / n - m * m);
        mean = (float)m;
        return (float)(1.0 / std::sqrt(var + eps));
    }

    bool run(CPUKernelContext* ctx) {
        auto bn = ctx->backend();
        const auto& k = folia_dconv::kernels();
        const float* x = ctx->input(0)->host<float>();
        float* y = ctx->output(0)->host<float>();
        const int B = B_, C = C_, L = L_, H = H_, d = d_, Lp = Lp_, ldx = ldx_;
        float* hAll = (float*)hBuf_.ptr();
        float* hnAll = (float*)hnBuf_.ptr();
        float* xpadAll = (float*)xpadBuf_.ptr();
        auto ea = ctx->getAttr("eps1"), eb = ctx->getAttr("eps2");
        const float eps1 = ea ? ea->f() : 1e-5f, eps2 = eb ? eb->f() : 1e-5f;

        // 1: h = conv3(x) + b1, and its moments
        forUnits(bn, [&](int t, const Unit& u, int ui) {
            const int len = u.t1 - u.t0, n16 = roundUp16(len);
            float* h = hAll + (size_t)u.b * H * Lp + u.t0;
            float* xpad = xpadAll + (size_t)t * C * ldx;
            const float** rows = rows1_.data() + (size_t)t * 3 * C;
            // xpad[c][i] = x[b][c][t0 - d + i], zero outside [0, L)
            const int lo = u.t0 - d, hi = u.t0 + n16 + d;
            const int a = std::max(lo, 0), e = std::min(hi, L);
            for (int c = 0; c < C; ++c) {
                float* xr = xpad + (size_t)c * ldx;
                const float* src = x + ((size_t)u.b * C + c) * L;
                for (int i = 0; i < a - lo; ++i) xr[i] = 0.0f;
                for (int i = a; i < e; ++i) xr[i - lo] = src[i];
                for (int i = e - lo; i < hi - lo; ++i) xr[i] = 0.0f;
                for (int j = 0; j < 3; ++j) rows[c * 3 + j] = xr + j * d;
            }
            for (int tb = 0; tb < n16; tb += kCols) k.convBlock(rows, 3 * C, w1_.data(), H, b1_.data(), tb, h + tb, Lp);
            double s = 0, q = 0;
            for (int o = 0; o < H; ++o) k.moments(h + (size_t)o * Lp, len, s, q);
            hs_[ui] = s;
            hq_[ui] = q;
        });
        std::vector<float> mh(B), rh(B), mz(B), rz(B);
        {
            std::vector<double> S(B, 0.0), Q(B, 0.0);
            for (size_t u = 0; u < units_.size(); ++u) { S[units_[u].b] += hs_[u]; Q[units_[u].b] += hq_[u]; }
            for (int b = 0; b < B; ++b) rh[b] = rstdOf(S[b], Q[b], (double)H * L, eps1, mh[b]);
        }

        // 2: hn = GELU(GN(h)), and its first and second moments
        forUnits(bn, [&](int, const Unit& u, int ui) {
            const int len = u.t1 - u.t0, n16 = roundUp16(len);
            float* hn = hnAll + (size_t)u.b * H * Lp + u.t0;
            const float* h = hAll + (size_t)u.b * H * Lp + u.t0;
            for (int j = 0; j < H; ++j) {
                const float a = rh[u.b] * g1_[j], o = be1_[j] - mh[u.b] * a;
                const float* hr = h + (size_t)j * Lp;
                float* q = hn + (size_t)j * Lp;
                for (int i = 0; i < len; ++i) q[i] = gelu(hr[i] * a + o);
                for (int i = len; i < n16; ++i) q[i] = 0.0f;
            }
            double* S = unitS_.data() + (size_t)ui * H;
            double* M = unitM_.data() + (size_t)ui * H * H;
            for (int i = 0; i < H; ++i) {
                const float* ri = hn + (size_t)i * Lp;
                double si = 0, unused = 0;
                k.moments(ri, len, si, unused);
                S[i] = si;
                for (int j = 0; j <= i; ++j) M[i * H + j] = M[j * H + i] = k.dot(ri, hn + (size_t)j * Lp, len);
            }
        });
        {
            std::vector<double> St(H), Mt(H * H);
            for (int b = 0, u = 0; b < B; ++b) {
                std::fill(St.begin(), St.end(), 0.0);
                std::fill(Mt.begin(), Mt.end(), 0.0);
                for (; u < (int)units_.size() && units_[u].b == b; ++u) {
                    for (int i = 0; i < H; ++i) St[i] += unitS_[(size_t)u * H + i];
                    for (int i = 0; i < H * H; ++i) Mt[i] += unitM_[(size_t)u * H * H + i];
                }
                double s1 = (double)L * beta_, s2 = (double)L * b2sq_;
                for (int i = 0; i < H; ++i) {
                    s1 += wbar_[i] * St[i];
                    s2 += 2.0 * w2b_[i] * St[i];
                    for (int j = 0; j < H; ++j) s2 += G_[i * H + j] * Mt[i * H + j];
                }
                rz[b] = rstdOf(s1, s2, 2.0 * C * L, eps2, mz[b]);
            }
        }

        // 3: z = W2 hn + b2 a block at a time, finished into y
        forUnits(bn, [&](int t, const Unit& u, int) {
            const int len = u.t1 - u.t0, n16 = roundUp16(len);
            const float** rows = rows2_.data() + (size_t)t * H;
            const float* hn = hnAll + (size_t)u.b * H * Lp + u.t0;
            for (int j = 0; j < H; ++j) rows[j] = hn + (size_t)j * Lp;
            float* aff = aff_.data() + (size_t)t * 4 * C;
            const float nlog2e = -1.44269504088896341f;
            for (int c = 0; c < C; ++c) {
                const float Aa = rz[u.b] * g2_[c], Ag = rz[u.b] * g2_[c + C];
                aff[c] = scale_[c] * Aa;
                aff[C + c] = scale_[c] * (b2_[c] * Aa + be2_[c] - mz[u.b] * Aa);
                aff[2 * C + c] = nlog2e * Ag;
                aff[3 * C + c] = nlog2e * (b2_[c + C] * Ag + be2_[c + C] - mz[u.b] * Ag);
            }
            const size_t off = (size_t)u.b * C * L + u.t0;
            for (int tb = 0; tb < n16; tb += kCols)
                k.gluBlock(rows, H, w2_.data(), C, aff, tb, std::min(kCols, len - tb), x + off, y + off, L);
        });
        return true;
    }

    int B_ = 0, C_ = 0, L_ = 0, H_ = 0, d_ = 1, nt_ = 1, chunk_ = 16, Lp_ = 16, ldx_ = 16;
    std::vector<Unit> units_;
    MemChunk hBuf_, hnBuf_, xpadBuf_;
    std::vector<const float*> rows1_, rows2_;
    std::vector<float> aff_;
    std::vector<double> hs_, hq_, unitS_, unitM_;
    bool packed_ = false;
    std::vector<float> w1_, w2_, b1_, g1_, be1_, b2_, g2_, be2_, scale_;
    // z's moments from hn's: sum z = wbar.S + L*beta, sum z^2 = <G, M> + 2 (W2^T b2).S + L*|b2|^2
    std::vector<double> G_, wbar_, w2b_;
    double beta_ = 0, b2sq_ = 0;
};

class ShapeLikeX : public InferShapeKernel {
public:
    bool compute(InferShapeContext* ctx) override {
        const Tensor* in = ctx->input(0);
        Tensor* out = ctx->output(0);
        out->buffer().dimensions = in->dimensions();
        for (int i = 0; i < in->dimensions(); ++i) out->setLength(i, in->length(i));
        out->buffer().type = in->getType();
        TensorUtils::getDescribe(out)->dimensionFormat = TensorUtils::getDescribe(in)->dimensionFormat;
        return true;
    }
};

} // namespace

REGISTER_PLUGIN_OP(FoliaDConv, ShapeLikeX);
REGISTER_PLUGIN_COMPUTE_KERNEL(FoliaDConv, FoliaDConv);

} // namespace plugin
} // namespace MNN

/** Which kernel set this CPU runs FoliaDConv with; folia_mnn.cpp reports it with the version. */
const char* folia_dconv_isa() { return folia_dconv::kernels().name; }
