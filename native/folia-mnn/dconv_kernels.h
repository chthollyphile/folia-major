#pragma once
#include <cstddef>

// native/folia-mnn/dconv_kernels.h
// The table folia_dconv.cpp calls FoliaDConv's arithmetic through, and the one function that picks
// a table for this CPU. Each dconv_kernels_*.cpp fills one table from its own compilation of
// dconv_kernels.hpp; see the top of that file for why they are separate translation units.

namespace folia_dconv {

constexpr int kOB = 6;     // outputs per block - the packing below is in these units
constexpr int kCols = 16;  // columns per block

struct Kernels {
    const char* name;
    void (*convBlock)(const float* const* rows, int K, const float* wp, int O, const float* bias, int tb, float* out, int ldo);
    void (*gluBlock)(const float* const* rows, int K, const float* wp, int C, const float* aff, int tb, int w,
                     const float* x, float* y, size_t ld);
    void (*moments)(const float* p, int n, double& sum, double& sq);
    float (*dot)(const float* a, const float* b, int n);
};

/** The fastest table this CPU can run: NEON on arm64; AVX2+FMA where the CPU and OS have both, else SSE2. */
const Kernels& kernels();

} // namespace folia_dconv
