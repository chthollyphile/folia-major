import { toTaiwanTraditional } from '../i18n/localeTextRewrite.mjs';
// dev/sources/locales.mjs
// 音源模组语言表的繁体：由 zh-CN.json 生成 zh-TW.json，只换字符串值，键与结构原样。转换和宿主自己的繁中
// （dev/i18n/traditionalLocalePlugin.mjs）是同一条（localeTextRewrite.mjs 的 toTaiwanTraditional）。
// 构建脚本（build.mjs）和单测夹具（test/unit/helpers/builtinSources.ts）都用它，测试里看到的就是运行时的。

/** 一份简体语言表（解析过的 JSON）→ 繁体。 */
export const toTraditionalLocale = (value) => {
    if (typeof value === 'string') return toTaiwanTraditional(value);
    if (Array.isArray(value)) return value.map(toTraditionalLocale);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toTraditionalLocale(child)]));
    return value;
};
