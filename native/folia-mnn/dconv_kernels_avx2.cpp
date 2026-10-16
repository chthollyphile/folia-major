#define FOLIA_DCONV_NS folia_dconv_avx2
#include "dconv_kernels.hpp"
#include "dconv_kernels.h"

// native/folia-mnn/dconv_kernels_avx2.cpp
// The kernels compiled for AVX2+FMA (CMakeLists.txt gives this file alone those flags; x86 only).
// Reached only through folia_dconv::kernels(), which checks the CPU first.

#if !defined(FOLIA_FMA)
#error "this file must be compiled with AVX2 and FMA enabled"
#endif

namespace folia_dconv {

static_assert(kOB == folia_dconv_avx2::kOB && kCols == folia_dconv_avx2::kCols, "block shape drifted");

const Kernels& kernelsAvx2() {
    static const Kernels table = {
        "avx2+fma",
        folia_dconv_avx2::convBlock, folia_dconv_avx2::gluBlock, folia_dconv_avx2::moments, folia_dconv_avx2::dot,
    };
    return table;
}

} // namespace folia_dconv
