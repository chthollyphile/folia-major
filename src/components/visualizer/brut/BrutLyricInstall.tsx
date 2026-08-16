import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { type MotionValue } from 'framer-motion';
import * as THREE from 'three';
import { type AudioBands, type Line, type Theme } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { getLineRenderHints } from '../../../utils/lyrics/renderHints';
import {
    BRUT_FRAME_MAX_WIDTH,
    BRUT_GLYPH_EM,
    BRUT_GLYPH_SLOTS,
    BRUT_INSTALLED_LINES,
    BRUT_PAD_DEPTH,
    BRUT_SLAB_DEPTH,
    BRUT_SLAB_MARGIN_EM,
} from './brutConstants';
import { type BrutConcreteTextures } from './brutConcreteTextures';
import { brutFacePointToWorld, resolveBrutFaceAngle } from './brutFaceBasis';
import {
    createBrutSlabState,
    resolveBrutRevealTiming,
    resolveBrutSlabState,
} from './brutInstallMotion';
import { type BrutPlacementTable } from './brutLyricPlacement';
import { type BrutPalette } from './brutPalette';
import { layoutBrutUnits, type BrutUnitBlock } from './brutUnitLayout';
import BrutLyricLine from './BrutLyricLine';
import { useBrutLyricRasters, type BrutRasterEntry } from './useBrutLyricRasters';

// src/components/visualizer/brut/BrutLyricInstall.tsx
// Owns the lyric window. Each line's tokens are scattered over the wall by brutUnitLayout; for each
// one a concrete slab pushes out of the facade just before its word, and the token then lights up
// on that slab's face. Lines already sung keep their slabs, so the shaft accumulates the song.

interface BrutLyricInstallProps {
    lines: Line[];
    currentLineIndex: number;
    table: BrutPlacementTable;
    theme: Theme;
    palette: BrutPalette;
    slabTextures: BrutConcreteTextures;
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

const SLAB_SLOTS = (BRUT_INSTALLED_LINES + 1) * BRUT_GLYPH_SLOTS;

const scratchPoint = { x: 0, y: 0, z: 0 };
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const scratchScale = new THREE.Vector3();
const scratchColor = new THREE.Color();
const lineMatrix = new THREE.Matrix4();
const localMatrix = new THREE.Matrix4();
const slabMatrix = new THREE.Matrix4();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

const BrutLyricInstall: React.FC<BrutLyricInstallProps> = ({
    lines,
    currentLineIndex,
    table,
    theme,
    palette,
    slabTextures,
    currentTime,
    audioBands,
    staticMode,
    lyricsFontScale,
    activeFrameRef,
}) => {
    const slabRef = useRef<THREE.InstancedMesh>(null);
    const slabState = useMemo(() => createBrutSlabState(), []);
    const slabColor = useMemo(() => new THREE.Color(palette.concrete), [palette.concrete]);

    const fontStack = resolveThemeFontStack(theme);
    const fontWeight = resolveThemeFontWeight(theme, 700);
    const activeIndex = Math.max(0, currentLineIndex);
    const rasters = useBrutLyricRasters({ lines, activeIndex, fontStack, fontWeight, enabled: true });

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

    useEffect(() => {
        const slabs = slabRef.current;
        if (!slabs) return;
        for (let instance = 0; instance < SLAB_SLOTS; instance += 1) {
            slabs.setColorAt(instance, slabColor);
        }
        if (slabs.instanceColor) slabs.instanceColor.needsUpdate = true;
    }, [slabColor]);

    useFrame(() => {
        const slabs = slabRef.current;
        if (!slabs) return;

        const now = currentTime.get();
        let instance = 0;

        rendered.forEach((item) => {
            const placement = table.placements[item.index];
            if (!placement) return;

            brutFacePointToWorld(placement.face, placement.lateral, placement.y, BRUT_PAD_DEPTH, scratchPoint);
            scratchPosition.set(scratchPoint.x, scratchPoint.y, scratchPoint.z);
            scratchEuler.set(0, resolveBrutFaceAngle(placement.face), placement.roll);
            scratchQuaternion.setFromEuler(scratchEuler);
            scratchScale.set(1, 1, 1);
            lineMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);

            const timing = resolveBrutRevealTiming(getLineRenderHints(item.line));
            const bandHalf = item.entry.raster.bandEm * item.scale * 0.5;
            const margin = BRUT_SLAB_MARGIN_EM * item.scale;

            for (let slot = 0; slot < BRUT_GLYPH_SLOTS && instance < SLAB_SLOTS; slot += 1) {
                const unit = item.entry.units[slot];
                const rect = item.entry.raster.rects[slot];
                const layout = item.block.slots[slot];
                if (!unit || !rect || !layout) continue;

                const state = staticMode || item.settled
                    ? resolveBrutSlabState(unit, unit.endTime + 5, timing, slabState)
                    : resolveBrutSlabState(unit, now, timing, slabState);
                if (!state.visible) {
                    slabs.setMatrixAt(instance, HIDDEN);
                    instance += 1;
                    continue;
                }

                // The slab grows forward off the wall, so its BACK stays anchored in the concrete.
                const depth = (BRUT_SLAB_DEPTH + layout.depth) * state.extend;
                localMatrix.makeTranslation(layout.x * item.scale, layout.y * item.scale, depth / 2);
                scratchScale.set(
                    rect.widthEm * item.scale * layout.scale + margin,
                    bandHalf * 2 * layout.scale + margin,
                    depth,
                );
                slabMatrix.multiplyMatrices(lineMatrix, localMatrix).scale(scratchScale);
                slabs.setMatrixAt(instance, slabMatrix);
                instance += 1;
            }
        });

        for (; instance < SLAB_SLOTS; instance += 1) {
            slabs.setMatrixAt(instance, HIDDEN);
        }
        slabs.instanceMatrix.needsUpdate = true;
    });

    return (
        <>
            <instancedMesh
                ref={slabRef}
                args={[undefined, undefined, SLAB_SLOTS]}
                frustumCulled={false}
                castShadow
                receiveShadow
            >
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial
                    map={slabTextures.map}
                    normalMap={slabTextures.normalMap}
                    roughnessMap={slabTextures.roughnessMap}
                    color={palette.concrete}
                    roughness={0.95}
                    metalness={0.02}
                    envMapIntensity={0.6}
                />
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
