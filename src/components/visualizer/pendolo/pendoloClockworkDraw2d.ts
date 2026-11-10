import { colorWithAlpha } from '../colorMix';
import {
    buildPendoloClockworkPalette,
    resolvePendoloClockworkAnchors,
    type PendoloClockworkFrameInput,
} from './pendoloClockworkScene';

// src/components/visualizer/pendolo/pendoloClockworkDraw2d.ts
// Canvas2D fallback path for Pendolo wireframe clockwork.

/** Draws wireframe gear with N trapezoidal gear teeth. */
function drawGearTeeth(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    teethCount: number,
    toothDepth: number,
    rotationRad: number,
    strokeColor: string,
    lineWidth: number,
    fillColor?: string,
) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotationRad);

    const innerR = radius - toothDepth;
    const outerR = radius;
    const anglePerTooth = (Math.PI * 2) / teethCount;

    ctx.beginPath();
    for (let i = 0; i < teethCount; i++) {
        const baseAngle = i * anglePerTooth;
        const a0 = baseAngle - anglePerTooth * 0.22;
        const a1 = baseAngle - anglePerTooth * 0.12;
        const a2 = baseAngle + anglePerTooth * 0.12;
        const a3 = baseAngle + anglePerTooth * 0.22;

        const x0 = innerR * Math.cos(a0);
        const y0 = innerR * Math.sin(a0);
        const x1 = outerR * Math.cos(a1);
        const y1 = outerR * Math.sin(a1);
        const x2 = outerR * Math.cos(a2);
        const y2 = outerR * Math.sin(a2);
        const x3 = innerR * Math.cos(a3);
        const y3 = innerR * Math.sin(a3);

        if (i === 0) ctx.moveTo(x0, y0);
        else ctx.lineTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x3, y3);
    }
    ctx.closePath();

    if (fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fill();
    }
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
}

/** Draws a spoked wheel with circular weight reduction windows. */
function drawSpokedWheel(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    hubR: number,
    rimR: number,
    spokeCount: number,
    rotationRad: number,
    strokeColor: string,
    lineWidth: number,
) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotationRad);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;

    // Hub & Rim circles
    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, rimR, 0, Math.PI * 2);
    ctx.stroke();

    // Radial Spokes
    const angleStep = (Math.PI * 2) / spokeCount;
    for (let i = 0; i < spokeCount; i++) {
        const a = i * angleStep;
        ctx.beginPath();
        ctx.moveTo(hubR * Math.cos(a), hubR * Math.sin(a));
        ctx.lineTo(rimR * Math.cos(a), rimR * Math.sin(a));
        ctx.stroke();
    }

    // Weight reduction cutout holes along mid-radius
    const midR = (hubR + rimR) * 0.5;
    const holeR = (rimR - hubR) * 0.22;
    for (let i = 0; i < spokeCount; i++) {
        const a = i * angleStep + angleStep * 0.5;
        ctx.beginPath();
        ctx.arc(midR * Math.cos(a), midR * Math.sin(a), holeR, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();
}

/** Draws wireframe spiral hairspring (游丝). */
function drawHairspring(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    startR: number,
    endR: number,
    coils: number,
    oscillationRad: number,
    strokeColor: string,
    lineWidth: number,
) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(oscillationRad);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;

    const totalAngle = coils * Math.PI * 2;
    const steps = coils * 60;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const angle = t * totalAngle;
        const r = startR + (endR - startR) * Math.pow(t, 0.9);
        const x = r * Math.cos(angle);
        const y = r * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
}

function drawJewel(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    outerR: number,
    innerR: number,
    strokeOuter: string,
    strokeInner: string,
    outerWidth: number,
    innerWidth: number,
) {
    ctx.strokeStyle = strokeOuter;
    ctx.lineWidth = outerWidth;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = strokeInner;
    ctx.lineWidth = innerWidth;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.stroke();
}

/** Renders one clockwork frame with Canvas2D (fallback when WebGL2 is unavailable). */
export const drawPendoloClockwork2d = (
    ctx: CanvasRenderingContext2D,
    input: PendoloClockworkFrameInput,
) => {
    const {
        centerX,
        centerY,
        baseRadius,
        escapementAngle,
        phase,
        bassOscillation,
        secondGearAngle,
        transBeatAngle = 0,
        primaryTextColor,
        accentTextColor,
        backgroundColor,
        showGearDecor,
        showCenterGradient,
        showCover,
        coverImage,
    } = input;

    const anchors = resolvePendoloClockworkAnchors(input);

    // 0. Optional Central Dark Radial Gradient using theme background color
    if (showCenterGradient) {
        const bgCol = backgroundColor || '#000000';
        const grad = ctx.createRadialGradient(
            centerX, centerY, 0, centerX, centerY, anchors.gradientR,
        );
        grad.addColorStop(0, colorWithAlpha(bgCol, 0.72));
        grad.addColorStop(0.35, colorWithAlpha(bgCol, 0.52));
        grad.addColorStop(0.7, colorWithAlpha(bgCol, 0.20));
        grad.addColorStop(1, colorWithAlpha(bgCol, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(centerX, centerY, anchors.gradientR, 0, Math.PI * 2);
        ctx.fill();
    }

    // 0.5 Cover Image on Watch Face
    if (showCover && coverImage) {
        const coverRadius = anchors.coverRadius; // Keep it within the inner watch face rim
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, centerY, coverRadius, 0, Math.PI * 2);
        ctx.clip();
        const isFullDecor = showGearDecor === 'full';
        ctx.globalAlpha = 0.42 * (isFullDecor ? 1.0 : 0.6); // Base opacity
        // Draw square image covering the circle
        const size = coverRadius * 2;
        ctx.drawImage(coverImage, centerX - coverRadius, centerY - coverRadius, size, size);
        ctx.restore();
    }

    if (showGearDecor === 'none') return;

    const palette = buildPendoloClockworkPalette(primaryTextColor, accentTextColor, showGearDecor);
    const m = palette.decorOpacityMultiplier;

    // 1. Technical Radial Ticks & Concentric Guide Rings
    ctx.strokeStyle = palette.primaryAlpha15;
    ctx.lineWidth = 1;
    const ringRadii = [
        baseRadius * 0.3, baseRadius * 0.6, baseRadius * 0.85, baseRadius * 1.15, baseRadius * 1.4,
    ];
    ringRadii.forEach((r) => {
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.stroke();
    });

    // Outer Technical Radial Ticks around main wheel (every 6 deg)
    const tickCount = 60;
    const outerTickR = baseRadius * 1.15;
    for (let i = 0; i < tickCount; i++) {
        const angle = (i * Math.PI * 2) / tickCount + escapementAngle * 0.2;
        const isMajor = i % 5 === 0;
        const tickLen = isMajor ? 12 : 6;
        ctx.strokeStyle = isMajor ? palette.accentAlpha35 : palette.primaryAlpha15;
        ctx.lineWidth = isMajor ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(centerX + outerTickR * Math.cos(angle), centerY + outerTickR * Math.sin(angle));
        ctx.lineTo(
            centerX + (outerTickR + tickLen) * Math.cos(angle),
            centerY + (outerTickR + tickLen) * Math.sin(angle),
        );
        ctx.stroke();
    }

    // 2. Main Escapement Gear Wheel (Outer Rim)
    drawGearTeeth(
        ctx, centerX, centerY, baseRadius + 8, 36, 10, escapementAngle,
        palette.gearAccentAlpha, 2.2, palette.mainGearFill,
    );
    // Inner Escapement Spoked Ring
    drawSpokedWheel(
        ctx, centerX, centerY, baseRadius * 0.2, baseRadius * 0.85, 6, escapementAngle,
        palette.gearPrimaryAlpha, 1.8,
    );

    // Beveled double-ring on main gear rim for depth
    ctx.strokeStyle = palette.bevelRing;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(centerX, centerY, baseRadius * 0.88, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX, centerY, baseRadius * 0.92, 0, Math.PI * 2);
    ctx.stroke();

    // Guilloche radial engraving inside main gear
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(escapementAngle);
    const guillocheInnerR = baseRadius * 0.62;
    const guillocheOuterR = baseRadius * 0.83;
    for (let i = 0; i < 48; i++) {
        const a = (i * Math.PI * 2) / 48;
        // Alternating short/long rays for texture
        const innerOffset = i % 2 === 0
            ? guillocheInnerR
            : guillocheInnerR + (guillocheOuterR - guillocheInnerR) * 0.3;
        ctx.strokeStyle = i % 2 === 0 ? palette.primaryAlpha10 : palette.guillocheAlt;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(innerOffset * Math.cos(a), innerOffset * Math.sin(a));
        ctx.lineTo(guillocheOuterR * Math.cos(a), guillocheOuterR * Math.sin(a));
        ctx.stroke();
    }
    ctx.restore();

    // Rivet circles along outer gear rim (wireframe style)
    const rivetR = baseRadius * 0.96;
    for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI * 2) / 12 + escapementAngle;
        ctx.strokeStyle = palette.rivetStroke;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(centerX + rivetR * Math.cos(a), centerY + rivetR * Math.sin(a), 2.2, 0, Math.PI * 2);
        ctx.stroke();
    }

    // 3. Center Hub & Sun Gear Pinion
    drawGearTeeth(
        ctx, centerX, centerY, baseRadius * 0.22, 12, 6, -escapementAngle * 2.5,
        palette.gearAccentStrongAlpha, 2.1,
    );
    // Center jewel bearing (wireframe double-ring)
    drawJewel(ctx, centerX, centerY, 4.5, 2.5, palette.jewelStrokeColor, palette.jewelFillColor, 1.2, 0.8);

    // 4. Orbiting Planetary Gear Set (Full mode only or subtle reduced)
    const orbitAngleBase = escapementAngle * 0.4;
    for (let planetIdx = 0; planetIdx < 3; planetIdx++) {
        const planetAngle = orbitAngleBase + (planetIdx * Math.PI * 2) / 3;
        const px = centerX + anchors.orbitR * Math.cos(planetAngle);
        const py = centerY + anchors.orbitR * Math.sin(planetAngle);
        // Planet gear body
        drawGearTeeth(
            ctx, px, py, anchors.planetR, 14, 5, -escapementAngle * 3 + planetIdx * 0.5,
            palette.planetGearAlpha, 1.7,
        );
        // Planet jewel bearing pivot (wireframe double-ring)
        drawJewel(ctx, px, py, 3.5, 1.8, palette.jewelStrokeColor, palette.jewelFillColor, 1, 0.7);
    }

    // 5. Upper-left decorative gear
    const balanceGearAngle = phase * 0.1;
    drawGearTeeth(
        ctx, anchors.balanceCx, anchors.balanceCy, anchors.balanceR, 20, 7, balanceGearAngle,
        palette.gearAccentStrongAlpha, 2.1, palette.balanceGearFill,
    );
    // The inner ring reserves a quiet circular seat for the non-rotating icon overlay.
    ctx.strokeStyle = palette.gearPrimarySubtleAlpha;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(anchors.balanceCx, anchors.balanceCy, anchors.balanceR * 0.52, 0, Math.PI * 2);
    ctx.stroke();
    // Hairspring spiral at balance wheel
    drawHairspring(
        ctx, anchors.balanceCx, anchors.balanceCy,
        anchors.balanceR * 0.56, anchors.balanceR * 0.88, 3.5,
        bassOscillation * 0.6 + balanceGearAngle * 0.3,
        colorWithAlpha(accentTextColor, 0.30 * m), 0.8,
    );
    // Balance wheel jewel bearing (wireframe double-ring)
    drawJewel(
        ctx, anchors.balanceCx, anchors.balanceCy, 3.5, 1.8,
        palette.jewelStrokeColor, palette.jewelFillColor, 1, 0.7,
    );

    // Meshing Intermediate Transmission Gear (Lower-Left Offset)
    // Turns with the wheel, plus 智能动感模式's beat turn (0 otherwise).
    const transAngle = -escapementAngle * 1.4 + transBeatAngle;
    drawGearTeeth(
        ctx, anchors.transCx, anchors.transCy, anchors.transR, 24, 7, transAngle,
        palette.gearPrimaryAlpha, 1.8,
    );
    drawSpokedWheel(
        ctx, anchors.transCx, anchors.transCy,
        anchors.transR * 0.25, anchors.transR * 0.85, 5, transAngle,
        palette.gearPrimarySubtleAlpha, 1.5,
    );

    // Geneva stripes on transmission gear face (parallel lines clipped to gear circle)
    ctx.save();
    ctx.translate(anchors.transCx, anchors.transCy);
    ctx.rotate(transAngle);
    // Clip to the gear's inner area
    ctx.beginPath();
    ctx.arc(0, 0, anchors.transR * 0.80, 0, Math.PI * 2);
    ctx.clip();
    const genevaSpan = anchors.transR * 1.6;
    const genevaStep = genevaSpan / 10;
    for (let i = 1; i <= 9; i++) {
        const yOff = -genevaSpan * 0.5 + i * genevaStep;
        ctx.strokeStyle = i % 2 === 0 ? palette.primaryAlpha10 : palette.genevaAlt;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(-anchors.transR, yOff);
        ctx.lineTo(anchors.transR, yOff);
        ctx.stroke();
    }
    ctx.restore();
    // Transmission gear jewel bearing (wireframe double-ring)
    drawJewel(
        ctx, anchors.transCx, anchors.transCy, 3.5, 1.8,
        palette.jewelStrokeColor, palette.jewelFillColor, 1, 0.7,
    );

    // Seconds gear: advances one tooth at a time on each active playback second.
    drawGearTeeth(
        ctx, anchors.secondGearCx, anchors.secondGearCy, anchors.secondGearR, 15, 5, secondGearAngle,
        palette.gearAccentAlpha, 1.8, palette.secondGearFill,
    );
    drawSpokedWheel(
        ctx, anchors.secondGearCx, anchors.secondGearCy,
        anchors.secondGearR * 0.28, anchors.secondGearR * 0.76, 4, -secondGearAngle,
        palette.gearPrimarySubtleAlpha, 1.3,
    );
    // Seconds gear jewel bearing (wireframe double-ring)
    drawJewel(
        ctx, anchors.secondGearCx, anchors.secondGearCy, 2.8, 1.5,
        palette.jewelStrokeColor, palette.jewelFillColor, 0.8, 0.6,
    );

    // Tiny idler pinion gear between transmission and seconds gear
    drawGearTeeth(
        ctx, anchors.idlerCx, anchors.idlerCy, anchors.idlerR, 10, 3.5, escapementAngle * 2.2,
        palette.idlerStroke, 1.3,
    );
    // Idler inner ring
    ctx.strokeStyle = palette.idlerInner;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(anchors.idlerCx, anchors.idlerCy, anchors.idlerR * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    // Idler jewel bearing (wireframe double-ring)
    drawJewel(
        ctx, anchors.idlerCx, anchors.idlerCy, 2.2, 1.2,
        palette.jewelStrokeColor, palette.jewelFillColor, 0.7, 0.5,
    );

    // 6. Escapement Focal Axis Alignment Line (Horizontal 0 deg)
    ctx.strokeStyle = palette.gearAccentStrongAlpha;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX + baseRadius * 0.8, centerY);
    ctx.lineTo(centerX + anchors.focalAxisEndRadius, centerY);
    ctx.stroke();

    // Focal Arrowhead Indicator
    const arrowX = centerX + anchors.focalAxisEndRadius;
    ctx.fillStyle = palette.gearAccentStrongAlpha;
    ctx.beginPath();
    ctx.moveTo(arrowX, centerY - 4);
    ctx.lineTo(arrowX + 8, centerY);
    ctx.lineTo(arrowX, centerY + 4);
    ctx.closePath();
    ctx.fill();
};
