import type { Line, Word } from '../../../../types';
import {
    buildTideLineWordRanges,
    collectTideGlyphs,
    measureTideGlyphRange,
    readTideMarkAnchors,
} from './tideGlyphDom';
import { readTideAnchors } from './tideAnchorBridge';

// src/components/visualizer/backgrounds/tide/LyricAnchorSampler.ts
// Answers "where are the lyrics right now" for the tide background: it measures the foreground
// visualizer's own lyric DOM, groups neighbours into a handful of clusters, and turns each cluster
// into an anchor (a position and a strength). It deliberately reports no velocity - a per-sample
// difference is far too noisy to push water with - so the motion is derived downstream from the
// smoothly filtered position (tideSplats.glideTideAnchors). Canvas-only visualizers expose no text
// nodes: the wave ring publishes its playhead and its ring of melt emitters through DOM marks
// instead, and other canvas modes degrade to a timing-driven synthetic anchor.

export interface TideAnchorSample {
    key: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    strength: number;
    /**
     * 自报的固定外推推力（流体坐标系：x 向右、y 向上，方向已单位化）。
     * 静止的融环发射点靠它把染料推离环面 —— 这是位置与强度之外的第三个通道；
     * 文字锚点不带它（缺省 0，推力仍只来自下游滤波出的移动速度）。
     */
    pushX?: number;
    pushY?: number;
}

export interface TideAnchorInput {
    stage: HTMLElement | null;
    bounds: { left: number; top: number; width: number; height: number };
    lines: Line[];
    lineIndex: number;
    timeSec: number;
    /** 每次采样最多输出几组字形向量：设置页的"向量数量"上限，直接控制喂给流体的锚点个数。 */
    maxAnchors: number;
}

interface TideCluster {
    index: number;
    word: Word;
    envelope: number;
}

/** 前后各留一点时间，锚点在歌词唱到之前就已经开始推流体。 */
const ANCHOR_LEAD = 0.45;
const ANCHOR_TAIL = 0.5;
/** 几个字一组合成一个向量，避免逐字生成一堆细碎锚点。 */
const MAX_CLUSTERS = 6;
/** 画布类可视化的歌词没有 DOM，合成锚点沿舞台中下这条基线移动。 */
const FALLBACK_BASELINE = 0.47;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const envelopeOf = (word: Word, timeSec: number): number => {
    if (timeSec < word.startTime || timeSec > word.endTime) {
        const distance = timeSec < word.startTime
            ? word.startTime - timeSec
            : timeSec - word.endTime;
        const reach = timeSec < word.startTime ? ANCHOR_LEAD : ANCHOR_TAIL;
        return clamp(1 - distance / reach, 0, 1);
    }

    return 1;
};

/** 无状态：它只回答"字现在在哪"，运动交给下游滤波。 */
export class LyricAnchorSampler {
    sample(input: TideAnchorInput): TideAnchorSample[] {
        // canvas 类可视化（商籁 / 绘光）主动发布的逐字锚点最准：它们知道自己的字在哪。
        const bridged = this.bridgedAnchors(input);
        if (bridged.length > 0) {
            return bridged;
        }

        const line = input.lines[input.lineIndex];
        if (!line || !line.words || line.words.length === 0) {
            // 没在唱的行也要问一次标记：canvas 类可视化（波环）的「现在」还在环上走。
            return this.markAnchors(input);
        }

        const clusters = this.pickClusters(line, input.timeSec, input.maxAnchors);
        if (clusters.length === 0) {
            return this.markAnchors(input);
        }

        const measured = this.measureClusters(input, clusters);
        if (measured.length > 0) {
            return measured;
        }

        const synthetic = this.syntheticClusters(input, line, clusters);
        // 时序兜底锚点不知道前台画面长什么样；标记锚点知道。有标记就用标记，
        // 让波环这类 canvas 可视化的水面跟着真实的「现在」和流势走，而不是跟着估算的基线走。
        const marks = this.markAnchors(input);
        return marks.length > 0 ? marks : synthetic;
    }

    /**
     * canvas 类可视化（商籁 / 绘光）经 tideAnchorBridge 发布的逐字锚点。
     * 它们报的是**画布逻辑像素**，这里用画布自己的 rect 折算到舞台坐标 —— 与 DPR、画布在
     * 舞台里的偏移都无关。强度取模式报的活跃度（通常就是该字当帧的 alpha），未唱/未亮起的
     * 字强度≈0 直接丢掉；超上限时优先保留最亮的那些。
     */
    private bridgedAnchors(input: TideAnchorInput): TideAnchorSample[] {
        const frame = readTideAnchors(input.stage);
        if (!frame || input.bounds.width <= 1 || input.bounds.height <= 1) {
            return [];
        }

        const rect = frame.canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return [];
        }

        const limit = Math.round(clamp(Number.isFinite(input.maxAnchors) ? input.maxAnchors : MAX_CLUSTERS, 1, MAX_CLUSTERS));
        const samples: TideAnchorSample[] = [];
        for (let index = 0; index < frame.count; index += 1) {
            const anchor = frame.anchors[index];
            const strength = clamp(anchor.strength, 0, 1);
            if (strength <= 0.02) {
                continue;
            }
            samples.push({
                key: `bridge:${index}`,
                x: (rect.left + anchor.x - input.bounds.left) / input.bounds.width,
                // tide 的锚点 y 是「屏幕向上」的（DOM 字形与标记两条路径都是 1 - 顶向下比例），
                // 而画布像素是顶向下 —— 这里必须翻一次，否则整组锚点会上下镜像。
                y: 1 - (rect.top + anchor.y - input.bounds.top) / input.bounds.height,
                vx: 0,
                vy: 0,
                strength,
            });
        }

        // 只留最亮的若干个。同一行上已唱到的字强度相同，靠原生稳定排序保证每帧挑的是同一批 ——
        // 否则 key 每帧换一批，下游滑行滤波会把它们当成新锚点反复重新淡入（抖）。
        samples.sort((a, b) => b.strength - a.strength);
        return samples.slice(0, limit);
    }

    /**
     * 前台可视化暴露的动态标记锚点（[data-tide-playhead]）。
     * 有文字 DOM 的模式下不参与（歌词字形已经足够），只在 canvas 模式（波环）下顶上来 ——
     * 播放头给「现在」，并自报一股沿环切向（斜左下）、动量随音乐而变的推力，
     * 与文字锚点同一套向量标准：位置 + 强度照报，方向与动量由渲染层经 data-tide-out /
     * data-tide-push 自报。
     */
    private markAnchors(input: TideAnchorInput): TideAnchorSample[] {
        if (!input.stage || input.bounds.width <= 1 || input.bounds.height <= 1) {
            return [];
        }

        const marks = readTideMarkAnchors(input.stage, input.bounds);
        if (marks.length === 0) {
            return [];
        }

        const limit = Math.round(clamp(Number.isFinite(input.maxAnchors) ? input.maxAnchors : MAX_CLUSTERS, 1, MAX_CLUSTERS));
        return marks.slice(0, limit).map(mark => ({
            key: mark.key,
            x: mark.x,
            y: mark.y,
            vx: 0,
            vy: 0,
            strength: mark.strength,
            // 屏幕坐标 y 向下、流体坐标 y 向上：方向向量的 y 取反；
            // 再乘自报的推力大小（动量），于是同一个方向能随音乐变强变弱。
            pushX: mark.outX * mark.push,
            pushY: -mark.outY * mark.push,
        }));
    }

    /** 逐字：每个还在发声（含前后淡入淡出）的词都是一个锚点；超上限时优先保留唱得最重的那些。 */
    private pickClusters(line: Line, timeSec: number, maxAnchors: number): TideCluster[] {
        const limit = Math.round(clamp(Number.isFinite(maxAnchors) ? maxAnchors : MAX_CLUSTERS, 1, MAX_CLUSTERS));
        const alive: TideCluster[] = [];
        line.words.forEach((word, index) => {
            const envelope = envelopeOf(word, timeSec);
            if (envelope > 0.02) {
                alive.push({ index, word, envelope });
            }
        });

        if (alive.length <= limit) {
            return alive;
        }

        // 超上限时按权重取舍，再回到文档顺序：是逐字，不是按均匀步长跳字。
        const kept = [...alive]
            .sort((left, right) => right.envelope - left.envelope)
            .slice(0, limit);

        return kept.sort((left, right) => left.index - right.index);
    }

    private measureClusters(input: TideAnchorInput, clusters: TideCluster[]): TideAnchorSample[] {
        if (!input.stage || input.bounds.width <= 1 || input.bounds.height <= 1) {
            return [];
        }

        const line = input.lines[input.lineIndex];
        if (!line) {
            return [];
        }

        const { text, glyphs } = collectTideGlyphs(input.stage);
        if (glyphs.length === 0) {
            return [];
        }

        // 一次性建立整行的「词下标 -> 字形区间」映射，再按映射取活跃词。
        // 不再逐词从串首重新搜索文本：那样一行里出现两次的同一个词，第二个会命中第一个。
        const ranges = buildTideLineWordRanges(text, line);

        const samples: TideAnchorSample[] = [];
        for (const cluster of clusters) {
            const range = ranges[cluster.index];
            if (!range) {
                continue;
            }

            const rect = measureTideGlyphRange(glyphs, range.start, range.length);
            if (!rect) {
                continue;
            }

            const x = (rect.left + rect.width / 2 - input.bounds.left) / input.bounds.width;
            const y = 1 - (rect.top + rect.height / 2 - input.bounds.top) / input.bounds.height;
            if (x < -0.15 || x > 1.15 || y < -0.15 || y > 1.15) {
                continue;
            }

            samples.push({ key: `dom:${cluster.index}`, x, y, vx: 0, vy: 0, strength: cluster.envelope });
        }

        return samples;
    }

    /** 没有 DOM 歌词时的替身：沿一条基线随行唱进度摆动，强度减半。 */
    private syntheticClusters(
        input: TideAnchorInput,
        line: Line,
        clusters: TideCluster[],
    ): TideAnchorSample[] {
        const span = Math.max(0.4, line.endTime - line.startTime);
        const progress = clamp((input.timeSec - line.startTime) / span, 0, 1);
        const middle = (clusters.length - 1) / 2;

        return clusters.map((cluster, order) => ({
            key: `timing:${cluster.index}`,
            x: clamp(0.5 + (progress - 0.5) * 0.34 + (order - middle) * 0.17, 0.04, 0.96),
            y: clamp(FALLBACK_BASELINE + Math.sin((progress + order * 0.25) * Math.PI * 2) * 0.05, 0.08, 0.92),
            vx: 0,
            vy: 0,
            strength: cluster.envelope * 0.55,
        }));
    }
}
