import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
    BRUT_GRAFFITI_PER_MODULE,
    BRUT_MODULE_BELOW,
    BRUT_MODULE_HEIGHT,
    BRUT_MODULE_WINDOW,
    BRUT_SHAFT_HALF,
} from './brutConstants';
import { resolveBrutDepthBrightness } from './brutDepthGradient';
import { brutFacePointToWorld, normalizeBrutFace, resolveBrutFaceAngle } from './brutFaceBasis';
import { createBrutGraffitiTextures } from './brutGraffiti';
import { hash1, hashSigned } from './brutHash';
import { type BrutPalette } from './brutPalette';

// src/components/visualizer/brut/BrutShaftDecals.tsx
// Spray marks on the concrete. One InstancedMesh per stencil, recycled by module exactly like the
// relief, so a decal keeps its wall and its position across a seek.

interface BrutShaftDecalsProps {
    patternSeed: number;
    palette: BrutPalette;
}

const STENCILS = 3;
const PER_STENCIL = Math.max(1, Math.round((BRUT_MODULE_WINDOW * BRUT_GRAFFITI_PER_MODULE) / STENCILS));
const DECAL_DEPTH = 0.012;

const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const scratchScale = new THREE.Vector3();
const scratchMatrix = new THREE.Matrix4();
const scratchColor = new THREE.Color();
const scratchPoint = { x: 0, y: 0, z: 0 };

const BrutShaftDecals: React.FC<BrutShaftDecalsProps> = ({ patternSeed, palette }) => {
    const { camera } = useThree();
    const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([null, null, null]);
    const baseRef = useRef(Number.NaN);
    const heightsRef = useRef(new Float32Array(STENCILS * PER_STENCIL));

    const graffiti = useMemo(() => createBrutGraffitiTextures(patternSeed + 4409), [patternSeed]);
    const decalColor = useMemo(() => new THREE.Color(palette.graffiti), [palette.graffiti]);
    useEffect(() => () => graffiti.dispose(), [graffiti]);
    useEffect(() => { baseRef.current = Number.NaN; }, [patternSeed]);

    useFrame(() => {
        const meshes = meshRefs.current;
        if (meshes.some(mesh => !mesh)) return;

        const cameraY = camera.position.y;
        const base = Math.floor(cameraY / BRUT_MODULE_HEIGHT) - BRUT_MODULE_BELOW;

        if (base !== baseRef.current) {
            for (let stencil = 0; stencil < STENCILS; stencil += 1) {
                const mesh = meshes[stencil]!;
                for (let index = 0; index < PER_STENCIL; index += 1) {
                    // Spread the slots across the live modules, one decal per module slice.
                    const moduleIndex = base + Math.floor((index / PER_STENCIL) * BRUT_MODULE_WINDOW);
                    const seed = patternSeed * 3313 + moduleIndex * 61.7 + stencil * 17.3 + index * 5.11;
                    const size = 0.9 + hash1(seed + 1) * 1.6;
                    const face = normalizeBrutFace(Math.floor(hash1(seed + 2) * 4));
                    const lateral = hashSigned(seed + 3) * (BRUT_SHAFT_HALF * 2 - size - 1);
                    const y = moduleIndex * BRUT_MODULE_HEIGHT + 0.6 + hash1(seed + 4) * (BRUT_MODULE_HEIGHT - 1.6);

                    brutFacePointToWorld(face, lateral, y, DECAL_DEPTH, scratchPoint);
                    scratchPosition.set(scratchPoint.x, scratchPoint.y, scratchPoint.z);
                    scratchEuler.set(0, resolveBrutFaceAngle(face), hashSigned(seed + 5) * 0.28);
                    scratchQuaternion.setFromEuler(scratchEuler);
                    scratchScale.set(size, size, 1);
                    scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
                    mesh.setMatrixAt(index, scratchMatrix);
                    heightsRef.current[stencil * PER_STENCIL + index] = y;
                }
                mesh.instanceMatrix.needsUpdate = true;
            }
            baseRef.current = base;
        }

        for (let stencil = 0; stencil < STENCILS; stencil += 1) {
            const mesh = meshes[stencil]!;
            for (let index = 0; index < PER_STENCIL; index += 1) {
                const brightness = resolveBrutDepthBrightness(heightsRef.current[stencil * PER_STENCIL + index], cameraY);
                scratchColor.setRGB(decalColor.r * brightness, decalColor.g * brightness, decalColor.b * brightness);
                mesh.setColorAt(index, scratchColor);
            }
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
    });

    return (
        <>
            {graffiti.textures.map((texture, stencil) => (
                <instancedMesh
                    key={texture.uuid}
                    ref={(mesh) => { meshRefs.current[stencil] = mesh; }}
                    args={[undefined, undefined, PER_STENCIL]}
                    frustumCulled={false}
                    renderOrder={1}
                >
                    <planeGeometry args={[1, 1]} />
                    <meshStandardMaterial
                        map={texture}
                        transparent
                        alphaTest={0.05}
                        depthWrite={false}
                        roughness={0.86}
                        metalness={0.02}
                        polygonOffset
                        polygonOffsetFactor={-2}
                    />
                </instancedMesh>
            ))}
        </>
    );
};

export default BrutShaftDecals;
