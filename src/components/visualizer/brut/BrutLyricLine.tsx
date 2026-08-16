import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { type MotionValue } from 'framer-motion';
import * as THREE from 'three';
import { type AudioBands } from '../../../types';
import { type LineRenderHints } from '../../../utils/lyrics/renderHints';
import { BRUT_FRAME_PITCH, BRUT_GLYPH_SLOTS, BRUT_PAD_DEPTH } from './brutConstants';
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
// One line's tokens, scattered over the wall and bolted on one at a time.
//
// Every token of a line shares ONE texture and ONE material, so a whole line costs a single draw
// call no matter how many tokens it has. Motion is written straight into the batch buffers from
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

const MOUNT_DEPTH = BRUT_PAD_DEPTH + 0.14;
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
    const vocalEnvelopeRef = useRef(0);
    const installState = useMemo(() => createBrutInstallState(), []);
    const quad = useMemo(() => createBrutGlyphQuad(), []);
    const idleColor = useMemo(() => new THREE.Color(palette.glyphIdle), [palette.glyphIdle]);
    const activeColor = useMemo(() => new THREE.Color(palette.glyphActive), [palette.glyphActive]);

    const inkGeometry = useMemo(() => createBrutGlyphGeometry(BRUT_GLYPH_SLOTS), []);
    const flashGeometry = useMemo(() => createBrutGlyphGeometry(BRUT_GLYPH_SLOTS), []);
    useEffect(() => () => {
        inkGeometry.dispose();
        flashGeometry.dispose();
    }, [flashGeometry, inkGeometry]);

    const timing = useMemo(() => resolveBrutRevealTiming(hints), [hints]);

    // UVs only change when the raster or the unit list does.
    useEffect(() => {
        entry.raster.rects.forEach((rect, slot) => {
            if (slot >= BRUT_GLYPH_SLOTS) return;
            writeBrutGlyphUv(inkGeometry, slot, rect.u0, rect.u1, rect.v0, rect.v1);
            writeBrutGlyphUv(flashGeometry, slot, rect.u0, rect.u1, rect.v0, rect.v1);
        });
    }, [entry, flashGeometry, inkGeometry]);

    const anchor = useMemo(() => {
        brutFacePointToWorld(placement.face, placement.lateral, placement.y, MOUNT_DEPTH, scratchPoint);
        return {
            position: [scratchPoint.x, scratchPoint.y, scratchPoint.z] as [number, number, number],
            rotation: new THREE.Euler(
                BRUT_FRAME_PITCH,
                resolveBrutFaceAngle(placement.face) + placement.yaw,
                placement.roll,
                'YXZ',
            ),
        };
    }, [placement]);

    useFrame((_, delta) => {
        if (!inkRef.current) return;

        const now = currentTime.get();
        vocalEnvelopeRef.current = staticMode
            ? 0.35
            : stepBrutAudioEnvelope(vocalEnvelopeRef.current, audioBands?.vocal?.get() ?? 0, delta, 9, 2.8);
        const lift = settled ? 0.5 : 0.85 + vocalEnvelopeRef.current * 0.5;
        const bandHalf = entry.raster.bandEm * lineScale * 0.5;

        for (let slot = 0; slot < BRUT_GLYPH_SLOTS; slot += 1) {
            const unit = entry.units[slot];
            const rect = entry.raster.rects[slot];
            const layout = block.slots[slot];
            if (!unit || !rect || !layout) {
                hideBrutGlyphSlot(inkGeometry, slot);
                hideBrutGlyphSlot(flashGeometry, slot);
                continue;
            }

            const state = staticMode || settled
                ? resolveBrutInstallState(unit, unit.endTime + 5, timing, layout.roll, installState)
                : resolveBrutInstallState(unit, now, timing, layout.roll, installState);

            if (!state.visible) {
                hideBrutGlyphSlot(inkGeometry, slot);
                hideBrutGlyphSlot(flashGeometry, slot);
                continue;
            }

            const size = state.scale * layout.scale;
            quad.centerX = layout.x * lineScale;
            quad.centerY = (layout.y + state.y) * lineScale;
            quad.z = state.z + layout.depth;
            quad.halfWidth = rect.widthEm * lineScale * 0.5 * size;
            quad.halfHeight = bandHalf * size;
            quad.roll = state.roll;
            quad.r = THREE.MathUtils.lerp(idleColor.r, activeColor.r * lift, state.tint);
            quad.g = THREE.MathUtils.lerp(idleColor.g, activeColor.g * lift, state.tint);
            quad.b = THREE.MathUtils.lerp(idleColor.b, activeColor.b * lift, state.tint);
            quad.a = settled ? state.alpha * 0.55 : state.alpha;
            writeBrutGlyphQuad(inkGeometry, slot, quad);

            if (settled || state.flash <= 0.001) {
                hideBrutGlyphSlot(flashGeometry, slot);
                continue;
            }
            quad.z += 0.012;
            quad.halfWidth *= 1 + state.flash * 0.5;
            quad.halfHeight *= 1 + state.flash * 0.5;
            quad.r = activeColor.r;
            quad.g = activeColor.g;
            quad.b = activeColor.b;
            quad.a = state.flash * 0.85;
            writeBrutGlyphQuad(flashGeometry, slot, quad);
        }

        commitBrutGlyphBatch(inkGeometry);
        commitBrutGlyphBatch(flashGeometry);
    });

    return (
        <group position={anchor.position} rotation={anchor.rotation}>
            <mesh ref={inkRef} geometry={inkGeometry} frustumCulled={false} renderOrder={2}>
                <meshStandardMaterial
                    map={entry.raster.texture}
                    vertexColors
                    transparent
                    alphaTest={0.02}
                    depthWrite={false}
                    roughness={0.34}
                    metalness={0.4}
                    emissive={palette.glyphActive}
                    emissiveIntensity={settled ? 0.12 : 0.45}
                    side={THREE.DoubleSide}
                />
            </mesh>
            {!settled && (
                <mesh geometry={flashGeometry} frustumCulled={false} renderOrder={3}>
                    <meshBasicMaterial
                        map={entry.raster.texture}
                        vertexColors
                        transparent
                        depthWrite={false}
                        blending={THREE.AdditiveBlending}
                        fog={false}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            )}
        </group>
    );
};

export default BrutLyricLine;
