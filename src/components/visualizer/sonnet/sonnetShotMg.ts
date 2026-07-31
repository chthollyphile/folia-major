import type { Theme } from '../../../types';
import type { SonnetShotKind } from './types';

// src/components/visualizer/sonnet/sonnetShotMg.ts
// Builds PV style high-density semantic decorative elements (HUD, Geometric Chaos, Particles)
type PixiModule = typeof import('pixi.js');

const colorNumber = (pixi: PixiModule, color: string) => pixi.Color.shared.setValue(color).toNumber();

export const buildSonnetShotMg = (
    pixi: PixiModule,
    kind: SonnetShotKind,
    theme: Theme,
    width: number,
    height: number,
    seed: number,
    iconTextures: Map<string, import('pixi.js').Texture>,
) => {
    const { Container, Graphics, Sprite, Text, TextStyle } = pixi;
    const container = new Container();
    const primary = colorNumber(pixi, theme.primaryColor);
    const secondary = colorNumber(pixi, theme.secondaryColor);
    const radius = Math.min(width, height);
    
    // Background UI layer
    const bg = new Graphics();
    
    // Helper: Draw a cross mark
    const drawCross = (x: number, y: number, size: number, color: number, alpha = 0.5) => {
        bg.moveTo(x - size, y - size).lineTo(x + size, y + size).stroke({ color, width: 1, alpha });
        bg.moveTo(x + size, y - size).lineTo(x - size, y + size).stroke({ color, width: 1, alpha });
    };

    // Helper: Draw diagonal hatching pattern
    const drawHatching = (x: number, y: number, w: number, h: number, spacing = 8) => {
        const lines = new Graphics();
        lines.rect(x, y, w, h);
        bg.addChild(lines); // just for keeping it in bg scope conceptually, wait, we need clipping
        
        const hatch = new Graphics();
        for (let i = -w; i < w + h; i += spacing) {
            hatch.moveTo(x + i, y).lineTo(x + i + h, y + h).stroke({ color: primary, width: 1, alpha: 0.15 });
        }
        
        const mask = new Graphics();
        mask.rect(x, y, w, h).fill({ color: 0xffffff });
        hatch.mask = mask;
        
        container.addChild(hatch);
        container.addChild(mask);
    };

    // --- Component: HUD Overlays ---
    const hw = width / 2;
    const hh = height / 2;
    const marginX = width * 0.05;
    const marginY = height * 0.05;
    const size = 4;
    drawCross(-hw + marginX, -hh + marginY, size, primary, 0.4);
    drawCross(hw - marginX, -hh + marginY, size, primary, 0.4);
    drawCross(-hw + marginX, hh - marginY, size, primary, 0.4);
    drawCross(hw - marginX, hh - marginY, size, primary, 0.4);

    // Left edge repeating crosses
    for (let i = 0; i < 8; i++) {
        drawCross(-hw + marginX, -hh + marginY + i * 20 + 30, 3, primary, 0.3);
    }

    // Bottom progress bar UI
    const barY = hh - marginY - 10;
    bg.moveTo(-hw + marginX + 20, barY).lineTo(hw - marginX - 20, barY).stroke({ color: primary, width: 1, alpha: 0.3 });
    drawCross(-hw + marginX + 10, barY, 3, primary, 0.5);
    drawCross(-hw + marginX + 30, barY, 3, primary, 0.5);
    drawCross(hw - marginX - 10, barY, 3, primary, 0.5);
    bg.circle(0, barY, 2).fill({ color: secondary, alpha: 0.8 });

    // --- Component: Geometric Chaos ---
    if (kind === 'type-impact' || kind === 'fragment-collage') {
        // Massive overlapping geometries
        const geo = new Graphics();
        
        const geoVariant = seed % 5;
        
        if (geoVariant === 0) {
            // Variant 0: Huge circular frame with sunburst
            geo.circle(0, 0, radius * 0.6).stroke({ color: primary, width: 6, alpha: 0.8 });
            geo.circle(0, 0, radius * 0.58).stroke({ color: primary, width: 2, alpha: 0.4 });
            for (let i = 0; i < 32; i++) {
                const angle = (i / 32) * Math.PI * 2;
                const r1 = radius * (0.3 + (i % 3) * 0.05);
                const r2 = radius * 0.55;
                geo.moveTo(Math.cos(angle) * r1, Math.sin(angle) * r1)
                   .lineTo(Math.cos(angle) * r2, Math.sin(angle) * r2)
                   .stroke({ color: primary, width: 1, alpha: 0.2 + (i % 2) * 0.1 });
            }
        } else if (geoVariant === 1) {
            // Variant 1: Nested Diamonds
            const r = radius * 0.7;
            geo.moveTo(0, -r).lineTo(r, 0).lineTo(0, r).lineTo(-r, 0).lineTo(0, -r).stroke({ color: primary, width: 6, alpha: 0.8 });
            geo.moveTo(0, -r*0.96).lineTo(r*0.96, 0).lineTo(0, r*0.96).lineTo(-r*0.96, 0).lineTo(0, -r*0.96).stroke({ color: primary, width: 2, alpha: 0.4 });
            geo.moveTo(0, -r*0.4).lineTo(r*0.4, 0).lineTo(0, r*0.4).lineTo(-r*0.4, 0).lineTo(0, -r*0.4).stroke({ color: primary, width: 1, alpha: 0.6 });
            geo.moveTo(-r, 0).lineTo(r, 0).stroke({ color: primary, width: 1, alpha: 0.3 });
            geo.moveTo(0, -r).lineTo(0, r).stroke({ color: primary, width: 1, alpha: 0.3 });
        } else if (geoVariant === 2) {
            // Variant 2: Tech Hexagon Grid
            const drawHex = (x: number, y: number, r: number, w: number, a: number) => {
                geo.moveTo(x + r*Math.sin(0), y - r*Math.cos(0));
                for(let j=1; j<=6; j++) geo.lineTo(x + r*Math.sin(j*Math.PI/3), y - r*Math.cos(j*Math.PI/3));
                geo.stroke({color: primary, width: w, alpha: a});
            };
            drawHex(0, 0, radius * 0.6, 6, 0.8);
            drawHex(0, 0, radius * 0.57, 2, 0.4);
            drawHex(0, 0, radius * 0.25, 1, 0.5);
            // Draw connecting spokes
            for(let j=0; j<6; j++) {
                const angle = j*Math.PI/3 - Math.PI/6; // pointing to vertices
                geo.moveTo(Math.cos(angle)*radius*0.25, Math.sin(angle)*radius*0.25)
                   .lineTo(Math.cos(angle)*radius*0.57, Math.sin(angle)*radius*0.57)
                   .stroke({color: primary, width: 2, alpha: 0.4});
            }
        } else if (geoVariant === 3) {
            // Variant 3: Organic Rings (Benzene)
            const hexR = radius * 0.22;
            const drawBenzene = (cx: number, cy: number, scale: number, rotationOffset = 0) => {
                const r = hexR * scale;
                geo.moveTo(cx + r*Math.sin(rotationOffset), cy - r*Math.cos(rotationOffset));
                for(let j=1; j<=6; j++) {
                    geo.lineTo(cx + r*Math.sin(j*Math.PI/3 + rotationOffset), cy - r*Math.cos(j*Math.PI/3 + rotationOffset));
                }
                geo.stroke({color: primary, width: 3, alpha: 0.8});
                
                // Double bonds
                for(let j=0; j<6; j+=2) {
                    const innerR = r * 0.82;
                    geo.moveTo(cx + innerR*Math.sin(j*Math.PI/3 + rotationOffset), cy - innerR*Math.cos(j*Math.PI/3 + rotationOffset))
                       .lineTo(cx + innerR*Math.sin((j+1)*Math.PI/3 + rotationOffset), cy - innerR*Math.cos((j+1)*Math.PI/3 + rotationOffset))
                       .stroke({color: primary, width: 2, alpha: 0.5});
                }
            };
            
            const rMain = hexR * 1.2;
            drawBenzene(0, 0, 1.2); // Central ring
            
            // Right fused ring (distance is rMain * sqrt(3))
            const dx = Math.sin(Math.PI/3) * rMain * 2;
            drawBenzene(dx, 0, 1.2); 
            
            // Left-top fused ring
            const branchDist = Math.sin(Math.PI/3) * rMain * 2;
            drawBenzene(-Math.sin(Math.PI/6) * branchDist, -Math.cos(Math.PI/6) * branchDist, 1.2);
            
            // Connecting structural line
            geo.moveTo(0, rMain)
               .lineTo(0, rMain + radius * 0.2)
               .lineTo(radius * 0.15, rMain + radius * 0.35)
               .stroke({color: primary, width: 2, alpha: 0.6});
        } else {
            // Variant 4: Atomic electron orbitals (intersecting ellipses)
            const ellR = radius * 0.7;
            for(let i=0; i<3; i++) {
                const angle = i * Math.PI / 3;
                const steps = 60;
                for(let j=0; j<=steps; j++) {
                    const t = j * Math.PI * 2 / steps;
                    const ex = Math.cos(t) * ellR;
                    const ey = Math.sin(t) * ellR * 0.18;
                    const rx = ex * Math.cos(angle) - ey * Math.sin(angle);
                    const ry = ex * Math.sin(angle) + ey * Math.cos(angle);
                    if(j===0) geo.moveTo(rx, ry);
                    else geo.lineTo(rx, ry);
                }
                geo.stroke({color: primary, width: 1, alpha: 0.3});
            }
            // Add a small nucleus core
            geo.circle(0, 0, radius * 0.05).fill({color: primary, alpha: 0.8});
        }

        // Intersecting Rectangles with Hatching (Shared across all variants to maintain PV consistency)
        geo.rect(-radius * 0.4, -radius * 0.2, radius * 0.6, radius * 0.15).fill({ color: primary, alpha: 0.7 });
        geo.rect(-radius * 0.1, radius * 0.1, radius * 0.5, radius * 0.3).stroke({ color: primary, width: 2, alpha: 0.6 });
        
        container.addChild(geo);

        // Add hatching rect
        drawHatching(-radius * 0.3, -radius * 0.4, radius * 0.4, radius * 0.25, 6);
    } else if (kind === 'editorial-column') {
        // Strict grids
        for (let i = 1; i <= 6; i++) {
            const x = -hw + width * (i / 7);
            bg.moveTo(x, -hh).lineTo(x, hh).stroke({ color: primary, width: 1, alpha: 0.15 });
        }
        for (let i = 1; i <= 4; i++) {
            const y = -hh + height * (i / 5);
            bg.moveTo(-hw, y).lineTo(hw, y).stroke({ color: primary, width: 1, alpha: 0.15 });
        }
        bg.rect(-hw + width * 0.2, -hh + height * 0.2, width * 0.6, height * 0.6).stroke({ color: primary, width: 4, alpha: 0.5 });
    } else {
        // quiet-tableau or mask-reveal (Minimalistic scattered elements)
        for (let i = 0; i < 5; i++) {
            const size = 10 + (seed % (i + 1)) * 5;
            bg.rect(
                -hw + width * (0.2 + ((seed * 11 + i) % 60) / 100),
                -hh + height * (0.2 + ((seed * 17 + i) % 60) / 100),
                size, size
            ).fill({ color: primary, alpha: 0.4 });
        }
    }

    container.addChild(bg);

    // --- Component: Floating Particles ---
    const particleLayer = new Container();
    const particleCount = kind === 'type-impact' ? 24 : 12;
    for (let i = 0; i < particleCount; i++) {
        const p = new Graphics();
        const type = (seed + i) % 3; // 0: square, 1: diamond, 2: star
        const pSize = 4 + (seed + i) % 12;
        
        if (type === 0) {
            p.rect(-pSize/2, -pSize/2, pSize, pSize).fill({ color: (i % 2 === 0 ? primary : secondary), alpha: 0.6 });
        } else if (type === 1) {
            p.moveTo(0, -pSize).lineTo(pSize, 0).lineTo(0, pSize).lineTo(-pSize, 0).fill({ color: primary, alpha: 0.5 });
        } else {
            // 4-point star (sparkle)
            p.moveTo(0, -pSize * 1.5).quadraticCurveTo(0, 0, pSize * 1.5, 0)
             .quadraticCurveTo(0, 0, 0, pSize * 1.5)
             .quadraticCurveTo(0, 0, -pSize * 1.5, 0)
             .quadraticCurveTo(0, 0, 0, -pSize * 1.5)
             .fill({ color: primary, alpha: 0.8 });
        }
        
        p.position.set(
            -hw + width * (((seed * 31 + i * 47) % 100) / 100),
            -hh + height * (((seed * 73 + i * 19) % 100) / 100)
        );
        p.rotation = (seed + i * 13) % 360 * Math.PI / 180;
        particleLayer.addChild(p);
    }
    container.addChild(particleLayer);

    return container;
};
