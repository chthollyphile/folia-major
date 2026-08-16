import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { type MotionValue } from 'framer-motion';
import * as THREE from 'three';
import { type AudioBands, type Line, type Theme } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { getLineRenderHints } from '../../../utils/lyrics/renderHints';
import {
    BRUT_FRAME_MAX_WIDTH,
    BRUT_FRAME_PITCH,
    BRUT_GLYPH_EM,
    BRUT_GLYPH_SLOTS,
    BRUT_INSTALLED_LINES,
    BRUT_PAD_DEPTH,
} from './brutConstants';
import { brutFacePointToWorld, resolveBrutFaceAngle } from './brutFaceBasis';
import { createBrutBracketGeometry } from './brutFrameGeometry';
import {
    createBrutBracketState,
    resolveBrutBracketState,
    resolveBrutRevealTiming,
} from './brutInstallMotion';
import { type BrutPlacementTable } from './brutLyricPlacement';
import { type BrutPalette } from './brutPalette';
import { layoutBrutUnits, type BrutUnitBlock } from './brutUnitLayout';
import BrutLyricLine from './BrutLyricLine';
import { useBrutLyricRasters, type BrutRasterEntry } from './useBrutLyricRasters';

// src/components/visualizer/brut/BrutLyricInstall.tsx
// Owns the lyric window. Each line's tokens are scattered over the wall by brutUnitLayout and
// bolted on one at a time; the lines already sung stay on the wall behind the active one, so the
// shaft accumulates the song as the camera rises.

interface BrutLyricInstallProps {
    lines: Line[];
    currentLineIndex: number;
    table: BrutPlacementTable;
    theme: Theme;
    palette: BrutPalette;
    currentTime: MotionValue<number>;
    audioBands: AudioBands;
    staticMode: boolean;
    lyricsFontScale: number;
    /** Written every frame so the camera can back off far enough to frame the active line. */
    activeFrameRef: React.MutableRefObject<{ width: number; height: number; }>;
}

interface RenderedLine {
    index: number;
    line: Line;
    entry: BrutRasterEntry;
    block: BrutUnitBlock;
    scale: number;
    settled: boolean;
}

const BRACKET_SLOTS = (BRUT_INSTALLED_LINES + 1) * BRUT_GLYPH_SLOTS;
const MOUNT_DEPTH = BRUT_PAD_DEPTH + 0.14;

const scratchPoint = { x: 0, y: 0, z: 0 };
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const scratchScale = new THREE.Vector3();
const lineMatrix = new THREE.Matrix4();
const localMatrix = new THREE.Matrix4();
const bracketMatrix = new THREE.Matrix4();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

const BrutLyricInstall: React.FC<BrutLyricInstallProps> = ({
    lines,
    currentLineIndex,
    table,
    theme,
    palette,
    currentTime,
    audioBands,
    staticMode,
    lyricsFontScale,
    activeFrameRef,
}) => {
    const bracketRef = useRef<THREE.InstancedMesh>(null);

    const fontStack = resolveThemeFontStack(theme);
    const fontWeight = resolveThemeFontWeight(theme, 700);
    const activeIndex = Math.max(0, currentLineIndex);
    const rasters = useBrutLyricRasters({ lines, activeIndex, fontStack, fontWeight, enabled: true });

    const bracketGeometry = useMemo(() => createBrutBracketGeometry(), []);
    const bracketState = useMemo(() => createBrutBracketState(), []);
    useEffect(() => () => bracketGeometry.dispose(), [bracketGeometry]);

    const emScale = BRUT_GLYPH_EM * lyricsFontScale;

    const rendered = useMemo<RenderedLine[]>(() => {
        const collected: RenderedLine[] = [];
        for (let offset = BRUT_INSTALLED_LINES; offset >= 0; offset -= 1) {
            const index = activeIndex - offset;
            const line = lines[index];
            const entry = index >= 0 ? rasters.get(index) : null;
            if (!line || !entry || !table.placements[index]) {
                continue;
            }
            const block = layoutBrutUnits(entry.raster.rects.map(rect => rect.widthEm), index + 1);
            collected.push({
                index,
                line,
                entry,
                block,
                scale: Math.min(emScale, BRUT_FRAME_MAX_WIDTH / Math.max(1, block.widthEm)),
                settled: offset > 0,
            });
        }
        return collected;
        // rasters.version is the signal that a texture has landed and its line can mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeIndex, emScale, lines, rasters, rasters.version, table]);

    const active = rendered.find(item => !item.settled) ?? null;
    activeFrameRef.current.width = active ? active.block.widthEm * active.scale : 3;
    activeFrameRef.current.height = active ? active.block.heightEm * active.scale : 1.2;

    useFrame(() => {
        const brackets = bracketRef.current;
        if (!brackets) return;

        const now = currentTime.get();
        let instance = 0;

        rendered.forEach((item) => {
            const placement = table.placements[item.index];
            if (!placement) return;

            brutFacePointToWorld(placement.face, placement.lateral, placement.y, MOUNT_DEPTH, scratchPoint);
            scratchPosition.set(scratchPoint.x, scratchPoint.y, scratchPoint.z);
            scratchEuler.set(
                BRUT_FRAME_PITCH,
                resolveBrutFaceAngle(placement.face) + placement.yaw,
                placement.roll,
            );
            scratchQuaternion.setFromEuler(scratchEuler);
            scratchScale.set(1, 1, 1);
            lineMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);

            const timing = resolveBrutRevealTiming(getLineRenderHints(item.line));
            const bandHalf = item.entry.raster.bandEm * item.scale * 0.5;

            for (let slot = 0; slot < BRUT_GLYPH_SLOTS && instance < BRACKET_SLOTS; slot += 1) {
                const unit = item.entry.units[slot];
                const rect = item.entry.raster.rects[slot];
                const layout = item.block.slots[slot];
                if (!unit || !rect || !layout) continue;

                // The bracket extends out of the concrete ahead of its token rather than popping in.
                const state = staticMode || item.settled
                    ? resolveBrutBracketState(unit, unit.endTime + 5, timing, bracketState)
                    : resolveBrutBracketState(unit, now, timing, bracketState);
                if (!state.visible) {
                    brackets.setMatrixAt(instance, HIDDEN);
                    instance += 1;
                    continue;
                }

                localMatrix.makeTranslation(
                    layout.x * item.scale,
                    layout.y * item.scale - bandHalf * layout.scale - 0.05,
                    layout.depth + state.z,
                );
                scratchScale.set(
                    (rect.widthEm * item.scale * layout.scale + 0.18) * state.extend,
                    state.extend,
                    1,
                );
                brackets.setMatrixAt(
                    instance,
                    bracketMatrix.multiplyMatrices(lineMatrix, localMatrix).scale(scratchScale),
                );
                instance += 1;
            }
        });

        for (; instance < BRACKET_SLOTS; instance += 1) {
            brackets.setMatrixAt(instance, HIDDEN);
        }
        brackets.instanceMatrix.needsUpdate = true;
    });

    return (
        <>
            <instancedMesh
                ref={bracketRef}
                args={[bracketGeometry, undefined, BRACKET_SLOTS]}
                frustumCulled={false}
                castShadow
                receiveShadow
            >
                <meshStandardMaterial color={palette.steel} roughness={0.4} metalness={0.84} envMapIntensity={0.9} />
            </instancedMesh>
            {rendered.map(item => (
                <BrutLyricLine
                    key={item.index}
                    entry={item.entry}
                    block={item.block}
                    placement={table.placements[item.index]!}
                    hints={getLineRenderHints(item.line)}
                    lineScale={item.scale}
                    palette={palette}
                    currentTime={currentTime}
                    audioBands={audioBands}
                    staticMode={staticMode}
                    settled={item.settled}
                />
            ))}
        </>
    );
};

export default BrutLyricInstall;
