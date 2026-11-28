import type { Theme } from '../../types';
import { BUILTIN_FONT_STACKS, normalizeFontFamilyStack } from '../../utils/fontStacks';

// src/services/fontStrokes/fontStrokesKey.ts
// 字体键：笔画结果按「模型版本 + 格式版本 + 字体 + 字重」存一份（按显示字重推理、各存一份；不用指纹）。
// 字体 = 画字时用的字体列表：上传字体的存储 id（u:）/ 自定义系统字体的族名（c:）+ 兜底的内置样式（sans|serif|mono），
// 没有自定义字体时只有内置样式（b:）。字重 = 显示字重取整、夹到 100..900（只有一个字重的字体照样按这个字重存：画出来的是 Chromium 合成粗体）。
// 键形如 `m<rev>|f<格式>|<字体>|w<字重>`，能反推出画字用的 CSS 字体栈（fontStackOfKey）和字重（fontWeightOfKey），所以登记使用方时只传键。

/** 推理模型的版本：electron/analysis/strokesModelFetch.cjs 里 HF_REVISION 的前 8 位（单测核对两边一致）。 */
export const STROKES_MODEL_REV = '59909ddd';
/**
 * 存盘格式的版本：编码、轮廓算法、延伸半径任何一项变了都要加一，旧数据不再命中、后台重算。2：轮廓改存 400 的笔身（不再往墨外延伸 0.06 em）。
 * 3：按显示字重推理（键带字重），轮廓是那个字重的 own2 归属只往外延伸一点（盖住抗锯齿）。
 */
export const FONT_STROKES_FORMAT = 3;

/** 上传字体注册时用的族名前缀（services/customLyricsFont.ts）。 */
const UPLOADED_FAMILY_PREFIX = 'FoliaUploadedLyricsFont_';
const KEY_PREFIX = `m${STROKES_MODEL_REV}|f${FONT_STROKES_FORMAT}|`;
/** 键末尾的字重段。 */
const WEIGHT_SEP = '|w';
/** 没给字重时（不该发生）按这个算。 */
const DEFAULT_WEIGHT = 400;

/** 字重 → 键里的字重：取整、夹到 100..900（不按 100 取整：浮名的 640 / 780 要原样留着）。 */
export const normalizeFontStrokesWeight = (weight: number): number => (
    Number.isFinite(weight) ? Math.min(900, Math.max(100, Math.round(weight))) : DEFAULT_WEIGHT
);

/**
 * 主题 + 显示字重 → 字体键。字体部分 = 画字时实际用的字体列表（自定义族名 / 上传字体的存储 id，各自 URL 编码、逗号隔开）+ 兜底的内置样式：
 * `u:<id>,c:<族名>/sans`；没有自定义字体时 `b:sans`。和 resolveThemeFontStack 用的字体一一对应，所以缺字时回退到哪个字体
 * （主题里的备用族、内置栈）也是键的一部分——回退字体不同，同一个字的笔画就不同。
 * weight 是这份笔画要画的字重（各样式自己的显示字重），见 normalizeFontStrokesWeight。
 */
export const fontStrokesKeyOf = (theme: Pick<Theme, 'fontStyle' | 'fontFamily' | 'fontFamilyStack'>, weight: number): string => {
    const style = theme.fontStyle in BUILTIN_FONT_STACKS ? theme.fontStyle : 'sans';
    const families = normalizeFontFamilyStack([theme.fontFamily, ...(theme.fontFamilyStack ?? [])]);
    const suffix = `${WEIGHT_SEP}${normalizeFontStrokesWeight(weight)}`;
    if (!families.length) return `${KEY_PREFIX}b:${style}${suffix}`;
    const parts = families.map(family => (family.startsWith(UPLOADED_FAMILY_PREFIX)
        ? `u:${encodeURIComponent(family.slice(UPLOADED_FAMILY_PREFIX.length))}`
        : `c:${encodeURIComponent(family)}`));
    return `${KEY_PREFIX}${parts.join(',')}/${style}${suffix}`;
};

/** 拆开本版本的键：字体部分和字重；不是本版本的键、字重段不对时 null。族名都 URL 编码过，不含 `|`，所以从最后一个 `|w` 切。 */
const splitKey = (key: string): { part: string; weight: number } | null => {
    if (!key.startsWith(KEY_PREFIX)) return null;
    const rest = key.slice(KEY_PREFIX.length);
    const at = rest.lastIndexOf(WEIGHT_SEP);
    if (at < 0) return null;
    const digits = rest.slice(at + WEIGHT_SEP.length);
    if (!/^\d{3}$/.test(digits)) return null;
    const weight = Number(digits);
    if (weight !== normalizeFontStrokesWeight(weight)) return null;
    return { part: rest.slice(0, at), weight };
};

/** 字体键里的字体部分（不含字重）；不是本版本的键时 null。 */
export const fontPartOfKey = (key: string): string | null => splitKey(key)?.part ?? null;

/** 字体键里的字重（推理、光栅化都按它）；不是本版本的键时 null。 */
export const fontWeightOfKey = (key: string): number | null => splitKey(key)?.weight ?? null;

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

/** 给人看的字体名（fonts 表的 label）：第一个自定义字体，或内置样式名，后面跟字重（如 `PingFang SC 640`）。 */
export const fontLabelOfKey = (key: string): string => {
    const split = splitKey(key);
    if (!split) return key;
    const { part, weight } = split;
    if (part.startsWith('b:')) return `${part.slice(2)} ${weight}`;
    const first = part.split('/')[0].split(',')[0];
    try { return `${first.startsWith('u:') ? 'uploaded ' : ''}${decodeURIComponent(first.slice(2))} ${weight}`; } catch { return `${part} ${weight}`; }
};
