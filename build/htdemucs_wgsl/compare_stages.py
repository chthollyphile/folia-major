"""Compares the WGSL runtime's stages with the ONNX graph's, layer by layer.

build/htdemucs_wgsl/compare_stages.py

    python compare_stages.py REF_DIR OUT_DIR

REF_DIR: the segment through the ONNX graph, from reference.py (<name>.f32 per exposed tensor, plus
stems.f32). OUT_DIR: the same segment through dev/htdemucs-wgsl with HTW_STAGES=1 (stage_<name>.f32,
out.f32). Prints each stage's SNR against the reference; the runtime is channel-major and orders the
frequency branch's transformer tokens (f t) where the graph has (t f), and both are put back into
the graph's layout before comparing.
"""
import os
import sys

import numpy as np

L = 172032
FRAMES = 168


def main():
    ref_dir, out_dir = sys.argv[1:3]

    def load(path, shape):
        return np.fromfile(path, np.float32).astype(np.float64).reshape(shape)

    def report(name, mine, ref):
        err = np.sqrt(np.mean((mine - ref) ** 2))
        level = np.sqrt(np.mean(ref ** 2))
        snr = 20 * np.log10(level / max(err, 1e-30))
        print(f'{name:10s} SNR {snr:6.1f} dB   max |diff| {np.abs(mine - ref).max():.2e}   rms {level:.3g}')
        return snr

    def tokens_ft_to_tf(x):  # [512, (f t)] -> [512, (t f)]
        return x.reshape(512, 8, FRAMES).transpose(0, 2, 1).reshape(512, -1)

    worst = np.inf
    for name in sorted(os.listdir(out_dir)):
        if not name.startswith('stage_') or name == 'stage_out.f32':
            continue
        stage = name[len('stage_'):-len('.f32')]
        ref_path = os.path.join(ref_dir, f'{stage}.f32')
        if not os.path.exists(ref_path):
            continue
        mine = np.fromfile(os.path.join(out_dir, name), np.float32).astype(np.float64)
        ref = np.fromfile(ref_path, np.float32).astype(np.float64)
        if stage == 'tf_in':
            ref = ref.reshape(-1, 512).T.reshape(-1)
            mine = tokens_ft_to_tf(mine.reshape(512, -1)).reshape(-1)
        elif stage == 'tf_in_t':
            ref = ref.reshape(-1, 512).T.reshape(-1)
        elif stage.startswith('tf') and not stage.startswith('tft'):
            mine = tokens_ft_to_tf(mine.reshape(512, -1)).reshape(-1)
        worst = min(worst, report(stage, mine, ref[:mine.size]))
    stems = load(os.path.join(ref_dir, 'stems.f32'), (4, 2, L))
    out = load(os.path.join(out_dir, 'out.f32'), (2, L))
    source = int(os.environ.get('HTW_SOURCE', '0'))
    worst = min(worst, report('stem', out, stems[source]))
    level = lambda x: 10 * np.log10(np.mean(x ** 2))
    print(f'stem level {level(out):.4f} dB against {level(stems[source]):.4f} dB (diff {level(out) - level(stems[source]):+.4f})')
    print(f'worst {worst:.1f} dB')


if __name__ == '__main__':
    main()
