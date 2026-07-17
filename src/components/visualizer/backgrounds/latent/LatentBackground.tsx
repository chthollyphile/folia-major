import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PaperShaderElement } from '@paper-design/shaders';
import { Dithering, MeshGradient } from '@paper-design/shaders-react';
import type { MotionValue } from 'framer-motion';
import {
    DEFAULT_LATENT_BACKGROUND_TUNING,
    type AudioBands,
    type LatentBackgroundColorSource,
    type LatentBackgroundTuning,
    type Theme,
} from '../../../../types';
import { extractRepresentativeColors } from '../../../../utils/colorExtractor';

// src/components/visualizer/backgrounds/latent/LatentBackground.tsx
// Layers two cover-colored Paper shaders and drives their uniforms without React frame updates.

interface LatentBackgroundProps {
    theme: Theme;
    coverUrl?: string | null;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    staticMode: boolean;
    paused: boolean;
    tuning?: LatentBackgroundTuning;
}

const MAX_SHADER_PIXELS = 1280 * 720;
const PAUSED_SPEED_SCALE = 0.12;
const normalizeAudio = (value: number) => Math.min(1, Math.max(0, value / 255));
const clampShaderSpeed = (value: number) => Math.min(2, Math.max(0, value));
const clampAudioAmount = (value: number) => Math.min(1, Math.max(0, value));
const easeTowards = (current: number, target: number, amount: number) => (
    current + (target - current) * amount
);
export const resolveLatentBroadbandEnergy = (
    bass: number,
    lowMid: number,
    mid: number,
    vocal: number,
    treble: number,
) => {
    const broadbandEnergy = (
        normalizeAudio(bass) * 0.22
        + normalizeAudio(lowMid) * 0.18
        + normalizeAudio(mid) * 0.22
        + normalizeAudio(vocal) * 0.28
        + normalizeAudio(treble) * 0.1
    );
    return Math.pow(broadbandEnergy, 0.55);
};
// Accents broadband energy rises so shader speed lands on musical onsets instead of following loudness alone.
export const resolveLatentOnsetPulse = (
    currentEnergy: number,
    previousEnergy: number,
    previousPulse: number,
) => Math.max(
    previousPulse * 0.84,
    clampAudioAmount((currentEnergy - previousEnergy) * 7),
);
export const resolveLatentBeatSpeedTarget = (
    broadbandEnergy: number,
    onsetPulse: number,
) => clampAudioAmount(broadbandEnergy * 0.42 + onsetPulse * 0.85);
export const resolveLatentAudioSpeedTarget = (
    broadbandEnergy: number,
    onsetPulse: number,
    enhancedBeatResponse: boolean,
) => enhancedBeatResponse
    ? resolveLatentBeatSpeedTarget(broadbandEnergy, onsetPulse)
    : clampAudioAmount(broadbandEnergy);
export const resolveLatentShaderSpeed = (
    baseSpeed: number,
    audioSpeed: number,
    audioAmount: number,
    paused: boolean,
) => clampShaderSpeed(
    paused
        ? baseSpeed * PAUSED_SPEED_SCALE
        : easeTowards(baseSpeed, audioSpeed, audioAmount),
);
export const resolveLatentShaderColors = (
    coverColors: string[],
    theme: Theme,
    colorSource: LatentBackgroundColorSource,
) => {
    const primary = coverColors[0] ?? theme.secondaryColor;
    if (colorSource === 'cover-only') {
        const secondary = coverColors[1] ?? primary;
        const tertiary = coverColors[2] ?? secondary;
        const quaternary = coverColors[3] ?? primary;
        const quinary = coverColors[4] ?? secondary;
        const senary = coverColors[5] ?? tertiary;
        return {
            ditheringBack: tertiary,
            ditheringFront: primary,
            mesh: [primary, secondary, tertiary, quaternary, quinary, senary],
        };
    }
    const secondary = coverColors[1] ?? theme.primaryColor;
    const tertiary = coverColors[2] ?? primary;
    const quaternary = coverColors[3] ?? secondary;
    return {
        ditheringBack: theme.backgroundColor,
        ditheringFront: primary,
        mesh: [primary, secondary, tertiary, quaternary, theme.backgroundColor, theme.accentColor],
    };
};

const LatentBackground: React.FC<LatentBackgroundProps> = ({
    theme,
    coverUrl,
    audioPower,
    audioBands,
    staticMode,
    paused,
    tuning: tuningOverride,
}) => {
    const ditheringRef = useRef<PaperShaderElement | null>(null);
    const meshRef = useRef<PaperShaderElement | null>(null);
    const ditheringLayerRef = useRef<HTMLDivElement | null>(null);
    const meshLayerRef = useRef<HTMLDivElement | null>(null);
    const pausedRef = useRef(paused);
    const [coverColors, setCoverColors] = useState<string[]>([]);
    const tuning = tuningOverride ?? DEFAULT_LATENT_BACKGROUND_TUNING;
    const showDithering = tuning.displayMode !== 'mesh';
    const showMesh = tuning.displayMode !== 'dithering';
    pausedRef.current = paused;

    useEffect(() => {
        let active = true;

        if (!coverUrl) {
            setCoverColors([]);
            return () => {
                active = false;
            };
        }

        void extractRepresentativeColors(coverUrl, 6).then(colors => {
            if (active) {
                setCoverColors(colors);
            }
        });

        return () => {
            active = false;
        };
    }, [coverUrl]);

    const shaderColors = useMemo(
        () => resolveLatentShaderColors(coverColors, theme, tuning.colorSource),
        [coverColors, theme, tuning.colorSource],
    );

    useEffect(() => {
        const ditheringMount = ditheringRef.current?.paperShaderMount;
        const meshMount = meshRef.current?.paperShaderMount;

        if (staticMode) {
            ditheringMount?.setSpeed(0);
            meshMount?.setSpeed(0);
            return;
        }

        let animationFrame = 0;
        let smoothedPower = 0;
        let smoothedBass = 0;
        let smoothedMid = 0;
        let smoothedBeatSpeed = 0;
        let previousBeatEnergy = 0;
        let latentOnsetPulse = 0;

        // Keep audio-rate changes inside the shader/DOM layer so React only rerenders on palette changes.
        const updateAudioResponse = () => {
            const isPaused = pausedRef.current;
            const targetPower = isPaused ? 0 : normalizeAudio(audioPower.get());
            const targetBass = isPaused ? 0 : normalizeAudio(audioBands.bass.get());
            const targetBeatEnergy = isPaused
                ? 0
                : resolveLatentBroadbandEnergy(
                    audioBands.bass.get(),
                    audioBands.lowMid.get(),
                    audioBands.mid.get(),
                    audioBands.vocal.get(),
                    audioBands.treble.get(),
                );
            const targetMid = isPaused
                ? 0
                : normalizeAudio(Math.max(audioBands.mid.get(), audioBands.vocal.get()));
            smoothedPower = easeTowards(smoothedPower, targetPower, 0.12);
            smoothedBass = easeTowards(smoothedBass, targetBass, 0.16);
            smoothedMid = easeTowards(
                smoothedMid,
                targetMid,
                0.13,
            );
            latentOnsetPulse = tuning.enhancedBeatResponse
                ? resolveLatentOnsetPulse(
                    targetBeatEnergy,
                    previousBeatEnergy,
                    latentOnsetPulse,
                )
                : 0;
            previousBeatEnergy = targetBeatEnergy;
            const beatSpeedTarget = resolveLatentAudioSpeedTarget(
                targetBeatEnergy,
                latentOnsetPulse,
                tuning.enhancedBeatResponse,
            );
            smoothedBeatSpeed = easeTowards(
                smoothedBeatSpeed,
                beatSpeedTarget,
                beatSpeedTarget > smoothedBeatSpeed ? 0.42 : 0.14,
            );

            const currentDitheringMount = ditheringRef.current?.paperShaderMount;
            const currentMeshMount = meshRef.current?.paperShaderMount;

            currentDitheringMount?.setSpeed(resolveLatentShaderSpeed(
                tuning.ditheringSpeed,
                tuning.ditheringAudioSpeed,
                smoothedBeatSpeed,
                isPaused,
            ));
            currentDitheringMount?.setUniforms({
                u_pxSize: Math.max(0.5, tuning.ditheringSize - smoothedBass * tuning.ditheringSize * 0.34),
            });
            currentMeshMount?.setSpeed(resolveLatentShaderSpeed(
                tuning.meshSpeed,
                tuning.meshAudioSpeed,
                smoothedBeatSpeed,
                isPaused,
            ));
            currentMeshMount?.setUniforms({
                u_distortion: tuning.meshDistortion + smoothedPower * 0.62,
                u_swirl: tuning.meshSwirl + smoothedMid * 0.38,
            });

            if (ditheringLayerRef.current) {
                ditheringLayerRef.current.style.opacity = showMesh
                    ? `${Math.min(1, tuning.ditheringOpacity + smoothedBass * 0.25)}`
                    : '1';
                ditheringLayerRef.current.style.transform = `scale(${1.015 + smoothedBass * 0.025})`;
            }
            if (meshLayerRef.current) {
                meshLayerRef.current.style.filter = `saturate(${1.04 + smoothedMid * 0.34}) brightness(${0.94 + smoothedPower * 0.16})`;
                meshLayerRef.current.style.transform = `scale(${1.025 + smoothedPower * 0.018})`;
            }

            animationFrame = requestAnimationFrame(updateAudioResponse);
        };

        animationFrame = requestAnimationFrame(updateAudioResponse);
        return () => cancelAnimationFrame(animationFrame);
    }, [audioBands, audioPower, showMesh, staticMode, tuning]);

    return (
        <div
            className="absolute inset-0 z-0 overflow-hidden"
            style={{ backgroundColor: theme.backgroundColor, pointerEvents: 'none' }}
        >
            {showMesh && (
                <div
                    ref={meshLayerRef}
                    className="absolute inset-0"
                    style={{ transform: 'scale(1.025)', transformOrigin: 'center' }}
                >
                    <MeshGradient
                        ref={meshRef}
                        width="100%"
                        height="100%"
                        colors={shaderColors.mesh}
                        distortion={tuning.meshDistortion}
                        swirl={tuning.meshSwirl}
                        grainMixer={0}
                        grainOverlay={0}
                        speed={staticMode
                            ? 0
                            : resolveLatentShaderSpeed(tuning.meshSpeed, tuning.meshAudioSpeed, 0, paused)}
                        minPixelRatio={1}
                        maxPixelCount={MAX_SHADER_PIXELS}
                        style={{ width: '100%', height: '100%' }}
                    />
                </div>
            )}
            {showDithering && (
                <div
                    ref={ditheringLayerRef}
                    className="absolute inset-0"
                    style={{
                        mixBlendMode: showMesh ? 'soft-light' : 'normal',
                        opacity: showMesh ? tuning.ditheringOpacity : 1,
                        transform: 'scale(1.015)',
                        transformOrigin: 'center',
                    }}
                >
                    <Dithering
                        ref={ditheringRef}
                        width="100%"
                        height="100%"
                        colorBack={shaderColors.ditheringBack}
                        colorFront={shaderColors.ditheringFront}
                        shape="warp"
                        type="4x4"
                        size={tuning.ditheringSize}
                        speed={staticMode
                            ? 0
                            : resolveLatentShaderSpeed(tuning.ditheringSpeed, tuning.ditheringAudioSpeed, 0, paused)}
                        minPixelRatio={1}
                        maxPixelCount={MAX_SHADER_PIXELS}
                        style={{ width: '100%', height: '100%' }}
                    />
                </div>
            )}
            {tuning.overlayEnabled && tuning.overlayOpacity > 0 && (
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundColor: theme.backgroundColor,
                        opacity: tuning.overlayOpacity,
                    }}
                />
            )}
        </div>
    );
};

export default React.memo(LatentBackground);
