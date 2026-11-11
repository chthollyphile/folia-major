import type { Line } from '../../../types';
import { buildLineGraphemeTimeline, splitLyricGraphemes } from '../../../utils/lyrics/graphemeTiming';
import { segmentLyricWords } from '../../../utils/lyrics/wordSegmentation';

// src/components/visualizer/tessera/tesseraPlan.ts
// 方块字的整首排布：歌词按分词切成词块，按大致相等的长度排进一行行棋盘；
// 每个词块再顺手带上旁边的垫块、或者把下一句的词预先填进上面一行，拼成四格方块的各种形状；
// 最后给每块定好出生、落地的时间，给每行定好消行的时间。纯函数，不碰 DOM；画在 tesseraDraw.ts。

/** 一个字（grapheme）和它被唱的时间。 */
export interface TesseraGlyph {
    char: string;
    start: number;
    end: number;
}

/**
 * 方块里的一段：glyph 是一格一字（汉字、假名、全角标点），word 是横跨 cells 格的一整个词
 * （拉丁字母等窄字），filler 是不带字的垫块（一格）。
 */
export interface TesseraBlock {
    row: number;
    col: number;
    cells: number;
    kind: 'glyph' | 'word' | 'filler';
    text: string;
    glyphs: TesseraGlyph[];
}

/** 一块下落的方块：落在 baseRow，可能有几段伸进上面一行（baseRow + 1）。 */
export interface TesseraPiece {
    blocks: TesseraBlock[];
    baseRow: number;
    /** 形状：I O T S Z J L（四格），或者更小、更长的。 */
    shape: string;
    /** 出生时相对落点横着偏了几列（下落途中移回来）。 */
    spawnShift: number;
    /** 出生时转了 90°：1 顺时针，-1 逆时针，0 不转。 */
    rotate: -1 | 0 | 1;
    spawn: number;
    land: number;
    /** 落地那一刻 baseRow 下面垫着几行（可以是小数：下面的行正在往下掉）。 */
    landSlot: number;
}

/** 棋盘上的一行：一句歌词（或长句切出的一段）。 */
export interface TesseraRow {
    /** 这一行的所有格子，按所属方块。 */
    blocks: Array<{ piece: TesseraPiece; block: TesseraBlock }>;
    /** 第一块碰到这一行的方块出生的时间：从这时起这一行占着位置。 */
    presenceStart: number;
    /** 最后一块落地、这一行满了、开始消行的时间。 */
    end: number;
    clearEnd: number;
    /** 消完以后上面的行掉下来，掉完的时间。 */
    dropEnd: number;
}

export interface TesseraPlan {
    columns: number;
    boardRows: number;
    rows: TesseraRow[];
    pieces: TesseraPiece[];
}

/** 文字宽度（字号为 1 时的宽度，单位 em）。 */
export type TesseraMeasure = (text: string) => number;

/** 字号是格子边长的多少。 */
export const TESSERA_FONT_RATIO = 0.6;
/** 横跨几格的文字两边至少留的空白（格）。 */
const CELL_PAD = 0.3;
/** 一块方块最多几格（俄罗斯方块是四格）；一格一字的词也按这个切。 */
const MAX_PIECE_CELLS = 4;
const MIN_COLUMNS = 8;
const MAX_COLUMNS = 16;
const PREFERRED_COLUMNS = 11;

/** 下落时长：词唱多久就落多久再多一点，但不短于、不长于这两个数（秒）。 */
const FALL_MIN = 1.1;
const FALL_MAX = 2.4;
const FALL_LEAD = 0.45;
/** 只带垫块的方块落多久（秒）。 */
const FILLER_FALL = 1.3;
/** 行出现时占位的淡入、消行、消完后上面掉下来的时长（秒）。 */
export const TESSERA_PRESENCE_IN = 0.16;
export const TESSERA_CLEAR = 0.6;
export const TESSERA_DROP = 0.16;
/** 下一句离这一句结束超过这么久（秒），就不预先填它：免得在间奏里一直摆着。 */
const PREFILL_GAP = 3;
/** 只带垫块的方块比相邻的词块早 / 晚落多久（秒）。 */
const FILLER_LAND_OFFSET = 0.15;

interface Token {
    text: string;
    glyphs: TesseraGlyph[];
    perCell: boolean;
    cells: number;
    start: number;
    end: number;
}

const WIDE_GLYPH_EM = 0.8;

const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
const easeIn = (x: number) => x * x;
const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** 一行歌词在某刻占不占位置（0–1）：出现时淡入，消完后随上面的行一起掉下去。 */
export const rowPresence = (row: TesseraRow, t: number): number => {
    if (t < row.presenceStart || t >= row.dropEnd) return 0;
    if (t < row.presenceStart + TESSERA_PRESENCE_IN) return easeOut((t - row.presenceStart) / TESSERA_PRESENCE_IN);
    if (t < row.clearEnd) return 1;
    return 1 - easeIn(clamp01((t - row.clearEnd) / TESSERA_DROP));
};

/** 把字按 ≤4 一块尽量平均地切开：5 → 3+2，7 → 4+3。 */
const balancedSizes = (count: number, maxSize: number): number[] => {
    const parts = Math.ceil(count / maxSize);
    const base = Math.floor(count / parts);
    const extra = count % parts;
    return Array.from({ length: parts }, (_, index) => base + (index < extra ? 1 : 0));
};

const makeToken = (glyphs: TesseraGlyph[], perCell: boolean, cells: number): Token => ({
    text: glyphs.map(glyph => glyph.char).join(''),
    glyphs,
    perCell,
    cells,
    start: glyphs[0].start,
    end: glyphs.reduce((latest, glyph) => Math.max(latest, glyph.end), glyphs[0].end),
});

/** 一句歌词 → 词块：手动分词 → icu-folia → Intl.Segmenter；空格丢掉，标点粘到相邻的词上。 */
const lineTokens = (line: Line, measure: TesseraMeasure): Token[] => {
    const timeline = buildLineGraphemeTimeline(line);
    if (timeline.length === 0) return [];

    let ranges: Array<{ start: number; end: number; space: boolean; wordLike: boolean }> = [];
    let cursor = 0;
    for (const segment of segmentLyricWords(line)) {
        const length = splitLyricGraphemes(segment.segment).length;
        if (length === 0) continue;
        ranges.push({ start: cursor, end: cursor + length, space: segment.segment.trim().length === 0, wordLike: segment.isWordLike });
        cursor += length;
    }
    // 分词和字素对不上（不该发生）时退回逐字。
    if (cursor !== timeline.length) {
        ranges = timeline.map((glyph, index) => ({
            start: index,
            end: index + 1,
            space: glyph.char.trim().length === 0,
            wordLike: /[\p{L}\p{N}]/u.test(glyph.char),
        }));
    }

    const groups: Array<{ start: number; end: number }> = [];
    // 还没有词可以粘的标点（句首、空格后）：从哪开始、到哪结束。
    let pendingLead: number | null = null;
    let pendingEnd = 0;
    let afterSpace = true;
    for (const range of ranges) {
        if (range.space) {
            // 标点后面隔着空格：它粘不到后面的词上（不然空格会被并进词块），自成一块。
            if (pendingLead !== null) {
                groups.push({ start: pendingLead, end: pendingEnd });
                pendingLead = null;
            }
            afterSpace = true;
            continue;
        }
        const previous = groups.length > 0 ? groups[groups.length - 1] : null;
        if (!range.wordLike && previous && !afterSpace && previous.end === range.start) {
            previous.end = range.end;
        } else if (!range.wordLike) {
            pendingLead ??= range.start;
            pendingEnd = range.end;
        } else {
            groups.push({ start: pendingLead ?? range.start, end: range.end });
            pendingLead = null;
        }
        afterSpace = false;
    }
    // 句尾只剩标点（或整句都是标点）：自成一块。
    if (pendingLead !== null) groups.push({ start: pendingLead, end: pendingEnd });

    const tokens: Token[] = [];
    for (const group of groups) {
        const glyphs = timeline.slice(group.start, group.end).map(({ char, startTime, endTime }) => ({ char, start: startTime, end: endTime }));
        const text = glyphs.map(glyph => glyph.char).join('');
        const perCell = glyphs.every(glyph => glyph.char.trim().length > 0 && measure(glyph.char) >= WIDE_GLYPH_EM);
        if (perCell) {
            let offset = 0;
            for (const size of balancedSizes(glyphs.length, MAX_PIECE_CELLS)) {
                const part = glyphs.slice(offset, offset + size);
                offset += size;
                tokens.push(makeToken(part, true, size));
            }
        } else {
            const cells = Math.max(1, Math.ceil(measure(text) * TESSERA_FONT_RATIO + CELL_PAD));
            tokens.push(makeToken(glyphs, false, cells));
        }
    }
    return tokens;
};

/** 一句歌词切成的词块（给单测看分词、粘标点的结果）。 */
export const tesseraLineTokenTexts = (line: Line, measure: TesseraMeasure): string[] => (
    lineTokens(line, measure).map(token => token.text)
);

/**
 * 把一句的词块按词的边界切成 parts 段，各段长度尽量接近平均值、都不超过 width。
 * 返回每段的起始下标；切不出来（某块比 width 还长之外的情况）返回 null。
 */
const partitionCells = (cells: number[], parts: number, width: number): number[] | null => {
    const count = cells.length;
    if (parts > count) return null;
    const prefix = [0];
    for (const value of cells) prefix.push(prefix[prefix.length - 1] + value);
    const target = prefix[count] / parts;
    // cost[j][i]：前 i 块切成 j 段的最小代价；from 记下最后一段的起点。
    const cost = Array.from({ length: parts + 1 }, () => new Array<number>(count + 1).fill(Infinity));
    const from = Array.from({ length: parts + 1 }, () => new Array<number>(count + 1).fill(-1));
    cost[0][0] = 0;
    for (let j = 1; j <= parts; j += 1) {
        for (let i = j; i <= count; i += 1) {
            for (let k = j - 1; k < i; k += 1) {
                if (cost[j - 1][k] === Infinity) continue;
                const length = prefix[i] - prefix[k];
                // 单块比整行还宽时只能独占一行（画的时候缩字号）。
                if (length > width && i - k > 1) continue;
                const value = cost[j - 1][k] + (length - target) ** 2;
                if (value < cost[j][i]) {
                    cost[j][i] = value;
                    from[j][i] = k;
                }
            }
        }
    }
    if (cost[parts][count] === Infinity) return null;
    const starts: number[] = [];
    let end = count;
    for (let j = parts; j > 0; j -= 1) {
        const start = from[j][end];
        starts.unshift(start);
        end = start;
    }
    return starts;
};

/** 一句在 width 列宽下切成几段、从哪切：段数从刚好装得下开始往上试。 */
const splitLine = (cells: number[], width: number): number[] => {
    const total = cells.reduce((sum, value) => sum + value, 0);
    for (let parts = Math.max(1, Math.ceil(total / width)); parts <= cells.length; parts += 1) {
        const starts = partitionCells(cells, parts, width);
        if (starts) return starts;
    }
    return cells.map((_, index) => index);
};

const segmentLengths = (cells: number[], starts: number[]): number[] => starts.map((start, index) => {
    const end = starts[index + 1] ?? cells.length;
    let length = 0;
    for (let k = start; k < end; k += 1) length += cells[k];
    return length;
});

/**
 * 选棋盘宽度：垫块越少越好（长度大致相等），多切一段要付一点代价，再轻轻偏向 11 列左右。
 * 句子之间不合并：一行的结束就是一句（或一段）的结束。
 */
const chooseColumns = (lines: number[][]): number => {
    let best = PREFERRED_COLUMNS;
    let bestCost = Infinity;
    for (let width = MIN_COLUMNS; width <= MAX_COLUMNS; width += 1) {
        let cost = 0;
        for (const cells of lines) {
            const lengths = segmentLengths(cells, splitLine(cells, width));
            for (const length of lengths) cost += Math.max(0, width - length);
            cost += (lengths.length - 1) * 3;
        }
        cost += lines.length * 0.25 * Math.abs(width - PREFERRED_COLUMNS);
        if (cost < bestCost) {
            bestCost = cost;
            best = width;
        }
    }
    return best;
};

// ---------------------------------------------------------------------------------------------
// 拼形状：每行由若干“单元”（一个词块，或一格垫块）组成，单元是拼方块的最小单位，词不会被拆开。

interface Unit {
    kind: 'token' | 'filler';
    col: number;
    cells: number;
    token: Token | null;
    /** 这一行最后一个词：它落地这一行才满，所以它只能自己当底、不能被上一行预先填掉。 */
    isLast: boolean;
    /** 落地时间；还没分给方块时是 null。 */
    land: number | null;
}

interface RowDraft {
    tokens: Token[];
    length: number;
    firstStart: number;
    lastEnd: number;
}

interface PieceDraft {
    members: Array<{ row: number; unit: Unit }>;
    baseRow: number;
    land: number;
    /** 当底的词：下落时长按它算；只带垫块的方块没有。 */
    baseToken: Token | null;
    shape: string;
}

/** 一种长法：底行用哪些单元、上一行用哪些单元、拼出什么形状、值多少分。 */
interface Growth {
    lower: Unit[];
    upper: Unit[];
    shape: string;
    score: number;
}

/** 格子集合挪到左下角对齐后的字符串，形状相同就相同。 */
const cellKey = (cells: Array<[number, number]>): string => {
    const minX = Math.min(...cells.map(([x]) => x));
    const minY = Math.min(...cells.map(([, y]) => y));
    return cells.map(([x, y]) => `${x - minX},${y - minY}`).sort().join(' ');
};

/** 四格方块的七种形状，按四个方向都转一遍记下来：格子集合（排序后的字符串）→ 名字。 */
const TETROMINO_KEYS = (() => {
    const shapes: Record<string, Array<[number, number]>> = {
        I: [[0, 0], [1, 0], [2, 0], [3, 0]],
        O: [[0, 0], [1, 0], [0, 1], [1, 1]],
        T: [[0, 0], [1, 0], [2, 0], [1, 1]],
        S: [[0, 0], [1, 0], [1, 1], [2, 1]],
        Z: [[1, 0], [2, 0], [0, 1], [1, 1]],
        J: [[0, 0], [1, 0], [2, 0], [0, 1]],
        L: [[0, 0], [1, 0], [2, 0], [2, 1]],
    };
    const keys = new Map<string, string>();
    for (const [name, cells] of Object.entries(shapes)) {
        let current = cells;
        for (let turn = 0; turn < 4; turn += 1) {
            keys.set(cellKey(current), name);
            current = current.map(([x, y]) => [y, -x]);
        }
    }
    return keys;
})();

/** 格子集合的形状名：四格按七种方块，其余按格数（三格分直的和拐的）。y 向上。 */
const classifyShape = (cells: Array<[number, number]>): string => {
    if (cells.length === 4) return TETROMINO_KEYS.get(cellKey(cells)) ?? 'x4';
    if (cells.length === 3) {
        const straight = cells.every(([, y]) => y === cells[0][1]) || cells.every(([x]) => x === cells[0][0]);
        return straight ? 'i3' : 'v3';
    }
    return `x${cells.length}`;
};

const unitCells = (units: Unit[], y: number): Array<[number, number]> => units.flatMap(unit => (
    Array.from({ length: unit.cells }, (_, index): [number, number] => [unit.col + index, y])
));

const landAt = (units: Unit[], col: number): number | null => {
    for (const unit of units) {
        if (col >= unit.col && col < unit.col + unit.cells) return unit.land;
    }
    return null;
};

/** 0–1 的确定性小散列：同分时挑哪一种。 */
const jitter = (a: number, b: number) => ((a * 7919 + b * 104729) % 1000) / 100000;

/**
 * 给一个底（一个词，或一段垫块）挑长法：左右带上相邻的垫块，上面带上一段上一行的单元。
 * 上一行的单元必须整段落在底的正上方或已经落地的格子上方（底下有东西托着），并和底在同一列上挨着。
 * 形状尽量凑满四格、尽量换没出现过几次的形状、尽量预先填下一句的词。
 */
const chooseGrowth = (
    lower: Unit[],
    upper: Unit[] | null,
    base: Unit[],
    time: number,
    usage: Map<string, number>,
    seed: number,
    allowSideFillers: boolean,
): Growth => {
    const first = lower.indexOf(base[0]);
    const last = lower.indexOf(base[base.length - 1]);
    const baseCells = base.reduce((sum, unit) => sum + unit.cells, 0);
    const leftFillers: Unit[] = [];
    const rightFillers: Unit[] = [];
    if (allowSideFillers) {
        for (let index = first - 1; index >= 0 && lower[index].kind === 'filler' && lower[index].land === null; index -= 1) {
            leftFillers.push(lower[index]);
        }
        for (let index = last + 1; index < lower.length && lower[index].kind === 'filler' && lower[index].land === null; index += 1) {
            rightFillers.push(lower[index]);
        }
    }

    const evaluate = (lowerUnits: Unit[], upperUnits: Unit[]): Growth => {
        const cells = [...unitCells(lowerUnits, 0), ...unitCells(upperUnits, 1)];
        const shape = classifyShape(cells);
        const size = cells.length;
        const textUp = upperUnits.filter(unit => unit.kind === 'token').length;
        const score = (size === 4 ? 3 : size === 3 ? 1.2 : size === 2 ? 0.3 : 0)
            + 2 / (1 + (usage.get(shape) ?? 0))
            + textUp * 0.8
            + jitter(seed, cells.length + upperUnits.length * 5 + lowerUnits.length * 11);
        return { lower: lowerUnits, upper: upperUnits, shape, score };
    };
    let best = evaluate(base, []);
    const consider = (lowerUnits: Unit[], upperUnits: Unit[]) => {
        const growth = evaluate(lowerUnits, upperUnits);
        if (growth.score > best.score) best = growth;
    };

    for (let left = 0; left <= leftFillers.length; left += 1) {
        for (let right = 0; right <= rightFillers.length; right += 1) {
            const lowerSize = baseCells + left + right;
            if (lowerSize > MAX_PIECE_CELLS && (left > 0 || right > 0)) continue;
            const lowerUnits = [...leftFillers.slice(0, left).reverse(), ...base, ...rightFillers.slice(0, right)];
            const lo = lowerUnits[0].col;
            const hi = lowerUnits[lowerUnits.length - 1].col + lowerUnits[lowerUnits.length - 1].cells;
            consider(lowerUnits, []);
            if (!upper) continue;
            const supported = (col: number) => (col >= lo && col < hi) || (landAt(lower, col) ?? Infinity) <= time;
            for (let from = 0; from < upper.length; from += 1) {
                let size = lowerSize;
                for (let to = from; to < upper.length; to += 1) {
                    const unit = upper[to];
                    if (unit.land !== null || unit.isLast) break;
                    size += unit.cells;
                    if (size > MAX_PIECE_CELLS) break;
                    let held = true;
                    for (let col = unit.col; col < unit.col + unit.cells; col += 1) held &&= supported(col);
                    if (!held) break;
                    const runLo = upper[from].col;
                    const runHi = unit.col + unit.cells;
                    if (runLo < hi && lo < runHi) consider(lowerUnits, upper.slice(from, to + 1));
                }
            }
        }
    }
    return best;
};

const claim = (growth: Growth, time: number) => {
    for (const unit of growth.lower) unit.land = time;
    for (const unit of growth.upper) unit.land = time;
};

/**
 * 排一行：先按唱的顺序给每个还没被预先填掉的词挑长法（它落地的时间就是它唱完的时间），
 * 再把剩下的垫块拼成只带垫块的方块，夹在相邻的词块之间落下。
 * 会改动 lower / upper 里单元的 land；试排时传进来的是副本。
 * upperDeadline 是上一行唱完的时间：比它还晚落地的方块不往上一行预填，不然上一行会被拖到这块落地才满
 * （对唱、和声这种时间重叠、后一句先唱完的歌词）。
 */
const planRow = (
    lower: Unit[],
    upper: Unit[] | null,
    upperDeadline: number,
    below: Unit[] | null,
    rowIndex: number,
    usage: Map<string, number>,
): { pieces: PieceDraft[]; score: number } => {
    const pieces: PieceDraft[] = [];
    let score = 0;
    let previousLand = -Infinity;
    const prefilledLand = lower.reduce((latest, unit) => (unit.land === null ? latest : Math.max(latest, unit.land)), -Infinity);

    const bases = lower.filter(unit => unit.kind === 'token' && unit.land === null);
    bases.forEach((base, index) => {
        const token = base.token;
        if (!token) return;
        let time = Math.max(previousLand, token.end);
        if (base.isLast) time = Math.max(time, prefilledLand);
        previousLand = time;
        const growth = chooseGrowth(lower, time <= upperDeadline ? upper : null, [base], time, usage, rowIndex * 31 + index, true);
        claim(growth, time);
        usage.set(growth.shape, (usage.get(growth.shape) ?? 0) + 1);
        score += growth.score;
        pieces.push({
            members: [...growth.lower.map(unit => ({ row: rowIndex, unit })), ...growth.upper.map(unit => ({ row: rowIndex + 1, unit }))],
            baseRow: rowIndex,
            land: time,
            baseToken: token,
            shape: growth.shape,
        });
    });

    // 剩下的垫块：连续的一段切成 ≤4 格，各自可以往上带上一行的单元。
    const lastLand = previousLand;
    let run: Unit[] = [];
    const runs: Unit[][] = [];
    for (const unit of lower) {
        if (unit.kind === 'filler' && unit.land === null) {
            run.push(unit);
        } else if (run.length > 0) {
            runs.push(run);
            run = [];
        }
    }
    if (run.length > 0) runs.push(run);

    runs.flatMap(fillers => {
        let offset = 0;
        return balancedSizes(fillers.length, MAX_PIECE_CELLS).map(size => {
            const chunk = fillers.slice(offset, offset + size);
            offset += size;
            return chunk;
        });
    }).forEach((chunk, index) => {
        // 落地时间：夹在列上离它最近的词块前后；要等下面一行同一列的格子落了；不晚于这一行最后一块。
        const lo = chunk[0].col;
        const hi = lo + chunk.length;
        let nearest: { distance: number; land: number; left: boolean } | null = null;
        for (const piece of pieces) {
            for (const member of piece.members) {
                if (member.row !== rowIndex) continue;
                const left = member.unit.col >= hi;
                const distance = left ? member.unit.col - hi : lo - (member.unit.col + member.unit.cells);
                if (!nearest || distance < nearest.distance) nearest = { distance, land: piece.land, left };
            }
        }
        let time = nearest ? nearest.land + (nearest.left ? -FILLER_LAND_OFFSET : FILLER_LAND_OFFSET) : lastLand;
        if (below) {
            for (let col = lo; col < hi; col += 1) time = Math.max(time, landAt(below, col) ?? -Infinity);
        }
        time = Math.min(time, lastLand);
        const growth = chooseGrowth(lower, time <= upperDeadline ? upper : null, chunk, time, usage, rowIndex * 37 + index, false);
        claim(growth, time);
        usage.set(growth.shape, (usage.get(growth.shape) ?? 0) + 1);
        score += growth.score;
        pieces.push({
            members: [...growth.lower.map(unit => ({ row: rowIndex, unit })), ...growth.upper.map(unit => ({ row: rowIndex + 1, unit }))],
            baseRow: rowIndex,
            land: time,
            baseToken: null,
            shape: growth.shape,
        });
    });

    return { pieces, score };
};

/** 一行的单元：左边 offset 格垫块，然后按顺序摆词，右边补垫块。 */
const buildUnits = (draft: RowDraft, offset: number, columns: number): Unit[] => {
    const units: Unit[] = [];
    const filler = (col: number): Unit => ({ kind: 'filler', col, cells: 1, token: null, isLast: false, land: null });
    for (let col = 0; col < offset; col += 1) units.push(filler(col));
    let col = offset;
    draft.tokens.forEach((token, index) => {
        units.push({ kind: 'token', col, cells: token.cells, token, isLast: index === draft.tokens.length - 1, land: null });
        col += token.cells;
    });
    for (; col < columns; col += 1) units.push(filler(col));
    return units;
};

const cloneUnits = (units: Unit[]) => units.map(unit => ({ ...unit }));

/** 出生时转不转：确定性的散列，同一首歌每次都一样。 */
const spawnRotation = (pieceIndex: number, cells: number): -1 | 0 | 1 => {
    if (cells < 2) return 0;
    const hash = (pieceIndex * 13 + cells * 5) % 5;
    if (hash === 0) return 1;
    if (hash === 3) return -1;
    return 0;
};

const toBlocks = (row: number, unit: Unit): TesseraBlock[] => {
    if (unit.kind === 'filler' || !unit.token) {
        return [{ row, col: unit.col, cells: 1, kind: 'filler', text: '', glyphs: [] }];
    }
    const token = unit.token;
    if (token.perCell) {
        return token.glyphs.map((glyph, index) => ({ row, col: unit.col + index, cells: 1, kind: 'glyph', text: glyph.char, glyphs: [glyph] }));
    }
    return [{ row, col: unit.col, cells: unit.cells, kind: 'word', text: token.text, glyphs: token.glyphs }];
};

/** 整首歌的排布。measure 给出 em 宽（字号为 1）。 */
export const buildTesseraPlan = (lines: Line[], measure: TesseraMeasure): TesseraPlan => {
    const lineTokenList = lines.map(line => lineTokens(line, measure)).filter(tokens => tokens.length > 0);
    const columns = chooseColumns(lineTokenList.map(tokens => tokens.map(token => token.cells)));
    const boardRows = Math.max(12, Math.min(20, Math.round(columns * 1.35)));

    const drafts: RowDraft[] = [];
    for (const tokens of lineTokenList) {
        for (const token of tokens) token.cells = Math.min(token.cells, columns);
        const starts = splitLine(tokens.map(token => token.cells), columns);
        starts.forEach((start, index) => {
            const segment = tokens.slice(start, starts[index + 1] ?? tokens.length);
            drafts.push({
                tokens: segment,
                length: segment.reduce((sum, token) => sum + token.cells, 0),
                firstStart: segment[0].start,
                lastEnd: segment.reduce((latest, token) => Math.max(latest, token.end), segment[0].end),
            });
        });
    }

    const centered = (draft: RowDraft) => Math.floor((columns - draft.length) / 2);
    const units: Unit[][] = [];
    const pieceDrafts: PieceDraft[] = [];
    const usage = new Map<string, number>();
    drafts.forEach((draft, index) => {
        units[index] ??= buildUnits(draft, centered(draft), columns);
        const next = index + 1 < drafts.length ? drafts[index + 1] : null;
        const below = index > 0 ? units[index - 1] : null;
        if (next && next.firstStart - draft.lastEnd <= PREFILL_GAP) {
            // 下一句摆在哪几列由这里定：每种摆法都试排一遍，挑拼得最好的（轻微偏向居中）。
            let bestOffset = centered(next);
            let bestScore = -Infinity;
            for (let offset = 0; offset <= columns - next.length; offset += 1) {
                const trial = planRow(cloneUnits(units[index]), buildUnits(next, offset, columns), next.lastEnd, below, index, new Map(usage));
                const score = trial.score - 0.4 * Math.abs(offset - centered(next));
                if (score > bestScore) {
                    bestScore = score;
                    bestOffset = offset;
                }
            }
            units[index + 1] = buildUnits(next, bestOffset, columns);
            pieceDrafts.push(...planRow(units[index], units[index + 1], next.lastEnd, below, index, usage).pieces);
        } else {
            pieceDrafts.push(...planRow(units[index], null, Infinity, below, index, usage).pieces);
        }
    });

    const center = columns / 2;
    const pieces: TesseraPiece[] = pieceDrafts.map((draft, index) => {
        const blocks = draft.members.flatMap(({ row, unit }) => toBlocks(row, unit));
        const lo = Math.min(...blocks.map(block => block.col));
        const hi = Math.max(...blocks.map(block => block.col + block.cells));
        // 从靠近中间的位置出生，最多横移三格：几块同时下落时不全挤在正中间。
        const shift = Math.max(-3, Math.min(3, Math.round(center - (lo + hi) / 2)));
        const spawnShift = Math.max(-lo, Math.min(columns - hi, shift));
        const token = draft.baseToken;
        const fall = token ? Math.min(FALL_MAX, Math.max(FALL_MIN, token.end - token.start + FALL_LEAD)) : FILLER_FALL;
        return {
            blocks,
            baseRow: draft.baseRow,
            shape: draft.shape,
            spawnShift,
            rotate: spawnRotation(index, blocks.reduce((sum, block) => sum + block.cells, 0)),
            spawn: draft.land - fall,
            land: draft.land,
            landSlot: 0,
        };
    });

    const rows: TesseraRow[] = drafts.map(() => ({
        blocks: [],
        presenceStart: Infinity,
        end: -Infinity,
        clearEnd: 0,
        dropEnd: 0,
    }));
    for (const piece of pieces) {
        for (const block of piece.blocks) {
            const row = rows[block.row];
            row.blocks.push({ piece, block });
            row.presenceStart = Math.min(row.presenceStart, piece.spawn);
            row.end = Math.max(row.end, piece.land);
        }
    }
    // 一行从出现到满至少隔一次下落（FALL_MIN）：最后一块要从框外落进来，不会一出现就满。
    rows.forEach(row => {
        row.clearEnd = row.end + TESSERA_CLEAR;
        row.dropEnd = row.end + TESSERA_CLEAR + TESSERA_DROP;
    });

    // 落地那一刻底行下面垫着几行（时间上不重叠的行贡献 0）。
    for (const piece of pieces) {
        let slot = 0;
        for (let below = 0; below < piece.baseRow; below += 1) slot += rowPresence(rows[below], piece.land);
        piece.landSlot = slot;
    }

    return { columns, boardRows, rows, pieces };
};
