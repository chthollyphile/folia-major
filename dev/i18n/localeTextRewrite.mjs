// dev/i18n/localeTextRewrite.mjs
// 把一份简体 locale 文案转成繁体中文（台湾惯用词）。
//
// 两步：先过 OpenCC 的 cn→twp 预设做通用转换，再套一层的后置补词表补 twp 漏掉的词。
// 后置词表的**键是 twp 转换之后的形状**，不是简体原文——这样词表里每一条都能被程序
// 验证「它确实在 twp 输出里出现过」，不会留下永不命中的死规则。
//
// 依赖 opencc-js，仓库已有（src/utils/lyrics/matchScore.ts 用它做简繁归一化），
// 所以加繁中支持不需要任何新依赖。

import * as OpenCC from 'opencc-js';
import { TRADITIONAL_TERM_OVERRIDES } from './traditionalTerms.mjs';

/** cn → twp（繁体中文 + 台湾惯用词）。模块级建一次，转换是纯函数。 */
const toTaiwan = OpenCC.Converter({ from: 'cn', to: 'twp' });

/**
 * 后置词表按长度降序排一次。中文没有词边界，只能靠「长的先替换」来避免
 * 「清單」的短规则先把「播放清單」吃掉一半这类重叠。
 */
const ORDERED_OVERRIDES = [...TRADITIONAL_TERM_OVERRIDES]
    .sort((a, b) => b[0].length - a[0].length);

/**
 * 套用后置补词表。输入必须是 twp 的输出（表里的键就是这个形状）。
 * 纯字符串替换，不碰 ASCII——表里只有 CJK。
 */
export const applyTermOverrides = (text) => {
    let result = text;
    for (const [from, to] of ORDERED_OVERRIDES) {
        if (result.includes(from)) {
            result = result.split(from).join(to);
        }
    }
    return result;
};

/** 一段简体文案 → 繁体中文文案。这是整条流水线的唯一入口。 */
export const toTaiwanTraditional = (text) => applyTermOverrides(toTaiwan(text));

/** twp 的输出，不经补词表。仅供测试对照「这条规则到底改了 twp 的什么」。 */
export { toTaiwan as toTaiwanRaw };

/** 词表里每条规则在给定文本集合上命中的次数，供测试与生成脚本自查。 */
export const countOverrideHits = (texts) => {
    const hits = new Map();
    for (const text of texts) {
        const converted = toTaiwan(text);
        for (const [from] of TRADITIONAL_TERM_OVERRIDES) {
            let index = converted.indexOf(from);
            while (index !== -1) {
                hits.set(from, (hits.get(from) ?? 0) + 1);
                index = converted.indexOf(from, index + from.length);
            }
        }
    }
    return hits;
};
