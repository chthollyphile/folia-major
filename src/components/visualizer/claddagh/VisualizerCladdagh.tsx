// Only for the you who has yet to exist in this world.
// DO NOT REMOVE THE LINE ABOVE.
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useMotionValue, animate, MotionValue, useSpring } from 'framer-motion';
import { Line, Theme } from '../../../types';
import { buildLineGraphemeTimeline } from '../../../utils/lyrics/graphemeTiming';
import { resolveThemeFontStack } from '../../../utils/fontStacks';
import { type VisualizerSharedProps } from '../definition';
import { useVisualizerRuntime } from '../runtime';
import { colorWithAlpha } from '../colorMix';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';

// src/components/visualizer/claddagh/VisualizerCladdagh.tsx

/**
 * Checks if a character belongs to the CJK (Chinese, Japanese, Korean) block.
 */
const isCJKChar = (char: string): boolean => {
    return /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(char);
};

/**
 * Calculates a fractional index corresponding to the current time,
 * interpolating smoothly between grapheme timestamps.
 */
const getFractionalActiveIndex = (
    timeline: Array<{ startTime: number; endTime: number; }>,
    t: number
): number => {
    if (timeline.length === 0) return 0;
    if (timeline.length === 1) {
        const item = timeline[0];
        const dur = Math.max(0.2, item.endTime - item.startTime);
        if (t <= item.startTime) return 0;
        return (t - item.startTime) / dur;
    }

    if (t <= timeline[0].startTime) return 0;

    const lastIdx = timeline.length - 1;
    // Allow smooth extrapolation/overshoot past the last character's start time to prevent freezing
    if (t >= timeline[lastIdx].startTime) {
        const lastItem = timeline[lastIdx];
        const prevItem = timeline[lastIdx - 1];
        const itemDur = lastItem.endTime - lastItem.startTime;
        const gapDur = lastItem.startTime - prevItem.startTime;
        const stepDur = itemDur > 0 ? itemDur : (gapDur > 0 ? gapDur : 0.5);
        
        const progress = (t - lastItem.startTime) / stepDur;
        // Limit rotation allowance to 1.8 character units past the last char
        const cappedProgress = Math.min(progress, 1.8);
        return lastIdx + cappedProgress;
    }

    for (let i = 0; i < timeline.length - 1; i++) {
        const tStart = timeline[i].startTime;
        const tEnd = timeline[i + 1].startTime;
        if (t >= tStart && t < tEnd) {
            if (tEnd === tStart) return i;
            return i + (t - tStart) / (tEnd - tStart);
        }
    }
    return timeline.length - 1;
};

interface RingLineProps {
    line: Line;
    lineIndex: number;
    centerLineIndex: number;
    currentTime: MotionValue<number>;
    lineOffset: MotionValue<number>;
    theme: Theme;
    lyricsFontScale?: number;
    Rx: number;
    Ry: number;
    audioPower: MotionValue<number>;
    containerWidth: number;
    containerHeight: number;
    activeSpacingInfo: Array<{ nominalAngle: number; startTime: number; endTime: number; }>;
}

/**
 * Component representing a single line of lyrics projected onto a portion of the 3D ring.
 */
const RingLine: React.FC<RingLineProps> = ({
    line,
    lineIndex,
    centerLineIndex,
    currentTime,
    lineOffset,
    theme,
    lyricsFontScale = 1.0,
    Rx,
    Ry,
    audioPower,
    containerWidth,
    containerHeight,
    activeSpacingInfo,
}) => {
    const fontStack = resolveThemeFontStack(theme);
    const baseFontSize = 72 * lyricsFontScale;

    const baseColor = useMemo(() => colorWithAlpha(theme.primaryColor, 0.55), [theme.primaryColor]);
    const highlightColor = theme.accentColor || theme.primaryColor;

    // Calculate layout positioning and angles for each character/grapheme.
    const spacingInfo = useMemo(() => {
        const timeline = buildLineGraphemeTimeline(line);
        let accumulatedAngle = 0;
        const data = timeline.map(t => {
            let gap = 0.09;
            if (/^\s+$/.test(t.char)) {
                gap = 0.22;
            } else if (isCJKChar(t.char)) {
                gap = 0.14;
            }
            const startAngle = accumulatedAngle;
            accumulatedAngle += gap;
            return {
                ...t,
                startAngle,
            };
        });

        const maxSpan = 3.2; // Allow wider arc span
        const totalSpan = accumulatedAngle;
        const scaleFactor = totalSpan > maxSpan ? maxSpan / totalSpan : 1.0;

        return data.map(item => ({
            ...item,
            nominalAngle: (item.startAngle - totalSpan / 2) * scaleFactor,
        }));
    }, [line]);

    const charRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const highlightRefs = useRef<(HTMLSpanElement | null)[]>([]);

    useEffect(() => {
        const handler = (latestTime: number) => {
            const mvsLength = spacingInfo.length;
            if (mvsLength === 0) return;

            const curLineOffset = lineOffset.get();
            const power = audioPower.get();
            // Scale radius, bounded to avoid excessive translation
            const maxScale = 1.5;
            const scaleFactor = Math.min(1 + power * 0.04, maxScale);
            const currentRx = Rx * scaleFactor;
            const currentRy = Ry * scaleFactor;

            // Shared active line wordOffset to synchronize all lines on the same track
            let wordOffset = 0;
            if (activeSpacingInfo && activeSpacingInfo.length > 0) {
                const fractionalIndex = getFractionalActiveIndex(activeSpacingInfo, latestTime);
                const lastIdx = activeSpacingInfo.length - 1;
                if (fractionalIndex <= lastIdx) {
                    const intPart = Math.floor(fractionalIndex);
                    const fracPart = fractionalIndex - intPart;
                    const angleA = activeSpacingInfo[intPart]?.nominalAngle ?? 0;
                    const angleB = activeSpacingInfo[Math.min(intPart + 1, lastIdx)]?.nominalAngle ?? 0;
                    wordOffset = angleA + (angleB - angleA) * fracPart;
                } else {
                    // Extrapolate past the last character smoothly to maintain continuous rotation speed
                    const lastAngle = activeSpacingInfo[lastIdx]?.nominalAngle ?? 0;
                    const prevAngle = activeSpacingInfo[Math.max(0, lastIdx - 1)]?.nominalAngle ?? 0;
                    const step = lastAngle - prevAngle;
                    const overshoot = fractionalIndex - lastIdx;
                    wordOffset = lastAngle + step * overshoot;
                }
            }

            const R_ref = currentRx;
            const R_major = currentRx;
            const R_minor = currentRx * 0.09; // Squashed minor axis for a slender ellipse (matching orange design)

            for (let i = 0; i < mvsLength; i++) {
                const el = charRefs.current[i];
                const highlightEl = highlightRefs.current[i];
                if (!el) continue;

                const item = spacingInfo[i];
                const nominalAngle = item.nominalAngle;

                const theta = lineIndex * Math.PI + nominalAngle; // Spacing by 180 degrees
                const psi = theta - curLineOffset - wordOffset;

                // deltaDist is the linear distance along the arc in pixels
                const deltaDist = psi * R_ref;

                // Angle along the major axis
                const thetaCurve = deltaDist / R_major;

                // Calculate depth factor D (1 in the front, 0 in the back) based on ellipse curve position
                const localCos = Math.cos(thetaCurve);
                const D = (localCos + 1) / 2;

                // Scale character spacing along the major axis by depth to make back characters gather closer together
                const spacingFactor = 0.35 + 0.65 * Math.pow(D, 1.2);

                // Ellipse positions centered at origin (0, 0)
                // Active character (psi = 0) is at (0, R_minor) before rotation
                const rawX = Math.sin(thetaCurve) * R_major * spacingFactor;
                const rawY = localCos * R_minor;

                // Rotate the coordinate system by exactly -45 degrees (-Math.PI / 4 radians)
                // so the major axis aligns exactly with the screen's anti-diagonal (y = -x).
                // Active character rotates to (0.707 R_minor, 0.707 R_minor) (bottom-right).
                // Back side rotates to (-0.707 R_minor, -0.707 R_minor) (top-left).
                const thetaRot = -Math.PI / 4;
                const cosTheta = Math.cos(thetaRot);
                const sinTheta = Math.sin(thetaRot);

                const x = rawX * cosTheta - rawY * sinTheta;
                const y = rawX * sinTheta + rawY * cosTheta;

                // Calculate the focus factor F:
                // F ranges from 1 (active character on active line) to 0 (back side of the ring / far away)
                const lineDiffNormalized = Math.abs(curLineOffset - lineIndex * Math.PI) / Math.PI;
                const activeLineFactor = Math.max(0, 1 - lineDiffNormalized);

                const maxVisibleDist = currentRx * 0.48; // Focus width for active line
                const distRatio = Math.min(1, Math.abs(deltaDist) / maxVisibleDist);
                const F = activeLineFactor * Math.pow(1 - distRatio, 1.8);

                // Blend visual properties using depth factor D and focus factor F for a pseudo-3D look
                // Active character (D=1, F=1) is largest and sharpest.
                // Background characters (D=0, F=0) are very small and blurry.
                let finalOpacity = 0.35 + 0.65 * Math.pow(D, 1.5) * (0.35 + 0.65 * F);
                
                // Hide past lines completely when the transition is done to prevent overlapping in the background
                if (lineIndex < centerLineIndex) {
                    const pastFade = Math.max(0, 1 - lineDiffNormalized);
                    finalOpacity = finalOpacity * pastFade;
                }

                const scale = (0.22 + 0.98 * Math.pow(D, 1.5)) * (1.0 + 0.65 * F);
                const blur = 8.0 * (1 - D) * (1 - 0.5 * F);

                el.style.transform = `translate3d(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px), 0px) scale(${scale.toFixed(3)})`;
                el.style.opacity = finalOpacity.toFixed(3);
                el.style.filter = blur < 0.2 ? 'none' : `blur(${blur.toFixed(2)}px)`;

                if (highlightEl) {
                    let p = 0;
                    if (latestTime >= item.endTime) {
                        p = 1;
                    } else if (latestTime <= item.startTime) {
                        p = 0;
                    } else {
                        const dur = item.endTime - item.startTime;
                        p = dur > 0 ? (latestTime - item.startTime) / dur : 1;
                    }
                    highlightEl.style.clipPath = `inset(0% ${(1 - p) * 100}% 0% 0%)`;
                }
            }
        };

        const handleUpdate = () => {
            handler(currentTime.get());
        };

        const unsubscribeTime = currentTime.onChange(handler);
        const unsubscribeOffset = lineOffset.onChange(handleUpdate);
        handler(currentTime.get());
        
        return () => {
            unsubscribeTime();
            unsubscribeOffset();
        };
    }, [spacingInfo, lineIndex, centerLineIndex, lineOffset, Rx, Ry, audioPower, currentTime, containerWidth, containerHeight, activeSpacingInfo]);

    return (
        <div className="absolute inset-0 pointer-events-none w-full h-full">
            {spacingInfo.map((item, idx) => (
                <span
                    key={idx}
                    ref={el => { charRefs.current[idx] = el; }}
                    style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        transformOrigin: 'center center',
                        willChange: 'transform, opacity, filter',
                        fontFamily: fontStack,
                        fontSize: `${baseFontSize}px`,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        whiteSpace: 'nowrap',
                    }}
                >
                    <span style={{ color: baseColor }}>{item.char}</span>
                    <span
                        ref={el => { highlightRefs.current[idx] = el; }}
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            color: highlightColor,
                            willChange: 'clip-path',
                            clipPath: 'inset(0% 100% 0% 0%)',
                        }}
                    >
                        {item.char}
                    </span>
                </span>
            ))}
        </div>
    );
};

const VisualizerCladdagh: React.FC<VisualizerSharedProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        showText = true,
        lyricsFontScale = 1.0,
        subtitleOverlayOpacity,
        hideTranslationSubtitle,
        showSubtitleTranslation,
        audioPower,
        audioBands,
    } = props;

    const { activeLine, upcomingLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
    });

    const smoothedPower = useSpring(audioPower, {
        stiffness: 120,
        damping: 24,
    });

    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

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

    // Radial configuration
    const Rx = dimensions.width > 0 ? Math.min(dimensions.width * 0.38, 480) : 320;
    const Ry = Rx > 0 ? Rx * 0.707 : 226; // 45-degree angle projection ratio

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
            : (upcomingLine ? lines.indexOf(upcomingLine) : 0));
    const centerLineIndex = Math.max(0, focusIndex);

    const activeSpacingInfo = useMemo(() => {
        const line = lines[centerLineIndex];
        if (!line) return [];
        const timeline = buildLineGraphemeTimeline(line);
        let accumulatedAngle = 0;
        const data = timeline.map(t => {
            let gap = 0.09;
            if (/^\s+$/.test(t.char)) {
                gap = 0.22;
            } else if (isCJKChar(t.char)) {
                gap = 0.14;
            }
            const startAngle = accumulatedAngle;
            accumulatedAngle += gap;
            return {
                ...t,
                startAngle,
            };
        });

        const maxSpan = 3.2; // Allow wider arc span
        const totalSpan = accumulatedAngle;
        const scaleFactor = totalSpan > maxSpan ? maxSpan / totalSpan : 1.0;

        return data.map(item => ({
            ...item,
            nominalAngle: (item.startAngle - totalSpan / 2) * scaleFactor,
        }));
    }, [activeLine]);

    // Coordinate rotation offsets using MotionValue for line transition自转 animations
    const lineOffset = useMotionValue(centerLineIndex * Math.PI);
    const lastIndexRef = useRef(centerLineIndex);

    useEffect(() => {
        const prev = lastIndexRef.current;
        const curr = centerLineIndex;
        lastIndexRef.current = curr;

        if (Math.abs(curr - prev) > 1) {
            lineOffset.set(curr * Math.PI);
        } else {
            animate(lineOffset, curr * Math.PI, {
                type: 'spring',
                stiffness: 55,
                damping: 14,
                mass: 0.9,
            });
        }
    }, [centerLineIndex, lineOffset]);

    // Keep active, previous, and next lines rendered to allow smooth transitions
    const lineIndicesToRender = useMemo(() => {
        const indices = [];
        if (lines.length === 0) return [];
        for (let i = centerLineIndex - 1; i <= centerLineIndex + 1; i++) {
            if (i >= 0 && i < lines.length) {
                indices.push(i);
            }
        }
        return indices;
    }, [centerLineIndex, lines]);

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
        >
            <div
                ref={containerRef}
                className="relative flex flex-col items-center justify-center w-full h-full overflow-hidden select-none"
            >
                <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                    {Rx > 0 && Ry > 0 && lineIndicesToRender.map(idx => (
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
                            audioPower={smoothedPower}
                            containerWidth={dimensions.width}
                            containerHeight={dimensions.height}
                            activeSpacingInfo={activeSpacingInfo}
                        />
                    ))}
                </div>
            </div>

            {showText && (
                <VisualizerSubtitleOverlay
                    showText={showText}
                    activeLine={activeLine}
                    recentCompletedLine={recentCompletedLine}
                    nextLines={nextLines}
                    theme={theme}
                    translationFontSize="clamp(1.1rem, 2.2vw, 1.45rem)"
                    upcomingFontSize="clamp(0.95rem, 1.8vw, 1.2rem)"
                    subtitleOverlayOpacity={subtitleOverlayOpacity}
                    hideTranslationSubtitle={hideTranslationSubtitle}
                    showSubtitleTranslation={showSubtitleTranslation}
                />
            )}
        </VisualizerShell>
    );
};

export default VisualizerCladdagh;
