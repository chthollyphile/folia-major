// src/components/visualizer/sonnet/sonnetAdditionalShotMg.ts
// Extends Sonnet's deterministic MG library with lightweight, theme-colored poster motifs.
export const SONNET_ADDITIONAL_GEO_VARIANT_START = 18;
export const SONNET_ADDITIONAL_GEO_VARIANT_COUNT = 6;

interface SonnetMgTarget {
    moveTo: (x: number, y: number) => SonnetMgTarget;
    lineTo: (x: number, y: number) => SonnetMgTarget;
    quadraticCurveTo: (cx: number, cy: number, tx: number, ty: number) => SonnetMgTarget;
    bezierCurveTo: (
        c1x: number,
        c1y: number,
        c2x: number,
        c2y: number,
        tx: number,
        ty: number,
    ) => SonnetMgTarget;
    arc: (cx: number, cy: number, radius: number, start: number, end: number, anticlockwise?: boolean) => SonnetMgTarget;
    circle: (x: number, y: number, radius: number) => SonnetMgTarget;
    rect: (x: number, y: number, width: number, height: number) => SonnetMgTarget;
    stroke: (options: { color: number; width: number; alpha: number }) => SonnetMgTarget;
    fill: (options: { color: number; alpha: number }) => SonnetMgTarget;
}

interface AdditionalSonnetMgOptions {
    target: SonnetMgTarget;
    variant: number;
    radius: number;
    seed: number;
    primary: number;
    secondary: number;
}

const drawContourAtlas = ({ target, radius, seed, primary, secondary }: AdditionalSonnetMgOptions) => {
    const steps = 48;
    for (let ring = 0; ring < 8; ring += 1) {
        const baseRadius = radius * (0.16 + ring * 0.075);
        for (let step = 0; step <= steps; step += 1) {
            const angle = (step / steps) * Math.PI * 2;
            const ripple = Math.sin(angle * 3 + seed * 0.07 + ring) * radius * 0.018
                + Math.cos(angle * 5 - seed * 0.03 + ring * 0.7) * radius * 0.012;
            const x = Math.cos(angle) * (baseRadius + ripple) + Math.sin(ring * 1.7) * radius * 0.055;
            const y = Math.sin(angle) * (baseRadius + ripple) * 0.72 + Math.cos(ring * 1.3) * radius * 0.035;
            if (step === 0) target.moveTo(x, y);
            else target.lineTo(x, y);
        }
        target.stroke({
            color: ring % 3 === 0 ? secondary : primary,
            width: ring % 3 === 0 ? 2 : 1,
            alpha: 0.2 + ring * 0.045,
        });
    }
    target.moveTo(-radius * 0.78, radius * 0.52)
        .lineTo(-radius * 0.58, radius * 0.52)
        .lineTo(-radius * 0.58, radius * 0.46)
        .lineTo(-radius * 0.38, radius * 0.46)
        .stroke({ color: primary, width: 3, alpha: 0.64 });
};

const drawRadialWave = ({ target, radius, seed, primary, secondary }: AdditionalSonnetMgOptions) => {
    const bars = 64;
    for (let index = 0; index < bars; index += 1) {
        const angle = (index / bars) * Math.PI * 2;
        const signal = 0.5 + 0.5 * Math.sin(index * 1.83 + seed * 0.11);
        const inner = radius * (0.29 + signal * 0.035);
        const outer = radius * (0.43 + signal * 0.21);
        target.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
            .lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
            .stroke({
                color: index % 8 === 0 ? secondary : primary,
                width: index % 8 === 0 ? 3 : 1,
                alpha: index % 2 === 0 ? 0.58 : 0.32,
            });
    }
    target.circle(0, 0, radius * 0.24).stroke({ color: primary, width: 5, alpha: 0.7 });
    target.circle(0, 0, radius * 0.68).stroke({ color: secondary, width: 1, alpha: 0.18 });
    target.circle(0, 0, radius * 0.72).stroke({ color: primary, width: 2, alpha: 0.12 });
};

const drawTransitBlueprint = ({ target, radius, seed, primary, secondary }: AdditionalSonnetMgOptions) => {
    const direction = seed % 2 === 0 ? 1 : -1;
    const routes = [
        [[-0.72, -0.38], [-0.38, -0.38], [-0.38, 0.08], [0.08, 0.08], [0.08, 0.52], [0.68, 0.52]],
        [[-0.62, 0.58], [-0.62, 0.24], [-0.14, 0.24], [-0.14, -0.52], [0.5, -0.52], [0.5, -0.2], [0.74, -0.2]],
        [[-0.78, -0.06], [-0.5, -0.06], [-0.5, -0.62], [0.24, -0.62], [0.24, 0.3], [0.72, 0.3]],
    ] as const;

    routes.forEach((route, routeIndex) => {
        route.forEach(([x, y], pointIndex) => {
            const px = x * radius * direction;
            const py = y * radius;
            if (pointIndex === 0) target.moveTo(px, py);
            else target.lineTo(px, py);
        });
        target.stroke({
            color: routeIndex === 1 ? secondary : primary,
            width: routeIndex === 0 ? 5 : 2,
            alpha: 0.34 + routeIndex * 0.12,
        });
        route.forEach(([x, y], pointIndex) => {
            if (pointIndex === 0 || pointIndex === route.length - 1 || (pointIndex + routeIndex) % 2 === 0) {
                const px = x * radius * direction;
                const py = y * radius;
                target.circle(px, py, pointIndex === 0 ? 10 : 6)
                    .fill({ color: pointIndex % 2 === 0 ? primary : secondary, alpha: 0.72 });
                target.circle(px, py, pointIndex === 0 ? 16 : 11)
                    .stroke({ color: primary, width: 1, alpha: 0.36 });
            }
        });
    });
};

const drawChronograph = ({ target, radius, seed, primary, secondary }: AdditionalSonnetMgOptions) => {
    const rings = [0.2, 0.38, 0.62];
    rings.forEach((scale, index) => {
        target.circle(0, 0, radius * scale).stroke({
            color: index === 1 ? secondary : primary,
            width: index === 2 ? 4 : 2,
            alpha: 0.3 + index * 0.13,
        });
    });
    for (let tick = 0; tick < 48; tick += 1) {
        const angle = (tick / 48) * Math.PI * 2;
        const outer = radius * 0.72;
        const inner = outer - radius * (tick % 4 === 0 ? 0.11 : 0.045);
        target.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
            .lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
            .stroke({ color: tick % 4 === 0 ? secondary : primary, width: tick % 4 === 0 ? 3 : 1, alpha: 0.5 });
    }
    const handAngle = ((seed % 60) / 60) * Math.PI * 2 - Math.PI / 2;
    const secondAngle = (((seed * 7) % 60) / 60) * Math.PI * 2 - Math.PI / 2;
    target.moveTo(-Math.cos(handAngle) * radius * 0.12, -Math.sin(handAngle) * radius * 0.12)
        .lineTo(Math.cos(handAngle) * radius * 0.55, Math.sin(handAngle) * radius * 0.55)
        .stroke({ color: primary, width: 6, alpha: 0.74 });
    target.moveTo(0, 0)
        .lineTo(Math.cos(secondAngle) * radius * 0.65, Math.sin(secondAngle) * radius * 0.65)
        .stroke({ color: secondary, width: 2, alpha: 0.72 });
    target.circle(0, 0, radius * 0.055).fill({ color: primary, alpha: 0.85 });
};

const drawFoldedRibbons = ({ target, radius, seed, primary, secondary }: AdditionalSonnetMgOptions) => {
    const direction = seed % 2 === 0 ? 1 : -1;
    for (let band = 0; band < 5; band += 1) {
        const y = (-0.5 + band * 0.25) * radius;
        const offset = (band % 2 === 0 ? 1 : -1) * direction;
        target.moveTo(-radius * 0.82, y)
            .bezierCurveTo(
                -radius * 0.38, y - radius * 0.28 * offset,
                radius * 0.18, y + radius * 0.28 * offset,
                radius * 0.82, y,
            )
            .stroke({ color: band % 2 === 0 ? primary : secondary, width: band === 2 ? 12 : 5, alpha: 0.24 + band * 0.08 });
        target.moveTo(-radius * 0.82, y + radius * 0.055)
            .bezierCurveTo(
                -radius * 0.38, y - radius * 0.28 * offset + radius * 0.055,
                radius * 0.18, y + radius * 0.28 * offset + radius * 0.055,
                radius * 0.82, y + radius * 0.055,
            )
            .stroke({ color: primary, width: 1, alpha: 0.3 });
    }
    target.rect(-radius * 0.34, -radius * 0.7, radius * 0.68, radius * 1.4)
        .stroke({ color: primary, width: 2, alpha: 0.2 });
};

const drawHalftonePoster = ({ target, radius, seed, primary, secondary }: AdditionalSonnetMgOptions) => {
    const columns = 9;
    const rows = 9;
    const spacing = radius * 0.17;
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const x = (column - (columns - 1) / 2) * spacing;
            const y = (row - (rows - 1) / 2) * spacing;
            const distance = Math.hypot(x, y) / radius;
            const pulse = 0.5 + 0.5 * Math.sin(column * 0.9 + row * 1.4 + seed * 0.08);
            const dotRadius = radius * (0.009 + Math.max(0, 0.72 - distance) * 0.034 + pulse * 0.012);
            target.circle(x, y, dotRadius).fill({
                color: (row + column) % 5 === 0 ? secondary : primary,
                alpha: 0.24 + pulse * 0.5,
            });
        }
    }
    target.rect(-radius * 0.78, -radius * 0.78, radius * 1.56, radius * 1.56)
        .stroke({ color: primary, width: 5, alpha: 0.52 });
    target.moveTo(-radius * 0.78, -radius * 0.58)
        .lineTo(radius * 0.78, -radius * 0.58)
        .stroke({ color: secondary, width: 2, alpha: 0.58 });
};

// Dispatches only the extra range so the original Sonnet shot builder stays focused on composition.
export const drawAdditionalSonnetShotMg = (options: AdditionalSonnetMgOptions) => {
    switch (options.variant) {
        case 18:
            drawContourAtlas(options);
            return true;
        case 19:
            drawRadialWave(options);
            return true;
        case 20:
            drawTransitBlueprint(options);
            return true;
        case 21:
            drawChronograph(options);
            return true;
        case 22:
            drawFoldedRibbons(options);
            return true;
        case 23:
            drawHalftonePoster(options);
            return true;
        default:
            return false;
    }
};
