// src/components/visualizer/fontStrokes/strokeWriteTiming.ts
// 手写笔画的时序（纯函数，样式通用）：一个字的书写窗口（从字的开始时间起写 clamp(字时长, 0.3, 1.0) 秒，可以拖进下一个字）、
// 「用不用手写」的冻结规则，和字内各笔的进度（按书写顺序，时间按每笔的长度分）。canvas 写字在 strokeWriteCanvas.ts。

/** 一个字的书写时长下限 / 上限（秒）：字的时长夹在中间。 */
export const WRITE_MIN_SECONDS = 0.3;
export const WRITE_MAX_SECONDS = 1.0;

export interface WriteWindowOptions {
    minSeconds?: number;
    maxSeconds?: number;
}

const writeDuration = (start: number, end: number, options: WriteWindowOptions = {}) => (
    Math.min(options.maxSeconds ?? WRITE_MAX_SECONDS, Math.max(options.minSeconds ?? WRITE_MIN_SECONDS, end - start))
);

/** 一个字的书写窗口结束时间：开始时间 + clamp(字时长, 0.3, 1.0)。 */
export const resolveWriteWindowEnd = (start: number, end: number, options?: WriteWindowOptions): number => start + writeDuration(start, end, options);

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * 一个字此刻的书写进度（已缓出，0..1）：从字的开始时间 start 起写 clamp(字时长, 0.3, 1.0) 秒；
 * 还没开始或已写完（该用普通画法）返回 null。
 */
export const resolveWriteProgress = (start: number, end: number, time: number, options?: WriteWindowOptions): number | null => {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    const t = (time - start) / writeDuration(start, end, options);
    if (!(t >= 0) || t >= 1) return null;
    return easeOutCubic(t);
};

/** 一个字此刻的手写状态：null 走普通画法，'hidden' 还没开写（什么都不画），数字是书写进度（0..1，已缓出）。 */
export type WriteGlyphState = null | 'hidden' | number;

/**
 * 冻结规则：这个字用不用手写，在它第一次被看到（窗口结束之前的第一帧）那一刻定下，之后不再改：
 * 那一刻有笔画就手写（开写前一直不画，开写后按进度写），没有就一直是普通画法（笔画晚到也不换，已经看得见的字不会再消失）。
 * 书写窗口结束后清掉记录、返回 null（整字普通画）；拖回去重放时重新决定。
 */
export const resolveWriteGlyphState = (
    decisions: Map<string, boolean>,
    key: string,
    time: number,
    start: number,
    end: number,
    hasStrokes: () => boolean,
    options?: WriteWindowOptions,
): WriteGlyphState => {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (time >= resolveWriteWindowEnd(start, end, options)) {
        if (decisions.size) decisions.delete(key);
        return null;
    }
    let decided = decisions.get(key);
    if (decided === undefined) {
        decided = hasStrokes();
        decisions.set(key, decided);
    }
    if (!decided) return null;
    if (time < start) return 'hidden';
    return resolveWriteProgress(start, end, time, options);
};

/** 折线（flat [x, y]）的长度。 */
export const polylineLength = (points: ArrayLike<number>): number => {
    let length = 0;
    for (let i = 2; i + 1 < points.length; i += 2) length += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
    return length;
};

/**
 * 整个字的进度（0..1）→ 每笔的进度（0..1），写进 out（长度 = 笔数，可复用）并返回 out。
 * 笔按书写顺序一笔接一笔写，每笔分到的时间和它的权重（通常是长度）成正比；权重 0 的笔不占时间，前面的笔写完它就算写完。
 */
export const resolveStrokeProgress = (weights: ArrayLike<number>, progress: number, out: Float32Array): Float32Array => {
    const n = Math.min(weights.length, out.length);
    let total = 0;
    for (let k = 0; k < n; k += 1) total += Math.max(0, weights[k]);
    const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
    if (!(total > 0)) {
        out.fill(p >= 1 ? 1 : 0, 0, n);
        return out;
    }
    const at = p * total;
    let before = 0;
    for (let k = 0; k < n; k += 1) {
        const w = Math.max(0, weights[k]);
        out[k] = w > 0 ? Math.min(1, Math.max(0, (at - before) / w)) : (p > 0 && at >= before ? 1 : 0);
        before += w;
    }
    return out;
};
