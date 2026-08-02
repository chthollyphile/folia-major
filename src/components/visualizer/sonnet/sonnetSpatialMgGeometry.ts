// src/components/visualizer/sonnet/sonnetSpatialMgGeometry.ts
// Owns deterministic variant selection and reusable spatial recipes for Sonnet MG scenes.
export const SONNET_GEO_VARIANT_COUNT = 24;

interface SonnetMgPathTarget {
    moveTo: (x: number, y: number) => SonnetMgPathTarget;
    lineTo: (x: number, y: number) => SonnetMgPathTarget;
    fill: (options: { color: number; alpha: number }) => SonnetMgPathTarget;
}

type Point = readonly [number, number];

export const resolveSonnetGeoVariant = (seed: number) => (
    ((Math.trunc(seed) % SONNET_GEO_VARIANT_COUNT) + SONNET_GEO_VARIANT_COUNT)
    % SONNET_GEO_VARIANT_COUNT
);

const tracePolygon = (target: SonnetMgPathTarget, points: Point[]) => {
    target.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index += 1) {
        target.lineTo(points[index][0], points[index][1]);
    }
    return target.lineTo(points[0][0], points[0][1]);
};

const drawFace = (
    target: SonnetMgPathTarget,
    points: Point[],
    color: number,
    fillAlpha: number,
) => {
    tracePolygon(target, points).fill({ color, alpha: fillAlpha });
};

export const drawSonnetSolidCuboid = (
    target: SonnetMgPathTarget,
    x: number,
    y: number,
    width: number,
    height: number,
    depthX: number,
    depthY: number,
    color: number,
    alpha: number,
) => {
    const left = x - width / 2;
    const right = x + width / 2;
    const top = y - height / 2;
    const bottom = y + height / 2;
    const front: Point[] = [[left, top], [right, top], [right, bottom], [left, bottom]];
    const topFace: Point[] = [[left, top], [left + depthX, top + depthY], [right + depthX, top + depthY], [right, top]];
    const sideFace: Point[] = [[right, top], [right + depthX, top + depthY], [right + depthX, bottom + depthY], [right, bottom]];
    drawFace(target, topFace, color, alpha * 0.42);
    drawFace(target, sideFace, color, alpha * 0.68);
    drawFace(target, front, color, alpha * 0.24);
};

const drawSonnetExtrudedPolygon = (
    target: SonnetMgPathTarget,
    front: Point[],
    depthX: number,
    depthY: number,
    color: number,
    alpha: number,
) => {
    const back = front.map(([x, y]) => [x + depthX, y + depthY] as Point);
    for (let index = 0; index < front.length; index += 1) {
        const next = (index + 1) % front.length;
        drawFace(
            target,
            [front[index], back[index], back[next], front[next]],
            color,
            alpha * (0.34 + (index % 3) * 0.12),
        );
    }
    drawFace(target, front, color, alpha * 0.22);
};

export const drawSonnetTriangularPrism = (
    target: SonnetMgPathTarget,
    x: number,
    y: number,
    width: number,
    height: number,
    depthX: number,
    depthY: number,
    color: number,
    alpha: number,
) => drawSonnetExtrudedPolygon(target, [
    [x, y - height / 2],
    [x + width / 2, y + height / 2],
    [x - width / 2, y + height / 2],
], depthX, depthY, color, alpha);

export const drawSonnetHexagonalPrism = (
    target: SonnetMgPathTarget,
    x: number,
    y: number,
    width: number,
    height: number,
    depthX: number,
    depthY: number,
    color: number,
    alpha: number,
) => drawSonnetExtrudedPolygon(target, [
    [x - width * 0.25, y - height / 2],
    [x + width * 0.25, y - height / 2],
    [x + width / 2, y],
    [x + width * 0.25, y + height / 2],
    [x - width * 0.25, y + height / 2],
    [x - width / 2, y],
], depthX, depthY, color, alpha);

export const drawSonnetTrapezoidPrism = (
    target: SonnetMgPathTarget,
    x: number,
    y: number,
    topWidth: number,
    bottomWidth: number,
    height: number,
    depthX: number,
    depthY: number,
    color: number,
    alpha: number,
) => drawSonnetExtrudedPolygon(target, [
    [x - topWidth / 2, y - height / 2],
    [x + topWidth / 2, y - height / 2],
    [x + bottomWidth / 2, y + height / 2],
    [x - bottomWidth / 2, y + height / 2],
], depthX, depthY, color, alpha);
