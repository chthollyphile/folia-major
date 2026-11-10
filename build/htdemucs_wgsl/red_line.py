"""The acceptance gate for the WGSL htdemucs: the stem it returns against the ONNX graph's, per segment.

build/htdemucs_wgsl/red_line.py

    python red_line.py REF_DIR OUT_DIR [SOURCE]
    python red_line.py REF_DIR OUT_DIR 0,1,2,3   (out.f32 from HTW_SOURCES=0,1,2,3: [n, 4, 2, 172032])

REF_DIR/stems.f32 from reference.py ([n, 4, 2, 172032]), OUT_DIR/out.f32 from dev/htdemucs-wgsl
([n, 2, 172032], source SOURCE, default 0 = drums). The same gate make_model.py (removed) held the CPU
model to, and folia_htdemucs.cpp's red line too: per segment, the stem's level against the reference's within 0.01 dB. Also prints each
segment's SNR against the reference. Exit code 0 only when every segment passes.

From the PR #750 review: the level alone passed an output that is NaN (Python's max() drops it), the
reference inverted or a sample late. So the output must also be finite, and every segment's SNR at
least SNR_FLOOR_DB: far under any run seen (24 dB and up), far over an inverted output (-6 dB).
"""
import sys

import numpy as np

L = 172032
LIMIT_DB = 0.01
SNR_FLOOR_DB = 20.0


def main():
    ref_dir, out_dir = sys.argv[1:3]
    sources = [int(s) for s in sys.argv[3].split(',')] if len(sys.argv) > 3 else [0]
    names = ['drums', 'bass', 'other', 'vocals']
    refs = np.fromfile(f'{ref_dir}/stems.f32', np.float32).astype(np.float64).reshape(-1, 4, 2, L)
    outs = np.fromfile(f'{out_dir}/out.f32', np.float32).astype(np.float64).reshape(-1, len(sources), 2, L)
    assert refs.shape[0] == outs.shape[0], (refs.shape, outs.shape)
    worst = 0.0
    lowest_snr = np.inf
    finite = bool(np.isfinite(outs).all())
    if not finite:
        print(f'output has {int(np.size(outs) - np.isfinite(outs).sum())} non-finite samples')
    for k, source in enumerate(sources):
        for i, (r, o) in enumerate(zip(refs[:, source], outs[:, k])):
            level_r = 10 * np.log10(np.mean(r ** 2))
            level_o = 10 * np.log10(np.mean(o ** 2))
            snr = 10 * np.log10(np.mean(r ** 2) / max(np.mean((r - o) ** 2), 1e-30))
            # Not max(): it keeps the first of a NaN and a number, so a NaN level could be dropped.
            diff = abs(level_o - level_r)
            worst = diff if not np.isfinite(diff) or diff > worst else worst
            lowest_snr = min(lowest_snr, snr) if np.isfinite(snr) else -np.inf
            print(f'{names[source]:6} segment {i}: level {level_r:7.2f} dB, diff {level_o - level_r:+.4f} dB, SNR {snr:5.1f} dB')
    print(f'worst level difference {worst:.4f} dB (limit {LIMIT_DB})')
    print(f'lowest SNR {lowest_snr:.1f} dB (floor {SNR_FLOOR_DB})')
    sys.exit(0 if finite and worst <= LIMIT_DB and lowest_snr >= SNR_FLOOR_DB else 1)


if __name__ == '__main__':
    main()
