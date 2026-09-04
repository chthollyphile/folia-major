import { describe, expect, it } from 'vitest';
import {
    getLatticeGeometry,
    layoutExpandedBlock,
    layoutLattice,
    locateInstanceAt,
    type QueueInstance,
} from '../../../src/components/app/lattice/layout';
import {
    findAdjacentInstance,
    findNearestInstance,
    type WallDirection,
} from '../../../src/components/app/lattice/wallNavigation';

// The lattice has no edge, so directional focus must always find somewhere to go.

const metrics = { cellSize: 128, gap: 8 };
const TOTAL = 30;
const geometry = getLatticeGeometry(TOTAL, metrics);
const DIRECTIONS: WallDirection[] = ['up', 'down', 'left', 'right'];

const seat = (column: number, row: number, slotIndex: number) =>
    locateInstanceAt(geometry, TOTAL, column, row, slotIndex, metrics)!;
const step = (from: QueueInstance, direction: WallDirection) =>
    findAdjacentInstance(from, direction, geometry, TOTAL, metrics);
const center = (instance: QueueInstance) => ({
    x: instance.x + instance.width / 2,
    y: instance.y + instance.height / 2,
});

const sample: QueueInstance[] = [];
for (let column = -1; column <= 2; column += 1) {
    for (let row = -1; row <= 2; row += 1) {
        for (let slotIndex = 0; slotIndex < 11; slotIndex += 1) {
            sample.push(seat(column, row, slotIndex));
        }
    }
}

describe('findAdjacentInstance', () => {
    it('always offers a step, in every direction, from every poster', () => {
        for (const from of sample) {
            for (const direction of DIRECTIONS) {
                expect(step(from, direction)).not.toBeNull();
            }
        }
    });

    it('moves along the pressed direction', () => {
        const ahead = {
            right: (a: QueueInstance, b: QueueInstance) => center(b).x > center(a).x,
            left: (a: QueueInstance, b: QueueInstance) => center(b).x < center(a).x,
            down: (a: QueueInstance, b: QueueInstance) => center(b).y > center(a).y,
            up: (a: QueueInstance, b: QueueInstance) => center(b).y < center(a).y,
        } as const;

        for (const from of sample) {
            for (const direction of DIRECTIONS) {
                const next = step(from, direction)!;
                expect(next.instanceId).not.toBe(from.instanceId);
                expect(ahead[direction](from, next)).toBe(true);
            }
        }
    });

    it('walks right across cell seams without stalling or looping', () => {
        const seen = new Set<string>();
        let cursor = seat(0, 0, 0);
        seen.add(cursor.instanceId);

        for (let hop = 0; hop < 60; hop += 1) {
            const next = step(cursor, 'right')!;
            expect(seen.has(next.instanceId)).toBe(false);
            seen.add(next.instanceId);
            cursor = next;
        }

        // Sixty steps right must have left the starting cell far behind.
        expect(cursor.repeatX).toBeGreaterThan(0);
    });

    it('returns to where it started when a step is undone', () => {
        const opposite = { right: 'left', left: 'right', up: 'down', down: 'up' } as const;
        let returned = 0;

        for (const from of sample.slice(0, 44)) {
            for (const direction of DIRECTIONS) {
                const next = step(from, direction)!;
                if (step(next, opposite[direction])?.instanceId === from.instanceId) returned += 1;
            }
        }

        // Not a strict inverse - a wide poster can be entered from several neighbours - but the
        // common case has to hold, or arrows feel like they drift.
        expect(returned / (44 * DIRECTIONS.length)).toBeGreaterThan(0.6);
    });

    it('prefers a neighbour sharing a band with the poster being left', () => {
        let shared = 0;

        for (const from of sample) {
            for (const direction of DIRECTIONS) {
                const next = step(from, direction)!;
                const horizontal = direction === 'left' || direction === 'right';
                const overlap = horizontal
                    ? from.y < next.y + next.height && next.y < from.y + from.height
                    : from.x < next.x + next.width && next.x < from.x + from.width;
                if (overlap) shared += 1;
            }
        }

        expect(shared / (sample.length * DIRECTIONS.length)).toBeGreaterThan(0.9);
    });

    it('refuses to navigate an empty queue', () => {
        expect(findAdjacentInstance(seat(0, 0, 0), 'right', geometry, 0, metrics)).toBeNull();
    });
});

describe('navigating a block whose cards are re-geared', () => {
    const active = locateInstanceAt(geometry, TOTAL, 0, 0, 3, metrics)!;
    const rendered = layoutExpandedBlock(geometry, TOTAL, active, metrics);
    const drawn = (i: QueueInstance) => ({ ...i, ...(rendered.get(i.instanceId) ?? {}) });

    it('steps by where posters are drawn, not by their base slots', () => {
        for (let slotIndex = 0; slotIndex < 12; slotIndex += 1) {
            const from = seat(0, 0, slotIndex);
            const next = findAdjacentInstance(from, 'right', geometry, TOTAL, metrics, rendered);
            if (!next) continue;

            const source = drawn(from);
            const target = drawn(next);
            expect(target.x + target.width / 2).toBeGreaterThan(source.x + source.width / 2);
        }
    });

    it('returns the canonical instance, leaving the drawn rect to the caller', () => {
        const next = findAdjacentInstance(seat(0, 0, 0), 'right', geometry, TOTAL, metrics, rendered)!;
        const canonical = locateInstanceAt(
            geometry,
            TOTAL,
            0,
            0,
            next.cellSlot % 12,
            metrics,
        )!;

        expect(next).toEqual(canonical);
        // It is inside the re-geared block, so the drawn rect really does differ from the base one.
        expect(rendered.has(next.instanceId)).toBe(true);
        expect(drawn(next)).not.toEqual(canonical);
    });

    it('ignores overrides for blocks that are not re-geared', () => {
        const outside = seat(2, 2, 0);
        const withMap = findAdjacentInstance(outside, 'down', geometry, TOTAL, metrics, rendered);
        const without = findAdjacentInstance(outside, 'down', geometry, TOTAL, metrics);

        expect(withMap).toEqual(without);
    });
});

describe('findNearestInstance', () => {
    it('seeds focus from the poster under the viewport centre', () => {
        const instances = layoutLattice(geometry, TOTAL, {
            left: 0, right: 3000, top: 0, bottom: 2200,
        }, 0, metrics);
        const target = instances[7];

        expect(findNearestInstance(instances, center(target))?.instanceId).toBe(target.instanceId);
    });

    it('returns null when nothing is on screen', () => {
        expect(findNearestInstance([], { x: 0, y: 0 })).toBeNull();
    });
});
