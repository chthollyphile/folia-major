"""Runs segments through the published htdemucs ONNX graph on onnxruntime's CPU, for the WGSL runtime to be compared against.

build/htdemucs_wgsl/reference.py

    python reference.py HTDEMUCS_ONNX MIX.f32 OUT_DIR [--stages]

MIX.f32 is [n, 2, 172032] f32: n stereo segments at 44.1 kHz. Writes OUT_DIR/stems.f32, [n, 4, 2, 172032]
in the graph's source order (drums, bass, other, vocals). With --stages (one segment only), every
tensor compare_stages.py knows is exposed as an extra graph output and written as <name>.f32 - the
encoder and decoder layers of both branches, each transformer layer, the normalised spectrogram -
with graph optimisations off, so each is the tensor the graph names and not a fused stand-in.
"""
import os
import sys

import numpy as np
import onnx
import onnxruntime as ort

L = 172032
STAGES = {
    'norm_spec': '/Div_1_output_0',
    'tf_in': '/crosstransformer/Add_8_output_0', 'tf_in_t': '/crosstransformer/Add_9_output_0',
    'enc0': '/Add_2_output_0',
    **{f'enc{i}': f'/encoder.{i}/Mul_2_output_0' for i in (1, 2, 3)},
    **{f'tenc{i}': f'/tencoder.{i}/Mul_2_output_0' for i in range(4)},
    **{f'dec{i}': f'/decoder.{i}/Mul_2_output_0' for i in range(3)}, 'dec3': '/decoder.3/Slice_output_0',
    **{f'tdec{i}': f'/tdecoder.{i}/Mul_2_output_0' for i in range(3)}, 'tdec3': '/tdecoder.3/Slice_output_0',
}


def main():
    model_path, mix_path, out_dir = sys.argv[1:4]
    stages = '--stages' in sys.argv[4:]
    mix = np.fromfile(mix_path, np.float32).reshape(-1, 2, L)
    model = onnx.load(model_path)
    names = dict(STAGES) if stages else {}
    if stages:
        assert len(mix) == 1, 'stages are written for one segment'
        for node in model.graph.node:
            for layer in range(5):
                for branch, tag in (('layers', 'tf'), ('layers_t', 'tft')):
                    if node.name == f'/crosstransformer/{branch}.{layer}/norm_out/Add':
                        names[f'{tag}{layer}'] = node.output[0]
        model.graph.output.extend(onnx.helper.make_tensor_value_info(v, onnx.TensorProto.FLOAT, None) for v in names.values())
    options = ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    session = ort.InferenceSession(model.SerializeToString(), options, providers=['CPUExecutionProvider'])
    os.makedirs(out_dir, exist_ok=True)
    stems = []
    for segment in mix:
        outs = session.run(['stems', *names.values()], {'mix': segment[None]})
        stems.append(outs[0][0])
        for name, value in zip(names, outs[1:]):
            value.astype(np.float32).tofile(os.path.join(out_dir, f'{name}.f32'))
    np.stack(stems).astype(np.float32).tofile(os.path.join(out_dir, 'stems.f32'))
    print(f'{len(mix)} segments')


if __name__ == '__main__':
    main()
