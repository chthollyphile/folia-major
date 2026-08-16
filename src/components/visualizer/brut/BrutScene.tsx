import React, { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { type MotionValue } from 'framer-motion';
import { type AudioBands, type Line, type Theme } from '../../../types';
import {
    BRUT_FOG_FAR,
    BRUT_FOG_NEAR,
    BRUT_SHELL_TILE_U,
    BRUT_SHELL_TILE_V,
} from './brutConstants';
import { cloneBrutConcreteTextures, createBrutConcreteTextures } from './brutConcreteTextures';
import { createBrutEnvironment } from './brutEnvironment';
import { hashStringSeed } from './brutHash';
import { buildBrutLinePlacements } from './brutLyricPlacement';
import { buildBrutPalette } from './brutPalette';
import BrutBloom from './BrutBloom';
import BrutCamera from './BrutCamera';
import BrutDust from './BrutDust';
import BrutLightChannels from './BrutLightChannels';
import BrutLyricInstall from './BrutLyricInstall';
import BrutShaft from './BrutShaft';
import BrutShaftDecals from './BrutShaftDecals';
import BrutSkyShaft from './BrutSkyShaft';

// src/components/visualizer/brut/BrutScene.tsx
// Assembly only: fog, environment, lights and the six subsystems of the shaft. Geometry, materials
// and per-frame work all live in the child modules.

interface BrutSceneProps {
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    lines: Line[];
    theme: Theme;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    showText: boolean;
    staticMode: boolean;
    lyricsFontScale: number;
    seed?: string | number;
}

const TEXTURE_SEED = 48021;

const BrutScene: React.FC<BrutSceneProps> = ({
    currentTime,
    currentLineIndex,
    lines,
    theme,
    audioPower,
    audioBands,
    showText,
    staticMode,
    lyricsFontScale,
    seed,
}) => {
    const { gl, scene } = useThree();
    const palette = useMemo(() => buildBrutPalette(theme), [theme]);
    const patternSeed = useMemo(() => hashStringSeed(String(seed ?? 'brut')), [seed]);
    const table = useMemo(() => buildBrutLinePlacements(lines, patternSeed), [lines, patternSeed]);

    const concrete = useMemo(() => createBrutConcreteTextures(TEXTURE_SEED), []);
    // The shell bakes its UVs in world units, so it tiles at repeat 1; the relief boxes need their
    // own sampler. A deliberately non-round repeat keeps the tile period off the module period.
    const shellTextures = useMemo(
        () => cloneBrutConcreteTextures(concrete, 1, 1),
        [concrete],
    );
    const reliefTextures = useMemo(
        () => cloneBrutConcreteTextures(concrete, BRUT_SHELL_TILE_U / 3.7, BRUT_SHELL_TILE_V / 2.9),
        [concrete],
    );
    useEffect(() => () => {
        shellTextures.dispose();
        reliefTextures.dispose();
        concrete.dispose();
    }, [concrete, reliefTextures, shellTextures]);

    useEffect(() => {
        const environment = createBrutEnvironment(gl, palette.sky, palette.concreteDeep);
        scene.environment = environment?.texture ?? null;
        scene.environmentIntensity = 0.4;
        return () => {
            scene.environment = null;
            environment?.dispose();
        };
    }, [gl, palette.concreteDeep, palette.sky, scene]);

    // Written by the lyric layer each frame, read by the camera so it can frame the active line.
    const activeFrameRef = useRef({ width: 3, height: 1.2 });

    const songStart = lines[0]?.startTime ?? 0;
    const songEnd = lines[lines.length - 1]?.endTime ?? songStart + 1;

    return (
        <>
            <color attach="background" args={[palette.concreteDeep]} />
            <fog attach="fog" args={[palette.fog, BRUT_FOG_NEAR, BRUT_FOG_FAR]} />
            <hemisphereLight args={[palette.sky, palette.concreteDeep, 0.52]} />
            <BrutCamera
                currentTime={currentTime}
                currentLineIndex={currentLineIndex}
                lines={lines}
                table={table}
                audioPower={audioPower}
                staticMode={staticMode}
                palette={palette}
                activeFrameRef={activeFrameRef}
            />
            <BrutShaft
                table={table}
                patternSeed={patternSeed}
                palette={palette}
                shellTextures={shellTextures}
                reliefTextures={reliefTextures}
            />
            <BrutShaftDecals patternSeed={patternSeed} palette={palette} />
            <BrutLightChannels
                patternSeed={patternSeed}
                palette={palette}
                audioBands={audioBands}
                staticMode={staticMode}
            />
            <BrutSkyShaft
                currentTime={currentTime}
                songStart={songStart}
                songEnd={songEnd}
                palette={palette}
                audioBands={audioBands}
                staticMode={staticMode}
            />
            <BrutDust palette={palette} audioBands={audioBands} staticMode={staticMode} />
            {showText && (
                <BrutLyricInstall
                    lines={lines}
                    currentLineIndex={currentLineIndex}
                    table={table}
                    theme={theme}
                    palette={palette}
                    currentTime={currentTime}
                    audioBands={audioBands}
                    slabTextures={reliefTextures}
                    staticMode={staticMode}
                    lyricsFontScale={lyricsFontScale}
                    activeFrameRef={activeFrameRef}
                />
            )}
            <BrutBloom />
        </>
    );
};

export default BrutScene;
