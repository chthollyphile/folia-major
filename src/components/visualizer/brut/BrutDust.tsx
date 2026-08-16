import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { type AudioBands } from '../../../types';
import { BRUT_SHAFT_HALF } from './brutConstants';
import { mulberry32 } from './brutHash';
import { stepBrutAudioEnvelope } from './brutLighting';
import { type BrutPalette } from './brutPalette';
import { createBrutRadialSpriteTexture } from './brutTextures';

// src/components/visualizer/brut/BrutDust.tsx
// Lit dust is what a visible light shaft actually IS, so this is the single biggest contributor to
// the beams reading as volume. Motes wrap around the camera in a sliding window rather than being
// respawned, so the field costs one <points> draw and never allocates.

interface BrutDustProps {
    palette: BrutPalette;
    audioBands: AudioBands;
    staticMode: boolean;
}

const DUST_COUNT = 900;
const SPAN = 46;
const DRIFT = 0.22;

const BrutDust: React.FC<BrutDustProps> = ({ palette, audioBands, staticMode }) => {
    const { camera } = useThree();
    const pointsRef = useRef<THREE.Points>(null);
    const trebleEnvelopeRef = useRef(0);

    const spriteTexture = useMemo(() => createBrutRadialSpriteTexture(0.35), []);
    const geometry = useMemo(() => {
        const random = mulberry32(20260816);
        const positions = new Float32Array(DUST_COUNT * 3);
        for (let index = 0; index < DUST_COUNT; index += 1) {
            positions[index * 3] = (random() - 0.5) * BRUT_SHAFT_HALF * 1.9;
            positions[index * 3 + 1] = (random() - 0.5) * SPAN;
            positions[index * 3 + 2] = (random() - 0.5) * BRUT_SHAFT_HALF * 1.9;
        }
        const buffer = new THREE.BufferGeometry();
        const attribute = new THREE.BufferAttribute(positions, 3);
        attribute.setUsage(THREE.DynamicDrawUsage);
        buffer.setAttribute('position', attribute);
        buffer.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SPAN);
        return buffer;
    }, []);

    useEffect(() => () => {
        geometry.dispose();
        spriteTexture.dispose();
    }, [geometry, spriteTexture]);

    useFrame((_, delta) => {
        const points = pointsRef.current;
        if (!points) return;

        points.position.y = camera.position.y;
        trebleEnvelopeRef.current = staticMode
            ? 0.3
            : stepBrutAudioEnvelope(trebleEnvelopeRef.current, audioBands?.treble?.get() ?? 0, delta, 10, 3.6);

        const material = points.material as THREE.PointsMaterial;
        material.size = 0.055 + trebleEnvelopeRef.current * 0.05;
        material.opacity = 0.3 + trebleEnvelopeRef.current * 0.34;

        if (staticMode) return;

        const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
        const array = attribute.array as Float32Array;
        const half = SPAN / 2;
        for (let index = 1; index < array.length; index += 3) {
            array[index] += DRIFT * delta;
            if (array[index] > half) array[index] -= SPAN;
        }
        attribute.needsUpdate = true;
    });

    return (
        <points ref={pointsRef} geometry={geometry} frustumCulled={false} renderOrder={5}>
            <pointsMaterial
                map={spriteTexture}
                color={palette.dust}
                size={0.06}
                sizeAttenuation
                transparent
                opacity={0.35}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                fog={false}
                toneMapped={false}
            />
        </points>
    );
};

export default BrutDust;
