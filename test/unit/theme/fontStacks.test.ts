import { describe, expect, it } from 'vitest';
import { resolveThemeFontStack, resolveThemeTranslationFontStack } from '@/utils/fontStacks';
import type { Theme } from '@/types';

describe('fontStacks', () => {
    it('returns the built-in stack when no custom font is provided', () => {
        const theme: Pick<Theme, 'fontStyle' | 'fontFamily'> = {
            fontStyle: 'serif',
        };

        const stack = resolveThemeFontStack(theme);

        expect(stack).toContain('"Iowan Old Style"');
        expect(stack).toContain('"SimSun"');
        expect(stack).toContain('"Yu Mincho"');
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

    it('keeps translation text on the built-in stack even when a custom font is selected', () => {
        const theme: Pick<Theme, 'fontStyle' | 'fontFamily'> = {
            fontStyle: 'sans',
            fontFamily: 'SF Pro Display',
        };

        const stack = resolveThemeTranslationFontStack(theme);

        expect(stack.startsWith('"Inter"')).toBe(true);
        expect(stack).not.toContain('SF Pro Display');
        expect(stack).toContain('"Microsoft YaHei"');
    });
});
