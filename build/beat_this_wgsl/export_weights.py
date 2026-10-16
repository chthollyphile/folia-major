"""Exports a Beat This! checkpoint into the flat f32 layout the WGSL runtime reads.

build/beat_this_wgsl/export_weights.py

    python export_weights.py CKPT OUT.bin [--f16]

Writes OUT.bin: the tensors (little-endian, every tensor 256-byte aligned), then their manifest as
JSON (name -> byte offset, shape, dtype, and for matmul weights the padded row stride), then the
trailer b'FOLIABTW' + uint64 LE offset of the JSON - one file, read by electron/analysis/
packedWeights.cjs for both the WebGPU runtime and the MNN CPU fallback. Everything that is a constant
transform of the weights happens here, once, so the kernels never redo it per chunk:

- BatchNorms folded: bn1d into a per-frequency scale/shift, every bn2d into its convolution, whose
  weights are stored [kf, 3, cin, cout] so the conv runs as a GEMM with K = (df, dt, ci).
- RMSNorm gammas (times sqrt(dim)) folded into the rows of the Linear that consumes the normalised
  input: normalize(x) * g @ W == (x @ (g[:, None] * W)) / ||x||, so the matmul only has to scale
  each output row by 1/||x||, which it gets from the sum of squares of the A rows it reads anyway.
- Linear weights transposed to [in, out], the layout the matmul kernel reads row by row.
- Each attention's gate projection appended to its QKV projection as H extra output columns, so one
  matmul produces q, k, v and the gate logits together (bias is zero for the QKV columns).
- The frontend's flatten is "b c f t -> b t (c f)"; the runtime flattens as (f c) instead, so the
  rows of frontend.linear are permuted to match.
- Matmul weights ([K, N]: qkvg, out, w1, w2, frontend.linear, head) have their rows zero-padded to
  a multiple of 4 columns (`stride`), so the matmul reads every column quad as one aligned load.

With --f16 the matmul weights are stored as fp16 (half the file); the matmul unpacks them and still
computes in f32. Everything else stays f32: the convolutions, every bias, the stem BatchNorm
(x * scale + shift cancels, so its rounding error is amplified ~15 dB) and rope.freqs (the angle is
position * freq up to position 1499, so fp16 alone takes the logits from ~124 dB to 51 dB).
Measured with fp16 matmul weights: logits ~85 dB against the f32 export, identical beat lists on
the seven test tracks. The rest of that gap is the model, not the format: one head of the last
layer scores ~18 on frames next to a beat, and its near one-hot softmax magnifies any rounding of
its input there by ~25 dB (the same frames are the worst ones for f32 against float64).
"""
import json
import math
import struct
import sys

import numpy as np
import torch

HEAD_DIM = 32
ALIGN = 256  # bytes - WebGPU's minStorageBufferOffsetAlignment
MATMUL_WEIGHT = ('.qkvg.w', '.out.w', '.w1', '.w2', 'frontend.linear.w', 'head.w')


def bn_affine(sd, prefix, eps=1e-5):
    scale = sd[f'{prefix}.weight'] / torch.sqrt(sd[f'{prefix}.running_var'] + eps)
    shift = sd[f'{prefix}.bias'] - sd[f'{prefix}.running_mean'] * scale
    return scale, shift


def main():
    ckpt_path, out_path = sys.argv[1:3]
    f16 = '--f16' in sys.argv[3:]
    ckpt = torch.load(ckpt_path, map_location='cpu', weights_only=True)
    sd = {k.removeprefix('model.'): v.double() for k, v in ckpt['state_dict'].items()}
    hp = ckpt['hyper_parameters']
    tensors = {}

    def put(name, value):
        tensors[name] = np.ascontiguousarray(value.numpy() if torch.is_tensor(value) else value, dtype=np.float32)

    def put_attention(prefix, out):
        dim = sd[f'{prefix}.norm.gamma'].shape[0]
        heads = dim // HEAD_DIM
        gamma = sd[f'{prefix}.norm.gamma'] * math.sqrt(dim)
        weight = torch.cat([sd[f'{prefix}.to_qkv.weight'], sd[f'{prefix}.to_gates.weight']], 0)  # [3D+H, D]
        put(f'{out}.qkvg.w', weight.T * gamma[:, None])
        put(f'{out}.qkvg.b', torch.cat([torch.zeros(3 * dim, dtype=torch.float64), sd[f'{prefix}.to_gates.bias']]))
        put(f'{out}.out.w', sd[f'{prefix}.to_out.0.weight'].T)
        assert heads == sd[f'{prefix}.to_gates.weight'].shape[0]

    def put_ff(prefix, out):
        dim = sd[f'{prefix}.net.0.gamma'].shape[0]
        gamma = sd[f'{prefix}.net.0.gamma'] * math.sqrt(dim)
        put(f'{out}.w1', sd[f'{prefix}.net.1.weight'].T * gamma[:, None])
        put(f'{out}.b1', sd[f'{prefix}.net.1.bias'])
        put(f'{out}.w2', sd[f'{prefix}.net.4.weight'].T)
        put(f'{out}.b2', sd[f'{prefix}.net.4.bias'])

    def put_conv(conv, bn, out):
        scale, shift = bn_affine(sd, bn)
        # [cout, cin, kf, 3] -> [kf, 3, cin, cout]: the [K, N] matrix of the conv as an implicit GEMM.
        put(f'{out}.w', (sd[f'{conv}.weight'] * scale[:, None, None, None]).permute(2, 3, 1, 0))
        put(f'{out}.b', shift)

    scale, shift = bn_affine(sd, 'frontend.stem.bn1d')
    put('stem.bn.scale', scale)
    put('stem.bn.shift', shift)
    put_conv('frontend.stem.conv2d', 'frontend.stem.bn2d', 'stem.conv')
    for i in range(3):
        p = f'frontend.blocks.{i}.partial'
        put_attention(f'{p}.attnF', f'block{i}.freq.attn')
        put_ff(f'{p}.ffF', f'block{i}.freq.ff')
        put_attention(f'{p}.attnT', f'block{i}.time.attn')
        put_ff(f'{p}.ffT', f'block{i}.time.ff')
        put_conv(f'frontend.blocks.{i}.conv2d', f'frontend.blocks.{i}.norm', f'block{i}.conv')

    # [512, (c f)] -> rows reordered to (f c), then transposed to [(f c), 512].
    linear = sd['frontend.linear.weight']
    channels = sd['frontend.blocks.2.norm.weight'].shape[0]
    freqs = linear.shape[1] // channels
    linear = linear.view(-1, channels, freqs).permute(0, 2, 1).reshape(linear.shape[0], -1)
    put('frontend.linear.w', linear.T)
    put('frontend.linear.b', sd['frontend.linear.bias'])
    for i in range(hp['n_layers']):
        put_attention(f'transformer_blocks.layers.{i}.0', f'layer{i}.attn')
        put_ff(f'transformer_blocks.layers.{i}.1', f'layer{i}.ff')
    final_gamma = sd['transformer_blocks.norm.gamma'] * math.sqrt(sd['transformer_blocks.norm.gamma'].shape[0])
    put('head.w', sd['task_heads.beat_downbeat_lin.weight'].T * final_gamma[:, None])
    put('head.b', sd['task_heads.beat_downbeat_lin.bias'])

    # One rotary table is shared by every attention in the model; check rather than assume.
    rope = [v for k, v in sd.items() if k.endswith('rotary_embed.freqs')]
    assert all(torch.equal(r, rope[0]) for r in rope), 'rotary freqs differ between layers'
    put('rope.freqs', rope[0])

    manifest = {'hyper_parameters': {k: hp[k] for k in ('spect_dim', 'transformer_dim', 'ff_mult', 'n_layers', 'stem_dim', 'head_dim')},
                'tensors': {}}
    offset = 0
    with open(out_path, 'wb') as out:
        for name, array in tensors.items():
            entry = {'byte_offset': offset, 'shape': list(array.shape), 'dtype': 'f32'}
            if name.endswith(MATMUL_WEIGHT):
                k, n = array.shape
                entry['stride'] = n + (-n % 4)
                array = np.pad(array, ((0, 0), (0, entry['stride'] - n)))
                if f16:
                    array = array.astype(np.float16)
                    entry['dtype'] = 'f16'
            manifest['tensors'][name] = entry
            out.write(array.tobytes())
            offset += array.nbytes
            pad = -offset % ALIGN
            out.write(bytes(pad))
            offset += pad
        manifest['bytes'] = offset
        # The manifest rides in the same file, after the tensors so their offsets stay file offsets.
        out.write(json.dumps(manifest, indent=1).encode('utf-8'))
        out.write(b'FOLIABTW' + struct.pack('<Q', offset))
    print(f'{len(tensors)} tensors, {offset / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
