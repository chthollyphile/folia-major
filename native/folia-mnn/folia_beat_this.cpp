#include <MNN/expr/ExecutorScope.hpp>
#include <MNN/expr/ExprCreator.hpp>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include <vector>
#include "folia_mnn.h"

// native/folia-mnn/folia_beat_this.cpp
// Beat This! on the CPU, built from the same weights file the WebGPU runtime reads.
//
// There is no .mnn for this model. The renderer runs beat_this on WebGPU from beat_this-wgsl.bin
// (build/beat_this_wgsl/export_weights.py); this is the CPU fallback, for automix only, and shipping it
// a second copy of the weights in another format would make every listener download the model twice.
// So the network is written out here as MNN expressions - the same steps as reference.py, in the
// layout export_weights.py stores - over tensors worker.cjs reads from that file and hands in one at a
// time. The graph is then saved and loaded back as an ordinary model with a mutable input shape, so it
// takes any chunk of 1..1500 frames, and from there it is a FoliaMnn like any loaded file.
//
// What export_weights.py already did to the weights, and this therefore does not redo: BatchNorms
// folded into the convolutions (stored [kf, 3, cin, cout]) and the stem's scale/shift; every RMSNorm
// gamma, times sqrt(dim), folded into the rows of the matmul after it, so a norm here is only the
// division by ||x||; each attention's gate projection appended to its QKV as H extra columns; the
// frontend linear's rows permuted for an (f c) flatten; matmul weights transposed to [in, out], their
// rows padded to a multiple of 4 and, in the fp16 export, stored as fp16. All of it is computed in fp32.

using namespace MNN;
using namespace MNN::Express;

struct FoliaBtWeights {
    struct Tensor {
        std::vector<float> data;
        std::vector<int> shape;
    };
    std::map<std::string, Tensor> tensors;
};

namespace {

constexpr int kHeadDim = 32;
constexpr int kMaxFrames = 1500;
constexpr int kMel = 128;

float halfToFloat(uint16_t h) {
    const uint32_t sign = uint32_t(h >> 15) << 31;
    uint32_t exp = (h >> 10) & 0x1f, mant = h & 0x3ff, bits;
    if (exp == 0) {
        if (mant == 0) {
            bits = sign;
        } else {  // subnormal: normalise
            int e = -1;
            do { ++e; mant <<= 1; } while (!(mant & 0x400));
            bits = sign | uint32_t(127 - 15 - e) << 23 | (mant & 0x3ff) << 13;
        }
    } else if (exp == 31) {
        bits = sign | 0x7f800000u | mant << 13;
    } else {
        bits = sign | (exp + 127 - 15) << 23 | mant << 13;
    }
    float f;
    memcpy(&f, &bits, 4);
    return f;
}

struct Builder {
    const FoliaBtWeights& w;
    std::string missing;

    const FoliaBtWeights::Tensor* get(const std::string& name) {
        auto it = w.tensors.find(name);
        if (it == w.tensors.end()) {
            if (missing.empty()) missing = name;
            return nullptr;
        }
        return &it->second;
    }
    VARP constant(const std::string& name) {
        const auto* t = get(name);
        if (!t) return _Const(0.0f);
        return _Const(t->data.data(), t->shape, NCHW, halide_type_of<float>());
    }
    int dim(const std::string& name, int axis) {
        const auto* t = get(name);
        return t && axis < int(t->shape.size()) ? t->shape[axis] : 1;
    }
    VARP ints(std::vector<int> v) { return _Const(v.data(), {int(v.size())}, NCHW, halide_type_of<int>()); }

    // x [rows, K] -> x @ W + b
    VARP linear(VARP x, const std::string& w, const std::string& b) {
        VARP y = _MatMul(x, constant(w));
        return b.empty() ? y : y + constant(b);
    }
    // the RMSNorm whose gamma export_weights.py folded into W: (x @ W) / max(||x||, 1e-12) + b
    VARP normLinear(VARP x, const std::string& w, const std::string& b) {
        VARP norm = _Maximum(_Sqrt(_ReduceSum(_Square(x), {-1}, true)), _Const(1e-12f));
        VARP y = _MatMul(x, constant(w)) / norm;
        return b.empty() ? y : y + constant(b);
    }
    static VARP gelu(VARP x) { return _Const(0.5f) * x * (_Const(1.0f) + _Erf(x * _Const(0.70710678118654752f))); }

    /**
     * Interleaved rotary embedding over axis 2 of x [B, H, n, 32]: pairs (2i, 2i+1) turn by n*freq[i].
     * The angle table is computed here for the longest sequence and sliced to n, which is the chunk's
     * frame count for the attentions over time and a fixed frequency count for the others.
     */
    VARP cosTable, sinTable;
    void ropeTables() {
        const auto* freqs = get("rope.freqs");
        if (!freqs) return;
        const int half = int(freqs->data.size());
        std::vector<float> c(size_t(kMaxFrames) * half), s(c.size());
        for (int p = 0; p < kMaxFrames; ++p)
            for (int i = 0; i < half; ++i) {
                const double a = double(p) * double(freqs->data[i]);
                c[size_t(p) * half + i] = float(std::cos(a));
                s[size_t(p) * half + i] = float(std::sin(a));
            }
        cosTable = _Const(c.data(), {kMaxFrames, half, 1}, NCHW, halide_type_of<float>());
        sinTable = _Const(s.data(), {kMaxFrames, half, 1}, NCHW, halide_type_of<float>());
    }
    VARP rope(VARP x, VARP n) {
        // rows [0, n) of the tables: [n, 16, 1], broadcast over [B, H, n, 16, 2] halves
        VARP sizes = _Concat({n, ints({-1, -1})}, 0);
        VARP c = _Slice(cosTable, ints({0, 0, 0}), sizes);
        VARP s = _Slice(sinTable, ints({0, 0, 0}), sizes);
        VARP pairs = _Reshape(x, {0, 0, -1, kHeadDim / 2, 2});
        auto halves = _Split(pairs, {1, 1}, 4);
        VARP x0 = halves[0], x1 = halves[1];
        return _Reshape(_Concat({x0 * c - x1 * s, x1 * c + x0 * s}, 4), {0, 0, -1, kHeadDim});
    }

    /** x [B, n, D] -> x + attention(x). B or n may be the chunk's frame count; the other is fixed. */
    VARP attention(VARP x, int B, int n, int D, const std::string& p) {
        const int H = D / kHeadDim;
        VARP rows = _Reshape(x, {-1, D});
        VARP qkvg = normLinear(rows, p + ".qkvg.w", p + ".qkvg.b");  // [B*n, 3D + H]
        auto parts = _Split(qkvg, {D, D, D, H}, 1);
        auto heads = [&](VARP t) { return _Transpose(_Reshape(t, {B, n, H, kHeadDim}), {0, 2, 1, 3}); };  // [B, H, n, 32]
        VARP q = heads(parts[0]), k = heads(parts[1]), v = heads(parts[2]);
        VARP len = _Slice(_Shape(q, true), ints({2}), ints({1}));
        q = rope(q, len);
        k = rope(k, len);
        VARP scores = _MatMul(q, k, false, true) * _Const(1.0f / std::sqrt(float(kHeadDim)));
        VARP out = _MatMul(_Softmax(scores, -1), v);                                    // [B, H, n, 32]
        VARP gates = _Transpose(_Reshape(_Sigmoid(parts[3]), {B, n, H, 1}), {0, 2, 1, 3});  // [B, H, n, 1]
        out = _Reshape(_Transpose(out * gates, {0, 2, 1, 3}), {-1, D});                // [B*n, D]
        return _Reshape(rows + linear(out, p + ".out.w", ""), {B, n, D});
    }

    /** x [B, n, D] -> x + feedForward(x) */
    VARP feedForward(VARP x, int B, int n, int D, const std::string& p) {
        VARP rows = _Reshape(x, {-1, D});
        VARP h = gelu(normLinear(rows, p + ".w1", p + ".b1"));
        return _Reshape(rows + linear(h, p + ".w2", p + ".b2"), {B, n, D});
    }

    /** Conv2d with its BatchNorm folded, then GELU: x [1, cin, f, t] -> [1, cout, (f - kf)/stride + 1, t]. */
    VARP convBnGelu(VARP x, const std::string& p, int stride) {
        const auto* wt = get(p + ".w");  // [kf, 3, cin, cout]
        const auto* bt = get(p + ".b");
        if (!wt || !bt) return x;
        const int kf = wt->shape[0], kt = wt->shape[1], cin = wt->shape[2], cout = wt->shape[3];
        std::vector<float> weight(wt->data.size());  // -> [cout, cin, kf, kt]
        for (int a = 0; a < kf; ++a)
            for (int b = 0; b < kt; ++b)
                for (int i = 0; i < cin; ++i)
                    for (int o = 0; o < cout; ++o)
                        weight[((size_t(o) * cin + i) * kf + a) * kt + b] = wt->data[((size_t(a) * kt + b) * cin + i) * cout + o];
        std::vector<float> bias = bt->data;
        // MNN's X is the width (time), Y the height (frequency): kernel {kt, kf}, stride {1, s}, pads {1, 0}.
        VARP y = _Conv(std::move(weight), std::move(bias), x, {cin, cout}, {kt, kf}, CAFFE, {1, stride}, {1, 1}, 1, {1, 0});
        return gelu(y);
    }

    /** mel [T, 128] -> { beat [T], downbeat [T] } */
    std::vector<VARP> forward(VARP mel) {
        ropeTables();
        // stem: the BatchNorm1d over mel bins, then conv + BN + GELU with stride 4 over frequency
        VARP x = _Transpose(mel, {1, 0});                                                // [128, T]
        x = x * _Reshape(constant("stem.bn.scale"), {kMel, 1}) + _Reshape(constant("stem.bn.shift"), {kMel, 1});
        x = _Convert(_Reshape(x, {1, 1, kMel, -1}), NC4HW4);
        x = _Convert(convBnGelu(x, "stem.conv", 4), NCHW);                               // [1, c, f, T]
        int c = dim("stem.conv.w", 3), f = (kMel - dim("stem.conv.w", 0)) / 4 + 1;
        for (int i = 0; i < 3; ++i) {
            const std::string p = "block" + std::to_string(i);
            VARP y = _Reshape(_Transpose(x, {0, 3, 2, 1}), {-1, f, c});                    // [T, f, c]: across frequency
            y = attention(y, -1, f, c, p + ".freq.attn");
            y = feedForward(y, -1, f, c, p + ".freq.ff");
            y = _Transpose(y, {1, 0, 2});                                                // [f, T, c]: across time
            y = attention(y, f, -1, c, p + ".time.attn");
            y = feedForward(y, f, -1, c, p + ".time.ff");
            x = _Unsqueeze(_Transpose(y, {2, 0, 1}), {0});                              // [1, c, f, T]
            x = _Convert(convBnGelu(_Convert(x, NC4HW4), p + ".conv", 2), NCHW);
            f = (f - dim(p + ".conv.w", 0)) / 2 + 1;
            c = dim(p + ".conv.w", 3);
        }
        // flatten as (f c) - export_weights.py permuted the linear's rows to match
        VARP rows = _Reshape(_Transpose(x, {0, 3, 2, 1}), {-1, f * c});                  // [T, f*c]
        rows = linear(rows, "frontend.linear.w", "frontend.linear.b");
        const int D = dim("frontend.linear.w", 1);
        VARP h = _Reshape(rows, {1, -1, D});
        for (int i = 0;; ++i) {
            const std::string p = "layer" + std::to_string(i);
            if (!w.tensors.count(p + ".attn.qkvg.w")) break;
            h = attention(h, 1, -1, D, p + ".attn");
            h = feedForward(h, 1, -1, D, p + ".ff");
        }
        VARP logits = normLinear(_Reshape(h, {-1, D}), "head.w", "head.b");             // [T, 2]
        auto cols = _Split(logits, {1, 1}, 1);
        VARP beat = _Reshape(cols[0] + cols[1], {-1});
        VARP down = _Reshape(cols[1], {-1});
        beat->setName("beat");
        down->setName("downbeat");
        return {beat, down};
    }
};

void say(char* err, int errLen, const std::string& text) {
    if (!err || errLen <= 0) return;
    const size_t n = std::min(text.size(), size_t(errLen - 1));
    memcpy(err, text.data(), n);
    err[n] = '\0';
}

}  // namespace

FOLIA_EXPORT FoliaBtWeights* folia_bt_weights_create() { return new FoliaBtWeights(); }

FOLIA_EXPORT void folia_bt_weights_free(FoliaBtWeights* weights) { delete weights; }

/**
 * One tensor of beat_this-wgsl.bin, as its manifest entry describes it: `data` at the entry's byte
 * offset, `f16` for dtype f16, `shape` its logical shape, and `stride` the padded row length of a
 * matmul weight (0 for the rest) - the padding is dropped here. Answers 0, or -1 on a bad shape.
 */
FOLIA_EXPORT int folia_bt_weights_put(FoliaBtWeights* weights, const char* name, const void* data, int f16, const int* shape, int rank, int stride) {
    if (rank <= 0 || rank > 4) return -1;
    FoliaBtWeights::Tensor t;
    t.shape.assign(shape, shape + rank);
    size_t count = 1;
    for (int d : t.shape) {
        if (d <= 0) return -1;
        count *= size_t(d);
    }
    const int cols = t.shape.back();
    const int pitch = stride > 0 ? stride : cols;
    if (pitch < cols) return -1;
    const size_t rows = count / size_t(cols);
    t.data.resize(count);
    for (size_t r = 0; r < rows; ++r)
        for (int j = 0; j < cols; ++j) {
            const size_t from = r * size_t(pitch) + size_t(j);
            float v;
            if (f16) {
                uint16_t h;
                memcpy(&h, static_cast<const uint8_t*>(data) + from * 2, 2);
                v = halfToFloat(h);
            } else {
                memcpy(&v, static_cast<const uint8_t*>(data) + from * 4, 4);
            }
            t.data[r * size_t(cols) + size_t(j)] = v;
        }
    weights->tensors[name] = std::move(t);
    return 0;
}

/**
 * The network over the weights put so far, as a model handle: one input [frames, 128] for any 1..1500
 * frames, two outputs, beat and downbeat logits [frames]. fp32 throughout. Null with `err` set when a
 * tensor the network needs was never put. The weights can be freed once this returns.
 */
FOLIA_EXPORT FoliaMnn* folia_bt_build(FoliaBtWeights* weights, int threads, char* err, int errLen) {
    try {
        std::string why;
        std::unique_ptr<FoliaMnn> handle(foliaNewHandle(threads, 1, why));
        if (!handle) {
            say(err, errLen, why);
            return nullptr;
        }
        ExecutorScope scope(handle->executor);
        std::vector<int8_t> graph;
        {
            Builder builder{*weights, {}};
            VARP mel = _Input({kMaxFrames, kMel}, NCHW, halide_type_of<float>());
            mel->setName("mel");
            auto outputs = builder.forward(mel);
            if (!builder.missing.empty()) {
                say(err, errLen, "beat_this weights have no " + builder.missing);
                return nullptr;
            }
            graph = Variable::save(outputs);
        }
        Module::Config config;
        config.shapeMutable = true;
        handle->net.reset(Module::load({"mel"}, {"beat", "downbeat"}, reinterpret_cast<const uint8_t*>(graph.data()), graph.size(),
                                       handle->runtime, &config));
        if (!handle->net) {
            say(err, errLen, "the beat_this graph did not load");
            return nullptr;
        }
        handle->inputs.resize(1);
        return handle.release();
    } catch (const std::exception& e) {
        say(err, errLen, e.what());
        return nullptr;
    }
}
