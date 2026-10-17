"""Builds htdemucs-v3.mnn, the separation model worker.cjs runs, from the published htdemucs.onnx.

build/htdemucs_mnn/make_model.py

    python make_model.py HTDEMUCS_ONNX OUT.mnn --mnnconvert PATH/TO/MNNConvert

HTDEMUCS_ONNX is the four-stem export the app shipped before this one - `htdemucs.onnx`, 108644650
bytes, sha256 099b5be7..., still on the mirrors (shared/modelManifest.json's git history). Checked
before anything else. MNNConvert must be the one built from the same MNN source as the app's library
(build/buildMnnRuntime.mjs pins it; build it with -DMNN_BUILD_CONVERTER=ON) - not the pip wheel,
which is a binary from a third party run over our weights.

Four rewrites of the ONNX graph, then the conversion:

1. mm - the STFT's and iSTFT's DFT operators become two-stage 64x64 Cooley-Tukey matrix products, and
   the four global ReduceMeans over a million values become three-level means. MNN has no DFT, and a
   one-level mean over 1.3M floats loses precision a three-level one does not.
2. fuse - each GroupNorm(1 group) chain followed by GELU, or by GLU + LayerScale + residual, becomes
   one Folia::FoliaGNAct / Folia::FoliaGNGLU node. Every constant is checked; a chain that does not
   match exactly is left as it is.
3. deconv - ConvTranspose(kernel 8, stride 4) becomes a polyphase stride-1 Conv plus an interleave:
   the same products and sums, on MNN's fast convolution instead of its slow deconvolution.
4. dconv - each DConv layer (Conv k3 -> GN+GELU -> Conv 1x1 -> GN+GLU + residual) becomes one
   Folia::FoliaDConv, the operator native/folia-mnn/folia_dconv.cpp implements. 32 of them; the
   stages 2 leaves behind are all consumed here.

Then MNNConvert with --allowCustomOp, the FoliaDConv nodes rewritten from MNN's "Extra" to "Plugin"
op type in the JSON form of the graph (the converter emits Extra; the runtime only dispatches Plugin
to a registered kernel), weights saved externally (--saveExternalData, so MNN does not keep a second
resident copy: 415 -> 214MB loaded), and the result packed into one file:

    [weights][graph]["FOLIAMNN"][uint64 LE: byte offset of the graph]

The weights come first so the offsets the graph records into its external file are offsets into
this one; native/folia-mnn/folia_mnn.cpp reads the trailer, loads the graph from memory and points
MNN's external file at the same path.

The red line, which every change to this file or to the operator must pass: separation of six 30 s
excerpts against the shipped Python + onnxruntime path, per stem, worst SNR-derived level difference
within 0.01 dB (measured: drums 0.003, bass 0.002, vocals 0.0 on arm64; 0.003 / 0.001 / 0.0 on x86-64
for both the SSE2 and AVX2 kernels). Run on fp32 throughout - folia_mnn_load with precision 'high'.
"""
import argparse
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
import uuid

import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto

SOURCE_BYTES = 108644650
SOURCE_SHA256 = '099b5be76c1f6922124d07f850250f39d1f33f254a0b8cc90f4ec0dfd0912329'
N, N1, N2 = 4096, 64, 64


def stage_mm(m):
    """1. DFTs as matrix products, global means in three levels. See the module docstring."""
    g = m.graph
    inits = []
    nodes_out = []

    def const(name, arr):
        inits.append(numpy_helper.from_array(np.ascontiguousarray(arr), name))
        return name

    def node(op, ins, outs, **attrs):
        nodes_out.append(helper.make_node(op, ins, outs, **attrs))
        return outs[0] if len(outs) == 1 else outs

    n1 = np.arange(N1); k1 = np.arange(N1); n2 = np.arange(N2); k2 = np.arange(N2)
    C1 = np.cos(2 * np.pi * np.outer(k1, n1) / N1); S1 = -np.sin(2 * np.pi * np.outer(k1, n1) / N1)     # [k1, n1]
    TW = np.outer(k1, n2) * 2 * np.pi / N
    Tr = np.cos(TW).reshape(1, N1, 1, N2); Ti = -np.sin(TW).reshape(1, N1, 1, N2)                         # [1, k1, 1, n2]
    C2 = np.cos(2 * np.pi * np.outer(n2, k2) / N2); S2 = -np.sin(2 * np.pi * np.outer(n2, k2) / N2)     # [n2, k2]
    H = 33   # onesided: k = k1 + 64*k2 <= 2048 needs k2 < 33; the inverse's zero half needs n1 < 33
    f32 = lambda x: np.asarray(x, np.float32)
    # Every stage is ONE 2-D GEMM, real and imaginary parts stacked into a block matrix, frames folded
    # into the GEMM's other dimension - the shape engines run on their convolution kernels.
    const('mm/M1f', f32(np.vstack([C1, S1])))                                                # [128, 64]   real in
    const('mm/M1i', f32(np.block([[C1[:, :H], -S1[:, :H]], [S1[:, :H], C1[:, :H]]])))      # [128, 66]   complex in, zero half cut
    const('mm/M3f', f32(np.block([[C2[:, :H], S2[:, :H]], [-S2[:, :H], C2[:, :H]]])))      # [128, 66]   complex out, onesided
    const('mm/M3i', f32(np.vstack([C2, -S2])))                                               # [128, 64]   real part only
    const('mm/Tr', f32(Tr)); const('mm/Ti', f32(Ti))
    # inverse: x = Re(DFT(conj(Y))) / N with Y the onesided spectrum, interior bins doubled, zero above
    # Nyquist. That IS the Hermitian extension's real part, with no gather; the imaginary parts of DC and
    # Nyquist drop out on their own.
    c = np.full(2049, 2.0); c[0] = c[2048] = 1.0
    const('mm/conjc', f32(np.stack([c, -c], -1)[None]))                                     # [1, 2049, 2]
    I = lambda name, v: const(name, np.array(v, np.int64))
    I('mm/s_f', [-1, N1, N2]); I('mm/s_2d64', [N1, -1]); I('mm/s_A', [2, N1, -1, N2]); I('mm/s_B', [-1, 2 * N2])
    I('mm/s_fo', [N1, -1, 2, H]); I('mm/s_fflat', [-1, H * N1, 2]); I('mm/s_i', [-1, H, N2, 2]); I('mm/s_2d66', [2 * H, -1])
    I('mm/s_io', [N1, -1, N2]); I('mm/s_iflat', [-1, N]); I('mm/pad_i', [0, 0, 0, 0, H * N1 - 2049, 0])
    I('mm/z0', [0]); I('mm/z1', [1]); I('mm/z2', [2]); I('mm/z2049', [2049])
    const('mm/invN', np.array(1.0 / N, np.float32))

    def twiddle(pfx, A):
        """A [2, k1, F, n2] (re, im) -> [k1*F, 2*n2] = [Br | Bi], the next GEMM's input."""
        ar = node('Slice', [A, 'mm/z0', 'mm/z1', 'mm/z0'], [pfx + 'ar']); ai = node('Slice', [A, 'mm/z1', 'mm/z2', 'mm/z0'], [pfx + 'ai'])
        b1 = node('Mul', [ar, 'mm/Tr'], [pfx + 'b1']); b2 = node('Mul', [ai, 'mm/Ti'], [pfx + 'b2'])
        b3 = node('Mul', [ar, 'mm/Ti'], [pfx + 'b3']); b4 = node('Mul', [ai, 'mm/Tr'], [pfx + 'b4'])
        br = node('Sub', [b1, b2], [pfx + 'br']); bi = node('Add', [b3, b4], [pfx + 'bi'])
        cat = node('Concat', [br, bi], [pfx + 'bcat'], axis=3)
        return node('Reshape', [cat, 'mm/s_B'], [pfx + 'b2d'])

    def conv1x1(pfx, x2d, weight_name, in_ch):
        """[in_ch, P] -> [out_ch, P] as a 1x1 Conv1d, so the engine runs it on its convolution kernel
        (a constant LEFT operand of MatMul is the engine's slow path)."""
        x3 = node('Reshape', [x2d, const(pfx + 'cin', np.array([1, in_ch, -1], np.int64))], [pfx + 'cin3'])
        y3 = node('Conv', [x3, weight_name], [pfx + 'cout3'], kernel_shape=[1])
        return node('Reshape', [y3, const(pfx + 'cout', np.array([2 * N1, -1], np.int64))], [pfx + 'A2d'])

    const('mm/W1f', f32(np.vstack([C1, S1]))[:, :, None])                                       # [128, 64, 1]
    const('mm/W1i', f32(np.block([[C1[:, :H], -S1[:, :H]], [S1[:, :H], C1[:, :H]]]))[:, :, None])  # [128, 66, 1]
    c_k = np.full(2049, 2.0); c_k[0] = c_k[2048] = 1.0
    const('mm/cr', f32(c_k).reshape(1, 2049, 1)); const('mm/ci', f32(-c_k).reshape(1, 2049, 1))
    I('mm/pad_ri', [0, 0, 0, 0, H * N1 - 2049, 0]); I('mm/s_ri', [-1, H, N2]); I('mm/s_n1F', [H, -1])

    def rfft_sub(inp, out):
        """real [F, 4096, 1] -> [F, 2049, 2], numpy rfft semantics. n = 64*n1 + n2, k = k1 + 64*k2."""
        x = node('Reshape', [inp, 'mm/s_f'], ['mm/f/x'])                                  # [F, n1, n2]
        x = node('Transpose', [x], ['mm/f/xT'], perm=[1, 0, 2])                            # [n1, F, n2]  (64-element runs)
        x = node('Reshape', [x, 'mm/s_2d64'], ['mm/f/x2d'])                                # [64, F*64]
        A = conv1x1('mm/f/', x, 'mm/W1f', N1)                                              # [128, F*64]
        A = node('Reshape', [A, 'mm/s_A'], ['mm/f/A4'])                                    # [2, k1, F, n2]
        X = node('MatMul', [twiddle('mm/f/', A), 'mm/M3f'], ['mm/f/X'])                    # [k1*F, 66]
        X = node('Reshape', [X, 'mm/s_fo'], ['mm/f/X4'])                                   # [k1, F, 2, k2]
        X = node('Transpose', [X], ['mm/f/XT'], perm=[1, 3, 0, 2])                         # [F, k2, k1, 2]
        X = node('Reshape', [X, 'mm/s_fflat'], ['mm/f/Xf'])                                # [F, 2112, 2]
        node('Slice', [X, 'mm/z0', 'mm/z2049', 'mm/z1'], [out])

    def irfft_sub(re_in, im_in, out):
        """re, im [F, 2049, 1] (kept apart: interleaved re/im would need a 2-wide transpose) -> real [F, 4096, 1].
        x = Re(DFT(conj(Y))) / N, Y the onesided spectrum with interior bins doubled, zero above Nyquist."""
        parts = []
        for tag, src, coef in (('r', re_in, 'mm/cr'), ('i', im_in, 'mm/ci')):
            z = node('Mul', [src, coef], [f'mm/i/z{tag}'])                                  # doubled (and conjugated)
            z = node('Pad', [z, 'mm/pad_ri'], [f'mm/i/z{tag}p'])                            # [F, 2112, 1]
            z = node('Reshape', [z, 'mm/s_ri'], [f'mm/i/z{tag}3'])                          # [F, n1(33), n2]
            z = node('Transpose', [z], [f'mm/i/z{tag}T'], perm=[1, 0, 2])                   # [n1, F, n2]  (64-element runs)
            parts.append(node('Reshape', [z, 'mm/s_n1F'], [f'mm/i/z{tag}2d']))             # [33, F*64]
        z = node('Concat', parts, ['mm/i/z2d'], axis=0)                                    # [66, F*64]
        A = conv1x1('mm/i/', z, 'mm/W1i', 2 * H)                                           # [128, F*64]
        A = node('Reshape', [A, 'mm/s_A'], ['mm/i/A4'])                                    # [2, k1, F, n2]
        X = node('MatMul', [twiddle('mm/i/', A), 'mm/M3i'], ['mm/i/X'])                    # [k1*F, 64] real part
        X = node('Reshape', [X, 'mm/s_io'], ['mm/i/X3'])                                   # [k1, F, k2]
        X = node('Transpose', [X], ['mm/i/XT'], perm=[1, 2, 0])                            # [F, k2, k1]
        X = node('Reshape', [X, 'mm/s_iflat'], ['mm/i/Xf'])                                # [F, 4096]
        X = node('Mul', [X, 'mm/invN'], ['mm/i/scaled'])
        node('Unsqueeze', [X, 'mm/z2'], [out])

    def mean3(pfx, inp, out, groups, keep_shape):
        """global mean as three 64-wide-or-less levels, then reshaped to the original keepdims shape."""
        a = node('Reshape', [inp, const(pfx + 'sh', np.array([groups, 64, 64], np.int64))], [pfx + 'r'])
        a = node('ReduceMean', [a], [pfx + 'm1'], axes=[2], keepdims=0)
        a = node('ReduceMean', [a], [pfx + 'm2'], axes=[1], keepdims=0)
        a = node('ReduceMean', [a], [pfx + 'm3'], axes=[0], keepdims=0)
        node('Reshape', [a, const(pfx + 'out', np.array(keep_shape, np.int64))], [out])

    REPL = {
        '/dft_stft/DFT_9': lambda n: rfft_sub(n.input[0], n.output[0]),
        '/dft_istft/DFT_6': lambda n: irfft_sub(*[i for i in next(x for x in g.node if x.output[0] == n.input[0]).input], n.output[0]),
        '/dft_istft/Concat_5': lambda n: None,   # its two inputs go straight to irfft_sub
        '/ReduceMean_3': lambda n: mean3('mm/rm3/', n.input[0], n.output[0], 84, [1, 1, 1]),
        '/ReduceMean_5': lambda n: mean3('mm/rm5/', n.input[0], n.output[0], 84, [1, 1, 1]),
        '/ReduceMean_1': lambda n: mean3('mm/rm1/', n.input[0], n.output[0], 336, [1, 1, 1, 1]),
        '/ReduceMean_2': lambda n: mean3('mm/rm2/', n.input[0], n.output[0], 336, [1, 1, 1, 1]),
    }
    init_val = {t.name: numpy_helper.to_array(t) for t in g.initializer}
    def unbias(mul_name, div_name, tag):
        def mul(n):
            r = float(init_val[n.input[1]]) / float(init_val[next(x for x in g.node if x.name == div_name).input[1]])
            node('Mul', [n.input[0], const(f'mm/unbias_{tag}', np.array(r, np.float32))], [n.output[0]])
        def div(n):
            node('Identity', [n.input[0]], [n.output[0]])
        REPL[mul_name] = mul; REPL[div_name] = div
    unbias('/Mul_4', '/Div_2', 't'); unbias('/Mul_2', '/Div', 'f')
    new_nodes = []
    for n in g.node:
        if n.name in REPL:
            nodes_out.clear()
            REPL[n.name](n)
            new_nodes.extend(nodes_out)
        else:
            new_nodes.append(n)
    del g.node[:]
    g.node.extend(new_nodes)
    g.initializer.extend(inits)
    del g.value_info[:]
    m = onnx.shape_inference.infer_shapes(m, strict_mode=True)
    onnx.checker.check_model(m)
    return m


def stage_fuse(m):
    """2. GroupNorm chains into FoliaGNAct / FoliaGNGLU."""
    g = m.graph
    init = {t.name: t for t in g.initializer}
    val = lambda name: numpy_helper.to_array(init[name]) if name in init else None
    prod = {o: n for n in g.node for o in n.output}
    cons = {}
    for n in g.node:
        for i in n.input:
            cons.setdefault(i, []).append(n)

    def only(t, op):
        c = cons.get(t, [])
        return c[0] if len(c) == 1 and c[0].op_type == op else None

    def const_input(n):
        """(constant array, other input name) for a binary op with exactly one constant input."""
        a, b = n.input
        if a in init and b not in init: return val(a), b
        if b in init and a not in init: return val(b), a
        return None, None

    def scalar_is(arr, v, tol=1e-6):
        return arr is not None and arr.size == 1 and abs(float(arr.ravel()[0]) - v) < tol

    remove, replace, new_inits = set(), {}, []
    counts = {'act': 0, 'glu': 0, 'skipped': 0}
    for nd in list(g.node):
        if nd.op_type != 'InstanceNormalization':
            continue
        try:
            r0 = prod[nd.input[0]]; assert r0.op_type == 'Reshape'
            x = r0.input[0]
            sc, bi = val(nd.input[1]), val(nd.input[2])
            assert sc is not None and bi is not None and np.all(sc == 1) and np.all(bi == 0)
            eps = next((a.f for a in nd.attribute if a.name == 'epsilon'), 1e-5)
            r1 = only(nd.output[0], 'Reshape'); assert r1
            mg = only(r1.output[0], 'Mul'); assert mg
            gamma, _ = const_input(mg); assert gamma is not None
            ab = only(mg.output[0], 'Add'); assert ab
            beta, _ = const_input(ab); assert beta is not None
            C = gamma.size; assert beta.size == C
            region = [r0, nd, r1, mg, ab]
            users = cons.get(ab.output[0], [])
            kinds = sorted(u.op_type for u in users)
            if kinds == ['Div', 'Mul']:                                   # GELU: x*0.5*(1+erf(x/sqrt2))
                dv = next(u for u in users if u.op_type == 'Div'); mx = next(u for u in users if u.op_type == 'Mul')
                k, _ = const_input(dv); assert scalar_is(k, np.sqrt(2.0), 1e-5) and dv.input[0] == ab.output[0]
                er = only(dv.output[0], 'Erf'); assert er
                ad = only(er.output[0], 'Add'); k, _ = const_input(ad); assert scalar_is(k, 1.0)
                assert only(ad.output[0], 'Mul') is mx
                m2 = only(mx.output[0], 'Mul'); k, _ = const_input(m2); assert scalar_is(k, 0.5)
                region += [dv, er, ad, mx, m2]
                out = m2.output[0]
                P = nd.name.rsplit('/', 1)[0] + '/folia'
                names = [x, P + '/gamma', P + '/beta']
                new_inits += [numpy_helper.from_array(gamma.reshape(C).astype(np.float32), names[1]),
                              numpy_helper.from_array(beta.reshape(C).astype(np.float32), names[2])]
                fused = helper.make_node('FoliaGNAct', names, [out], domain='Folia', name=P, epsilon=float(eps), act=1)
                counts['act'] += 1
            elif kinds == ['Split']:                                      # GLU -> LayerScale -> residual
                sp = users[0]
                assert next(a.i for a in sp.attribute if a.name == 'axis') == 1 and len(sp.output) == 2
                sg = only(sp.output[1], 'Sigmoid'); assert sg
                mu = only(sg.output[0], 'Mul'); assert mu and sp.output[0] in mu.input
                assert cons.get(sp.output[0], []) == [mu]
                ls = only(mu.output[0], 'Mul'); scale, _ = const_input(ls); assert scale is not None and scale.size == C // 2
                ra = only(ls.output[0], 'Add'); assert ra
                res = ra.input[0] if ra.input[1] == ls.output[0] else ra.input[1]
                region += [sp, sg, mu, ls, ra]
                out = ra.output[0]
                P = nd.name.rsplit('/', 1)[0] + '/folia'
                names = [x, P + '/gamma', P + '/beta', P + '/scale', res]
                new_inits += [numpy_helper.from_array(gamma.reshape(C).astype(np.float32), names[1]),
                              numpy_helper.from_array(beta.reshape(C).astype(np.float32), names[2]),
                              numpy_helper.from_array(scale.reshape(C // 2).astype(np.float32), names[3])]
                fused = helper.make_node('FoliaGNGLU', names, [out], domain='Folia', name=P, epsilon=float(eps))
                counts['glu'] += 1
            else:
                raise AssertionError(f'followed by {kinds}')
            for r in region:
                remove.add(r.name)
            replace[region[-1].name] = fused
        except AssertionError as e:
            counts['skipped'] += 1
            print('skip', nd.name, e)

    out_nodes = []
    for n in g.node:
        if n.name in replace:
            out_nodes.append(replace[n.name])
        elif n.name not in remove:
            out_nodes.append(n)
    del g.node[:]
    g.node.extend(out_nodes)
    g.initializer.extend(new_inits)
    m.opset_import.append(helper.make_opsetid('Folia', 1))
    return m


def stage_deconv(m):
    """3. ConvTranspose(8, stride 4) as a polyphase Conv.

    MNN's Deconvolution multiplies 16 columns at a time (re-reading the whole weight per tile), keeps a
    full private output per thread that it memsets and then sums, and scatters with a per-element
    div/mod col2im: 0.2-0.65 TMAC/s on an M4 where its dense Conv runs 1.5. Along the strided axis
        out[4q + r] = W[..r]^T x[q] + W[..r+4]^T x[q-1],   q in [0, L],  x[-1] = x[L] = 0
    so the op is a stride-1 Conv with kernel 2 and padding 1 producing 4*Cout channels (phase-major),
    then an interleave Reshape/Transpose/Reshape back to [Cout, 4(L+1)]. Exact up to rounding. The
    Slice that trims the output afterwards is left as it is.
    """
    g = m.graph
    init = {t.name: t for t in g.initializer}
    prod = {o: n for n in g.node for o in n.output}


    def attrs(n):
        return {a.name: helper.get_attribute_value(a) for a in n.attribute}


    def const_of(name):
        """(array, was_fp16_cast) for an initializer, possibly behind a Cast to float."""
        if name in init:
            return numpy_helper.to_array(init[name]), False
        c = prod[name]
        assert c.op_type == 'Cast' and c.input[0] in init, name
        return numpy_helper.to_array(init[c.input[0]]), True


    new_nodes, new_inits, n_rw = [], [], 0
    for n in g.node:
        if n.op_type != 'ConvTranspose':
            new_nodes.append(n)
            continue
        a = attrs(n)
        ks, st = list(a['kernel_shape']), list(a['strides'])
        assert a.get('group', 1) == 1 and set(a.get('dilations', [1])) == {1}, n.name
        assert set(a.get('pads', [0])) == {0} and not a.get('output_padding'), n.name
        assert ks[0] == 8 and st[0] == 4 and all(k == 1 for k in ks[1:]) and all(s == 1 for s in st[1:]), (n.name, ks, st)
        W, half = const_of(n.input[1])  # [Cin, Cout, 8, (1)]
        cin, cout = W.shape[:2]
        Wc = np.empty((4, cout, cin, 2) + W.shape[3:], W.dtype)  # phase-major output channels
        for r in range(4):
            Wc[r, :, :, 0] = W[:, :, r + 4].swapaxes(0, 1)  # tap on x[q-1]
            Wc[r, :, :, 1] = W[:, :, r].swapaxes(0, 1)      # tap on x[q]
        Wc = Wc.reshape((4 * cout, cin, 2) + W.shape[3:])
        P = n.name.rsplit('/', 1)[0] + '/poly'
        wname = P + '/W'
        new_inits.append(numpy_helper.from_array(Wc, wname + ('_h' if half else '')))
        if half:
            new_nodes.append(helper.make_node('Cast', [wname + '_h'], [wname], to=TensorProto.FLOAT, name=wname + '_cast'))
        ins = [n.input[0], wname]
        if len(n.input) > 2 and n.input[2]:
            b, bhalf = const_of(n.input[2])
            bname = P + '/B'
            new_inits.append(numpy_helper.from_array(np.tile(b, 4), bname + ('_h' if bhalf else '')))
            if bhalf:
                new_nodes.append(helper.make_node('Cast', [bname + '_h'], [bname], to=TensorProto.FLOAT, name=bname + '_cast'))
            ins.append(bname)
        nd = len(ks)  # spatial dims: 1 (time branch) or 2 (freq branch, kernel (8,1))
        pads = [1] + [0] * (nd - 1)
        conv = P + '/conv'
        new_nodes.append(helper.make_node('Conv', ins, [conv], name=conv, kernel_shape=[2] + [1] * (nd - 1),
                                          pads=pads + pads, strides=[1] * nd, dilations=[1] * nd))
        # batch is 1 here: [1, 4*Cout, L+1, (T)] -> [4, Cout, L+1, (T)] -> [Cout, L+1, 4, (T)] -> [1, Cout, 4(L+1), (T)]
        s5 = P + '/s5'
        new_inits.append(numpy_helper.from_array(np.array([4, cout] + [0] * nd, np.int64), s5))
        new_nodes.append(helper.make_node('Reshape', [conv, s5], [P + '/r5'], name=P + '/r5'))
        perm = [1, 2, 0] + list(range(3, 2 + nd))
        new_nodes.append(helper.make_node('Transpose', [P + '/r5'], [P + '/t5'], name=P + '/t5', perm=perm))
        s4 = P + '/s4'
        new_inits.append(numpy_helper.from_array(np.array([1, cout, -1] + [0] * (nd - 1), np.int64), s4))
        new_nodes.append(helper.make_node('Reshape', [P + '/t5', s4], [n.output[0]], name=P + '/out'))
        n_rw += 1
        print(f'{n.name}: Cin {cin} Cout {cout} kernel {ks} -> Conv {4 * cout}x{cin}x2 fp16={half}')

    del g.node[:]
    g.node.extend(new_nodes)
    g.initializer.extend(new_inits)
    return m


def stage_dconv(m):
    """4. Conv(k3, dilation d) -> FoliaGNAct(gelu) -> Conv(1x1) -> FoliaGNGLU(res = conv input) as one
    Folia::FoliaDConv(x, W1, b1, g1, be1, W2, b2, g2, be2, scale)."""
    g = m.graph
    inits = {t.name for t in g.initializer}
    prod = {o: n for n in g.node for o in n.output}
    cons = {}
    for n in g.node:
        for i in n.input:
            cons.setdefault(i, []).append(n)


    def attrs(n):
        return {a.name: helper.get_attribute_value(a) for a in n.attribute}


    def need(cond, why):
        if not cond:
            raise AssertionError(why)


    remove, replace = set(), {}
    for glu in [n for n in g.node if n.op_type == 'FoliaGNGLU']:
        try:
            c2 = prod[glu.input[0]]
            need(c2.op_type == 'Conv' and attrs(c2)['kernel_shape'] == [1], 'conv2 not 1x1')
            act = prod[c2.input[0]]
            need(act.op_type == 'FoliaGNAct' and attrs(act).get('act') == 1, 'not GN+GELU')
            c1 = prod[act.input[0]]
            a1 = attrs(c1)
            need(c1.op_type == 'Conv' and a1['kernel_shape'] == [3] and a1.get('group', 1) == 1, 'conv1 not k3')
            d = a1.get('dilations', [1])[0]
            need(a1.get('pads') == [d, d] and a1.get('strides', [1]) == [1], 'conv1 not same-padded')
            need(glu.input[4] == c1.input[0], 'residual is not the conv input')
            for n in (c1, act, c2):
                need(len(cons[n.output[0]]) == 1, f'{n.name} has other users')
            ins = [c1.input[0], c1.input[1], c1.input[2], act.input[1], act.input[2],
                   c2.input[1], c2.input[2], glu.input[1], glu.input[2], glu.input[3]]
            need(all(i in inits for i in ins[1:]), 'parameters not constant')
            P = glu.name.rsplit('/', 2)[0] + '/folia_dconv'
            node = helper.make_node('FoliaDConv', ins, [glu.output[0]], domain='Folia', name=P, dilation=int(d),
                                    eps1=float(attrs(act)['epsilon']), eps2=float(attrs(glu)['epsilon']))
            for n in (c1, act, c2, glu):
                remove.add(n.name)
            replace[glu.name] = node
            print(f'{P}: dilation {d}')
        except AssertionError as e:
            print('skip', glu.name, e)

    out_nodes = [replace[n.name] if n.name in replace else n for n in g.node if n.name in replace or n.name not in remove]
    del g.node[:]
    g.node.extend(out_nodes)
    return m


def run(converter, *args):
    r = subprocess.run([converter, *args], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f'MNNConvert {" ".join(args)} failed:\n{r.stdout[-800:]}{r.stderr[-800:]}')
    return r.stdout


# MNNConvert stamps every model with a random UUID (writeFb.cpp addUUID) - the only thing that keeps two
# runs over the same graph from writing the same bytes. Pinned, so the file can be rebuilt and checked
# against the sha256 in shared/modelManifest.json. Nothing reads it at run time.
PINNED_UUID = str(uuid.uuid5(uuid.NAMESPACE_URL, 'https://github.com/AZURE-HUAI/folia/htdemucs-v3.mnn')).encode()
UUID_FIELD = re.compile(rb'\x24\x00\x00\x00[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')


def pin_uuid(graph_bytes):
    """The graph with its UUID string (a length-36 flatbuffer string) replaced by PINNED_UUID."""
    hits = [hit.start() for hit in UUID_FIELD.finditer(graph_bytes)]
    if len(hits) != 1:
        sys.exit(f'expected one UUID in the converted graph, found {len(hits)}')
    at = hits[0] + 4
    return graph_bytes[:at] + PINNED_UUID + graph_bytes[at + 36:]


def convert(converter, onnx_path, work, out_path):
    """ONNX -> packed single-file .mnn. See the module docstring for each step."""
    raw, raw_json, plugin_json = (os.path.join(work, n) for n in ('raw.mnn', 'raw.json', 'plugin.json'))
    inner, ext = os.path.join(work, 'inner.mnn'), os.path.join(work, 'ext.mnn')
    out = run(converter, '-f', 'ONNX', '--modelFile', onnx_path, '--MNNModel', raw, '--bizCode', 'folia', '--allowCustomOp')
    if 'Success' not in out:
        sys.exit(out[-800:])
    run(converter, '-f', 'MNN', '--modelFile', raw, '--JsonFile', raw_json)
    with open(raw_json) as f:
        graph = json.load(f)
    plugins = 0
    for i, op in enumerate(graph['oplists']):
        if op['type'] == 'Extra' and op['main'].get('type') == 'FoliaDConv':
            graph['oplists'][i] = {'inputIndexes': op['inputIndexes'], 'outputIndexes': op['outputIndexes'], 'name': op['name'],
                                   'type': 'Plugin', 'main_type': 'Plugin',
                                   'main': {'type': 'FoliaDConv', 'attr': op['main'].get('attr', [])},
                                   'defaultDimentionFormat': op.get('defaultDimentionFormat', 'NCHW')}
            plugins += 1
    left = [op['main'].get('type') for op in graph['oplists'] if op['type'] == 'Extra']
    # Any other Extra op would load and then fail at the first run with "not supported".
    if plugins != 32 or left:
        sys.exit(f'expected 32 FoliaDConv and no other custom op, got {plugins} and {left}')
    with open(plugin_json, 'w') as f:
        json.dump(graph, f)
    # The JSON route ignores --saveExternalData, so the external weights take a second pass.
    run(converter, '-f', 'JSON', '--modelFile', plugin_json, '--MNNModel', inner, '--saveExternalData=1', '--bizCode', 'folia')
    run(converter, '-f', 'MNN', '--modelFile', inner, '--MNNModel', ext, '--saveExternalData=1', '--bizCode', 'folia')
    with open(ext + '.weight', 'rb') as f:
        weights = f.read()
    with open(ext, 'rb') as f:
        graph_bytes = pin_uuid(f.read())
    with open(out_path, 'wb') as f:
        f.write(weights)
        f.write(graph_bytes)
        f.write(b'FOLIAMNN' + struct.pack('<Q', len(weights)))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('source', help='htdemucs.onnx (sha256 099b5be7...)')
    parser.add_argument('out', help='the .mnn to write, e.g. htdemucs-v3.mnn')
    parser.add_argument('--mnnconvert', required=True, help='MNNConvert built from the pinned MNN source')
    parser.add_argument('--keep', help='directory to keep the intermediate graphs in')
    args = parser.parse_args()

    with open(args.source, 'rb') as f:
        data = f.read()
    if len(data) != SOURCE_BYTES or hashlib.sha256(data).hexdigest() != SOURCE_SHA256:
        sys.exit(f'{args.source} is not the htdemucs.onnx this was written for (want {SOURCE_BYTES} bytes, sha256 {SOURCE_SHA256})')
    m = onnx.load_from_string(data)
    del data
    for stage in (stage_mm, stage_fuse, stage_deconv, stage_dconv):
        m = stage(m)
    with tempfile.TemporaryDirectory() as tmp:
        work = args.keep or tmp
        os.makedirs(work, exist_ok=True)
        onnx_path = os.path.join(work, 'htdemucs_folia.onnx')
        onnx.save(m, onnx_path)
        convert(args.mnnconvert, onnx_path, work, args.out)
    with open(args.out, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    print(f'{args.out}: {os.path.getsize(args.out)} bytes, sha256 {digest}')


if __name__ == '__main__':
    main()
