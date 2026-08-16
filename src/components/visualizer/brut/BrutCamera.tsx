import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { type MotionValue } from 'framer-motion';
import * as THREE from 'three';
import { type Line } from '../../../types';
import {
    BRUT_EYE_LEAD,
    BRUT_FRAME_SCREEN_FILL,
    BRUT_LINE_RISE,
    BRUT_ORBIT_MAX,
    BRUT_ORBIT_MIN,
    BRUT_ORBIT_RADIUS,
    BRUT_SEEK_JUMP_LINES,
    BRUT_SHAFT_HALF,
} from './brutConstants';
import { brutFacePointToWorld, resolveBrutFaceYaw } from './brutFaceBasis';
import { resolveBrutAnchorPlacement, type BrutPlacementTable } from './brutLyricPlacement';
import { resolveBrutDaylightIntensity, stepBrutAudioEnvelope } from './brutLighting';
import { type BrutPalette } from './brutPalette';

// src/components/visualizer/brut/BrutCamera.tsx
// Ascends the shaft and carries the daylight rig, driven straight from playback MotionValues.
// No React state, no allocation inside useFrame.

interface BrutCameraProps {
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    lines: Line[];
    table: BrutPlacementTable;
    audioPower: MotionValue<number>;
    staticMode: boolean;
    palette: BrutPalette;
    activeFrameRef: React.MutableRefObject<{ width: number; height: number; }>;
}

const DRIFT_SPEED = 0.35;
const DRIFT_LIMIT = BRUT_LINE_RISE * 0.8;
const YAW_DAMPING = 2.6;
const YAW_MAX_RATE = 1.2;
const POSITION_DAMPING = 3.4;
const LOOK_DAMPING = 3.8;
const LOOK_LIFT = 3.2;
// Sideways offset along the active wall. Without it the camera sits square to one wall and the
// well reads as a single flat facade; this slides it far enough to keep a corner in frame.
const SIDE_STEP = 0.8;
// Daylight enters the well at a real angle rather than straight down: a vertical light would hit
// every wall at a grazing angle and leave the whole shaft unlit.
const DAYLIGHT_TILT = 0.62;

const scratchPoint = { x: 0, y: 0, z: 0 };
const frameTarget = new THREE.Vector3();
const upShaftTarget = new THREE.Vector3();
const desiredLook = new THREE.Vector3();

const BrutCamera: React.FC<BrutCameraProps> = ({
    currentTime,
    currentLineIndex,
    lines,
    table,
    audioPower,
    staticMode,
    palette,
    activeFrameRef,
}) => {
    const { camera } = useThree();
    const lightRef = useRef<THREE.DirectionalLight>(null);
    const lightTargetRef = useRef<THREE.Object3D>(null);
    const audioEnvelopeRef = useRef(0);
    const lastActiveIndexRef = useRef(Math.max(0, currentLineIndex));
    const renderedIndexRef = useRef(lastActiveIndexRef.current);
    const lookTargetRef = useRef(new THREE.Vector3(0, 0, 0));
    const yawRef = useRef(0);
    const driftRef = useRef(0);
    const orbitRef = useRef(BRUT_ORBIT_RADIUS);
    const lastPlaybackTimeRef = useRef(currentTime.get());

    if (currentLineIndex >= 0) lastActiveIndexRef.current = currentLineIndex;
    const anchor = useMemo(
        () => resolveBrutAnchorPlacement(table, lastActiveIndexRef.current),
        // lastActiveIndexRef only moves when currentLineIndex does, so this stays in sync.
        [table, currentLineIndex],
    );

    // The light's target has to be an object in the scene graph, so it is wired after mount.
    useEffect(() => {
        if (lightRef.current && lightTargetRef.current) {
            lightRef.current.target = lightTargetRef.current;
        }
    }, []);

    useFrame((_, delta) => {
        const index = lastActiveIndexRef.current;
        const line = lines[index];
        const playbackTime = currentTime.get();
        const playbackDelta = Math.max(0, Math.min(0.25, playbackTime - lastPlaybackTimeRef.current));
        lastPlaybackTimeRef.current = playbackTime;

        const duration = Math.max(0.4, (line?.endTime ?? 0) - (line?.startTime ?? 0));
        const hasActiveLine = Boolean(line) && currentLineIndex >= 0;
        const progress = staticMode || !line
            ? 0
            : THREE.MathUtils.clamp((playbackTime - line.startTime) / duration, 0, 1);

        // Instrumental gaps keep the ascent alive without ever accumulating across a seek.
        if (staticMode || hasActiveLine) {
            driftRef.current *= Math.exp(-delta * 2.2);
        } else {
            driftRef.current = Math.min(DRIFT_LIMIT, driftRef.current + playbackDelta * DRIFT_SPEED);
        }

        const anchorY = anchor?.y ?? 0;
        // The rise within a line stays under one full line step, so the eye never crosses the active
        // sign's own height - crossing it is exactly when a wall-mounted sign goes edge-on.
        const targetY = anchorY + progress * BRUT_LINE_RISE * 0.35 + BRUT_EYE_LEAD + driftRef.current;
        const isLargeSeek = Math.abs(index - renderedIndexRef.current) > BRUT_SEEK_JUMP_LINES;

        const face = anchor?.face ?? 0;
        const desiredYaw = resolveBrutFaceYaw(face, yawRef.current);
        if (isLargeSeek) {
            yawRef.current = desiredYaw;
            driftRef.current = 0;
        } else {
            const step = (desiredYaw - yawRef.current) * (1 - Math.exp(-delta * YAW_DAMPING));
            const maxStep = YAW_MAX_RATE * delta;
            yawRef.current += THREE.MathUtils.clamp(step, -maxStep, maxStep);
        }

        // Distance at which the scattered block fills BRUT_FRAME_SCREEN_FILL of the frame. A scatter
        // is nearly as tall as it is wide, so the vertical extent has to be fitted too.
        const perspective = camera as THREE.PerspectiveCamera;
        const halfHeightTangent = Math.max(0.2, Math.tan(THREE.MathUtils.degToRad(perspective.fov ?? 60) / 2));
        const halfWidthTangent = halfHeightTangent * (perspective.aspect || 1.6);
        const fit = BRUT_FRAME_SCREEN_FILL * 2;
        const wanted = Math.max(
            activeFrameRef.current.width / (fit * halfWidthTangent),
            activeFrameRef.current.height / (fit * halfHeightTangent),
        );
        const wantedOrbit = THREE.MathUtils.clamp(wanted - BRUT_SHAFT_HALF, BRUT_ORBIT_MIN, BRUT_ORBIT_MAX);
        orbitRef.current = isLargeSeek
            ? wantedOrbit
            : orbitRef.current + (wantedOrbit - orbitRef.current) * (1 - Math.exp(-delta * 1.8));

        const yaw = yawRef.current;
        const side = (anchor?.lateral ?? 0) >= 0 ? -SIDE_STEP : SIDE_STEP;
        const orbitX = Math.sin(yaw) * orbitRef.current + Math.cos(yaw) * side;
        const orbitZ = Math.cos(yaw) * orbitRef.current - Math.sin(yaw) * side;
        const positionDamping = 1 - Math.exp(-delta * POSITION_DAMPING);
        camera.position.y = isLargeSeek ? targetY : THREE.MathUtils.lerp(camera.position.y, targetY, positionDamping);
        camera.position.x = isLargeSeek ? orbitX : THREE.MathUtils.lerp(camera.position.x, orbitX, positionDamping);
        camera.position.z = isLargeSeek ? orbitZ : THREE.MathUtils.lerp(camera.position.z, orbitZ, positionDamping);

        // Early in a line the eye is on the frame; later it lifts up the shaft. The lift target stays
        // on the wall rather than on the axis, so the view direction never becomes parallel to `up`.
        brutFacePointToWorld(face, anchor?.lateral ?? 0, anchorY, 0.6, scratchPoint);
        frameTarget.set(scratchPoint.x, scratchPoint.y, scratchPoint.z);
        brutFacePointToWorld(face, (anchor?.lateral ?? 0) * 0.3, camera.position.y + LOOK_LIFT, 0, scratchPoint);
        upShaftTarget.set(scratchPoint.x, scratchPoint.y, scratchPoint.z);
        const frameWeight = 0.82 - 0.3 * progress;
        desiredLook.copy(frameTarget).multiplyScalar(frameWeight).addScaledVector(upShaftTarget, 1 - frameWeight);

        if (isLargeSeek) {
            lookTargetRef.current.copy(desiredLook);
        } else {
            lookTargetRef.current.lerp(desiredLook, 1 - Math.exp(-delta * LOOK_DAMPING));
        }

        // Roll has to be applied through `up`, because lookAt overwrites the camera rotation.
        const roll = staticMode ? 0 : (anchor?.roll ?? 0);
        camera.up.set(Math.sin(roll) * Math.cos(yaw), Math.cos(roll), -Math.sin(roll) * Math.sin(yaw));
        camera.lookAt(lookTargetRef.current);
        renderedIndexRef.current = index;

        const light = lightRef.current;
        const lightTarget = lightTargetRef.current;
        if (light && lightTarget) {
            audioEnvelopeRef.current = stepBrutAudioEnvelope(audioEnvelopeRef.current, audioPower.get(), delta);
            light.position.set(Math.sin(DAYLIGHT_TILT) * 16, camera.position.y + 15, Math.cos(DAYLIGHT_TILT) * 16);
            lightTarget.position.set(0, camera.position.y - 2, 0);
            light.intensity = resolveBrutDaylightIntensity(audioEnvelopeRef.current);
            lightTarget.updateMatrixWorld();
        }
    });

    return (
        <>
            <object3D ref={lightTargetRef} />
            <directionalLight
                ref={lightRef}
                color={palette.daylight}
                castShadow
                shadow-mapSize-width={1024}
                shadow-mapSize-height={1024}
                shadow-bias={-0.0004}
                shadow-normalBias={0.02}
                shadow-camera-left={-7}
                shadow-camera-right={7}
                shadow-camera-top={9}
                shadow-camera-bottom={-9}
                shadow-camera-near={0.5}
                shadow-camera-far={44}
            />
        </>
    );
};

export default BrutCamera;
