#include <MNN/Interpreter.hpp>
#include <MNN/expr/Executor.hpp>
#include <MNN/expr/ExecutorScope.hpp>
#include <MNN/expr/ExprCreator.hpp>
#include <MNN/expr/Module.hpp>
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>
#include "folia_mnn.h"
#if defined(__APPLE__)
#include <malloc/malloc.h>
#elif defined(_WIN32)
#include <malloc.h>
#include <windows.h>  // NOMINMAX comes from CMakeLists.txt, for every file at once
#elif defined(__GLIBC__)
#include <malloc.h>
#endif

// native/folia-mnn/folia_mnn.cpp
// The analysis models' CPU runtime: MNN, linked in whole, behind a handful of plain C functions.
//
// Plain C rather than a Node addon on purpose. electron/analysis/worker.cjs reaches this through
// koffi, which the app already ships, so the library needs no Node or Electron headers, no node.lib
// on Windows and no rebuild per Electron version - one CMake build per platform, and the same file
// runs under any Node that can load koffi.
//
// Nothing here knows which model it is running. A model is loaded, its inputs are set one at a time
// by index, `folia_mnn_run` runs it - the only call that takes real time, and the only one worker.cjs
// makes off its event loop (koffi's async call) - and the outputs are read back by index. Everything
// model-specific (htdemucs' segmenting and overlap-add, beat_this's chunking) stays in worker.cjs.
//
// A handle is used by one caller at a time: worker.cjs serialises every request through one queue,
// and the async run is awaited before anything else touches the handle.
//
// One model is one file, laid out by build/htdemucs_mnn/make_model.py (pack; removed with
// htdemucs-v3.mnn, the one model in this format - the app's two models are built from their WebGPU
// exports now, folia_beat_this.cpp and folia_htdemucs.cpp, and folia_mnn_load is kept for this layout):
//
//   [ weights ][ graph ][ "FOLIAMNN" | graph offset, uint64 little-endian ]
//
// The weights are MNNConvert's external weight file (--saveExternalData) and come first, so the
// offsets the graph records into it are offsets into this file as well; the graph is the .mnn MNNConvert
// wrote beside it. Only the graph is read into memory here. MNN reads each operator's weights straight
// from the file into that operator's own packed layout, where a plain .mnn would keep the original copy
// resident beside the packed one for the life of the model: measured on htdemucs, 415MB loaded against
// 214MB, and 615MB at the peak of a run against 413MB. A file without the trailer is a plain .mnn.

using namespace MNN;
using namespace MNN::Express;


namespace {

void say(char* err, int errLen, const std::string& text) {
    if (!err || errLen <= 0) return;
    const size_t n = std::min(text.size(), size_t(errLen - 1));
    memcpy(err, text.data(), n);
    err[n] = '\0';
}

/** Opens a UTF-8 path for reading - on Windows through the wide API, so a non-ASCII directory works. */
FILE* openUtf8(const char* path) {
#if defined(_WIN32)
    const int n = MultiByteToWideChar(CP_UTF8, 0, path, -1, nullptr, 0);
    if (n <= 0) return nullptr;
    std::wstring wide(size_t(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, path, -1, &wide[0], n);
    return _wfopen(wide.c_str(), L"rb");
#else
    return fopen(path, "rb");
#endif
}

bool seekTo(FILE* f, uint64_t offset) {
#if defined(_WIN32)
    return _fseeki64(f, (long long)offset, SEEK_SET) == 0;
#else
    return fseeko(f, (off_t)offset, SEEK_SET) == 0;
#endif
}

uint64_t sizeOf(FILE* f) {
#if defined(_WIN32)
    _fseeki64(f, 0, SEEK_END);
    return (uint64_t)_ftelli64(f);
#else
    fseeko(f, 0, SEEK_END);
    return (uint64_t)ftello(f);
#endif
}

const char kMagic[8] = {'F', 'O', 'L', 'I', 'A', 'M', 'N', 'N'};

/**
 * The graph of a packed model file (see the top of this file) into `graph`. Answers true for a packed
 * file, false for a plain .mnn - or with `why` set when the file is unreadable or the trailer is wrong.
 */
bool readPackedGraph(const char* path, std::vector<uint8_t>& graph, std::string& why) {
    FILE* f = openUtf8(path);
    if (!f) {
        why = std::string("cannot open ") + path;
        return false;
    }
    bool packed = false;
    const uint64_t size = sizeOf(f);
    uint8_t tail[16];
    if (size > sizeof(tail) && seekTo(f, size - sizeof(tail)) && fread(tail, 1, sizeof(tail), f) == sizeof(tail)
        && memcmp(tail, kMagic, sizeof(kMagic)) == 0) {
        packed = true;
        uint64_t offset = 0;
        for (int i = 7; i >= 0; --i) offset = (offset << 8) | tail[8 + i];
        const uint64_t end = size - sizeof(tail);
        if (offset >= end) {
            why = std::string("damaged model trailer in ") + path;
        } else {
            graph.resize(size_t(end - offset));
            if (!seekTo(f, offset) || fread(graph.data(), 1, graph.size(), f) != graph.size()) why = std::string("cannot read ") + path;
        }
    }
    fclose(f);
    return packed;
}

}  // namespace

const char* folia_dconv_isa();

/**
 * Version of this library's interface; worker.cjs refuses a library that answers another. 2: htdemucs is
 * built from its WebGPU export (folia_hd_build) rather than loaded from htdemucs-v3.mnn.
 */
FOLIA_EXPORT int folia_mnn_abi() { return 2; }

/** The instruction set the Folia operators run with on this CPU ("neon", "sse2", "avx2+fma"), for the log. */
FOLIA_EXPORT const char* folia_mnn_isa() { return folia_dconv_isa(); }

/**
 * Asks Windows to schedule this process on the machine's fast cores, and answers how many; 0 where
 * there is nothing to choose or the call is not available. Carried over from the Python runner this
 * library replaced (htdemucs_runner.py prefer_fast_cores), where it was measured:
 *
 * Nothing to do with speed in the foreground - pinning changes nothing there, 12.7s either way,
 * because Thread Director already reads a saturating float workload as P-core work. It is about the
 * background: Windows puts a minimised app's process tree into EcoQoS, and the same 30s window that
 * takes 12.7s takes 28.1s under it. For a music player "minimised" is the normal state.
 *
 * A hard affinity mask, clearing the throttle flag, and this all cancel that penalty to within noise
 * (12.6s, 12.4s, 12.8s). This is the soft one - process DEFAULT cpu sets are a preference, so a
 * machine whose fast cores are busy with the listener's own work can still overflow onto the rest
 * instead of queueing behind it. It applies to every thread of the process without a set of its own,
 * which includes MNN's pool. A no-op on a machine with one efficiency class, and everywhere but Windows.
 */
FOLIA_EXPORT int folia_mnn_prefer_fast_cores() {
#if defined(_WIN32)
    HANDLE process = GetCurrentProcess();
    ULONG size = 0;
    // The first call is the size query and reports failure by design.
    GetSystemCpuSetInformation(nullptr, 0, &size, process, 0);
    if (size == 0) return 0;
    std::vector<uint8_t> buffer(size);
    auto* first = reinterpret_cast<PSYSTEM_CPU_SET_INFORMATION>(buffer.data());
    if (!GetSystemCpuSetInformation(first, size, &size, process, 0)) return 0;
    std::vector<std::pair<ULONG, BYTE>> sets;
    for (ULONG offset = 0; offset < size;) {
        auto* entry = reinterpret_cast<PSYSTEM_CPU_SET_INFORMATION>(buffer.data() + offset);
        if (entry->Size == 0) break;
        if (entry->Type == CpuSetInformation) sets.emplace_back(entry->CpuSet.Id, entry->CpuSet.EfficiencyClass);
        offset += entry->Size;
    }
    if (sets.empty()) return 0;
    BYTE best = 0;
    for (const auto& set : sets) best = std::max(best, set.second);
    std::vector<ULONG> fast;
    for (const auto& set : sets) {
        if (set.second == best) fast.push_back(set.first);
    }
    if (fast.size() == sets.size()) return 0;  // every core is the same core
    return SetProcessDefaultCpuSets(process, fast.data(), static_cast<ULONG>(fast.size())) ? static_cast<int>(fast.size()) : 0;
#else
    return 0;
#endif
}

/**
 * Loads a .mnn model on the CPU, or answers null and says why in `err`.
 *
 * precision: 0 normal, 1 high (fp32 throughout - what the models ship with), 2 low (fp16 where the
 * CPU has it). shapeMutable: 1 when the input shape changes between runs (beat_this's short last
 * chunk), 0 when it is welded into the model (htdemucs' segment), which lets MNN plan memory once.
 */
/**
 * A handle with its executor and runtime but no model yet, or null with `why` set. Shared with
 * folia_beat_this.cpp, which puts a model it builds into it rather than one read from a file.
 *
 * precision: 0 normal, 1 high (fp32 throughout - what the models ship with), 2 low (fp16 where the
 * CPU has it).
 */
FoliaMnn* foliaNewHandle(int threads, int precision, std::string& why) {
    BackendConfig backend;
    backend.precision = precision == 1 ? BackendConfig::Precision_High
                      : precision == 2 ? BackendConfig::Precision_Low : BackendConfig::Precision_Normal;
    // Low: intermediate buffers are released as soon as nothing reads them, the same trade the
    // onnxruntime path made with its arena off - a background job with memory to give back.
    backend.memory = BackendConfig::Memory_Low;
    std::shared_ptr<Executor> executor(Executor::newExecutor(MNN_FORWARD_CPU, backend, std::max(1, threads)));
    if (!executor) {
        why = "no CPU executor";
        return nullptr;
    }
    ExecutorScope scope(executor);
    ScheduleConfig schedule;
    schedule.type = MNN_FORWARD_CPU;
    schedule.numThread = std::max(1, threads);
    schedule.backendConfig = &backend;
    std::shared_ptr<Executor::RuntimeManager> runtime(Executor::RuntimeManager::createRuntimeManager(schedule));
    if (!runtime) {
        why = "no CPU runtime";
        return nullptr;
    }
    auto* handle = new FoliaMnn();
    handle->executor = executor;
    handle->runtime = runtime;
    return handle;
}

/**
 * Loads a model file on the CPU, or answers null and says why in `err`. precision as foliaNewHandle.
 * shapeMutable: 1 when the input shape changes between runs, 0 when it is welded into the model
 * (htdemucs' segment), which lets MNN plan memory once.
 */
FOLIA_EXPORT FoliaMnn* folia_mnn_load(const char* path, int threads, int precision, int shapeMutable, char* err, int errLen) {
    try {
        std::vector<uint8_t> graph;
        std::string why;
        const bool packed = readPackedGraph(path, graph, why);
        if (!why.empty()) {
            say(err, errLen, why);
            return nullptr;
        }
        std::unique_ptr<FoliaMnn> handle(foliaNewHandle(threads, precision, why));
        if (!handle) {
            say(err, errLen, why);
            return nullptr;
        }
        ExecutorScope scope(handle->executor);
        Module::Config config;
        config.shapeMutable = shapeMutable != 0;
        // Empty name lists: the model's own inputs and outputs, in the order it declares them.
        if (packed) {
            // The weights are read from this same file, at the offsets the graph records.
            handle->runtime->setExternalFile(path);
            handle->net.reset(Module::load({}, {}, graph.data(), graph.size(), handle->runtime, &config));
        } else {
            handle->net.reset(Module::load({}, {}, path, handle->runtime, &config));
        }
        if (!handle->net) {
            say(err, errLen, std::string("cannot load ") + path);
            return nullptr;
        }
        handle->inputs.resize(handle->net->getInfo()->inputs.size());
        return handle.release();
    } catch (const std::exception& e) {
        say(err, errLen, e.what());
        return nullptr;
    }
}

void foliaReturnFreed() {
#if defined(__APPLE__)
    malloc_zone_pressure_relief(nullptr, 0);
#elif defined(_WIN32)
    _heapmin();
#elif defined(__GLIBC__)
    malloc_trim(0);
#endif
}

FOLIA_EXPORT void folia_mnn_free(FoliaMnn* handle) {
    std::shared_ptr<Executor> executor = handle->executor;
    {
        ExecutorScope scope(executor);
        handle->outputs.clear();
        handle->inputs.clear();
        handle->net.reset();
        handle->runtime.reset();
        executor->gc(Executor::FULL);
    }
    delete handle;
    executor.reset();
    // Freed is not yet returned: the allocator keeps what a model let go of for the next allocation,
    // so without this the process goes on holding most of a model it no longer has. Measured on macOS
    // with htdemucs: physical footprint 435-620MB loaded, 49-81MB after the free alone, 7MB after this.
    foliaReturnFreed();
}

FOLIA_EXPORT int folia_mnn_input_count(FoliaMnn* handle) { return int(handle->net->getInfo()->inputs.size()); }

/** The declared shape of an input into `dims` (a dynamic axis reads -1). Answers the rank, or -1. */
FOLIA_EXPORT int folia_mnn_input_shape(FoliaMnn* handle, int index, int* dims, int capacity) {
    const auto& inputs = handle->net->getInfo()->inputs;
    if (index < 0 || index >= int(inputs.size())) return -1;
    const auto& dim = inputs[index].dim;
    for (int i = 0; i < int(dim.size()) && i < capacity; ++i) dims[i] = dim[i];
    return int(dim.size());
}

/** Copies `count` floats in as input `index`, shaped `dims`. Answers 0, or -1 on a bad argument. */
FOLIA_EXPORT int folia_mnn_set_input(FoliaMnn* handle, int index, const float* data, const int* dims, int rank) {
    if (index < 0 || index >= int(handle->inputs.size()) || rank <= 0) return -1;
    ExecutorScope scope(handle->executor);
    std::vector<int> shape(dims, dims + rank);
    size_t count = 1;
    for (int d : shape) {
        if (d <= 0) return -1;
        count *= size_t(d);
    }
    auto input = _Input(shape, NCHW, halide_type_of<float>());
    float* to = input->writeMap<float>();
    if (!to) return -1;
    memcpy(to, data, count * sizeof(float));
    input->unMap();
    handle->inputs[index] = input;
    return 0;
}

/**
 * Runs the model on the inputs set. Answers 0, or -1 with the reason kept for folia_mnn_error.
 * The one slow call: worker.cjs makes it through koffi's async path, on a thread of its own.
 */
FOLIA_EXPORT int folia_mnn_run(FoliaMnn* handle) {
    try {
        ExecutorScope scope(handle->executor);
        for (const auto& input : handle->inputs) {
            if (input.get() == nullptr) {
                handle->error = "an input was not set";
                return -1;
            }
        }
        auto outputs = handle->net->onForward(handle->inputs);
        if (outputs.empty()) {
            handle->error = "the model produced no outputs";
            return -1;
        }
        handle->outputs.clear();
        for (auto& output : outputs) {
            // Plain row-major for the reader; also what forces the computation to finish here,
            // inside the call that runs off the event loop, rather than at the first read.
            auto plain = _Convert(output, NCHW);
            if (plain.get() == nullptr || !plain->readMap<float>()) {
                handle->error = "an output could not be read";
                return -1;
            }
            handle->outputs.push_back(plain);
        }
        // The inputs are copies, and a separation holds them across a whole window otherwise.
        for (auto& input : handle->inputs) input = nullptr;
        return 0;
    } catch (const std::exception& e) {
        handle->error = e.what();
        return -1;
    }
}

FOLIA_EXPORT int folia_mnn_error(FoliaMnn* handle, char* err, int errLen) {
    say(err, errLen, handle->error);
    return int(handle->error.size());
}

FOLIA_EXPORT int folia_mnn_output_count(FoliaMnn* handle) { return int(handle->outputs.size()); }

/** The shape of output `index` from the last run into `dims`. Answers the rank, or -1. */
FOLIA_EXPORT int folia_mnn_output_shape(FoliaMnn* handle, int index, int* dims, int capacity) {
    if (index < 0 || index >= int(handle->outputs.size())) return -1;
    ExecutorScope scope(handle->executor);
    const auto dim = handle->outputs[index]->getInfo()->dim;
    for (int i = 0; i < int(dim.size()) && i < capacity; ++i) dims[i] = dim[i];
    return int(dim.size());
}

/** Copies up to `capacity` floats of output `index` into `to`. Answers how many there are, or -1. */
FOLIA_EXPORT long long folia_mnn_output(FoliaMnn* handle, int index, float* to, long long capacity) {
    if (index < 0 || index >= int(handle->outputs.size())) return -1;
    ExecutorScope scope(handle->executor);
    const auto& output = handle->outputs[index];
    const long long size = output->getInfo()->size;
    const float* from = output->readMap<float>();
    if (!from) return -1;
    memcpy(to, from, size_t(std::min(size, capacity)) * sizeof(float));
    return size;
}

/** Drops the last run's outputs, which otherwise live until the next run. */
FOLIA_EXPORT void folia_mnn_clear(FoliaMnn* handle) {
    ExecutorScope scope(handle->executor);
    handle->outputs.clear();
}
