import type { Theme } from '../types';

const SUGAR_SERIF_FAMILY = '"獅尾四季春加糖SC"';

export const BUILTIN_FONT_STACKS: Record<Theme['fontStyle'], string> = {
    sans: '"Inter", "Noto Sans CJK SC", "Noto Sans JP", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    serif: `${SUGAR_SERIF_FAMILY}, "Iowan Old Style", "Noto Serif CJK SC", "Noto Serif JP", "Source Han Serif SC", "Songti SC", "STSong", "Georgia", serif`,
    mono: '"IBM Plex Mono", "Sarasa Mono SC", "Noto Sans Mono CJK SC", "Noto Sans Mono", "SFMono-Regular", Consolas, monospace',
};

const TRANSLATION_FONT_STACKS: Record<Theme['fontStyle'], string> = {
    sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Helvetica Neue", Arial, "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans JP", "Source Han Sans JP", "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif',
    serif: `${SUGAR_SERIF_FAMILY}, "Folia Noto Serif SC", "Iowan Old Style", Georgia, "Times New Roman", "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", "Noto Serif JP", "Source Han Serif JP", "Yu Mincho", "MS PMincho", serif`,
    mono: 'Consolas, "IBM Plex Mono", "SFMono-Regular", Menlo, Monaco, "Sarasa Mono SC", "Noto Sans Mono CJK SC", "SimHei", "DengXian", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans Mono CJK JP", "MS Gothic", monospace',
};

const quoteFontFamily = (fontFamily: string) => `"${fontFamily.replace(/["\\]/g, '\\$&')}"`;

export const getBuiltinThemeFontStack = (fontStyle: Theme['fontStyle']) => {
    return BUILTIN_FONT_STACKS[fontStyle] ?? BUILTIN_FONT_STACKS.sans;
};

export const resolveThemeFontStack = (theme: Pick<Theme, 'fontStyle' | 'fontFamily'>) => {
    const fallbackStack = getBuiltinThemeFontStack(theme.fontStyle);
    const customFontFamily = theme.fontFamily?.trim();

    if (!customFontFamily) {
        return fallbackStack;
    }

    return `${quoteFontFamily(customFontFamily)}, ${fallbackStack}`;
};

export const resolveThemeTranslationFontStack = (theme: Pick<Theme, 'fontStyle' | 'fontFamily'>) => {
    const fallbackStack = TRANSLATION_FONT_STACKS[theme.fontStyle] ?? TRANSLATION_FONT_STACKS.sans;
    const customFontFamily = theme.fontFamily?.trim();

    if (!customFontFamily) {
        return fallbackStack;
    }

    return `${quoteFontFamily(customFontFamily)}, ${fallbackStack}`;
};
