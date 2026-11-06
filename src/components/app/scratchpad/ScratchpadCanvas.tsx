import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SquareCheck, X } from 'lucide-react';
import ScratchpadCard, { type CanvasEntry, type CardMotion, type CardVariant } from './ScratchpadCard';
import ScratchpadGroupHeader from './ScratchpadGroupHeader';
import {
    CONTENT_EDGE,
    DEFAULT_SPACING,
    cardRect,
    cardSize,
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
import { clientToLocal } from './scratchpadTilt';
import ScratchpadCanvasSide, { type CanvasSide, type JumpTarget } from './ScratchpadCanvasSide';
import type { ScratchpadShapeKind } from './scratchpadLook';
import type { ScratchpadAction } from './scratchpadModel';

export type { CanvasSide } from './ScratchpadCanvasSide';

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
// - 卡片多（播放队列可能上千首）时只挂看得见的那几行附近的卡片：滚动时按 400px 一档换，档没变不重渲染。
// 指针移动里只 set MotionValue 和直接改框选框的样式；进 React state 的只有离散的落点序号、选择集与可见的那一档（变了才 set）。
// - 倾斜（tilt，展开整页那张转了 4° 的纸）：指针的屏幕坐标先换算到网格、内容自己的坐标里再算（scratchpadTilt），
//   位置一律用 offsetTop / offsetLeft 与滚动量，不拿外接框相减（转过的元素外接框是斜的）。框选框是纸上的矩形，跟着纸一起斜
//   （用户定，2026-11-07；原来是屏幕方向的）：起点与指针都换成内容坐标，两点围成的矩形直接和卡片比。浮动菜单在内容里，也跟着纸斜。
// - 跳到栏与操作提示（side）：展开整页时画在卡片右边那一列；跳到栏按组（只有一组时按一段段）滚过去。


export type CanvasGroup<E extends CanvasEntry = CanvasEntry> = {
    key: string;
    label: string;
    entries: E[];
    /** 组头上「选中本组」之后的按钮。 */
    buttons?: ScratchpadAction[];
    /** 组头前面的几何体（展开整页）。 */
    mark?: ScratchpadShapeKind;
    /** 组头里大号的字（播放历史那一天是几号），写在名字前面。 */
    lead?: string;
    /** 跳到栏里这一组的短名字（缺省用 label）。 */
    jumpLabel?: string;
};

type ScratchpadCanvasProps<E extends CanvasEntry> = {
    groups: CanvasGroup<E>[];
    freshKeys?: ReadonlySet<string>;
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
    /** 卡片画成哪一种（展开整页：笔记本 / 相片 / 胶片）。 */
    variant?: CardVariant;
    /** 画布所在的纸转了几度（展开整页 4°，降低动态效果时 0）。 */
    tilt?: number;
    /** 卡片右边的跳到栏与操作提示（展开整页）。 */
    side?: CanvasSide;
    /** 胶片里正在播的那一格片边印的字。 */
    currentLabel?: string;
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
    /** 松手时没拖就收回（按下时没有选中什么、不是加选、不在组头上）。 */
    collapses: boolean;
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

function ScratchpadCanvas<E extends CanvasEntry>({
    groups,
    freshKeys = NO_KEYS,
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
    variant,
    tilt = 0,
    side,
    currentLabel,
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
    const latest = useRef({ groupOf, columns, selected, spacing, onMove, onDragStart, onDragEnd, tilt });
    latest.current = { groupOf, columns, selected, spacing, onMove, onDragStart, onDragEnd, tilt };
    const card = cardSize(spacing);

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

    /** focusKey 那张卡在内容坐标里的顶边（还没量到网格时是 null）。 */
    const focusTop = useCallback((): number | null => {
        if (!focusKey) return null;
        const group = groupOf.get(focusKey);
        const gridTop = group ? gridTops.get(group.key) : undefined;
        if (!group || gridTop === undefined) return null;
        const index = group.entries.findIndex(entry => entry.key === focusKey);
        return gridTop + slotPosition(index, columns, spacing).y;
    }, [columns, focusKey, gridTops, groupOf, spacing]);

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

    // 挂上时焦点不在任何地方（点的那颗按钮跟着上一页一起卸掉了：面板的「展开整页」、细纸带、换页）：接过焦点，
    // Esc、Delete、方向键才归画布与抽屉，不会落到被盖住的资料库墙上。
    useEffect(() => {
        const active = document.activeElement;
        if (!active || active === document.body || active.closest('.scratchpad-drawer.is-panel')) scrollRef.current?.focus({ preventScroll: true });
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
        const point = clientToLocal(grid, { x: clientX, y: clientY }, latest.current.tilt);
        const topLeft = { x: point.x - press.grab.x, y: point.y - press.grab.y };
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
        const point = clientToLocal(grid, { x: event.clientX, y: event.clientY }, latest.current.tilt);
        const press: Press = {
            entry,
            groupKey: group.key,
            pointerId: event.pointerId,
            start: { x: event.clientX, y: event.clientY },
            grab: { x: point.x - motion.x.get(), y: point.y - motion.y.get() },
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

    const contentPoint = (event: { clientX: number; clientY: number }) => (
        clientToLocal(contentRef.current!, { x: event.clientX, y: event.clientY }, tilt)
    );

    const handleCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !contentRef.current) return;
        // 手指在空白处是滚动（touch-action: pan-y），不框选。
        if (event.pointerType === 'touch') return;
        if ((event.target as HTMLElement).closest('button, .scratchpad-card')) return;
        // 按在滚动条上（Chromium 也派发 pointerdown）：是滚动，不框选，也不清掉选择。
        const scroller = scrollRef.current;
        if (scroller && clientToLocal(scroller, { x: event.clientX, y: event.clientY }, tilt).x >= scroller.clientWidth) return;
        scrollRef.current?.focus({ preventScroll: true });
        const additive = event.shiftKey || event.ctrlKey || event.metaKey;
        marqueeStateRef.current = {
            pointerId: event.pointerId,
            start: contentPoint(event),
            base: additive ? selected : new Set(),
            moved: false,
            // 空着的地方点一下、又没有选中什么：收回（同 Esc，用户要的「点空白处退出」）。组头不算空着的地方。
            collapses: !additive && selected.size === 0 && !(event.target as HTMLElement).closest('.scratchpad-group-header'),
            grids: groups.flatMap(group => {
                const grid = gridRefs.current.get(group.key);
                if (!grid) return [];
                return [{ origin: { x: grid.offsetLeft, y: grid.offsetTop }, keys: group.entries.map(entry => entry.key) }];
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
        const box = marqueeRef.current;
        // 框就是内容坐标里两点围成的矩形（起点按内容坐标记着，滚动过也对得上）；纸斜着时它跟着纸斜。
        const rect = rectFromPoints(marquee.start, point);
        const hits = (cardBox: Rect) => rectsIntersect(rect, cardBox);
        if (box) {
            box.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
            box.style.width = `${rect.right - rect.left}px`;
            box.style.height = `${rect.bottom - rect.top}px`;
            box.hidden = false;
        }
        const next = new Set(marquee.base);
        for (const grid of marquee.grids) {
            grid.keys.forEach((key, index) => {
                if (hits(cardRect(grid.origin, index, columns, spacing))) next.add(key);
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
        // 在空白处点一下（没拖）：取消选择；本来就没选中什么时收回（同 Esc）。
        if (marquee.moved) return;
        if (marquee.collapses) onEscape();
        else if (marquee.base.size === 0) setSelected(new Set());
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
        let union: Rect | null = null;
        for (const group of groups) {
            const grid = gridRefs.current.get(group.key);
            if (!grid) continue;
            const origin = { x: grid.offsetLeft, y: grid.offsetTop };
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
        // 看得见的那一段，内容坐标（内容挂在滚动容器里，滚过的量就是看得见的顶边）。
        const viewTop = scroller.scrollTop - content.offsetTop;
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

    // 跳到栏：一组一项（只有一组、给了 chunk 时一段一项）；上下沿按量到的网格顶边算（还没量到的组不列）。
    const jumpTargets = useMemo(() => {
        if (!side) return [];
        const targets: JumpTarget[] = [];
        const span = (groupKey: string, from: number, to: number) => {
            const gridTop = gridTops.get(groupKey);
            if (gridTop === undefined) return null;
            return {
                top: gridTop + slotPosition(from, columns, spacing).y,
                bottom: gridTop + slotPosition(to, columns, spacing).y + card.height,
            };
        };
        const chunk = groups.length === 1 && side.chunk ? side.chunk : 0;
        for (const group of groups) {
            const focusIndex = focusKey ? group.entries.findIndex(entry => entry.key === focusKey) : -1;
            if (chunk > 0) {
                for (let from = 0; from < group.entries.length; from += chunk) {
                    const to = Math.min(group.entries.length, from + chunk) - 1;
                    const box = span(group.key, from, to);
                    if (!box) continue;
                    const holdsFocus = focusIndex >= from && focusIndex <= to;
                    targets.push({
                        id: `${group.key}:${from}`, groupKey: group.key, index: from, count: to - from + 1, holdsFocus,
                        label: holdsFocus ? `${from + 1}–${to + 1} · ▶ ${focusIndex + 1}` : `${from + 1}–${to + 1}`,
                        ...box,
                    });
                }
                continue;
            }
            const box = span(group.key, 0, Math.max(0, group.entries.length - 1));
            if (!box) continue;
            // 组头也算这一项：跳过去时组名露在顶上。
            targets.push({
                id: group.key, groupKey: group.key, index: 0, count: group.entries.length, holdsFocus: focusIndex >= 0,
                label: group.jumpLabel ?? group.label, top: box.top - 44, bottom: box.bottom,
            });
        }
        return targets;
    }, [card.height, columns, focusKey, gridTops, groups, side, spacing]);
    const locate = useCallback(() => {
        const top = focusTop();
        const scroller = scrollRef.current;
        if (top === null || !scroller) return;
        scroller.scrollTo({ top: Math.max(0, top - scroller.clientHeight / 3), behavior: 'smooth' });
    }, [focusTop]);

    return (
        <>
            <div
                ref={scrollRef}
                className={`scratchpad-canvas${variant ? ` is-${variant}` : ''}${isBoxSelecting ? ' is-box-selecting' : ''}${selected.size > 0 ? ' has-selection' : ''}`}
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
                                    mark={group.mark}
                                    lead={group.lead}
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
                                            if (top + card.height < band.top || top > band.bottom) return null;
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
                                                width={card.width}
                                                height={card.height}
                                                variant={variant}
                                                currentLabel={currentLabel}
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

            {side && (
                <ScratchpadCanvasSide
                    side={side}
                    targets={jumpTargets}
                    scrollRef={scrollRef}
                    onLocate={focusKey ? locate : undefined}
                />
            )}
        </>
    );
}

export default ScratchpadCanvas;
