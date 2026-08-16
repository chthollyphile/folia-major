import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { type MotionValue } from 'framer-motion';
import * as THREE from 'three';
import { type AudioBands } from '../../../types';
import { type LineRenderHints } from '../../../utils/lyrics/renderHints';
import { BRUT_GLYPH_SLOTS, BRUT_PAD_DEPTH, BRUT_SLAB_DEPTH } from './brutConstants';
import { brutFacePointToWorld, resolveBrutFaceAngle } from './brutFaceBasis';
import {
    commitBrutGlyphBatch,
    createBrutGlyphGeometry,
    createBrutGlyphQuad,
    hideBrutGlyphSlot,
    writeBrutGlyphQuad,
    writeBrutGlyphUv,
} from './brutGlyphBatch';
import {
    createBrutInstallState,
    resolveBrutInstallState,
    resolveBrutRevealTiming,
} from './brutInstallMotion';
import { stepBrutAudioEnvelope } from './brutLighting';
import { type BrutLinePlacement } from './brutLyricPlacement';
import { type BrutPalette } from './brutPalette';
import { type BrutUnitBlock } from './brutUnitLayout';
import { type BrutRasterEntry } from './useBrutLyricRasters';

// src/components/visualizer/brut/BrutLyricLine.tsx
// One line's tokens, lit on the faces of the slabs that pushed out of the wall for them.
//
// The group carries NO yaw and NO pitch: the tokens sit flush on a wall, so their plane has to be
// parallel to it. Tilting the plane would swing the far side of a several-unit-wide block deeper
// than the mount and bury those tokens in the concrete.
//
// Every token of a line shares ONE texture and ONE material, so a whole line is a single draw call
// no matter how many tokens it has. Motion is written straight into the batch buffers from
// currentTime; no React state, no allocation per frame.

interface BrutLyricLineProps {
    entry: BrutRasterEntry;
    block: BrutUnitBlock;
    placement: BrutLinePlacement;
    hints: LineRenderHints | null;
    lineScale: number;
    palette: BrutPalette;
    currentTime: MotionValue<number>;
    audioBands: AudioBands;
    staticMode: boolean;
    /** Already-sung lines stay on the wall at reduced presence. */
    settled: boolean;
}

const scratchPoint = { x: 0, y: 0, z: 0 };

const BrutLyricLine: React.FC<BrutLyricLineProps> = ({
    entry,
    block,
    placement,
    hints,
    lineScale,
    palette,
    currentTime,
    audioBands,
    staticMode,
    settled,
}) => {
    const inkRef = useRef<THREE.Mesh>(null);
    const inkMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
    const vocalEnvelopeRef = useRef(0);
    const installState = useMemo(() => createBrutInstallState(), []);
    const quad = useMemo(() => createBrutGlyphQuad(), []);
    const idleColor = useMemo(() => new THREE.Color(palette.glyphIdle), [palette.glyphIdle]);
    const activeColor = useMemo(() => new THREE.Color(palette.glyphActive), [palette.glyphActive]);

    const inkGeometry = useMemo(() => createBrutGlyphGeometry(BRUT_GLYPH_SLOTS), []);
    useEffect(() => () => inkGeometry.dispose(), [inkGeometry]);

    const timing = useMemo(() => resolveBrutRevealTiming(hints), [hints]);

    // UVs only change when the raster or the unit list does.
    useEffect(() => {
        entry.raster.rects.forEach((rect, slot) => {
            if (slot >= BRUT_GLYPH_SLOTS) return;
            writeBrutGlyphUv(inkGeometry, slot, rect.u0, rect.u1, rect.v0, rect.v1);
        });
    }, [entry, inkGeometry]);

    const anchor = useMemo(() => {
        brutFacePointToWorld(placement.face, placement.lateral, placement.y, BRUT_PAD_DEPTH, scratchPoint);
        return {
            position: [scratchPoint.x, scratchPoint.y, scratchPoint.z] as [number, number, number],
            rotation: [0, resolveBrutFaceAngle(placement.face), placement.roll] as [number, number, number],
        };
    }, [placement]);

    useFrame((_, delta) => {
        if (!inkRef.current) return;

        const now = currentTime.get();
        vocalEnvelopeRef.current = staticMode
            ? 0.35
            : stepBrutAudioEnvelope(vocalEnvelopeRef.current, audioBands?.vocal?.get() ?? 0, delta, 9, 2.8);
        const bandHalf = entry.raster.bandEm * lineScale * 0.5;
        let brightest = 0;

        for (let slot = 0; slot < BRUT_GLYPH_SLOTS; slot += 1) {
            const unit = entry.units[slot];
            const rect = entry.raster.rects[slot];
            const layout = block.slots[slot];
            if (!unit || !rect || !layout) {
                hideBrutGlyphSlot(inkGeometry, slot);
                continue;
            }

            const state = staticMode || settled
                ? resolveBrutInstallState(unit, unit.endTime + 5, timing, installState)
                : resolveBrutInstallState(unit, now, timing, installState);

            if (!state.visible) {
                hideBrutGlyphSlot(inkGeometry, slot);
                continue;
            }

            brightest = Math.max(brightest, state.flash);
            const size = state.scale * layout.scale;
            // The token rides its slab's front face, so it can never sink into the wall.
            quad.centerX = layout.x * lineScale;
            quad.centerY = layout.y * lineScale;
            quad.z = BRUT_SLAB_DEPTH + layout.depth + 0.012;
            quad.halfWidth = rect.widthEm * lineScale * 0.5 * size;
            quad.halfHeight = bandHalf * size;
            quad.roll = layout.roll;

            const glow = settled ? 0.4 : 0.66 + vocalEnvelopeRef.current * 0.4 + state.flash * 0.9;
            quad.r = THREE.MathUtils.lerp(idleColor.r, activeColor.r, state.tint) * glow;
            quad.g = THREE.MathUtils.lerp(idleColor.g, activeColor.g, state.tint) * glow;
            quad.b = THREE.MathUtils.lerp(idleColor.b, activeColor.b, state.tint) * glow;
            quad.a = settled ? state.alpha * 0.62 : state.alpha;
            writeBrutGlyphQuad(inkGeometry, slot, quad);
        }

        commitBrutGlyphBatch(inkGeometry);
        if (inkMaterialRef.current) {
            // Emissive is what the bloom pass picks up, so ignition reads as light, not as paint.
            inkMaterialRef.current.emissiveIntensity = settled
                ? 0.16
                : 0.5 + brightest * 1.3 + vocalEnvelopeRef.current * 0.4;
        }
    });

    return (
        <group position={anchor.position} rotation={anchor.rotation}>
            <mesh ref={inkRef} geometry={inkGeometry} frustumCulled={false} renderOrder={2}>
                <meshStandardMaterial
                    ref={inkMaterialRef}
                    map={entry.raster.texture}
                    vertexColors
                    transparent
                    alphaTest={0.02}
                    depthWrite={false}
                    roughness={0.5}
                    metalness={0.05}
                    emissive={palette.glyphActive}
                    emissiveIntensity={settled ? 0.16 : 0.5}
                    toneMapped={false}
                    side={THREE.DoubleSide}
                />
            </mesh>
        </group>
    );
};

export default BrutLyricLine;
