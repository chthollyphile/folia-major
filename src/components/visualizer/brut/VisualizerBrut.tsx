import React from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { useVisualizerRuntime } from '../runtime';
import { type VisualizerSharedProps } from '../definition';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import BrutScene from './BrutScene';

// src/components/visualizer/brut/VisualizerBrut.tsx
// Hosts the experimental endless brutalist lyric wall while shared chrome and subtitles remain DOM UI.

const VisualizerBrut: React.FC<VisualizerSharedProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        subtitleTheme,
        audioPower,
        audioBands,
        showText = true,
        lyricsFontScale = 1,
        subtitleFontScale = 1,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        isPlayerChromeHidden = false,
        hideTranslationSubtitle = false,
        showSubtitleTranslation,
        subtitleContentMode,
        staticMode = false,
    } = props;
    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
    });

    return (
        <VisualizerShell theme={theme} audioPower={audioPower} audioBands={audioBands} sharedProps={props}>
            <div className="absolute inset-0 z-0">
                <Canvas
                    shadows
                    dpr={[1, 1.75]}
                    camera={{ position: [0, 0.25, 13.5], fov: 48, near: 0.1, far: 50 }}
                    gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
                    onCreated={({ gl }) => {
                        gl.shadowMap.type = THREE.PCFSoftShadowMap;
                    }}
                >
                    <BrutScene
                        currentTime={currentTime}
                        currentLineIndex={currentLineIndex}
                        lines={lines}
                        theme={theme}
                        audioPower={audioPower}
                        showText={showText}
                        staticMode={staticMode}
                        lyricsFontScale={lyricsFontScale}
                    />
                </Canvas>
            </div>
            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={recentCompletedLine}
                nextLines={nextLines}
                theme={theme}
                subtitleTheme={subtitleTheme}
                translationFontSize="clamp(1rem, 2.2vw, 1.25rem)"
                upcomingFontSize="clamp(0.8rem, 1.7vw, 1rem)"
                subtitleOverlayOpacity={subtitleOverlayOpacity}
                subtitleOverlayBackground={subtitleOverlayBackground}
                subtitleFontScale={subtitleFontScale}
                isPlayerChromeHidden={isPlayerChromeHidden}
                hideTranslationSubtitle={hideTranslationSubtitle}
                showSubtitleTranslation={showSubtitleTranslation}
                subtitleContentMode={subtitleContentMode}
            />
        </VisualizerShell>
    );
};

export default VisualizerBrut;
