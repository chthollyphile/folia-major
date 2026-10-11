// Only for the you who has yet to exist in this world.
// DO NOT REMOVE THE LINE ABOVE.
import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useMotionValue, animate, useSpring, motion } from 'framer-motion';
import { DEFAULT_CLADDAGH_TUNING } from '../../../types';
import { buildLineGraphemeTimeline } from '../../../utils/lyrics/graphemeTiming';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { type VisualizerSharedProps } from '../definition';
import { useVisualizerRuntime } from '../runtime';
import { colorWithAlpha, mixColors } from '../colorMix';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import { adjustCladdaghTimeline } from './claddaghTimeline';
import { buildMeasuredSpacingInfo } from './claddaghLayout';
import { RingLine } from './CladdaghRingLine';

// src/components/visualizer/claddagh/VisualizerCladdagh.tsx

const VisualizerCladdagh: React.FC<VisualizerSharedProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        subtitleTheme,
        showText = true,
        lyricsFontScale = 1.0,
        subtitleFontScale = 1,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        hideTranslationSubtitle,
        showSubtitleTranslation,
        subtitleContentMode,
        audioPower,
        audioBands,
        claddaghTuning = DEFAULT_CLADDAGH_TUNING,
        paused = false,
    } = props;

    const centerNormalTiltDeg = 90 - claddaghTuning.ellipseTiltDeg;

    const isRawScaleRef = useRef(false);
    const glowIntensityRef = useRef(0);
    const normalizePower = useCallback((power: number) => {
        if (!Number.isFinite(power)) return 0;
        if (power > 1.0) {
            isRawScaleRef.current = true;
        }
        return Math.max(0, Math.min(1, isRawScaleRef.current ? power / 255 : power));
    }, []);

    const { activeLine, upcomingLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
    });

    const isChorus = activeLine?.isChorus ?? false;

    const smoothedBass = useSpring(audioBands.bass, {
        stiffness: 150,
        damping: 25,
    });
    const smoothedVocal = useSpring(audioBands.vocal, {
        stiffness: 120,
        damping: 24,
    });
    const fontStack = resolveThemeFontStack(theme);
    const baseFontSize = 72 * lyricsFontScale;
    const fontWeight = resolveThemeFontWeight(theme, 700);
    const fontSpec = `${fontWeight} ${baseFontSize}px ${fontStack}`;

    const containerRef = useRef<HTMLDivElement>(null);
    const axisLineRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

    // Smoothly animate axis line color and scale in response to audio power
    useEffect(() => {
        const lineEl = axisLineRef.current;
        if (!lineEl) return;

        let frameId = 0;

        const updateColors = () => {
            const bassPower = paused ? 0 : normalizePower(smoothedBass.get());
            const vocalPower = paused ? 0 : normalizePower(smoothedVocal.get());
            const fromColor = theme.primaryColor || '#ffffff';
            let toColor = theme.accentColor || '#ffffff';
            // If primary and accent are the same, try secondary
            if (toColor === fromColor && theme.secondaryColor) {
                toColor = theme.secondaryColor;
            }
            // If still the same, mix with white to guarantee visual color change on beats
            if (toColor === fromColor) {
                toColor = '#ffffff';
            }

            // Color response (using maximum of bass and vocal energy for high responsiveness)
            const colorPower = Math.max(bassPower, vocalPower);
            const colorDelta = Math.max(0, colorPower - 0.02);
            const colorRatio = Math.min(1.0, colorDelta / 0.58);

            // Mix between fromColor and toColor, pulsing alpha from 0.2 to 0.95 (vivid color beat)
            const mixed = mixColors(fromColor, toColor, colorRatio, 0.2 + 0.75 * colorRatio);

            // Linear-gradient fades out the line at its top-left and bottom-right endpoints (20% and 80%)
            // so that the endpoints of the short segment are smoothly blurred/faded.
            const gradientString = `linear-gradient(90deg, transparent, ${mixed} 20%, ${mixed} 80%, transparent)`;
            lineEl.style.background = gradientString;
            lineEl.style.backgroundImage = gradientString;

            // Square the bass power value to expand the dynamic range and prevent easy saturation for length scaling
            const bassSqr = bassPower * bassPower;

            // Apply dynamic length scaling using scaleX and subtle thickness scaling using scaleY
            const scaleX = 1.0 + bassSqr * 1.5;
            const scaleY = 1.0 + bassSqr * 0.5;
            lineEl.style.transform = `translate(-50%, -50%) rotate(${centerNormalTiltDeg}deg) scale(${scaleX}, ${scaleY})`;

            // Smoothly transition glow intensity (transition duration ~330ms at 60fps)
            const targetIntensity = isChorus ? 1.0 : 0.0;
            const diff = targetIntensity - glowIntensityRef.current;
            if (Math.abs(diff) > 0.01) {
                glowIntensityRef.current += Math.sign(diff) * 0.05;
                glowIntensityRef.current = Math.max(0, Math.min(1, glowIntensityRef.current));
            } else {
                glowIntensityRef.current = targetIntensity;
            }

            const glowIntensity = glowIntensityRef.current;
            if (glowIntensity > 0.001) {
                const glowSize = (4 + bassPower * 12) * glowIntensity;
                const glowColor = colorWithAlpha(mixed, glowIntensity);
                lineEl.style.filter = `drop-shadow(0 0 ${glowSize.toFixed(1)}px ${glowColor})`;
            } else {
                lineEl.style.filter = 'none';
            }

            frameId = requestAnimationFrame(updateColors);
        };

        frameId = requestAnimationFrame(updateColors);

        return () => {
            cancelAnimationFrame(frameId);
        };
    }, [smoothedBass, smoothedVocal, theme.primaryColor, theme.accentColor, theme.secondaryColor, centerNormalTiltDeg, paused, isChorus, claddaghTuning.showAxisLine]);

    // Initialize dimensions on mount to avoid zero size on first render
    useEffect(() => {
        const container = containerRef.current;
        if (container) {
            const rect = container.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                setDimensions({ width: rect.width, height: rect.height });
            }
        }
        // Track container dimensions responsively using ResizeObserver
        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (entry) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    setDimensions({ width, height });
                }
            }
        });
        if (container) observer.observe(container);
        return () => observer.disconnect();
    }, []);

    // Radial configuration (increased to prevent long sentence overlaps)
    const Rx = (dimensions.width > 0 ? Math.min(dimensions.width * 0.44, 560) : 360) * claddaghTuning.radiusScale;
    const Ry = Rx > 0 ? Rx * 0.707 : 254; // 45-degree angle projection ratio
    const focusSpacingScale = (1 + claddaghTuning.focusScaleRatio) / (1 + DEFAULT_CLADDAGH_TUNING.focusScaleRatio);
    const activeTextSpacingScale = focusSpacingScale;

    if (typeof window !== 'undefined') {
        (window as any).visualizerDimensions = dimensions;
        (window as any).visualizerRx = Rx;
        (window as any).visualizerRy = Ry;
    }

    // Determine the focus line index
    const focusIndex = currentLineIndex !== -1
        ? currentLineIndex
        : (recentCompletedLine
            ? lines.indexOf(recentCompletedLine)
            : -1);
    const centerLineIndex = Math.max(-1, focusIndex);
    const [renderBaseIndex, setRenderBaseIndex] = useState(centerLineIndex);

    const activeSpacingInfo = useMemo(() => {
        const line = lines[renderBaseIndex];
        if (!line) return [];
        const timeline = adjustCladdaghTimeline(buildLineGraphemeTimeline(line), line);
        return buildMeasuredSpacingInfo(timeline, fontSpec, baseFontSize, Rx, activeTextSpacingScale, claddaghTuning.letterSpacingOffset);
    }, [lines, renderBaseIndex, fontSpec, baseFontSize, Rx, activeTextSpacingScale, claddaghTuning.letterSpacingOffset]);

    // Coordinate rotation offsets using MotionValue for line transition自转 animations
    const lineOffset = useMotionValue(centerLineIndex * Math.PI);
    const lastIndexRef = useRef(centerLineIndex);

    useEffect(() => {
        const prev = lastIndexRef.current;
        const curr = centerLineIndex;
        lastIndexRef.current = curr;

        if (Math.abs(curr - prev) > 1) {
            lineOffset.set(curr * Math.PI);
            setRenderBaseIndex(curr);
        } else {
            // Update renderBaseIndex immediately so activeSpacingInfo tracks
            // the new active line from the start. This prevents the wordOffset
            // discontinuity that occurred when onComplete switched it later.
            setRenderBaseIndex(curr);
            const controls = animate(lineOffset, curr * Math.PI, {
                type: 'spring',
                stiffness: 55,
                damping: 14,
                mass: 0.9,
            });
            return () => controls.stop();
        }
    }, [centerLineIndex, lineOffset]);

    // Keep the transition pair + one preceding line rendered so the outgoing
    // line remains visible during the spring rotation.
    const lineIndicesToRender = useMemo(() => {
        const indices = [];
        if (lines.length === 0) return [];
        for (let i = renderBaseIndex - 1; i <= renderBaseIndex + 2; i++) {
            if (i >= 0 && i < lines.length) {
                indices.push(i);
            }
        }
        if (indices.length === 0) {
            indices.push(Math.max(0, Math.min(centerLineIndex, lines.length - 1)));
        }
        return indices;
    }, [centerLineIndex, lines.length, renderBaseIndex]);

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.96, filter: 'blur(4px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 1.04, filter: 'blur(4px)' }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                ref={containerRef as any}
                className="relative flex flex-col items-center justify-center w-full h-full overflow-hidden select-none"
            >
                {/* Background Dedicated Visuals */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none z-[1]">
                    {/* Center Axis Line with blurred/faded endpoints */}
                    {claddaghTuning.showAxisLine && (
                        <div
                            ref={axisLineRef}
                            style={{
                                position: 'absolute',
                                left: '50%',
                                top: '50%',
                                width: '300px',
                                height: '4px',
                                transform: `translate(-50%, -50%) rotate(${centerNormalTiltDeg}deg) scale(1, 1)`,
                                transformOrigin: 'center center',
                                willChange: 'background, transform, filter',
                            }}
                        />
                    )}
                </div>

                <div style={{ width: '100%', height: '100%', position: 'relative', zIndex: 10 }}>
                    {showText && Rx > 0 && Ry > 0 && lineIndicesToRender.map(idx => (
                        <RingLine
                            key={idx}
                            line={lines[idx]}
                            lineIndex={idx}
                            centerLineIndex={centerLineIndex}
                            currentTime={currentTime}
                            lineOffset={lineOffset}
                            theme={theme}
                            lyricsFontScale={lyricsFontScale}
                            Rx={Rx}
                            Ry={Ry}
                            audioPower={smoothedBass}
                            containerWidth={dimensions.width}
                            containerHeight={dimensions.height}
                            activeSpacingInfo={activeSpacingInfo}
                            renderBaseIndex={renderBaseIndex}
                            lines={lines}
                            focusScaleRatio={claddaghTuning.focusScaleRatio}
                            ellipseTiltDeg={claddaghTuning.ellipseTiltDeg}
                            textSpacingScale={activeTextSpacingScale}
                            letterSpacingOffset={claddaghTuning.letterSpacingOffset}
                        />
                    ))}
                </div>
            </motion.div>

            {showText && (
                <VisualizerSubtitleOverlay
                    currentTime={currentTime}
                    showText={showText}
                    activeLine={activeLine}
                    recentCompletedLine={recentCompletedLine}
                    nextLines={nextLines}
                    theme={theme}
                    subtitleTheme={subtitleTheme}
                    translationFontSize="clamp(1.1rem, 2.2vw, 1.45rem)"
                    upcomingFontSize="clamp(0.95rem, 1.8vw, 1.2rem)"
                    subtitleOverlayOpacity={subtitleOverlayOpacity}
                    subtitleOverlayBackground={subtitleOverlayBackground}
                    subtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur}
                    subtitleFontScale={subtitleFontScale}
                    hideTranslationSubtitle={hideTranslationSubtitle}
                    showSubtitleTranslation={showSubtitleTranslation}
                    subtitleContentMode={subtitleContentMode}
                />
            )}
        </VisualizerShell>
    );
};

export default VisualizerCladdagh;
