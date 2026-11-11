import { describe, expect, it } from 'vitest';
import type { Line } from '@/types';
import { tesseraFill } from '@/components/visualizer/tessera/tesseraBackdrop';
import { tesseraFrameMoving } from '@/components/visualizer/tessera/tesseraDraw';
import { buildTesseraPlan, type TesseraMeasure } from '@/components/visualizer/tessera/tesseraPlan';
// 方块字画面上看不出来的两处规则：空闲时画布循环跳过不画（坏了只是多占 CPU），背景三选一在透明播放页和样式小图下怎么铺。

const measure: TesseraMeasure = text => Array.from(text).length;

const line = (segments: string[], start: number, duration: number): Line => {
    const step = duration / segments.length;
    return {
        words: segments.map((text, index) => ({ text, startTime: start + index * step, endTime: start + (index + 1) * step })),
        startTime: start,
        endTime: start + duration,
        fullText: segments.join(''),
        wordSegments: segments,
    };
};

describe('tesseraFrameMoving', () => {
    const plan = buildTesseraPlan([line(['方块', '落下'], 10, 2)], measure);
    const [row] = plan.rows;
    const [piece] = plan.pieces;

    it('is idle before the first piece is born and once the row has cleared, its debris settled and the rows above dropped', () => {
        expect(tesseraFrameMoving(plan, row.presenceStart - 0.01)).toBe(false);
        expect(tesseraFrameMoving(plan, 0)).toBe(false);
        expect(tesseraFrameMoving(plan, Math.max(row.clearEnd + 1, row.dropEnd) + 0.01)).toBe(false);
        expect(tesseraFrameMoving(buildTesseraPlan([], measure), 5)).toBe(false);
    });

    it('is moving while a piece falls, while the row clears and while its debris still flies', () => {
        expect(tesseraFrameMoving(plan, (piece.spawn + piece.land) / 2)).toBe(true);
        expect(tesseraFrameMoving(plan, (row.end + row.clearEnd) / 2)).toBe(true);
        expect(tesseraFrameMoving(plan, row.clearEnd + 0.3)).toBe(true);
    });
});

describe('tesseraFill', () => {
    const opaque = { mode: 'latent', transparent: false } as const;
    const seeThrough = { mode: 'latent', transparent: true } as const;

    it('fills the whole canvas for solid, only the board for frame, nothing for clear', () => {
        expect(tesseraFill('solid', opaque, false)).toBe('all');
        expect(tesseraFill('frame', opaque, false)).toBe('board');
        expect(tesseraFill('clear', opaque, false)).toBe('none');
        expect(tesseraFill('solid', undefined, false)).toBe('all');
    });

    it('falls back to the board on a see-through player page, where the page shows the desktop', () => {
        expect(tesseraFill('solid', seeThrough, false)).toBe('board');
        expect(tesseraFill('frame', seeThrough, false)).toBe('board');
        expect(tesseraFill('clear', seeThrough, false)).toBe('none');
    });

    it('does not take the style picture, which marks its background transparent to mean "draw none", for a see-through page', () => {
        expect(tesseraFill('solid', seeThrough, true)).toBe('all');
        expect(tesseraFill('frame', seeThrough, true)).toBe('board');
        expect(tesseraFill('clear', seeThrough, true)).toBe('none');
    });
});
