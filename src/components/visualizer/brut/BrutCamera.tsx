import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { type MotionValue } from 'framer-motion';
import * as THREE from 'three';
import { type Line } from '../../../types';
import { BRUT_LINE_SPACING } from './brutGeometry';
import { resolveBrutLightIntensity, stepBrutAudioEnvelope } from './brutLighting';

// src/components/visualizer/brut/BrutCamera.tsx
// Moves the camera and key light directly from playback MotionValues without React frame updates.

interface BrutCameraProps {
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    lines: Line[];
    audioPower: MotionValue<number>;
    staticMode: boolean;
}

const BrutCamera: React.FC<BrutCameraProps> = ({
    currentTime,
    currentLineIndex,
    lines,
    audioPower,
    staticMode,
}) => {
    const { camera } = useThree();
    const lightRef = useRef<THREE.SpotLight>(null);
    const audioEnvelopeRef = useRef(0);
    const lastActiveIndexRef = useRef(Math.max(0, currentLineIndex));
    const renderedIndexRef = useRef(lastActiveIndexRef.current);
    if (currentLineIndex >= 0) lastActiveIndexRef.current = currentLineIndex;

    useFrame((_, delta) => {
        const index = lastActiveIndexRef.current;
        const line = lines[index];
        const duration = Math.max(0.4, (line?.endTime ?? 0) - (line?.startTime ?? 0));
        const progress = staticMode || !line
            ? 0
            : THREE.MathUtils.clamp((currentTime.get() - line.startTime) / duration, 0, 1);
        const targetY = -(index + progress * 0.72) * BRUT_LINE_SPACING;
        const damping = 1 - Math.exp(-delta * 3.4);
        const isLargeSeek = Math.abs(index - renderedIndexRef.current) > 2;
        camera.position.y = isLargeSeek
            ? targetY + 0.25
            : THREE.MathUtils.lerp(camera.position.y, targetY + 0.25, damping);
        camera.position.x = THREE.MathUtils.lerp(camera.position.x, Math.sin((index + progress) * 0.72) * 0.52, damping);
        camera.lookAt(camera.position.x * 0.15, camera.position.y - 0.1, 0);
        renderedIndexRef.current = index;
        if (lightRef.current) {
            audioEnvelopeRef.current = stepBrutAudioEnvelope(audioEnvelopeRef.current, audioPower.get(), delta);
            lightRef.current.position.y = camera.position.y + 4.5;
            lightRef.current.target.position.y = camera.position.y - 1.1;
            lightRef.current.intensity = resolveBrutLightIntensity(audioEnvelopeRef.current);
            lightRef.current.target.updateMatrixWorld();
        }
    });

    return (
        <spotLight
            ref={lightRef}
            position={[-5.2, 4.5, 8]}
            angle={0.68}
            penumbra={0.5}
            distance={30}
            decay={1.55}
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
            shadow-radius={3}
            shadow-bias={-0.00025}
        />
    );
};

export default BrutCamera;
