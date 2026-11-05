import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SquareCheck, X } from 'lucide-react';
import ScratchpadCard, { type CanvasEntry, type CardMotion } from './ScratchpadCard';
import ScratchpadGroupHeader from './ScratchpadGroupHeader';
import {
    CARD_HEIGHT,
    CONTENT_EDGE,
    DEFAULT_SPACING,
    cardRect,
    columnsFor,
    dropIndexAt,
    gridHeight,
    previewSlots,
    rectFromPoints,
    rectsIntersect,
    slotPosition,
    type Point,
    type Rect,
    type Spacing,
} from './canvasLayout';
import { roundedPath, threadArrows, threadNodes, threadPoints } from './canvasThread';
import type { ScratchpadAction } from './scratchpadModel';

// src/components/app/scratchpad/ScratchpadCanvas.tsx
// 抽屉展开后的卡片画布（设计稿 plan/scratchpad-spec.md「画布的交互细则」），速记簿、播放历史、播放队列三页共用：
// 分组、组头按钮、选中后的菜单、能不能拖都由调用方给。每组一块卡片网格：
// - 拖动（鼠标、笔；只有给了 onMove 时）：按下卡片走过 4px 才算拖；卡片跟着指针走（直接写它的 MotionValue），同组其余卡片
//   实时让出落点；松手吸附到最近的索引位（onMove）。拖的是已选中的卡时，同组选中的一起挪；卡片不跨组。
// - 拖动（触屏）：手指按住卡片不动 0.4 秒拿起来（轻震一下），之后和鼠标一样拖；没拿起来之前手指一划就是滚动画布。
//   拿起来之后画布不再跟着手指滚（touchmove 被拦下）。
// - 框选：在空白处按下拖出矩形，碰到的卡片选中；Shift / Ctrl 追加。单击卡片选它一张，Ctrl 单击切换，Shift 单击选到上一次点的那张。
//   触屏上没有框选：已经有选中的卡时，点一下卡片是加选 / 取消（手机上多选的习惯），没有时点一下选它一张。
// - 选中后在选中的卡片上方浮出一个菜单（按钮由调用方给）与「取消选择」；拖动、框选进行中先收起，滚动时留在看得见的地方。
//   Delete 交给 onDelete，Ctrl+A 全选，Esc 先取消选择、再交给抽屉收起。
// - 穿线（组的 thread）：播放历史一条时间轴、播放队列一条带箭头的线穿过组里所有卡片（canvasThread），画在卡片底下。
// - 卡片多（播放队列可能上千首）时只挂看得见的那几行附近的卡片：滚动时按 400px 一档换，档没变不重渲染。
// 指针移动里只 set MotionValue 和直接改框选框的样式；进 React state 的只有离散的落点序号、选择集与可见的那一档（变了才 set）。

/** 穿过一组卡片的线：时间轴（每张卡前一个刻度）或播放的先后（每一步一个箭头）。 */
export type CanvasThread =
    /** labels：每张卡节点上写的字（这首几点放的），按组里的序号。 */
    | { kind: 'timeline'; labels: readonly string[] }
    /** playedThrough：这一序号（含）之前是放过的，那一段画淡；-1 是都还没放。 */
    | { kind: 'flow'; playedThrough: number };

export type CanvasGroup<E extends CanvasEntry = CanvasEntry> = {
    key: string;
    label: string;
    entries: E[];
    /** 组头上「选中本组」之后的按钮。 */
    buttons?: ScratchpadAction[];
    thread?: CanvasThread;
};

type ScratchpadCanvasProps<E extends CanvasEntry> = {
    groups: CanvasGroup<E>[];
    freshKeys?: ReadonlySet<string>;
    /** 画布顶上的一行说明。 */
    hint: string;
    ariaLabel: string;
    testId?: string;
    /** 卡片上播放钮的名字。 */
    playLabel: string;
    onPlay: (entry: E) => void;
    /** 有它才能拖：把 keys（同一组）挪到组里剩下的卡之间第 targetIndex 个位置。 */
    onMove?: (groupKey: string, keys: string[], targetIndex: number) => void;
    /** 一次拖动开始 / 结束（不论有没有放下；放下时 onMove 在结束之后）。 */
    onDragStart?: () => void;
    onDragEnd?: () => void;
    /** 有选中时按 Delete。 */
    onDelete?: (entries: E[]) => void;
    /** 选中后浮动菜单里的按钮。 */
    selectionActions: (entries: E[]) => ScratchpadAction[];
    /** 没有选择时按 Esc：交给抽屉（收回列表）。 */
    onEscape: () => void;
    spacing?: Spacing;
    /** 打开时把这张卡滚到看得见的地方（播放队列里正在播的那首）。 */
    focusKey?: string;
    /** 画布底下的整本动作（速记簿有）。 */
    footer?: React.ReactNode;
};

/** 按下之后走过这么远才算拖（以内是点击）。 */
const DRAG_THRESHOLD = 4;
/** 手指按住卡片多久拿起来。 */
const LONG_PRESS_MS = 400;
/** 手指按住期间走过这么远就算在滚动（拿起来之前）。比鼠标的门槛宽：手指按着总会抖一点。 */
const TOUCH_SLOP = 10;
/** 一起被拖的几张卡错开叠放的距离。 */
const STACK_OFFSET = 6;
/** 一起拖的卡最多画几张叠在指针下（其余的只在按下那张的角标上算个数）。 */
const STACK_VISIBLE = 5;
/** 浮动菜单与选中卡片之间的空隙，以及它离画布内容上边至少要留出的高度（不够就放到卡片下面）。 */
const MENU_GAP = 8;
const MENU_ROOM_ABOVE = 52;
/** 只挂看得见的卡片：可见范围上下各多挂这么高，按这么大一档换。 */
const WINDOW_OVERSCAN = 800;
const WINDOW_STEP = 400;

type Press = {
    entry: CanvasEntry;
    groupKey: string;
    pointerId: number;
    start: Point;
    /** 指针相对卡片左上角的位置（拖动时保持不变）。 */
    grab: Point;
    modifiers: { shift: boolean; toggle: boolean };
    dragging: boolean;
    /** 手指按的：拿起来之前一划就是滚动；拿起来要按住 LONG_PRESS_MS。 */
    isTouch: boolean;
    /** 手指按住时等着拿起来的计时器。 */
    longPress?: number;
};

/**
 * moving 是要挪的全部卡；跟着指针走、画出来的只有 stack（按下的那张在最前，再叠几张）：选了几百张一起拖时，
 * 不挂几百张卡、不每次移动写几百个 MotionValue。其余要挪的卡在拖动期间不画，松手后在新格子里挂回来。
 */
type Drag = { groupKey: string; moving: ReadonlySet<string>; stack: readonly string[]; dropIndex: number };

type Marquee = {
    pointerId: number;
    start: Point;
    base: ReadonlySet<string>;
    moved: boolean;
    /** 框选开始时各组网格原点（内容坐标）与它们的条目。 */
    grids: { origin: Point; keys: string[] }[];
    /** 还没处理的最近一次指针位置（视口坐标）：指针事件可能一帧来好几次（高回报率的鼠标上千次每秒），每帧只算一次。 */
    pending: { clientX: number; clientY: number } | null;
    frame: number;
};

/** 浮动菜单落在哪：选中卡片的外框中线上，外框上方（或放不下时下方）。内容坐标。 */
type MenuAnchor = { centerX: number; y: number; placement: 'above' | 'below' };

/** 挂卡片的那一档（内容坐标）。 */
type Band = { top: number; bottom: number };

const NO_KEYS: ReadonlySet<string> = new Set();

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every(key => b.has(key));

const bandOf = (scrollTop: number, height: number): Band => ({
    top: Math.floor((scrollTop - WINDOW_OVERSCAN) / WINDOW_STEP) * WINDOW_STEP,
    bottom: Math.ceil((scrollTop + height + WINDOW_OVERSCAN) / WINDOW_STEP) * WINDOW_STEP,
});

/** 时间轴节点上那块小牌子的宽、高（写得下「23:59」）。 */
const NODE_WIDTH = 44;
const NODE_HEIGHT = 18;

/**
 * 一组的线。时间轴：一条线，每张卡前面一个写着这首几点放的小牌子；先后：放过的一段（淡）、没放的一段各一条线，加实心箭头。
 * SVG 铺满画布内容的左右留白（edge）：拐弯与第一列前面的节点伸出网格，但不出内容区，不撑出横向滚动条。
 */
const ThreadLayer = memo<{ thread: CanvasThread; count: number; columns: number; spacing: Spacing; height: number }>(({
    thread,
    count,
    columns,
    spacing,
    height,
}) => {
    const paths = useMemo(() => {
        if (thread.kind === 'timeline') {
            return { line: roundedPath(threadPoints(count, columns, spacing)), marks: '', played: '', playedMarks: '', nodes: threadNodes(count, columns, spacing) };
        }
        const split = Math.min(Math.max(thread.playedThrough, -1), count - 1);
        return {
            played: split > 0 ? roundedPath(threadPoints(count, columns, spacing, 0, split)) : '',
            playedMarks: split > 0 ? threadArrows(count, columns, spacing, 0, split) : '',
            line: roundedPath(threadPoints(count, columns, spacing, Math.max(0, split), count - 1)),
            marks: threadArrows(count, columns, spacing, Math.max(0, split), count - 1),
            nodes: [],
        };
    }, [columns, count, spacing, thread]);
    const edge = spacing.edge ?? CONTENT_EDGE;
    return (
        <svg
            className={`scratchpad-thread is-${thread.kind}`}
            aria-hidden="true"
            height={height}
            style={{ left: -edge, width: `calc(100% + ${edge * 2}px)` }}
        >
            <g transform={`translate(${edge} 0)`}>
                {/* 线和箭头放在一组里、整组一起变淡：分开各自半透明的话，线会从箭头里透出来。 */}
                {paths.played && (
                    <g className="scratchpad-thread-run is-played">
                        <path className="scratchpad-thread-line" d={paths.played} />
                        {paths.playedMarks && <path className="scratchpad-thread-marks" d={paths.playedMarks} />}
                    </g>
                )}
                <g className="scratchpad-thread-run">
                    <path className="scratchpad-thread-line" d={paths.line} />
                    {paths.marks && <path className="scratchpad-thread-marks" d={paths.marks} />}
                </g>
                {thread.kind === 'timeline' && paths.nodes.map((node, index) => (
                    <g key={index} className="scratchpad-thread-node" transform={`translate(${node.x} ${node.y})`}>
                        <rect x={-NODE_WIDTH / 2} y={-NODE_HEIGHT / 2} width={NODE_WIDTH} height={NODE_HEIGHT} rx={NODE_HEIGHT / 2} />
                        <text textAnchor="middle" dominantBaseline="central">{thread.labels[index] ?? ''}</text>
                    </g>
                ))}
            </g>
        </svg>
    );
});

function ScratchpadCanvas<E extends CanvasEntry>({
    groups,
    freshKeys = NO_KEYS,
    hint,
    ariaLabel,
    testId = 'scratchpad-canvas',
    playLabel,
    onPlay,
    onMove,
    onDragStart,
    onDragEnd,
    onDelete,
    selectionActions,
    onEscape,
    spacing = DEFAULT_SPACING,
    focusKey,
    footer,
}: ScratchpadCanvasProps<E>) {
    const { t } = useTranslation();
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const marqueeRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const gridRefs = useRef(new Map<string, HTMLDivElement>());
    const motions = useRef(new Map<string, CardMotion>());
    const pressRef = useRef<Press | null>(null);
    // 拖动状态的即时值（指针事件里读写），drag state 只是它的离散快照，用来重排让位的卡片。
    const dragRef = useRef<Drag | null>(null);
    const marqueeStateRef = useRef<Marquee | null>(null);
    const anchorRef = useRef<string | null>(null);

    const [columns, setColumns] = useState(1);
    const [drag, setDrag] = useState<Drag | null>(null);
    const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
    const [isBoxSelecting, setIsBoxSelecting] = useState(false);
    const [menu, setMenu] = useState<MenuAnchor | null>(null);
    // 画布滚动、改变大小时加一：浮动菜单据此重新落位（只在有选中时才加，免得滚动时整块画布跟着重渲染）。
    const [viewTick, setViewTick] = useState(0);
    const [band, setBand] = useState<Band>(() => bandOf(0, typeof window === 'undefined' ? 1200 : window.innerHeight));
    // 各组网格的顶边（内容坐标）：只挂看得见的卡片时按它算每一行在哪。
    const [gridTops, setGridTops] = useState<ReadonlyMap<string, number>>(() => new Map());
    const hasSelectionRef = useRef(false);
    hasSelectionRef.current = selected.size > 0;

    const entries = useMemo(() => groups.flatMap(group => group.entries), [groups]);
    const groupOf = useMemo(() => {
        const map = new Map<string, CanvasGroup<E>>();
        for (const group of groups) for (const entry of group.entries) map.set(entry.key, group);
        return map;
    }, [groups]);

    // 计时器里（手指按住 0.4 秒之后）读的是这一刻的值，不是按下那一刻的。
    const latest = useRef({ groupOf, columns, selected, spacing, onMove, onDragStart, onDragEnd });
    latest.current = { groupOf, columns, selected, spacing, onMove, onDragStart, onDragEnd };

    // 条目被移走（这里删的、别处删的）时，选择里也去掉它们。
    useEffect(() => {
        setSelected(current => {
            const next = new Set([...current].filter(key => groupOf.has(key)));
            return next.size === current.size ? current : next;
        });
    }, [groupOf]);

    // 列数随画布宽度：ResizeObserver 里只在列数真的变了时 set。
    useLayoutEffect(() => {
        const element = scrollRef.current;
        if (!element) return;
        const measure = () => {
            // 藏起来（display: none）时宽度是 0：不当成一列，免得回来时所有卡片从一列弹回网格。
            if (element.clientWidth === 0) return;
            const next = columnsFor(element.clientWidth - (latest.current.spacing.edge ?? CONTENT_EDGE) * 2, latest.current.spacing);
            setColumns(current => (current === next ? current : next));
            const nextBand = bandOf(element.scrollTop, element.clientHeight);
            setBand(current => (current.top === nextBand.top && current.bottom === nextBand.bottom ? current : nextBand));
            if (hasSelectionRef.current) setViewTick(current => current + 1);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // 各组网格的顶边：组、列数变了（网格高度跟着变）之后量一次，变了才 set。
    useLayoutEffect(() => {
        const next = new Map<string, number>();
        for (const group of groups) {
            const grid = gridRefs.current.get(group.key);
            if (grid) next.set(group.key, grid.offsetTop);
        }
        setGridTops(current => (
            current.size === next.size && [...next].every(([key, top]) => current.get(key) === top) ? current : next
        ));
    }, [columns, groups]);

    // 打开时滚到 focusKey 那张卡（量到网格顶边之后，只做一次）：它落在可视高度的三分之一处。
    const didFocusRef = useRef(false);
    useLayoutEffect(() => {
        if (didFocusRef.current || !focusKey) return;
        const group = groupOf.get(focusKey);
        const scroller = scrollRef.current;
        const gridTop = group ? gridTops.get(group.key) : undefined;
        if (!group || !scroller || gridTop === undefined) return;
        didFocusRef.current = true;
        const index = group.entries.findIndex(entry => entry.key === focusKey);
        const top = gridTop + slotPosition(index, columns, spacing).y;
        scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 3);
    }, [columns, focusKey, gridTops, groupOf, spacing]);

    // 手指拿起卡片之后，拦下 touchmove，画布不再跟着手指滚（卡片上是 touch-action: pan-y，只能这样收回来）。
    // React 的 onTouchMove 是被动监听，拦不住，所以直接挂原生的。
    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;
        const holdStill = (event: TouchEvent) => {
            if (dragRef.current && event.cancelable) event.preventDefault();
        };
        element.addEventListener('touchmove', holdStill, { passive: false });
        return () => element.removeEventListener('touchmove', holdStill);
    }, []);

    // 滚动：每帧至多一次——换挂卡片的那一档（档变了才 set），有选中时浮动菜单重新落位。
    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;
        let frame = 0;
        const onScroll = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                const nextBand = bandOf(element.scrollTop, element.clientHeight);
                setBand(current => (current.top === nextBand.top && current.bottom === nextBand.bottom ? current : nextBand));
                if (hasSelectionRef.current) setViewTick(current => current + 1);
            });
        };
        element.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            element.removeEventListener('scroll', onScroll);
            if (frame) cancelAnimationFrame(frame);
        };
    }, []);

    // 卸载时还在等的长按计时器。
    useEffect(() => () => {
        if (pressRef.current?.longPress) window.clearTimeout(pressRef.current.longPress);
    }, []);

    const register = useCallback((key: string, motion: CardMotion | null) => {
        if (motion) motions.current.set(key, motion);
        else motions.current.delete(key);
    }, []);

    // 只在浮动菜单出来时才要（框选途中每帧都换选择，不跟着把整块画布的条目过滤一遍）；Delete 键自己现算。
    const selectedEntries = useMemo(() => (menu ? entries.filter(entry => selected.has(entry.key)) : []), [entries, menu, selected]);

    // —— 卡片：点击选择、拖动排序 ——

    /** 一次拖动结束（放下、取消都算）：收起拖动状态，告诉调用方。 */
    const endDrag = useCallback(() => {
        const wasDragging = dragRef.current !== null;
        dragRef.current = null;
        setDrag(null);
        if (wasDragging) latest.current.onDragEnd?.();
    }, []);

    /** 按下的卡（和同组选中的）开始跟着指针走。 */
    const startDrag = useCallback((press: Press) => {
        const { groupOf: groupsByKey, selected: chosen } = latest.current;
        press.dragging = true;
        // 拖的是选中的卡：同组选中的一起走；否则只拖这一张，并把选择换成它。
        const group = groupsByKey.get(press.entry.key);
        const moving = chosen.has(press.entry.key) && group
            ? new Set(group.entries.filter(entry => chosen.has(entry.key)).map(entry => entry.key))
            : new Set([press.entry.key]);
        if (!chosen.has(press.entry.key)) setSelected(new Set([press.entry.key]));
        const index = group?.entries.findIndex(entry => entry.key === press.entry.key) ?? 0;
        const before = group?.entries.slice(0, index).filter(entry => moving.has(entry.key)).length ?? 0;
        const stack = [press.entry.key, ...[...moving].filter(key => key !== press.entry.key).slice(0, STACK_VISIBLE - 1)];
        dragRef.current = { groupKey: press.groupKey, moving, stack, dropIndex: index - before };
        setDrag(dragRef.current);
        latest.current.onDragStart?.();
    }, []);

    /** 被拖的卡跟到指针下，落点变了才 set。 */
    const followPointer = useCallback((press: Press, clientX: number, clientY: number) => {
        const { groupOf: groupsByKey, columns: columnCount, spacing: gaps } = latest.current;
        const grid = gridRefs.current.get(press.groupKey);
        const group = groupsByKey.get(press.entry.key);
        const current = dragRef.current;
        if (!grid || !group || !current) return;
        const gridRect = grid.getBoundingClientRect();
        const topLeft = { x: clientX - gridRect.left - press.grab.x, y: clientY - gridRect.top - press.grab.y };
        // 被拖的卡：按下的那张在指针下，同组其余选中的错开叠在它后面。
        current.stack.forEach((key, order) => {
            const motion = motions.current.get(key);
            motion?.x.set(topLeft.x + order * STACK_OFFSET);
            motion?.y.set(topLeft.y + order * STACK_OFFSET);
        });
        const dropIndex = dropIndexAt(topLeft, columnCount, group.entries.length - current.moving.size, gaps);
        if (dropIndex !== current.dropIndex) {
            dragRef.current = { ...current, dropIndex };
            setDrag(dragRef.current);
        }
    }, []);

    const handleCardPointerDown = useCallback((entry: CanvasEntry, event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        // 已经有一根手指（或一个指针）按着：第二根不接，否则先按的那根的移动与抬起都对不上号，拖着的卡就停在半空。
        if (pressRef.current && pressRef.current.pointerId !== event.pointerId) return;
        const group = groupOf.get(entry.key);
        const motion = motions.current.get(entry.key);
        const grid = group ? gridRefs.current.get(group.key) : undefined;
        if (!group || !motion || !grid) return;
        scrollRef.current?.focus({ preventScroll: true });
        const gridRect = grid.getBoundingClientRect();
        const press: Press = {
            entry,
            groupKey: group.key,
            pointerId: event.pointerId,
            start: { x: event.clientX, y: event.clientY },
            grab: { x: event.clientX - gridRect.left - motion.x.get(), y: event.clientY - gridRect.top - motion.y.get() },
            modifiers: { shift: event.shiftKey, toggle: event.ctrlKey || event.metaKey },
            dragging: false,
            isTouch: event.pointerType === 'touch',
        };
        if (pressRef.current?.longPress) window.clearTimeout(pressRef.current.longPress);
        pressRef.current = press;
        if (!press.isTouch) {
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
        }
        // 不能拖的画布：手指点一下只是选择，不等长按。
        if (!latest.current.onMove) return;
        // 手指：按住不动才拿起来（触屏的指针本来就隐式捕获在按下的元素上）。
        press.longPress = window.setTimeout(() => {
            press.longPress = undefined;
            if (pressRef.current !== press) return;
            startDrag(press);
            followPointer(press, press.start.x, press.start.y);
            navigator.vibrate?.(10);
        }, LONG_PRESS_MS);
    }, [followPointer, groupOf, startDrag]);

    const handleCardPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const press = pressRef.current;
        if (!press || press.pointerId !== event.pointerId) return;
        // 鼠标的主键已经松开了（松手时卡片被卸掉、没收到 pointerup）：这一下按压作废，不能没按键还跟着指针拖。
        if (!press.isTouch && (event.buttons & 1) === 0) {
            pressRef.current = null;
            if (press.dragging) endDrag();
            return;
        }
        if (!press.dragging) {
            const distance = Math.hypot(event.clientX - press.start.x, event.clientY - press.start.y);
            if (press.isTouch) {
                // 还没拿起来手指就划开了：那是在滚动，这一下既不拖也不算点击。
                if (distance >= TOUCH_SLOP) {
                    if (press.longPress) window.clearTimeout(press.longPress);
                    pressRef.current = null;
                }
                return;
            }
            if (distance < DRAG_THRESHOLD) return;
            // 不能拖的画布：按着走开的这一下既不拖也不算点击。
            if (!latest.current.onMove) {
                pressRef.current = null;
                return;
            }
            startDrag(press);
        }
        followPointer(press, event.clientX, event.clientY);
    }, [endDrag, followPointer, startDrag]);

    const handleCardPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const press = pressRef.current;
        if (!press || press.pointerId !== event.pointerId) return;
        if (press.longPress) window.clearTimeout(press.longPress);
        pressRef.current = null;
        if (press.dragging) {
            const current = dragRef.current;
            endDrag();
            if (current) latest.current.onMove?.(current.groupKey, [...current.moving], current.dropIndex);
            return;
        }
        // 点击：选择。
        const key = press.entry.key;
        if (press.modifiers.shift && anchorRef.current && groupOf.get(anchorRef.current) === groupOf.get(key)) {
            const groupEntries = groupOf.get(key)!.entries;
            const from = groupEntries.findIndex(entry => entry.key === anchorRef.current);
            const to = groupEntries.findIndex(entry => entry.key === key);
            const range = groupEntries.slice(Math.min(from, to), Math.max(from, to) + 1).map(entry => entry.key);
            setSelected(current => new Set([...(press.modifiers.toggle ? current : []), ...range]));
            return;
        }
        anchorRef.current = key;
        setSelected(current => {
            // Ctrl 单击切换；手指点的，已经有选中的卡时也是切换（触屏多选）。
            if (!press.modifiers.toggle && !(press.isTouch && current.size > 0)) return new Set([key]);
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, [endDrag, groupOf]);

    const handleCardPointerCancel = useCallback(() => {
        if (pressRef.current?.longPress) window.clearTimeout(pressRef.current.longPress);
        pressRef.current = null;
        endDrag();
    }, [endDrag]);

    // —— 空白处：框选 ——

    const contentPoint = (event: { clientX: number; clientY: number }) => {
        const rect = contentRef.current!.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const handleCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !contentRef.current) return;
        // 手指在空白处是滚动（touch-action: pan-y），不框选。
        if (event.pointerType === 'touch') return;
        if ((event.target as HTMLElement).closest('button, .scratchpad-card')) return;
        // 按在滚动条上（Chromium 也派发 pointerdown）：是滚动，不框选，也不清掉选择。
        const scroller = scrollRef.current;
        if (scroller && event.clientX - scroller.getBoundingClientRect().left >= scroller.clientWidth) return;
        scrollRef.current?.focus({ preventScroll: true });
        const contentRect = contentRef.current.getBoundingClientRect();
        const additive = event.shiftKey || event.ctrlKey || event.metaKey;
        marqueeStateRef.current = {
            pointerId: event.pointerId,
            start: contentPoint(event),
            base: additive ? selected : new Set(),
            moved: false,
            grids: groups.flatMap(group => {
                const grid = gridRefs.current.get(group.key);
                if (!grid) return [];
                const rect = grid.getBoundingClientRect();
                return [{ origin: { x: rect.left - contentRect.left, y: rect.top - contentRect.top }, keys: group.entries.map(entry => entry.key) }];
            }),
            pending: null,
            frame: 0,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    /** 按指针这一刻的位置更新框和选择。读一次内容的外框、写一次框的样式、至多 set 一次选择。 */
    const applyMarquee = (marquee: Marquee, client: { clientX: number; clientY: number }) => {
        const point = contentPoint(client);
        if (!marquee.moved && Math.hypot(point.x - marquee.start.x, point.y - marquee.start.y) < DRAG_THRESHOLD) return;
        if (!marquee.moved) setIsBoxSelecting(true);
        marquee.moved = true;
        const rect = rectFromPoints(marquee.start, point);
        const box = marqueeRef.current;
        if (box) {
            box.hidden = false;
            box.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
            box.style.width = `${rect.right - rect.left}px`;
            box.style.height = `${rect.bottom - rect.top}px`;
        }
        const next = new Set(marquee.base);
        for (const grid of marquee.grids) {
            grid.keys.forEach((key, index) => {
                if (rectsIntersect(rect, cardRect(grid.origin, index, columns, spacing))) next.add(key);
            });
        }
        setSelected(current => (sameSet(current, next) ? current : next));
    };

    // 指针事件只记下位置，下一帧再算：一帧里来多少次都只重算、重渲染一次。
    const handleCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const marquee = marqueeStateRef.current;
        if (!marquee || marquee.pointerId !== event.pointerId) return;
        marquee.pending = { clientX: event.clientX, clientY: event.clientY };
        if (marquee.frame) return;
        marquee.frame = requestAnimationFrame(() => {
            marquee.frame = 0;
            const pending = marquee.pending;
            marquee.pending = null;
            if (pending && marqueeStateRef.current === marquee) applyMarquee(marquee, pending);
        });
    };

    const handleCanvasPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        const marquee = marqueeStateRef.current;
        if (!marquee || marquee.pointerId !== event.pointerId) return;
        // 还没轮到的最后一次移动先补上：松手那一刻框到哪就选到哪。
        if (marquee.frame) cancelAnimationFrame(marquee.frame);
        if (marquee.pending) applyMarquee(marquee, marquee.pending);
        marqueeStateRef.current = null;
        setIsBoxSelecting(false);
        if (marqueeRef.current) marqueeRef.current.hidden = true;
        // 在空白处点一下（没拖）：取消选择。
        if (!marquee.moved && marquee.base.size === 0) setSelected(new Set());
    };

    // 卸载时还在等的那一帧。
    useEffect(() => () => {
        const marquee = marqueeStateRef.current;
        if (marquee?.frame) cancelAnimationFrame(marquee.frame);
    }, []);

    // 长按在有的浏览器上还会弹出系统菜单（复制图片、选文字）：拿卡片的那一下不要它。
    const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
        if (pressRef.current?.isTouch || dragRef.current) event.preventDefault();
    };

    // —— 选中后的浮动菜单 ——

    // 落在选中卡片的外框上方；上方在看得见的范围里放不下时放到下方；外框整个在视口外（或比视口还高）时贴着视口的
    // 上沿或下沿，总之看得见、够得着。拖动、框选进行中先收起来。
    useLayoutEffect(() => {
        const content = contentRef.current;
        const scroller = scrollRef.current;
        if (selected.size === 0 || drag || isBoxSelecting || !content || !scroller) {
            setMenu(null);
            return;
        }
        const contentRect = content.getBoundingClientRect();
        let union: Rect | null = null;
        for (const group of groups) {
            const grid = gridRefs.current.get(group.key);
            if (!grid) continue;
            const gridRect = grid.getBoundingClientRect();
            const origin = { x: gridRect.left - contentRect.left, y: gridRect.top - contentRect.top };
            group.entries.forEach((entry, index) => {
                if (!selected.has(entry.key)) return;
                const rect = cardRect(origin, index, columns, spacing);
                union = union
                    ? { left: Math.min(union.left, rect.left), top: Math.min(union.top, rect.top), right: Math.max(union.right, rect.right), bottom: Math.max(union.bottom, rect.bottom) }
                    : rect;
            });
        }
        if (!union) {
            setMenu(null);
            return;
        }
        const box: Rect = union;
        // 看得见的那一段，内容坐标。
        const scrollerRect = scroller.getBoundingClientRect();
        const viewTop = scrollerRect.top - contentRect.top;
        const viewBottom = viewTop + scroller.clientHeight;
        const centerX = (box.left + box.right) / 2;
        let next: MenuAnchor;
        if (box.top - MENU_ROOM_ABOVE >= viewTop && box.top <= viewBottom) {
            next = { centerX, y: box.top - MENU_GAP, placement: 'above' };
        } else if (box.bottom + MENU_ROOM_ABOVE <= viewBottom && box.bottom >= viewTop) {
            next = { centerX, y: box.bottom + MENU_GAP, placement: 'below' };
        } else if (box.top > viewBottom - MENU_ROOM_ABOVE) {
            next = { centerX, y: viewBottom - MENU_GAP, placement: 'above' };
        } else {
            next = { centerX, y: viewTop + MENU_GAP, placement: 'below' };
        }
        setMenu(current => (
            current && current.centerX === next.centerX && current.y === next.y && current.placement === next.placement ? current : next
        ));
    }, [columns, drag, groups, isBoxSelecting, selected, spacing, viewTick]);

    // 横向：以选中外框的中线居中，但不超出画布内容的左右边（菜单宽度要画出来才量得到）。
    useLayoutEffect(() => {
        const element = menuRef.current;
        const content = contentRef.current;
        if (!menu || !element || !content) return;
        const width = element.offsetWidth;
        const left = Math.min(Math.max(menu.centerX - width / 2, MENU_GAP), Math.max(MENU_GAP, content.clientWidth - width - MENU_GAP));
        element.style.left = `${left}px`;
    }, [menu, selected.size, viewTick]);

    // —— 键盘 ——

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (drag) handleCardPointerCancel();
            else if (selected.size > 0) setSelected(new Set());
            else onEscape();
            return;
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && selected.size > 0 && onDelete) {
            event.preventDefault();
            event.stopPropagation();
            onDelete(entries.filter(entry => selected.has(entry.key)));
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            event.stopPropagation();
            setSelected(new Set(entries.map(entry => entry.key)));
        }
    };

    const menuButtons = menu ? selectionActions(selectedEntries) : [];

    return (
        <>
            <div
                ref={scrollRef}
                className={`scratchpad-canvas${isBoxSelecting ? ' is-box-selecting' : ''}`}
                data-testid={testId}
                role="listbox"
                aria-multiselectable="true"
                aria-label={ariaLabel}
                tabIndex={-1}
                onKeyDown={handleKeyDown}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerUp}
                onContextMenu={handleContextMenu}
            >
                <div
                    ref={contentRef}
                    className="scratchpad-canvas-content"
                    // 左右留白跟着空隙走：时间轴第一列前面的节点要伸出网格。
                    style={spacing.edge === undefined ? undefined : { paddingLeft: spacing.edge, paddingRight: spacing.edge }}
                >
                    <p className="scratchpad-canvas-hint">{hint}</p>
                    {groups.map(group => {
                        const keys = group.entries.map(entry => entry.key);
                        const preview = drag?.groupKey === group.key ? previewSlots(keys, drag.moving, drag.dropIndex) : null;
                        const height = gridHeight(group.entries.length, columns, spacing);
                        const gridTop = gridTops.get(group.key);
                        const selectAll: ScratchpadAction = {
                            id: 'select-group',
                            label: t('scratchpad.selectGroup'),
                            icon: SquareCheck,
                            run: () => setSelected(current => new Set([...current, ...keys])),
                        };
                        return (
                            <section key={group.key} className="scratchpad-canvas-group" data-scratchpad-group={group.key}>
                                <ScratchpadGroupHeader
                                    label={group.label}
                                    count={group.entries.length}
                                    buttons={[selectAll, ...(group.buttons ?? [])]}
                                />
                                <div
                                    ref={element => {
                                        if (element) gridRefs.current.set(group.key, element);
                                        else gridRefs.current.delete(group.key);
                                    }}
                                    className="scratchpad-grid"
                                    style={{ height: height + spacing.y }}
                                    onPointerMove={handleCardPointerMove}
                                    onPointerUp={handleCardPointerUp}
                                    onPointerCancel={handleCardPointerCancel}
                                >
                                    {group.thread && group.entries.length > 0 && (
                                        <ThreadLayer thread={group.thread} count={group.entries.length} columns={columns} spacing={spacing} height={height} />
                                    )}
                                    {group.entries.map((entry, index) => {
                                        const isMoving = Boolean(drag?.moving.has(entry.key));
                                        // 一起挪、但不在叠起来的那几张里的卡：拖动期间不画。
                                        if (isMoving && !drag?.stack.includes(entry.key)) return null;
                                        const slot = slotPosition(preview?.get(entry.key) ?? index, columns, spacing);
                                        // 只挂看得见的那一档附近的卡片；被拖的卡总在。网格顶边还没量到时（刚打开、刚多出一组）
                                        // 一张都不挂：layout effect 量完会同步重渲染，画出来之前就补上了，长队列不会先全挂一遍。
                                        if (!isMoving) {
                                            if (gridTop === undefined) return null;
                                            const top = gridTop + slot.y;
                                            if (top + CARD_HEIGHT < band.top || top > band.bottom) return null;
                                        }
                                        return (
                                            <ScratchpadCard
                                                key={entry.key}
                                                entry={entry}
                                                slotX={slot.x}
                                                slotY={slot.y}
                                                isMoving={isMoving}
                                                movingCount={isMoving && drag?.stack[0] === entry.key && drag.moving.size > 1 ? drag.moving.size : 0}
                                                isSelected={selected.has(entry.key)}
                                                isFresh={freshKeys.has(entry.key)}
                                                playLabel={playLabel}
                                                register={register}
                                                onPointerDown={handleCardPointerDown}
                                                onPlay={onPlay as (entry: CanvasEntry) => void}
                                            />
                                        );
                                    })}
                                </div>
                            </section>
                        );
                    })}
                    <div ref={marqueeRef} className="scratchpad-marquee" hidden />
                    {menu && (
                        <div
                            ref={menuRef}
                            className={`scratchpad-selection-menu is-${menu.placement}`}
                            style={{ top: menu.y }}
                            role="toolbar"
                            aria-label={t('scratchpad.selectedCount', { count: selected.size })}
                            data-testid="scratchpad-selection-menu"
                            // 菜单上按下不是在空白处按下：不框选，也不清掉选择。
                            onPointerDown={event => event.stopPropagation()}
                        >
                            <span className="scratchpad-selection-count">{t('scratchpad.selectedCount', { count: selected.size })}</span>
                            {menuButtons.map(({ id, label, title, icon: Icon, run, disabled }) => (
                                <button
                                    key={id}
                                    type="button"
                                    className="scratchpad-menu-button"
                                    data-scratchpad-selection-action={id}
                                    title={title ?? label}
                                    disabled={disabled}
                                    onClick={run}
                                >
                                    <Icon aria-hidden="true" />
                                    <span>{label}</span>
                                </button>
                            ))}
                            <button
                                type="button"
                                className="scratchpad-icon-button"
                                title={t('scratchpad.clearSelection')}
                                aria-label={t('scratchpad.clearSelection')}
                                onClick={() => setSelected(new Set())}
                            >
                                <X aria-hidden="true" />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {footer}
        </>
    );
}

export default ScratchpadCanvas;
