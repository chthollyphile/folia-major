import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PRIMARY_MODIFIER_LABEL } from '../../../utils/platform';
import { ListPlus, Star, Trash2, X } from 'lucide-react';
import type { ScratchpadEntry, ScratchpadGroup } from '../../../stores/useScratchpadStore';
import ScratchpadCard, { type CardMotion } from './ScratchpadCard';
import ScratchpadGroupHeader from './ScratchpadGroupHeader';
import {
    CARD_GAP,
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
} from './canvasLayout';
import type { ScratchpadPanelActions } from './ScratchpadList';

// src/components/app/scratchpad/ScratchpadCanvas.tsx
// 速记簿展开后的画布（设计稿 plan/scratchpad-spec.md「画布的交互细则」）。每个来源组一块卡片网格：
// - 拖动（鼠标、笔）：按下卡片走过 4px 才算拖；卡片跟着指针走（直接写它的 MotionValue），同组其余卡片实时让出落点；松手吸附到
//   最近的索引位（store.move）。拖的是已选中的卡时，同组选中的一起挪；卡片不跨组，指针在别的组上时落点停在本组最近处。
// - 拖动（触屏）：手指按住卡片不动 0.4 秒拿起来（轻震一下），之后和鼠标一样拖；没拿起来之前手指一划就是滚动画布。
//   拿起来之后画布不再跟着手指滚（touchmove 被拦下）。
// - 框选：在空白处按下拖出矩形，碰到的卡片选中；Shift / Ctrl 追加。单击卡片选它一张，Ctrl 单击切换，Shift 单击选到上一次点的那张。
//   触屏上没有框选：已经有选中的卡时，点一下卡片是加选 / 取消（手机上多选的习惯），没有时点一下选它一张。
// - 选中后在选中的卡片上方浮出一个菜单：入队、加入歌单（选中的都来自同一组时）、移出、取消选择；拖动、框选进行中先收起，
//   滚动时留在看得见的地方。
//   Delete 移除，Ctrl+A 全选，Esc 先取消选择。
// 指针移动里只 set MotionValue 和直接改框选框的样式；进 React state 的只有离散的落点序号与选择集（变了才 set）。

type ScratchpadCanvasProps = {
    groups: ScratchpadGroup[];
    freshKeys: ReadonlySet<string>;
    actions: ScratchpadPanelActions;
    /** 没有选择时按 Esc：交给抽屉（收回列表）。 */
    onEscape: () => void;
    /** 底部的整本动作（与列表同一份）。 */
    footer: React.ReactNode;
};

/** 按下之后走过这么远才算拖（以内是点击）。 */
const DRAG_THRESHOLD = 4;
/** 手指按住卡片多久拿起来。 */
const LONG_PRESS_MS = 400;
/** 手指按住期间走过这么远就算在滚动（拿起来之前）。比鼠标的门槛宽：手指按着总会抖一点。 */
const TOUCH_SLOP = 10;
/** 一起被拖的几张卡错开叠放的距离。 */
const STACK_OFFSET = 6;
/** 画布内容的左右留白（与 CSS 的 .scratchpad-canvas-content 一致）。 */
const CONTENT_PADDING_X = 16;
/** 浮动菜单与选中卡片之间的空隙，以及它离画布内容上边至少要留出的高度（不够就放到卡片下面）。 */
const MENU_GAP = 8;
const MENU_ROOM_ABOVE = 52;

type Press = {
    entry: ScratchpadEntry;
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

type Drag = { groupKey: string; moving: ReadonlySet<string>; dropIndex: number };

type Marquee = {
    pointerId: number;
    start: Point;
    base: ReadonlySet<string>;
    moved: boolean;
    /** 框选开始时各组网格原点（内容坐标）与它们的条目。 */
    grids: { origin: Point; keys: string[] }[];
};

/** 浮动菜单落在哪：选中卡片的外框中线上，外框上方（或放不下时下方）。内容坐标。 */
type MenuAnchor = { centerX: number; y: number; placement: 'above' | 'below' };

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every(key => b.has(key));

const ScratchpadCanvas: React.FC<ScratchpadCanvasProps> = ({ groups, freshKeys, actions, onEscape, footer }) => {
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
    const hasSelectionRef = useRef(false);
    hasSelectionRef.current = selected.size > 0;

    const entries = useMemo(() => groups.flatMap(group => group.entries), [groups]);
    const groupOf = useMemo(() => {
        const map = new Map<string, ScratchpadGroup>();
        for (const group of groups) for (const entry of group.entries) map.set(entry.key, group);
        return map;
    }, [groups]);

    // 计时器里（手指按住 0.4 秒之后）读的是这一刻的值，不是按下那一刻的。
    const latest = useRef({ groupOf, columns, selected });
    latest.current = { groupOf, columns, selected };

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
            const next = columnsFor(element.clientWidth - CONTENT_PADDING_X * 2);
            setColumns(current => (current === next ? current : next));
            if (hasSelectionRef.current) setViewTick(current => current + 1);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

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

    // 滚动时浮动菜单要留在看得见的地方：每帧至多重新落位一次。
    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;
        let frame = 0;
        const onScroll = () => {
            if (!hasSelectionRef.current || frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                setViewTick(current => current + 1);
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

    const selectedEntries = useMemo(() => entries.filter(entry => selected.has(entry.key)), [entries, selected]);
    const selectionGroup = useMemo(() => {
        const keys = new Set(selectedEntries.map(entry => groupOf.get(entry.key)?.key));
        return keys.size === 1 ? groupOf.get(selectedEntries[0].key) ?? null : null;
    }, [groupOf, selectedEntries]);

    // —— 卡片：点击选择、拖动排序 ——

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
        dragRef.current = { groupKey: press.groupKey, moving, dropIndex: index - before };
        setDrag(dragRef.current);
    }, []);

    /** 被拖的卡跟到指针下，落点变了才 set。 */
    const followPointer = useCallback((press: Press, clientX: number, clientY: number) => {
        const { groupOf: groupsByKey, columns: columnCount } = latest.current;
        const grid = gridRefs.current.get(press.groupKey);
        const group = groupsByKey.get(press.entry.key);
        const current = dragRef.current;
        if (!grid || !group || !current) return;
        const gridRect = grid.getBoundingClientRect();
        const topLeft = { x: clientX - gridRect.left - press.grab.x, y: clientY - gridRect.top - press.grab.y };
        // 被拖的卡：按下的那张在指针下，同组其余选中的错开叠在它后面。
        const stacked = [press.entry.key, ...[...current.moving].filter(key => key !== press.entry.key)];
        stacked.forEach((key, order) => {
            const motion = motions.current.get(key);
            motion?.x.set(topLeft.x + order * STACK_OFFSET);
            motion?.y.set(topLeft.y + order * STACK_OFFSET);
        });
        const dropIndex = dropIndexAt(topLeft, columnCount, group.entries.length - current.moving.size);
        if (dropIndex !== current.dropIndex) {
            dragRef.current = { ...current, dropIndex };
            setDrag(dragRef.current);
        }
    }, []);

    const handleCardPointerDown = useCallback((entry: ScratchpadEntry, event: React.PointerEvent<HTMLDivElement>) => {
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
            startDrag(press);
        }
        followPointer(press, event.clientX, event.clientY);
    }, [followPointer, startDrag]);

    const handleCardPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const press = pressRef.current;
        if (!press || press.pointerId !== event.pointerId) return;
        if (press.longPress) window.clearTimeout(press.longPress);
        pressRef.current = null;
        if (press.dragging) {
            const current = dragRef.current;
            dragRef.current = null;
            setDrag(null);
            if (current) actions.move(current.groupKey, [...current.moving], current.dropIndex);
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
    }, [actions, groupOf]);

    const handleCardPointerCancel = useCallback(() => {
        if (pressRef.current?.longPress) window.clearTimeout(pressRef.current.longPress);
        pressRef.current = null;
        dragRef.current = null;
        setDrag(null);
    }, []);

    // —— 空白处：框选 ——

    const contentPoint = (event: React.PointerEvent) => {
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
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const marquee = marqueeStateRef.current;
        if (!marquee || marquee.pointerId !== event.pointerId) return;
        const point = contentPoint(event);
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
                if (rectsIntersect(rect, cardRect(grid.origin, index, columns))) next.add(key);
            });
        }
        setSelected(current => (sameSet(current, next) ? current : next));
    };

    const handleCanvasPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        const marquee = marqueeStateRef.current;
        if (!marquee || marquee.pointerId !== event.pointerId) return;
        marqueeStateRef.current = null;
        setIsBoxSelecting(false);
        if (marqueeRef.current) marqueeRef.current.hidden = true;
        // 在空白处点一下（没拖）：取消选择。
        if (!marquee.moved && marquee.base.size === 0) setSelected(new Set());
    };

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
                const rect = cardRect(origin, index, columns);
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
    }, [columns, drag, groups, isBoxSelecting, selected, viewTick]);

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
        if ((event.key === 'Delete' || event.key === 'Backspace') && selected.size > 0) {
            event.preventDefault();
            event.stopPropagation();
            actions.remove([...selected]);
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            event.stopPropagation();
            setSelected(new Set(entries.map(entry => entry.key)));
        }
    };

    const playLabel = t('scratchpad.play');
    const canAddSelection = Boolean(selectionGroup) && selectedEntries.length > 0 && actions.canAddToPlaylist(selectedEntries[0].song);

    return (
        <>
            <div
                ref={scrollRef}
                className="scratchpad-canvas"
                data-testid="scratchpad-canvas"
                role="listbox"
                aria-multiselectable="true"
                aria-label={t('scratchpad.title')}
                tabIndex={-1}
                onKeyDown={handleKeyDown}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerUp}
                onContextMenu={handleContextMenu}
            >
                <div ref={contentRef} className="scratchpad-canvas-content">
                    <p className="scratchpad-canvas-hint">{t('scratchpad.canvasHint', { mod: PRIMARY_MODIFIER_LABEL })}</p>
                    {groups.map(group => {
                        const keys = group.entries.map(entry => entry.key);
                        const preview = drag?.groupKey === group.key ? previewSlots(keys, drag.moving, drag.dropIndex) : null;
                        const sample = group.entries[0].song;
                        return (
                            <section key={group.key} className="scratchpad-canvas-group" data-scratchpad-group={group.key}>
                                <ScratchpadGroupHeader
                                    label={actions.sourceLabel(sample)}
                                    count={group.entries.length}
                                    canAddToPlaylist={actions.canAddToPlaylist(sample)}
                                    onSelectAll={() => setSelected(current => new Set([...current, ...keys]))}
                                    onEnqueue={() => actions.enqueue(group.entries)}
                                    onAddToPlaylist={() => actions.addToPlaylist(group.entries)}
                                />
                                <div
                                    ref={element => {
                                        if (element) gridRefs.current.set(group.key, element);
                                        else gridRefs.current.delete(group.key);
                                    }}
                                    className="scratchpad-grid"
                                    style={{ height: gridHeight(group.entries.length, columns) + CARD_GAP }}
                                    onPointerMove={handleCardPointerMove}
                                    onPointerUp={handleCardPointerUp}
                                    onPointerCancel={handleCardPointerCancel}
                                >
                                    {group.entries.map((entry, index) => {
                                        const slot = slotPosition(preview?.get(entry.key) ?? index, columns);
                                        return (
                                            <ScratchpadCard
                                                key={entry.key}
                                                entry={entry}
                                                slotX={slot.x}
                                                slotY={slot.y}
                                                isMoving={Boolean(drag?.moving.has(entry.key))}
                                                isSelected={selected.has(entry.key)}
                                                isFresh={freshKeys.has(entry.key)}
                                                playLabel={playLabel}
                                                register={register}
                                                onPointerDown={handleCardPointerDown}
                                                onPlay={actions.play}
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
                            <button type="button" className="scratchpad-menu-button" title={t('scratchpad.enqueue')} onClick={() => actions.enqueue(selectedEntries)}>
                                <ListPlus aria-hidden="true" />
                                <span>{t('scratchpad.enqueue')}</span>
                            </button>
                            <button
                                type="button"
                                className="scratchpad-menu-button"
                                disabled={!canAddSelection}
                                title={selectionGroup ? t('scratchpad.addToPlaylist') : t('scratchpad.mixedSourcesHint')}
                                onClick={() => actions.addToPlaylist(selectedEntries)}
                            >
                                <Star aria-hidden="true" />
                                <span>{t('scratchpad.addToPlaylist')}</span>
                            </button>
                            <button type="button" className="scratchpad-menu-button" title={t('scratchpad.removeSelected')} onClick={() => actions.remove([...selected])}>
                                <Trash2 aria-hidden="true" />
                                <span>{t('scratchpad.removeSelected')}</span>
                            </button>
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
};

export default ScratchpadCanvas;
