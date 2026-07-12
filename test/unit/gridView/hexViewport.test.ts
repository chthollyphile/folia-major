import { describe, expect, it } from 'vitest';
import {
    forEachCubeInRadius,
    getHexCubicAtIndex,
    getHexCubicSpiral,
    pixelToCubeCenter,
    resizeHexGridCoords,
    resolveVisibleHexIndexes,
    roundCube,
    toCubeKey,
    type HexGridCoord,
} from '../../../src/components/folia-grid/hexViewport';

// Unit coverage for GridView hex viewport math.
const buildCoords = (radius: number, spacingX = 250, spacingY = 320): HexGridCoord[] => {
    const coords: HexGridCoord[] = [];
    forEachCubeInRadius({ x: 0, y: 0, z: 0 }, radius, (cube) => {
        coords.push({
            index: coords.length,
            cube,
            baseX: cube.x * spacingX + (cube.z * spacingX) / 2,
            baseY: cube.z * spacingY,
        });
    });
    return coords;
};

describe('hexViewport', () => {
    it('resolves direct spiral indexes identically to the legacy sequential generator', () => {
        const spiral = getHexCubicSpiral(300);
        expect(spiral.map((_, index) => getHexCubicAtIndex(index))).toEqual(spiral);
    });

    it('rounds fractional cube coordinates while preserving x + y + z = 0', () => {
        expect(roundCube({ x: 1.2, y: -2.1, z: 0.9 })).toEqual({ x: 1, y: -2, z: 1 });
        expect(roundCube({ x: -1.49, y: 0.52, z: 0.97 })).toEqual({ x: -2, y: 1, z: 1 });
    });

    it('round-trips pixel centers back to cube coordinates', () => {
        const spacingX = 285;
        const spacingY = 365;
        const cubes = [
            { x: 0, y: 0, z: 0 },
            { x: 2, y: -3, z: 1 },
            { x: -4, y: 2, z: 2 },
        ];

        for (const cube of cubes) {
            const baseX = cube.x * spacingX + (cube.z * spacingX) / 2;
            const baseY = cube.z * spacingY;
            expect(pixelToCubeCenter(baseX, baseY, spacingX, spacingY)).toEqual(cube);
        }
    });

    it('enumerates the expected number of hexes in a radius', () => {
        for (const radius of [0, 1, 2, 4]) {
            let count = 0;
            forEachCubeInRadius({ x: 0, y: 0, z: 0 }, radius, () => {
                count++;
            });
            expect(count).toBe(1 + 3 * radius * (radius + 1));
        }
    });

    it('resolves only existing indexes within the pixel radius', () => {
        const coords = buildCoords(3);
        const coordByKey = new Map(coords.map((coord) => [toCubeKey(coord.cube), coord.index]));
        const indexes = resolveVisibleHexIndexes(
            { x: 0, y: 0, z: 0 },
            3,
            coordByKey,
            coords,
            0,
            0,
            330
        );
        const centerIndex = coordByKey.get(toCubeKey({ x: 0, y: 0, z: 0 }));

        expect(indexes.length).toBeGreaterThan(1);
        expect(indexes).toContain(centerIndex);
        for (const index of indexes) {
            const coord = coords[index]!;
            expect(coord.baseX * coord.baseX + coord.baseY * coord.baseY).toBeLessThanOrEqual(330 * 330);
        }
    });

    it('extends a stable coordinate prefix and rebuilds it when spacing changes', () => {
        const first = resizeHexGridCoords([], 25, 250, 320);
        const extended = resizeHexGridCoords(first, 80, 250, 320);
        expect(extended.slice(0, first.length)).toEqual(first);
        expect(new Set(extended.map(coord => toCubeKey(coord.cube))).size).toBe(extended.length);

        const trimmed = resizeHexGridCoords(extended, 12, 250, 320);
        expect(trimmed).toEqual(first.slice(0, 12));

        const resized = resizeHexGridCoords(extended, 80, 285, 365);
        expect(resized[1]?.baseX).not.toBe(extended[1]?.baseX);
        expect(resized[1]?.baseY).not.toBe(extended[1]?.baseY);
    });
});
