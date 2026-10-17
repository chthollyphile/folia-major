#include <MNN/expr/ExecutorScope.hpp>
#include <MNN/expr/ExprCreator.hpp>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>
#if defined(_WIN32)
#include <windows.h>  // NOMINMAX comes from CMakeLists.txt
#endif
#include "MNN_generated.h"
#include "core/FileLoader.hpp"
#include "folia_mnn.h"

// native/folia-mnn/folia_htdemucs.cpp
// htdemucs on the CPU, built from the same weights file the WebGPU runtime reads - as
// folia_beat_this.cpp does for Beat This!.
//
// The app ships one copy of each model, htdemucs-wgsl.bin (build/htdemucs_wgsl/export_weights.py), and
// both runtimes read it: the renderer's WebGPU path (src/services/analysis/htdemucsWgsl) for
// 智能动感模式's drum stem, and this, automix's separation in the analysis worker. The network is
// written out here as MNN expressions over tensors worker.cjs reads from that file and hands in one at
// a time - step for step the graph of htdemucsWgsl/runtime.ts, which is the published htdemucs.onnx's -
// then saved and loaded back as an ordinary fixed-shape model: one input `mix` [1, 2, 172032], one
// output `stems` [1, 4, 2, 172032] in the graph's source order, what electron/analysis/htdemucs.cjs
// segments and overlap-adds.
//
// It replaced htdemucs-v3.mnn, a 190MB conversion of the same ONNX graph (build/htdemucs_mnn/
// make_model.py, removed), which the listener had to download on top of the 92MB the beat FX needed.
// The export holds the graph's own weights - fp16 where the graph stores fp16 - so this runs exactly
// the published values, all of it computed in fp32.
//
// What export_weights.py already did, and this therefore does not redo: every weight is the [rows =
// output channel, K] matrix of an implicit GEMM (convolutions in ONNX's own [cout, cin, kh, kw] order,
// Linear weights transposed to [out, in]); each ConvTranspose (kernel 8, stride 4) split into four
// phase matrices, rows (co, phase) and columns (ci, tap t), output 4q + phase reading input q - t; the
// attention's 1/8 on q folded into its in-projection; the frequency embedding, both positional
// embeddings (the frequency one in (f t) token order), the STFT and iSTFT windows and the iSTFT's
// window-sum normaliser exported as the graph bakes them.
//
// Shapes. Activations are NCHW [1, C, H, W] - the frequency branch [C, F, T], the time branch
// [C, 1, L] - and channel-major through the transformer as well ([512, 1, tokens]), so every
// convolution, Linear and 1x1 is MNN's convolution, which is its fast path; only the attention's two
// batched products are MatMuls. Each DConv layer is one Folia::FoliaDConv (folia_dconv.cpp), the
// operator the converted model ran them on. The STFT and iSTFT are two-stage 64 x 64 DFTs as matrix
// products, and the global means are taken in levels of 64, which a one-level mean over a million
// floats is not accurate enough for.

using namespace MNN;
using namespace MNN::Express;

namespace {

constexpr int kSegment = 172032;
constexpr int kFrames = 168;
constexpr int kBins = 2048;
constexpr int kFft = 4096;
constexpr int kHop = 1024;
constexpr int kDim = 512;
constexpr int kHeads = 8;
constexpr int kHeadDim = kDim / kHeads;
constexpr int kSources = 4;
constexpr double kPi = 3.14159265358979323846;

struct Builder {
    FoliaBtWeights& w;
    std::string missing;

    /** The tensor's values, moved out of the set (each weight is read once), checked for `count`. */
    std::vector<float> take(const std::string& name, size_t count) {
        auto it = w.tensors.find(name);
        if (it == w.tensors.end()) {
            if (missing.empty()) missing = "htdemucs weights have no " + name;
            return std::vector<float>(count, 0.0f);
        }
        std::vector<float> data = std::move(it->second.data);
        w.tensors.erase(it);
        if (data.size() != count) {
            if (missing.empty()) missing = "htdemucs tensor " + name + " has " + std::to_string(data.size()) + " values, not " + std::to_string(count);
            data.assign(count, 0.0f);
        }
        return data;
    }
    /** Rows of the [rows, K] tensor `name`, or 0 when it is not there. */
    int rows(const std::string& name) {
        auto it = w.tensors.find(name);
        return it == w.tensors.end() || it->second.shape.empty() ? 0 : it->second.shape[0];
    }

    static VARP floats(const std::vector<float>& v, INTS shape) { return _Const(v.data(), shape, NCHW, halide_type_of<float>()); }
    static VARP ints(std::vector<int> v) { return _Const(v.data(), {int(v.size())}, NCHW, halide_type_of<int>()); }
    VARP param(const std::string& name, INTS shape) {
        size_t count = 1;
        for (int d : shape) count *= size_t(d);
        return floats(take(name, count), shape);
    }

    static VARP gelu(VARP x) { return _Const(0.5f) * x * (_Const(1.0f) + _Erf(x * _Const(0.70710678118654752f))); }
    /** The channel halves of [1, 2c, h, w]: a * sigmoid(gate). */
    static VARP glu(VARP x, int c) {
        auto halves = _Split(x, {c, c}, 1);
        return halves[0] * _Sigmoid(halves[1]);
    }

    /**
     * Conv2d `name` (weights [cout, cin * kh * kw], bias [cout]) over NCHW [1, cin, h, w]: stride, padding
     * and dilation per axis as {height, width}. MNN's X is the width and Y the height.
     */
    VARP conv(VARP x, const std::string& name, int cin, int kh, int kw, INTS stride = {1, 1}, INTS pad = {0, 0},
              INTS dilate = {1, 1}, bool withGelu = false) {
        const int cout = rows(name + ".w");
        std::vector<float> weight = take(name + ".w", size_t(cout) * cin * kh * kw);
        std::vector<float> bias = take(name + ".b", size_t(cout));
        VARP y = _Conv(std::move(weight), std::move(bias), _Convert(x, NC4HW4), {cin, cout}, {kw, kh}, CAFFE,
                       {stride[1], stride[0]}, {dilate[1], dilate[0]}, 1, {pad[1], pad[0]});
        y = _Convert(y, NCHW);
        return withGelu ? gelu(y) : y;
    }
    /** A Linear over channel-major tokens [1, in, 1, n]. */
    VARP linear(VARP x, const std::string& name, int in) { return conv(x, name, in, 1, 1); }

    /**
     * ConvTranspose `name` (kernel 8, stride 4) along H (`alongH`) or W of [1, cin, h, w], cropped by 2 at
     * either end as the graph does: [1, cout, 4h, w] or [1, cout, h, 4w]. As a stride-1 convolution of
     * kernel 2 over the input padded by one on that axis - output q's taps are x[q - 1] (t = 1) and
     * x[q] (t = 0) - whose 4 cout rows (co, phase) are then interleaved: output 4q + phase.
     */
    VARP convTranspose(VARP x, const std::string& name, int cin, int h, int w, bool alongH, bool withGelu) {
        const int rows4 = rows(name + ".w");
        const int cout = rows4 / 4;
        const std::vector<float> phases = take(name + ".w", size_t(rows4) * cin * 2);
        const std::vector<float> b = take(name + ".b", size_t(cout));
        std::vector<float> weight(phases.size());
        for (int r = 0; r < rows4; ++r)
            for (int ci = 0; ci < cin; ++ci) {
                weight[(size_t(r) * cin + ci) * 2 + 0] = phases[size_t(r) * cin * 2 + ci * 2 + 1];
                weight[(size_t(r) * cin + ci) * 2 + 1] = phases[size_t(r) * cin * 2 + ci * 2 + 0];
            }
        std::vector<float> bias(static_cast<size_t>(rows4));
        for (int r = 0; r < rows4; ++r) bias[r] = b[r / 4];
        const int kh = alongH ? 2 : 1, kw = alongH ? 1 : 2;
        VARP y = _Conv(std::move(weight), std::move(bias), _Convert(x, NC4HW4), {cin, rows4}, {kw, kh}, CAFFE, {1, 1}, {1, 1}, 1,
                       {alongH ? 0 : 1, alongH ? 1 : 0});
        y = _Convert(y, NCHW);
        VARP out;
        if (alongH) {
            y = _Transpose(_Reshape(y, {cout, 4, h + 1, w}), {0, 2, 1, 3});                 // [cout, h+1, 4, w]
            y = _Reshape(y, {1, cout, 4 * (h + 1), w});
            out = _Slice(y, ints({0, 0, 2, 0}), ints({1, cout, 4 * h, w}));
        } else {
            y = _Transpose(_Reshape(y, {cout, 4, h, w + 1}), {0, 2, 3, 1});                 // [cout, h, w+1, 4]
            y = _Reshape(y, {1, cout, h, 4 * (w + 1)});
            out = _Slice(y, ints({0, 0, 0, 2}), ints({1, cout, h, 4 * w}));
        }
        return withGelu ? gelu(out) : out;
    }

    /** One FoliaDConv over x [B, c, L]: one DConv layer, its GroupNorms per sample. */
    VARP dconvLayer(VARP x, const std::string& p, int c, int dilation) {
        const int hid = rows(p + ".c1.w");
        std::vector<VARP> in = {
            x,
            param(p + ".c1.w", {hid, c, 3}), param(p + ".c1.b", {hid}), param(p + ".n1.g", {hid}), param(p + ".n1.b", {hid}),
            param(p + ".c2.w", {2 * c, hid, 1}), param(p + ".c2.b", {2 * c}), param(p + ".n2.g", {2 * c}), param(p + ".n2.b", {2 * c}),
            param(p + ".ls", {c}),
        };
        std::unique_ptr<OpT> op(new OpT);
        op->type = OpType_Plugin;
        op->name = p;
        op->main.type = OpParameter_Plugin;
        auto* plugin = new PluginT;
        plugin->type = "FoliaDConv";
        auto attr = [&](const char* key, int i, float f, bool isInt) {
            std::unique_ptr<AttributeT> a(new AttributeT);
            a->key = key;
            if (isInt) a->i = i; else a->f = f;
            plugin->attr.emplace_back(std::move(a));
        };
        attr("dilation", dilation, 0.0f, true);
        attr("eps1", 0, 1e-5f, false);
        attr("eps2", 0, 1e-5f, false);
        op->main.value = plugin;
        return Variable::create(Expr::create(std::move(op), in));
    }
    /** DConv's two layers (dilation 1, then 2) over [1, c, h, w]; per frequency row (`perH`) or whole. */
    VARP dconv(VARP x, const std::string& prefix, int c, int h, int w, bool perH) {
        VARP y = perH ? _Transpose(_Reshape(x, {c, h, w}), {1, 0, 2}) : _Reshape(x, {1, c, h * w});   // [B, c, L]
        for (int j = 0; j < 2; ++j) y = dconvLayer(y, prefix + ".dc" + std::to_string(j), c, 1 << j);
        return perH ? _Reshape(_Transpose(y, {1, 0, 2}), {1, c, h, w}) : _Reshape(y, {1, c, h, w});
    }

    /** The mean of all n = groups * 4096 values of x, in three levels of at most 64: a scalar. */
    static VARP meanAll(VARP x, int groups) {
        VARP m = _ReduceMean(_Reshape(x, {groups, 64, 64}), {2});
        return _ReduceMean(_ReduceMean(m, {1}), {0});
    }
    /** {mean, unbiased std} of all n = groups * 4096 values, as the graph normalises its inputs. */
    static std::pair<VARP, VARP> moments(VARP x, int groups) {
        const double n = double(groups) * 4096.0;
        VARP mean = meanAll(x, groups);
        VARP d = x - mean;
        VARP sd = _Sqrt(meanAll(d * d, groups) * _Const(float(n / (n - 1.0))));
        return {mean, sd};
    }

    /** LayerNorm over the channels of each token, [1, 512, 1, n], with `name`.g/.b. */
    VARP layerNorm(VARP x, const std::string& name) {
        VARP mean = _ReduceMean(x, {1}, true);
        VARP d = x - mean;
        VARP rstd = _Rsqrt(_ReduceMean(d * d, {1}, true) + _Const(1e-5f));
        return d * rstd * param(name + ".g", {1, kDim, 1, 1}) + param(name + ".b", {1, kDim, 1, 1});
    }
    /** GroupNorm with one group over all of [1, 512, 1, n]: the transformer layer's norm_out. */
    VARP groupNormAll(VARP x, const std::string& name) {
        VARP mean = _ReduceMean(_ReduceMean(x, {3}, true), {1}, true);
        VARP d = x - mean;
        VARP var = _ReduceMean(_ReduceMean(d * d, {3}, true), {1}, true);
        return d * _Rsqrt(var + _Const(1e-5f)) * param(name + ".g", {1, kDim, 1, 1}) + param(name + ".b", {1, kDim, 1, 1});
    }
    /** Eight heads of q [512, n] over k, v [512, m] (q pre-scaled): [1, 512, 1, n]. */
    static VARP attend(VARP q, VARP k, VARP v, int n, int m) {
        VARP qh = _Transpose(_Reshape(q, {kHeads, kHeadDim, n}), {0, 2, 1});              // [8, n, 64]
        VARP scores = _MatMul(qh, _Reshape(k, {kHeads, kHeadDim, m}));                    // [8, n, m]
        VARP out = _MatMul(_Softmax(scores, -1), _Reshape(v, {kHeads, kHeadDim, m}), false, true);  // [8, n, 64]
        return _Reshape(_Transpose(out, {0, 2, 1}), {1, kDim, 1, n});
    }
    /** x + g1 * out-projection of the attention, then the feed-forward half and norm_out of layer p. */
    VARP finish(VARP x, VARP att, const std::string& p) {
        x = x + param(p + ".g1", {1, kDim, 1, 1}) * linear(att, p + ".out", kDim);
        VARP h = conv(layerNorm(x, p + ".nf"), p + ".ff1", kDim, 1, 1, {1, 1}, {0, 0}, {1, 1}, true);
        x = x + param(p + ".g2", {1, kDim, 1, 1}) * linear(h, p + ".ff2", 4 * kDim);
        return groupNormAll(x, p + ".no");
    }

    /** The DFT stages' twiddles as [1, 64, 1, 64] tables: cos and sin of 2 pi a b / 4096 (symmetric in a, b). */
    static std::pair<VARP, VARP> twiddles() {
        std::vector<float> c(64 * 64), s(64 * 64);
        for (int a = 0; a < 64; ++a)
            for (int b = 0; b < 64; ++b) {
                const double t = 2.0 * kPi * double(a * b) / kFft;
                c[a * 64 + b] = float(std::cos(t));
                s[a * 64 + b] = float(std::sin(t));
            }
        return {floats(c, {1, 64, 1, 64}), floats(s, {1, 64, 1, 64})};
    }

    /**
     * The graph's STFT of the mix [2, L]: frames f + 2 of a 4096-point, hop-1024 STFT of the mix
     * reflect-padded by 1536 and then by 2048 (the sample index folds both pads back into the mix),
     * windowed by stft.window (which carries the 1/64 normalisation), bins 0..2047. Returned as the
     * complex-as-channels spectrogram [1, 4, 2048, 168], channel = ch * 2 + (re, im).
     */
    VARP stft(VARP mix) {
        auto reflect = [](int i, int n) {
            int j = i < 0 ? -i : i;
            return j >= n ? 2 * (n - 1) - j : j;
        };
        std::vector<int> index(size_t(kFrames) * kFft);
        for (int f = 0; f < kFrames; ++f)
            for (int n = 0; n < kFft; ++n)
                index[size_t(f) * kFft + n] = reflect(reflect((f + 2) * kHop + n - 2048, kSegment + 3072) - 1536, kSegment);
        const int S = 2 * kFrames;
        VARP x = _GatherV2(mix, _Const(index.data(), {int(index.size())}, NCHW, halide_type_of<int>()), _Scalar<int>(1));  // [2, 168*4096]
        x = _Reshape(x, {S, kFft}) * param("stft.window", {1, kFft});

        // n = 64 n1 + n2, k = k1 + 64 k2. Stage 1 over n1: [S*n2, n1] . [n1, (re, im) k1].
        std::vector<float> m1(64 * 128), m3(128 * 64);
        for (int a = 0; a < 64; ++a)
            for (int b = 0; b < 64; ++b) {
                const double t = 2.0 * kPi * double(a * b) / 64.0;
                m1[a * 128 + b] = float(std::cos(t));                 // row n1 = a, column re k1 = b
                m1[a * 128 + 64 + b] = float(-std::sin(t));           // im
            }
        // Stage 2 over n2: rows (re n2 | im n2), columns (re k2 | im k2) for k2 < 32: X = sum (a + ib) e^(-i theta).
        for (int n2 = 0; n2 < 64; ++n2)
            for (int k2 = 0; k2 < 32; ++k2) {
                const double t = 2.0 * kPi * double(n2 * k2) / 64.0;
                const float c = float(std::cos(t)), s = float(std::sin(t));
                m3[n2 * 64 + k2] = c;              // a -> re
                m3[n2 * 64 + 32 + k2] = -s;        // a -> im
                m3[(64 + n2) * 64 + k2] = s;       // b -> re
                m3[(64 + n2) * 64 + 32 + k2] = c;  // b -> im
            }
        VARP a = _Reshape(_Transpose(_Reshape(x, {S, 64, 64}), {0, 2, 1}), {S * 64, 64});  // [S n2, n1]
        a = _Reshape(_MatMul(a, floats(m1, {64, 128})), {S, 64, 2, 64});                  // [S, n2, (re, im), k1]
        auto parts = _Split(a, {1, 1}, 2);
        auto tw = twiddles();                                                            // [1, n2, 1, k1]
        // times e^(-2 pi i k1 n2 / 4096)
        VARP re = parts[0] * tw.first + parts[1] * tw.second;
        VARP im = parts[1] * tw.first - parts[0] * tw.second;
        VARP b = _Reshape(_Transpose(_Concat({re, im}, 2), {0, 3, 2, 1}), {S * 64, 128});   // [S k1, (re, im) n2]
        VARP spec = _Reshape(_MatMul(b, floats(m3, {128, 64})), {2, kFrames, 64, 2, 32});   // [ch, f, k1, (re, im), k2]
        return _Reshape(_Transpose(spec, {0, 3, 4, 2, 1}), {1, 4, kBins, kFrames});          // [ch (re, im), k2 k1, f]
    }

    /**
     * Every source's iSTFT: z [1, 16, 2048, 168] (source * 4 + ch * 2 + (re, im)), already scaled back by
     * the spectrogram's std and mean, to [8, L] (source * 2 + ch). The onesided spectrum with bin 2048
     * zero, as the Hermitian full one: x[n] = (1/4096) Re sum c_k X_k e^(2 pi i k n / 4096), c_k 1 for
     * k = 0 and 2 above; times istft.window, overlap-added at hop 1024 and divided by istft.env.
     */
    VARP istft(VARP z) {
        const int S = kSources * 2 * kFrames;
        std::vector<float> coef(32 * 64, 2.0f);
        coef[0] = 1.0f;
        z = _Reshape(z, {kSources, 2, 2, 32, 64, kFrames}) * floats(coef, {1, 1, 1, 32, 64, 1});   // [s, ch, (re, im), k2, k1, f]
        // Stage 1 over k2: rows (a k2 | b k2), columns (re n2 | im n2): (a + ib) e^(+i theta).
        std::vector<float> m1(64 * 128), m2(128 * 64);
        for (int k2 = 0; k2 < 32; ++k2)
            for (int n2 = 0; n2 < 64; ++n2) {
                const double t = 2.0 * kPi * double(k2 * n2) / 64.0;
                const float c = float(std::cos(t)), s = float(std::sin(t));
                m1[k2 * 128 + n2] = c;              // a -> re
                m1[k2 * 128 + 64 + n2] = s;         // a -> im
                m1[(32 + k2) * 128 + n2] = -s;      // b -> re
                m1[(32 + k2) * 128 + 64 + n2] = c;  // b -> im
            }
        // Stage 2 over k1, real part only, / 4096: rows (a k1 | b k1), columns n1.
        for (int k1 = 0; k1 < 64; ++k1)
            for (int n1 = 0; n1 < 64; ++n1) {
                const double t = 2.0 * kPi * double(k1 * n1) / 64.0;
                m2[k1 * 64 + n1] = float(std::cos(t) / kFft);
                m2[(64 + k1) * 64 + n1] = float(-std::sin(t) / kFft);
            }
        VARP a = _Reshape(_Transpose(z, {0, 1, 5, 4, 2, 3}), {S * 64, 64});                // [S k1, (re, im) k2]
        a = _Reshape(_MatMul(a, floats(m1, {64, 128})), {S, 64, 2, 64});                   // [S, k1, (re, im), n2]
        auto parts = _Split(a, {1, 1}, 2);
        auto tw = twiddles();                                                            // [1, k1, 1, n2]
        // times e^(+2 pi i k1 n2 / 4096)
        VARP re = parts[0] * tw.first - parts[1] * tw.second;
        VARP im = parts[0] * tw.second + parts[1] * tw.first;
        VARP b = _Reshape(_Transpose(_Concat({re, im}, 2), {0, 3, 2, 1}), {S * 64, 128});   // [S n2, (re, im) k1]
        VARP frames = _Reshape(_MatMul(b, floats(m2, {128, 64})), {S, 64, 64});            // [S, n2, n1]
        frames = _Reshape(_Transpose(frames, {0, 2, 1}), {S, kFft}) * param("istft.window", {1, kFft});

        // Overlap-add: frame f's quarter c lands in block f + c of 1024 samples, block b at padded position
        // (b + 2) * 1024. Output sample j is padded position 3584 + j: block offset 1536 + j.
        VARP quarters = _Reshape(frames, {kSources * 2, kFrames, 4, kHop});
        auto q = _Split(quarters, {1, 1, 1, 1}, 2);
        VARP sum;
        for (int c = 0; c < 4; ++c) {
            VARP part = _Pad(_Reshape(q[c], {kSources * 2, kFrames, kHop}), _Const(std::vector<int>{0, 0, c, 3 - c, 0, 0}.data(), {3, 2}, NCHW, halide_type_of<int>()));
            sum = c == 0 ? part : sum + part;
        }
        VARP flat = _Reshape(sum, {kSources * 2, (kFrames + 3) * kHop});
        VARP out = _Slice(flat, ints({0, 1536}), ints({kSources * 2, kSegment}));
        std::vector<float> env = take("istft.env", size_t((kFrames + 3) * kHop));
        return out / floats(std::vector<float>(env.begin() + 1536, env.begin() + 1536 + kSegment), {1, kSegment});
    }

    /** mix [1, 2, L] -> stems [1, 4, 2, L] */
    VARP forward(VARP mix) {
        VARP mix2 = _Reshape(mix, {2, kSegment});
        // Time branch input: the mix normalised by its own mean and unbiased std.
        auto [tMean, tSd] = moments(mix2, 2 * kSegment / 4096);
        VARP tCur = _Reshape((mix2 - tMean) / (tSd + _Const(1e-5f)), {1, 2, 1, kSegment});
        // Frequency branch input: the spectrogram, normalised the same way.
        VARP spec = stft(mix2);
        auto [fMean, fSd] = moments(spec, 4 * kBins * kFrames / 4096);
        VARP fCur = (spec - fMean) / (fSd + _Const(1e-5f));

        std::vector<VARP> skips, tskips;
        int tLen = kSegment, fBins = kBins, tIn = 2, fIn = 4;
        for (int i = 0; i < 4; ++i) {
            const int c = 48 << i;
            const std::string t = "tenc" + std::to_string(i), f = "enc" + std::to_string(i);
            // Time: conv k8 s4 + GELU, DConv, 1x1 rewrite + GLU.
            tCur = conv(tCur, t + ".conv", tIn, 1, 8, {1, 4}, {0, 2}, {1, 1}, true);
            tLen /= 4;
            tCur = dconv(tCur, t, c, 1, tLen, false);
            tCur = glu(conv(tCur, t + ".rw", c, 1, 1), c);
            tskips.push_back(tCur);
            // Frequency: conv (8, 1) s (4, 1) + GELU, DConv per frequency, rewrite + GLU (+ embedding after the first).
            fCur = conv(fCur, f + ".conv", fIn, 8, 1, {4, 1}, {2, 0}, {1, 1}, true);
            fBins /= 4;
            fCur = dconv(fCur, f, c, fBins, kFrames, true);
            fCur = glu(conv(fCur, f + ".rw", c, 1, 1), c);
            if (i == 0) fCur = fCur + param("freq_emb", {1, c, fBins, 1});
            skips.push_back(fCur);
            tIn = fIn = c;
        }

        // Cross-transformer on channel-major tokens: frequency tokens (f t), time tokens t.
        const int nf = fBins * kFrames, nt = tLen, top = 48 << 3;
        VARP xf = linear(_Reshape(skips[3], {1, top, 1, nf}), "up", top);
        VARP xt = linear(_Reshape(tskips[3], {1, top, 1, nt}), "up_t", top);
        xf = layerNorm(xf, "norm_in") + param("pos", {1, kDim, 1, nf});
        xt = layerNorm(xt, "norm_in_t") + param("pos_t", {1, kDim, 1, nt});
        for (int layer = 0; layer < 5; ++layer) {
            const std::string pf = "tf" + std::to_string(layer), pt = "tft" + std::to_string(layer);
            if (layer % 2 == 0) {
                auto self = [&](VARP x, const std::string& p, int n) {
                    auto qkv = _Split(linear(layerNorm(x, p + ".n1"), p + ".qkv", kDim), {kDim, kDim, kDim}, 1);
                    return finish(x, attend(qkv[0], qkv[1], qkv[2], n, n), p);
                };
                xf = self(xf, pf, nf);
                xt = self(xt, pt, nt);
            } else {
                // Both branches' queries, keys and values from the streams as they were, then both updates.
                VARP qf = linear(layerNorm(xf, pf + ".n1"), pf + ".q", kDim);
                auto kvf = _Split(linear(layerNorm(xt, pf + ".nkv"), pf + ".kv", kDim), {kDim, kDim}, 1);
                VARP qt = linear(layerNorm(xt, pt + ".n1"), pt + ".q", kDim);
                auto kvt = _Split(linear(layerNorm(xf, pt + ".nkv"), pt + ".kv", kDim), {kDim, kDim}, 1);
                VARP af = attend(qf, kvf[0], kvf[1], nf, nt);
                VARP at = attend(qt, kvt[0], kvt[1], nt, nf);
                xf = finish(xf, af, pf);
                xt = finish(xt, at, pt);
            }
        }

        // Decoders: skip add, 3x3 (time: 3) rewrite + GLU, DConv, ConvTranspose (+ GELU but the last).
        VARP cur = _Reshape(linear(xf, "down", kDim), {1, top, fBins, kFrames});
        for (int i = 0; i < 4; ++i) {
            const int c = 48 << (3 - i);
            const std::string p = "dec" + std::to_string(i);
            cur = cur + skips[3 - i];
            cur = glu(conv(cur, p + ".rw", c, 3, 3, {1, 1}, {1, 1}), c);
            cur = dconv(cur, p, c, fBins, kFrames, true);
            cur = convTranspose(cur, p + ".tr", c, fBins, kFrames, true, i < 3);
            fBins *= 4;
        }
        VARP tcur = _Reshape(linear(xt, "down_t", kDim), {1, top, 1, tLen});
        for (int i = 0; i < 4; ++i) {
            const int c = 48 << (3 - i);
            const std::string p = "tdec" + std::to_string(i);
            tcur = tcur + tskips[3 - i];
            tcur = glu(conv(tcur, p + ".rw", c, 1, 3, {1, 1}, {0, 1}), c);
            tcur = dconv(tcur, p, c, 1, tLen, false);
            tcur = convTranspose(tcur, p + ".tr", c, 1, tLen, false, i < 3);
            tLen *= 4;
        }

        // Each source back to audio: the iSTFT of its four spectral channels, plus its time-branch half.
        VARP freq = istft(cur * fSd + fMean);
        VARP time = _Reshape(tcur, {kSources * 2, kSegment}) * tSd + tMean;
        VARP stems = _Reshape(freq + time, {1, kSources, 2, kSegment});
        stems->setName("stems");
        return stems;
    }
};

void say(char* err, int errLen, const std::string& text) {
    if (!err || errLen <= 0) return;
    const size_t n = std::min(text.size(), size_t(errLen - 1));
    memcpy(err, text.data(), n);
    err[n] = '\0';
}

/** Deletes a UTF-8 path - on Windows through the wide API, as FileLoader opens it. */
void removeUtf8(const char* path) {
#if defined(_WIN32)
    const int n = MultiByteToWideChar(CP_UTF8, 0, path, -1, nullptr, 0);
    if (n <= 0) return;
    std::wstring wide(size_t(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, path, -1, &wide[0], n);
    _wremove(wide.c_str());
#else
    std::remove(path);
#endif
}

/**
 * Moves every convolution's weights and bias out of `net` into one blob, recording where each went in the
 * operator's `external` [offset, weight bytes, bias bytes] - the layout MNNConvert's --saveExternalData
 * writes, which MNN reads back into each operator's packed form without keeping the plain copy.
 */
std::vector<uint8_t> externalise(NetT& net) {
    auto movable = [](const std::unique_ptr<OpT>& op) {
        return op->main.type == OpParameter_Convolution2D && op->inputIndexes.size() == 1 && !op->main.AsConvolution2D()->quanParameter;
    };
    size_t total = 0;
    for (const auto& op : net.oplists)
        if (movable(op)) total += (op->main.AsConvolution2D()->weight.size() + op->main.AsConvolution2D()->bias.size()) * sizeof(float);
    std::vector<uint8_t> blob;
    blob.reserve(total);
    for (auto& op : net.oplists) {
        if (!movable(op)) continue;
        auto* conv = op->main.AsConvolution2D();
        const size_t weightBytes = conv->weight.size() * sizeof(float), biasBytes = conv->bias.size() * sizeof(float);
        conv->external = {int64_t(blob.size()), int64_t(weightBytes), int64_t(biasBytes)};
        const auto* w = reinterpret_cast<const uint8_t*>(conv->weight.data());
        const auto* b = reinterpret_cast<const uint8_t*>(conv->bias.data());
        blob.insert(blob.end(), w, w + weightBytes);
        blob.insert(blob.end(), b, b + biasBytes);
        std::vector<float>().swap(conv->weight);
        std::vector<float>().swap(conv->bias);
    }
    return blob;
}

}  // namespace

/**
 * htdemucs over the tensors put so far (folia_bt_weights_put, every tensor of htdemucs-wgsl.bin), as a
 * model handle: one input `mix` [1, 2, 172032], one output `stems` [1, 4, 2, 172032]. fp32 throughout.
 * Null with `err` set when a tensor the network needs was never put or has the wrong size. Consumes the
 * tensors it reads; the set can be freed once this returns.
 *
 * `scratch` is a file path this may write and deletes again before it returns: the convolutions'
 * weights go through it (externalise above) so that MNN loads them straight into the layout it runs
 * them in. Loaded from memory instead, the model kept its plain copy beside the packed one for its whole
 * life - 1.0GB at the peak of a segment against 0.5GB, the converted htdemucs-v3.mnn's figure, which
 * this matches.
 */
FOLIA_EXPORT FoliaMnn* folia_hd_build(FoliaBtWeights* weights, int threads, const char* scratch, char* err, int errLen) {
    try {
        std::string why;
        std::unique_ptr<FoliaMnn> handle(foliaNewHandle(threads, 1, why));
        if (!handle) {
            say(err, errLen, why);
            return nullptr;
        }
        ExecutorScope scope(handle->executor);
        std::unique_ptr<NetT> net(new NetT);
        {
            Builder builder{*weights, {}};
            VARP mix = _Input({1, 2, kSegment}, NCHW, halide_type_of<float>());
            mix->setName("mix");
            VARP stems = builder.forward(mix);
            if (!builder.missing.empty()) {
                say(err, errLen, builder.missing);
                return nullptr;
            }
            Variable::save({stems}, net.get());
        }
        weights->tensors.clear();
        handle->executor->gc(Executor::FULL);
        foliaReturnFreed();
        {
            std::vector<uint8_t> blob = externalise(*net);
            if (!FileLoader::write(scratch, std::make_pair(static_cast<const void*>(blob.data()), blob.size()))) {
                say(err, errLen, std::string("cannot write ") + scratch);
                return nullptr;
            }
        }
        flatbuffers::FlatBufferBuilder fb(1024);
        fb.Finish(Net::Pack(fb, net.get()));
        net.reset();
        Module::Config config;
        config.shapeMutable = false;
        handle->runtime->setExternalFile(scratch);
        handle->net.reset(Module::load({"mix"}, {"stems"}, fb.GetBufferPointer(), fb.GetSize(), handle->runtime, &config));
        removeUtf8(scratch);
        if (!handle->net) {
            say(err, errLen, "the htdemucs graph did not load");
            return nullptr;
        }
        fb.Clear();
        handle->executor->gc(Executor::FULL);
        foliaReturnFreed();
        handle->inputs.resize(1);
        return handle.release();
    } catch (const std::exception& e) {
        removeUtf8(scratch);
        say(err, errLen, e.what());
        return nullptr;
    }
}
