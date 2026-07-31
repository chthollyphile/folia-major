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
        
        const geoVariant = seed % 14;
        
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
            // Variant 3: Organic Molecules
            const molVariant = seed % 3;
            
            if (molVariant === 0) {
                // Sub-variant 0: Benzene Cluster
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
                
                // Right fused ring
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
            } else if (molVariant === 1) {
                // Sub-variant 1: Caffeine/Serotonin-like (Fused hexagon + pentagon + branches)
                const hexR = radius * 0.22;
                geo.moveTo(0, -hexR);
                for(let j=1; j<=6; j++) geo.lineTo(hexR*Math.sin(j*Math.PI/3), -hexR*Math.cos(j*Math.PI/3));
                geo.stroke({color: primary, width: 3, alpha: 0.8});
                
                geo.moveTo(hexR*0.8*Math.sin(Math.PI/3), -hexR*0.8*Math.cos(Math.PI/3))
                   .lineTo(hexR*0.8*Math.sin(2*Math.PI/3), -hexR*0.8*Math.cos(2*Math.PI/3))
                   .stroke({color: primary, width: 2, alpha: 0.5});
                geo.moveTo(hexR*0.8*Math.sin(4*Math.PI/3), -hexR*0.8*Math.cos(4*Math.PI/3))
                   .lineTo(hexR*0.8*Math.sin(5*Math.PI/3), -hexR*0.8*Math.cos(5*Math.PI/3))
                   .stroke({color: primary, width: 2, alpha: 0.5});
                   
                const px1 = hexR * Math.sqrt(3)/2;
                const py1 = -hexR/2;
                const px2 = hexR * Math.sqrt(3)/2;
                const py2 = hexR/2;
                const pentTopX = px1 + hexR*0.8;
                const pentTopY = py1 - hexR*0.1;
                const pentMidX = px1 + hexR*1.2;
                const pentMidY = 0;
                const pentBotX = px2 + hexR*0.8;
                const pentBotY = py2 + hexR*0.1;
                
                geo.moveTo(px1, py1).lineTo(pentTopX, pentTopY).lineTo(pentMidX, pentMidY)
                   .lineTo(pentBotX, pentBotY).lineTo(px2, py2).stroke({color: primary, width: 3, alpha: 0.8});
                   
                const drawBranch = (sx: number, sy: number, angle: number, len: number, node: boolean) => {
                    const ex = sx + Math.cos(angle)*len;
                    const ey = sy + Math.sin(angle)*len;
                    geo.moveTo(sx, sy).lineTo(ex, ey).stroke({color: primary, width: 2, alpha: 0.6});
                    if (node) geo.circle(ex, ey, 6).stroke({color: primary, width: 2, alpha: 0.8});
                };
                
                drawBranch(0, -hexR, -Math.PI/2, radius*0.15, true); 
                drawBranch(-hexR*Math.sqrt(3)/2, hexR/2, Math.PI*0.8, radius*0.2, true); 
                drawBranch(-hexR*Math.sqrt(3)/2, -hexR/2, -Math.PI*0.8, radius*0.15, false);
                drawBranch(pentMidX, pentMidY, 0, radius*0.18, false); 
                drawBranch(pentMidX + radius*0.18, pentMidY, Math.PI/4, radius*0.1, true); 
            } else {
                // Sub-variant 2: Linear Polymer Chain (Zig-Zag backbone with functional groups)
                const segLen = radius * 0.18;
                const steps = 7;
                const startX = -segLen * (steps/2) * Math.cos(Math.PI/6);
                const pts: {x: number, y: number}[] = [];
                
                let cx = startX;
                let cy = 0;
                pts.push({x: cx, y: cy});
                for(let i=0; i<steps; i++) {
                    cx += segLen * Math.cos(Math.PI/6);
                    cy = (i % 2 === 0 ? 1 : -1) * segLen * Math.sin(Math.PI/6);
                    pts.push({x: cx, y: cy});
                }
                
                geo.moveTo(pts[0].x, pts[0].y);
                for(let i=1; i<=steps; i++) geo.lineTo(pts[i].x, pts[i].y);
                geo.stroke({color: primary, width: 3, alpha: 0.8});
                
                // Offset normal for double bond
                const nx = -Math.sin(Math.PI/6) * 6;
                const ny = Math.cos(Math.PI/6) * 6;
                geo.moveTo(pts[1].x + nx, pts[1].y + ny)
                   .lineTo(pts[2].x + nx, pts[2].y + ny)
                   .stroke({color: primary, width: 2, alpha: 0.5});
                
                for(let i=1; i<steps; i++) {
                    const angle = i % 2 === 0 ? Math.PI/2 : -Math.PI/2;
                    const bx = pts[i].x;
                    const by = pts[i].y + Math.sin(angle) * segLen * 0.6;
                    geo.moveTo(pts[i].x, pts[i].y).lineTo(bx, by).stroke({color: primary, width: 2, alpha: 0.5});
                    if (i % 2 !== 0) {
                        geo.circle(bx, by, 5).stroke({color: primary, width: 2, alpha: 0.8});
                    } else {
                        geo.moveTo(bx, by).lineTo(bx + segLen*0.5, by - segLen*0.3).stroke({color: primary, width: 2, alpha: 0.5});
                    }
                }
            }
        } else if (geoVariant === 4) {
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
        } else if (geoVariant === 5) {
            // Variant 5: Planet with Rings & Orbits
            const planetR = radius * 0.25;
            // Planet body
            geo.circle(0, 0, planetR).fill({ color: primary, alpha: 0.15 }).stroke({ color: primary, width: 2, alpha: 0.8 });
            // Planet texture (some arcs)
            geo.moveTo(-planetR * 0.7, -planetR * 0.5).quadraticCurveTo(0, -planetR * 0.2, planetR * 0.7, -planetR * 0.5).stroke({ color: primary, width: 1, alpha: 0.4 });
            geo.moveTo(-planetR * 0.9, 0).quadraticCurveTo(0, planetR * 0.3, planetR * 0.9, 0).stroke({ color: primary, width: 1, alpha: 0.4 });
            // Rings
            const ringRx = radius * 0.6;
            const ringRy = radius * 0.15;
            const angle = Math.PI / 6; // 30 degrees tilt
            
            const drawTiltedEllipse = (rx: number, ry: number, w: number, a: number, segments = 60) => {
                for(let j=0; j<=segments; j++) {
                    const t = j * Math.PI * 2 / segments;
                    const ex = Math.cos(t) * rx;
                    const ey = Math.sin(t) * ry;
                    const rotX = ex * Math.cos(angle) - ey * Math.sin(angle);
                    const rotY = ex * Math.sin(angle) + ey * Math.cos(angle);
                    
                    if(j===0) geo.moveTo(rotX, rotY);
                    else geo.lineTo(rotX, rotY);
                }
                geo.stroke({color: primary, width: w, alpha: a});
            }
            
            drawTiltedEllipse(ringRx, ringRy, 4, 0.5);
            drawTiltedEllipse(ringRx * 1.1, ringRy * 1.15, 1, 0.3);
            drawTiltedEllipse(ringRx * 1.25, ringRy * 1.3, 2, 0.2);
            
            // Distant orbit path
            geo.circle(0, 0, radius * 0.7).stroke({ color: primary, width: 1, alpha: 0.2 });
            geo.circle(Math.cos(Math.PI/4) * radius * 0.7, Math.sin(Math.PI/4) * radius * 0.7, 8).fill({ color: primary, alpha: 0.6 });
        } else if (geoVariant === 6) {
            // Variant 6: Abstract Wireframe Mountains (Cyberpunk grid landscape)
            const w = radius * 1.5;
            const h = radius * 0.8;
            const baseY = radius * 0.2;
            
            // Draw a sun/moon in background
            geo.circle(0, baseY - h * 0.6, radius * 0.3).stroke({ color: primary, width: 2, alpha: 0.4 });
            for (let i = 0; i < 5; i++) {
                geo.moveTo(-radius * 0.4, baseY - h * 0.6 + i * 15).lineTo(radius * 0.4, baseY - h * 0.6 + i * 15).stroke({ color: primary, width: 1, alpha: 0.3 });
            }
            
            // Draw mountain peaks (layered polygons)
            const peaks = 7;
            for (let layer = 0; layer < 3; layer++) {
                const layerW = w * (1 + layer * 0.2);
                const layerH = h * (0.5 + layer * 0.25);
                geo.moveTo(-layerW / 2, baseY);
                for (let i = 1; i < peaks; i++) {
                    const px = -layerW / 2 + (layerW / peaks) * i;
                    const py = baseY - layerH * (0.3 + 0.7 * Math.abs(Math.sin((seed + layer * 11 + i * 7))));
                    geo.lineTo(px, py);
                }
                geo.lineTo(layerW / 2, baseY);
                geo.stroke({ color: primary, width: 3 - layer, alpha: 0.6 - layer * 0.15 });
            }
            
            // Base line
            geo.moveTo(-w, baseY).lineTo(w, baseY).stroke({ color: primary, width: 4, alpha: 0.8 });
            
            // Grid floor
            for (let i = 0; i < 5; i++) {
                const gridY = baseY + Math.pow(i, 1.5) * 12;
                geo.moveTo(-w, gridY).lineTo(w, gridY).stroke({ color: primary, width: 1, alpha: 0.4 - i * 0.08 });
            }
            
            // Perspective lines
            for (let i = -4; i <= 4; i++) {
                geo.moveTo(i * radius * 0.2, baseY).lineTo(i * radius * 0.6, baseY + radius * 0.6).stroke({ color: primary, width: 1, alpha: 0.3 });
            }
        } else if (geoVariant === 7) {
            // Variant 7: Radar / Concentric Target
            for (let i = 1; i <= 6; i++) {
                const r = radius * 0.15 * i;
                geo.circle(0, 0, r).stroke({ color: primary, width: i % 2 === 0 ? 2 : 1, alpha: 0.2 + (i%3)*0.1 });
            }
            // Crosshairs
            geo.moveTo(-radius * 0.9, 0).lineTo(radius * 0.9, 0).stroke({ color: primary, width: 1, alpha: 0.4 });
            geo.moveTo(0, -radius * 0.9).lineTo(0, radius * 0.9).stroke({ color: primary, width: 1, alpha: 0.4 });
            
            // Radar sweep arc
            geo.moveTo(0, 0);
            geo.arc(0, 0, radius * 0.75, 0, Math.PI / 4);
            geo.lineTo(0, 0);
            geo.fill({ color: primary, alpha: 0.1 });
            geo.stroke({ color: primary, width: 2, alpha: 0.5 });
            
            // Outer tick marks
            const rOuter = radius * 0.8;
            for (let i = 0; i < 72; i++) {
                const angle = (i / 72) * Math.PI * 2;
                const len = i % 18 === 0 ? 20 : (i % 6 === 0 ? 10 : 5);
                geo.moveTo(Math.cos(angle) * rOuter, Math.sin(angle) * rOuter)
                   .lineTo(Math.cos(angle) * (rOuter + len), Math.sin(angle) * (rOuter + len))
                   .stroke({ color: primary, width: 1, alpha: 0.4 });
            }
            
            // Floating target lock
            const lockAngle = (seed % 360) * Math.PI / 180;
            const lockR = radius * 0.45;
            const lx = Math.cos(lockAngle) * lockR;
            const ly = Math.sin(lockAngle) * lockR;
            geo.rect(lx - 15, ly - 15, 30, 30).stroke({ color: primary, width: 2, alpha: 0.8 });
            geo.moveTo(lx, ly - 20).lineTo(lx, ly + 20).stroke({ color: primary, width: 1, alpha: 0.6 });
            geo.moveTo(lx - 20, ly).lineTo(lx + 20, ly).stroke({ color: primary, width: 1, alpha: 0.6 });
        } else if (geoVariant === 8) {
            // Variant 8: Technical HUD Decorative Frame
            const fw = radius * 0.85;
            const fh = radius * 0.65;
            
            // Corner brackets
            const bracketSize = radius * 0.15;
            const drawBracket = (cx: number, cy: number, sx: number, sy: number) => {
                geo.moveTo(cx - sx * bracketSize, cy)
                   .lineTo(cx, cy)
                   .lineTo(cx, cy - sy * bracketSize)
                   .stroke({ color: primary, width: 3, alpha: 0.7 });
                // Inner accent
                geo.moveTo(cx - sx * bracketSize * 0.8, cy - sy * 8)
                   .lineTo(cx - sx * 8, cy - sy * 8)
                   .lineTo(cx - sx * 8, cy - sy * bracketSize * 0.8)
                   .stroke({ color: primary, width: 1, alpha: 0.4 });
            };
            drawBracket(-fw, -fh, -1, -1);
            drawBracket(fw, -fh, 1, -1);
            drawBracket(-fw, fh, -1, 1);
            drawBracket(fw, fh, 1, 1);
            
            // Rulers
            for (let i = -fw + 20; i < fw - 20; i += 20) {
                geo.moveTo(i, -fh).lineTo(i, -fh - (i % 60 === 0 ? 12 : 6)).stroke({ color: primary, width: 1, alpha: 0.5 });
                geo.moveTo(i, fh).lineTo(i, fh + (i % 60 === 0 ? 12 : 6)).stroke({ color: primary, width: 1, alpha: 0.5 });
            }
            
            // Center target reticle
            geo.circle(0, 0, radius * 0.1).stroke({ color: primary, width: 2, alpha: 0.4 });
            geo.moveTo(-radius * 0.15, 0).lineTo(radius * 0.15, 0).stroke({ color: primary, width: 1, alpha: 0.4 });
            geo.moveTo(0, -radius * 0.15).lineTo(0, radius * 0.15).stroke({ color: primary, width: 1, alpha: 0.4 });
            
            // Data blocks
            geo.rect(-fw, -fh + 20, 10, 40).fill({ color: primary, alpha: 0.5 });
            geo.rect(-fw, -fh + 65, 10, 15).fill({ color: primary, alpha: 0.3 });
            geo.rect(fw - 10, fh - 60, 10, 40).fill({ color: primary, alpha: 0.5 });
        } else if (geoVariant === 9) {
            // Variant 9: Isometric 3D Cubes
            const drawCube = (cx: number, cy: number, size: number, alpha: number) => {
                const dy = size * 0.5; // Isometric projection roughly
                const dx = size * 0.866; // sqrt(3)/2
                
                // Top face
                geo.moveTo(cx, cy - size)
                   .lineTo(cx + dx, cy - dy)
                   .lineTo(cx, cy)
                   .lineTo(cx - dx, cy - dy)
                   .lineTo(cx, cy - size)
                   .fill({ color: primary, alpha: alpha * 0.15 })
                   .stroke({ color: primary, width: 2, alpha: alpha * 0.8 });
                   
                // Right face
                geo.moveTo(cx, cy)
                   .lineTo(cx + dx, cy - dy)
                   .lineTo(cx + dx, cy + size - dy)
                   .lineTo(cx, cy + size)
                   .lineTo(cx, cy)
                   .fill({ color: primary, alpha: alpha * 0.3 })
                   .stroke({ color: primary, width: 2, alpha: alpha * 0.8 });
                   
                // Left face
                geo.moveTo(cx, cy)
                   .lineTo(cx - dx, cy - dy)
                   .lineTo(cx - dx, cy + size - dy)
                   .lineTo(cx, cy + size)
                   .lineTo(cx, cy)
                   .fill({ color: primary, alpha: alpha * 0.05 })
                   .stroke({ color: primary, width: 2, alpha: alpha * 0.8 });
            };
            
            drawCube(0, 0, radius * 0.35, 0.8);
            drawCube(radius * 0.4, -radius * 0.15, radius * 0.2, 0.5);
            drawCube(-radius * 0.45, radius * 0.25, radius * 0.25, 0.6);
            drawCube(0, radius * 0.45, radius * 0.15, 0.4);
            
            // Background connection lines
            geo.moveTo(0, 0).lineTo(radius * 0.4, -radius * 0.15).stroke({ color: primary, width: 1, alpha: 0.3 });
            geo.moveTo(0, 0).lineTo(-radius * 0.45, radius * 0.25).stroke({ color: primary, width: 1, alpha: 0.3 });
        } else if (geoVariant === 10) {
            // Variant 10: Constellation Network
            geo.circle(0, 0, radius * 0.75).stroke({ color: primary, width: 1, alpha: 0.2 });
            geo.circle(0, 0, radius * 0.73).stroke({ color: primary, width: 2, alpha: 0.1 });
            
            const nodes: {x: number, y: number}[] = [];
            for (let i = 0; i < 18; i++) {
                const r = radius * (0.1 + ((seed * 17 + i * 23) % 65) / 100);
                const angle = ((seed * 11 + i * 37) % 360) * Math.PI / 180;
                nodes.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
            }
            
            // Draw nodes and connect nearby nodes
            for (let i = 0; i < nodes.length; i++) {
                geo.circle(nodes[i].x, nodes[i].y, 3).fill({ color: primary, alpha: 0.7 });
                geo.circle(nodes[i].x, nodes[i].y, 6).stroke({ color: primary, width: 1, alpha: 0.3 });
                
                for (let j = i + 1; j < nodes.length; j++) {
                    const dist = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
                    if (dist < radius * 0.45) {
                        geo.moveTo(nodes[i].x, nodes[i].y)
                           .lineTo(nodes[j].x, nodes[j].y)
                           .stroke({ color: primary, width: 1, alpha: 0.4 * (1 - dist / (radius * 0.45)) });
                    }
                }
            }
        } else if (geoVariant === 11) {
            // Variant 11: Moon and Lunar Phases
            const moonR = radius * 0.4;
            // Draw a large crescent moon using path
            geo.moveTo(0, -moonR);
            // Outer arc
            geo.arc(0, 0, moonR, -Math.PI/2, Math.PI/2, false);
            // Inner arc to create crescent
            geo.quadraticCurveTo(-moonR * 0.4, 0, 0, -moonR);
            geo.fill({ color: primary, alpha: 0.8 });
            
            // Draw a full moon wireframe behind it
            geo.circle(0, 0, moonR).stroke({ color: primary, width: 1, alpha: 0.3 });
            
            // Draw lunar phase orbit
            const orbitR = radius * 0.65;
            geo.circle(0, 0, orbitR).stroke({ color: primary, width: 1, alpha: 0.2 });
            
            // Draw mini moons (phases)
            for(let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2 - Math.PI/2;
                const mx = Math.cos(angle) * orbitR;
                const my = Math.sin(angle) * orbitR;
                
                geo.circle(mx, my, 8).stroke({ color: primary, width: 1, alpha: 0.5 });
                
                if (i === 0) { // New Moon
                    // empty
                } else if (i === 4) { // Full Moon
                    geo.circle(mx, my, 6).fill({ color: primary, alpha: 0.8 });
                } else { // Partial
                    geo.moveTo(mx, my - 6).arc(mx, my, 6, -Math.PI/2, Math.PI/2, i > 4).lineTo(mx, my - 6).fill({ color: primary, alpha: 0.5 });
                }
            }
            
            // Some geometric stars
            const drawStar = (sx: number, sy: number, sr: number) => {
                geo.moveTo(sx, sy - sr).lineTo(sx + sr*0.2, sy - sr*0.2)
                   .lineTo(sx + sr, sy).lineTo(sx + sr*0.2, sy + sr*0.2)
                   .lineTo(sx, sy + sr).lineTo(sx - sr*0.2, sy + sr*0.2)
                   .lineTo(sx - sr, sy).lineTo(sx - sr*0.2, sy - sr*0.2)
                   .fill({ color: primary, alpha: 0.7 });
            };
            drawStar(-radius*0.4, -radius*0.5, 12);
            drawStar(radius*0.5, -radius*0.3, 8);
            drawStar(-radius*0.2, radius*0.5, 15);
        } else if (geoVariant === 12) {
            // Variant 12: Geometric Floral / Botanical (Lotus)
            const petalLen = radius * 0.5;
            const drawPetal = (angle: number, length: number, width: number, alpha: number) => {
                const cx = 0, cy = 0;
                const endX = cx + Math.cos(angle) * length;
                const endY = cy + Math.sin(angle) * length;
                const ctrlDist = length * 0.5;
                
                // Left curve
                const lca = angle - width;
                const c1x = cx + Math.cos(lca) * ctrlDist;
                const c1y = cy + Math.sin(lca) * ctrlDist;
                
                // Right curve
                const rca = angle + width;
                const c2x = cx + Math.cos(rca) * ctrlDist;
                const c2y = cy + Math.sin(rca) * ctrlDist;
                
                geo.moveTo(cx, cy);
                geo.quadraticCurveTo(c1x, c1y, endX, endY);
                geo.quadraticCurveTo(c2x, c2y, cx, cy);
                geo.stroke({ color: primary, width: 1, alpha: alpha });
                if(alpha > 0.5) geo.fill({ color: primary, alpha: alpha * 0.2 });
            };
            
            // Multi-layered lotus
            for(let layer = 0; layer < 4; layer++) {
                const petals = 8 + layer * 4;
                const currentLen = petalLen * (1 - layer * 0.2);
                const currentWidth = 0.3 - layer * 0.05;
                const offset = layer * (Math.PI / petals);
                for(let i = 0; i < petals; i++) {
                    const angle = (i / petals) * Math.PI * 2 + offset;
                    drawPetal(angle, currentLen, currentWidth, 0.8 - layer * 0.15);
                }
            }
            
            // Central stamen
            geo.circle(0, 0, radius * 0.08).stroke({ color: primary, width: 2, alpha: 0.8 });
            geo.circle(0, 0, radius * 0.03).fill({ color: primary, alpha: 0.9 });
            
            // Geometric stems/vines looping around
            const stemR = radius * 0.65;
            for(let i = 0; i < 3; i++) {
                const startAngle = (i / 3) * Math.PI * 2;
                geo.moveTo(Math.cos(startAngle) * stemR, Math.sin(startAngle) * stemR);
                geo.bezierCurveTo(
                    Math.cos(startAngle + 1) * stemR * 1.2, Math.sin(startAngle + 1) * stemR * 1.2,
                    Math.cos(startAngle + 2) * stemR * 0.8, Math.sin(startAngle + 2) * stemR * 0.8,
                    Math.cos(startAngle + 3) * stemR, Math.sin(startAngle + 3) * stemR
                ).stroke({ color: primary, width: 1, alpha: 0.4 });
                
                // Add some leaf nodes on the vines
                const lx = Math.cos(startAngle + 1.5) * stemR * 1.05;
                const ly = Math.sin(startAngle + 1.5) * stemR * 1.05;
                geo.circle(lx, ly, 4).fill({ color: primary, alpha: 0.6 });
            }
        } else {
            // Variant 13: Sacred Geometry (Seed of Life)
            const soflR = radius * 0.25; // radius of each circle
            const drawIntersectingCircle = (cx: number, cy: number) => {
                geo.circle(cx, cy, soflR).stroke({ color: primary, width: 2, alpha: 0.6 });
            };
            
            // Center circle
            drawIntersectingCircle(0, 0);
            
            // 6 surrounding circles
            for(let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2;
                const cx = Math.cos(angle) * soflR;
                const cy = Math.sin(angle) * soflR;
                drawIntersectingCircle(cx, cy);
            }
            
            // 12 outer circles for next layer
            for(let i = 0; i < 12; i++) {
                const angle = (i / 12) * Math.PI * 2;
                // The distance for the next layer is soflR * sqrt(3)
                const dist = i % 2 === 0 ? soflR * 2 : soflR * Math.sqrt(3);
                const cx = Math.cos(angle) * dist;
                const cy = Math.sin(angle) * dist;
                geo.circle(cx, cy, soflR).stroke({ color: primary, width: 1, alpha: 0.3 });
            }
            
            // Bounding circles
            geo.circle(0, 0, soflR * 3).stroke({ color: primary, width: 2, alpha: 0.5 });
            geo.circle(0, 0, soflR * 3.1).stroke({ color: primary, width: 1, alpha: 0.3 });
            
            // Radial connection lines
            for(let i = 0; i < 12; i++) {
                const angle = (i / 12) * Math.PI * 2;
                geo.moveTo(Math.cos(angle) * soflR * 0.5, Math.sin(angle) * soflR * 0.5)
                   .lineTo(Math.cos(angle) * soflR * 3, Math.sin(angle) * soflR * 3)
                   .stroke({ color: primary, width: 1, alpha: 0.2 });
            }
        }

        // Intersecting Rectangles with Hatching (Shared across all variants to maintain PV consistency)
        geo.rect(-radius * 0.4, -radius * 0.2, radius * 0.6, radius * 0.15).fill({ color: primary, alpha: 0.7 });
        geo.rect(-radius * 0.1, radius * 0.1, radius * 0.5, radius * 0.3).stroke({ color: primary, width: 2, alpha: 0.6 });
        
        // Selectively apply deterministic rotation based on variant compatibility
        if (![6, 8, 9].includes(geoVariant)) {
            // Arbitrary rotation
            geo.rotation = ((seed * 13) % 360) * (Math.PI / 180);
        } else if (geoVariant === 8) {
            // HUD frames rotate in 90-degree increments
            geo.rotation = (seed % 4) * (Math.PI / 2);
        }
        
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
    const hasIcons = theme.lyricsIcons && theme.lyricsIcons.length > 0;
    
    for (let i = 0; i < particleCount; i++) {
        const pSize = 4 + (seed + i) % 12;
        const type = hasIcons ? (seed + i) % 4 : (seed + i) % 3; // 0: square, 1: diamond, 2: star, 3: icon
        let p: import('pixi.js').Container;
        
        if (type === 3 && hasIcons) {
            const iconName = theme.lyricsIcons![(seed + i) % theme.lyricsIcons!.length];
            const tex = iconTextures.get(iconName);
            if (tex) {
                const s = new Sprite(tex);
                s.anchor.set(0.5);
                s.width = pSize * 3;
                s.height = pSize * 3;
                s.tint = (i % 2 === 0 ? primary : secondary);
                s.alpha = 0.4;
                p = s;
            } else {
                const g = new Graphics();
                g.rect(-pSize/2, -pSize/2, pSize, pSize).fill({ color: primary, alpha: 0.6 });
                p = g;
            }
        } else {
            const g = new Graphics();
            if (type === 0 || (type === 3 && !hasIcons)) {
                g.rect(-pSize/2, -pSize/2, pSize, pSize).fill({ color: (i % 2 === 0 ? primary : secondary), alpha: 0.6 });
            } else if (type === 1) {
                g.moveTo(0, -pSize).lineTo(pSize, 0).lineTo(0, pSize).lineTo(-pSize, 0).fill({ color: primary, alpha: 0.5 });
            } else {
                // 4-point star (sparkle)
                g.moveTo(0, -pSize * 1.5).quadraticCurveTo(0, 0, pSize * 1.5, 0)
                 .quadraticCurveTo(0, 0, 0, pSize * 1.5)
                 .quadraticCurveTo(0, 0, -pSize * 1.5, 0)
                 .quadraticCurveTo(0, 0, 0, -pSize * 1.5)
                 .fill({ color: primary, alpha: 0.8 });
            }
            p = g;
        }
        
        p.position.set(
            -hw + width * (((seed * 31 + i * 47) % 100) / 100),
            -hh + height * (((seed * 73 + i * 19) % 100) / 100)
        );
        p.rotation = (seed + i * 13) % 360 * Math.PI / 180;
        particleLayer.addChild(p);
    }
    
    container.addChild(particleLayer);
    (container as any).particleLayer = particleLayer;

    return container;
};
