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
import { updatePaperShaderUniforms } from '../../../../utils/paperShaderUniforms';
import { createPaperShaderReleaseRef, PAPER_SHADER_CONTEXT_ATTRIBUTES } from '../../../../utils/paperShaderContext';
import { useFirstFrameDrawn } from '../../styleTransition/firstFrame';
import { useBlendedColors } from '../useBlendedColors';
import { beatImpact, downbeatImpact } from '../../../../stores/motionSignals';
import { getBeatEffectStrength, isBeatFxReady } from '../../../../services/beatFx/beatFxLive';
import { BEAT_EFFECT_IDS } from '../../../../services/beatFx/beatEffects';

// src/components/visualizer/backgrounds/latent/LatentBackground.tsx
// Layers two cover-colored Paper shaders and drives their uniforms without React frame updates.
//
// 智能动感模式: once the playing track's beats are in (beatFxLive's `isBeatFxReady`, which is only
// ever true while the switch is on), the speed pulse follows beat_this' beats instead of the band
// onset guess - the larger of the beat and downbeat envelopes, already scaled by the 轻拍 / 重拍
// strengths - on top of the same broadband energy. Until then, and with the switch off, the frame is
// the original one.

interface LatentBackgroundProps {
    theme: Theme;
    coverUrl?: string | null;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    staticMode: boolean;
    paused: boolean;
    tuning?: LatentBackgroundTuning;
    /** How long new colours take to blend in (useBlendedColors); 0 or left out, at once. */
    blendMs?: number;
}

const MAX_SHADER_PIXELS = 1280 * 720;
const PAUSED_SPEED_SCALE = 0.12;
// How fast the speed goes from playing to paused or back, as a time constant: settled in about a second.
const PAUSE_EASE_MS = 300;
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
/** The beat FX onset: the larger of the two envelopes the beat clock writes, each 0..2 once scaled. */
export const resolveLatentBeatFxPulse = (beat: number, downbeat: number) => Math.max(beat, downbeat);
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
    blendMs = 0,
}) => {
    const ditheringRef = useRef<PaperShaderElement | null>(null);
    const meshRef = useRef<PaperShaderElement | null>(null);
    // Stable callback refs: they also lose each shader's WebGL context when it unmounts.
    const ditheringShaderRef = useMemo(() => createPaperShaderReleaseRef(ditheringRef), []);
    const meshShaderRef = useMemo(() => createPaperShaderReleaseRef(meshRef), []);
    const ditheringLayerRef = useRef<HTMLDivElement | null>(null);
    const meshLayerRef = useRef<HTMLDivElement | null>(null);
    const pausedRef = useRef(paused);
    // How far the loop below has eased between paused (0) and playing (1). Outside the loop's effect,
    // so a re-run of it (a setting changed mid-ease) goes on from there.
    const playingRef = useRef(paused ? 0 : 1);
    const [coverColors, setCoverColors] = useState<string[]>([]);
    const tuning = tuningOverride ?? DEFAULT_LATENT_BACKGROUND_TUNING;
    const showDithering = tuning.displayMode !== 'mesh';
    const showMesh = tuning.displayMode !== 'dithering';
    pausedRef.current = paused;
    // A copy mounted for a change of type is ready once the cover's colours are read.
    const colorsDrawn = useFirstFrameDrawn();

    useEffect(() => {
        let active = true;

        if (!coverUrl) {
            setCoverColors([]);
            colorsDrawn();
            return () => {
                active = false;
            };
        }

        void extractRepresentativeColors(coverUrl, 6).then(colors => {
            if (active) {
                setCoverColors(colors);
                colorsDrawn();
            }
        });

        return () => {
            active = false;
        };
    }, [coverUrl, colorsDrawn]);

    // A new song's colours blend in where the host plays transitions: a second copy for the soft focus
    // would mount and compile both shaders again on every song change.
    const resolvedColors = useMemo(
        () => resolveLatentShaderColors(coverColors, theme, tuning.colorSource),
        [coverColors, theme, tuning.colorSource],
    );
    const blendedColors = useBlendedColors(
        [theme.backgroundColor, resolvedColors.ditheringBack, resolvedColors.ditheringFront, ...resolvedColors.mesh],
        blendMs,
    );
    const [backgroundColor, ditheringBack, ditheringFront] = blendedColors;
    const shaderColors = useMemo(
        () => ({ ditheringBack, ditheringFront, mesh: blendedColors.slice(3) }),
        [blendedColors, ditheringBack, ditheringFront],
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
        // The full-screen layers' last written styles: once the smoothed audio settles (paused,
        // silence) the strings stop changing, and the layers are left alone instead of being
        // handed the same filter every frame.
        const writtenStyles = new WeakMap<HTMLElement, Partial<Record<'opacity' | 'transform' | 'filter', string>>>();
        const writeLayerStyle = (element: HTMLElement, property: 'opacity' | 'transform' | 'filter', value: string) => {
            let written = writtenStyles.get(element);
            if (!written) {
                written = {};
                writtenStyles.set(element, written);
            }
            if (written[property] === value) return;
            written[property] = value;
            element.style[property] = value;
        };
        let smoothedPower = 0;
        let smoothedBass = 0;
        let smoothedMid = 0;
        let smoothedBeatSpeed = 0;
        let previousBeatEnergy = 0;
        let latentOnsetPulse = 0;
        // A pause slows the fluid over about a second and play speeds it up the same way, as the sound
        // does: a pause of a moment (the player reads paused while the next track loads) is not a
        // stop and a lurch.
        let lastFrameAt: number | null = null;
        const speedOf = (baseSpeed: number, audioSpeed: number) => easeTowards(
            resolveLatentShaderSpeed(baseSpeed, audioSpeed, smoothedBeatSpeed, true),
            resolveLatentShaderSpeed(baseSpeed, audioSpeed, smoothedBeatSpeed, false),
            playingRef.current,
        );

        // Keep audio-rate changes inside the shader/DOM layer so React only rerenders on palette changes.
        const updateAudioResponse = (frameAt: number) => {
            // Asked for first, so that in the next frame this runs ahead of the shader mounts' own
            // frame callbacks: the uniforms written below (updatePaperShaderUniforms, which leaves the
            // drawing to a running shader's own loop) are then in the frame that loop draws.
            animationFrame = requestAnimationFrame(updateAudioResponse);

            const isPaused = pausedRef.current;
            // By the time since the last frame: as fast at any frame rate.
            const pauseStep = lastFrameAt === null ? 0 : 1 - Math.exp((lastFrameAt - frameAt) / PAUSE_EASE_MS);
            lastFrameAt = frameAt;
            playingRef.current = easeTowards(playingRef.current, isPaused ? 0 : 1, pauseStep);
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
            // The band onset keeps tracking while the beats drive the pulse, so falling back (a track
            // with no beats) picks up from the current state rather than from a stale one.
            latentOnsetPulse = tuning.enhancedBeatResponse
                ? resolveLatentOnsetPulse(
                    targetBeatEnergy,
                    previousBeatEnergy,
                    latentOnsetPulse,
                )
                : 0;
            previousBeatEnergy = targetBeatEnergy;
            // The beats are the onset, whether or not the band onset was turned on: switching
            // 智能动感模式 on is asking for the beat response.
            // Only while 潮汐脉动 plays (retired 2026-10-17: the original pulse even under a mode whose
            // own effect has the beats in).
            const beatSpeedTarget = !isPaused && isBeatFxReady() && getBeatEffectStrength(BEAT_EFFECT_IDS.latentPulse) > 0
                ? resolveLatentBeatSpeedTarget(
                    targetBeatEnergy,
                    resolveLatentBeatFxPulse(beatImpact.get(), downbeatImpact.get()),
                )
                : resolveLatentAudioSpeedTarget(
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

            if (currentDitheringMount) {
                const ditheringSpeed = speedOf(tuning.ditheringSpeed, tuning.ditheringAudioSpeed);
                currentDitheringMount.setSpeed(ditheringSpeed);
                updatePaperShaderUniforms(currentDitheringMount, {
                    u_pxSize: Math.max(0.5, tuning.ditheringSize - smoothedBass * tuning.ditheringSize * 0.34),
                }, ditheringSpeed !== 0);
            }
            if (currentMeshMount) {
                const meshSpeed = speedOf(tuning.meshSpeed, tuning.meshAudioSpeed);
                currentMeshMount.setSpeed(meshSpeed);
                updatePaperShaderUniforms(currentMeshMount, {
                    u_distortion: tuning.meshDistortion + smoothedPower * 0.62,
                    u_swirl: tuning.meshSwirl + smoothedMid * 0.38,
                }, meshSpeed !== 0);
            }

            if (ditheringLayerRef.current) {
                writeLayerStyle(ditheringLayerRef.current, 'opacity', showMesh
                    ? `${Math.min(1, tuning.ditheringOpacity + smoothedBass * 0.25)}`
                    : '1');
                writeLayerStyle(ditheringLayerRef.current, 'transform', `scale(${1.015 + smoothedBass * 0.025})`);
            }
            if (meshLayerRef.current) {
                writeLayerStyle(meshLayerRef.current, 'filter', `saturate(${1.04 + smoothedMid * 0.34}) brightness(${0.94 + smoothedPower * 0.16})`);
                writeLayerStyle(meshLayerRef.current, 'transform', `scale(${1.025 + smoothedPower * 0.018})`);
            }
        };

        animationFrame = requestAnimationFrame(updateAudioResponse);
        return () => cancelAnimationFrame(animationFrame);
    }, [audioBands, audioPower, showMesh, staticMode, tuning]);

    // The shaders' `speed` prop is only where they start, and 0 where static: the frame loop sets the
    // speed from there and eases a pause in. A prop that followed `paused` would set it at once.
    return (
        <div
            className="absolute inset-0 z-0 overflow-hidden"
            style={{ backgroundColor, pointerEvents: 'none' }}
        >
            {showMesh && (
                <div
                    ref={meshLayerRef}
                    className="absolute inset-0"
                    style={{ transform: 'scale(1.025)', transformOrigin: 'center' }}
                >
                    <MeshGradient
                        ref={meshShaderRef}
                        width="100%"
                        height="100%"
                        colors={shaderColors.mesh}
                        distortion={tuning.meshDistortion}
                        swirl={tuning.meshSwirl}
                        grainMixer={0}
                        grainOverlay={0.01}
                        speed={staticMode ? 0 : tuning.meshSpeed}
                        minPixelRatio={1}
                        maxPixelCount={MAX_SHADER_PIXELS}
                        webGlContextAttributes={PAPER_SHADER_CONTEXT_ATTRIBUTES}
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
                        ref={ditheringShaderRef}
                        width="100%"
                        height="100%"
                        colorBack={shaderColors.ditheringBack}
                        colorFront={shaderColors.ditheringFront}
                        shape="warp"
                        type="4x4"
                        size={tuning.ditheringSize}
                        speed={staticMode ? 0 : tuning.ditheringSpeed}
                        minPixelRatio={1}
                        maxPixelCount={MAX_SHADER_PIXELS}
                        webGlContextAttributes={PAPER_SHADER_CONTEXT_ATTRIBUTES}
                        style={{ width: '100%', height: '100%' }}
                    />
                </div>
            )}
            {tuning.overlayEnabled && tuning.overlayOpacity > 0 && (
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundColor,
                        opacity: tuning.overlayOpacity,
                    }}
                />
            )}
        </div>
    );
};

export default React.memo(LatentBackground);
