import React from 'react';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { BlendFunction, KernelSize } from 'postprocessing';

// src/components/visualizer/brut/BrutBloom.tsx
// Bloom over the shaft, so the tokens read as light igniting on concrete rather than as paint.
//
// The threshold is deliberately high: the concrete, the slabs and the dust must NOT glow, only the
// emissive tokens, the recessed light channels and the shaft mouth. Those are the only surfaces
// rendered with toneMapped={false}, so they are the only ones that clear the luminance gate.
//
// `multisampling` matters here. A composer renders the scene into an offscreen target, which drops
// the default MSAA path, and this scene is made almost entirely of high-contrast concrete edges and
// thin steel - exactly the content that shows aliasing first. 4x costs bandwidth but keeps the
// edges the mode depends on.

const BrutBloom: React.FC = () => (
    <EffectComposer multisampling={4}>
        <Bloom
            intensity={0.72}
            luminanceThreshold={0.78}
            luminanceSmoothing={0.2}
            kernelSize={KernelSize.LARGE}
            mipmapBlur
            blendFunction={BlendFunction.ADD}
        />
    </EffectComposer>
);

export default BrutBloom;
