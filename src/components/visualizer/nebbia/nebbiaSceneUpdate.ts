import type { NebbiaSourceLine } from './nebbiaChars';
import { dressChar, finishNebbiaScene, type LaidLine } from './nebbiaScene';
import type { NebbiaGlyphCache } from './nebbiaGlyphs';
import type { NebbiaTuning } from './types';

// src/components/visualizer/nebbia/nebbiaSceneUpdate.ts
// 字体笔画晚到时只换几句的字形，不重排整首：字的位置只由歌词和屏幕尺寸决定，换字形只影响这几句自己的水珠、书写节奏，
// 和整首收尾里依赖字形的让位、哈气（finishNebbiaScene，对全部句子重跑一遍，没换字形的句子得到同样的值）。

/** 第 lines 句的字用 glyphs 现在给的字形重配（随机量同整首排版），再收尾一次。 */
export const swapLineGlyphs = (
    laid: LaidLine[], source: NebbiaSourceLine[], glyphs: Pick<NebbiaGlyphCache, 'get'>, tuning: NebbiaTuning, seed: string | number, lines: number[],
) => {
    for (const li of lines) {
        const line = laid[li];
        line.chars = line.chars.map((c, i) => {
            const out = { ...c, glyph: null, base: null, beads: [], drips: [], ends: [], appearDur: 0, wt: c.t, wd: 0 };
            dressChar(out, glyphs.get(c.ch), li, i, tuning.warp);
            return out;
        });
        // 抹除的几何和哈气的白气都是按旧字形建的：作废，第一次用到时重建
        line.wipe = undefined;
        line.breath = undefined;
    }
    if (lines.length) finishNebbiaScene(laid, source, tuning, seed);
};
