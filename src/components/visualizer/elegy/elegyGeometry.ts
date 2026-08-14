import type { WritingGlyph, WritingPoint, WritingStroke } from './types';
import { mergeContinuousPaths } from './elegyPathMerging';

// src/components/visualizer/elegy/elegyGeometry.ts
// Converts raw skeleton fragments into compact, ordered, arc-length-prepared paths.
type RawPoint = readonly [number, number];

const distance = (left: WritingPoint, right: WritingPoint) =>
    Math.hypot(right.x - left.x, right.y - left.y);

const pointToSegmentDistance = (
    point: WritingPoint,
    start: WritingPoint,
    end: WritingPoint,
) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return distance(point, start);

    const amount = Math.max(0, Math.min(1,
        ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy),
    ));
    return Math.hypot(
        point.x - (start.x + dx * amount),
        point.y - (start.y + dy * amount),
    );
};

// RDP keeps curves smooth while removing the dense one-point-per-pixel trace output.
const simplifyPolyline = (points: WritingPoint[], epsilon: number): WritingPoint[] => {
    if (points.length <= 2) return points;

    let farthestIndex = -1;
    let farthestDistance = 0;
    const start = points[0];
    const end = points.at(-1)!;
    for (let index = 1; index < points.length - 1; index += 1) {
        const candidateDistance = pointToSegmentDistance(points[index], start, end);
        if (candidateDistance > farthestDistance) {
            farthestDistance = candidateDistance;
            farthestIndex = index;
        }
    }

    if (farthestIndex < 0 || farthestDistance <= epsilon) return [start, end];
    const left = simplifyPolyline(points.slice(0, farthestIndex + 1), epsilon);
    const right = simplifyPolyline(points.slice(farthestIndex), epsilon);
    return [...left.slice(0, -1), ...right];
};

const prepareStroke = (points: WritingPoint[]): WritingStroke => {
    const cumulativeLengths = new Float32Array(points.length);
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
        length += distance(points[index - 1], points[index]);
        cumulativeLengths[index] = length;
    }
    return { points, length, cumulativeLengths };
};

// Chooses each nearest endpoint from the previous pen position and reverses paths when cheaper.
const orderStrokes = (strokes: WritingStroke[]) => {
    const remaining = [...strokes];
    const ordered: WritingStroke[] = [];
    let current: WritingPoint = { x: 0, y: 0 };

    while (remaining.length > 0) {
        let bestIndex = 0;
        let reverse = false;
        let bestDistance = Number.POSITIVE_INFINITY;
        remaining.forEach((stroke, index) => {
            const startDistance = distance(current, stroke.points[0]);
            const endDistance = distance(current, stroke.points.at(-1)!);
            if (startDistance < bestDistance) {
                bestDistance = startDistance;
                bestIndex = index;
                reverse = false;
            }
            if (endDistance < bestDistance) {
                bestDistance = endDistance;
                bestIndex = index;
                reverse = true;
            }
        });

        const [selected] = remaining.splice(bestIndex, 1);
        const prepared = reverse ? prepareStroke([...selected.points].reverse()) : selected;
        ordered.push(prepared);
        current = prepared.points.at(-1)!;
    }

    return ordered;
};

// Applies only scale-relative geometric cleanup before producing normalized cacheable geometry.
export const prepareWritingGlyph = (
    char: string,
    rasterWidth: number,
    rasterHeight: number,
    polylines: RawPoint[][],
    mask?: ArrayLike<number>,
): WritingGlyph => {
    const glyphSize = Math.max(rasterWidth, rasterHeight, 1);
    const minLength = 0.01;
    const epsilon = 0.002;
    const cleanedPaths = polylines
        .map(polyline => simplifyPolyline(polyline.map(([x, y]) => ({
            x: x / glyphSize,
            y: y / glyphSize,
        })), epsilon))
        .filter(points => points.length >= 2)
        .filter(points => prepareStroke(points).length >= minLength);
    const strokes = mergeContinuousPaths(cleanedPaths, rasterWidth, rasterHeight, mask)
        .map(prepareStroke);
    const ordered = orderStrokes(strokes);

    return {
        char,
        width: rasterWidth / glyphSize,
        height: rasterHeight / glyphSize,
        strokes: ordered,
        totalLength: ordered.reduce((total, stroke) => total + stroke.length, 0),
    };
};
