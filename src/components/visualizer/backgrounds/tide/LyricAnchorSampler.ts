import type { Line, Word } from '../../../../types';
import {
    collectTideGlyphs,
    findTideClusterIndex,
    measureTideGlyphRange,
    normalizeAnchorText,
} from './tideGlyphDom';

// src/components/visualizer/backgrounds/tide/LyricAnchorSampler.ts
// Answers "where are the lyrics right now" for the tide背景: it measures the foreground
// visualizer's own lyric DOM, groups neighbours into a handful of clusters, and turns each
// cluster into one force vector (position + velocity) for the fluid. Canvas-only visualizers
// expose no text nodes, so they degrade to a timing-driven synthetic anchor.

export interface TideAnchorSample {
    key: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    strength: number;
}

export interface TideAnchorInput {
    stage: HTMLElement | null;
    bounds: { left: number; top: number; width: number; height: number };
    lines: Line[];
    lineIndex: number;
    timeSec: number;
    dt: number;
    /** 每次采样最多输出几组字形向量：设置页的"向量数量"上限，直接控制喂给流体的锚点个数。 */
    maxAnchors: number;
}

interface TideCluster {
    index: number;
    word: Word;
    envelope: number;
}

interface TideTrackedAnchor {
    x: number;
    y: number;
    at: number;
    /** Last smoothed velocity: the raw per-sample difference is far too noisy to push water with. */
    vx: number;
    vy: number;
}

/** 前后各留一点时间，锚点在歌词唱到之前就已经开始推流体。 */
const ANCHOR_LEAD = 0.45;
const ANCHOR_TAIL = 0.5;
/** 几个字一组合成一个向量，避免逐字生成一堆细碎锚点。 */
const MAX_CLUSTERS = 6;
const MAX_ANCHOR_SPEED = 1.6;
const MAX_TRACKED = 64;
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

export class LyricAnchorSampler {
    private tracked = new Map<string, TideTrackedAnchor>();
    private lineKey = '';

    reset(): void {
        this.tracked.clear();
        this.lineKey = '';
    }

    sample(input: TideAnchorInput): TideAnchorSample[] {
        const line = input.lines[input.lineIndex];
        if (!line || !line.words || line.words.length === 0) {
            this.reset();
            return [];
        }

        const lineKey = `${line.id ?? ''}|${line.startTime}|${line.fullText}`;
        if (lineKey !== this.lineKey) {
            this.tracked.clear();
            this.lineKey = lineKey;
        }

        const clusters = this.pickClusters(line, input.timeSec, input.maxAnchors);
        if (clusters.length === 0) {
            return [];
        }

        const measured = this.measureClusters(input, clusters);
        const samples = measured.length > 0
            ? measured
            : this.syntheticClusters(input, line, clusters);

        return samples.map(sample => this.resolveMotion(sample, input.dt));
    }

    /** 只保留还在发声（含前后淡入淡出）的词，超过上限就均匀取样。 */
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

        const stride = alive.length / limit;
        return Array.from({ length: limit }, (_, slot) => alive[Math.floor(slot * stride)]);
    }

    private measureClusters(input: TideAnchorInput, clusters: TideCluster[]): TideAnchorSample[] {
        if (!input.stage || input.bounds.width <= 1 || input.bounds.height <= 1) {
            return [];
        }

        const { text, glyphs } = collectTideGlyphs(input.stage);
        if (glyphs.length === 0) {
            return [];
        }

        const samples: TideAnchorSample[] = [];
        let cursor = 0;

        for (const cluster of clusters) {
            const needle = normalizeAnchorText(cluster.word.text);
            if (!needle) {
                continue;
            }

            const start = findTideClusterIndex(text, needle, cursor);
            if (start < 0) {
                continue;
            }

            cursor = start + needle.length;
            const rect = measureTideGlyphRange(glyphs, start, needle.length);
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
            vx: 0.22 * (order % 2 === 0 ? 1 : -1),
            vy: 0.3,
            strength: cluster.envelope * 0.55,
        }));
    }

    /** 锚点速度取两次采样的位移差（y 已经翻转过，向上移动就是正值），并和上一帧做混合： */
    /** 采样噪声如果直接变成推力，水面就会一闪一闪。新出现的字也只轻轻带一下。 */
    private resolveMotion(sample: TideAnchorSample, dt: number): TideAnchorSample {
        const previous = this.tracked.get(sample.key);
        let vx = sample.vx;
        let vy = sample.vy;

        if (previous && dt > 0.0001) {
            const measuredX = (sample.x - previous.x) / dt;
            const measuredY = (sample.y - previous.y) / dt;
            vx = previous.vx * 0.55 + measuredX * 0.45 + vx;
            vy = previous.vy * 0.55 + measuredY * 0.45 + vy;
        } else {
            vx += sample.x < 0.5 ? -0.06 : 0.06;
            vy += 0.12;
        }

        const smoothed = {
            vx: clamp(vx, -MAX_ANCHOR_SPEED, MAX_ANCHOR_SPEED),
            vy: clamp(vy, -MAX_ANCHOR_SPEED, MAX_ANCHOR_SPEED),
        };
        const now = Date.now();
        this.tracked.set(sample.key, { x: sample.x, y: sample.y, at: now, ...smoothed });
        this.pruneTracked(now);

        return {
            ...sample,
            ...smoothed,
        };
    }

    private pruneTracked(now: number): void {
        if (this.tracked.size <= MAX_TRACKED) {
            return;
        }

        this.tracked.forEach((entry, key) => {
            if (now - entry.at > 1200) {
                this.tracked.delete(key);
            }
        });
    }
}
