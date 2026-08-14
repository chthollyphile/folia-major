import type { WritingPoint } from './types';

// src/components/visualizer/elegy/elegyPathMerging.ts
// Merges generic skeleton fragments by endpoint continuity without language or font heuristics.
type EndpointSide = 'start' | 'end';

interface Endpoint {
    pathIndex: number;
    side: EndpointSide;
    point: WritingPoint;
    tangent: WritingPoint;
}

interface Candidate {
    left: Endpoint;
    right: Endpoint;
    score: number;
}

interface Connection {
    ownSide: EndpointSide;
    otherIndex: number;
    otherSide: EndpointSide;
}

const MAX_GAP = 0.025;
const MIN_CONTINUITY = 0.82;
const MIN_MASK_COVERAGE = 0.8;
const TANGENT_SAMPLE_DISTANCE = 0.03;

const distance = (left: WritingPoint, right: WritingPoint) =>
    Math.hypot(right.x - left.x, right.y - left.y);

const normalize = (point: WritingPoint): WritingPoint => {
    const length = Math.hypot(point.x, point.y);
    return length > 0 ? { x: point.x / length, y: point.y / length } : { x: 0, y: 0 };
};

// Samples along the curve so raster-scale endpoint noise does not dominate the tangent.
const estimateOutwardTangent = (points: WritingPoint[], side: EndpointSide) => {
    const originIndex = side === 'start' ? 0 : points.length - 1;
    const step = side === 'start' ? 1 : -1;
    const origin = points[originIndex];
    let sample = points[originIndex + step] ?? origin;
    let travelled = 0;
    for (let index = originIndex + step; index >= 0 && index < points.length; index += step) {
        const previous = points[index - step];
        travelled += distance(previous, points[index]);
        sample = points[index];
        if (travelled >= TANGENT_SAMPLE_DISTANCE) break;
    }
    return normalize({ x: origin.x - sample.x, y: origin.y - sample.y });
};

const endpointKey = ({ pathIndex, side }: Endpoint) => `${pathIndex}:${side}`;

const resolveMaskCoverage = (
    left: WritingPoint,
    right: WritingPoint,
    mask: ArrayLike<number> | undefined,
    rasterWidth: number,
    rasterHeight: number,
) => {
    if (!mask) return 1;
    const glyphSize = Math.max(rasterWidth, rasterHeight, 1);
    const samples = Math.max(5, Math.ceil(distance(left, right) * glyphSize * 2));
    let covered = 0;
    for (let index = 0; index < samples; index += 1) {
        const amount = samples === 1 ? 0 : index / (samples - 1);
        const x = Math.round((left.x + (right.x - left.x) * amount) * glyphSize);
        const y = Math.round((left.y + (right.y - left.y) * amount) * glyphSize);
        if (x >= 0 && x < rasterWidth && y >= 0 && y < rasterHeight && mask[y * rasterWidth + x]) {
            covered += 1;
        }
    }
    return covered / samples;
};

const buildCandidates = (
    paths: WritingPoint[][],
    mask: ArrayLike<number> | undefined,
    rasterWidth: number,
    rasterHeight: number,
) => {
    const endpoints = paths.flatMap((points, pathIndex): Endpoint[] => [
        { pathIndex, side: 'start', point: points[0], tangent: estimateOutwardTangent(points, 'start') },
        { pathIndex, side: 'end', point: points.at(-1)!, tangent: estimateOutwardTangent(points, 'end') },
    ]);
    const candidates: Candidate[] = [];
    for (let leftIndex = 0; leftIndex < endpoints.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < endpoints.length; rightIndex += 1) {
            const left = endpoints[leftIndex];
            const right = endpoints[rightIndex];
            if (left.pathIndex === right.pathIndex) continue;
            const gap = distance(left.point, right.point);
            if (gap > MAX_GAP) continue;
            const continuity = -(left.tangent.x * right.tangent.x + left.tangent.y * right.tangent.y);
            if (continuity < MIN_CONTINUITY) continue;
            const coverage = resolveMaskCoverage(left.point, right.point, mask, rasterWidth, rasterHeight);
            if (coverage < MIN_MASK_COVERAGE) continue;
            candidates.push({
                left,
                right,
                score: continuity * 0.7 + (1 - gap / MAX_GAP) * 0.2 + coverage * 0.1,
            });
        }
    }
    return candidates.sort((left, right) => right.score - left.score);
};

const reverseSide = (side: EndpointSide): EndpointSide => side === 'start' ? 'end' : 'start';

// Selects globally compatible endpoint pairs, then reconstructs each acyclic path chain once.
export const mergeContinuousPaths = (
    paths: WritingPoint[][],
    rasterWidth: number,
    rasterHeight: number,
    mask?: ArrayLike<number>,
) => {
    const parent = paths.map((_, index) => index);
    const find = (index: number): number => parent[index] === index
        ? index
        : (parent[index] = find(parent[index]));
    const connections: Connection[][] = paths.map(() => []);
    const occupied = new Set<string>();

    for (const candidate of buildCandidates(paths, mask, rasterWidth, rasterHeight)) {
        const leftKey = endpointKey(candidate.left);
        const rightKey = endpointKey(candidate.right);
        const leftRoot = find(candidate.left.pathIndex);
        const rightRoot = find(candidate.right.pathIndex);
        if (occupied.has(leftKey) || occupied.has(rightKey) || leftRoot === rightRoot) continue;
        occupied.add(leftKey);
        occupied.add(rightKey);
        parent[rightRoot] = leftRoot;
        connections[candidate.left.pathIndex].push({
            ownSide: candidate.left.side,
            otherIndex: candidate.right.pathIndex,
            otherSide: candidate.right.side,
        });
        connections[candidate.right.pathIndex].push({
            ownSide: candidate.right.side,
            otherIndex: candidate.left.pathIndex,
            otherSide: candidate.left.side,
        });
    }

    const visited = new Set<number>();
    const merged: WritingPoint[][] = [];
    paths.forEach((_, pathIndex) => {
        if (visited.has(pathIndex)) return;
        const componentRoot = find(pathIndex);
        const component = paths.map((__, index) => index).filter(index => find(index) === componentRoot);
        let current = component.find(index => connections[index].length < 2) ?? component[0];
        let previous = -1;
        let points = connections[current][0]?.ownSide === 'start'
            ? [...paths[current]].reverse()
            : [...paths[current]];

        while (current >= 0) {
            visited.add(current);
            const connection = connections[current].find(item => item.otherIndex !== previous);
            if (!connection) break;
            const next = connection.otherIndex;
            const nextPoints = connection.otherSide === 'start'
                ? paths[next]
                : [...paths[next]].reverse();
            points.push(...(distance(points.at(-1)!, nextPoints[0]) < 1e-6 ? nextPoints.slice(1) : nextPoints));
            previous = current;
            current = next;
        }
        merged.push(points);
    });
    return merged;
};
