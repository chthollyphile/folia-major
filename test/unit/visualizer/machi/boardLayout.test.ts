import { describe, expect, it } from 'vitest';
import {
    layoutMachiBoardCard,
    layoutMachiBoardLine,
    resolveMachiBoardReveal,
    type MachiBoardBox,
} from '@/components/visualizer/machi/engine/boardLayout';
import type { Line } from '@/types';

// test/unit/visualizer/machi/boardLayout.test.ts
// 广告塔字面的排版与逐字点亮：折行不丢字、行首禁则标点并到前面、点亮位置随时间单调、唱完整行全亮。

const BOX: MachiBoardBox = { width: 1280, height: 500, paddingX: 0.05, referencePx: 100 };
/** 假测量：中日韩字 100、其余 55（参考字号 100）。 */
const measure = (text: string) => Array.from(text).reduce((sum, char) => sum + (/[　-鿿]/u.test(char) ? 100 : 55), 0);

const cjkLine = (text: string, start = 10, perChar = 0.3): Line => {
    const chars = Array.from(text);
    return {
        words: chars.map((char, index) => ({ text: char, startTime: start + index * perChar, endTime: start + (index + 1) * perChar })),
        startTime: start,
        endTime: start + chars.length * perChar,
        fullText: text,
    };
};

const latinLine = (words: string[], start = 0, perWord = 0.5): Line => ({
    words: words.map((word, index) => ({ text: index < words.length - 1 ? `${word} ` : word, startTime: start + index * perWord, endTime: start + (index + 1) * perWord })),
    startTime: start,
    endTime: start + words.length * perWord,
    fullText: words.join(' '),
});

const rowText = (layout: ReturnType<typeof layoutMachiBoardLine>) => layout.rows.map(row => row.glyphs.map(glyph => glyph.text).join(''));

describe('layoutMachiBoardLine', () => {
    it('keeps every character of a long line across its rows', () => {
        const text = '我听见远方的海潮一遍一遍拍打着沉默的礁石和那座早已熄灭多年的灯塔';
        const layout = layoutMachiBoardLine(cjkLine(text), BOX, measure);
        expect(layout.rows.length).toBeGreaterThan(1);
        expect(layout.rows.length).toBeLessThanOrEqual(3);
        expect(rowText(layout).join('')).toBe(text);
    });

    it('keeps a short line on one row', () => {
        expect(layoutMachiBoardLine(cjkLine('晚安'), BOX, measure).rows).toHaveLength(1);
    });

    it('never starts a row with closing punctuation', () => {
        const layout = layoutMachiBoardLine(cjkLine('风吹过，光落在晨雾里，我们慢慢走回去，星河与风一起落下。'), BOX, measure);
        rowText(layout).forEach(row => expect(row).not.toMatch(/^[，。]/u));
    });

    it('wraps latin lines between words', () => {
        const layout = layoutMachiBoardLine(latinLine(['under', 'the', 'neon', 'rain', 'we', 'were', 'young', 'and', 'the', 'river', 'held', 'on', 'to', 'midnight']), BOX, measure);
        rowText(layout).forEach(row => expect(row.startsWith(' ')).toBe(false));
        expect(rowText(layout).join('').replace(/\s+/g, ' ').trim()).toBe('under the neon rain we were young and the river held on to midnight');
    });

    it('records each glyph offset into fullText for keyword colouring', () => {
        const line = cjkLine('迷失在无边际');
        const layout = layoutMachiBoardLine(line, BOX, measure);
        const glyphs = layout.rows.flatMap(row => row.glyphs);
        glyphs.forEach(glyph => expect(line.fullText.slice(glyph.offset, glyph.offset + glyph.length)).toBe(glyph.text));
    });
});

describe('resolveMachiBoardReveal', () => {
    it('lights nothing before the line, all of it after, and moves monotonically', () => {
        const line = cjkLine('把回忆折成纸船放进河流', 20, 0.25);
        const layout = layoutMachiBoardLine(line, BOX, measure);
        const before = resolveMachiBoardReveal(layout, 19);
        before.forEach((x, index) => expect(x).toBeCloseTo(layout.rows[index]!.glyphs[0]!.x0));
        const after = resolveMachiBoardReveal(layout, 40);
        after.forEach((x, index) => expect(x).toBeCloseTo(layout.rows[index]!.glyphs.at(-1)!.x1));
        let previous = resolveMachiBoardReveal(layout, 20);
        for (let t = 20; t < 23.2; t += 0.05) {
            const current = resolveMachiBoardReveal(layout, t);
            current.forEach((x, index) => expect(x).toBeGreaterThanOrEqual(previous[index]! - 1e-6));
            previous = current;
        }
    });

    it('sweeps through a character during its own time', () => {
        const line = cjkLine('晚安', 0, 1);
        const layout = layoutMachiBoardLine(line, BOX, measure);
        const [first] = layout.rows[0]!.glyphs;
        const halfway = resolveMachiBoardReveal(layout, 0.5)[0]!;
        expect(halfway).toBeCloseTo((first!.x0 + first!.x1) / 2, 3);
    });

    it('keeps later rows dark while the first row is being sung', () => {
        const layout = layoutMachiBoardLine(cjkLine('我听见远方的海潮一遍一遍拍打着沉默的礁石和那座早已熄灭多年的灯塔', 0, 0.2), BOX, measure);
        const reveal = resolveMachiBoardReveal(layout, 0.5);
        expect(reveal[1]).toBeCloseTo(layout.rows[1]!.glyphs[0]!.x0);
    });
});

describe('layoutMachiBoardCard', () => {
    it('lays out a fully lit title with a smaller subtitle', () => {
        const card = layoutMachiBoardCard('♪ Lantern Tide', 'Probe Ensemble', BOX, measure);
        expect(card.rows).toHaveLength(2);
        expect(card.rows[1]!.fontPx).toBeLessThan(card.rows[0]!.fontPx);
        resolveMachiBoardReveal(card, 0).forEach((x, index) => expect(x).toBeCloseTo(card.rows[index]!.glyphs[0]!.x1));
    });
});
