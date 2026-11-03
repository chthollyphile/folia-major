import type { BlockSlot } from '../../wall/blockTemplates';
import {
    HEADING_HALF,
    HEADING_STRIP,
    LEFT_SQUARE,
    RIGHT_HALF_SEATS,
    RIGHT_SQUARE,
    RIGHT_STRIP,
    SQUARE_SEATS,
    STRIP_SEATS,
    grownStripSeatsOf,
    stripSeatsOf,
} from './lotTables';

// src/components/app/lattice/lotSeats.ts
// Cuts one lot of the explore wall into seats, from the tables of lotTables.ts: as it stands
// (`cutLot`), and while one of its tiles is grown (`cutGrownLot`). Pure, in units of the lot;
// exploreLayout.ts puts the lots on the wall and the entries on the seats.

/**
 * How a lot's two squares are mirrored, four bits: 1 the left square left-right, 2 the left
 * square top-bottom, 4 and 8 the same for the right square.
 */
export type LotMirrors = number;

/**
 * A lot's mirrors from the key of its section and its number in the section: lots do not all
 * look alike, and one lot looks the same wherever and whenever it is drawn.
 */
export const mirrorsOf = (sectionKey: string, part: number): LotMirrors => {
    let hash = 0x811c9dc5;
    for (const character of `${sectionKey}#${part}`) {
        hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 0x01000193);
    }
    hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d);
    hash ^= hash >>> 12;
    return (hash >>> 0) % 16;
};

/** A table's seats inside `field`, in units of the lot; `mirror`: 1 left-right, 2 top-bottom. */
const seatsIn = (field: BlockSlot, table: BlockSlot[], mirror: number): BlockSlot[] => table.map(seat => ({
    x: field.x + (mirror & 1 ? field.cols - seat.x - seat.cols : seat.x),
    y: field.y + (mirror & 2 ? field.rows - seat.y - seat.rows : seat.y),
    cols: seat.cols,
    rows: seat.rows,
}));

// The order of a lot's seats: largest first, then top to bottom, then left to right.
const bySeatOrder = (first: BlockSlot, second: BlockSlot) => (
    second.cols * second.rows - first.cols * first.rows || first.y - second.y || first.x - second.x
);

/**
 * The heading's seat and the seats of a lot of `count` entries (1 to 13), in the seats' order:
 * the lot's i-th entry takes the i-th seat.
 */
export const cutLot = (count: number, mirrors: LotMirrors): { heading: BlockSlot; seats: BlockSlot[] } => {
    if (count <= 2) return { heading: HEADING_HALF, seats: RIGHT_HALF_SEATS[Math.max(0, count)] };
    const strip = stripSeatsOf(count);
    const left = Math.floor((count - strip) / 2);
    return {
        heading: HEADING_STRIP,
        seats: [
            ...seatsIn(LEFT_SQUARE, SQUARE_SEATS[left], mirrors & 3),
            ...seatsIn(RIGHT_SQUARE, SQUARE_SEATS[count - strip - left], (mirrors >> 2) & 3),
            ...seatsIn(RIGHT_STRIP, STRIP_SEATS[strip], 0),
        ].sort(bySeatOrder),
    };
};

/**
 * Which of the `to` seats each of the `from` tiles takes so that the tiles move least: the
 * assignment with the smallest sum of squared distances between centres, and of several such the
 * first found, so the rule is pure. Twelve tiles at most: `best[mask]` is the smallest sum for
 * the first tiles seated on the seats of `mask`, every set of seats tried once.
 */
const seatWithLeastTravel = (from: BlockSlot[], to: BlockSlot[]): number[] => {
    const count = from.length;
    // Centres doubled, so that the sums stay whole numbers.
    const travel = from.map(tile => to.map(seat => (
        (2 * tile.x + tile.cols - 2 * seat.x - seat.cols) ** 2 + (2 * tile.y + tile.rows - 2 * seat.y - seat.rows) ** 2
    )));
    const best = new Float64Array(1 << count).fill(Number.POSITIVE_INFINITY);
    const lastSeat = new Int8Array(1 << count);
    best[0] = 0;
    for (let mask = 0; mask < best.length; mask += 1) {
        let tile = 0;
        for (let rest = mask; rest; rest &= rest - 1) tile += 1;
        if (tile >= count) continue;
        for (let seat = 0; seat < count; seat += 1) {
            if (mask & (1 << seat)) continue;
            const sum = best[mask] + travel[tile][seat];
            if (sum < best[mask | (1 << seat)]) {
                best[mask | (1 << seat)] = sum;
                lastSeat[mask | (1 << seat)] = seat;
            }
        }
    }
    const taken = new Array<number>(count);
    for (let tile = count - 1, mask = best.length - 1; tile >= 0; tile -= 1) {
        taken[tile] = lastSeat[mask];
        mask &= ~(1 << lastSeat[mask]);
    }
    return taken;
};

/**
 * The seats of a lot of `count` entries while the tile on `grownSeat` is grown, by the seats of
 * `cutLot`: the i-th is where the tile of the i-th seat stands meanwhile. The grown tile takes
 * the whole square its centre is in (from the right strip: the right square); the others share
 * the other square and the right strip, cut anew for their number, each on the seat that moves
 * the tiles least. The heading stays. In a lot of one or two entries the grown tile takes the
 * top 6 x 6 of the right half and the other one the strip under it; a lot of one entry leaves
 * that strip empty.
 */
export const cutGrownLot = (count: number, mirrors: LotMirrors, grownSeat: number): BlockSlot[] => {
    const base = cutLot(count, mirrors).seats;
    const grown = base[grownSeat];
    if (!grown) return base;
    if (count <= 2) return base.map((_, seat) => (seat === grownSeat ? RIGHT_SQUARE : RIGHT_STRIP));

    const isInLeft = grown.x + grown.cols / 2 < LEFT_SQUARE.x + LEFT_SQUARE.cols;
    const others = count - 1;
    const strip = grownStripSeatsOf(others);
    const free = [
        ...seatsIn(isInLeft ? RIGHT_SQUARE : LEFT_SQUARE, SQUARE_SEATS[others - strip], isInLeft ? (mirrors >> 2) & 3 : mirrors & 3),
        ...seatsIn(RIGHT_STRIP, STRIP_SEATS[strip], 0),
    ];
    const movers = base.map((_, seat) => seat).filter(seat => seat !== grownSeat);
    const taken = seatWithLeastTravel(movers.map(seat => base[seat]), free);
    const result = [...base];
    result[grownSeat] = isInLeft ? LEFT_SQUARE : RIGHT_SQUARE;
    movers.forEach((seat, index) => { result[seat] = free[taken[index]]; });
    return result;
};
