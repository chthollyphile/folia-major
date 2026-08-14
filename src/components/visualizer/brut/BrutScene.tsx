import React, { useEffect, useMemo } from 'react';
import { type MotionValue } from 'framer-motion';
import * as THREE from 'three';
import { type Line, type Theme } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { mixColors } from '../colorMix';
import {
    BRUT_CHUNK_HEIGHT,
    BRUT_LINE_SPACING,
    BRUT_WALL_WIDTH,
    buildBrutReliefBlocks,
} from './brutGeometry';
import { createBrutConcreteTexture, createBrutLyricTexture, createBrutSoftShadowTexture } from './brutTextures';
import BrutCamera from './BrutCamera';

// src/components/visualizer/brut/BrutScene.tsx
// Renders the recycled concrete modules and raised, shadow-casting lyric signs.

interface BrutSceneProps {
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    lines: Line[];
    theme: Theme;
    audioPower: MotionValue<number>;
    showText: boolean;
    staticMode: boolean;
    lyricsFontScale: number;
}

const WallChunk: React.FC<{
    index: number;
    texture: THREE.Texture;
    softShadowTexture: THREE.Texture;
    concreteColor: string;
}> = ({ index, texture, softShadowTexture, concreteColor }) => {
    const blocks = useMemo(() => buildBrutReliefBlocks(index), [index]);
    const y = -index * BRUT_CHUNK_HEIGHT;

    return (
        <group position={[0, y, 0]}>
            <mesh receiveShadow position={[0, 0, -0.62]}>
                <boxGeometry args={[BRUT_WALL_WIDTH, BRUT_CHUNK_HEIGHT - 0.06, 1.25]} />
                <meshStandardMaterial map={texture} color={concreteColor} roughness={0.96} metalness={0.02} />
            </mesh>
            {blocks.map((block, blockIndex) => (
                <group key={blockIndex}>
                    <mesh position={[block.x + 0.13, block.y - 0.16, 0.012]} renderOrder={1}>
                        <planeGeometry args={[block.width + 0.52, block.height + 0.52]} />
                        <meshBasicMaterial
                            map={softShadowTexture}
                            transparent
                            opacity={0.34}
                            depthWrite={false}
                            polygonOffset
                            polygonOffsetFactor={-1}
                        />
                    </mesh>
                    <mesh
                        castShadow
                        receiveShadow
                        position={[block.x, block.y, block.depth / 2 + 0.015]}
                    >
                        <boxGeometry args={[block.width, block.height, block.depth]} />
                        <meshStandardMaterial map={texture} color={concreteColor} roughness={0.92} metalness={0.025} />
                    </mesh>
                </group>
            ))}
            <mesh position={[0, -BRUT_CHUNK_HEIGHT / 2 + 0.03, 0.02]} receiveShadow>
                <boxGeometry args={[BRUT_WALL_WIDTH, 0.065, 0.08]} />
                <meshStandardMaterial color={mixColors(concreteColor, '#000000', 0.42)} roughness={1} />
            </mesh>
        </group>
    );
};

const LyricSign: React.FC<{
    line: Line;
    index: number;
    active: boolean;
    fontFamily: string;
    fontWeight: number;
    theme: Theme;
    scale: number;
    softShadowTexture: THREE.Texture;
}> = ({ line, index, active, fontFamily, fontWeight, theme, scale, softShadowTexture }) => {
    const raster = useMemo(
        () => createBrutLyricTexture(line.fullText, fontFamily, fontWeight),
        [fontFamily, fontWeight, line.fullText],
    );
    useEffect(() => () => raster.texture.dispose(), [raster]);

    const height = Math.min(1.02, 0.78 * scale);
    const width = Math.min(9.4, height * raster.aspect);
    const y = -index * BRUT_LINE_SPACING;
    const x = ((index % 3) - 1) * 1.15;
    const signColor = active ? theme.accentColor : mixColors(theme.primaryColor, theme.secondaryColor, 0.22);
    const steelColor = mixColors(theme.backgroundColor, theme.secondaryColor, 0.22);

    return (
        <group position={[x, y, 0.5]}>
            <mesh position={[0.14, -0.14, -0.475]} renderOrder={1}>
                <planeGeometry args={[width + 0.9, height + 0.62]} />
                <meshBasicMaterial map={softShadowTexture} transparent opacity={0.28} depthWrite={false} />
            </mesh>
            <mesh castShadow position={[0, 0, -0.18]}>
                <boxGeometry args={[width + 0.5, 0.09, 0.09]} />
                <meshStandardMaterial color={steelColor} roughness={0.5} metalness={0.72} />
            </mesh>
            {[-1, 1].map(side => (
                <mesh key={side} castShadow position={[side * Math.max(0.45, width * 0.35), 0, -0.08]}>
                    <boxGeometry args={[0.055, height * 1.25, 0.32]} />
                    <meshStandardMaterial color={steelColor} roughness={0.45} metalness={0.78} />
                </mesh>
            ))}
            <mesh castShadow position={[0, 0, 0.13]}>
                <planeGeometry args={[width, height]} />
                <meshStandardMaterial
                    map={raster.texture}
                    color={signColor}
                    transparent
                    alphaTest={0.12}
                    roughness={0.3}
                    metalness={0.42}
                    emissive={active ? theme.accentColor : '#000000'}
                    emissiveIntensity={active ? 0.2 : 0}
                    side={THREE.DoubleSide}
                />
            </mesh>
        </group>
    );
};

const BrutScene: React.FC<BrutSceneProps> = ({
    currentTime,
    currentLineIndex,
    lines,
    theme,
    audioPower,
    showText,
    staticMode,
    lyricsFontScale,
}) => {
    const concreteTexture = useMemo(() => createBrutConcreteTexture(48021), []);
    const softShadowTexture = useMemo(() => createBrutSoftShadowTexture(), []);
    useEffect(() => () => concreteTexture.dispose(), [concreteTexture]);
    useEffect(() => () => softShadowTexture.dispose(), [softShadowTexture]);
    const fontFamily = resolveThemeFontStack(theme);
    const fontWeight = resolveThemeFontWeight(theme, 700);
    const concreteColor = mixColors(theme.backgroundColor, theme.secondaryColor, 0.46);
    const sceneBackground = mixColors(theme.backgroundColor, theme.primaryColor, 0.055);
    const safeIndex = Math.max(0, currentLineIndex);
    const chunkIndex = Math.floor((safeIndex * BRUT_LINE_SPACING) / BRUT_CHUNK_HEIGHT);
    const chunks = useMemo(
        () => Array.from({ length: 7 }, (_, index) => chunkIndex - 3 + index),
        [chunkIndex],
    );
    const lyricStart = Math.max(0, safeIndex - 5);
    const lyricEnd = Math.min(lines.length, safeIndex + 7);

    return (
        <>
            <color attach="background" args={[sceneBackground]} />
            <fog attach="fog" args={[sceneBackground, 12, 28]} />
            <ambientLight intensity={0.38} color={theme.secondaryColor} />
            <hemisphereLight args={[theme.primaryColor, theme.backgroundColor, 0.42]} />
            <BrutCamera
                currentTime={currentTime}
                currentLineIndex={currentLineIndex}
                lines={lines}
                audioPower={audioPower}
                staticMode={staticMode}
            />
            {chunks.map(index => (
                <WallChunk
                    key={index}
                    index={index}
                    texture={concreteTexture}
                    softShadowTexture={softShadowTexture}
                    concreteColor={concreteColor}
                />
            ))}
            {showText && lines.slice(lyricStart, lyricEnd).map((line, offset) => {
                const index = lyricStart + offset;
                return line.fullText.trim() ? (
                    <LyricSign
                        key={`${index}-${line.startTime}-${line.fullText}`}
                        line={line}
                        index={index}
                        active={index === currentLineIndex}
                        fontFamily={fontFamily}
                        fontWeight={fontWeight}
                        theme={theme}
                        scale={lyricsFontScale}
                        softShadowTexture={softShadowTexture}
                    />
                ) : null;
            })}
        </>
    );
};

export default BrutScene;
