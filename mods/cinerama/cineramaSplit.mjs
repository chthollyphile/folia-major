import { chooseCineramaWithoutRepeat } from './cineramaRandom.mjs';

// mods/cinerama/cineramaSplit.mjs
// 切分层（scaffold）：把一行歌词拆成可编排的 display units。
// 现阶段渲染仍整行直出，units 只进编译结果、不进 DOM；后续逐段动画接进来后，
// 渲染端消费同一份 units 即可，不需要再动 program。

export const CINERAMA_SPLIT_KINDS = ['whole', 'word', 'clause', 'grapheme', 'half'];

const CLAUSE_BREAK = /[，,。、；;：:！!？?…—~\n]/;
// Long lines would explode into hundreds of grapheme units; the cap keeps the
// plan cheap until per-unit rendering actually exists.
const MAX_GRAPHEME_UNITS = 32;

/*
 * A line's drawable window. renderHints.renderEndTime may extend past the
 * authored endTime (visual tail), but the program never lets one line bleed
 * into the next — that clamp happens in compileCineramaProgram.
 */
export const resolveCineramaLineWindow = (line) => {
    const startTime = Number.isFinite(line?.startTime) ? line.startTime : 0;
    const hinted = line?.renderHints?.renderEndTime;
    const fallback = Number.isFinite(line?.endTime) ? line.endTime : startTime;
    const endTime = Number.isFinite(hinted) && hinted > startTime ? hinted : fallback;
    return { startTime, endTime: Math.max(startTime + 0.001, endTime) };
};

const segmentGraphemes = (text) => {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        return Array.from(segmenter.segment(text), (item) => item.segment);
    }
    return Array.from(text);
};

// 词里至少要有一个字母/数字：纯标点与空白不算词（凝彩的 isWordLikeText 同口径）。
const WORD_LIKE = /[\p{L}\p{N}]/u;

/*
 * 大字报要的**纯词序列**：Intl.Segmenter(word)，用户存过的 wordSegments 优先
 * （与凝彩的 segmentLyricWords 同一口径：src/utils/lyrics/wordSegmentation.ts）。
 * 与 buildCineramaUnits 的 parts 不同，这里刻意丢掉空白段与独立标点段——
 * 空白并回前一个词的词尾、标点粘在前一个词上，否则「，」会自己占一次闪现。
 * 返回的是可直接上屏的文本数组（join 后不等于原文：空白被折进词里了）。
 */
export const segmentCineramaWords = (line) => {
    const text = line?.fullText ?? '';
    if (!text.trim()) return [];
    const saved = Array.isArray(line?.wordSegments) && line.wordSegments.length > 0
        ? line.wordSegments
        : null;
    // 存过的分词拼不回原文就是过期数据（换过歌词源），按整段重分，不能带着错位去用。
    const parts = saved && saved.join('') === text ? saved : segmentWords(text);
    const words = [];
    parts.forEach((part) => {
        if (!part) return;
        if (WORD_LIKE.test(part)) {
            words.push(part);
            return;
        }
        const trimmed = part.trim();
        if (!trimmed) {
            // 空白：并回前一个词的词尾，词本身就是天然的分隔。
            if (words.length > 0) words[words.length - 1] += part;
            return;
        }
        // 标点：粘在前一个词上，和凝彩的 sticky pass 一样。
        if (words.length > 0) words[words.length - 1] += trimmed;
        else words.push(trimmed);
    });
    return words.filter((word) => word.trim().length > 0);
};

const segmentWords = (text) => {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
        return Array.from(segmenter.segment(text), (item) => item.segment);
    }
    return text.split(/(\s+)/u).filter(Boolean);
};

// Lossless split: delimiters are kept as their own part, so join('') === text.
const splitKeepingDelimiters = (text, pattern) => {
    const parts = [];
    const regex = new RegExp(pattern.source, 'gu');
    let cursor = 0;
    let match = regex.exec(text);
    while (match) {
        if (match.index > cursor) parts.push(text.slice(cursor, match.index));
        parts.push(match[0]);
        cursor = match.index + match[0].length;
        match = regex.exec(text);
    }
    if (cursor < text.length) parts.push(text.slice(cursor));
    return parts.filter((part) => part.length > 0);
};

/*
 * Splits into `count` near-equal chunks, snapping each cut to the closest
 * natural break (whitespace or clause punctuation) so a half never starts on a
 * dangling particle.
 */
const splitBalanced = (text, count) => {
    if (count < 2) return [text];
    const isBreak = (char) => /\s/u.test(char) || CLAUSE_BREAK.test(char);
    const cuts = [];
    for (let step = 1; step < count; step += 1) {
        const target = Math.round((text.length * step) / count);
        let best = -1;
        for (let offset = 0; offset <= 6; offset += 1) {
            if (isBreak(text[target + offset])) { best = target + offset; break; }
            if (isBreak(text[target - offset])) { best = target - offset; break; }
        }
        const cut = best > 0 ? best + 1 : target;
        if (cut > (cuts.at(-1) ?? 0) && cut < text.length) cuts.push(cut);
    }
    const parts = [];
    let cursor = 0;
    cuts.forEach((cut) => {
        parts.push(text.slice(cursor, cut));
        cursor = cut;
    });
    parts.push(text.slice(cursor));
    return parts.filter((part) => part.length > 0);
};

const partsForKind = (text, kind, line) => {
    if (kind === 'word') {
        // User-saved boundaries win; they are already lossless for fullText.
        if (Array.isArray(line?.wordSegments) && line.wordSegments.length > 0) return line.wordSegments;
        return segmentWords(text);
    }
    if (kind === 'clause') return splitKeepingDelimiters(text, CLAUSE_BREAK);
    if (kind === 'grapheme') return segmentGraphemes(text);
    if (kind === 'half') return splitBalanced(text, segmentGraphemes(text).length > 16 ? 3 : 2);
    return [text];
};

const CINERAMA_SPLIT_SUPPORT = {
    whole: () => true,
    word: (text) => segmentWords(text).length > 1,
    clause: (text) => CLAUSE_BREAK.test(text),
    grapheme: (text) => {
        const count = segmentGraphemes(text).length;
        return count > 1 && count <= MAX_GRAPHEME_UNITS;
    },
    half: (text) => segmentGraphemes(text).length >= 6,
};

export const supportsCineramaSplit = (kind, text) => Boolean(CINERAMA_SPLIT_SUPPORT[kind]?.(text ?? ''));

export const pickCineramaSplitKind = (line, seed, previous) => {
    const text = line?.fullText ?? '';
    const supported = CINERAMA_SPLIT_KINDS.filter((kind) => supportsCineramaSplit(kind, text));
    return chooseCineramaWithoutRepeat(supported, seed, previous) ?? 'whole';
};

/*
 * 出词的**落点**：跟着唱，不跟着显示。
 *
 * 行窗口（`window.endTime`）说的是「这一行在屏上待到什么时候」，它含一段**没人唱的尾巴**：
 * 作者写的 `line.endTime` 常常落在最后一个词之后，`renderHints.renderEndTime` 还要再加
 * `linePassHold + exitDuration`（见 src/utils/lyrics/renderHints.ts 的
 * `buildLineRenderEndTime`）。把出词摊到整段显示窗口上，每个词都会比唱到它的时候晚一截，
 * 尾巴越长晚得越多——「巨幕出词比其他特效慢」就是这么来的（实测一行 3s、末尾 0.6s 没词时，
 * 第二段晚了 1.05s）。tempera 的 README 里那句「凡是按歌词节奏走的东西都要用
 * lyricEndTime，否则会拖成好几秒」说的是同一件事。
 */
const REVEAL_FLOOR_RATIO = 0.3;

export const resolveCineramaRevealWindow = (line, window) => {
    const start = window.startTime;
    const span = Math.max(0.001, window.endTime - window.startTime);
    const words = Array.isArray(line?.words) ? line.words : [];
    let lastWordEnd = null;
    for (let index = words.length - 1; index >= 0; index -= 1) {
        const end = Number(words[index]?.endTime);
        if (Number.isFinite(end)) {
            lastWordEnd = end;
            break;
        }
    }
    // 没有词时序时退回作者写的行尾；有就跟着最后一个词**唱完**的时刻。
    const authored = Number.isFinite(line?.endTime) ? line.endTime : window.endTime;
    const sung = lastWordEnd !== null ? lastWordEnd : authored;
    // 下限：词时序本身是合成的（词内等分），坏数据不该把一整行挤成一瞬。
    const end = Math.min(window.endTime, Math.max(sung, start + span * REVEAL_FLOOR_RATIO));
    return { startTime: start, endTime: Math.max(end, start + 0.001) };
};

const findGraphemeSequence = (source, target, fromIndex) => {
    if (target.length === 0) return fromIndex;
    for (let index = fromIndex; index <= source.length - target.length; index += 1) {
        let matched = true;
        for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
            if (source[index + targetIndex] !== target[targetIndex]) {
                matched = false;
                break;
            }
        }
        if (matched) return index;
    }
    return -1;
};

const evenGraphemeTimings = (graphemes, startTime, endTime) => {
    const duration = Math.max(0, endTime - startTime);
    const unit = duration / Math.max(1, graphemes.length);
    return graphemes.map((char, index) => ({
        char,
        startTime: startTime + unit * index,
        endTime: index === graphemes.length - 1 ? endTime : startTime + unit * (index + 1),
    }));
};

/*
 * 逐字时序。本地镜像 src/utils/lyrics/graphemeTiming.ts 的 `buildLineGraphemeTimeline`
 * ——模组跑在 `folia-mod://` 下，import 不到 src，只能照同一套口径再实现一遍：
 *   1. 把 `line.words` 的 text 在 `fullText` 的字素序列里对位；
 *   2. 词内的字素在 `[word.startTime, word.endTime]` 上等分；
 *   3. 两个词之间没被覆盖的字素（空格、标点）是零时长、钉在后一个词的 startTime。
 *
 * 与 src 那份唯一的差别：等分兜底用**歌词窗口**（`resolveCineramaRevealWindow`）而不是
 * `[line.startTime, line.endTime]`——理由见上面那条注释。
 */
export const buildCineramaGraphemeTimeline = (line, window) => {
    const graphemes = segmentGraphemes(line?.fullText ?? '');
    if (graphemes.length === 0) return [];
    const reveal = resolveCineramaRevealWindow(line, window);
    const words = (Array.isArray(line?.words) ? line.words : []).filter(
        (word) => Number.isFinite(Number(word?.startTime)) && Number.isFinite(Number(word?.endTime)),
    );
    if (words.length === 0) return evenGraphemeTimings(graphemes, reveal.startTime, reveal.endTime);

    /*
     * 词时序是外部数据，可能有脏值（整段偏移、时间戳超出行窗口）。不论它说什么，
     * 一段的时刻**不许离开行窗口**——出了窗口这一段要么永远不入场、要么在下一行
     * 已经开始之后才出来。所以这里统一钳回窗口。
     */
    const clampTime = (value) => Math.min(window.endTime, Math.max(window.startTime, value));

    const timeline = new Array(graphemes.length);
    let cursor = 0;
    let lastEnd = reveal.startTime;
    words.forEach((word) => {
        const wordGraphemes = segmentGraphemes(String(word.text ?? ''));
        if (wordGraphemes.length === 0) return;
        const wordStart = clampTime(Number(word.startTime));
        const wordEnd = clampTime(Number(word.endTime));
        const matched = findGraphemeSequence(graphemes, wordGraphemes, cursor);
        const start = matched >= 0 ? matched : cursor;
        const end = Math.min(start + wordGraphemes.length, graphemes.length);
        for (let index = cursor; index < start; index += 1) {
            timeline[index] = {
                char: graphemes[index],
                startTime: wordStart,
                endTime: wordStart,
            };
        }
        const timings = evenGraphemeTimings(wordGraphemes, wordStart, wordEnd);
        for (let index = start; index < end; index += 1) {
            const timing = timings[index - start];
            if (timing) {
                timeline[index] = {
                    char: graphemes[index],
                    startTime: timing.startTime,
                    endTime: timing.endTime,
                };
            }
        }
        lastEnd = Math.max(lastEnd, wordEnd);
        cursor = Math.max(cursor, end);
    });
    for (let index = 0; index < graphemes.length; index += 1) {
        if (!timeline[index]) {
            timeline[index] = { char: graphemes[index], startTime: lastEnd, endTime: lastEnd };
        }
    }
    /*
     * 两道收尾，顺序有讲究：
     *
     * 1. **零时长的字素（空格、标点）重新计时**：上面把它们钉在**后一个词**的起点，
     *    于是逗号会跟着它后面那个词一起入场。tempera 的 README 明确记了这条坑
     *    （「粘标点时必须给它重新计时」）。这里改钉到**前一个字素的结束**，
     *    标点于是跟着它前面的内容走。
     * 2. **单调 + 钳位**：词时序是外部数据，可能有脏值（时间戳超出行窗口、整段偏移、
     *    相邻词时间倒挂）。不论它说什么，出词顺序不许倒退、时刻不许离开行窗口——
     *    出了窗口这一段要么永远不入场，要么在下一行已经开始之后才出来。
     */
    let previousEnd = reveal.startTime;
    const retimed = timeline.map((entry) => {
        if (entry.endTime > entry.startTime) {
            previousEnd = entry.endTime;
            return entry;
        }
        const at = Math.max(reveal.startTime, previousEnd);
        return { ...entry, startTime: at, endTime: at };
    });
    let previousStart = window.startTime;
    return retimed.map((entry) => {
        const start = Math.min(window.endTime, Math.max(entry.startTime, previousStart));
        previousStart = start;
        return {
            ...entry,
            startTime: start,
            endTime: Math.min(window.endTime, Math.max(entry.endTime, start)),
        };
    });
};

const evenUnits = (parts, from, to) => {
    const span = Math.max(0.001, to - from);
    return parts.map((part, index) => ({
        index,
        text: part,
        startTime: from + (span * index) / parts.length,
        endTime: from + (span * (index + 1)) / parts.length,
    }));
};

/*
 * 把一行切成带时刻的 display units。**时刻来自 parser 的词时序**，不再是等分：
 * `line.words` 带每个词的真实起止，逐字时序由 `buildCineramaGraphemeTimeline` 摊到字素上，
 * 一段的时刻就是它覆盖的那些字素的 `[min 起点, max 终点]`。
 *
 * 对位为什么成立：parts 是**无损**切分（`splitKeepingDelimiters` / `splitBalanced` /
 * `segmentGraphemes` / `segmentWords` 拼回去都等于原文），所以拿一个游标沿字素序列走，
 * 一段吃掉它自己的那几个字素即可。拼不回去（存过的分词过期、字素长度对不上）就整体
 * 退回等分——宁可退回也不能带着错位去对位。
 */
/*
 * 把若干段**子串**（大字报的逐块闪现这类）对位到逐字时序上，返回每段覆盖的 `[startTime, endTime]`。
 *
 * 与 `buildCineramaUnits` 是同一套对位（游标沿字素序列走 + `buildCineramaGraphemeTimeline`），
 * 两个差别：
 *   1. 段是外面给的（大字报的块是**并过的词**，还可能是硬切过的长词片段），不是切分层切出来的；
 *   2. 段的**尾随空白可能已经被裁掉**（并块后要 `trimEnd`，不然空格占宽度、居中的字会歪），
 *      而字素序列里还留着它——所以游标遇到「这一段里没有的空白」要跳过。
 *
 * **对不上不放弃**：与宿主同一条宽容口径——顺序消费，游标现在停在哪儿就用哪儿的时刻
 * （`src/utils/lyrics/graphemeTiming.ts` 的 `buildLineGraphemeTimeline` 里，
 * `findGraphemeSequence` 没命中就是 `start = cursor`，从不因为某个词对不上把整行摊平）。
 * 整体退回等分会让**整行每一段**都错，顺序继续只让这一段偏一点。
 * 只有结构上没法谈对位时（没有段 / 这一行没有字素）才返回 `null`。
 */
export const resolveCineramaSegmentSpans = (parts, line, window = resolveCineramaLineWindow(line)) => {
    if (!Array.isArray(parts) || parts.length === 0) return null;
    const graphemes = segmentGraphemes(line?.fullText ?? '');
    if (graphemes.length === 0) return null;
    const timeline = buildCineramaGraphemeTimeline(line, window);
    const spans = [];
    let cursor = 0;
    for (const part of parts) {
        const chars = segmentGraphemes(part);
        let start = Number.POSITIVE_INFINITY;
        let end = Number.NEGATIVE_INFINITY;
        for (const char of chars) {
            // 段尾被裁掉的空白还留在序列里：跳过它再对齐。
            while (cursor < graphemes.length && graphemes[cursor] !== char && graphemes[cursor].trim() === '') {
                cursor += 1;
            }
            // 空段、或者字符对不上：落在游标现在的位置上（不 `return null`，见上）。
            const timing = timeline[Math.min(cursor, graphemes.length - 1)];
            if (timing) {
                start = Math.min(start, timing.startTime);
                end = Math.max(end, timing.endTime);
            }
            cursor += 1;
        }
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            // 这一段一个字符都没有（空段）：补一个零长窗口，别让段与时刻错位。
            const timing = timeline[Math.min(cursor, graphemes.length - 1)];
            const at = timing?.startTime ?? 0;
            spans.push({ startTime: at, endTime: at });
            continue;
        }
        spans.push({ startTime: start, endTime: Math.max(end, start) });
    }
    return spans;
};

export const buildCineramaUnits = (line, kind) => {
    const text = line?.fullText ?? '';
    if (!text) return [];
    const window = resolveCineramaLineWindow(line);
    const reveal = resolveCineramaRevealWindow(line, window);
    const parts = partsForKind(text, kind, line);
    const graphemes = segmentGraphemes(text);
    const timeline = buildCineramaGraphemeTimeline(line, window);
    if (parts.join('') !== text || timeline.length !== graphemes.length) {
        return evenUnits(parts, reveal.startTime, reveal.endTime);
    }
    const units = [];
    let cursor = 0;
    parts.forEach((part) => {
        const size = segmentGraphemes(part).length;
        const slice = timeline.slice(cursor, cursor + size);
        cursor += size;
        if (slice.length === 0) return;
        let start = Number.POSITIVE_INFINITY;
        let end = Number.NEGATIVE_INFINITY;
        slice.forEach((entry) => {
            start = Math.min(start, entry.startTime);
            end = Math.max(end, entry.endTime);
        });
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        units.push({
            index: units.length,
            text: part,
            startTime: start,
            endTime: Math.max(end, start + 0.001),
        });
    });
    return units.length > 0 ? units : evenUnits(parts, reveal.startTime, reveal.endTime);
};
