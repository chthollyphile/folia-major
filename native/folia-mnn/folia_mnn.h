#pragma once
#include <MNN/expr/Executor.hpp>
#include <MNN/expr/Module.hpp>
#include <memory>
#include <string>
#include <vector>

// native/folia-mnn/folia_mnn.h
// The model handle behind folia_mnn.cpp's C functions, shared with folia_beat_this.cpp, which builds
// one from weights rather than loading it from a file.

#if defined(_WIN32)
#define FOLIA_EXPORT extern "C" __declspec(dllexport)
#else
#define FOLIA_EXPORT extern "C" __attribute__((visibility("default")))
#endif

struct FoliaMnn {
    // Its own executor rather than MNN's process-wide one: its thread count is this model's, and every
    // function that touches the model enters it first (ExecutorScope is per thread) - koffi runs
    // `folia_mnn_run` on a thread of its own, where the global one would be whatever another model
    // last configured.
    std::shared_ptr<MNN::Express::Executor> executor;
    std::shared_ptr<MNN::Express::Executor::RuntimeManager> runtime;
    std::shared_ptr<MNN::Express::Module> net;
    std::vector<MNN::Express::VARP> inputs;
    std::vector<MNN::Express::VARP> outputs;
    std::string error;
};

/** A handle with its executor and runtime and no model, or null with `why` set. In folia_mnn.cpp. */
FoliaMnn* foliaNewHandle(int threads, int precision, std::string& why);
