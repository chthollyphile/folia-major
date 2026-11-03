import { describe, expect, it } from 'vitest';
import {
    GLOW_WORD_LINE_HEIGHT,
    getGlowWordOverflow,
    getGlowWordPairGap,
    getGlowWordReach,
    type GlowWordPose,
} from '@/components/visualizer/glowWordOverlap';
import { GLOW_WORD_ACTIVE_SCALE } from '@/components/visualizer/glowWordVariants';
import { getPartitaOverlapSpacing } from '@/components/visualizer/partita/partitaOverlap';
import type { WordLayoutConfig } from '@/components/visualizer/partita/partitaLayout';

// test/unit/visualizer/glowWordOverlap.test.ts
// 「防止文字重叠」的几何：一个词画出来伸出排版框多少，相邻两词成对算出的间距刚好不碰，以及云阶按它给出的词距、行距。

const still: GlowWordPose = { scale: 1, rotate: 0, passedRotate: 0 };

const seeded = (seed: number) => () => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
};

describe('getGlowWordReach', () => {
    it('is the active size for an unturned word', () => {
        const reach = getGlowWordReach(200, 50, still);
        expect(reach.halfWidth).toBeCloseTo(100 * GLOW_WORD_ACTIVE_SCALE);
        expect(reach.halfHeight).toBeCloseTo(25 * GLOW_WORD_ACTIVE_SCALE);
    });

    it('finds the widest point of the passed turn between its ends', () => {
        // A 4:1 word is widest at atan(1/4) ≈ 14°, which neither 0° nor 60° shows.
        const reach = getGlowWordReach(4, 1, { scale: 1, rotate: 0, passedRotate: 60 });
        const widest = Math.max(...[7.5, 15].map(deg => {
            const r = (deg * Math.PI) / 180;
            return (4 * Math.cos(r) + Math.sin(r)) / 2;
        }));
        expect(reach.halfWidth).toBeGreaterThanOrEqual(widest - 1e-9);
    });
});

describe('getGlowWordOverflow', () => {
    it('reaches nowhere past the box when the word is drawn small', () => {
        expect(getGlowWordOverflow(200, 50, { scale: 0.5, rotate: 0, passedRotate: 0 })).toEqual({
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
        });
    });

    it('moves the overflow with the word offset', () => {
        const centered = getGlowWordOverflow(200, 50, still);
        const moved = getGlowWordOverflow(200, 50, still, { x: 10, y: -4 });
        expect(moved.right).toBeCloseTo(centered.right + 10);
        expect(moved.left).toBeCloseTo(centered.left - 10);
        expect(moved.top).toBeCloseTo(centered.top + 4);
        expect(moved.bottom).toBeCloseTo(Math.max(0, centered.bottom - 4));
    });

    it('keeps random neighbours apart once their overflow is their margin', () => {
        const random = seeded(7);
        const fontSize = 60;
        for (let trial = 0; trial < 200; trial += 1) {
            const words = Array.from({ length: 6 }, () => ({
                width: 20 + random() * 300,
                pose: { scale: 0.8 + random() * 0.9, rotate: (random() - 0.5) * 60, passedRotate: (random() - 0.5) * 45 },
                offset: { x: (random() - 0.5) * 120, y: (random() - 0.5) * 120 },
            }));
            // Lay them out left to right: margin-left, box, margin-right.
            let cursor = 0;
            const drawn = words.map(word => {
                const overflow = getGlowWordOverflow(word.width, fontSize, word.pose, word.offset);
                const boxLeft = cursor + overflow.left;
                cursor = boxLeft + word.width + overflow.right;
                const { halfWidth } = getGlowWordReach(word.width, fontSize, word.pose);
                const center = boxLeft + word.width / 2 + word.offset.x;
                return { left: center - halfWidth, right: center + halfWidth };
            });
            for (let index = 1; index < drawn.length; index += 1) {
                expect(drawn[index].left).toBeGreaterThanOrEqual(drawn[index - 1].right - 1e-6);
            }
        }
    });

    it('keeps two rows apart once the deepest reach above and below is the gap', () => {
        const random = seeded(11);
        const fontSize = 60;
        const boxHeight = fontSize * GLOW_WORD_LINE_HEIGHT;
        const row = () => Array.from({ length: 5 }, () => ({
            width: 20 + random() * 300,
            pose: { scale: 0.8 + random() * 0.9, rotate: (random() - 0.5) * 60, passedRotate: (random() - 0.5) * 45 },
            offset: { x: 0, y: (random() - 0.5) * 120 },
        }));
        for (let trial = 0; trial < 100; trial += 1) {
            const upper = row();
            const lower = row();
            const gap = Math.max(...upper.map(w => getGlowWordOverflow(w.width, fontSize, w.pose, w.offset).bottom))
                + Math.max(...lower.map(w => getGlowWordOverflow(w.width, fontSize, w.pose, w.offset).top));
            const lowestUpper = Math.max(...upper.map(w => boxHeight / 2 + w.offset.y + getGlowWordReach(w.width, fontSize, w.pose).halfHeight));
            const highestLower = Math.min(...lower.map(w => boxHeight + gap + boxHeight / 2 + w.offset.y - getGlowWordReach(w.width, fontSize, w.pose).halfHeight));
            expect(highestLower).toBeGreaterThanOrEqual(lowestUpper - 1e-6);
        }
    });
});

describe('getGlowWordPairGap', () => {
    const randomWord = (random: () => number) => ({
        width: 20 + random() * 300,
        pose: { scale: 0.8 + random() * 0.9, rotate: (random() - 0.5) * 60, passedRotate: (random() - 0.5) * 45 },
        offset: { x: (random() - 0.5) * 120, y: (random() - 0.5) * 120 },
    });

    it('parts two neighbours exactly enough, and never more than each keeping its reach on both sides', () => {
        const random = seeded(23);
        const fontSize = 60;
        for (let trial = 0; trial < 500; trial += 1) {
            const first = randomWord(random);
            const second = randomWord(random);
            const pairGap = getGlowWordPairGap(first, second, fontSize);
            const firstReach = getGlowWordReach(first.width, fontSize, first.pose);
            const secondReach = getGlowWordReach(second.width, fontSize, second.pose);

            const bothSides = getGlowWordOverflow(first.width, fontSize, first.pose, first.offset).right
                + getGlowWordOverflow(second.width, fontSize, second.pose, second.offset).left;
            expect(pairGap).toBeLessThanOrEqual(bothSides + 1e-6);

            const gap = Math.max(0, pairGap);
            const firstRight = first.width / 2 + first.offset.x + firstReach.halfWidth;
            const secondLeft = first.width + gap + second.width / 2 + second.offset.x - secondReach.halfWidth;
            expect(secondLeft).toBeGreaterThanOrEqual(firstRight - 1e-6);
        }
    });

    it('keeps every word of a row clear of every other, not only of its neighbours', () => {
        // Small type against fixed px offsets: neighbours often sit apart vertically, which is where
        // words two apart could meet if a pair were let off for it.
        const random = seeded(31);
        const fontSize = 18;
        for (let trial = 0; trial < 300; trial += 1) {
            const words = Array.from({ length: 10 }, () => ({
                width: fontSize,
                pose: { scale: 0.8 + random() * 0.6, rotate: (random() - 0.5) * 60, passedRotate: (random() - 0.5) * 45 },
                offset: { x: (random() - 0.5) * 120, y: (random() - 0.5) * 120 },
            }));
            let cursor = 0;
            const drawn = words.map((word, index) => {
                const boxLeft = cursor;
                const next = words[index + 1];
                cursor = boxLeft + word.width + (next ? Math.max(0, getGlowWordPairGap(word, next, fontSize)) : 0);
                const reach = getGlowWordReach(word.width, fontSize, word.pose);
                const centerX = boxLeft + word.width / 2 + word.offset.x;
                return { left: centerX - reach.halfWidth, right: centerX + reach.halfWidth, top: word.offset.y - reach.halfHeight, bottom: word.offset.y + reach.halfHeight };
            });
            for (let a = 0; a < drawn.length; a += 1) {
                for (let b = a + 1; b < drawn.length; b += 1) {
                    const apartX = drawn[b].left >= drawn[a].right - 1e-6;
                    const apartY = drawn[b].top >= drawn[a].bottom - 1e-6 || drawn[a].top >= drawn[b].bottom - 1e-6;
                    expect(apartX || apartY).toBe(true);
                }
            }
        }
    });

    it('turns the offsets around in a right-to-left line', () => {
        const first = { width: 100, pose: still, offset: { x: 10, y: 0 } };
        const second = { width: 100, pose: still, offset: { x: -10, y: 0 } };
        // LTR: first moves right toward second, second left toward first.
        expect(getGlowWordPairGap(first, second, 50, 'ltr') - getGlowWordPairGap(first, second, 50, 'rtl')).toBeCloseTo(40);
    });
});

describe('getPartitaOverlapSpacing', () => {
    const wordConfig = (x: number, y: number): WordLayoutConfig => ({
        id: 'w',
        x,
        y,
        rotate: 0,
        scale: 1.5,
        marginBottom: '0',
        alignSelf: 'auto',
        passedRotate: 0,
    });
    const rowConfig: WordLayoutConfig = { ...wordConfig(0, 0), id: 'row', rotate: 0, marginBottom: '0.6rem' };
    const row = (configs: WordLayoutConfig[], rtl = false) => ({ widthsEm: configs.map(() => 1), wordConfigs: configs, config: rowConfig, rtl });

    it('never sets words closer than the 0.8rem gap and leaves the last word that gap', () => {
        const [spacing] = getPartitaOverlapSpacing([row([wordConfig(4, 0), wordConfig(-4, 0)])]);
        expect(spacing.words[0].marginInlineEnd).toMatch(/^max\(0\.8rem, calc\(/);
        expect(spacing.words[1].marginInlineEnd).toBe('0.8rem');
    });

    it('counts the offsets toward each other, mirrored in a right-to-left row', () => {
        // LTR: 4px right and 4px left close in by 8px. RTL: the same offsets part them by 8px.
        const [ltr] = getPartitaOverlapSpacing([row([wordConfig(4, 0), wordConfig(-4, 0)])]);
        const [rtl] = getPartitaOverlapSpacing([row([wordConfig(4, 0), wordConfig(-4, 0)], true)]);
        expect(ltr.words[0].marginInlineEnd).toMatch(/\+ 8\.0px\)\)$/);
        expect(rtl.words[0].marginInlineEnd).toMatch(/\+ -8\.0px\)\)$/);
    });

    it('gives the first row a top margin and spaces each pair of rows from both of them', () => {
        const spacing = getPartitaOverlapSpacing([row([wordConfig(0, -3)]), row([wordConfig(0, 5)])]);
        expect(spacing[0].marginTop).toMatch(/^max\(0px, calc\(/);
        expect(spacing[1].marginTop).toBeUndefined();
        // Upper row reaches 3px up and -3px down; lower 5px down and -5px up: between them -3 + -5.
        expect(spacing[0].marginBottom).toMatch(/^max\(0\.6rem, calc\(calc\([-\d.]+em \+ -8\.0px\) - 2 \* 0\.2rem\)\)$/);
        expect(spacing[1].marginBottom).toMatch(/^max\(0\.6rem, calc\(calc\([-\d.]+em \+ 5\.0px\) - 0\.2rem\)\)$/);
    });
});
