"""The acceptance gate for the WGSL htdemucs: the stem it returns against the ONNX graph's, per segment.

build/htdemucs_wgsl/red_line.py

    python red_line.py REF_DIR OUT_DIR [SOURCE]

REF_DIR/stems.f32 from reference.py ([n, 4, 2, 172032]), OUT_DIR/out.f32 from dev/htdemucs-wgsl
([n, 2, 172032], source SOURCE, default 0 = drums). The same gate make_model.py (removed) held the CPU
model to, and folia_htdemucs.cpp's red line too: per segment, the stem's level against the reference's within 0.01 dB. Also prints each
segment's SNR against the reference. Exit code 0 only when every segment passes.
"""
import sys

import numpy as np

L = 172032
LIMIT_DB = 0.01


def main():
    ref_dir, out_dir = sys.argv[1:3]
    source = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    ref = np.fromfile(f'{ref_dir}/stems.f32', np.float32).astype(np.float64).reshape(-1, 4, 2, L)[:, source]
    out = np.fromfile(f'{out_dir}/out.f32', np.float32).astype(np.float64).reshape(-1, 2, L)
    assert ref.shape == out.shape, (ref.shape, out.shape)
    worst = 0.0
    for i, (r, o) in enumerate(zip(ref, out)):
        level_r = 10 * np.log10(np.mean(r ** 2))
        level_o = 10 * np.log10(np.mean(o ** 2))
        snr = 10 * np.log10(np.mean(r ** 2) / max(np.mean((r - o) ** 2), 1e-30))
        worst = max(worst, abs(level_o - level_r))
        print(f'segment {i}: level {level_r:7.2f} dB, diff {level_o - level_r:+.4f} dB, SNR {snr:5.1f} dB')
    print(f'worst level difference {worst:.4f} dB (limit {LIMIT_DB})')
    sys.exit(0 if worst <= LIMIT_DB else 1)


if __name__ == '__main__':
    main()
