import type { Theme } from '../../../types';
import type { SonnetSemanticSegment } from './types';
import type { SonnetTypographyPlacement } from './sonnetTypographyLayout';

// src/components/visualizer/sonnet/sonnetGuides.ts
// Creates short-lived semantic lead-in curves and locator marks before text arrival.
type PixiModule = typeof import('pixi.js');

export interface SonnetGuideView {
    container: import('pixi.js').Container;
    startTime: number;
    endTime: number;
    maxAlpha: number;
}

const colorNumber = (pixi: PixiModule, color: string) => pixi.Color.shared.setValue(color).toNumber();

export const resolveSonnetGuideCue = (
    segment: SonnetSemanticSegment,
    textStartTime = segment.startTime,
) => {
    const leadDuration = Math.min(
        0.38,
        Math.max(0.2, 0.18 + (segment.endTime - segment.startTime) * 0.1),
    );
    return {
        startTime: textStartTime - leadDuration,
        endTime: textStartTime + 0.65, // Extended duration to let decorations burst and curve fade
    };
};

export const createSonnetGuide = (
    pixi: PixiModule,
    segment: SonnetSemanticSegment,
    placement: SonnetTypographyPlacement,
    theme: Theme,
    fontSize: number,
    textStartTime = segment.startTime,
): SonnetGuideView & { update?: (progress: number) => void } => {
    const container = new pixi.Container();
    const graphics = new pixi.Graphics();
    
    // Container for geometric decorations
    const shapesContainer = new pixi.Container();
    
    const isHero = placement.role === 'hero';
    const fallbackDirection = placement.timingPhase < 0.5 ? -1 : 1;
    const startX = placement.enterX || fallbackDirection * fontSize * 1.8;
    const startY = placement.enterY || -fontSize * 0.9;
    
    const color = colorNumber(
        pixi,
        isHero ? theme.accentColor : theme.secondaryColor,
    );
    
    const strokeProps = {
        color,
        width: isHero ? 1.8 : 1,
        alpha: isHero ? 0.82 : 0.55,
    };

    // Cubic bezier control points
    const p0 = { x: startX, y: startY };
    const p1 = { x: startX * 0.72, y: startY * 0.3 };
    const p2 = { x: -startX * 0.18, y: -startY * 0.22 };
    const p3 = { x: 0, y: 0 };
    
    const getBezier = (p_0: {x:number, y:number}, p_1: {x:number, y:number}, p_2: {x:number, y:number}, p_3: {x:number, y:number}, t: number) => {
        const mt = 1 - t;
        return {
            x: mt*mt*mt*p_0.x + 3*mt*mt*t*p_1.x + 3*mt*t*t*p_2.x + t*t*t*p_3.x,
            y: mt*mt*mt*p_0.y + 3*mt*mt*t*p_1.y + 3*mt*t*t*p_2.y + t*t*t*p_3.y
        };
    };

    // Create random small geometric shapes
    const numShapes = isHero ? 6 : 3;
    const shapeData: any[] = [];
    
    for (let i = 0; i < numShapes; i++) {
        const shape = new pixi.Graphics();
        const type = Math.floor(Math.random() * 4);
        const size = (isHero ? 3 : 1.5) + Math.random() * 3.5;
        const sAlpha = isHero ? 0.8 : 0.6;
        
        if (type === 0) {
            shape.circle(0, 0, size).fill({ color, alpha: sAlpha });
        } else if (type === 1) {
            shape.rect(-size, -size, size * 2, size * 2).fill({ color, alpha: sAlpha });
        } else if (type === 2) {
            shape.moveTo(-size, 0).lineTo(size, 0).moveTo(0, -size).lineTo(0, size).stroke({ color, width: 2, alpha: sAlpha });
        } else {
            shape.moveTo(0, -size).lineTo(size, 0).lineTo(0, size).lineTo(-size, 0).fill({ color, alpha: sAlpha });
        }
        
        shapesContainer.addChild(shape);
        shapeData.push({
            obj: shape,
            angle: Math.random() * Math.PI * 2,
            speed: (15 + Math.random() * 45) * (isHero ? 1 : 0.7),
            rotSpeed: (Math.random() - 0.5) * 8,
        });
    }

    // Create elegant close-range silk threads weaving around the text
    const trackingTrails: any[] = [];
    if (isHero || Math.random() > 0.4) {
        // Thread 1: Tight S-Curve weaving through the text
        const d = Math.random() > 0.5 ? 1 : -1;
        const yOffset = (Math.random() - 0.5) * fontSize * 0.8;
        trackingTrails.push({
            p0: { x: -d * fontSize * 2.5, y: yOffset + fontSize * 1.5 },
            p1: { x: -d * fontSize * 0.8, y: yOffset - fontSize * 2.0 },
            p2: { x: d * fontSize * 0.8, y: yOffset + fontSize * 2.0 },
            p3: { x: d * fontSize * 2.5, y: yOffset - fontSize * 1.5 },
            delay: Math.random() * 0.15
        });
    }
    if (isHero || Math.random() > 0.6) {
        // Thread 2: Tight Intersecting Loop (Ribbon) wrapping the text
        const d = Math.random() > 0.5 ? 1 : -1;
        trackingTrails.push({
            p0: { x: -fontSize * 2.0, y: -d * fontSize * 1.8 },
            p1: { x: fontSize * 2.0, y: d * fontSize * 1.8 },
            p2: { x: -fontSize * 2.0, y: d * fontSize * 1.8 },
            p3: { x: fontSize * 2.0, y: -d * fontSize * 1.8 },
            delay: Math.random() * 0.1
        });
    }

    container.addChild(graphics, shapesContainer);
    container.position.set(placement.x, placement.y);
    container.alpha = 0;
    
    const cue = resolveSonnetGuideCue(segment, textStartTime);
    
    const update = (progress: number) => {
        // Curve draws in quickly from 0 to 0.35, then fades out from 0.4 to 0.7
        const drawProgress = Math.min(1, Math.max(0, progress / 0.35));
        const fadeOut = 1 - Math.min(1, Math.max(0, (progress - 0.4) / 0.3));
        
        graphics.clear();
        if (drawProgress > 0 && fadeOut > 0) {
            const steps = 20;
            let prevP = p0;
            for (let i = 1; i <= steps; i++) {
                // To make it look like a star trail, we draw a fading, tapered tail
                const t = (i / steps) * drawProgress;
                const p = getBezier(p0, p1, p2, p3, t);
                const intensity = Math.pow(i / steps, 2); // Quadratic curve: 0 at tail, 1 at head
                
                // Enhanced thickness and brightness
                const segmentAlpha = Math.min(1, intensity * strokeProps.alpha * fadeOut * 1.6); 
                const segmentWidth = (isHero ? 2.5 : 1.5) + intensity * (isHero ? 5.0 : 3.0); 
                
                graphics.moveTo(prevP.x, prevP.y);
                graphics.lineTo(p.x, p.y);
                graphics.stroke({ color, width: segmentWidth, alpha: segmentAlpha });
                prevP = p;
            }
            
            // Star Head (Core + Glow) - Made more prominent
            const head = getBezier(p0, p1, p2, p3, drawProgress);
            graphics.circle(head.x, head.y, isHero ? 14 : 9).fill({ color, alpha: 0.5 * fadeOut });
            graphics.circle(head.x, head.y, isHero ? 4.5 : 3).fill({ color: 0xffffff, alpha: 1 * fadeOut });
        }
        
        // Rhythm Game Style Silk Thread Tracks
        trackingTrails.forEach(trail => {
            const localProg = (progress - trail.delay) / 0.55;
            if (localProg > -0.15 && fadeOut > 0) {
                // 1. Draw the anticipating faint track (Slider Body)
                const trackAlpha = Math.min(1, (localProg + 0.15) * 5) * strokeProps.alpha * 0.25 * fadeOut;
                if (trackAlpha > 0) {
                    const trackSteps = 30;
                    let prevP = getBezier(trail.p0, trail.p1, trail.p2, trail.p3, 0);
                    graphics.moveTo(prevP.x, prevP.y);
                    for (let i = 1; i <= trackSteps; i++) {
                        const p = getBezier(trail.p0, trail.p1, trail.p2, trail.p3, i / trackSteps);
                        graphics.lineTo(p.x, p.y);
                    }
                    graphics.stroke({ color, width: isHero ? 2 : 1, alpha: trackAlpha });
                }

                // 2. Head and Tail sweep
                if (localProg > 0 && localProg < 1.3) {
                    const headT = Math.min(1, localProg);
                    const tailT = Math.max(0, localProg - 0.35); // The comet tail length
                    
                    if (headT > tailT) {
                        const steps = 25;
                        let prevP = getBezier(trail.p0, trail.p1, trail.p2, trail.p3, tailT);
                        
                        for (let i = 1; i <= steps; i++) {
                            const stepT = tailT + (i / steps) * (headT - tailT);
                            const pos = getBezier(trail.p0, trail.p1, trail.p2, trail.p3, stepT);
                            const intensity = Math.pow(i / steps, 2); 
                            const alpha = intensity * strokeProps.alpha * fadeOut * 0.9;
                            const width = (isHero ? 2 : 1) + intensity * (isHero ? 5 : 2.5);
                            
                            graphics.moveTo(prevP.x, prevP.y);
                            graphics.lineTo(pos.x, pos.y);
                            graphics.stroke({ color, width, alpha });
                            prevP = pos;
                        }
                    }
                    
                    // 3. Glowing Head and Follow Circle
                    if (headT > 0 && headT < 1) {
                        const headPos = getBezier(trail.p0, trail.p1, trail.p2, trail.p3, headT);
                        graphics.circle(headPos.x, headPos.y, isHero ? 7 : 4).fill({ color, alpha: 0.9 * fadeOut });
                        graphics.circle(headPos.x, headPos.y, isHero ? 2.5 : 1.5).fill({ color: 0xffffff, alpha: 1 * fadeOut });
                        
                        // Outer "follow circle" glow for rhythm game vibe
                        graphics.circle(headPos.x, headPos.y, isHero ? 20 : 12).stroke({ color, width: isHero ? 2 : 1, alpha: 0.4 * fadeOut });
                    }
                }
            }
        });
        
        // Shapes burst outwards when text starts to settle (progress ~ 0.3)
        const burstProgress = Math.min(1, Math.max(0, (progress - 0.3) / 0.7));
        shapeData.forEach(s => {
            const ease = 1 - Math.pow(1 - burstProgress, 3); // Expo out
            s.obj.x = p3.x + Math.cos(s.angle) * s.speed * ease;
            s.obj.y = p3.y + Math.sin(s.angle) * s.speed * ease;
            s.obj.rotation = s.rotSpeed * burstProgress;
            s.obj.alpha = (1 - burstProgress) * (isHero ? 1 : 0.8);
            s.obj.scale.set(1 - burstProgress * 0.4);
        });
    };

    return {
        container,
        ...cue,
        maxAlpha: isHero ? 0.95 : 0.7,
        update,
    };
};
