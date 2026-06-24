import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMotionValueEvent } from 'framer-motion';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';
import { type VisualizerSharedProps } from '../definition';
import { DEFAULT_CIELO_TUNING } from '../../../types';
import CieloBackground from './CieloBackground';
import { colorWithAlpha } from '../colorMix';
import { extractColors } from '../../../utils/colorExtractor';

// A simple predictable random number generator based on a seed
const sfc32 = (a: number, b: number, c: number, d: number) => {
    return function() {
        a |= 0; b |= 0; c |= 0; d |= 0; 
        const t = (a + b | 0) + d | 0;
        d = d + 1 | 0;
        a = b ^ b >>> 9;
        b = c + (c << 3) | 0;
        c = c << 21 | c >>> 11;
        c = c + t | 0;
        return (t >>> 0) / 4294967296;
    }
};

const generateHashString = (str: string) => {
    let hash = 1779033703 ^ str.length;
    for(let i = 0; i < str.length; i++) {
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
    const wordNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
    
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

    // We initialize a PRNG based on the song seed for consistent lyric placement cascading without overlaps
    const wordLayouts = useMemo(() => {
        const layouts = new Map<string, { worldX: number, worldY: number, fontSize: number, opacity: number, isOutline: boolean }>();
        const hashStr = typeof seed === 'string' ? seed : seed.toString();
        const getHash = generateHashString(hashStr);
        const localPrng = sfc32(getHash(), getHash(), getHash(), getHash());
        
        const SCROLL_SPEED = 250 * cieloTuning.cameraSpeed; // Much faster base speed
        const width = 1200; // Reference width for generation
        
        const placedRects: { x: number, y: number, w: number, h: number }[] = [];
        
        lines.forEach((line, lineIndex) => {
            const lineHash = generateHashString(seed + lineIndex.toString())();
            // Stagger the line base X
            const startX = width * 0.2 + (lineHash % 1000 / 1000) * width * 0.6;
            
            line.words.forEach((word, wordIndex) => {
                const wordId = `${lineIndex}_${wordIndex}`;
                
                let baseTimeY = word.startTime * SCROLL_SPEED;
                
                const isHuge = localPrng() > 0.85;
                const isOutline = localPrng() > 0.7;
                // Directly use fontSize instead of scale to avoid blurry WebKit transform rasterization
                const fontSize = isHuge ? 150 + localPrng() * 100 : 50 + localPrng() * 50;
                
                // Estimated bounding box
                const estW = word.text.length * fontSize * 1.1;
                const estH = fontSize * 1.2;
                
                let bestX = startX;
                let bestY = baseTimeY;
                let minOverlap = Infinity;
                
                // Collision avoidance: try 15 random offset candidates and pick the one with minimal overlap
                for (let i = 0; i < 15; i++) {
                    const testX = startX + (localPrng() - 0.5) * 800;
                    const testY = baseTimeY + (localPrng() - 0.5) * 80; // Allow slight Y jitter
                    
                    let overlapArea = 0;
                    for (const rect of placedRects) {
                        // Fast vertical bounding check
                        if (Math.abs(rect.y - testY) < (rect.h + estH)) {
                            const dx = Math.max(0, Math.min(testX + estW/2, rect.x + rect.w/2) - Math.max(testX - estW/2, rect.x - rect.w/2));
                            const dy = Math.max(0, Math.min(testY + estH/2, rect.y + rect.h/2) - Math.max(testY - estH/2, rect.y - rect.h/2));
                            overlapArea += dx * dy;
                        }
                    }
                    if (overlapArea === 0) {
                        bestX = testX;
                        bestY = testY;
                        break; // Perfect placement found
                    }
                    if (overlapArea < minOverlap) {
                        minOverlap = overlapArea;
                        bestX = testX;
                        bestY = testY;
                    }
                }
                
                placedRects.push({ x: bestX, y: bestY, w: estW, h: estH });
                
                layouts.set(wordId, {
                    worldY: bestY,
                    worldX: bestX,
                    fontSize,
                    opacity: isOutline ? 0.8 : 0.4 + localPrng() * 0.4,
                    isOutline
                });
            });
        });
        return layouts;
    }, [lines, seed, cieloTuning.cameraSpeed]);

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
            const height = containerRef.current?.clientHeight ?? 800;

            activeLines.forEach(lineIndex => {
                const line = lines[lineIndex];
                line.words.forEach((word, wordIndex) => {
                    const wordId = `${lineIndex}_${wordIndex}`;
                    const layout = wordLayouts.get(wordId);
                    if (!layout) return;

                    const domNode = wordNodesRef.current.get(wordId);
                    if (domNode) {
                        // Offset by height * 0.35 so the word crosses the upper-middle of screen exactly when sung
                        const screenY = layout.worldY - cameraY.current + (height * 0.35);
                        
                        // Transform without scale to guarantee crisp vector rendering!
                        domNode.style.transform = `translate3d(${layout.worldX}px, ${screenY}px, 0)`;
                        domNode.style.fontSize = `${layout.fontSize}px`;
                        domNode.style.opacity = `${layout.opacity}`;
                        
                        if (layout.isOutline) {
                            domNode.style.color = 'transparent';
                            domNode.style.WebkitTextStroke = `2px ${theme.primaryColor}`;
                        } else {
                            domNode.style.color = theme.primaryColor;
                            domNode.style.WebkitTextStroke = 'none';
                        }
                        
                        // Apply CSS blend mode so the text dynamically inverts against the WebGL shapes
                        domNode.style.mixBlendMode = 'difference';
                    }
                });
            });

            rafId = requestAnimationFrame(loop);
        };

        rafId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafId);
    }, [activeLines, cieloTuning.cameraSpeed, currentTime, theme.primaryColor, wordLayouts]);

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

                {/* Scattered Lyrics DOM layer (Word Level) */}
                <div className="absolute inset-0">
                    {activeLines.map(lineIndex => {
                        const line = lines[lineIndex];
                        return line.words.map((word, wordIndex) => {
                            const wordId = `${lineIndex}_${wordIndex}`;
                            return (
                                <div
                                    key={wordId}
                                    ref={(el) => {
                                        if (el) wordNodesRef.current.set(wordId, el);
                                        else wordNodesRef.current.delete(wordId);
                                    }}
                                    className="absolute top-0 left-0 font-black tracking-widest origin-center whitespace-nowrap"
                                    style={{
                                        // Color is handled in the RAF loop to match state
                                        willChange: 'transform',
                                    }}
                                >
                                    {word.text}
                                </div>
                            );
                        });
                    })}
                </div>
            </div>

            {/* Standard Subtitle Overlay at the bottom */}
            <VisualizerSubtitleOverlay {...props} />
        </VisualizerShell>
    );
};

export default VisualizerCielo;
