import { describe, expect, it } from 'vitest';
import { resolveThemeFontStack, resolveThemeTranslationFontStack } from '@/utils/fontStacks';
import type { Theme } from '@/types';

describe('fontStacks', () => {
    it('returns the built-in stack when no custom font is provided', () => {
        const theme: Pick<Theme, 'fontStyle' | 'fontFamily'> = {
            fontStyle: 'serif',
        };

        const stack = resolveThemeFontStack(theme);

        expect(stack.startsWith('"獅尾四季春加糖SC-Regular"')).toBe(true);
        expect(stack).toContain('"Iowan Old Style"');
        expect(stack).toContain('serif');
    });

    it('prepends the selected custom font family before the built-in fallback stack', () => {
        const theme: Pick<Theme, 'fontStyle' | 'fontFamily'> = {
            fontStyle: 'sans',
            fontFamily: 'FZKai-Z03',
        };

        const stack = resolveThemeFontStack(theme);

        expect(stack.startsWith('"FZKai-Z03",')).toBe(true);
        expect(stack).toContain('"Inter"');
        expect(stack).toContain('sans-serif');
    });

    it('escapes quotes in custom font family names', () => {
        const theme: Pick<Theme, 'fontStyle' | 'fontFamily'> = {
            fontStyle: 'mono',
            fontFamily: 'My "Quoted" Font',
        };

        const stack = resolveThemeFontStack(theme);

        expect(stack).toContain('"My \\"Quoted\\" Font"');
        expect(stack).toContain('monospace');
    });

    it('falls back to built-in stacks when custom font family is blank', () => {
        const theme: Pick<Theme, 'fontStyle' | 'fontFamily'> = {
            fontStyle: 'sans',
            fontFamily: '   ',
        };

        const stack = resolveThemeFontStack(theme);

        expect(stack.startsWith('"Inter"')).toBe(true);
    });

    it('lets translation text try the custom font before using the translation-specific fallback stack', () => {
        const theme: Pick<Theme, 'fontStyle' | 'fontFamily'> = {
            fontStyle: 'serif',
            fontFamily: 'SF Pro Display',
        };

        const stack = resolveThemeTranslationFontStack(theme);

        expect(stack.startsWith('"SF Pro Display",')).toBe(true);
        expect(stack).toContain('"Folia Noto Serif SC"');
        expect(stack).toContain('Georgia');
        expect(stack).toContain('"Times New Roman"');
        expect(stack).toContain('"Noto Serif CJK SC"');
        expect(stack).toContain('"SimSun"');
        expect(stack).toContain('"Yu Mincho"');
        expect(stack).toContain('"MS PMincho"');
    });

    it('prefers Windows-friendly Chinese fallbacks before Japanese mono fonts for translation mono text', () => {
        const theme: Pick<Theme, 'fontStyle' | 'fontFamily'> = {
            fontStyle: 'mono',
        };

        const stack = resolveThemeTranslationFontStack(theme);

        expect(stack).toContain('"Sarasa Mono SC"');
        expect(stack).toContain('"Noto Sans Mono CJK SC"');
        expect(stack).toContain('"DengXian"');
        expect(stack).toContain('"SimHei"');
        expect(stack).toContain('"Microsoft YaHei UI"');
        expect(stack).toContain('"Microsoft YaHei"');
        expect(stack).toContain('"MS Gothic"');
        expect(stack.indexOf('"DengXian"')).toBeLessThan(stack.indexOf('"SimHei"'));
        expect(stack.indexOf('"Microsoft YaHei"')).toBeLessThan(stack.indexOf('"MS Gothic"'));
    });
});
