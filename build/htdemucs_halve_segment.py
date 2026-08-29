"""Rewrites htdemucs' ONNX graph for a half-length segment.

The exported graph has SEGMENT=343980 (7.8s @44100) welded into it: 230 integer shape
constants, three position-indexed float tables, the iSTFT's window-sum normaliser, the
STFT pad amount, and three "make it divisible" pads in the time encoder. Peak memory is
one segment's activations, so the segment length is the only lever left on the 787MB.

Run it with a python that has `onnx`, which the shipped runtime deliberately does not -
it only needs onnxruntime. The output is byte-identical run to run, so the manifest hash
is the check that a rebuild produced the file that was listened to:

    python build/htdemucs_halve_segment.py htdemucs-7.8s.onnx models/htdemucs.onnx

The half length is 172032 (3.902s), not 171990, because the chain has to stay integral:

    343980 -> 85995 -> 21499 -> 5375 -> 1344     three Pad(+1) needed to round up
    172032 -> 43008 -> 10752 -> 2688 ->  672     divides cleanly, the pads go to zero

    STFT: 343980 + 1536 + 1620 = 347136 -> (347136-4096)/1024+1 = 336 frames
          172032 + 1536 + 1536 = 175104 -> (175104-4096)/1024+1 = 168 frames

Left pad is always hop//2*3 = 1536; the right pad is that plus ceil(len/hop)*hop - len,
which is 84 for the original and 0 for a length that is already a multiple of the hop.

A wrong constant here does not crash, it produces garbage audio, so what cleared this was
a blind A/B on four rendered transitions, not the shape checker at the bottom.
"""
import sys
import numpy as np
import onnx
from onnx import numpy_helper

SRC, DST = sys.argv[1], sys.argv[2]

# old -> new, every integer constant in the graph that is a length along time. Substitution is
# simultaneous, so the pairs that swap into each other (5375 -> 2688 while 2688 -> 1344) are fine.
#
#   time chain      343980   85995   21499   5375   1344      the encoder/decoder lengths
#   tdecoder trims  343982   85997   21501   5377             Slice[2 : L+2] after each ConvTranspose
#   STFT lengths    345516 = L+1536, 347136 = L+1536+1620, then +2048/+4096 for the reflect pad
#   frames          336, and 338/340/341/342/343 for the istft fold                  (336 -> 168)
#   token counts    2688 = 8 freq bins x 336 frames, 680 = 2ch x 340, 2720 = 8 x 340
#
# 384/512/768/1024/1536/2048/2049/4096 are NOT here on purpose: channels, FFN width, qkv width,
# hop, nfft and the freq bin count do not scale with the segment.
SHAPES = {
    343980: 172032, 343982: 172034, 345516: 173568, 347136: 175104,
    349184: 177152, 351232: 179200,
     85995:  43008,  85997:  43010,
     21499:  10752,  21501:  10754,
      5375:   2688,   5377:   2690,
      2720:   1376,   2688:   1344,
      1344:    672,    680:    344,
       343:    175,    342:    174,    341:    173,    340:    172,
       338:    170,    336:    168,
}

# Position-indexed sinusoidal tables, folded to constants at export, one per Add that puts an
# embedding on a sequence. Slicing is the right operation on them: position k's vector is
# position k's vector whatever the sequence length.
#
# The flattened one is safe to cut at the front because its tokens are FRAME-MAJOR - measured,
# not assumed: every one of the twelve largest token-to-token jumps sits at i = 7 mod 8, so the
# eight frequency bins of a frame are contiguous and the boundary period is 8, not 336. Keeping
# the first 1344 therefore keeps 168 whole frames. Freq-major would have kept four bins of the
# whole window instead, which is not a thing that would have crashed.
TABLES = {
    '/Mul_5_output_0': 3,                          # [1, 48, 512, 336] frames axis
    '/crosstransformer/Reshape_4_output_0': 1,     # [1, 2688, 512]    168 frames x 8 bins
    '/crosstransformer/Transpose_7_output_0': 1,   # [1, 1344, 512]    time steps
}

# The iSTFT's window-sum normaliser, and the STFT hop it is built on.
WINDOW_SUM = '/real_istft/Cast_output_0'
HOP = 1024

PADS = {
    '/Pad': [0, 0, 1536, 0, 0, 1536],          # STFT: right pad 1620 -> 1536, see above
    '/tencoder.1/Pad': [0] * 6,                 # no longer needed: 43008 % 4 == 0
    '/tencoder.2/Pad': [0] * 6,
    '/tencoder.3/Pad': [0] * 6,
}

model = onnx.load(SRC)
graph = model.graph
by_name = {i.name: i for i in graph.initializer}
counts = {'shape': 0, 'table': 0, 'pad': 0}

# 1. every integer shape constant
for init in graph.initializer:
    if init.data_type != onnx.TensorProto.INT64:
        continue
    a = numpy_helper.to_array(init)
    if a.size == 0 or a.size > 64 or not (set(a.ravel().tolist()) & SHAPES.keys()):
        continue
    out = np.array([SHAPES.get(int(x), int(x)) for x in a.ravel()], dtype=np.int64).reshape(a.shape)
    init.CopyFrom(numpy_helper.from_array(out, init.name))
    counts['shape'] += 1

# 2. the two position tables, sliced on their own time axis
for name, axis in TABLES.items():
    init = by_name[name]
    a = numpy_helper.to_array(init)
    keep = SHAPES[a.shape[axis]]
    init.CopyFrom(numpy_helper.from_array(np.take(a, range(keep), axis=axis).copy(), name))
    counts['table'] += 1

# 3. the overlap-add normaliser: sum of squared analysis windows per output sample, and the one
# thing here that is not a slice. It ramps up over the first frames, sits at a constant 1.5 (four
# 75%-overlapping Hann windows are exactly COLA - measured: the middle has zero peak-to-peak),
# then ramps back down. Cutting the front off would keep the ramp up and lose the ramp down, so
# the shorter one is the original's head spliced onto the original's tail. Exact rather than
# approximate: the join is inside the constant middle, and both pieces sit on a whole number of
# hops, so there is no seam and no phase to get wrong.
init = by_name[WINDOW_SUM]
a = numpy_helper.to_array(init)
new_len = SHAPES[a.shape[0]]
head = 86 * HOP
spliced = np.concatenate([a[:head], a[a.shape[0] - (new_len - head):]])
assert spliced.shape[0] == new_len and np.ptp(spliced) == np.ptp(a)
init.CopyFrom(numpy_helper.from_array(spliced, WINDOW_SUM))

# 4. the pads that exist only to make a length divisible
for node in graph.node:
    if node.op_type != 'Pad' or node.name not in PADS or len(node.input) < 2:
        continue
    init = by_name[node.input[1]]
    init.CopyFrom(numpy_helper.from_array(np.array(PADS[node.name], dtype=np.int64), init.name))
    counts['pad'] += 1

# 5. the declared interface, and everything inferred from it
for io in list(graph.input) + list(graph.output):
    for dim in io.type.tensor_type.shape.dim:
        if dim.dim_value in SHAPES:
            dim.dim_value = SHAPES[dim.dim_value]
del graph.value_info[:]
model = onnx.shape_inference.infer_shapes(model, strict_mode=True)
onnx.checker.check_model(model)
onnx.save(model, DST)

assert counts['pad'] == len(PADS), f"only patched {counts['pad']} of {len(PADS)} pads"
print(f"{counts['shape']} shape constants, {counts['table']} position tables, {counts['pad']} pads")
print(f"-> {DST}")
