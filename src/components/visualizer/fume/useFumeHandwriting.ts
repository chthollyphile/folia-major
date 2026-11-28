import { useEffect, useMemo } from 'react';
import type { Theme } from '../../../types';
import { fontStrokesKeyOf, getFontStrokes, normalizeFontStrokesWeight, registerFontStrokesConsumer } from '../../../services/fontStrokes';
import type { FumeHandwritingFrame } from './fumeHandwriting';
import { resolveFumeFontWeight } from './fumeTextMeasure';
import type { FumeArticleLayout } from './fumeTypes';

// src/components/visualizer/fume/useFumeHandwriting.ts
// 浮名「手写笔画」和笔画服务（services/fontStrokes）的接线：开着时向服务登记当前字体在每个显示字重下的键
// （大字、正文字重不同就是两个键，各报各自那几句的字），画的时候按这句字的字重同步查笔画。
// 算哪些字、什么时候算、存哪都归服务里的预备服务。关着时什么都不做（不登记，服务就不算、不下载模型）。
// 不订阅新结果：舞台播放时每帧都在画，新到的字下一帧自然查得到；暂停时没有字会因为新结果改画法（冻结规则在第一次看到字时就定了）。

export const useFumeHandwriting = (
    enabled: boolean,
    article: FumeArticleLayout | null,
    theme: Theme,
): FumeHandwritingFrame | null => {
    const heroWeight = normalizeFontStrokesWeight(resolveFumeFontWeight('hero', theme));
    const bodyWeight = normalizeFontStrokesWeight(resolveFumeFontWeight('body', theme));
    const heroKey = fontStrokesKeyOf(theme, heroWeight);
    const bodyKey = fontStrokesKeyOf(theme, bodyWeight);

    // 本篇要写的字按字重分开报给服务（主题定了字重时两种字重相同，只有一个键）：预览、试玩台这类不跟播放走的文本也能拿到笔画
    const registrations = useMemo(() => {
        const charsOf = new Map<string, string>([[heroKey, ''], [bodyKey, '']]);
        if (enabled && article) {
            for (const block of article.blocks) {
                const key = block.variant === 'hero' ? heroKey : bodyKey;
                charsOf.set(key, (charsOf.get(key) ?? '') + block.graphemes.join(''));
            }
        }
        return [...charsOf].map(([fontKey, chars]) => ({ fontKey, chars }));
    }, [article, bodyKey, enabled, heroKey]);

    useEffect(() => {
        if (!enabled) return undefined;
        const releases = registrations.map(registration => registerFontStrokesConsumer(registration));
        return () => { for (const release of releases) release(); };
    }, [enabled, registrations]);

    return useMemo<FumeHandwritingFrame | null>(() => {
        if (!enabled || !article) return null;
        // 键按归一后的字重查：drawFumeLiveBlock 传的是 resolveFumeFontWeight 的原值
        const keyOf = (weight: number) => {
            const w = normalizeFontStrokesWeight(weight);
            return w === heroWeight ? heroKey : w === bodyWeight ? bodyKey : null;
        };
        return {
            getStrokes: (ch, weight) => {
                const key = keyOf(weight);
                return key ? getFontStrokes(key, ch) : null;
            },
            // 换歌 / 换字体 / 重排都换一张：冻结的决定不跨文章
            decisions: new Map<string, boolean>(),
        };
    }, [article, bodyKey, bodyWeight, enabled, heroKey, heroWeight]);
};
