import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PaperShaderElement } from '@paper-design/shaders';
import { Dithering, MeshGradient } from '@paper-design/shaders-react';
import type { MotionValue } from 'framer-motion';
import {
    DEFAULT_LATENT_BACKGROUND_TUNING,
    type AudioBands,
    type LatentBackgroundTuning,
    type Theme,
} from '../../../../types';
import { extractColors } from '../../../../utils/colorExtractor';

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
const normalizeAudio = (value: number) => Math.min(1, Math.max(0, value / 255));
const clampShaderSpeed = (value: number) => Math.min(2, Math.max(0, value));
const easeTowards = (current: number, target: number, amount: number) => (
    current + (target - current) * amount
);

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
    const [coverColors, setCoverColors] = useState<string[]>([]);
    const tuning = tuningOverride ?? DEFAULT_LATENT_BACKGROUND_TUNING;
    const showDithering = tuning.displayMode !== 'mesh';
    const showMesh = tuning.displayMode !== 'dithering';

    useEffect(() => {
        let active = true;

        if (!coverUrl) {
            setCoverColors([]);
            return () => {
                active = false;
            };
        }

        void extractColors(coverUrl, 2).then(colors => {
            if (active) {
                setCoverColors(colors);
            }
        });

        return () => {
            active = false;
        };
    }, [coverUrl]);

    const primaryCoverColor = coverColors[0] ?? theme.secondaryColor;
    const secondaryCoverColor = coverColors[1] ?? theme.primaryColor;
    const meshColors = useMemo(
        () => [
            primaryCoverColor,
            secondaryCoverColor,
            theme.backgroundColor,
            theme.accentColor,
        ],
        [primaryCoverColor, secondaryCoverColor, theme.accentColor, theme.backgroundColor],
    );

    useEffect(() => {
        const ditheringMount = ditheringRef.current?.paperShaderMount;
        const meshMount = meshRef.current?.paperShaderMount;

        if (staticMode || paused) {
            ditheringMount?.setSpeed(0);
            meshMount?.setSpeed(0);
            return;
        }

        let animationFrame = 0;
        let smoothedPower = 0;
        let smoothedBass = 0;
        let smoothedMid = 0;

        // Keep audio-rate changes inside the shader/DOM layer so React only rerenders on palette changes.
        const updateAudioResponse = () => {
            smoothedPower = easeTowards(smoothedPower, normalizeAudio(audioPower.get()), 0.12);
            smoothedBass = easeTowards(smoothedBass, normalizeAudio(audioBands.bass.get()), 0.16);
            smoothedMid = easeTowards(
                smoothedMid,
                normalizeAudio(Math.max(audioBands.mid.get(), audioBands.vocal.get())),
                0.13,
            );

            const currentDitheringMount = ditheringRef.current?.paperShaderMount;
            const currentMeshMount = meshRef.current?.paperShaderMount;

            currentDitheringMount?.setSpeed(clampShaderSpeed(
                easeTowards(tuning.ditheringSpeed, tuning.ditheringAudioSpeed, smoothedBass),
            ));
            currentDitheringMount?.setUniforms({
                u_pxSize: Math.max(0.5, tuning.ditheringSize - smoothedBass * tuning.ditheringSize * 0.34),
            });
            currentMeshMount?.setSpeed(clampShaderSpeed(
                easeTowards(tuning.meshSpeed, tuning.meshAudioSpeed, smoothedPower),
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
    }, [audioBands, audioPower, paused, showMesh, staticMode, tuning]);

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
                        colors={meshColors}
                        distortion={tuning.meshDistortion}
                        swirl={tuning.meshSwirl}
                        grainMixer={0}
                        grainOverlay={0}
                        speed={staticMode || paused ? 0 : tuning.meshSpeed}
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
                        colorBack={theme.backgroundColor}
                        colorFront={primaryCoverColor}
                        shape="warp"
                        type="4x4"
                        size={tuning.ditheringSize}
                        speed={staticMode || paused ? 0 : tuning.ditheringSpeed}
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
