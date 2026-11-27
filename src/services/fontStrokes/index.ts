import { runStrokesGpu, strokesGpuUnavailable } from '../analysis/beatThisGpu';
import { createPlaybackDemandSource } from './fontStrokesDemand';
import { getStrokeFit, warmStrokeFit, type StrokeFit } from './fontStrokesFit';
import { fontLabelOfKey, fontStackOfKey } from './fontStrokesKey';
import { FontStrokesMemory } from './fontStrokesMemory';
import { buildFontStrokesGlyph, type FontStrokesGlyph } from './fontStrokesOutline';
import { FontStrokesPlanner } from './fontStrokesPlanner';
import { glyphFeatures, INFERENCE_WEIGHT, isModelChar, renderCanon } from './fontStrokesRaster';
import { getFontStrokesStore, onFontStrokesCleared, type FontStrokesUsage } from './fontStrokesStore';
import type { StrokesGpuGlyph } from '../analysis/beatThisGpu';

// src/services/fontStrokes/index.ts
// 字体笔画服务的公共入口（不依赖任何样式）：样式开关开着时 registerFontStrokesConsumer({ fontKey })，
// 画字时同步 getFontStrokes(fontKey, ch)，新结果到了 subscribeFontStrokes 通知。算什么、何时算、存哪都在服务里（fontStrokesPlanner.ts）。
// 真实依赖在这里接：盘（fontStrokesStore）、内存（fontStrokesMemory）、播放状态（fontStrokesDemand）、GPU 推理（beatThisGpu）。

export { fontStrokesKeyOf, fontStackOfKey, fontLabelOfKey } from './fontStrokesKey';
export { isModelChar } from './fontStrokesRaster';
export { EM_UNITS, type FontStrokesGlyph } from './fontStrokesOutline';
export type { FontStrokesUsage } from './fontStrokesStore';
export type { StrokeFit } from './fontStrokesFit';

/** 等字体加载最久多少毫秒。 */
const FONT_WAIT_MS = 4000;

const memory = new FontStrokesMemory();
let planner: FontStrokesPlanner<NonNullable<ReturnType<typeof renderCanon>>, StrokesGpuGlyph> | null = null;

/** 字体还没加载好时 canvas 会拿回退字体画（还按自定义字体的键存盘）：先等 document.fonts 把这些字加载好。 */
const prepareFont = async (family: string, chars: string[]): Promise<boolean> => {
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    if (!fonts) return true;
    const font = `${INFERENCE_WEIGHT} 16px ${family}`;
    const text = chars.join('');
    const check = () => { try { return fonts.check(font, text); } catch { return true; } };
    if (!check()) {
        try { await Promise.race([fonts.load(font, text), new Promise(resolve => setTimeout(resolve, FONT_WAIT_MS))]); } catch { /* 加载失败：下面照 check 处理 */ }
    }
    return check();
};

const getPlanner = () => {
    if (planner) return planner;
    const demand = createPlaybackDemandSource();
    planner = new FontStrokesPlanner({
        store: getFontStrokesStore(),
        memory,
        readDemand: demand.read,
        subscribeDemand: demand.subscribe,
        fontStackOf: fontStackOfKey,
        labelOf: fontLabelOfKey,
        prepareFont,
        rasterize: (ch, family) => {
            const canon = renderCanon(ch, family, INFERENCE_WEIGHT);
            return canon ? { canon, features: glyphFeatures(canon.img) } : null;
        },
        infer: (features, urgency) => runStrokesGpu(features, { urgency }),
        build: (canon, result) => buildFontStrokesGlyph(result.owner, result.pens, { a: canon.a, bx: canon.bx, by: canon.by }),
        permanentlyUnavailable: strokesGpuUnavailable,
        isModelChar,
    });
    return planner;
};

/**
 * 登记一个使用方：这个字体键的笔画要用了。chars 可选，是它自己正在显示的文本（不在播放歌词里的也会算，如预览、试玩台）；
 * 文本变了就重新登记。返回取消登记；没有使用方时服务不算、不下载模型。
 */
export const registerFontStrokesConsumer = ({ fontKey, chars }: { fontKey: string; chars?: string }): (() => void) => getPlanner().register(fontKey, chars);

/** 同步取一个字的笔画；没算好、画不出来（没有墨）时 null。 */
export const getFontStrokes = (fontKey: string, ch: string): FontStrokesGlyph | null => memory.get(fontKey, ch);

const stackCache = new Map<string, string | null>();
const stackOf = (fontKey: string) => {
    let stack = stackCache.get(fontKey);
    if (stack === undefined) {
        stack = fontStackOfKey(fontKey);
        if (stackCache.size > 32) stackCache.clear();
        stackCache.set(fontKey, stack);
    }
    return stack;
};

/**
 * 一个字的笔画落到显示字重 weight 上的样子（每条笔身膨胀多少、剩下的墨归哪笔，fontStrokesFit.ts）。同步；第一次算要几毫秒，之后查缓存。
 * glyph 是 getFontStrokes(fontKey, ch) 拿到的记录。
 */
export const getFontStrokeFit = (fontKey: string, glyph: FontStrokesGlyph, ch: string, weight: number): StrokeFit | null => {
    const stack = stackOf(fontKey);
    return stack ? getStrokeFit(glyph, ch, stack, weight) : null;
};

/** 预热 getFontStrokeFit（字还没开写时调，一帧最多算一个）。 */
export const warmFontStrokeFit = (fontKey: string, glyph: FontStrokesGlyph, ch: string, weight: number) => {
    const stack = stackOf(fontKey);
    if (stack) warmStrokeFit(glyph, ch, stack, weight);
};

/** 订阅新结果（参数是哪个字体键来了新字）。返回取消。 */
export const subscribeFontStrokes = (listener: (fontKey: string) => void): (() => void) => memory.subscribe(listener);

/** 盘上占用（缓存管理「分析」类别用）。 */
export const getFontStrokesUsage = (): Promise<FontStrokesUsage> => getFontStrokesStore().usage();

/** 清除手写笔画缓存（盘和内存）；还有使用方时服务会在后台重算当前要用的字。 */
export const clearFontStrokesCache = (): Promise<void> => getFontStrokesStore().clearAll();

// 不管从哪里清盘（命令面板、缓存管理），内存工作集跟着清，预备服务重新查盘、重算
onFontStrokesCleared(() => {
    memory.clearAll();
    planner?.reset();
});
