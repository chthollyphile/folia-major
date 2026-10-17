"""Runs the chunks the WGSL test shell wrote through onnxruntime (CPU) on the shipped beat_this.onnx.

build/beat_this_wgsl/ort_chunks.py

    python ort_chunks.py MODELS/beat_this.onnx OUT_DIR name...

Reads OUT_DIR/<name>.chunks.f32 ([chunks, 1500, 128]) and writes OUT_DIR/<name>.ort.f32
([chunks, 2, 1500], beat then downbeat), the input of dev/beat-this-wgsl/compare-songs.ts. A chunk
shorter than 1500 frames (a track under 30 s; its length is in <name>.meta.json's chunkFrames) is
run at its own length, as the app runs it, and the rest of its rows is left zero.
"""
import json
import os
import sys

import numpy as np
import onnxruntime as ort

model, d = sys.argv[1:3]
s = ort.InferenceSession(model, providers=['CPUExecutionProvider'])
for name in sys.argv[3:]:
    x = np.fromfile(os.path.join(d, f'{name}.chunks.f32'), np.float32).reshape(-1, 1500, 128)
    with open(os.path.join(d, f'{name}.meta.json')) as f:
        frames = json.load(f).get('chunkFrames') or [1500] * len(x)
    out = np.zeros((len(x), 2, 1500), np.float32)
    for i, c in enumerate(x):
        n = frames[i]
        b, dn = s.run(None, {'input_spectrogram': c[None, :n]})
        out[i, 0, :n], out[i, 1, :n] = b[0], dn[0]
    out.tofile(os.path.join(d, f'{name}.ort.f32')); print(name, len(x), 'chunks')
