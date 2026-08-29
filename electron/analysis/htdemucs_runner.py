"""htdemucs separation, in a Python process because of one flag.

worker.cjs runs every other model itself over onnxruntime-node. htdemucs is here,
and only htdemucs, for a single reason measured in Phase 0: onnxruntime's
`enable_mem_reuse` takes this graph's peak RSS from ~2.5GB to ~0.8GB with the
output bit-identical - and that flag is settable ONLY from ORT's Python binding.
onnxruntime-node has no field for it, its `extra` options are WASM-only, and it is
an internal C++ struct bool the C API never exposes. So the memory win needs a
Python interpreter, which the app downloads as an optional runtime and points at.

This file ships WITH the app (it is our code and versioned with worker.cjs); the
interpreter and numpy/onnxruntime are the heavy download beside it. It owns the
whole separation - segmenting, the overlap-add window, the stem order - so the JS
side does no DSP and cannot disagree with it about any of the three. Contract:

  argv:  in_path out_path total [model_path]
  in:    one flat float32 file, [ left(total), right(total) ]
  out:   one flat float32 file, [ drums.L, drums.R, bass.L, bass.R, vocals.L, vocals.R ]

The segment length, stem order and window are read off the reference
implementation (demucs_onnx 0.3.4, `_chunked_separate_single`), the same three
constants worker.cjs used before this moved out.
"""
import sys
import os
import numpy as np
import onnxruntime as ort

SOURCES = ["drums", "bass", "other", "vocals"]   # the model's own row order
RETURNED = ["drums", "bass", "vocals"]           # what we hand back ('other' dropped)


def segment_of(sess):
    """Samples per inference, asked of the model rather than repeated here.

    The length is welded into the exported graph - the shapes, the position tables and the
    overlap-add normaliser are each cut for one particular window - so the model is the only
    thing that can say what it is. A constant beside it would just be a second answer, and the
    two disagreeing is a silent wrong-audio bug rather than a crash.
    """
    return sess.get_inputs()[0].shape[2]


def build_window(segment):
    """The reference's triangular overlap-add window: chunks step by 3/4 of a
    segment, each faded across the quarter it shares with its neighbour, and the
    sum divided by total weight. A chunk boundary without it is an audible seam."""
    overlap = segment // 4
    win = np.ones(segment, dtype=np.float32)
    ramp = np.arange(overlap, dtype=np.float32) / (overlap - 1)
    win[:overlap] = ramp
    win[segment - overlap:] = ramp[::-1]
    return win


def make_session(model_path):
    """One CPU session, and nothing clever around it.

    There used to be a graph cache here - optimize once into a `.opt` beside the weights, load
    THAT afterwards - plus a `--warmup` entry point and a whole IPC path for building it when a
    download landed. All of it existed for one number: ORT's graph optimizer took 4594MB and
    3.9s on the old 24917-node export, against 909MB and 0.35s for the run itself.

    This export has 1556 nodes and no such peak. Optimizing it costs 353MB and 0.65s, and the
    cache bought 783MB against 792MB without - inside the noise. So the cache is gone, and the
    machinery that built it went with it.
    """
    so = ort.SessionOptions()
    so.enable_cpu_mem_arena = False      # matches worker.cjs; the arena alone is ~5GB peak
    so.enable_mem_reuse = False          # the flag this whole Python process exists for, see the top
    so.intra_op_num_threads = 4          # a quarter of a typical machine, like worker.cjs THREADS
    return ort.InferenceSession(model_path, sess_options=so, providers=["CPUExecutionProvider"])


def separate(sess, left, right):
    """left/right: 1-D float32, equal length. Returns {stem: (L, R)} for RETURNED."""
    total = left.shape[0]
    segment = segment_of(sess)
    win = build_window(segment)
    overlap = segment // 4
    stride = segment - overlap
    chunks = max(1, -(-total // stride))          # ceil

    out = np.zeros((len(SOURCES), 2, total), dtype=np.float32)
    weight = np.zeros(total, dtype=np.float32)
    inp = np.zeros((1, 2, segment), dtype=np.float32)
    mix = sess.get_inputs()[0].name

    for c in range(chunks):
        start = c * stride
        end = min(start + segment, total)
        if end <= start:
            break
        n = end - start
        inp[:] = 0.0
        inp[0, 0, :n] = left[start:end]
        inp[0, 1, :n] = right[start:end]
        stems = sess.run(None, {mix: inp})[0]     # [1, 4, 2, segment]
        out[:, :, start:end] += stems[0, :, :, :n] * win[:n]
        weight[start:end] += win[:n]

    np.divide(out, np.maximum(weight, 1e-8), out=out)
    return {s: (out[SOURCES.index(s), 0], out[SOURCES.index(s), 1]) for s in RETURNED}


def prefer_fast_cores():
    """Ask Windows to schedule this process on the machine's fast cores. Returns how many.

    Nothing to do with speed in the foreground: measured there, pinning changes NOTHING - 12.7s
    either way - because Thread Director already reads a saturating float workload as P-core work
    without being asked. This is about the background. Windows puts a minimised app's process tree
    into EcoQoS, and the same 30s window that takes 12.7s takes 28.1s under it. That is 2.2x, and
    for a music player "minimised" is the normal state, not the corner case.

    Three different calls cancel that penalty to within noise (12.6s, 12.4s, 12.8s): a hard
    affinity mask, clearing the throttle flag, and this one. This one is the soft version - a
    PREFERENCE, so a machine whose fast cores are busy with the listener's actual work can still
    overflow onto the rest instead of queueing behind it. Separation has minutes of lead; it must
    be invisible, not fast, and a hard mask is the one that could make it visible.

    A no-op where there is nothing to choose: one efficiency class means one kind of core, which
    is every non-hybrid machine. Every failure is silent - a scheduling hint that cannot be
    applied is not a reason to fail a separation.
    """
    if sys.platform != "win32":
        return 0

    import ctypes
    from ctypes import wintypes

    class CPU_SET_INFO(ctypes.Structure):
        _fields_ = [("Size", wintypes.DWORD), ("Type", wintypes.DWORD), ("Id", wintypes.DWORD),
                    ("Group", wintypes.WORD), ("LogicalProcessorIndex", ctypes.c_ubyte),
                    ("CoreIndex", ctypes.c_ubyte), ("LastLevelCacheIndex", ctypes.c_ubyte),
                    ("NumaNodeIndex", ctypes.c_ubyte), ("EfficiencyClass", ctypes.c_ubyte),
                    ("AllFlags", ctypes.c_ubyte), ("Reserved", ctypes.c_ubyte * 2),
                    ("AllocationTag", ctypes.c_ulonglong)]

    try:
        k32 = ctypes.windll.kernel32
        # Same pseudo-handle trap as peak_mb: without an explicit restype ctypes truncates it to
        # int32 and every call below silently does nothing.
        k32.GetCurrentProcess.restype = ctypes.c_void_p
        handle = ctypes.c_void_p(k32.GetCurrentProcess())

        size = wintypes.ULONG(0)
        # The first call is the size query and reports failure by design, so it is not checked.
        k32.GetSystemCpuSetInformation(None, 0, ctypes.byref(size), handle, 0)
        buf = ctypes.create_string_buffer(size.value)
        if not k32.GetSystemCpuSetInformation(buf, size.value, ctypes.byref(size), handle, 0):
            return 0

        sets, offset = [], 0
        while offset < size.value:
            entry = CPU_SET_INFO.from_buffer(buf, offset)
            sets.append((entry.Id, entry.EfficiencyClass))
            offset += entry.Size

        best = max(klass for _, klass in sets)
        fast = [cpu_id for cpu_id, klass in sets if klass == best]
        if len(fast) == len(sets):
            return 0                      # every core is the same core

        ids = (wintypes.ULONG * len(fast))(*fast)
        return len(fast) if k32.SetProcessDefaultCpuSets(handle, ids, len(fast)) else 0
    except Exception:
        return 0


def peak_mb():
    """(peak working set, peak commit) in MB, as the OS itself tracked them.

    Windows keeps both high-water marks per process, so this is exact and catches a spike
    between two samples of any external monitor - which is how a 4GB transient stayed
    invisible while an 8ms sampler inside the process reported 973MB.
    """
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        class PMC(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                        ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                        ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
                        ("PrivateUsage", ctypes.c_size_t)]

        # The handle is a pseudo-handle (-1); without an explicit restype ctypes truncates it to
        # int32 and the call silently returns 0 for every field.
        k32 = ctypes.windll.kernel32
        k32.GetCurrentProcess.restype = ctypes.c_void_p
        fn = ctypes.windll.psapi.GetProcessMemoryInfo
        fn.argtypes = [ctypes.c_void_p, ctypes.POINTER(PMC), wintypes.DWORD]
        fn.restype = wintypes.BOOL
        pmc = PMC()
        pmc.cb = ctypes.sizeof(pmc)
        if fn(k32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb):
            return pmc.PeakWorkingSetSize / 1048576.0, pmc.PeakPagefileUsage / 1048576.0
    try:
        import resource
        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 0.0
    except Exception:
        return 0.0, 0.0


def run_files(model_path, in_path, out_path, total):
    import json
    import time

    raw = np.fromfile(in_path, dtype=np.float32)
    left, right = raw[:total], raw[total:2 * total]

    fast_cores = prefer_fast_cores()

    t0 = time.time()
    sess = make_session(model_path)
    load_sec = time.time() - t0
    load_peak, _ = peak_mb()

    t1 = time.time()
    stems = separate(sess, left, right)
    infer_sec = time.time() - t1

    # One line on the happy path, because success printing nothing is exactly how this process's
    # real peak went unmeasured: worker.cjs logs it, so every separation now says what it cost.
    ws, commit = peak_mb()
    seg = segment_of(sess)
    stride = seg - seg // 4
    print(json.dumps({
        "peak_ws_mb": round(ws, 1), "peak_commit_mb": round(commit, 1),
        "peak_after_load_mb": round(load_peak, 1),
        "total": total, "sec": round(total / 44100.0, 1),
        "segment": seg, "segments": max(1, -(-total // stride)),
        "load_s": round(load_sec, 2), "infer_s": round(infer_sec, 2),
        "threads": 4, "cpus": os.cpu_count(), "fast_cores": fast_cores,
        "omp": os.environ.get("OMP_NUM_THREADS", ""),
    }))
    # A .part then a rename, so a crash mid-write never leaves a short file the JS side reads as
    # valid: it waits for the process to exit 0 AND the final path to appear.
    part = out_path + ".part"
    with open(part, "wb") as f:
        for name in RETURNED:
            L, R = stems[name]
            L.tofile(f)
            R.tofile(f)
    os.replace(part, out_path)


def selftest(model_path):
    """A full window of noise, reporting peak RSS sampled DURING the whole multi-segment
    run - kept for re-measuring peak once this is spawned from inside the app. psutil is
    imported here only, so production run_files never needs it."""
    import json
    import threading
    import time

    def rss_mb():
        import psutil
        return psutil.Process().memory_info().rss / 1048576.0

    total = int(float(os.environ.get("HTDEMUCS_SEC", "40")) * 44100)
    rng = np.random.default_rng(7)
    left = (rng.standard_normal(total) * 0.1).astype(np.float32)
    right = (rng.standard_normal(total) * 0.1).astype(np.float32)
    sess = make_session(model_path)

    stop = threading.Event()
    peak = [rss_mb()]

    def sampler():
        while not stop.is_set():
            r = rss_mb()
            if r > peak[0]:
                peak[0] = r
            time.sleep(0.008)

    t = threading.Thread(target=sampler)
    t.start()
    t0 = time.time()
    stems = separate(sess, left, right)
    dt = time.time() - t0
    stop.set()
    t.join()

    seg = segment_of(sess)
    stride = seg - seg // 4
    print(json.dumps({
        "total_samples": total,
        "chunks": max(1, -(-total // stride)),
        "rss_PEAK_during_full_window_mb": round(peak[0], 1),
        "window_sec": round(dt, 3),
        "vocals_absmax": float(abs(stems["vocals"][0]).max()),
    }))


if __name__ == "__main__":
    model = os.environ.get("HTDEMUCS_MODEL", "")
    if len(sys.argv) >= 2 and sys.argv[1] == "--selftest":
        selftest(model)
    else:
        in_path, out_path, total = sys.argv[1], sys.argv[2], int(sys.argv[3])
        if len(sys.argv) >= 5:
            model = sys.argv[4]
        run_files(model, in_path, out_path, total)
