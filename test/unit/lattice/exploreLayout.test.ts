import { describe, expect, it } from 'vitest';
import type { BlockSlot } from '../../../src/components/wall/blockTemplates';
import {
    buildStrip,
    createExploreLayout,
    lotIndexAt,
} from '../../../src/components/app/lattice/exploreLayout';
import type { QueueInstance } from '../../../src/components/wall/layout';
import type { WallSection } from '../../../src/components/app/lattice/wallLayout';
import type { WallEntryKind } from '../../../src/components/app/lattice/latticeModel';
import { cutGrownLot, cutLot, mirrorsOf } from '../../../src/components/app/lattice/lotSeats';
import { LEFT_SQUARE, LOT_CAPACITY, LOT_COLS, LOT_ROWS, RIGHT_SQUARE, RIGHT_STRIP } from '../../../src/components/app/lattice/lotTables';

// test/unit/lattice/exploreLayout.test.ts
// The explore wall's layout, without the browser: that every lot is covered exactly, as it
// stands and with each of its tiles grown; that a strip holds every entry once; which lot stands
// at which place of the plane; that a section added at the end moves nothing before it; and that
// the copy of a tile the wall goes to is the nearest one.

const metrics = { cellSize: 128, gap: 8 };
const PITCH = 136;
const LOT_PITCH_X = LOT_COLS * PITCH + 64;
const LOT_PITCH_Y = LOT_ROWS * PITCH + 64;
const MIRRORS = Array.from({ length: 16 }, (_, mirrors) => mirrors);
const COUNTS = Array.from({ length: LOT_CAPACITY }, (_, index) => index + 1);

// What is wrong with these slots as a cover of the lot: the slots that reach outside it, and the
// unit cells that are covered more than once or not at all. Nothing, for an exact cover.
const faultsOf = (slots: BlockSlot[]): string[] => {
    const faults: string[] = [];
    const cover = new Int8Array(LOT_COLS * LOT_ROWS);
    for (const slot of slots) {
        if (slot.x < 0 || slot.y < 0 || slot.x + slot.cols > LOT_COLS || slot.y + slot.rows > LOT_ROWS) {
            faults.push(`outside: ${JSON.stringify(slot)}`);
            continue;
        }
        for (let y = slot.y; y < slot.y + slot.rows; y += 1) {
            for (let x = slot.x; x < slot.x + slot.cols; x += 1) cover[y * LOT_COLS + x] += 1;
        }
    }
    cover.forEach((times, cell) => {
        if (times !== 1) faults.push(`${times} times: (${cell % LOT_COLS}, ${Math.floor(cell / LOT_COLS)})`);
    });
    return faults;
};
const cellsOf = (slot: BlockSlot) => slot.cols * slot.rows;

let nextIndex = 0;
// A section of `count` entries of these kinds, taken in turn; its entries follow those of the sections made before it.
const section = (key: string, count: number, kinds: WallEntryKind[] = ['song']): WallSection => ({
    key,
    heading: `Heading ${key}`,
    entries: Array.from({ length: count }, (_, position) => ({ index: nextIndex++, kind: kinds[position % kinds.length] })),
});
const page = (...counts: number[]): WallSection[] => {
    nextIndex = 0;
    return counts.map((count, index) => section(`s${index}`, count));
};
// The bounds of the lot at a place, and what the layout draws there.
const lotBounds = (column: number, row: number) => ({
    left: column * LOT_PITCH_X,
    right: column * LOT_PITCH_X + LOT_COLS * PITCH - metrics.gap,
    top: row * LOT_PITCH_Y,
    bottom: row * LOT_PITCH_Y + LOT_ROWS * PITCH - metrics.gap,
});
const centreOf = (rect: { x: number; y: number; width: number; height: number }) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

describe('a lot', () => {
    it('is covered exactly by its heading and its seats, for every number of entries', () => {
        for (const count of COUNTS) {
            for (const mirrors of MIRRORS) {
                const { heading, seats } = cutLot(count, mirrors);
                expect(seats).toHaveLength(count);
                expect(faultsOf([heading, ...seats])).toEqual([]);
            }
        }
    });

    it('is covered exactly with each of its tiles grown', () => {
        for (const count of COUNTS.filter(entries => entries >= 2)) {
            for (const mirrors of MIRRORS) {
                const { heading } = cutLot(count, mirrors);
                for (let seat = 0; seat < count; seat += 1) {
                    const grown = cutGrownLot(count, mirrors, seat);
                    expect(grown).toHaveLength(count);
                    expect(faultsOf([heading, ...grown])).toEqual([]);
                }
            }
        }
    });

    it('of one entry leaves the strip under its grown tile empty, and nothing else', () => {
        const { heading } = cutLot(1, 0);
        const grown = cutGrownLot(1, 0, 0);

        expect(grown).toEqual([RIGHT_SQUARE]);
        expect(faultsOf([heading, ...grown, RIGHT_STRIP])).toEqual([]);
    });

    it('grows a tile over the whole square its centre is in, and from the right strip over the right square', () => {
        for (const count of COUNTS.filter(entries => entries >= 3)) {
            for (const mirrors of MIRRORS) {
                const { seats } = cutLot(count, mirrors);
                seats.forEach((seat, index) => {
                    const isInLeft = seat.x + seat.cols / 2 < 6;
                    expect(cutGrownLot(count, mirrors, index)[index]).toEqual(isInLeft ? LEFT_SQUARE : RIGHT_SQUARE);
                });
            }
        }
        // One or two entries: the top 6 x 6 of the right half, the other tile under it.
        expect(cutGrownLot(2, 0, 0)).toEqual([RIGHT_SQUARE, RIGHT_STRIP]);
        expect(cutGrownLot(2, 0, 1)).toEqual([RIGHT_STRIP, RIGHT_SQUARE]);
    });

    it('seats the other tiles so that they move least, with one of them grown', () => {
        const travel = (from: BlockSlot, to: BlockSlot) => (
            (from.x + from.cols / 2 - to.x - to.cols / 2) ** 2 + (from.y + from.rows / 2 - to.y - to.rows / 2) ** 2
        );
        // The smallest sum of travel over every way of handing `seats` to `tiles`.
        const leastTravel = (tiles: BlockSlot[], seats: BlockSlot[]): number => (tiles.length === 0 ? 0 : Math.min(
            ...seats.map((seat, index) => travel(tiles[0], seat) + leastTravel(tiles.slice(1), seats.filter((_, other) => other !== index))),
        ));

        for (const count of [3, 4, 5, 6, 7, 8]) {
            for (const mirrors of [0, 6, 9, 15]) {
                const { seats } = cutLot(count, mirrors);
                for (let grownSeat = 0; grownSeat < count; grownSeat += 1) {
                    const grown = cutGrownLot(count, mirrors, grownSeat);
                    const others = seats.map((_, index) => index).filter(index => index !== grownSeat);
                    const moved = others.reduce((sum, index) => sum + travel(seats[index], grown[index]), 0);

                    expect(moved).toBe(leastTravel(others.map(index => seats[index]), others.map(index => grown[index])));
                }
            }
        }
        // The rule is pure: asked again, the same seats.
        expect(cutGrownLot(13, 5, 4)).toEqual(cutGrownLot(13, 5, 4));
    });

    it('has its seats largest first, then top to bottom, then left to right', () => {
        for (const count of COUNTS) {
            for (const mirrors of MIRRORS) {
                const { seats } = cutLot(count, mirrors);
                for (let index = 1; index < seats.length; index += 1) {
                    const [before, seat] = [seats[index - 1], seats[index]];
                    const order = cellsOf(before) - cellsOf(seat) || seat.y - before.y || seat.x - before.x;
                    expect(order).toBeGreaterThan(0);
                }
            }
        }
    });

    it('is mirrored by its section and its number in the section, the same every time', () => {
        expect(mirrorsOf('new-releases', 0)).toBe(mirrorsOf('new-releases', 0));
        const seen = new Set(Array.from({ length: 64 }, (_, index) => mirrorsOf(`section-${index}`, index % 3)));
        expect(seen.size).toBeGreaterThan(8);
        for (const mirrors of seen) expect(mirrors >= 0 && mirrors < 16).toBe(true);
    });
});

describe('the strip', () => {
    it('holds every entry once', () => {
        const sections = page(1, 2, 3, 7, 13, 14, 27, 40);
        const tiles = buildStrip(sections).flatMap(lot => lot.tiles);

        expect([...tiles].sort((a, b) => a - b)).toEqual(Array.from({ length: 107 }, (_, index) => index));
    });

    it('deals a long section evenly and in order over lots that follow each other', () => {
        const lots = buildStrip(page(14, 27, 40, 13));

        expect(lots.map(lot => lot.tiles.length)).toEqual([7, 7, 9, 9, 9, 10, 10, 10, 10, 13]);
        expect(lots.map(lot => lot.section)).toEqual([0, 0, 1, 1, 1, 2, 2, 2, 2, 3]);
        expect(lots.map(lot => `${lot.part + 1}/${lot.parts}`)).toEqual(['1/2', '2/2', '1/3', '2/3', '3/3', '1/4', '2/4', '3/4', '4/4', '1/1']);
        // The first lot has the section's first entries.
        expect([...lots[0].tiles].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect([...lots[1].tiles].sort((a, b) => a - b)).toEqual([7, 8, 9, 10, 11, 12, 13]);
    });

    it('puts the entries of a lot by kind, each kind in the page order, the first on the largest seat', () => {
        nextIndex = 0;
        const [lot] = buildStrip([section('mixed', 6, ['song', 'artist', 'mix', 'album', 'playlist', 'album'])]);

        // Albums (3, 5), playlists and mixes together (2, 4), artists (1), songs (0).
        expect(lot.tiles).toEqual([3, 5, 2, 4, 1, 0]);
        expect(cellsOf(lot.seats[0])).toBe(Math.max(...lot.seats.map(cellsOf)));
    });

    it('leaves out a section without entries', () => {
        nextIndex = 0;
        const sections = [section('a', 3), section('none', 0), section('b', 4)];
        const layout = createExploreLayout(sections, metrics);

        expect(layout.sections.map(entry => entry.key)).toEqual(['a', 'b']);
        expect(layout.sectionAt({ x: 10, y: LOT_PITCH_Y + 10 })).toBe(1);
    });
});

describe('the plane', () => {
    it('holds at the place (column, row) the lot the rule says', () => {
        for (const lotCount of [1, 2, 5, 9]) {
            const sections = page(...Array.from({ length: lotCount }, (_, index) => 3 + index));
            const strip = buildStrip(sections);
            const layout = createExploreLayout(sections, metrics);
            const stride = lotCount >= 7 ? 3 : lotCount >= 4 ? 2 : 1;

            expect(strip).toHaveLength(lotCount);
            for (let column = -4; column <= 4; column += 1) {
                for (let row = -11; row <= 11; row += 1) {
                    const expected = (((row + column * stride) % lotCount) + lotCount) % lotCount;
                    expect(lotIndexAt(column, row, lotCount)).toBe(expected);

                    const { posters, headings } = layout.near(lotBounds(column, row), 0);
                    expect(posters.map(poster => poster.queueIndex)).toEqual(strip[expected].tiles);
                    expect(headings).toHaveLength(1);
                    expect(headings[0].section).toBe(strip[expected].section);
                    expect(layout.sectionAt({ x: column * LOT_PITCH_X + 300, y: row * LOT_PITCH_Y + 300 })).toBe(strip[expected].section);
                }
            }
        }
    });

    it('draws a lot the same wherever it stands', () => {
        const sections = page(5, 8, 13, 4, 6);
        const layout = createExploreLayout(sections, metrics);
        const drawnAt = (column: number, row: number) => {
            const { posters, headings } = layout.near(lotBounds(column, row), 0);
            return [...headings, ...posters].map(tile => ({
                x: tile.x - column * LOT_PITCH_X, y: tile.y - row * LOT_PITCH_Y, width: tile.width, height: tile.height,
            }));
        };

        // Five lots, each column two lots further on: (1, 0) holds what (0, 2) holds.
        expect(drawnAt(1, 0)).toEqual(drawnAt(0, 2));
        expect(drawnAt(0, 7)).toEqual(drawnAt(0, 2));
        expect(drawnAt(-3, 3)).toEqual(drawnAt(0, 2));
    });

    it('keeps a street between neighbouring lots and the usual gap inside one', () => {
        const layout = createExploreLayout(page(13, 13, 13, 13), metrics);
        const { posters, headings } = layout.near({ left: 0, right: 2 * LOT_PITCH_X, top: 0, bottom: 2 * LOT_PITCH_Y }, 0);
        const tiles = [...headings, ...posters];

        for (let first = 0; first < tiles.length; first += 1) {
            for (let second = first + 1; second < tiles.length; second += 1) {
                const [a, b] = [tiles[first], tiles[second]];
                const apart = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), a.y - (b.y + b.height), b.y - (a.y + a.height));
                expect(apart).toBeGreaterThanOrEqual(metrics.gap);
            }
        }
        // The lot at (0, 0) ends 72 px before the one at (1, 0) begins: the gap and half a unit.
        const right = Math.max(...layout.near(lotBounds(0, 0), 0).posters.map(poster => poster.x + poster.width));
        expect(LOT_PITCH_X - right).toBe(metrics.gap + metrics.cellSize / 2);
    });

    it('changes no rectangle of the lots before a section added at the end, in the first run of column 0', () => {
        const before = page(5, 14, 3, 9, 13, 7);
        const after = [...before, section('late', 11)];
        const [was, is] = [createExploreLayout(before, metrics), createExploreLayout(after, metrics)];
        const lotCount = buildStrip(before).length;

        expect(lotCount).toBe(7);
        for (let row = 0; row < lotCount; row += 1) {
            expect(is.near(lotBounds(0, row), 0)).toEqual(was.near(lotBounds(0, row), 0));
        }
        // Six lots become seven, and each column then begins three lots further on, not two: column 0 stands all the same.
        const fewer = page(5, 3, 9, 13, 7, 4);
        const more = [...fewer, section('late', 2)];
        expect(buildStrip(fewer)).toHaveLength(6);
        for (let row = 0; row < 6; row += 1) {
            expect(createExploreLayout(more, metrics).near(lotBounds(0, row), 0)).toEqual(createExploreLayout(fewer, metrics).near(lotBounds(0, row), 0));
        }
    });

    it('draws no more than the cap, however wide the bounds', () => {
        const layout = createExploreLayout(page(13, 13, 13), metrics);
        const { posters, headings } = layout.near({ left: -40_000, right: 40_000, top: -40_000, bottom: 40_000 }, 500);

        expect(posters.length + headings.length).toBe(400);
        expect(new Set([...posters, ...headings].map(tile => tile.instanceId)).size).toBe(400);
    });

    it('has nothing to draw, and nowhere to go, without entries', () => {
        const layout = createExploreLayout([], metrics);

        expect(layout.near({ left: 0, right: 3000, top: 0, bottom: 2000 }, 500)).toEqual({ posters: [], headings: [] });
        expect(layout.nearest(0, { x: 0, y: 0 })).toBeNull();
        expect(layout.sectionAt({ x: 10, y: 10 })).toBeNull();
        expect(layout.sectionStart(0, { x: 0, y: 0 })).toBeNull();
    });
});

describe('the nearest copy', () => {
    it('of a tile is the nearest of all its copies', () => {
        for (const counts of [[4], [3, 5], [5, 14, 3, 9], [5, 14, 3, 9, 13, 7, 2, 40]]) {
            const sections = page(...counts);
            const strip = buildStrip(sections);
            const layout = createExploreLayout(sections, metrics);
            const total = counts.reduce((sum, count) => sum + count, 0);

            for (const point of [{ x: 0, y: 0 }, { x: 31_000, y: -18_500 }, { x: -7_777, y: 64_321 }, { x: 123_456, y: 98_765 }]) {
                for (const queueIndex of [0, Math.floor(total / 2), total - 1]) {
                    const nearest = layout.nearest(queueIndex, point)!;
                    expect(nearest.queueIndex).toBe(queueIndex);
                    const distanceTo = (poster: QueueInstance) => (centreOf(poster).x - point.x) ** 2 + (centreOf(poster).y - point.y) ** 2;

                    // Every copy within reach of the point, found by walking the places.
                    const lotIndex = strip.findIndex(lot => lot.tiles.includes(queueIndex));
                    const seat = strip[lotIndex].tiles.indexOf(queueIndex);
                    const [nearColumn, nearRow] = [Math.round(point.x / LOT_PITCH_X), Math.round(point.y / LOT_PITCH_Y)];
                    let copies = 0;
                    for (let column = nearColumn - 14; column <= nearColumn + 14; column += 1) {
                        for (let row = nearRow - strip.length - 1; row <= nearRow + strip.length + 1; row += 1) {
                            if (lotIndexAt(column, row, strip.length) !== lotIndex) continue;
                            copies += 1;
                            const rival = layout.near(lotBounds(column, row), 0).posters[seat];
                            expect(rival.queueIndex).toBe(queueIndex);
                            expect(distanceTo(nearest)).toBeLessThanOrEqual(distanceTo(rival));
                        }
                    }
                    expect(copies).toBeGreaterThan(20);
                }
            }
        }
    });

    it('of a section start is the nearest of all its copies, and is where its heading stands', () => {
        const sections = page(5, 14, 3, 9, 13, 7);
        const strip = buildStrip(sections);
        const layout = createExploreLayout(sections, metrics);

        for (const point of [{ x: 0, y: 0 }, { x: -9_000, y: 4_000 }, { x: 50_500, y: 70_300 }]) {
            sections.forEach((_, index) => {
                const start = layout.sectionStart(index, point)!;
                const firstLot = strip.findIndex(lot => lot.section === index);
                const [column, row] = [start.x / LOT_PITCH_X, start.y / LOT_PITCH_Y];

                expect(lotIndexAt(column, row, strip.length)).toBe(firstLot);
                const [heading] = layout.near(lotBounds(column, row), 0).headings;
                expect({ x: heading.x, y: heading.y, part: heading.part }).toEqual({ x: start.x, y: start.y, part: 0 });
                const distance = (start.x - point.x) ** 2 + (start.y - point.y) ** 2;
                for (let otherColumn = column - 12; otherColumn <= column + 12; otherColumn += 1) {
                    for (let otherRow = row - 9; otherRow <= row + 9; otherRow += 1) {
                        if (lotIndexAt(otherColumn, otherRow, strip.length) !== firstLot) continue;
                        expect(distance).toBeLessThanOrEqual((otherColumn * LOT_PITCH_X - point.x) ** 2 + (otherRow * LOT_PITCH_Y - point.y) ** 2);
                    }
                }
            });
        }
        expect(layout.sectionStart(sections.length, { x: 0, y: 0 })).toBeNull();
    });
});

describe('a grown tile on the wall', () => {
    const sections = page(5, 13, 2, 8);
    const layout = createExploreLayout(sections, metrics);

    it('moves the tiles of its own lot and names no other', () => {
        const lot = layout.near(lotBounds(2, -3), 0);
        for (const active of lot.posters) {
            const grown = layout.grown(active);

            expect([...grown.keys()].sort()).toEqual(lot.posters.map(poster => poster.instanceId).sort());
            const bounds = lotBounds(2, -3);
            const rects = [...grown.values(), lot.headings[0]];
            for (const rect of rects) {
                expect(rect.x).toBeGreaterThanOrEqual(bounds.left);
                expect(rect.y).toBeGreaterThanOrEqual(bounds.top);
                expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.right);
                expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.bottom);
            }
            for (let first = 0; first < rects.length; first += 1) {
                for (let second = first + 1; second < rects.length; second += 1) {
                    const [a, b] = [rects[first], rects[second]];
                    expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false);
                }
            }
            // The grown tile is the queue wall's grown card: six units square.
            expect(grown.get(active.instanceId)).toMatchObject({ width: 6 * PITCH - metrics.gap, height: 6 * PITCH - metrics.gap });
        }
    });

    it('offers the posters of its lot and of the lots around it for a step, and no heading', () => {
        const [from] = layout.near(lotBounds(0, 0), 0).posters;
        const candidates = layout.stepCandidates(from);
        const expected: string[] = [];
        for (let row = -1; row <= 1; row += 1) {
            for (let column = -1; column <= 1; column += 1) expected.push(...layout.near(lotBounds(column, row), 0).posters.map(poster => poster.instanceId));
        }

        expect(candidates.map(candidate => candidate.instanceId).sort()).toEqual(expected.sort());
        expect(candidates.some(candidate => candidate.instanceId.startsWith('heading'))).toBe(false);
    });
});
