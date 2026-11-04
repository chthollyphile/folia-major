import { CARD_HEIGHT, CARD_WIDTH, slotPosition, type Point, type Spacing } from './canvasLayout';

// src/components/app/scratchpad/canvasThread.ts
// 播放历史与播放队列的画布上，穿过所有卡片的那条线（画在卡片底下，从卡片之间的空隙里露出来）：
// 按序号从左到右穿过一行卡片的封面中线；一行走完，从行尾拐下去，沿两行之间的空隙折回最左边，再拐进下一行——
// 像打字机换行。播放历史在每张卡前面的空隙里放一个节点（上面写这首几点放的），播放队列在每两张卡之间画一个实心箭头（播放的先后）。
// 线只按格子的序号画，与哪张卡在哪个格子无关：拖动时卡片让位、线不动。全是纯函数，单测直接测；画布把结果写进一个 SVG。

/** 线穿过卡片的高度（相对卡片顶边）：封面的中线（卡片内边距 6px，封面是卡片宽减去两边内边距的正方形）。 */
export const THREAD_LINE_Y = 6 + (CARD_WIDTH - 12) / 2;
/** 拐角的圆角半径。 */
const CORNER_RADIUS = 10;
/** 箭头的半高与长度。 */
const ARROW_HALF = 4.5;
const ARROW_LENGTH = 7;

const rowOf = (index: number, columns: number) => Math.floor(index / columns);

/** 第 index 张卡在线上的那一点（封面中心）。 */
const centerOf = (index: number, columns: number, spacing: Spacing): Point => {
    const slot = slotPosition(index, columns, spacing);
    return { x: slot.x + CARD_WIDTH / 2, y: slot.y + THREAD_LINE_Y };
};

/** 第 row 行与下一行之间那道空隙的中线。 */
const gapLineY = (row: number, spacing: Spacing) => row * (CARD_HEIGHT + spacing.y) + CARD_HEIGHT + spacing.y / 2;

/**
 * 从第 from 张到第 to 张（含两头）的折线顶点。同一行里是一条横线；换行处：行尾那张往右出半个空隙，下到两行之间，
 * 折回最左边（第一列左边半个空隙），再下到下一行，进第一张。from > to 或张数不够时是空的。
 */
export const threadPoints = (count: number, columns: number, spacing: Spacing, from = 0, to = count - 1): Point[] => {
    const last = Math.min(to, count - 1);
    const first = Math.max(0, from);
    if (first > last) return [];
    const points: Point[] = [centerOf(first, columns, spacing)];
    for (let index = first; index < last; index += 1) {
        const next = index + 1;
        const row = rowOf(index, columns);
        if (rowOf(next, columns) === row) continue;
        // 换行：index 是这一行的最后一张。
        const here = centerOf(index, columns, spacing);
        const there = centerOf(next, columns, spacing);
        const right = slotPosition(index, columns, spacing).x + CARD_WIDTH + spacing.x / 2;
        const left = -spacing.x / 2;
        const turnY = gapLineY(row, spacing);
        points.push(here, { x: right, y: here.y }, { x: right, y: turnY }, { x: left, y: turnY }, { x: left, y: there.y });
    }
    points.push(centerOf(last, columns, spacing));
    // 同一行相邻的顶点在一条横线上：合并掉中间多余的（第一张与换行处的那一点可能重复）。
    return points.filter((point, index) => {
        const previous = points[index - 1];
        return !previous || previous.x !== point.x || previous.y !== point.y;
    });
};

/** 折线画成 SVG 路径，拐角处按 radius 倒圆（拐角两边太短时半径跟着缩）。 */
export const roundedPath = (points: readonly Point[], radius = CORNER_RADIUS): string => {
    if (points.length === 0) return '';
    const round = (value: number) => Math.round(value * 10) / 10;
    let d = `M${round(points[0].x)} ${round(points[0].y)}`;
    for (let index = 1; index < points.length; index += 1) {
        const point = points[index];
        const next = points[index + 1];
        if (!next) {
            d += ` L${round(point.x)} ${round(point.y)}`;
            break;
        }
        const previous = points[index - 1];
        const inLength = Math.hypot(point.x - previous.x, point.y - previous.y);
        const outLength = Math.hypot(next.x - point.x, next.y - point.y);
        const r = Math.min(radius, inLength / 2, outLength / 2);
        if (r <= 0) {
            d += ` L${round(point.x)} ${round(point.y)}`;
            continue;
        }
        const before = { x: point.x - ((point.x - previous.x) / inLength) * r, y: point.y - ((point.y - previous.y) / inLength) * r };
        const after = { x: point.x + ((next.x - point.x) / outLength) * r, y: point.y + ((next.y - point.y) / outLength) * r };
        d += ` L${round(before.x)} ${round(before.y)} Q${round(point.x)} ${round(point.y)} ${round(after.x)} ${round(after.y)}`;
    }
    return d;
};

/**
 * 一个朝 direction（1 向右、-1 向左）的实心箭头，尖在 tip：一个扁三角形，靠描边的圆角收圆（画布给它同色的填充与描边）。
 */
const arrowHead = (tip: Point, direction: 1 | -1) => {
    const back = tip.x - direction * ARROW_LENGTH;
    return `M${back} ${tip.y - ARROW_HALF} L${tip.x} ${tip.y} L${back} ${tip.y + ARROW_HALF} Z`;
};

/**
 * 第 from 张到第 to 张之间每一步的箭头：同一行两张之间的空隙正中一个朝右的；换行时在两行之间折回的那段正中一个朝左的。
 */
export const threadArrows = (count: number, columns: number, spacing: Spacing, from = 0, to = count - 1): string => {
    const last = Math.min(to, count - 1);
    const parts: string[] = [];
    for (let index = Math.max(0, from); index < last; index += 1) {
        const here = slotPosition(index, columns, spacing);
        const row = rowOf(index, columns);
        if (rowOf(index + 1, columns) === row) {
            parts.push(arrowHead({ x: here.x + CARD_WIDTH + spacing.x / 2 + ARROW_LENGTH / 2, y: here.y + THREAD_LINE_Y }, 1));
        } else {
            // 往回折的那一段从行尾（right）到最左边（-spacing.x / 2），箭头放在它的正中。
            const right = here.x + CARD_WIDTH + spacing.x / 2;
            const middle = (right - spacing.x / 2) / 2;
            parts.push(arrowHead({ x: middle - ARROW_LENGTH / 2, y: gapLineY(row, spacing) }, -1));
        }
    }
    return parts.join(' ');
};

/** 时间轴的节点：第 from 张到第 to 张每张卡左边空隙正中的那一点（节点上写这首放的时间）。 */
export const threadNodes = (count: number, columns: number, spacing: Spacing, from = 0, to = count - 1): Point[] => {
    const last = Math.min(to, count - 1);
    const nodes: Point[] = [];
    for (let index = Math.max(0, from); index <= last; index += 1) {
        const slot = slotPosition(index, columns, spacing);
        nodes.push({ x: slot.x - spacing.x / 2, y: slot.y + THREAD_LINE_Y });
    }
    return nodes;
};
