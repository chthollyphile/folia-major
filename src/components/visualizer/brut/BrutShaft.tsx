import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
    BRUT_MODULE_BELOW,
    BRUT_MODULE_HEIGHT,
    BRUT_MODULE_WINDOW,
    BRUT_BLOCKS_PER_MODULE,
    BRUT_RELIEF_COUNT,
} from './brutConstants';
import { type BrutConcreteTextures } from './brutConcreteTextures';
import { brutFacePointToWorld, resolveBrutFaceAngle } from './brutFaceBasis';
import { type BrutPalette } from './brutPalette';
import { type BrutPlacementTable } from './brutLyricPlacement';
import {
    collectBrutModulePads,
    createBrutModuleBlocks,
    createBrutModulePads,
    fillBrutModuleBlocks,
} from './brutReliefLayout';
import { createBrutShellGeometry, updateBrutShellDepthGradient } from './brutShellGeometry';
import { resolveBrutDepthBrightness } from './brutDepthGradient';

// src/components/visualizer/brut/BrutShaft.tsx
// The infinite well: one snapped shell mesh plus one InstancedMesh of recycled relief.
// Nothing here may allocate inside useFrame - all vectors, matrices and blocks are module scratch.

interface BrutShaftProps {
    table: BrutPlacementTable;
    patternSeed: number;
    palette: BrutPalette;
    shellTextures: BrutConcreteTextures;
    reliefTextures: BrutConcreteTextures;
}

const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const scratchScale = new THREE.Vector3();
const scratchMatrix = new THREE.Matrix4();
const scratchColor = new THREE.Color();
const scratchPoint = { x: 0, y: 0, z: 0 };

const BrutShaft: React.FC<BrutShaftProps> = ({ table, patternSeed, palette, shellTextures, reliefTextures }) => {
    const { camera } = useThree();
    const shellRef = useRef<THREE.Mesh>(null);
    const reliefRef = useRef<THREE.InstancedMesh>(null);
    const baseRef = useRef(Number.NaN);
    const moduleAtSlotRef = useRef<number[]>(new Array(BRUT_MODULE_WINDOW).fill(Number.NaN));
    const blockHeightsRef = useRef<Float32Array>(new Float32Array(BRUT_RELIEF_COUNT));
    const blockTonesRef = useRef<Float32Array>(new Float32Array(BRUT_RELIEF_COUNT).fill(1));

    const shellGeometry = useMemo(() => createBrutShellGeometry(), []);
    const moduleBlocks = useMemo(() => createBrutModuleBlocks(), []);
    const modulePads = useMemo(() => createBrutModulePads(), []);

    useEffect(() => () => shellGeometry.dispose(), [shellGeometry]);

    // A placement or seed change moves the mounting pads, so the whole relief window must rebuild.
    useEffect(() => {
        baseRef.current = Number.NaN;
        moduleAtSlotRef.current.fill(Number.NaN);
    }, [table, patternSeed]);

    useFrame(() => {
        const shell = shellRef.current;
        const relief = reliefRef.current;
        if (!shell || !relief) {
            return;
        }

        const cameraY = camera.position.y;
        const base = Math.floor(cameraY / BRUT_MODULE_HEIGHT) - BRUT_MODULE_BELOW;
        const shellBaseY = base * BRUT_MODULE_HEIGHT;
        shell.position.y = shellBaseY;
        updateBrutShellDepthGradient(shellGeometry, shellBaseY, cameraY);

        if (base !== baseRef.current) {
            const slots = moduleAtSlotRef.current;
            const heights = blockHeightsRef.current;
            const tones = blockTonesRef.current;

            for (let slot = 0; slot < BRUT_MODULE_WINDOW; slot += 1) {
                const moduleIndex = base + slot;
                if (slots[slot] === moduleIndex) {
                    continue;
                }
                slots[slot] = moduleIndex;

                const padCount = collectBrutModulePads(table, moduleIndex, modulePads);
                fillBrutModuleBlocks(moduleBlocks, patternSeed, moduleIndex, modulePads, padCount);

                for (let index = 0; index < BRUT_BLOCKS_PER_MODULE; index += 1) {
                    const block = moduleBlocks[index];
                    const instance = slot * BRUT_BLOCKS_PER_MODULE + index;
                    brutFacePointToWorld(block.face, block.lateral, block.y, block.depth / 2, scratchPoint);
                    scratchPosition.set(scratchPoint.x, scratchPoint.y, scratchPoint.z);
                    scratchEuler.set(0, resolveBrutFaceAngle(block.face), 0);
                    scratchQuaternion.setFromEuler(scratchEuler);
                    scratchScale.set(block.width, block.height, block.depth);
                    scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
                    relief.setMatrixAt(instance, scratchMatrix);
                    heights[instance] = block.y;
                    tones[instance] = block.tone;
                }
            }

            relief.instanceMatrix.needsUpdate = true;
            baseRef.current = base;
        }

        // The relief has no vertex-colour ramp of its own, so it takes the shell's depth gradient
        // through instanceColor. 120 instances is cheap enough to refresh every frame.
        const heights = blockHeightsRef.current;
        const tones = blockTonesRef.current;
        for (let instance = 0; instance < BRUT_RELIEF_COUNT; instance += 1) {
            const brightness = resolveBrutDepthBrightness(heights[instance], cameraY) * tones[instance];
            scratchColor.setRGB(brightness, brightness, brightness);
            relief.setColorAt(instance, scratchColor);
        }
        if (relief.instanceColor) {
            relief.instanceColor.needsUpdate = true;
        }
    });

    return (
        <>
            <mesh ref={shellRef} geometry={shellGeometry} receiveShadow frustumCulled={false}>
                <meshStandardMaterial
                    map={shellTextures.map}
                    normalMap={shellTextures.normalMap}
                    roughnessMap={shellTextures.roughnessMap}
                    color={palette.concrete}
                    vertexColors
                    roughness={1}
                    metalness={0.02}
                    envMapIntensity={0.6}
                    side={THREE.FrontSide}
                />
            </mesh>
            <instancedMesh
                ref={reliefRef}
                args={[undefined, undefined, BRUT_RELIEF_COUNT]}
                frustumCulled={false}
                castShadow
                receiveShadow
            >
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial
                    map={reliefTextures.map}
                    normalMap={reliefTextures.normalMap}
                    roughnessMap={reliefTextures.roughnessMap}
                    color={palette.concrete}
                    roughness={0.98}
                    metalness={0.02}
                    envMapIntensity={0.6}
                />
            </instancedMesh>
        </>
    );
};

export default BrutShaft;
