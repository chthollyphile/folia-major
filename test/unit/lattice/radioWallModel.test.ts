import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { buildLatticeTiles } from '@/components/app/lattice/latticeModel';
import {
    buildRadioCards,
    radioCardInView,
    radioCardRect,
    resolveRadioMetrics,
} from '@/components/app/lattice/radio/radioWallModel';

// test/unit/lattice/radioWallModel.test.ts
// 电台墙（私人 FM 下的 Lattice）挑哪几张卡、怎么摆。

const song = (index: number): SongResult => ({
    id: String(index), name: `Song ${index}`, artists: [{ id: 1, name: 'Artist' }],
    album: { id: 1, name: 'Album' }, durationMs: 180000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(index) },
});

const queueOf = (length: number) => Array.from({ length }, (_, index) => song(index));

const cardsAt = (length: number, current: number | null, wrap = false) => {
    const queue = queueOf(length);
    return buildRadioCards(buildLatticeTiles({ queue, currentSong: current === null ? null : queue[current] }), { wrap });
};

const ids = (cards: ReturnType<typeof cardsAt>) => cards.map(card => `${card.tile.id.replace('online:netease:', '')}${card.role[0]}${card.offset}`);

describe('radio wall cards', () => {
    it('keeps two played cards on the left and three coming up on the right', () => {
        const cards = cardsAt(10, 5);
        expect(cards.map(card => [card.tile.id, card.role, card.offset])).toEqual([
            ['online:netease:3', 'played', -2],
            ['online:netease:4', 'played', -1],
            ['online:netease:5', 'now', 0],
            ['online:netease:6', 'upcoming', 1],
            ['online:netease:7', 'upcoming', 2],
            ['online:netease:8', 'upcoming', 3],
        ]);
    });

    it('has no played card on the first song and only what the radio has fetched after the last', () => {
        expect(cardsAt(3, 0).map(card => card.role)).toEqual(['now', 'upcoming', 'upcoming']);
        expect(cardsAt(4, 3).map(card => card.role)).toEqual(['played', 'played', 'now']);
    });

    it('lays the queue out from its head when the playing song is not in it', () => {
        const cards = cardsAt(5, null);
        expect(cards.map(card => card.offset)).toEqual([1, 2, 3]);
        expect(cards.every(card => card.role === 'upcoming')).toBe(true);
    });

    it('draws nothing for an empty queue', () => {
        expect(cardsAt(0, null)).toEqual([]);
    });
});

describe('radio wall layout', () => {
    const metrics = resolveRadioMetrics(1600, 900);

    const center = (offset: number) => {
        const rect = radioCardRect(offset, metrics);
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, rotate: rect.rotate, width: rect.width };
    };

    it('puts the playing card upright in the middle of the window', () => {
        const now = center(0);
        expect(now.x).toBe(800);
        expect(now.y).toBe(450);
        expect(now.rotate).toBe(0);
    });

    it('starts the arc at the playing card: the next card barely tilts or drops, the further ones more', () => {
        const [one, two, three] = [center(1), center(2), center(3)];
        expect(one.rotate).toBeGreaterThan(0);
        expect(one.rotate).toBeLessThan(10);
        expect(Math.abs(one.y - 450)).toBeLessThan(metrics.cardSize * 0.1);
        expect(two.rotate).toBeGreaterThan(one.rotate);
        expect(three.rotate).toBeGreaterThan(two.rotate);
        expect(two.y).toBeGreaterThan(one.y);
        expect(three.y).toBeGreaterThan(two.y);
    });

    it('shrinks the cards step by step outwards', () => {
        const [one, two, three] = [center(1), center(2), center(3)];
        expect(one.width).toBe(metrics.cardSize);
        expect(two.width).toBeLessThan(one.width);
        expect(three.width).toBeLessThan(two.width);
        expect(two.width / one.width).toBeGreaterThan(0.8);
    });

    it('mirrors the two sides', () => {
        const right = center(2);
        const left = center(-2);
        expect(left.y).toBeCloseTo(right.y, 6);
        expect(left.rotate).toBeCloseTo(-right.rotate, 6);
        expect(left.x - 800).toBeCloseTo(800 - right.x, 6);
    });

    it('keeps the playing card inside a phone-sized window', () => {
        const phone = resolveRadioMetrics(375, 812);
        const now = radioCardRect(0, phone);
        expect(now.x).toBeGreaterThanOrEqual(0);
        expect(now.x + now.width).toBeLessThanOrEqual(375);
    });
});

describe('radio wall cards out of view', () => {
    it('keeps the cards of a wide window and drops the far ones of a phone', () => {
        const wide = resolveRadioMetrics(1600, 900);
        expect([-2, -1, 0, 1, 2, 3].every(offset => radioCardInView(radioCardRect(offset, wide), wide))).toBe(true);
        const phone = resolveRadioMetrics(375, 812);
        expect(radioCardInView(radioCardRect(0, phone), phone)).toBe(true);
        expect(radioCardInView(radioCardRect(3, phone), phone)).toBe(false);
        expect(radioCardInView(radioCardRect(-2, phone), phone)).toBe(false);
    });
});

describe('radio wall cards under list loop', () => {
    it('goes on from the head of the queue after its last song', () => {
        expect(ids(cardsAt(10, 8, true))).toEqual(['6p-2', '7p-1', '8n0', '9u1', '0u2', '1u3']);
        // Without list loop the right side ends with the queue.
        expect(ids(cardsAt(10, 8))).toEqual(['6p-2', '7p-1', '8n0', '9u1']);
    });

    it('goes on from the tail of the queue before its first song, where previous goes', () => {
        expect(ids(cardsAt(10, 0, true))).toEqual(['8p-2', '9p-1', '0n0', '1u1', '2u2', '3u3']);
        expect(ids(cardsAt(10, 0))).toEqual(['0n0', '1u1', '2u2', '3u3']);
    });

    it('gives a short queue to the right side first and never shows a song twice', () => {
        expect(ids(cardsAt(3, 2, true))).toEqual(['2n0', '0u1', '1u2']);
        expect(ids(cardsAt(4, 3, true))).toEqual(['3n0', '0u1', '1u2', '2u3']);
        expect(ids(cardsAt(5, 3, true))).toEqual(['2p-1', '3n0', '4u1', '0u2', '1u3']);
        expect(ids(cardsAt(6, 0, true))).toEqual(['4p-2', '5p-1', '0n0', '1u1', '2u2', '3u3']);
        expect(ids(cardsAt(1, 0, true))).toEqual(['0n0']);
    });

    it('does not go round for a song not in the queue', () => {
        expect(ids(cardsAt(5, null, true))).toEqual(['0u1', '1u2', '2u3']);
    });
});
