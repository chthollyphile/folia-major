import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { buildLatticeTiles } from '@/components/app/lattice/latticeModel';
import {
    buildRadioBrowseCards,
    buildRadioCards,
    placeRadioRow,
    radioBrowseRange,
    radioCardInView,
    radioCardRect,
    radioRedactionWidths,
    radioStationDrop,
    radioStationRadius,
    radioWaveCenter,
    RADIO_CARD_TILT_DEG,
    RADIO_STATION_TICK_PX,
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

    it('puts the playing card upright, centred and a little below the middle of the window', () => {
        const now = center(0);
        expect(now.x).toBe(800);
        expect(now.y).toBeCloseTo(495, 6);
        expect(now.rotate).toBe(0);
    });

    it('sinks the side cards below the playing card and drops the further ones more along the arc', () => {
        const [one, two, three] = [center(1), center(2), center(3)];
        expect(one.y - 495).toBeGreaterThan(metrics.sideDrop * 0.9);
        expect(one.y - 495).toBeLessThan(metrics.sideDrop + metrics.cardSize * 0.1);
        expect(two.y).toBeGreaterThan(one.y);
        expect(three.y).toBeGreaterThan(two.y);
    });

    it('tilts each card a fixed step more than its inner neighbour, so the seams stay narrow', () => {
        expect(center(1).rotate).toBeCloseTo(RADIO_CARD_TILT_DEG, 6);
        expect(center(2).rotate - center(1).rotate).toBeCloseTo(RADIO_CARD_TILT_DEG, 6);
        expect(center(3).rotate - center(2).rotate).toBeCloseTo(RADIO_CARD_TILT_DEG, 6);
    });

    it('leaves a real gap between the playing card and its neighbour at the top and the bottom', () => {
        const now = radioCardRect(0, metrics);
        const one = radioCardRect(1, metrics);
        // The neighbour's inner edge, both corners (rotated about the card centre).
        const angle = one.rotate * Math.PI / 180;
        const cx = one.x + one.width / 2;
        const cornerX = (dy: number) => cx + (-one.width / 2) * Math.cos(angle) - dy * Math.sin(angle);
        const right = now.x + now.width;
        expect(cornerX(-one.height / 2) - right).toBeGreaterThan(metrics.gap * 0.5);
        expect(cornerX(one.height / 2) - right).toBeGreaterThan(metrics.gap * 0.5);
    });

    it('moves a card continuously between two places on the arc', () => {
        const a = radioCardRect(0, metrics);
        const b = radioCardRect(1, metrics);
        const half = radioCardRect(0.5, metrics);
        expect(half.x).toBeCloseTo((a.x + b.x) / 2, 6);
        expect(half.width).toBeCloseTo((a.width + b.width) / 2, 6);
        expect(half.rotate).toBeCloseTo((a.rotate + b.rotate) / 2, 6);
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

describe('radio wall station lines', () => {
    // 台线的端点：卡下沿中点顺着卡自己的「向下」（跟着倾斜转）走 drop。
    const endpoint = (offset: number, metrics: ReturnType<typeof resolveRadioMetrics>) => {
        const rect = radioCardRect(offset, metrics);
        const theta = rect.rotate * Math.PI / 180;
        const drop = radioStationDrop(rect, metrics);
        return {
            drop,
            x: rect.x + rect.width / 2 - Math.sin(theta) * (rect.height / 2 + drop),
            y: rect.y + rect.height / 2 + Math.cos(theta) * (rect.height / 2 + drop),
        };
    };

    for (const [label, metrics] of [['wide', resolveRadioMetrics(1600, 900)], ['phone', resolveRadioMetrics(375, 812)]] as const) {
        it(`hangs every side card on the band, the neighbours by the tick length (${label})`, () => {
            const center = radioWaveCenter(metrics);
            const radius = radioStationRadius(metrics);
            // 台线顺着卡自己的倾斜量，电台带的半径沿径向定：差不到一像素。
            expect(Math.abs(endpoint(1, metrics).drop - RADIO_STATION_TICK_PX)).toBeLessThan(1);
            expect(Math.abs(endpoint(-1, metrics).drop - RADIO_STATION_TICK_PX)).toBeLessThan(1);
            // 正中那张大，下沿在电台带以下：不画台线。
            expect(endpoint(0, metrics).drop).toBe(0);
            // 轨道上任意位置（拖动、切歌途中），有台线的卡端点都落在电台带上。
            for (const offset of [-3, -2.4, -1.5, 1.25, 2, 2.7, 3]) {
                const end = endpoint(offset, metrics);
                expect(end.drop).toBeGreaterThan(0);
                expect(Math.hypot(end.x - center.x, end.y - center.y)).toBeCloseTo(radius, 4);
            }
        });
    }
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

describe('radio wall row on its rail', () => {
    it('keeps the cards that stay in the row where they were when the next song starts', () => {
        const first = placeRadioRow(cardsAt(10, 4), null);
        const next = placeRadioRow(cardsAt(10, 5), first);
        expect(next.anchor).toBe(first.anchor + 1);
        for (const [id, position] of next.positions) {
            if (first.positions.has(id)) expect(position).toBe(first.positions.get(id));
        }
    });

    it('moves back when a played song is chosen again', () => {
        const first = placeRadioRow(cardsAt(10, 4), null);
        expect(placeRadioRow(cardsAt(10, 3), first).anchor).toBe(first.anchor - 1);
    });

    it('lays a replaced queue out in place', () => {
        const first = placeRadioRow(cardsAt(10, 4), null);
        const other = buildRadioCards(buildLatticeTiles({ queue: [song(50), song(51)], currentSong: song(50) }));
        expect(placeRadioRow(other, first).anchor).toBe(first.anchor);
    });
});

describe('radio wall browsing', () => {
    const tilesAt = (length: number, current: number | null) => {
        const queue = queueOf(length);
        return buildLatticeTiles({ queue, currentSong: current === null ? null : queue[current] });
    };

    it('goes as far as the queue has songs, not just the cards laid out', () => {
        expect(radioBrowseRange(tilesAt(10, 4))).toEqual({ min: -4, max: 5 });
        expect(radioBrowseRange(tilesAt(10, 0))).toEqual({ min: 0, max: 9 });
        expect(radioBrowseRange(tilesAt(1, 0))).toEqual({ min: 0, max: 0 });
    });

    it('goes round the whole queue each way under list loop', () => {
        expect(radioBrowseRange(tilesAt(6, 2), { wrap: true })).toEqual({ min: -5, max: 5 });
    });

    it('lays out the usual row when not browsing', () => {
        expect(ids(buildRadioBrowseCards(tilesAt(10, 4), { from: 0, to: 0 }))).toEqual(ids(cardsAt(10, 4)));
    });

    it('lays out more cards on the side being browsed, past the view', () => {
        const right = buildRadioBrowseCards(tilesAt(20, 4), { from: 0, to: 6 });
        expect(Math.max(...right.map(card => card.offset))).toBe(9);
        expect(Math.min(...right.map(card => card.offset))).toBe(-2);
        const left = buildRadioBrowseCards(tilesAt(20, 10), { from: -5, to: 0 });
        expect(Math.min(...left.map(card => card.offset))).toBe(-8);
        expect(Math.max(...left.map(card => card.offset))).toBe(3);
    });

    it('keeps the usual row of a short looping queue in place and goes round past it', () => {
        const tiles = tilesAt(5, 0);
        const usual = buildRadioBrowseCards(tiles, { from: 0, to: 0, wrap: true });
        for (const browsed of [
            buildRadioBrowseCards(tiles, { from: -4, to: 0, wrap: true }),
            buildRadioBrowseCards(tiles, { from: 0, to: 4, wrap: true }),
        ]) {
            for (const card of usual) {
                expect(browsed.find(other => other.key === card.key)).toMatchObject({ offset: card.offset, role: card.role });
            }
            expect(new Set(browsed.map(card => card.key)).size).toBe(browsed.length);
        }
        const left = buildRadioBrowseCards(tiles, { from: -4, to: 0, wrap: true });
        expect(Math.min(...left.map(card => card.offset))).toBe(-7);
        // The next song, met again on the left a lap round, is still a song to come: it stays face down.
        expect(left.find(card => card.tile.id.endsWith(':1') && card.offset < 0)?.role).toBe('upcoming');
        expect(left.find(card => card.offset === -1)?.role).toBe('played');
    });
});

describe('radio wall redaction bars', () => {
    it('grows with the title and the artist, within the card', () => {
        const short = radioRedactionWidths('晴', 'A');
        const long = radioRedactionWidths('一首名字特别特别特别长的歌曲', 'An Artist With A Long Name');
        expect(long.title).toBeGreaterThan(short.title);
        expect(long.artist).toBeGreaterThan(short.artist);
        expect(long.title).toBeLessThanOrEqual(72);
        expect(long.artist).toBeLessThanOrEqual(46);
        expect(short.title).toBeGreaterThanOrEqual(24);
    });

    it('counts a CJK character wider than a Latin letter', () => {
        expect(radioRedactionWidths('夜航电台', '').title).toBeGreaterThan(radioRedactionWidths('Nite', '').title);
    });
});
