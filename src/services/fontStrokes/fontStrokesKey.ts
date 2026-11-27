import type { Theme } from '../../types';
import { BUILTIN_FONT_STACKS, normalizeFontFamilyStack } from '../../utils/fontStacks';

// src/services/fontStrokes/fontStrokesKey.ts
// 字体键：笔画结果按「模型版本 + 格式版本 + 字体」存一份（不分字重、不用指纹）。
// 字体 = 画字时用的字体列表：上传字体的存储 id（u:）/ 自定义系统字体的族名（c:）+ 兜底的内置样式（sans|serif|mono），
// 没有自定义字体时只有内置样式（b:）。键能反推出画字用的 CSS 字体栈（fontStackOfKey），所以登记使用方时只传键。

/** 推理模型的版本：electron/analysis/strokesModelFetch.cjs 里 HF_REVISION 的前 8 位（单测核对两边一致）。 */
export const STROKES_MODEL_REV = '59909ddd';
/** 存盘格式的版本：编码、轮廓算法、延伸半径任何一项变了都要加一，旧数据不再命中、后台重算。 */
export const FONT_STROKES_FORMAT = 1;

/** 上传字体注册时用的族名前缀（services/customLyricsFont.ts）。 */
const UPLOADED_FAMILY_PREFIX = 'FoliaUploadedLyricsFont_';
const KEY_PREFIX = `m${STROKES_MODEL_REV}|f${FONT_STROKES_FORMAT}|`;

/**
 * 主题 → 字体键。字体部分 = 画字时实际用的字体列表（自定义族名 / 上传字体的存储 id，各自 URL 编码、逗号隔开）+ 兜底的内置样式：
 * `u:<id>,c:<族名>/sans`；没有自定义字体时 `b:sans`。和 resolveThemeFontStack 用的字体一一对应，所以缺字时回退到哪个字体
 * （主题里的备用族、内置栈）也是键的一部分——回退字体不同，同一个字的笔画就不同。
 */
export const fontStrokesKeyOf = (theme: Pick<Theme, 'fontStyle' | 'fontFamily' | 'fontFamilyStack'>): string => {
    const style = theme.fontStyle in BUILTIN_FONT_STACKS ? theme.fontStyle : 'sans';
    const families = normalizeFontFamilyStack([theme.fontFamily, ...(theme.fontFamilyStack ?? [])]);
    if (!families.length) return `${KEY_PREFIX}b:${style}`;
    const parts = families.map(family => (family.startsWith(UPLOADED_FAMILY_PREFIX)
        ? `u:${encodeURIComponent(family.slice(UPLOADED_FAMILY_PREFIX.length))}`
        : `c:${encodeURIComponent(family)}`));
    return `${KEY_PREFIX}${parts.join(',')}/${style}`;
};

/** 字体键里的字体部分；不是本版本的键时 null。 */
export const fontPartOfKey = (key: string): string | null => (key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : null);

/** 字体键 → 光栅化用的 CSS 字体栈（同 resolveThemeFontStack：自定义字体在前，后面接内置栈）；认不出时 null。 */
export const fontStackOfKey = (key: string): string | null => {
    const part = fontPartOfKey(key);
    if (!part) return null;
    if (part.startsWith('b:')) {
        const style = part.slice(2);
        return style in BUILTIN_FONT_STACKS ? BUILTIN_FONT_STACKS[style as Theme['fontStyle']] : null;
    }
    const slash = part.lastIndexOf('/');
    const style = part.slice(slash + 1);
    if (slash < 0 || !(style in BUILTIN_FONT_STACKS)) return null;
    const quote = (family: string) => `"${family.replace(/["\\]/g, '\\$&')}"`;
    try {
        const families = part.slice(0, slash).split(',').map(piece => {
            const name = decodeURIComponent(piece.slice(2));
            if (piece.startsWith('u:')) return quote(UPLOADED_FAMILY_PREFIX + name);
            if (piece.startsWith('c:')) return quote(name);
            throw new Error('unknown family kind');
        });
        return `${families.join(', ')}, ${BUILTIN_FONT_STACKS[style as Theme['fontStyle']]}`;
    } catch {
        return null;
    }
};

/** 给人看的字体名（fonts 表的 label）：第一个自定义字体，或内置样式名。 */
export const fontLabelOfKey = (key: string): string => {
    const part = fontPartOfKey(key) ?? key;
    if (part.startsWith('b:')) return part.slice(2);
    const first = part.split('/')[0].split(',')[0];
    try { return `${first.startsWith('u:') ? 'uploaded ' : ''}${decodeURIComponent(first.slice(2))}`; } catch { return part; }
};
