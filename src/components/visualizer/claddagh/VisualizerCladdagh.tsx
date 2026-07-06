// Only for the you who has yet to exist in this world.
// DO NOT REMOVE THE LINE ABOVE.
import React, { useMemo, useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { measureNaturalWidth, prepareWithSegments } from '@chenglou/pretext';
import { useMotionValue, animate, MotionValue, useSpring, motion } from 'framer-motion';
import { DEFAULT_CLADDAGH_TUNING, type Line, type Theme } from '../../../types';
import { buildLineGraphemeTimeline } from '../../../utils/lyrics/graphemeTiming';
import { resolveThemeFontStack } from '../../../utils/fontStacks';
import { type VisualizerSharedProps } from '../definition';
import { useVisualizerRuntime } from '../runtime';
import { colorWithAlpha, mixColors } from '../colorMix';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import { buildWordColorRanges } from '../wordColoring';

// src/components/visualizer/claddagh/VisualizerCladdagh.tsx

/**
 * Checks if a character belongs to the CJK (Chinese, Japanese, Korean) block.
 */
const isCJKChar = (char: string): boolean => {
    return /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(char);
};

/**
 * Calculates a relative visual length score of a sentence.
 * CJK characters are counted as 1.0, while other half-width characters count as 0.5.
 */
const getVisualLength = (text: string): number => {
    if (!text) return 0;
    let score = 0;
    for (let i = 0; i < text.length; i++) {
        score += isCJKChar(text[i]) ? 1.0 : 0.5;
    }
    return score;
};

/**
 * Adjusts character timeline specifically for Claddagh visualizer by smoothly
 * distributing time durations over gap/space characters.
 * If word spacing has zero or very small duration, it borrows time safely from neighboring characters.
 */
const adjustCladdaghTimeline = <T extends { startTime: number; endTime: number; }>(
    timeline: T[],
    line: Line
): T[] => {
    if (timeline.length === 0) return timeline;

    const adjusted = timeline.map(item => ({ ...item }));
    const n = adjusted.length;
    let i = 0;

    while (i < n) {
        if (adjusted[i].startTime === adjusted[i].endTime) {
            let j = i;
            while (j < n && adjusted[j].startTime === adjusted[j].endTime) {
                j++;
            }
            const gapCount = j - i;
            let gapStart = i > 0 ? adjusted[i - 1].endTime : line.startTime;
            let gapEnd = j < n ? adjusted[j].startTime : line.endTime;

            const minNeeded = gapCount * 0.06; // 60ms per character
            let duration = gapEnd - gapStart;

            if (duration < minNeeded) {
                const deficit = minNeeded - duration;
                if (i > 0 && j < n) {
                    const half = deficit / 2;
                    const prevDuration = adjusted[i - 1].endTime - adjusted[i - 1].startTime;
                    const prevSteal = Math.min(half, Math.max(0, prevDuration - 0.04));

                    const nextDuration = adjusted[j].endTime - adjusted[j].startTime;
                    const nextSteal = Math.min(deficit - prevSteal, Math.max(0, nextDuration - 0.04));

                    gapStart -= prevSteal;
                    gapEnd += nextSteal;

                    adjusted[i - 1].endTime = gapStart;
                    adjusted[j].startTime = gapEnd;
                } else if (i > 0) {
                    const prevDuration = adjusted[i - 1].endTime - adjusted[i - 1].startTime;
                    const prevSteal = Math.min(deficit, Math.max(0, prevDuration - 0.04));
                    gapStart -= prevSteal;
                    adjusted[i - 1].endTime = gapStart;
                } else if (j < n) {
                    const nextDuration = adjusted[j].endTime - adjusted[j].startTime;
                    const nextSteal = Math.min(deficit, Math.max(0, nextDuration - 0.04));
                    gapEnd += nextSteal;
                    adjusted[j].startTime = gapEnd;
                }
                duration = gapEnd - gapStart;
            }

            const gapUnit = duration > 0 ? duration / gapCount : 0;
            for (let k = i; k < j; k++) {
                const idxInGap = k - i;
                adjusted[k].startTime = gapStart + gapUnit * idxInGap;
                adjusted[k].endTime = gapStart + gapUnit * (idxInGap + 1);
            }
            i = j;
        } else {
            i++;
        }
    }

    return adjusted;
};


const CLADDAGH_MAX_ARC_SPAN = 4.25;
const CLADDAGH_LETTER_SPACING_EM = 0.04;
const CLADDAGH_BASE_TRACKING_EM = 0.18;
const CLADDAGH_BACK_FOLLOW_RATIO = 0.28;
const CLADDAGH_BACK_ORBIT_FOLLOW_RATIO = 0.52;
const CLADDAGH_SPACING_CACHE_LIMIT = 240;
const claddaghSpacingCache = new Map<string, number[]>();

const getFallbackGraphemeWidth = (char: string, fontPx: number): number => {
    if (/^\s+$/.test(char)) return fontPx * 0.36;
    if (isCJKChar(char)) return fontPx;
    return fontPx * 0.62;
};

/**
 * Calculates a fractional index corresponding to the current time,
 * interpolating smoothly between grapheme timestamps.
 */
const getFractionalActiveIndex = (
    timeline: Array<{ startTime: number; endTime: number; }>,
    t: number,
    renderEnd?: number
): number => {
    if (timeline.length === 0) return 0;
    if (timeline.length === 1) {
        const item = timeline[0];
        const targetEnd = typeof renderEnd === 'number' && Number.isFinite(renderEnd) ? renderEnd : item.endTime;
        const dur = Math.max(0.2, targetEnd - item.startTime);
        if (t <= item.startTime) return 0;
        return (t - item.startTime) / dur;
    }

    if (t <= timeline[0].startTime) return 0;

    const lastIdx = timeline.length - 1;
    // Allow smooth extrapolation/overshoot past the last character's start time to prevent freezing
    if (t >= timeline[lastIdx].startTime) {
        const lastItem = timeline[lastIdx];

        if (typeof renderEnd === 'number' && Number.isFinite(renderEnd) && renderEnd > lastItem.startTime) {
            const progress = clamp((t - lastItem.startTime) / (renderEnd - lastItem.startTime), 0, 1);
            return lastIdx + progress * 2.0;
        }

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



const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

// Keeps tangent-based character rotation readable instead of allowing upside-down glyphs.
const normalizeReadableAngle = (degrees: number): number => {
    let normalized = degrees;
    while (normalized > 90) normalized -= 180;
    while (normalized < -90) normalized += 180;
    return normalized;
};

const rememberSpacingOffsets = (key: string, offsets: number[]) => {
    if (claddaghSpacingCache.size >= CLADDAGH_SPACING_CACHE_LIMIT) {
        const oldestKey = claddaghSpacingCache.keys().next().value;
        if (oldestKey) {
            claddaghSpacingCache.delete(oldestKey);
        }
    }
    claddaghSpacingCache.set(key, offsets);
    return offsets;
};

const measureCladdaghTextWidth = (text: string, fontSpec: string, fontPx: number, fallbackWidth: number): number => {
    if (!text) return 0;
    const prepared = prepareWithSegments(text, fontSpec, {
        whiteSpace: 'pre-wrap',
        letterSpacing: fontPx * CLADDAGH_LETTER_SPACING_EM,
    });
    const measuredWidth = measureNaturalWidth(prepared);
    return Number.isFinite(measuredWidth) && measuredWidth > 0 ? measuredWidth : fallbackWidth;
};

// Uses pretext's canvas-backed font measurement to place grapheme centers at their rendered advance positions.
const measureCladdaghGraphemeOffsets = (graphemes: string[], fontSpec: string, fontPx: number): number[] => {
    const text = graphemes.join('');
    const cacheKey = `${fontPx}|${fontSpec}|${CLADDAGH_BASE_TRACKING_EM}|${text}`;
    const cached = claddaghSpacingCache.get(cacheKey);
    if (cached) return cached;

    const offsets = new Array<number>(graphemes.length + 1).fill(0);
    let fallbackWidth = 0;
    for (let index = 1; index <= graphemes.length; index += 1) {
        fallbackWidth += getFallbackGraphemeWidth(graphemes[index - 1], fontPx);
        const baseTracking = Math.max(0, index - 1) * fontPx * CLADDAGH_BASE_TRACKING_EM;
        offsets[index] = Math.max(
            offsets[index - 1],
            measureCladdaghTextWidth(graphemes.slice(0, index).join(''), fontSpec, fontPx, fallbackWidth) + baseTracking
        );
    }
    return rememberSpacingOffsets(cacheKey, offsets);
};

const buildMeasuredSpacingInfo = <T extends { char: string; }>(
    items: T[],
    fontSpec: string,
    fontPx: number,
    radiusPx: number,
    spacingScale = 1
) => {
    if (items.length === 0) return [];
    const graphemes = items.map(item => item.char);
    const offsets = measureCladdaghGraphemeOffsets(graphemes, fontSpec, fontPx);
    const safeSpacingScale = Number.isFinite(spacingScale) ? Math.max(0.1, spacingScale) : 1;
    const totalWidth = (offsets[offsets.length - 1] ?? 0) * safeSpacingScale;
    const safeRadius = Math.max(radiusPx, fontPx * 2, 1);
    const totalSpan = totalWidth / safeRadius;
    const scaleFactor = totalSpan > CLADDAGH_MAX_ARC_SPAN ? CLADDAGH_MAX_ARC_SPAN / totalSpan : 1.0;

    return items.map((item, index) => {
        const centerPx = ((offsets[index] ?? 0) + (offsets[index + 1] ?? offsets[index] ?? 0)) / 2 * safeSpacingScale;
        const startAngle = centerPx / safeRadius;
        return {
            ...item,
            startAngle,
            nominalAngle: (startAngle - totalSpan / 2) * scaleFactor,
        };
    });
};

const getLineWordOffset = (
    spacingInfo: Array<{ nominalAngle: number; startTime: number; endTime: number; }>,
    latestTime: number,
    renderEnd?: number
) => {
    if (spacingInfo.length === 0) return 0;
    const fractionalIndex = getFractionalActiveIndex(spacingInfo, latestTime, renderEnd);
    const lastIdx = spacingInfo.length - 1;
    if (fractionalIndex <= lastIdx) {
        const intPart = Math.floor(fractionalIndex);
        const fracPart = fractionalIndex - intPart;
        const angleA = spacingInfo[intPart]?.nominalAngle ?? 0;
        const angleB = spacingInfo[Math.min(intPart + 1, lastIdx)]?.nominalAngle ?? 0;
        return angleA + (angleB - angleA) * fracPart;
    }

    const lastAngle = spacingInfo[lastIdx]?.nominalAngle ?? 0;
    const prevAngle = spacingInfo[Math.max(0, lastIdx - 1)]?.nominalAngle ?? 0;
    const step = lastAngle - prevAngle;
    const overshoot = fractionalIndex - lastIdx;
    return lastAngle + step * overshoot;
};

const getLinePlaybackProgress = (
    spacingInfo: Array<{ nominalAngle: number; startTime: number; endTime: number; }>,
    latestTime: number,
    renderEnd?: number
) => {
    if (spacingInfo.length === 0) return 0;
    if (spacingInfo.length === 1) {
        const item = spacingInfo[0];
        const targetEnd = typeof renderEnd === 'number' && Number.isFinite(renderEnd) ? renderEnd : item.endTime;
        const duration = Math.max(0.001, targetEnd - item.startTime);
        return clamp((latestTime - item.startTime) / duration, 0, 1);
    }

    const fractionalIndex = getFractionalActiveIndex(spacingInfo, latestTime, renderEnd);
    return clamp(fractionalIndex / Math.max(1, spacingInfo.length - 1), 0, 1);
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
    renderBaseIndex: number;
    lines: Line[];
    focusScaleRatio?: number;
    ellipseTiltDeg?: number;
    textSpacingScale?: number;
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
    renderBaseIndex,
    lines,
    focusScaleRatio,
    ellipseTiltDeg,
    textSpacingScale = 1,
}) => {
    const fontStack = resolveThemeFontStack(theme);
    const baseFontSize = 72 * lyricsFontScale;
    const fontSpec = `700 ${baseFontSize}px ${fontStack}`;

    const baseColor = useMemo(() => colorWithAlpha(theme.primaryColor, 0.55), [theme.primaryColor]);
    const highlightColor = theme.accentColor || theme.primaryColor;

    const isRawScaleRef = useRef(false);
    const normalizePower = useCallback((power: number) => {
        if (!Number.isFinite(power)) return 0;
        if (power > 1.0) {
            isRawScaleRef.current = true;
        }
        return Math.max(0, Math.min(1, isRawScaleRef.current ? power / 255 : power));
    }, []);

    // Calculate layout positioning and angles for each character/grapheme.
    const spacingInfo = useMemo(() => {
        const timeline = adjustCladdaghTimeline(buildLineGraphemeTimeline(line), line);
        const wordColorRanges = buildWordColorRanges(line.fullText, theme.wordColors);

        let codeUnitCursor = 0;
        const data = timeline.map(t => {
            const charLength = t.char.length;
            const startOffset = codeUnitCursor;
            const endOffset = codeUnitCursor + charLength;
            codeUnitCursor = endOffset;

            // Find if this character overlaps with any wordColor range
            const matchedRange = wordColorRanges.find(
                range => startOffset < range.endOffset && range.startOffset < endOffset
            );
            const charColor = matchedRange ? matchedRange.color : null;

            return {
                ...t,
                charColor,
            };
        });

        return buildMeasuredSpacingInfo(data, fontSpec, baseFontSize, Rx, textSpacingScale);
    }, [line, theme.wordColors, fontSpec, baseFontSize, Rx, textSpacingScale]);

    const charRefs = useRef<(HTMLSpanElement | null)[]>([]);

    useLayoutEffect(() => {
        const handler = (latestTime: number) => {
            const mvsLength = spacingInfo.length;
            if (mvsLength === 0) return;

            const curLineOffset = lineOffset.get();
            const power = normalizePower(audioPower.get());
            const intensity = theme.animationIntensity || 'normal';
            let intensityMultiplier = 0.25;
            let maxScale = 1.25;

            if (intensity === 'calm') {
                intensityMultiplier = 0.08;
                maxScale = 1.08;
            } else if (intensity === 'chaotic') {
                intensityMultiplier = 0.95;
                maxScale = 1.95;
            }

            // Scale radius, bounded to avoid excessive translation
            const scaleFactor = Math.min(1 + power * intensityMultiplier, maxScale);
            const currentRx = Rx * scaleFactor;
            const currentRy = Ry * scaleFactor;

            const lineDiffFromCenter = Math.abs(curLineOffset - lineIndex * Math.PI) / Math.PI;

            // Calculate overlap mitigation factors based on current and next line lengths
            const currentLine = lines[centerLineIndex];
            const currentLen = currentLine ? getVisualLength(currentLine.fullText) : 0;
            const targetLine = lines[lineIndex];
            const targetLen = targetLine ? getVisualLength(targetLine.fullText) : 0;

            let lengthFadeFactor = 1.0;
            let lengthScaleFactor = 1.0;

            if (lineIndex > centerLineIndex && currentLen > 10) {
                const fadeStrength = clamp((currentLen - 10) / 8, 0, 1);
                const targetStrength = clamp((targetLen - 5) / 5, 0.4, 1);
                const combinedStrength = fadeStrength * targetStrength;

                const targetMinOpacity = 1.0 - combinedStrength;
                const targetMinScale = 1.0 - combinedStrength * 0.25;

                const transitionProgress = clamp((lineDiffFromCenter - 0.4) / 0.5, 0, 1);

                lengthFadeFactor = 1.0 - (1.0 - targetMinOpacity) * transitionProgress;
                lengthScaleFactor = 1.0 - (1.0 - targetMinScale) * transitionProgress;
            }
            const activeLine = lines[renderBaseIndex];
            const activeRenderEnd = activeLine ? (activeLine.renderHints?.renderEndTime ?? activeLine.endTime) : undefined;
            const ownRenderEnd = line.renderHints?.renderEndTime ?? line.endTime;

            const activeWordOffset = getLineWordOffset(activeSpacingInfo, latestTime, activeRenderEnd);
            const ownWordOffset = getLineWordOffset(spacingInfo, latestTime, ownRenderEnd);
            const activeLineProgress = getLinePlaybackProgress(activeSpacingInfo, latestTime, activeRenderEnd);
            const backOrbitFollow = Math.PI
                * CLADDAGH_BACK_ORBIT_FOLLOW_RATIO
                * (1 - Math.pow(1 - activeLineProgress, 1.35));
            let wordOffset = ownWordOffset;
            if (lineIndex < centerLineIndex) {
                // Past lines keep their own completed word offset instead of
                // tracking the new active line, to avoid snapping back to 0.
            } else {
                // Use lineDiffFromCenter as a continuous blend factor so the
                // back-follow contribution fades out smoothly during the spring
                // rotation, instead of jumping to 0 when renderBaseIndex updates.
                const backFollowFactor = lineIndex > centerLineIndex
                    ? 1
                    : clamp(lineDiffFromCenter, 0, 1);
                wordOffset += (
                    activeWordOffset * CLADDAGH_BACK_FOLLOW_RATIO
                    + backOrbitFollow
                ) * backFollowFactor;
            }

            const R_ref = currentRx;
            const R_major = currentRx;
            const R_minor = currentRx * 0.09; // Squashed minor axis for a slender ellipse (matching orange design)

            for (let i = 0; i < mvsLength; i++) {
                const el = charRefs.current[i];
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
                
                let rawY = localCos * R_minor;
                if (line.isChorus) {
                    // Alternating vertical stagger that pushes even/odd indices up/down, pulsing with beat power
                    const staggerAmount = baseFontSize * (0.06 + power * 0.12);
                    rawY += (i % 2 === 0 ? 1 : -1) * staggerAmount;
                }

                // Rotate the coordinate system by exactly -ellipseTiltDeg degrees
                // so the major axis aligns exactly with the screen's anti-diagonal.
                const thetaRot = -((ellipseTiltDeg ?? 45) * Math.PI) / 180;
                const cosTheta = Math.cos(thetaRot);
                const sinTheta = Math.sin(thetaRot);

                const x = rawX * cosTheta - rawY * sinTheta;
                const y = rawX * sinTheta + rawY * cosTheta;

                const tangentX = Math.cos(thetaCurve) * R_major;
                const tangentY = -Math.sin(thetaCurve) * R_minor;
                const rotatedTangentX = tangentX * cosTheta - tangentY * sinTheta;
                const rotatedTangentY = tangentX * sinTheta + tangentY * cosTheta;
                const tangentAngle = normalizeReadableAngle(Math.atan2(rotatedTangentY, rotatedTangentX) * 180 / Math.PI);

                // Calculate the focus factor F:
                // F ranges from 1 (active character on active line) to 0 (back side of the ring / far away)
                const lineDiffNormalized = lineDiffFromCenter;
                const activeLineFactor = Math.max(0, 1 - lineDiffNormalized);

                const maxVisibleDist = currentRx * 0.48; // Focus width for active line
                const distRatio = Math.min(1, Math.abs(deltaDist) / maxVisibleDist);
                const F = activeLineFactor * Math.pow(1 - distRatio, 1.8);

                // Blend visual properties using depth factor D and focus factor F for a pseudo-3D look
                // Active character (D=1, F=1) is largest and sharpest.
                // Background characters (D=0, F=0) stay visible while still feeling distant.
                const distanceOpacity = 0.22 + 0.78 * Math.pow(D, 1.9);
                let finalOpacity = (0.35 + 0.65 * Math.pow(D, 1.5) * (0.35 + 0.65 * F)) * distanceOpacity;

                // Hide the next line while it is still equivalent to the outgoing line's foreground turn.
                const lineWindowFade = clamp(2 - lineDiffNormalized, 0, 1);
                finalOpacity = finalOpacity * lineWindowFade;

                // Hide past lines completely when the transition is done to prevent overlapping in the background
                if (lineIndex < centerLineIndex) {
                    const pastFade = Math.max(0, 1 - lineDiffNormalized);
                    finalOpacity = finalOpacity * pastFade;
                }

                // Apply dynamic layout overlap mitigation factors based on sentence lengths
                finalOpacity = finalOpacity * lengthFadeFactor;

                // Boundary fade to keep non-focused lines strictly in the back half of the ellipse
                let boundaryFade = 1.0;
                if (lineDiffFromCenter > 0.02) {
                    const progress = clamp((lineDiffFromCenter - 0.3) / 0.6, 0, 1);
                    const cosThreshold = 1.0 - 1.2 * progress;
                    if (localCos > cosThreshold) {
                        boundaryFade = clamp(1.0 - (localCos - cosThreshold) / 0.15, 0, 1);
                    }
                }
                finalOpacity = finalOpacity * boundaryFade;

                const scale = (0.22 + 0.98 * Math.pow(D, 1.5)) * (1.0 + (focusScaleRatio ?? 0.65) * F) * lengthScaleFactor;
                const blur = 8.0 * (1 - D) * (1 - 0.5 * F);
                const tiltAngle = clamp(tangentAngle * (0.4 + 0.6 * D), -38, 38);

                el.style.transform = `translate3d(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px), 0px) rotate(${tiltAngle.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
                el.style.opacity = finalOpacity.toFixed(3);
                el.style.filter = blur < 0.2 ? 'none' : `blur(${blur.toFixed(2)}px)`;

                // Update text color and text shadow (glow) based on current play status (like VisualizerClassic)
                let activeColorState: 'waiting' | 'active' | 'passed' = 'waiting';
                if (latestTime >= item.startTime && latestTime <= item.endTime) {
                    activeColorState = 'active';
                } else if (latestTime > item.endTime) {
                    activeColorState = 'passed';
                }

                // All characters of the current active line have a glow that decreases from the center (focus point)
                // Enhance base glow radius and scale with power on beats for chorus lines
                const glowRadius = line.isChorus
                    ? (36 + power * 24) * Math.pow(F, 1.5)
                    : 24 * Math.pow(F, 2.0);

                const targetColor = activeColorState === 'active' || activeColorState === 'passed'
                    ? (item.charColor || highlightColor)
                    : baseColor;

                el.style.color = targetColor;

                if (glowRadius > 0.5) {
                    if (line.isChorus) {
                        // Blend targetColor with the theme's primary text color to create a bright inner core matching the theme tone
                        const innerGlowColor = mixColors(targetColor, theme.primaryColor || '#ffffff', 0.65);
                        el.style.textShadow = `0 0 ${(glowRadius * 0.35).toFixed(1)}px ${innerGlowColor}, 0 0 ${glowRadius.toFixed(1)}px ${targetColor}, 0 0 ${(glowRadius * 1.6).toFixed(1)}px ${targetColor}`;
                    } else {
                        el.style.textShadow = `0 0 ${glowRadius.toFixed(1)}px ${targetColor}`;
                    }
                } else {
                    el.style.textShadow = 'none';
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
    }, [spacingInfo, lineIndex, centerLineIndex, lineOffset, Rx, Ry, audioPower, currentTime, containerWidth, containerHeight, activeSpacingInfo, renderBaseIndex, highlightColor, baseColor, focusScaleRatio, ellipseTiltDeg, lines, line]);

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
                        opacity: 0,
                        transform: 'translate3d(-50%, -50%, 0px) scale(0.2)',
                        transformOrigin: 'center center',
                        willChange: 'transform, opacity, filter, color, text-shadow',
                        fontFamily: fontStack,
                        fontSize: `${baseFontSize}px`,
                        fontWeight: 700,
                        letterSpacing: `${CLADDAGH_LETTER_SPACING_EM}em`,
                        whiteSpace: 'nowrap',
                        color: baseColor,
                    }}
                >
                    {item.char}
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
    const fontSpec = `700 ${baseFontSize}px ${fontStack}`;

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
    }, [smoothedBass, smoothedVocal, theme.primaryColor, theme.accentColor, theme.secondaryColor, centerNormalTiltDeg, paused, isChorus]);

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
        return buildMeasuredSpacingInfo(timeline, fontSpec, baseFontSize, Rx, activeTextSpacingScale);
    }, [lines, renderBaseIndex, fontSpec, baseFontSize, Rx, activeTextSpacingScale]);

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
                        />
                    ))}
                </div>
            </motion.div>

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
