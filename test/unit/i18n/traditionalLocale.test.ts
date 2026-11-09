import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en';
import zhCN from '@/i18n/locales/zh-CN';
import zhTW from 'virtual:folia-locale-zh-TW';
import ind from '@/i18n/locales/in';
import vi from '@/i18n/locales/vi';
import {
    countOverrideHits,
    toTaiwanRaw,
    toTaiwanTraditional,
} from '../../../dev/i18n/localeTextRewrite.mjs';
import { TRADITIONAL_TERM_OVERRIDES } from '../../../dev/i18n/traditionalTerms.mjs';

// test/unit/i18n/traditionalLocale.test.ts
// zh-TW 是 dev/i18n/traditionalLocalePlugin.mjs 在构建期从 zh-CN.ts 转换出来的虚拟模块，
// 这里守住三件事：结构必须与 zh-CN 完全一致、每条文案都真的转过了、
// 补词表里不能有死规则。任何一条失守都意味着「繁中界面有地方会退回英文或简体」。

type Bundle = Record<string, unknown>;

/** 把嵌套 locale 展平成 `a.b.c` -> 值，数组按索引展开。 */
const flatten = (node: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
        for (const [key, value] of Object.entries(node as Bundle)) {
            flatten(value, prefix ? `${prefix}.${key}` : key, out);
        }
        return out;
    }
    if (Array.isArray(node)) {
        node.forEach((value, index) => flatten(value, `${prefix}.${index}`, out));
        return out;
    }
    out[prefix] = node;
    return out;
};

const flatZH = flatten(zhCN);
const flatTW = flatten(zhTW);
const zhTWValues = Object.values(flatTW).filter((value): value is string => typeof value === 'string');

describe('zh-TW locale structure', () => {
    it('与 zh-CN 的 key 集合完全一致', () => {
        expect(Object.keys(flatTW).sort()).toEqual(Object.keys(flatZH).sort());
    });

    it('每个值都是字符串，没有漏转成对象或数组', () => {
        const nonStrings = Object.entries(flatTW).filter(([, value]) => typeof value !== 'string');
        expect(nonStrings).toEqual([]);
    });

    it('插值占位符与 zh-CN 逐条对应', () => {
        const placeholders = (value: string) => (value.match(/\{\{[^}]+\}\}/g) ?? []).sort();
        const mismatched = Object.keys(flatZH).filter(key => (
            JSON.stringify(placeholders(String(flatZH[key])))
            !== JSON.stringify(placeholders(String(flatTW[key])))
        ));
        expect(mismatched, `占位符不一致：${mismatched.slice(0, 20).join(', ')}`).toEqual([]);
    });

    it('没有残留的简体专用字形', () => {
        // 这些字在繁体中文里都有对应的繁体字，出现即说明某条文案漏转。
        const simplifiedOnly = /[为这来说时国东门马鸟见贝车书长开关语应题让种样绝对级别单双击务员实现运]/;
        const leftovers = Object.entries(flatTW)
            .filter(([, value]) => simplifiedOnly.test(String(value)))
            .map(([key]) => key);
        expect(leftovers, `疑似漏转：${leftovers.slice(0, 20).join(', ')}`).toEqual([]);
    });

    it('补词表里的源词在繁中文案里一个不剩', () => {
        // 补词表按长度降序应用，所以某条规则的源词还出现在文案里，只可能是
        // 被更长的重叠规则吃掉、或规则形状写错了（键必须是 twp 转换后的写法）。
        const surviving = TRADITIONAL_TERM_OVERRIDES
            .map(([from]) => from)
            .filter(from => zhTWValues.some(value => value.includes(from)));
        expect(surviving, `这些词仍出现在繁中文案里：${surviving.join(', ')}`).toEqual([]);
    });
});

describe('zh-TW virtual module', () => {
    it('每条文案都等于 toTaiwanTraditional(zh-CN 的对应值)', () => {
        // 插件只换它找到的字符串字面量；哪条值没被找到，就会原样留成简体，在这里对不上。
        const missed = Object.keys(flatZH).filter(key => {
            const expected = toTaiwanTraditional(String(flatZH[key]));
            return expected !== flatTW[key];
        });
        expect(
            missed,
            'dev/i18n/traditionalLocalePlugin.mjs 没有转换这些文案：'
            + missed.slice(0, 20).join(', '),
        ).toEqual([]);
    });
});

describe('traditional term overrides', () => {
    it('每条规则都在 zh-CN 语料里真实命中，没有死规则', () => {
        const corpus = Object.values(flatZH).map(String);
        const hits = countOverrideHits(corpus);
        const dead = TRADITIONAL_TERM_OVERRIDES
            .map(([from]) => from)
            .filter(from => !hits.has(from));
        expect(
            dead,
            'dev/i18n/traditionalTerms.mjs 里的这些规则在 zh-CN.ts 上一条都命中不到，'
            + '要么文案改了，要么规则写错了形状（键必须是 twp 输出后的写法）：'
            + dead.join(', '),
        ).toEqual([]);
    });

    it('规则不会互相吃掉：按长度降序应用后结果稳定', () => {
        // 「列表 → 清單」不该影响已经含「清單」的文本，重复跑也不该继续变形。
        const once = toTaiwanTraditional('播放列表与曲目列表');
        expect(once).toBe('播放清單與曲目清單');
        expect(toTaiwanTraditional(once)).toBe(once);
    });

    it('纯 ASCII 文案原样通过，不会被词表碰到', () => {
        for (const text of ['Folia', 'Now Playing', 'Sync Server', 'v{{version}}', '']) {
            expect(toTaiwanTraditional(text)).toBe(text);
        }
    });

    it('保留 twp 不做处理的原始输出，供上面死规则断言对照', () => {
        expect(toTaiwanRaw('简体中文')).toBe('簡體中文');
    });
});

describe('locale language names', () => {
    // 语言下拉里的名字必须在每份 locale 里都存在，否则选择器会显示 key 本身。
    it.each(Object.entries({ en, 'zh-CN': zhCN, 'zh-TW': zhTW, in: ind, vi }))(
        '%s 定义了全部语言名',
        (_name, bundle) => {
            const options = (bundle as Bundle).options as Record<string, unknown>;
            for (const key of ['appLanguageZhCN', 'appLanguageZhTW', 'appLanguageEnUS', 'appLanguageInID', 'appLanguageViVN']) {
                expect(options?.[key], `options.${key}`).toBeTruthy();
            }
        },
    );

    it('繁中里「简体中文」这个名字本身是繁体', () => {
        expect((zhTW as Bundle).options).toMatchObject({
            appLanguageZhCN: '簡體中文',
            appLanguageZhTW: '繁體中文',
        });
    });
});
