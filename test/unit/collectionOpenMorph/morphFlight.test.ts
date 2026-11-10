import { describe, expect, it } from 'vitest';
import { flightBoxKeyframes, flightPictureKeyframes, flightProgress, planFlight, type MorphFlightEnd } from '@/library/suites/grid/transitions/morphFlight';
import type { CollectionMorphCard, CollectionMorphFrame, CollectionMorphRect, CollectionMorphTitle } from '@/library/suites/grid/transitions/morphGeometry';

// test/unit/collectionOpenMorph/morphFlight.test.ts

const morphFlightKeyframes = (source: MorphFlightEnd, target: MorphFlightEnd, proportions: number) => ({
    ...flightBoxKeyframes(source, target),
    ...flightPictureKeyframes(source.rect, target.rect, proportions),
});

const numbersOf = (text: string) => (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
/** translate(x, y) scale(sx, sy) of a box keyframe. */
const boxOf = (frame: Keyframe) => {
    const [x, y, scaleX, scaleY] = numbersOf(String(frame.transform));
    return { x, y, scaleX, scaleY };
};
const imageOf = (frame: Keyframe) => {
    const [scaleX, scaleY] = numbersOf(String(frame.transform));
    return { scaleX, scaleY };
};
const cornersOf = (frame: Keyframe) => {
    const [across, down] = numbersOf(String(frame.borderRadius));
    return { across, down };
};

const wide: MorphFlightEnd = { rect: { x: 40, y: 300, width: 288, height: 162 }, radius: 16 };
const square: MorphFlightEnd = { rect: { x: 600, y: 400, width: 240, height: 240 }, radius: 8 };

describe('flightProgress', () => {
    it('starts at 0, ends at 1 and moves from the first moment', () => {
        expect(flightProgress(0)).toBe(0);
        expect(flightProgress(1)).toBe(1);
        expect(flightProgress(0.05)).toBeGreaterThan(0.02);
    });

    it('has all but arrived before its end, and passes it by under one part in a hundred', () => {
        expect(flightProgress(0.98)).toBeGreaterThan(0.995);
        const highest = Math.max(...Array.from({ length: 200 }, (_, step) => flightProgress(step / 199)));
        expect(highest).toBeLessThan(1.01);
    });
});

describe('morphFlightKeyframes', () => {
    it('puts the box on the source rectangle at the first frame and leaves it untransformed at the last', () => {
        const { box } = morphFlightKeyframes(wide, square, 16 / 9);
        const first = boxOf(box[0]);
        expect(first.x).toBeCloseTo(wide.rect.x - square.rect.x, 3);
        expect(first.y).toBeCloseTo(wide.rect.y - square.rect.y, 3);
        expect(first.scaleX * square.rect.width).toBeCloseTo(wide.rect.width, 2);
        expect(first.scaleY * square.rect.height).toBeCloseTo(wide.rect.height, 2);
        expect(boxOf(box[box.length - 1])).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
        expect(box[0].offset).toBe(0);
        expect(box[box.length - 1].offset).toBe(1);
    });

    it('lays the whole picture out at the size that covers the target, centred', () => {
        // A 16:9 picture in a square box of 240: 240 high, 426.67 wide, 93.33 hidden on either side.
        const { picture } = morphFlightKeyframes(wide, square, 16 / 9);
        expect(picture.height).toBeCloseTo(240, 3);
        expect(picture.width).toBeCloseTo(426.667, 2);
        expect(picture.x).toBeCloseTo(-93.333, 2);
        expect(picture.y).toBeCloseTo(0, 5);
    });

    it('keeps the picture unstretched at every sample: its drawn width over height is the picture\'s own', () => {
        const proportions = 16 / 9;
        const { picture, box, image } = morphFlightKeyframes(wide, square, proportions);
        box.forEach((frame, index) => {
            const outer = boxOf(frame);
            const inner = imageOf(image[index]);
            const drawnWidth = picture.width * outer.scaleX * inner.scaleX;
            const drawnHeight = picture.height * outer.scaleY * inner.scaleY;
            expect(drawnWidth / drawnHeight).toBeCloseTo(proportions, 2);
        });
    });

    it('draws the picture as large as the box needs at every sample, and no larger', () => {
        const { picture, box, image } = morphFlightKeyframes(wide, square, 16 / 9);
        box.forEach((frame, index) => {
            const outer = boxOf(frame);
            const inner = imageOf(image[index]);
            const boxWidth = square.rect.width * outer.scaleX;
            const boxHeight = square.rect.height * outer.scaleY;
            const drawnWidth = picture.width * outer.scaleX * inner.scaleX;
            const drawnHeight = picture.height * outer.scaleY * inner.scaleY;
            // Covers the box, and touches it on one of the two axes.
            expect(drawnWidth).toBeGreaterThan(boxWidth - 0.05);
            expect(drawnHeight).toBeGreaterThan(boxHeight - 0.05);
            expect(Math.min(drawnWidth - boxWidth, drawnHeight - boxHeight)).toBeLessThan(0.05);
        });
    });

    it('draws the corners round at every sample: the source\'s radius at first, the target\'s at last', () => {
        const { box, corners } = morphFlightKeyframes(wide, square, 16 / 9);
        box.forEach((frame, index) => {
            const outer = boxOf(frame);
            const corner = cornersOf(corners[index]);
            expect(corner.across * outer.scaleX).toBeCloseTo(corner.down * outer.scaleY, 1);
        });
        const first = cornersOf(corners[0]);
        expect(first.across * boxOf(box[0]).scaleX).toBeCloseTo(wide.radius, 1);
        expect(cornersOf(corners[corners.length - 1])).toEqual({ across: square.radius, down: square.radius });
    });

    it('takes the source\'s own proportions for a picture whose size is not known', () => {
        const { picture } = morphFlightKeyframes(wide, square, 0);
        expect(picture.width / picture.height).toBeCloseTo(wide.rect.width / wide.rect.height, 4);
    });

    it('is a plain move for two rectangles of one size', () => {
        const from: MorphFlightEnd = { rect: { x: 0, y: 0, width: 200, height: 200 }, radius: 12 };
        const to: MorphFlightEnd = { rect: { x: 300, y: 100, width: 200, height: 200 }, radius: 12 };
        const { box, image } = morphFlightKeyframes(from, to, 1);
        for (const frame of box) {
            expect(boxOf(frame).scaleX).toBe(1);
            expect(boxOf(frame).scaleY).toBe(1);
        }
        for (const frame of image) expect(imageOf(frame)).toEqual({ scaleX: 1, scaleY: 1 });
    });
});

describe('planFlight', () => {
    const at = (x: number, y: number, width: number, height: number): CollectionMorphRect => ({ x, y, width, height });
    const framed = (rect: CollectionMorphRect, background = 'rgb(39, 39, 42)', edge = '#fafafa'): CollectionMorphFrame => ({
        rect, radius: 14, background, border: '1px solid rgb(60, 60, 60)', shadow: 'none', edge,
    });
    /** A title drawn at `rect`, laid out `scale` times smaller (its card is drawn scaled). */
    const titled = (text: string, rect: CollectionMorphRect, fontSize: number, scale = 1): CollectionMorphTitle => ({
        rect, text, width: rect.width / scale, height: rect.height / scale, fontSize, style: {},
    });
    const card = (rect: CollectionMorphRect, parts: Partial<CollectionMorphCard> = {}): CollectionMorphCard => ({
        rect, radius: 8, url: 'cover.jpg', proportions: 1, frame: null, title: null, ...parts,
    });
    /** translate(x, y) scale(s) of a title keyframe. */
    const lineOf = (frame: Keyframe) => {
        const [x, y, scale] = numbersOf(String(frame.transform));
        return { x, y, scale };
    };
    const opacities = (frames: Keyframe[]) => [Number(frames[0].opacity), Number(frames[frames.length - 1].opacity)];
    /** The opacity a set of keyframes gives at a time of the flight, as the browser draws it between two of them. */
    const opacityAt = (frames: Keyframe[], time: number) => {
        const after = Math.max(1, frames.findIndex(frame => Number(frame.offset) >= time));
        const [from, to] = [frames[after - 1], frames[after]];
        const part = (time - Number(from.offset)) / (Number(to.offset) - Number(from.offset));
        return Number(from.opacity) + (Number(to.opacity) - Number(from.opacity)) * part;
    };

    const home = card(at(52, 312, 200, 200), {
        frame: framed(at(40, 300, 224, 252)),
        title: titled('Home Playlist', at(52, 520, 200, 20), 16),
    });
    // A card drawn at 1.25: its title's letters are laid out at 14 and drawn at 17.5.
    const standIn = card(at(620, 420, 250, 250), {
        frame: framed(at(605, 405, 280, 315), 'rgb(24, 24, 27)'),
        title: titled('Home Playlist', at(620, 680, 250, 25), 14, 1.25),
    });

    it('flies the frame from the card\'s frame onto the landing place\'s, with nothing fading', () => {
        const { frame } = planFlight(home, standIn);
        expect(frame).not.toBeNull();
        expect(frame!.rect).toEqual(standIn.frame!.rect);
        const first = boxOf(frame!.box[0]);
        expect(first.x).toBeCloseTo(home.frame!.rect.x - standIn.frame!.rect.x, 3);
        expect(first.scaleX * standIn.frame!.rect.width).toBeCloseTo(home.frame!.rect.width, 2);
        expect(boxOf(frame!.box[frame!.box.length - 1])).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
        expect(frame!.fade).toBeNull();
        // Drawn as the landing place draws its own: that is the one the carrier gives way to.
        expect(frame!.look.background).toBe('rgb(24, 24, 27)');
    });

    it('has a frame only the landing place draws come out of the picture, and one only the card draws go into it', () => {
        const bare = card(at(40, 640, 288, 162));
        const coming = planFlight(bare, standIn).frame!;
        // It starts as large as the picture that is clicked, and is not seen there.
        expect(boxOf(coming.box[0]).scaleX * standIn.frame!.rect.width).toBeCloseTo(bare.rect.width, 1);
        expect(opacities(coming.fade!)).toEqual([0, 1]);

        const going = planFlight(home, bare).frame!;
        expect(going.rect).toEqual(bare.rect);
        expect(opacities(going.fade!)).toEqual([1, 0]);
        expect(going.look.background).toBe(home.frame!.background);

        expect(planFlight(bare, card(at(600, 400, 232, 232))).frame).toBeNull();
    });

    describe('the frame\'s edge', () => {
        const bare = card(at(40, 640, 288, 162));

        /** Dark at both ends, never above its peak, and its keyframes in the order of the flight (the browser takes no other). */
        const expectDarkAtBothEnds = (edge: Keyframe[]) => {
            expect(opacities(edge)).toEqual([0, 0]);
            expect([edge[0].offset, edge[edge.length - 1].offset]).toEqual([0, 1]);
            expect(Math.max(...edge.map(frame => Number(frame.opacity)))).toBe(0.9);
            const offsets = edge.map(frame => Number(frame.offset));
            expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
        };

        it('is lit in the air and not at either end, where both ends draw a frame', () => {
            const { edge } = planFlight(home, standIn).frame!;
            expectDarkAtBothEnds(edge);
            // Up over the first 0.16 of the flight, down over its last 0.4.
            expect(opacityAt(edge, 0.08)).toBeCloseTo(0.45, 5);
            expect(opacityAt(edge, 0.16)).toBeCloseTo(0.9, 5);
            expect(opacityAt(edge, 0.6)).toBeCloseTo(0.9, 5);
            expect(opacityAt(edge, 0.8)).toBeCloseTo(0.45, 5);
        });

        it('waits for a frame that comes on the way before it is lit', () => {
            const { edge } = planFlight(bare, standIn).frame!;
            expectDarkAtBothEnds(edge);
            expect(opacityAt(edge, 0.1)).toBeCloseTo(0, 5);
            expect(opacityAt(edge, 0.4)).toBeCloseTo(0.9, 5);
            expect(opacityAt(edge, 0.6)).toBeCloseTo(0.9, 5);
            expect(opacityAt(edge, 0.8)).toBeCloseTo(0.45, 5);
        });

        it('is out before a frame that goes on the way is gone', () => {
            const { edge } = planFlight(home, bare).frame!;
            expectDarkAtBothEnds(edge);
            expect(opacityAt(edge, 0.16)).toBeCloseTo(0.9, 5);
            expect(opacityAt(edge, 0.45)).toBeCloseTo(0.9, 5);
            expect(opacityAt(edge, 0.8)).toBeCloseTo(0, 5);
            expect(opacityAt(edge, 0.9)).toBeCloseTo(0, 5);
        });

        it('is not there where neither end draws a frame', () => {
            expect(planFlight(bare, card(at(600, 400, 232, 232))).frame).toBeNull();
        });

        it('has the colour of the frame the carrier is drawn as', () => {
            const landing = card(at(620, 420, 250, 250), { frame: framed(at(605, 405, 280, 315), 'rgb(24, 24, 27)', 'rgb(20, 20, 20)') });
            expect(planFlight(home, landing).frame!.look.edge).toBe('rgb(20, 20, 20)');
            expect(planFlight(home, bare).frame!.look.edge).toBe('#fafafa');
        });
    });

    it('starts the leaving title where the card draws it and ends the arriving one where the landing place does', () => {
        const { leavingTitle, arrivingTitle } = planFlight(home, standIn);
        expect(lineOf(leavingTitle!.move[0])).toEqual({ x: 52, y: 520, scale: 1 });
        expect(lineOf(arrivingTitle!.move[arrivingTitle!.move.length - 1])).toEqual({ x: 620, y: 680, scale: 1.25 });
        // One turns into the other on the way.
        expect(opacities(leavingTitle!.fade)).toEqual([1, 0]);
        expect(opacities(arrivingTitle!.fade)).toEqual([0, 1]);
    });

    it('draws the two titles at one place and one letter size at every sample, so that one can turn into the other', () => {
        const { leavingTitle, arrivingTitle } = planFlight(home, standIn);
        leavingTitle!.move.forEach((frame, index) => {
            const leaving = lineOf(frame);
            const arriving = lineOf(arrivingTitle!.move[index]);
            expect(arriving.x).toBeCloseTo(leaving.x, 3);
            expect(arriving.y).toBeCloseTo(leaving.y, 3);
            expect(arriving.scale * standIn.title!.fontSize).toBeCloseTo(leaving.scale * home.title!.fontSize, 2);
        });
        // Letters of 16 at the card, of 14 x 1.25 = 17.5 at the landing place.
        expect(lineOf(leavingTitle!.move[leavingTitle!.move.length - 1]).scale * 16).toBeCloseTo(17.5, 2);
    });

    it('carries a title along with the picture to an end that has no title, and fades it on the way', () => {
        const avatar = card(at(604, 434, 232, 232), { radius: 116 });
        const { leavingTitle, arrivingTitle } = planFlight(home, avatar);
        expect(arrivingTitle).toBeNull();
        const last = lineOf(leavingTitle!.move[leavingTitle!.move.length - 1]);
        // 208 under the top of a picture of 200; the picture ends 1.16 times as large.
        expect(last.x).toBeCloseTo(604, 3);
        expect(last.y).toBeCloseTo(434 + 208 * 1.16, 2);
        expect(last.scale).toBeCloseTo(1.16, 3);
        expect(opacities(leavingTitle!.fade)).toEqual([1, 0]);

        const back = planFlight(avatar, home);
        expect(back.leavingTitle).toBeNull();
        expect(lineOf(back.arrivingTitle!.move[0]).y).toBeCloseTo(434 + 208 * 1.16, 2);
        expect(opacities(back.arrivingTitle!.fade)).toEqual([0, 1]);
    });

    it('is the card standing still for a flight of a card to itself', () => {
        const { cover, frame, leavingTitle } = planFlight(home, home);
        for (const frameAt of cover.box) expect(boxOf(frameAt)).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
        for (const frameAt of frame!.box) expect(boxOf(frameAt)).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
        for (const frameAt of leavingTitle!.move) expect(lineOf(frameAt)).toEqual({ x: 52, y: 520, scale: 1 });
        expect(Number(leavingTitle!.fade[0].opacity)).toBe(1);
    });
});
