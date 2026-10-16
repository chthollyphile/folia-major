"""Plain-PyTorch Beat This! forward pass, written out op by op as the WGSL port will run it.

build/beat_this_wgsl/reference.py

No dependency on the beat_this package or rotary_embedding_torch: every step the WGSL kernels take
(BN folding, interleaved RoPE, gated attention, RMSNorm as normalize * sqrt(dim) * gamma) is spelled
out here, so a mismatch between the two is a bug in one of them, not a library default nobody read.

    python reference.py CKPT CHUNKS.npy OUT_DIR [ORT_BEAT.npy ORT_DOWN.npy]

Writes OUT_DIR/<stage>.f32 (one file per stage, chunk-major) for layer-by-layer comparison, and, given
the ORT reference logits, prints the SNR of this implementation against them.
"""
import math
import os
import sys

import numpy as np
import torch
import torch.nn.functional as F

T = 1500  # frames per chunk; the contract in src/services/analysis/beatThis.ts
HEAD_DIM = 32


def load_state(path):
    ckpt = torch.load(path, map_location='cpu', weights_only=True)
    return {k.removeprefix('model.'): v.double() for k, v in ckpt['state_dict'].items()}


def bn_affine(sd, prefix, eps=1e-5):
    """BatchNorm in eval mode as y = x * scale + shift."""
    scale = sd[f'{prefix}.weight'] / torch.sqrt(sd[f'{prefix}.running_var'] + eps)
    shift = sd[f'{prefix}.bias'] - sd[f'{prefix}.running_mean'] * scale
    return scale, shift


def rms_norm(x, gamma):
    # F.normalize clamps the L2 norm at 1e-12, then the module rescales by sqrt(dim).
    return x / x.norm(dim=-1, keepdim=True).clamp_min(1e-12) * math.sqrt(x.shape[-1]) * gamma


def rope(x, freqs):
    """Interleaved rotary embedding over the sequence axis (-2): pairs (2i, 2i+1) share freqs[i]."""
    n = x.shape[-2]
    angles = torch.arange(n, dtype=x.dtype)[:, None] * freqs[None, :]  # [n, d/2]
    cos, sin = angles.cos(), angles.sin()
    x0, x1 = x[..., 0::2], x[..., 1::2]
    out = torch.empty_like(x)
    out[..., 0::2] = x0 * cos - x1 * sin
    out[..., 1::2] = x1 * cos + x0 * sin
    return out


def attention(x, sd, prefix):
    """x: [batch, n, dim] -> [batch, n, dim]; pre-norm, gated multi-head attention with RoPE."""
    b, n, dim = x.shape
    heads = dim // HEAD_DIM
    h = rms_norm(x, sd[f'{prefix}.norm.gamma'])
    qkv = h @ sd[f'{prefix}.to_qkv.weight'].T  # [b, n, 3*heads*d], laid out (qkv h d)
    qkv = qkv.view(b, n, 3, heads, HEAD_DIM).permute(2, 0, 3, 1, 4)  # [3, b, h, n, d]
    freqs = sd[f'{prefix}.rotary_embed.freqs']
    q, k, v = rope(qkv[0], freqs), rope(qkv[1], freqs), qkv[2]
    scores = (q @ k.transpose(-1, -2)) / math.sqrt(HEAD_DIM)
    out = scores.softmax(-1) @ v  # [b, h, n, d]
    gates = (h @ sd[f'{prefix}.to_gates.weight'].T + sd[f'{prefix}.to_gates.bias']).sigmoid()  # [b, n, h]
    out = out * gates.permute(0, 2, 1)[..., None]
    out = out.permute(0, 2, 1, 3).reshape(b, n, heads * HEAD_DIM)
    return out @ sd[f'{prefix}.to_out.0.weight'].T


def feed_forward(x, sd, prefix):
    h = rms_norm(x, sd[f'{prefix}.net.0.gamma'])
    h = F.gelu(h @ sd[f'{prefix}.net.1.weight'].T + sd[f'{prefix}.net.1.bias'])
    return h @ sd[f'{prefix}.net.4.weight'].T + sd[f'{prefix}.net.4.bias']


def conv_bn_gelu(x, sd, conv, bn, stride, kernel_f):
    """Conv2d (no bias) folded with its BatchNorm, then GELU. x: [1, c, f, t]."""
    scale, shift = bn_affine(sd, bn)
    weight = sd[f'{conv}.weight'] * scale[:, None, None, None]
    return F.gelu(F.conv2d(x, weight, shift, stride=(stride, 1), padding=(0, 1)))


def forward(sd, mel, stages):
    """mel: [T, 128] -> (beat, downbeat) logits [T]; appends intermediate tensors to `stages`."""
    s1, b1 = bn_affine(sd, 'frontend.stem.bn1d')
    x = (mel.T * s1[:, None] + b1[:, None])[None, None]  # [1, 1, 128, T]
    x = conv_bn_gelu(x, sd, 'frontend.stem.conv2d', 'frontend.stem.bn2d', 4, 4)  # [1, 32, 32, T]
    stages.append(('stem', x))
    for i in range(3):
        p = f'frontend.blocks.{i}.partial'
        c, f, t = x.shape[1:]
        y = x[0].permute(2, 1, 0)  # [t, f, c]: attention across frequencies
        y = y + attention(y, sd, f'{p}.attnF')
        y = y + feed_forward(y, sd, f'{p}.ffF')
        stages.append((f'block{i}_freq', y))
        y = y.permute(1, 0, 2)  # [f, t, c]: attention across time
        y = y + attention(y, sd, f'{p}.attnT')
        y = y + feed_forward(y, sd, f'{p}.ffT')
        stages.append((f'block{i}_time', y))
        x = y.permute(2, 0, 1)[None]  # [1, c, f, t]
        x = conv_bn_gelu(x, sd, f'frontend.blocks.{i}.conv2d', f'frontend.blocks.{i}.norm', 2, 2)
        stages.append((f'block{i}_conv', x))
    x = x[0].permute(2, 0, 1).reshape(t, -1)[None]  # [1, T, c*f], (c f) order
    x = x @ sd['frontend.linear.weight'].T + sd['frontend.linear.bias']
    stages.append(('frontend', x))
    for i in range(6):
        p = f'transformer_blocks.layers.{i}'
        x = x + attention(x, sd, f'{p}.0')
        x = x + feed_forward(x, sd, f'{p}.1')
        stages.append((f'layer{i}', x))
    x = rms_norm(x, sd['transformer_blocks.norm.gamma'])
    logits = x @ sd['task_heads.beat_downbeat_lin.weight'].T + sd['task_heads.beat_downbeat_lin.bias']
    beat, down = logits[0, :, 0] + logits[0, :, 1], logits[0, :, 1]
    stages.append(('logits', torch.stack([beat, down])))
    return beat, down


def main():
    ckpt, chunks_path, out_dir = sys.argv[1:4]
    sd = load_state(ckpt)
    chunks = np.load(chunks_path)
    os.makedirs(out_dir, exist_ok=True)
    per_stage = {}
    beats, downs = [], []
    with torch.no_grad():
        for chunk in chunks:
            stages = []
            beat, down = forward(sd, torch.from_numpy(chunk).double(), stages)
            beats.append(beat.numpy())
            downs.append(down.numpy())
            for name, tensor in stages:
                per_stage.setdefault(name, []).append(tensor.float().numpy().ravel())
    for name, parts in per_stage.items():
        np.concatenate(parts).astype(np.float32).tofile(os.path.join(out_dir, f'{name}.f32'))
    print('stages:', ', '.join(f'{n}{list(t.shape)}' for n, t in stages))
    if len(sys.argv) >= 6:
        ref_b, ref_d = np.load(sys.argv[4]), np.load(sys.argv[5])
        snr = lambda r, g: 10 * np.log10((r ** 2).sum() / ((r - g) ** 2).sum())
        print(f'vs ORT: beat {snr(ref_b, np.array(beats)):.1f} dB, downbeat {snr(ref_d, np.array(downs)):.1f} dB')


if __name__ == '__main__':
    main()
