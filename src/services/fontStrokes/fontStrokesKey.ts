import type { Theme } from '../../types';
import { BUILTIN_FONT_STACKS } from '../../utils/fontStacks';

// src/services/fontStrokes/fontStrokesKey.ts
// 字体键：笔画结果按「模型版本 + 格式版本 + 字体」存一份（不分字重、不用指纹）。
// 字体 = 上传字体的存储 id（u:）/ 自定义系统字体的族名（c:）/ 内置样式名（b:sans|serif|mono）；
// 键能反推出画字用的 CSS 字体栈（fontStackOfKey），所以登记使用方时只传键。

/** 推理模型的版本：electron/analysis/strokesModelFetch.cjs 里 HF_REVISION 的前 8 位（单测核对两边一致）。 */
export const STROKES_MODEL_REV = '59909ddd';
/** 存盘格式的版本：编码、轮廓算法、延伸半径任何一项变了都要加一，旧数据不再命中、后台重算。 */
export const FONT_STROKES_FORMAT = 1;

/** 上传字体注册时用的族名前缀（services/customLyricsFont.ts）。 */
const UPLOADED_FAMILY_PREFIX = 'FoliaUploadedLyricsFont_';
const KEY_PREFIX = `m${STROKES_MODEL_REV}|f${FONT_STROKES_FORMAT}|`;

/** 主题 → 字体键：上传字体看族名前缀，自定义族名取第一个，否则按内置样式。 */
export const fontStrokesKeyOf = (theme: Pick<Theme, 'fontStyle' | 'fontFamily'>): string => {
    const family = theme.fontFamily?.trim().replace(/^['"]|['"]$/g, '').trim();
    if (family?.startsWith(UPLOADED_FAMILY_PREFIX)) return `${KEY_PREFIX}u:${family.slice(UPLOADED_FAMILY_PREFIX.length)}`;
    if (family) return `${KEY_PREFIX}c:${family}`;
    return `${KEY_PREFIX}b:${theme.fontStyle in BUILTIN_FONT_STACKS ? theme.fontStyle : 'sans'}`;
};

/** 字体键里的字体部分；不是本版本的键时 null。 */
export const fontPartOfKey = (key: string): string | null => (key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : null);

/** 字体键 → 光栅化用的 CSS 字体栈（自定义字体后面接内置无衬线栈，同主题的写法）；认不出时 null。 */
export const fontStackOfKey = (key: string): string | null => {
    const part = fontPartOfKey(key);
    if (!part) return null;
    const quote = (family: string) => `"${family.replace(/["\\]/g, '\\$&')}"`;
    if (part.startsWith('u:')) return `${quote(UPLOADED_FAMILY_PREFIX + part.slice(2))}, ${BUILTIN_FONT_STACKS.sans}`;
    if (part.startsWith('c:')) return `${quote(part.slice(2))}, ${BUILTIN_FONT_STACKS.sans}`;
    if (part.startsWith('b:')) {
        const style = part.slice(2);
        return style in BUILTIN_FONT_STACKS ? BUILTIN_FONT_STACKS[style as Theme['fontStyle']] : null;
    }
    return null;
};

/** 给人看的字体名（fonts 表的 label、缓存管理）。 */
export const fontLabelOfKey = (key: string): string => {
    const part = fontPartOfKey(key) ?? key;
    return part.startsWith('u:') ? `上传字体 ${part.slice(2)}` : part.slice(2);
};
