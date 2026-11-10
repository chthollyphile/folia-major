import type { BlockSlot } from '../../wall/blockTemplates';
import {
    MAX_RENDERED_INSTANCES,
    overlaps,
    toBounds,
    type QueueInstance,
    type WallMetrics,
    type WallRect,
} from '../../wall/layout';
import type { WallHeading, WallLayout, WallSection } from './wallLayout';
import type { WallEntryKind } from './latticeModel';
import { cutGrownLot, cutLot, mirrorsOf, type LotMirrors } from './lotSeats';
import { LOT_CAPACITY, LOT_COLS, LOT_ROWS } from './lotTables';

// src/components/app/lattice/exploreLayout.ts
// The explore wall's layout: the wall laid out by section, each section a small collage with its
// heading as one of the tiles. A pure function of the sections and the metrics.
// - A lot is 12 x 8 units and holds one section of up to 13 entries; a longer section is dealt
//   evenly, in order, over lots that follow each other. All lots in the page's order are the strip.
// - The plane has no edge: the place (column, row), any whole numbers, holds the lot
//   (row + column * stride) of the strip, counted round. So down is the page's order, and each
//   column is the same strip begun `stride` lots further on. Between lots lies a street, half a
//   unit wider than the gap between posters.
// - On a lot the entries stand by kind (albums, playlists and mixes, artists, songs), the i-th on
//   the i-th seat, and the seats go largest first (lotSeats.ts, from the tables of lotTables.ts).
// The queue wall's layout is layout.ts; both answer to `WallLayout` there.

// The order of the kinds on a lot. Collections come first and so take the larger seats.
const KIND_RANK: Record<WallEntryKind, number> = { album: 0, playlist: 1, mix: 1, artist: 2, song: 3 };

/** One lot of the strip: a section, or one part of a section too long for one lot. */
export type Lot = {
    /** The section's place among the sections that stand on the wall, from 0. */
    section: number;
    /** Which of the section's `parts` lots this is, from 0. */
    part: number;
    parts: number;
    /** The entries on the lot's seats, by their place in the wall's list: `tiles[i]` stands on `seats[i]`. */
    tiles: number[];
    seats: BlockSlot[];
    heading: BlockSlot;
    mirrors: LotMirrors;
};

/**
 * The strip: every section's lots, in the page's order. `sections` have entries, all of them.
 * A section is dealt over its lots in the page's order, the earlier lots taking the one entry
 * more where it does not divide; on each lot the entries are then put by kind.
 */
export const buildStrip = (sections: WallSection[]): Lot[] => sections.flatMap((section, index) => {
    const total = section.entries.length;
    const parts = Math.ceil(total / LOT_CAPACITY);
    const lots: Lot[] = [];
    for (let part = 0, from = 0; part < parts; part += 1) {
        const size = Math.floor(total / parts) + (part < total % parts ? 1 : 0);
        const entries = section.entries.slice(from, from + size).sort((first, second) => KIND_RANK[first.kind] - KIND_RANK[second.kind]);
        from += size;
        const mirrors = mirrorsOf(section.key, part);
        lots.push({ section: index, part, parts, tiles: entries.map(entry => entry.index), mirrors, ...cutLot(size, mirrors) });
    }
    return lots;
});

/** How many lots further on each column begins the strip, for a strip of `lotCount` lots. */
export const strideOf = (lotCount: number): number => (lotCount >= 7 ? 3 : lotCount >= 4 ? 2 : 1);

const wrap = (value: number, count: number) => ((value % count) + count) % count;

/** Which lot of a strip of `lotCount` the place (column, row) holds. */
export const lotIndexAt = (column: number, row: number, lotCount: number): number => (
    wrap(row + column * strideOf(lotCount), lotCount)
);

/** The explore wall's layout for these sections of the explore page. A section without entries is left out. */
export const createExploreLayout = (pageSections: WallSection[], metrics: WallMetrics): WallLayout => {
    const sections = pageSections.filter(section => section.entries.length > 0);
    const lots = buildStrip(sections);
    const lotCount = lots.length;
    const pitch = metrics.cellSize + metrics.gap;
    const street = metrics.cellSize / 2;
    const pitchX = LOT_COLS * pitch + street;
    const pitchY = LOT_ROWS * pitch + street;
    const lotSize = { width: LOT_COLS * pitch - metrics.gap, height: LOT_ROWS * pitch - metrics.gap };
    // Where each entry stands: its lot in the strip, and its seat on the lot.
    const seatOf = new Map<number, { lot: number; seat: number }>();
    lots.forEach((lot, index) => lot.tiles.forEach((tile, seat) => seatOf.set(tile, { lot: index, seat })));
    const firstLotOf = sections.map((_, section) => lots.findIndex(lot => lot.section === section));

    const lotAt = (column: number, row: number) => lots[lotIndexAt(column, row, lotCount)];
    const rectOf = (slot: BlockSlot, column: number, row: number): WallRect => ({
        x: column * pitchX + slot.x * pitch,
        y: row * pitchY + slot.y * pitch,
        width: slot.cols * pitch - metrics.gap,
        height: slot.rows * pitch - metrics.gap,
    });
    const posterAt = (column: number, row: number, seat: number): QueueInstance => {
        const lot = lotAt(column, row);
        return {
            instanceId: `${seat}:${column}:${row}`,
            queueIndex: lot.tiles[seat],
            cellSlot: seat,
            repeatX: column,
            repeatY: row,
            ...rectOf(lot.seats[seat], column, row),
        };
    };

    /**
     * Of all the places that hold lot `index` of the strip, the one where the lot's point
     * `offset` (from the lot's top left) is closest to `point`. A column holds the lot once
     * every `lotCount` rows, so in the column nearest to the point a copy is at most half of
     * that away: the columns searched are those that could still be nearer than it.
     */
    const nearestPlace = (index: number, offset: { x: number; y: number }, point: { x: number; y: number }) => {
        const column = (point.x - offset.x) / pitchX;
        const row = (point.y - offset.y) / pitchY;
        const middle = Math.round(column);
        const reach = Math.ceil((lotCount * pitchY) / (2 * pitchX)) + 1;
        let best = { column: middle, row: 0 };
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let candidate = middle - reach; candidate <= middle + reach; candidate += 1) {
            // The rows of this column that hold the lot: one, and every `lotCount` from it.
            const first = wrap(index - candidate * strideOf(lotCount), lotCount);
            const candidateRow = first + lotCount * Math.round((row - first) / lotCount);
            const distance = ((candidate - column) * pitchX) ** 2 + ((candidateRow - row) * pitchY) ** 2;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = { column: candidate, row: candidateRow };
            }
        }
        return best;
    };

    return {
        sections,
        lotSize,
        near: (bounds, overscan) => {
            const posters: QueueInstance[] = [];
            const headings: WallHeading[] = [];
            if (lotCount === 0) return { posters, headings };
            const view = {
                left: bounds.left - overscan,
                right: bounds.right + overscan,
                top: bounds.top - overscan,
                bottom: bounds.bottom + overscan,
            };
            const isFull = () => posters.length + headings.length >= MAX_RENDERED_INSTANCES;
            for (let row = Math.floor(view.top / pitchY); row <= Math.floor(view.bottom / pitchY); row += 1) {
                for (let column = Math.floor(view.left / pitchX); column <= Math.floor(view.right / pitchX); column += 1) {
                    const lot = lotAt(column, row);
                    const heading = rectOf(lot.heading, column, row);
                    if (overlaps(toBounds(heading), view)) {
                        headings.push({ instanceId: `heading:${column}:${row}`, section: lot.section, part: lot.part, parts: lot.parts, ...heading });
                        if (isFull()) return { posters, headings };
                    }
                    for (let seat = 0; seat < lot.seats.length; seat += 1) {
                        const poster = posterAt(column, row, seat);
                        if (!overlaps(toBounds(poster), view)) continue;
                        posters.push(poster);
                        if (isFull()) return { posters, headings };
                    }
                }
            }
            return { posters, headings };
        },
        nearest: (queueIndex, point) => {
            const stands = seatOf.get(queueIndex);
            if (!stands) return null;
            const slot = lots[stands.lot].seats[stands.seat];
            const place = nearestPlace(stands.lot, {
                x: slot.x * pitch + (slot.cols * pitch - metrics.gap) / 2,
                y: slot.y * pitch + (slot.rows * pitch - metrics.gap) / 2,
            }, point);
            return posterAt(place.column, place.row, stands.seat);
        },
        grown: active => {
            const result = new Map<string, WallRect>();
            if (lotCount === 0) return result;
            const { repeatX: column, repeatY: row, cellSlot: seat } = active;
            const lot = lotAt(column, row);
            if (seat < 0 || seat >= lot.seats.length) return result;
            cutGrownLot(lot.seats.length, lot.mirrors, seat).forEach((slot, index) => {
                result.set(`${index}:${column}:${row}`, rectOf(slot, column, row));
            });
            return result;
        },
        // The posters of the lot `from` stands on and of the eight lots around it. Headings are not among them.
        stepCandidates: from => {
            const candidates: QueueInstance[] = [];
            if (lotCount === 0) return candidates;
            for (let row = from.repeatY - 1; row <= from.repeatY + 1; row += 1) {
                for (let column = from.repeatX - 1; column <= from.repeatX + 1; column += 1) {
                    const seats = lotAt(column, row).seats.length;
                    for (let seat = 0; seat < seats; seat += 1) candidates.push(posterAt(column, row, seat));
                }
            }
            return candidates;
        },
        sectionAt: point => {
            if (lotCount === 0) return null;
            const column = Math.floor(point.x / pitchX);
            const row = Math.floor(point.y / pitchY);
            // Past the lot's own edge the point is on a street.
            if (point.x - column * pitchX > lotSize.width || point.y - row * pitchY > lotSize.height) return null;
            return lotAt(column, row).section;
        },
        sectionStart: (section, point) => {
            const index = firstLotOf[section];
            if (index === undefined || index < 0) return null;
            const place = nearestPlace(index, { x: 0, y: 0 }, point);
            return { x: place.column * pitchX, y: place.row * pitchY };
        },
    };
};
