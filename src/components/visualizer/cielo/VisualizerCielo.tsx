import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMotionValueEvent } from 'framer-motion';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import { type VisualizerSharedProps } from '../definition';
import { DEFAULT_CIELO_TUNING } from '../../../types';
import CieloBackground from './CieloBackground';
import { colorWithAlpha } from '../colorMix';
import { extractColors } from '../../../utils/colorExtractor';
import { buildPostLyricLayoutUnits, type LyricLayoutUnit } from '../../../utils/lyrics/cjkSemanticLayout';

// A simple predictable random number generator based on a seed
const sfc32 = (a: number, b: number, c: number, d: number) => {
    return function () {
        a |= 0; b |= 0; c |= 0; d |= 0;
        const t = (a + b | 0) + d | 0;
        d = d + 1 | 0;
        a = b ^ b >>> 9;
        b = c + (c << 3) | 0;
        c = c << 21 | c >>> 11;
        c = c + t | 0;
        return (t >>> 0) / 4294967296;
    };
};

const generateHashString = (str: string) => {
    let hash = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        hash = Math.imul(hash ^ str.charCodeAt(i), 3432918353);
        hash = hash << 13 | hash >>> 19;
    }
    return () => {
        hash = Math.imul(hash ^ hash >>> 16, 2246822507);
        hash = Math.imul(hash ^ hash >>> 13, 3266489909);
        return (hash ^= hash >>> 16) >>> 0;
    };
};

interface LyricNodeState {
    id: string;
    worldY: number;
    worldX: number;
    fontSize: number;
    opacity: number;
    active: boolean;
    isOutline: boolean;
}

export const VisualizerCielo: React.FC<VisualizerSharedProps> = (props) => {
    const {
        currentTime,
        lines,
        theme,
        audioPower,
        audioBands,
        seed = 'cielo',
        cieloTuning = DEFAULT_CIELO_TUNING,
    } = props;

    const containerRef = useRef<HTMLDivElement>(null);
    const cameraY = useRef(0);
    const lineNodesRef = useRef<Map<number, HTMLDivElement>>(new Map());

    // We only use React state for mounting/unmounting lines (discrete updates)
    const [activeLines, setActiveLines] = useState<number[]>([]);
    const [coverColors, setCoverColors] = useState<string[]>([]);

    // Extract cover colors for diverse palette
    useEffect(() => {
        if (props.coverUrl) {
            extractColors(props.coverUrl, 5).then(setCoverColors).catch(console.error);
        } else {
            setCoverColors([]);
        }
    }, [props.coverUrl]);

    // PV-style structured typography algorithm (Fixed in World, Center-Timed Layout)
    const lineLayouts = useMemo(() => {
        const layouts = new Map<number, { worldX: number, worldY: number, opacity: number, isOutline: boolean, layoutUnits: { unit: LyricLayoutUnit, size: number }[] }>();
        
        const hashStr = typeof seed === 'string' ? seed : seed.toString();
        const getHash = generateHashString(hashStr);
        const localPrng = sfc32(getHash(), getHash(), getHash(), getHash());

        const SCROLL_SPEED = 250 * cieloTuning.cameraSpeed;
        const width = 1200; // Reference width for generation
        const height = 800; // Reference height

        const placedRects: { x: number, y: number, w: number, h: number, startTime: number, endTime: number }[] = [];
        
        // Vastly increased font size bounds for impact
        const MAX_SIZE = 160;
        const MIN_SIZE = 70;

        lines.forEach((line, lineIndex) => {
            const layoutUnits = buildPostLyricLayoutUnits(line, { semantic: true, sticky: true });
            if (layoutUnits.length === 0) return;

            const isOutline = localPrng() > 0.7; // Less outlines, more bold solids for PV style
            const opacity = isOutline ? 0.9 : 0.8 + localPrng() * 0.2; // Very high opacity

            let estH = 0;
            const unitsWithStyle = layoutUnits.map(unit => {
                const text = unit.text;
                let size = MIN_SIZE + localPrng() * 20; // fallback
                
                const hasKanji = /[\u4e00-\u9faf]/.test(text);
                const hasKatakana = /[\u30a0-\u30ff]/.test(text);
                const isPureHiragana = /^[\u3040-\u309f]+$/.test(text);
                const isPunctuation = /^[^\w\s\u4e00-\u9faf\u3040-\u30ff]+$/.test(text);
                
                if (hasKanji || hasKatakana) {
                    size = MAX_SIZE - localPrng() * 30; // 130-160
                } else if (isPureHiragana) {
                    size = MIN_SIZE + 10 + localPrng() * 20; // 80-100
                } else if (isPunctuation) {
                    size = MIN_SIZE * 0.8; // 56
                } else {
                    size = (MAX_SIZE + MIN_SIZE) / 2;
                }
                
                estH += unit.text.length * size;
                return { unit, size };
            });

            const estW = MAX_SIZE * 1.2;
            const endTime = line.endTime ?? line.startTime + 3;

            let bestX = width * 0.15 + localPrng() * width * 0.7;
            
            // CRITICAL FIX for world-fixed lyrics:
            // Calculate worldY so that the temporal MIDPOINT of the line crosses the spatial MIDPOINT of the screen!
            // This ensures long vertical lines are perfectly centered during their active lifespan, preventing cutoffs.
            const midTime = (line.startTime + endTime) / 2;
            const bestY = midTime * SCROLL_SPEED + (height / 2) - (estH / 2);

            // Collision avoidance (only lines overlapping in time, and ONLY shift X to preserve time-sync)
            for (let i = 0; i < 20; i++) {
                let overlap = false;
                for (const rect of placedRects) {
                    if (line.startTime < rect.endTime && endTime > rect.startTime) {
                        if (Math.abs(rect.y - bestY) < (rect.h + estH) * 0.5 && Math.abs(rect.x - bestX) < (rect.w + estW) * 0.5) {
                            overlap = true;
                            break;
                        }
                    }
                }
                if (!overlap) break;
                // Shift X significantly to escape the column
                bestX += (localPrng() > 0.5 ? 1 : -1) * (estW + 50 + localPrng() * 100);
                bestX = Math.max(width * 0.1, Math.min(width * 0.9 - estW, bestX));
            }

            placedRects.push({ x: bestX, y: bestY, w: estW, h: estH, startTime: line.startTime, endTime });

            layouts.set(lineIndex, {
                worldX: bestX,
                worldY: bestY,
                opacity,
                isOutline,
                layoutUnits: unitsWithStyle
            });
        });
        
        return layouts;
    }, [lines, seed]);

    // Update active lines based on currentTime (discrete updates, roughly every few seconds)
    useMotionValueEvent(currentTime, 'change', (time) => {
        // Massive time windows to ensure words spawn completely off-screen and scroll all the way out
        const PRE_TIME = 15.0;
        const POST_TIME = 15.0;

        const newActiveLines: number[] = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const startTime = line.startTime;
            const endTime = line.endTime ?? (startTime + 3);

            if (time >= startTime - PRE_TIME && time <= endTime + POST_TIME) {
                newActiveLines.push(i);
            }
        }

        // Only update React state if the visible set of lines changed
        setActiveLines(prev => {
            if (prev.length !== newActiveLines.length) return newActiveLines;
            for (let i = 0; i < prev.length; i++) {
                if (prev[i] !== newActiveLines[i]) return newActiveLines;
            }
            return prev;
        });
    });

    // The core RAF loop for the Single Source of Truth
    useEffect(() => {
        let rafId: number;

        const loop = () => {
            const time = currentTime.get();
            // Must match the useMemo SCROLL_SPEED perfectly!
            const SCROLL_SPEED = 250 * cieloTuning.cameraSpeed;

            // CameraY is strictly bound to the timeline!
            cameraY.current = time * SCROLL_SPEED;

            // Update DOM Lyrics
            const width = containerRef.current?.clientWidth ?? 1200;
            const height = containerRef.current?.clientHeight ?? 800;

            activeLines.forEach(lineIndex => {
                const layout = lineLayouts.get(lineIndex);
                if (!layout) return;

                const domNode = lineNodesRef.current.get(lineIndex);
                if (domNode) {
                    // Revert to world space, but because worldY is perfectly centered in useMemo,
                    // we don't need arbitrary offsets here. Just standard camera subtraction.
                    // (We also add a small adjustment to keep it strictly aligned if actual viewport height differs from 800 base)
                    const screenY = layout.worldY - cameraY.current + (height - 800) / 2;
                    const baseTransform = `translate3d(${layout.worldX}px, ${screenY}px, 0)`;

                    const shadowNode = domNode.children[0] as HTMLElement | undefined;
                    const textNode = domNode.children[1] as HTMLElement | undefined;

                    if (shadowNode && textNode) {
                        shadowNode.style.transform = baseTransform;
                        shadowNode.style.opacity = `${layout.opacity}`;
                        shadowNode.style.textShadow = `0px 0px 10px rgba(0,0,0,0.6), 0px 0px 20px rgba(0,0,0,0.4)`;

                        textNode.style.transform = baseTransform;
                        textNode.style.opacity = `${layout.opacity}`;
                        if (layout.isOutline) {
                            textNode.style.color = 'transparent';
                            textNode.style.WebkitTextStroke = `3px ${theme.primaryColor}`;
                        } else {
                            textNode.style.color = theme.primaryColor;
                            textNode.style.WebkitTextStroke = 'none';
                        }
                        
                        // Word-by-word reveal (Iterating deeply through unit spans to word spans)
                        const line = lines[lineIndex];
                        let wordIdx = 0;
                        for (let i = 0; i < shadowNode.children.length; i++) {
                            const uSpan1 = shadowNode.children[i];
                            const uSpan2 = textNode.children[i];
                            for (let j = 0; j < uSpan1.children.length; j++) {
                                const span1 = uSpan1.children[j] as HTMLElement;
                                const span2 = uSpan2.children[j] as HTMLElement;
                                
                                const w = line.words[wordIdx];
                                if (!w) break;
                                
                                if (time >= w.startTime) {
                                    span1.style.opacity = '1';
                                    span2.style.opacity = '1';
                                    span1.style.transform = 'scale(1)';
                                    span2.style.transform = 'scale(1)';
                                    span1.style.filter = 'blur(0px)';
                                    span2.style.filter = 'blur(0px)';
                                } else {
                                    span1.style.opacity = '0';
                                    span2.style.opacity = '0';
                                    span1.style.transform = 'scale(1.2)';
                                    span2.style.transform = 'scale(1.2)';
                                    span1.style.filter = 'blur(10px)';
                                    span2.style.filter = 'blur(10px)';
                                }
                                wordIdx++;
                            }
                        }
                    }
                }
            });

            rafId = requestAnimationFrame(loop);
        };

        rafId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafId);
    }, [activeLines, cieloTuning.cameraSpeed, currentTime, theme.primaryColor, theme.isDaylight, lineLayouts]);

    return (
        <VisualizerShell {...props}>
            <div ref={containerRef} className="absolute inset-0 overflow-hidden pointer-events-none">
                {/* Background WebGL Shader layer */}
                <CieloBackground
                    currentTime={currentTime}
                    audioPower={audioPower}
                    audioBands={audioBands}
                    theme={theme}
                    coverColors={coverColors}
                    tuning={cieloTuning}
                />

                {/* Full Line Vertical Lyrics DOM layer */}
                <div className="absolute inset-0">
                    {activeLines.map(lineIndex => {
                        const layout = lineLayouts.get(lineIndex);
                        if (!layout) return null;

                        return (
                            <div
                                key={lineIndex}
                                ref={(el) => {
                                    if (el) lineNodesRef.current.set(lineIndex, el);
                                    else lineNodesRef.current.delete(lineIndex);
                                }}
                                className="absolute top-0 left-0" // NO stacking context properties here!
                            >
                                {/* 1. Legibility Halo (Normal blend) */}
                                <div className="relative font-black tracking-widest pointer-events-none" style={{ writingMode: 'vertical-rl', color: 'transparent', willChange: 'transform, opacity, filter' }}>
                                    {layout.layoutUnits.map((u, i) => (
                                        <span key={i} style={{ fontSize: `${u.size}px`, lineHeight: 1.1 }}>
                                            {u.unit.words.map((w, j) => (
                                                <span key={j} style={{ display: 'inline-block', opacity: 0, transform: 'scale(1.2)', filter: 'blur(10px)', transition: 'opacity 0.3s ease-out, transform 0.3s cubic-bezier(0.1, 0.9, 0.2, 1), filter 0.3s ease-out' }}>{w.text}</span>
                                            ))}
                                        </span>
                                    ))}
                                </div>
                                {/* 2. Text (Difference blend) - Directly inverts the canvas (darkened by halo) */}
                                <div className="absolute top-0 left-0 font-black tracking-widest pointer-events-none" style={{ writingMode: 'vertical-rl', mixBlendMode: 'difference', willChange: 'transform, opacity, filter' }}>
                                    {layout.layoutUnits.map((u, i) => (
                                        <span key={i} style={{ fontSize: `${u.size}px`, lineHeight: 1.1 }}>
                                            {u.unit.words.map((w, j) => (
                                                <span key={j} style={{ display: 'inline-block', opacity: 0, transform: 'scale(1.2)', filter: 'blur(10px)', transition: 'opacity 0.3s ease-out, transform 0.3s cubic-bezier(0.1, 0.9, 0.2, 1), filter 0.3s ease-out' }}>{w.text}</span>
                                            ))}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Standard Subtitle Overlay at the bottom */}
            <VisualizerSubtitleOverlay {...props} />
        </VisualizerShell>
    );
};

export default VisualizerCielo;
