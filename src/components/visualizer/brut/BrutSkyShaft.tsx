import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { type MotionValue } from 'framer-motion';
import * as THREE from 'three';
import { type AudioBands } from '../../../types';
import {
    BRUT_MOUTH_LEAD_END,
    BRUT_MOUTH_LEAD_START,
    BRUT_SHAFT_HALF,
} from './brutConstants';
import { stepBrutAudioEnvelope } from './brutLighting';
import { type BrutPalette } from './brutPalette';
import { createBrutBeamFalloffTexture, createBrutRadialSpriteTexture } from './brutTextures';

// src/components/visualizer/brut/BrutSkyShaft.tsx
// The mouth of the well and its light shafts.
//
// The beams are FAKED with additive open cylinders rather than a post-processing god-ray pass: the
// registry eagerly bundles every visualizer entry, so importing an EffectComposer stack would ship
// it to every user for one mode, and a screen-space god-ray needs its sun on screen - ours sits at
// or past the top edge for most of the shot, so it would pop in and out with the camera pitch.
// Every additive material here sets fog:false, or linear fog would wash it grey.

interface BrutSkyShaftProps {
    currentTime: MotionValue<number>;
    songStart: number;
    songEnd: number;
    palette: BrutPalette;
    audioBands: AudioBands;
    staticMode: boolean;
}

const CONE_COUNT = 3;
const CONE_HEIGHT = 52;
const DAYLIGHT_TILT = 0.34;

const BrutSkyShaft: React.FC<BrutSkyShaftProps> = ({
    currentTime,
    songStart,
    songEnd,
    palette,
    audioBands,
    staticMode,
}) => {
    const { camera } = useThree();
    const groupRef = useRef<THREE.Group>(null);
    const mouthRef = useRef<THREE.Mesh>(null);
    const flareRef = useRef<THREE.Mesh>(null);
    const conesRef = useRef<THREE.Group>(null);
    const midEnvelopeRef = useRef(0);
    const bassEnvelopeRef = useRef(0);
    const leadRef = useRef(BRUT_MOUTH_LEAD_START);

    const beamTexture = useMemo(() => createBrutBeamFalloffTexture(), []);
    const flareTexture = useMemo(() => createBrutRadialSpriteTexture(0.42), []);
    useEffect(() => () => {
        beamTexture.dispose();
        flareTexture.dispose();
    }, [beamTexture, flareTexture]);

    const cones = useMemo(
        () => Array.from({ length: CONE_COUNT }, (_, index) => ({
            angle: (index / CONE_COUNT) * Math.PI * 2,
            radius: 1.1 + index * 0.7,
            scale: 0.7 + index * 0.22,
        })),
        [],
    );

    useFrame((_, delta) => {
        const group = groupRef.current;
        if (!group) return;

        const now = currentTime.get();
        const span = Math.max(1, songEnd - songStart);
        const songProgress = THREE.MathUtils.clamp((now - songStart) / span, 0, 1);
        const targetLead = BRUT_MOUTH_LEAD_START + (BRUT_MOUTH_LEAD_END - BRUT_MOUTH_LEAD_START) * songProgress;
        leadRef.current += (targetLead - leadRef.current) * (1 - Math.exp(-delta * 0.6));
        group.position.y = camera.position.y;

        midEnvelopeRef.current = staticMode
            ? 0.4
            : stepBrutAudioEnvelope(midEnvelopeRef.current, audioBands?.mid?.get() ?? 0, delta, 7, 2.2);
        bassEnvelopeRef.current = staticMode
            ? 0.4
            : stepBrutAudioEnvelope(bassEnvelopeRef.current, audioBands?.bass?.get() ?? 0, delta, 12, 3.2);

        const mouth = mouthRef.current;
        if (mouth) {
            mouth.position.y = leadRef.current;
        }

        const flare = flareRef.current;
        if (flare) {
            flare.position.y = leadRef.current - 1.6;
            const pulse = 1 + bassEnvelopeRef.current * 0.12;
            flare.scale.setScalar(BRUT_SHAFT_HALF * 2.4 * pulse);
            (flare.material as THREE.MeshBasicMaterial).opacity = 0.32 + bassEnvelopeRef.current * 0.24;
        }

        const coneGroup = conesRef.current;
        if (coneGroup) {
            coneGroup.position.y = leadRef.current - CONE_HEIGHT / 2 + 4;
            if (!staticMode) {
                coneGroup.rotation.y += delta * 0.035;
            }
            coneGroup.children.forEach((child) => {
                const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
                material.opacity = 0.16 + midEnvelopeRef.current * 0.22;
            });
        }
    });

    return (
        <group ref={groupRef}>
            <mesh ref={mouthRef} rotation={[Math.PI / 2, 0, 0]}>
                <planeGeometry args={[BRUT_SHAFT_HALF * 2.02, BRUT_SHAFT_HALF * 2.02]} />
                <meshBasicMaterial color={palette.sky} fog={false} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh ref={flareRef} rotation={[Math.PI / 2, 0, 0]}>
                <planeGeometry args={[1, 1]} />
                <meshBasicMaterial
                    map={flareTexture}
                    color={palette.sky}
                    transparent
                    opacity={0.32}
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                    fog={false}
                    side={THREE.DoubleSide}
                />
            </mesh>
            <group ref={conesRef} rotation={[0, 0, DAYLIGHT_TILT]}>
                {cones.map(cone => (
                    <mesh
                        key={cone.angle}
                        position={[Math.cos(cone.angle) * cone.radius, 0, Math.sin(cone.angle) * cone.radius]}
                        renderOrder={4}
                    >
                        <cylinderGeometry args={[0.7 * cone.scale, 5.6 * cone.scale, CONE_HEIGHT, 12, 1, true]} />
                        <meshBasicMaterial
                            map={beamTexture}
                            color={palette.daylight}
                            transparent
                            opacity={0.18}
                            depthWrite={false}
                            blending={THREE.AdditiveBlending}
                            fog={false}
                            side={THREE.DoubleSide}
                        />
                    </mesh>
                ))}
            </group>
        </group>
    );
};

export default BrutSkyShaft;
