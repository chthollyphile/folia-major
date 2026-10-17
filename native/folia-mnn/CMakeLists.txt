# native/folia-mnn/CMakeLists.txt
# One shared library per platform - libfolia_mnn.dylib / folia_mnn.dll / libfolia_mnn.so - with MNN
# compiled in from the pinned source build/buildMnnRuntime.mjs fetches, CPU only. See folia_mnn.cpp.
cmake_minimum_required(VERSION 3.24)
project(folia_mnn CXX C)

set(MNN_SOURCE_DIR "" CACHE PATH "MNN source tree (fetched by build/buildMnnRuntime.mjs)")
if(NOT EXISTS "${MNN_SOURCE_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "MNN_SOURCE_DIR does not point at an MNN source tree: '${MNN_SOURCE_DIR}'")
endif()

# MNN as a static library inside this one, with nothing but the CPU backend. SSE/AVX2 kernels are
# chosen at run time on x86 (AVX512 stays off: it would be the only path some machines take, and no
# machine of ours can test it); on arm64 the fp16 and SME2 kernels are likewise picked per CPU.
set(MNN_BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(MNN_SEP_BUILD OFF CACHE BOOL "" FORCE)
set(MNN_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(MNN_BUILD_CONVERTER OFF CACHE BOOL "" FORCE)
set(MNN_BUILD_TEST OFF CACHE BOOL "" FORCE)
set(MNN_BUILD_DEMO OFF CACHE BOOL "" FORCE)
set(MNN_BUILD_BENCHMARK OFF CACHE BOOL "" FORCE)
set(MNN_METAL OFF CACHE BOOL "" FORCE)
set(MNN_OPENCL OFF CACHE BOOL "" FORCE)
set(MNN_VULKAN OFF CACHE BOOL "" FORCE)
set(MNN_CUDA OFF CACHE BOOL "" FORCE)
set(MNN_AVX512 OFF CACHE BOOL "" FORCE)
set(MNN_USE_THREAD_POOL ON CACHE BOOL "" FORCE)
set(MNN_USE_LOGCAT OFF CACHE BOOL "" FORCE)
set(MNN_WIN_RUNTIME_MT ON CACHE BOOL "" FORCE)
# Our own operator (FoliaDConv, folia_dconv.cpp) is registered through MNN's plugin interface.
set(MNN_WITH_PLUGIN ON CACHE BOOL "" FORCE)
add_subdirectory("${MNN_SOURCE_DIR}" mnn EXCLUDE_FROM_ALL)

add_library(folia_mnn SHARED folia_mnn.cpp folia_beat_this.cpp folia_htdemucs.cpp folia_dconv.cpp dconv_kernels_base.cpp)

# The architecture being built for: on macOS that is CMAKE_OSX_ARCHITECTURES (x86_64 is cross-built on
# an arm64 machine), elsewhere the processor.
if(APPLE AND CMAKE_OSX_ARCHITECTURES)
    set(FOLIA_ARCH "${CMAKE_OSX_ARCHITECTURES}")
else()
    set(FOLIA_ARCH "${CMAKE_SYSTEM_PROCESSOR}")
endif()
string(TOLOWER "${FOLIA_ARCH}" FOLIA_ARCH)
if(FOLIA_ARCH MATCHES "x86_64|amd64|x64")
    # A second compilation of the same kernels with AVX2+FMA, picked at run time (dconv_kernels.h).
    # Only this file gets the flags: everything else must run on any x86-64.
    target_sources(folia_mnn PRIVATE dconv_kernels_avx2.cpp)
    if(MSVC)
        set_source_files_properties(dconv_kernels_avx2.cpp PROPERTIES COMPILE_OPTIONS "/arch:AVX2")
    else()
        set_source_files_properties(dconv_kernels_avx2.cpp PROPERTIES COMPILE_OPTIONS "-mavx2;-mfma")
    endif()
endif()
set_target_properties(folia_mnn PROPERTIES
    CXX_STANDARD 17
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON)
if(MSVC)
    set_property(TARGET folia_mnn PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")
    # windows.h otherwise defines min/max macros, and whichever file includes it first - ours or an
    # MNN header - breaks std::min/std::max in every file after.
    target_compile_definitions(folia_mnn PRIVATE NOMINMAX)
endif()
# folia_dconv.cpp is an MNN CPU operator and uses MNN's internal headers, as MNN's own operators do (and
# folia_htdemucs.cpp its FileLoader, which opens UTF-8 paths on Windows) -
# so it must see them with MNN's own definitions (MNN_USE_THREAD_POOL and the rest change what those
# classes contain). MNN sets them for its directory; they are copied from there, not repeated here.
get_directory_property(FOLIA_MNN_DEFINITIONS DIRECTORY "${MNN_SOURCE_DIR}" COMPILE_DEFINITIONS)
set_source_files_properties(folia_dconv.cpp folia_htdemucs.cpp PROPERTIES COMPILE_DEFINITIONS "${FOLIA_MNN_DEFINITIONS}")
target_include_directories(folia_mnn PRIVATE
    "${MNN_SOURCE_DIR}/include"
    "${MNN_SOURCE_DIR}/source"
    "${MNN_SOURCE_DIR}/schema/current"
    "${MNN_SOURCE_DIR}/3rd_party/flatbuffers/include")
# Whole archive: MNN registers its operators from static initialisers, which a plain static link
# would drop as unreferenced - and a model then fails at load with an op "not supported".
target_link_libraries(folia_mnn PRIVATE "$<LINK_LIBRARY:WHOLE_ARCHIVE,MNN>")
if(APPLE)
    target_link_libraries(folia_mnn PRIVATE "-framework Accelerate")
elseif(UNIX)
    target_link_libraries(folia_mnn PRIVATE pthread)
    # Self-contained: the Linux packages run on distributions whose libstdc++ is older than the
    # build machine's.
    target_link_options(folia_mnn PRIVATE -static-libstdc++ -static-libgcc)
endif()
