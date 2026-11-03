"""Exports htdemucs' weights from the published ONNX graph into the flat layout the WGSL runtime reads.

build/htdemucs_wgsl/export_weights.py

    python export_weights.py HTDEMUCS_ONNX OUT.bin [--f16]

HTDEMUCS_ONNX is the four-stem export earlier versions shipped (`htdemucs.onnx`, 108644650 bytes,
sha256 099b5be7...) - the same source build/htdemucs_mnn/make_model.py (removed) built the CPU model
from, and the CPU model now reads this export itself (native/folia-mnn/folia_htdemucs.cpp),
checked before anything else, so the GPU and CPU paths run one set of weights. No torch: the
weights are read straight off the graph's initializers, by the names of the nodes that consume them.

Writes OUT.bin in the packed format of build/beat_this_wgsl/export_weights.py - the tensors
(little-endian, every tensor 256-byte aligned), then their manifest as JSON, then b'FOLIABTW' + uint64
LE offset of the JSON - so electron/analysis/packedWeights.cjs reads it unchanged. The constant
transforms happen here, once:

- Every activation in the runtime is channel-major ([C, H, W]; the time branch is H = 1), so every
  weight is stored as the [rows = output channel, K] matrix of an implicit GEMM: convolutions keep
  ONNX's [Cout, Cin, kh, kw] order (already that matrix), Linear weights ([in, out] in the graph) are
  transposed.
- Each ConvTranspose (kernel 8, stride 4) is stored as four phase matrices: output o = 4q + ph takes
  input q - t through tap ph + 4t (t = 0, 1), so row (co, ph) and column (ci, t) hold
  W[ci, co, ph + 4t] - a plain GEMM over K = 2 Cin, with no zero taps.
- The attention's 1/sqrt(64) on q is folded into the q rows of the in-projection (and bias): a power
  of two, so exact.
- The constants the graph bakes in are exported as they are: the frequency embedding (already times
  0.2), both positional embeddings (the frequency one reordered from the graph's (t f) token order to
  the runtime's (f t)), the STFT and iSTFT windows and the iSTFT's window-sum normaliser.

With --f16, the tensors the graph itself stores as fp16 (every large weight: its `*_fp16` initializers,
cast to f32 before use) are written as fp16 - the same values, half the bytes; the runtime unpacks
them to f32 exactly as the graph's Cast does. Everything else stays f32.
"""
import hashlib
import json
import struct
import sys

import numpy as np
import onnx
from onnx import numpy_helper

SOURCE_BYTES = 108644650
SOURCE_SHA256 = '099b5be76c1f6922124d07f850250f39d1f33f254a0b8cc90f4ec0dfd0912329'
ALIGN = 256  # bytes - WebGPU's minStorageBufferOffsetAlignment
FRAMES = 168
FREQ_TOKENS = 8


def main():
    src, out_path = sys.argv[1:3]
    f16 = '--f16' in sys.argv[3:]
    data = open(src, 'rb').read()
    if len(data) != SOURCE_BYTES or hashlib.sha256(data).hexdigest() != SOURCE_SHA256:
        sys.exit(f'{src} is not the htdemucs.onnx this exporter is written for ({SOURCE_BYTES} bytes, sha256 {SOURCE_SHA256[:8]}...)')
    graph = onnx.load_from_string(data).graph

    inits = {t.name: t for t in graph.initializer}
    consts = {n.output[0]: n for n in graph.node if n.op_type == 'Constant'}
    casts = {n.output[0]: n.input[0] for n in graph.node if n.op_type == 'Cast'}
    nodes = {n.name: n for n in graph.node}

    def value(name):
        """(array, stored as fp16 in the graph) for a constant input, through a Cast if there is one."""
        half = False
        if name in casts:
            name = casts[name]
            half = True
        if name in inits:
            arr = numpy_helper.to_array(inits[name])
        elif name in consts:
            arr = numpy_helper.to_array(consts[name].attribute[0].t)
        else:
            raise KeyError(f'{name} is not a constant')
        return arr, half or arr.dtype == np.float16

    def arg(node, index):
        if node not in nodes:
            raise KeyError(f'no node {node}')
        return value(nodes[node].input[index])

    tensors = {}

    def put(name, arr, half=False):
        tensors[name] = (np.ascontiguousarray(arr, dtype=np.float32), half)

    def conv(node, out, transpose=False):
        (w, half), (b, _) = arg(node, 1), arg(node, 2)
        if transpose:
            # [cin, cout, 8(, 1)] -> rows (co, ph), columns (ci, t): W[ci, co, ph + 4t].
            w = w.reshape(w.shape[0], w.shape[1], 8)
            cin, cout = w.shape[:2]
            w = w.reshape(cin, cout, 2, 4).transpose(1, 3, 0, 2).reshape(cout * 4, cin * 2)
        else:
            w = w.reshape(w.shape[0], -1)
        put(f'{out}.w', w, half)
        put(f'{out}.b', b.reshape(-1))

    def gn(prefix, out):
        put(f'{out}.g', arg(f'{prefix}/Mul', 1)[0].reshape(-1))
        put(f'{out}.b', arg(f'{prefix}/Add', 1)[0].reshape(-1))

    def dconv(prefix, out):
        for j in range(2):
            p = f'{prefix}/dconv/layers.{j}/layers.{j}'
            conv(f'{p}.0/Conv', f'{out}.dc{j}.c1')
            gn(f'{p}.1', f'{out}.dc{j}.n1')
            conv(f'{p}.3/Conv', f'{out}.dc{j}.c2')
            gn(f'{p}.4', f'{out}.dc{j}.n2')
            put(f'{out}.dc{j}.ls', arg(f'{p}.6/Mul', 0)[0].reshape(-1))

    def gemm(node, out, scale_rows=0):
        (w, half), (b, _) = arg(node, 1), arg(node, 2)
        w = w.T.astype(np.float64)       # [in, out] -> [out, in]
        b = b.astype(np.float64)
        if scale_rows:
            w[:scale_rows] *= 0.125
            b[:scale_rows] *= 0.125
        put(f'{out}.w', w, half)
        put(f'{out}.b', b)

    def layer_norm(node, out):
        put(f'{out}.g', arg(node, 1)[0])
        put(f'{out}.b', arg(node, 2)[0])

    for i in range(4):
        conv(f'/tencoder.{i}/conv/Conv', f'tenc{i}.conv')
        dconv(f'/tencoder.{i}', f'tenc{i}')
        conv(f'/tencoder.{i}/rewrite/Conv', f'tenc{i}.rw')
        conv(f'/encoder.{i}/conv/Conv', f'enc{i}.conv')
        dconv(f'/encoder.{i}', f'enc{i}')
        conv(f'/encoder.{i}/rewrite/Conv', f'enc{i}.rw')

    emb = value('/Mul_5_output_0')[0][0]                      # [48, 512, 168], constant along time
    assert np.array_equal(emb, np.repeat(emb[:, :, :1], emb.shape[2], axis=2)), 'frequency embedding varies along time'
    put('freq_emb', emb[:, :, 0])

    conv('/channel_upsampler/Conv', 'up')
    conv('/channel_upsampler_t/Conv', 'up_t')
    conv('/channel_downsampler/Conv', 'down')
    conv('/channel_downsampler_t/Conv', 'down_t')
    ct = '/crosstransformer'
    layer_norm(f'{ct}/norm_in/LayerNormalization', 'norm_in')
    layer_norm(f'{ct}/norm_in_t/LayerNormalization', 'norm_in_t')
    pos = value(f'{ct}/Reshape_4_output_0')[0][0]               # [(t f), 512]
    pos = pos.reshape(FRAMES, FREQ_TOKENS, -1).transpose(2, 1, 0).reshape(pos.shape[1], -1)
    put('pos', pos)                                             # [512, (f t)]
    put('pos_t', value(f'{ct}/Transpose_7_output_0')[0][0].T)   # [512, t]

    for layer in range(5):
        for branch, out in (('layers', f'tf{layer}'), ('layers_t', f'tft{layer}')):
            p = f'{ct}/{branch}.{layer}'
            layer_norm(f'{p}/norm1/LayerNormalization', f'{out}.n1')
            if layer % 2 == 0:
                gemm(f'{p}/self_attn/MatMul/MatMulAddFusion', f'{out}.qkv', scale_rows=512)
                gemm(f'{p}/self_attn/out_proj/MatMul/MatMulAddFusion', f'{out}.out')
                layer_norm(f'{p}/norm2/LayerNormalization', f'{out}.nf')
            else:
                gemm(f'{p}/cross_attn/MatMul/MatMulAddFusion', f'{out}.q', scale_rows=512)
                k_w, k_half = arg(f'{p}/cross_attn/MatMul_1/MatMulAddFusion', 1)
                v_w, _ = arg(f'{p}/cross_attn/MatMul_2/MatMulAddFusion', 1)
                k_b = arg(f'{p}/cross_attn/MatMul_1/MatMulAddFusion', 2)[0]
                v_b = arg(f'{p}/cross_attn/MatMul_2/MatMulAddFusion', 2)[0]
                put(f'{out}.kv.w', np.concatenate([k_w.T, v_w.T], 0), k_half)
                put(f'{out}.kv.b', np.concatenate([k_b, v_b]))
                gemm(f'{p}/cross_attn/out_proj/MatMul/MatMulAddFusion', f'{out}.out')
                layer_norm(f'{p}/norm2/LayerNormalization', f'{out}.nkv')
                layer_norm(f'{p}/norm3/LayerNormalization', f'{out}.nf')
            put(f'{out}.g1', arg(f'{p}/gamma_1/Mul', 0)[0].reshape(-1))
            gemm(f'{p}/linear1/MatMul/MatMulAddFusion', f'{out}.ff1')
            gemm(f'{p}/linear2/MatMul/MatMulAddFusion', f'{out}.ff2')
            put(f'{out}.g2', arg(f'{p}/gamma_2/Mul', 0)[0].reshape(-1))
            gn(f'{p}/norm_out', f'{out}.no')

    for i in range(4):
        conv(f'/decoder.{i}/rewrite/Conv', f'dec{i}.rw')
        dconv(f'/decoder.{i}', f'dec{i}')
        conv(f'/decoder.{i}/conv_tr/ConvTranspose', f'dec{i}.tr', transpose=True)
        conv(f'/tdecoder.{i}/rewrite/Conv', f'tdec{i}.rw')
        dconv(f'/tdecoder.{i}', f'tdec{i}')
        conv(f'/tdecoder.{i}/conv_tr/ConvTranspose', f'tdec{i}.tr', transpose=True)

    put('stft.window', value('/dft_stft/window')[0].reshape(-1))
    put('istft.window', value('/dft_istft/window_n')[0].reshape(-1))
    put('istft.env', value('/real_istft/Cast_output_0')[0].reshape(-1))

    manifest = {'model': 'htdemucs', 'segment': 172032, 'tensors': {}}
    offset = 0
    halves = 0
    with open(out_path, 'wb') as out:
        for name, (array, half) in tensors.items():
            entry = {'byte_offset': offset, 'shape': list(array.shape), 'dtype': 'f32'}
            if f16 and half:
                assert array.size % 2 == 0, name
                array = array.astype(np.float16)
                entry['dtype'] = 'f16'
                halves += 1
            manifest['tensors'][name] = entry
            out.write(array.tobytes())
            offset += array.nbytes
            pad = -offset % ALIGN
            out.write(bytes(pad))
            offset += pad
        manifest['bytes'] = offset
        out.write(json.dumps(manifest, indent=1).encode('utf-8'))
        out.write(b'FOLIABTW' + struct.pack('<Q', offset))
    print(f'{len(tensors)} tensors ({halves} fp16), {offset / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
