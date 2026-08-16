import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { type AudioBands } from '../../../types';
import {
    BRUT_CHANNELS_PER_MODULE,
    BRUT_MODULE_BELOW,
    BRUT_MODULE_HEIGHT,
    BRUT_MODULE_WINDOW,
} from './brutConstants';
import {
    BRUT_CHANNEL_THICKNESS,
    createBrutModuleChannels,
    fillBrutModuleChannels,
} from './brutChannelLayout';
import { brutFacePointToWorld, resolveBrutFaceAngle } from './brutFaceBasis';
import { resolveBrutChannelIntensity, stepBrutAudioEnvelope } from './brutLighting';
import { type BrutPalette } from './brutPalette';
import { createBrutRadialSpriteTexture } from './brutTextures';
import { resolveBrutDepthBrightness } from './brutDepthGradient';

// src/components/visualizer/brut/BrutLightChannels.tsx
// Linear light strips recessed into the relief gaps, plus an additive glow card in front of each -
// the card fakes the spill onto the concrete for the price of one extra transparent quad, instead
// of a bloom pyramid.

interface BrutLightChannelsProps {
    patternSeed: number;
    palette: BrutPalette;
    audioBands: AudioBands;
    staticMode: boolean;
}

const CHANNEL_COUNT = BRUT_MODULE_WINDOW * BRUT_CHANNELS_PER_MODULE;
const CHANNEL_DEPTH = 0.07;

const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const scratchScale = new THREE.Vector3();
const scratchMatrix = new THREE.Matrix4();
const scratchColor = new THREE.Color();
const scratchPoint = { x: 0, y: 0, z: 0 };

const BrutLightChannels: React.FC<BrutLightChannelsProps> = ({ patternSeed, palette, audioBands, staticMode }) => {
    const { camera } = useThree();
    const stripRef = useRef<THREE.InstancedMesh>(null);
    const glowRef = useRef<THREE.InstancedMesh>(null);
    const baseRef = useRef(Number.NaN);
    const slotModulesRef = useRef<number[]>(new Array(BRUT_MODULE_WINDOW).fill(Number.NaN));
    const heightsRef = useRef(new Float32Array(CHANNEL_COUNT));
    const phasesRef = useRef(new Float32Array(CHANNEL_COUNT));
    const bassEnvelopeRef = useRef(0);
    const midEnvelopeRef = useRef(0);
    const sweepRef = useRef(0);

    const channels = useMemo(() => createBrutModuleChannels(), []);
    const glowTexture = useMemo(() => createBrutRadialSpriteTexture(0.4), []);
    const channelColor = useMemo(() => new THREE.Color(palette.channel), [palette.channel]);
    useEffect(() => () => glowTexture.dispose(), [glowTexture]);
    useEffect(() => {
        baseRef.current = Number.NaN;
        slotModulesRef.current.fill(Number.NaN);
    }, [patternSeed]);

    useFrame((_, delta) => {
        const strip = stripRef.current;
        const glow = glowRef.current;
        if (!strip || !glow) return;

        const cameraY = camera.position.y;
        const base = Math.floor(cameraY / BRUT_MODULE_HEIGHT) - BRUT_MODULE_BELOW;

        if (base !== baseRef.current) {
            const slots = slotModulesRef.current;
            for (let slot = 0; slot < BRUT_MODULE_WINDOW; slot += 1) {
                const moduleIndex = base + slot;
                if (slots[slot] === moduleIndex) continue;
                slots[slot] = moduleIndex;
                fillBrutModuleChannels(channels, patternSeed, moduleIndex);

                for (let index = 0; index < BRUT_CHANNELS_PER_MODULE; index += 1) {
                    const channel = channels[index];
                    const instance = slot * BRUT_CHANNELS_PER_MODULE + index;
                    const width = channel.vertical ? BRUT_CHANNEL_THICKNESS : channel.length;
                    const height = channel.vertical ? channel.length : BRUT_CHANNEL_THICKNESS;

                    brutFacePointToWorld(channel.face, channel.lateral, channel.y, CHANNEL_DEPTH, scratchPoint);
                    scratchPosition.set(scratchPoint.x, scratchPoint.y, scratchPoint.z);
                    scratchEuler.set(0, resolveBrutFaceAngle(channel.face), 0);
                    scratchQuaternion.setFromEuler(scratchEuler);
                    scratchScale.set(width, height, 0.05);
                    scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
                    strip.setMatrixAt(instance, scratchMatrix);

                    brutFacePointToWorld(channel.face, channel.lateral, channel.y, CHANNEL_DEPTH + 0.02, scratchPoint);
                    scratchPosition.set(scratchPoint.x, scratchPoint.y, scratchPoint.z);
                    scratchScale.set(width + 0.72, height + 0.72, 1);
                    scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
                    glow.setMatrixAt(instance, scratchMatrix);

                    heightsRef.current[instance] = channel.y;
                    phasesRef.current[instance] = channel.phase;
                }
            }
            strip.instanceMatrix.needsUpdate = true;
            glow.instanceMatrix.needsUpdate = true;
            baseRef.current = base;
        }

        bassEnvelopeRef.current = staticMode
            ? 0.35
            : stepBrutAudioEnvelope(bassEnvelopeRef.current, audioBands?.bass?.get() ?? 0, delta, 12, 3.2);
        midEnvelopeRef.current = staticMode
            ? 0.35
            : stepBrutAudioEnvelope(midEnvelopeRef.current, audioBands?.mid?.get() ?? 0, delta, 7, 2.2);
        if (!staticMode) {
            sweepRef.current = (sweepRef.current + delta * (0.12 + midEnvelopeRef.current * 0.5)) % 1;
        }

        const pulse = resolveBrutChannelIntensity(bassEnvelopeRef.current);
        const heights = heightsRef.current;
        const phases = phasesRef.current;
        for (let instance = 0; instance < CHANNEL_COUNT; instance += 1) {
            const offset = Math.abs(((phases[instance] - sweepRef.current) % 1 + 1) % 1 - 0.5) * 2;
            const travelling = 0.55 + (1 - offset) * 0.9;
            const depth = 0.35 + resolveBrutDepthBrightness(heights[instance], cameraY) * 0.9;
            const level = pulse * travelling * depth;
            scratchColor.setRGB(channelColor.r * level, channelColor.g * level, channelColor.b * level);
            strip.setColorAt(instance, scratchColor);
            scratchColor.multiplyScalar(0.55);
            glow.setColorAt(instance, scratchColor);
        }
        if (strip.instanceColor) strip.instanceColor.needsUpdate = true;
        if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
    });

    return (
        <>
            <instancedMesh ref={stripRef} args={[undefined, undefined, CHANNEL_COUNT]} frustumCulled={false} renderOrder={1}>
                <boxGeometry args={[1, 1, 1]} />
                <meshBasicMaterial toneMapped={false} fog={false} />
            </instancedMesh>
            <instancedMesh ref={glowRef} args={[undefined, undefined, CHANNEL_COUNT]} frustumCulled={false} renderOrder={4}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial
                    map={glowTexture}
                    transparent
                    opacity={0.55}
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                    fog={false}
                    toneMapped={false}
                />
            </instancedMesh>
        </>
    );
};

export default BrutLightChannels;
