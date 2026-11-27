import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { buildFontStrokesDemand, lineIndexAt } from '../../../../src/services/fontStrokes/fontStrokesDemand';
import { fontLabelOfKey, fontStackOfKey, fontStrokesKeyOf, STROKES_MODEL_REV } from '../../../../src/services/fontStrokes/fontStrokesKey';
import { BUILTIN_FONT_STACKS, resolveThemeFontStack } from '../../../../src/utils/fontStacks';

// test/unit/services/fontStrokes/fontStrokesDemand.test.ts
// 需求顺序（near / rest / background）、播放位置所在的句、字体键。

describe('lineIndexAt', () => {
    it('取最后一句 startTime ≤ t 的', () => {
        const starts = [1, 5, 9];
        expect(lineIndexAt(starts, 0)).toBe(0);
        expect(lineIndexAt(starts, 5)).toBe(1);
        expect(lineIndexAt(starts, 8.9)).toBe(1);
        expect(lineIndexAt(starts, 100)).toBe(2);
        expect(lineIndexAt([], 3)).toBe(-1);
    });
});

describe('buildFontStrokesDemand', () => {
    const lines = ['一二三', '四五六', '七八九', '十永口', '人山日', '月木火'];
    it('近处 4 句在前，其余先往后再回到开头，下一首最后；组间不重复，非模型字过滤', () => {
        const d = buildFontStrokesDemand(lines, 2, [['永abc！鬱', 'あ']], 2);
        expect(d.near.join('')).toBe('七八九十永口');
        expect(d.rest.join('')).toBe('人山日月木火一二三四五六');
        expect(d.background.join('')).toBe('鬱あ');
    });
    it('没有歌词、位置在歌词之前时不崩', () => {
        expect(buildFontStrokesDemand([], -1, [])).toEqual({ near: [], rest: [], background: [] });
        expect(buildFontStrokesDemand(['永'], -1, []).near).toEqual(['永']);
    });
});

describe('fontStrokesKey', () => {
    it('字体键：内置 / 上传 / 自定义，能反推出和 resolveThemeFontStack 一样的字体栈', () => {
        expect(fontStrokesKeyOf({ fontStyle: 'serif' })).toMatch(/\|b:serif$/);
        expect(fontStackOfKey(fontStrokesKeyOf({ fontStyle: 'serif' }))).toBe(BUILTIN_FONT_STACKS.serif);
        const themes = [
            { fontStyle: 'sans' as const, fontFamily: 'FoliaUploadedLyricsFont_123_abc' },
            { fontStyle: 'mono' as const, fontFamily: '"PingFang SC"', fontFamilyStack: ['Hiragino Sans', 'a,b/c+d"e'] },
            { fontStyle: 'serif' as const, fontFamilyStack: ['Songti SC'] },
        ];
        for (const theme of themes) expect(fontStackOfKey(fontStrokesKeyOf(theme))).toBe(resolveThemeFontStack(theme));
        expect(fontStrokesKeyOf(themes[0])).toMatch(/\|u:123_abc\/sans$/);
    });
    it('回退字体不同，键不同；认不出的键返回 null', () => {
        const a = fontStrokesKeyOf({ fontStyle: 'sans', fontFamily: 'X' });
        expect(a).not.toBe(fontStrokesKeyOf({ fontStyle: 'serif', fontFamily: 'X' }));
        expect(a).not.toBe(fontStrokesKeyOf({ fontStyle: 'sans', fontFamily: 'X', fontFamilyStack: ['Y'] }));
        expect(fontStackOfKey('other-version|c:x/sans')).toBeNull();
        expect(fontStackOfKey(a.replace('/sans', '/nope'))).toBeNull();
        expect(fontLabelOfKey(a)).toBe('X');
    });
    it('模型版本号和下载脚本钉的 HuggingFace 提交一致', () => {
        const cjs = readFileSync('electron/analysis/strokesModelFetch.cjs', 'utf8');
        const rev = /HF_REVISION = '([0-9a-f]{40})'/.exec(cjs)?.[1];
        expect(rev?.startsWith(STROKES_MODEL_REV)).toBe(true);
    });
});
