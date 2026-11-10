#define FOLIA_DCONV_NS folia_dconv_base
#include "dconv_kernels.hpp"
#include "dconv_kernels.h"
#include <cstdlib>
#include <cstring>
#if defined(_MSC_VER) && (defined(_M_X64) || defined(_M_IX86))
#include <intrin.h>
#endif

// native/folia-mnn/dconv_kernels_base.cpp
// The kernels at the build's baseline - NEON on arm64, SSE2 on x86-64, which every CPU of either has -
// and the choice between them and the AVX2+FMA copy (dconv_kernels_avx2.cpp) on x86.

namespace folia_dconv {

static_assert(kOB == folia_dconv_base::kOB && kCols == folia_dconv_base::kCols, "block shape drifted");

namespace {

const Kernels kBase = {
#if defined(FOLIA_NEON)
    "neon",
#else
    "sse2",
#endif
    folia_dconv_base::convBlock, folia_dconv_base::gluBlock, folia_dconv_base::moments, folia_dconv_base::dot,
};

#if defined(FOLIA_SSE)
/**
 * AVX2 and FMA in the CPU, and the OS saving the YMM registers across a context switch - without the
 * last a CPU that has both still faults on them (CPUID leaf 1 ECX bits 12 FMA, 27 OSXSAVE, 28 AVX;
 * XCR0 bits 1-2; leaf 7 EBX bit 5 AVX2).
 */
bool hasAvx2Fma() {
#if defined(_MSC_VER)
    int r[4];
    __cpuid(r, 0);
    if (r[0] < 7) return false;
    __cpuid(r, 1);
    const unsigned ecx = (unsigned)r[2];
    if (!(ecx & (1u << 12)) || !(ecx & (1u << 27)) || !(ecx & (1u << 28))) return false;
    if ((_xgetbv(0) & 6) != 6) return false;
    __cpuidex(r, 7, 0);
    return ((unsigned)r[1] & (1u << 5)) != 0;
#else
    return __builtin_cpu_supports("avx2") && __builtin_cpu_supports("fma");
#endif
}
#endif

} // namespace

#if defined(FOLIA_SSE)
const Kernels& kernelsAvx2();
#endif

const Kernels& kernels() {
#if defined(FOLIA_SSE)
    // FOLIA_DCONV_ISA=sse2 or avx2 overrides the check, for checking each path's red line on whatever
    // machine is at hand (sse2 on a newer CPU; avx2 under an emulator whose CPUID hides it). Forcing
    // avx2 on a CPU without it crashes - it is a test switch, not a setting.
    static const char* forced = std::getenv("FOLIA_DCONV_ISA");
    static const Kernels& chosen = forced && std::strcmp(forced, "sse2") == 0 ? kBase
        : forced && std::strcmp(forced, "avx2") == 0 ? kernelsAvx2()
        : hasAvx2Fma() ? kernelsAvx2() : kBase;
    return chosen;
#else
    return kBase;
#endif
}

} // namespace folia_dconv
