"""Compares every stage the WGSL test shell dumped for chunk 0 against reference.py's dumps.

build/beat_this_wgsl/compare_stages.py

    python compare_stages.py REF_DIR RUN_DIR

REF_DIR is reference.py's OUT_DIR, RUN_DIR the shell's BTW_DIR run with BTW_STAGES=1. The reference
keeps PyTorch's layouts ([c, f, t] around convs, [t, f, c] after frequency attention); the runtime is
[f, t, c] throughout, so each stage is permuted before the SNR is taken.
"""
import os
import sys

import numpy as np
ref_dir, run_dir = sys.argv[1:3]
shapes = {'stem': (32, 32, 1500, 'cft')}
for i, (c, f) in enumerate([(32, 32), (64, 16), (128, 8)]):
    shapes[f'block{i}_freq'] = (1500, f, c, 'tfc')
    shapes[f'block{i}_time'] = (f, 1500, c, 'ftc')
    shapes[f'block{i}_conv'] = (2 * c, f // 2, 1500, 'cft')
# The transformer width is the checkpoint's (512 for final0, 128 for small0); read it off chunk 0's dump.
dim = os.path.getsize(os.path.join(run_dir, 'stage_frontend.f32')) // 4 // 1500
layers = sum(1 for f in os.listdir(ref_dir) if f.startswith('layer') and f.endswith('.f32'))
shapes['frontend'] = (1500, dim, 1, 'x'); shapes.update({f'layer{i}': (1500, dim, 1, 'x') for i in range(layers)}); shapes['logits'] = (2, 1500, 1, 'x')
snr = lambda r, g: 10 * np.log10((r ** 2).sum() / ((r - g) ** 2).sum())
for name, (a, b, c, lay) in shapes.items():
    n = a * b * c
    ref = np.fromfile(os.path.join(ref_dir, f'{name}.f32'), np.float32)[:n].reshape(a, b, c)
    if lay == 'cft': ref = ref.transpose(1, 2, 0)
    elif lay == 'tfc': ref = ref.transpose(1, 0, 2)
    got = np.fromfile(os.path.join(run_dir, f'stage_{name}.f32'), np.float32).reshape(ref.shape)
    print(f'{name:14s} SNR {snr(ref, got):6.1f} dB  max|diff| {np.abs(ref - got).max():.2e}  max|ref| {np.abs(ref).max():.2e}')
