import { describe, expect, it } from 'vitest';
import type { Line } from '@/types';
import {
    buildTesseraPlan, rowPresence, tesseraLineTokenTexts,
    type TesseraMeasure, type TesseraPlan,
} from '@/components/visualizer/tessera/tesseraPlan';
// 方块字的排布：分词成块、按列宽切行、每行最后一块落在行末、每行正好填满、
// 预先填进上一行的格子底下有东西托着、拼出多种形状。

/** 假的测量：汉字、假名、全角标点 1em，其余 0.55em。 */
const measure: TesseraMeasure = text => Array.from(text).reduce(
    (sum, char) => sum + (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}「」]/u.test(char) ? 1 : 0.55),
    0,
);

/** 按分词造一句，词的时间按顺序平均分。 */
const makeLine = (segments: string[], start: number, duration: number, segmented = true): Line => {
    const step = duration / Math.max(1, segments.length);
    return {
        words: segments.map((text, index) => ({ text, startTime: start + index * step, endTime: start + (index + 1) * step })),
        startTime: start,
        endTime: start + duration,
        fullText: segments.join(''),
        ...(segmented ? { wordSegments: segments } : {}),
    };
};

const SONG: Line[] = [
    makeLine(['雨', '停', '了', '以后', '的', '街道'], 1, 3.2),
    makeLine(['我', '把', '没', '说完', '的', '话', '折成', '纸飞机'], 4.6, 4.4),
    makeLine(['飞', '过', '你', '的', '窗'], 9.4, 2),
    makeLine(['I ', 'keep ', 'the ', 'light ', 'on ', 'for ', 'you'], 11.8, 3.6),
    makeLine(['「', '明日', 'は', 'きっと', '晴れる', '」'], 15.8, 3.4),
    makeLine(['一个人', '走过', '长长', '的', '隧道', '听见', '回声', '在', '说', '再见', '再见', '再见'], 19.6, 6.4),
    makeLine(['oh ', 'oh'], 26.4, 1.4),
    makeLine(['方块', '落下', '又', '消失', '在', '光里'], 31, 3.6),
];

/** 每行每一列被哪一段占着、什么时候落地。 */
const occupancy = (plan: TesseraPlan) => plan.rows.map(row => {
    const lands = new Array<number | null>(plan.columns).fill(null);
    for (const { piece, block } of row.blocks) {
        for (let col = block.col; col < block.col + block.cells; col += 1) {
            expect(lands[col]).toBeNull();
            lands[col] = piece.land;
        }
    }
    return lands;
});

describe('buildTesseraPlan', () => {
    it('fills every row exactly once per column', () => {
        const plan = buildTesseraPlan(SONG, measure);
        for (const lands of occupancy(plan)) {
            expect(lands.every(land => land !== null)).toBe(true);
        }
    });

    it('fills each row last at its end: no cell of a row lands after the row ends, and some piece lands exactly then', () => {
        const plan = buildTesseraPlan(SONG, measure);
        plan.rows.forEach(row => {
            const lands = row.blocks.map(({ piece }) => piece.land);
            expect(Math.max(...lands)).toBe(row.end);
        });
        // 第一句没人预先填它，最后一个词「街道」唱完时这一行满。
        expect(plan.rows[0].end).toBeCloseTo(4.2, 5);
    });

    it('only places a cell over a cell that has already landed (nothing hangs over a hole a later piece must fill)', () => {
        const plan = buildTesseraPlan(SONG, measure);
        const lands = occupancy(plan);
        for (let row = 1; row < plan.rows.length; row += 1) {
            for (let col = 0; col < plan.columns; col += 1) {
                const above = lands[row][col]!;
                // 下面那一行已经消掉了的不算。
                if (above >= plan.rows[row - 1].end) continue;
                expect(lands[row - 1][col]!).toBeLessThanOrEqual(above);
            }
        }
    });

    it('builds pieces from the next line and from filler cells, in several tetromino shapes', () => {
        const plan = buildTesseraPlan(SONG, measure);
        const tetrominoes = new Set(plan.pieces.map(piece => piece.shape).filter(shape => /^[IOTSZJL]$/.test(shape)));
        expect(tetrominoes.size).toBeGreaterThanOrEqual(4);
        const prefill = plan.pieces.filter(piece => piece.blocks.some(block => block.row > piece.baseRow && block.kind !== 'filler'));
        expect(prefill.length).toBeGreaterThan(0);
        for (const piece of plan.pieces) {
            expect(piece.blocks.every(block => block.row === piece.baseRow || block.row === piece.baseRow + 1)).toBe(true);
            expect(piece.spawn).toBeLessThan(piece.land);
        }
    });

    it('keeps each line in reading order across its cells', () => {
        const plan = buildTesseraPlan(SONG, measure);
        const firstRow = plan.rows[0].blocks
            .filter(({ block }) => block.kind !== 'filler')
            .sort((a, b) => a.block.col - b.block.col)
            .map(({ block }) => block.text)
            .join('');
        expect(firstRow).toBe('雨停了以后的街道');
    });

    it('draws narrow-script words as one block spanning several cells', () => {
        const plan = buildTesseraPlan(SONG, measure);
        const words = plan.pieces.flatMap(piece => piece.blocks).filter(block => block.kind === 'word');
        expect(words.map(block => block.text)).toContain('light');
        expect(words.every(block => block.cells >= 1 && block.glyphs.length === block.text.length)).toBe(true);
    });

    it('splits a line that is much longer than the board into roughly equal rows that end in order', () => {
        const short = Array.from({ length: 10 }, (_, index) => makeLine(['一二', '三四', '五六', '七八', '九十'], index * 3, 2));
        const long = makeLine(['一个人', '走过', '长长', '的', '隧道', '听见', '回声', '在', '说', '再见', '再见'], 40, 6);
        const plan = buildTesseraPlan([...short, long], measure);
        expect(plan.rows).toHaveLength(12);
        expect(plan.rows[10].end).toBeLessThan(plan.rows[11].end);
        expect(plan.rows[11].end).toBeCloseTo(46, 5);
    });

    it('lands a piece one row up while the row below is still on the board, and on the floor once it has gone', () => {
        const plan = buildTesseraPlan([makeLine(['甲乙', '丙丁'], 0, 2), makeLine(['戊己', '庚辛'], 2, 0.4)], measure);
        const own = plan.pieces.filter(piece => piece.baseRow === 1);
        expect(own.length).toBeGreaterThan(0);
        for (const piece of own) {
            if (rowPresence(plan.rows[0], piece.land) === 1) expect(piece.landSlot).toBe(1);
        }
        const apart = buildTesseraPlan([makeLine(['甲乙', '丙丁'], 0, 2), makeLine(['戊己', '庚辛'], 20, 2)], measure);
        expect(apart.pieces.filter(piece => piece.baseRow === 1).every(piece => piece.landSlot === 0)).toBe(true);
        // 隔得远的下一句不预先填。
        expect(apart.pieces.filter(piece => piece.baseRow === 0).every(piece => piece.blocks.every(block => block.row === 0))).toBe(true);
    });

    it('does not hold an overlapping line that is sung out first behind the line under it (duets, harmonies)', () => {
        // 甲句 0–6 s，乙句 1–2.5 s：乙句先唱完，它那一行要在 2.5 s 满，不能被甲句末尾的预填拖到 6 s。
        const plan = buildTesseraPlan([
            makeLine(['甲乙', '丙丁', '戊己', '庚辛', '壬癸'], 0, 6),
            makeLine(['子丑', '寅卯'], 1, 1.5),
        ], measure);
        expect(plan.rows[1].end).toBeCloseTo(2.5, 5);
        for (const { piece } of plan.rows[1].blocks) expect(piece.land).toBeLessThanOrEqual(plan.rows[1].end);
    });

    it('skips lines with no text', () => {
        const plan = buildTesseraPlan([makeLine([], 0, 2), makeLine(['好'], 3, 1)], measure);
        expect(plan.rows).toHaveLength(1);
    });
});

describe('tesseraLineTokenTexts', () => {
    it('follows the saved word segmentation and cuts CJK words longer than four glyphs', () => {
        expect(tesseraLineTokenTexts(makeLine(['一二三四五六七', '八'], 0, 4), measure)).toEqual(['一二三四', '五六七', '八']);
    });

    it('attaches punctuation to the neighbouring word and drops spaces', () => {
        expect(tesseraLineTokenTexts(makeLine(['「', '明日', 'は', '」'], 0, 2), measure)).toEqual(['「明日', 'は」']);
        expect(tesseraLineTokenTexts(makeLine(['hello, ', 'world'], 3, 2, false), measure)).toEqual(['hello,', 'world']);
    });

    it('keeps a leading punctuation mark apart when a space follows it, so the space never lands inside a word', () => {
        expect(tesseraLineTokenTexts(makeLine(['「', ' ', '明日'], 0, 2), measure)).toEqual(['「', '明日']);
    });
});
