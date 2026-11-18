import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ScratchpadHandleStyle } from '../../../stores/useScratchpadSettingsStore';
import ScratchpadHandleRest from './ScratchpadHandleRest';
import ScratchpadShape from './ScratchpadShape';

// src/components/app/scratchpad/ScratchpadEdge.tsx
// 左缘的热区：常驻时只露一点点（ScratchpadHandleRest，样式在设置里选，小而半透明，不打扰页面）；指针进来或键盘聚焦时，
// 完整的标签从左边滑出来——一条竖着的米白小信息条：红顶边、圆形记号、竖排「速记簿」、红色计数斜块、网点纹理，方正的长方形。
// 位置不变（左上 72px 起，沿用「悬浮标签高度」）。收进新歌时常驻的那一点闪一下。展开与否全由 CSS 的 :hover / :focus-within 管。
// 标签可以长按拖动上下挪：按住 LONG_PRESS_DRAG_MS 不动（或按下后拖过 SLOP）进入拖动，指针的位置实时换算成
// 「悬浮标签高度」（0..1，与 scratchpad.css 的 top 公式同一条），松手才写进设置；拖完的这一下不算点击，抽屉不展开。

type ScratchpadEdgeProps = {
    handleStyle: ScratchpadHandleStyle;
    /** 0..1：设置里的「悬浮标签高度」。 */
    position: number;
    count: number;
    pulsing: boolean;
    title: string;
    label: string;
    /** 悬停提示（带开合的快捷键）。 */
    hint: string;
    onToggle: () => void;
    /** 拖动结束时交给设置保存（dragPositionRef 里的终值）。 */
    onPositionCommit: (position: number) => void;
    handleRef: React.Ref<HTMLButtonElement>;
};

/** 按住这么久不松手就算要拖（太短会跟「点一下展开」打架，太长像没反应）。 */
const LONG_PRESS_DRAG_MS = 260;
/** 按下之后先划开这么远：不用等长按，直接进入拖动（用户明确在拖，不用他等）。 */
const DRAG_SLOP_PX = 14;
/** 与 scratchpad.css 的 .scratchpad-edge 同一条公式的常数：top = TOP + position * (100vh - TOP - BOTTOM - height)。 */
const EDGE_TOP_PX = 72;
const EDGE_BOTTOM_GAP_PX = 24;

/** 把指针的 Y 换算成「悬浮标签高度」0..1（与 CSS 的 top 公式互逆；把手高度用 CSS 的 clamp 同款）。 */
const positionFromPointerY = (clientY: number): number => {
    const edgeHeight = Math.min(168, Math.max(96, window.innerHeight * 0.2 - 76));
    const span = window.innerHeight - EDGE_TOP_PX - EDGE_BOTTOM_GAP_PX - edgeHeight;
    if (span <= 0) return 0;
    return Math.min(1, Math.max(0, (clientY - EDGE_TOP_PX - edgeHeight / 2) / span));
};

const ScratchpadEdge: React.FC<ScratchpadEdgeProps> = ({ handleStyle, position, count, pulsing, title, label, hint, onToggle, onPositionCommit, handleRef }) => {
    // 拖动中的实时位置走 ref + CSS 变量（不经过 React），松手才提交设置；press 在 ref 里跨事件读。
    const [dragging, setDragging] = useState(false);
    const pressRef = useRef<{ pointerId: number; startY: number; timer: number | undefined; moved: boolean } | null>(null);
    const dragPositionRef = useRef(position);
    const edgeRef = useRef<HTMLDivElement | null>(null);

    const setLivePosition = useCallback((next: number) => {
        dragPositionRef.current = next;
        edgeRef.current?.style.setProperty('--scratchpad-edge-position', String(next));
    }, []);

    const beginDrag = useCallback((clientY: number) => {
        setDragging(true);
        setLivePosition(positionFromPointerY(clientY));
    }, [setLivePosition]);

    const endDrag = useCallback(() => {
        setDragging(false);
        pressRef.current = null;
        onPositionCommit(dragPositionRef.current);
    }, [onPositionCommit]);

    // 拖动中位置走行内变量，松手后回到由 props（设置值）接管的同一变量：组件重渲染时写回 props 的值。
    useEffect(() => {
        if (!dragging) edgeRef.current?.style.setProperty('--scratchpad-edge-position', String(position));
    }, [dragging, position]);

    const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        const press = { pointerId: event.pointerId, startY: event.clientY, timer: undefined as number | undefined, moved: false };
        pressRef.current = press;
        // 按下就把指针抓到标签上（capture 只在按住期间改道路由，松手的 click 照常落在标签上）：
        // 之后指针跑出标签，move / up 仍到得了这里，长按计时器也从这里出发。计时器回调是事件派发之外
        // 跑的，那时候 setPointerCapture 会因为指针不在活跃事件里而失败，所以在这里抓。
        event.currentTarget.setPointerCapture(event.pointerId);
        // 按住不动到点：进入拖动。移动超过 SLOP 的情形在 move 里提前进入，不等计时器。
        press.timer = window.setTimeout(() => {
            if (pressRef.current !== press) return;
            beginDrag(event.clientY);
        }, LONG_PRESS_DRAG_MS);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        const press = pressRef.current;
        if (!press || press.pointerId !== event.pointerId) return;
        if (!dragging) {
            // 按住还没到长按时间就划开这么远：明确是在拖，直接拿起来，不等计时器。
            if (Math.abs(event.clientY - press.startY) >= DRAG_SLOP_PX) {
                if (press.timer !== undefined) window.clearTimeout(press.timer);
                press.moved = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                beginDrag(event.clientY);
            }
            return;
        }
        event.preventDefault();
        setLivePosition(positionFromPointerY(event.clientY));
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
        const press = pressRef.current;
        if (!press || press.pointerId !== event.pointerId) return;
        if (press.timer !== undefined) window.clearTimeout(press.timer);
        if (dragging) {
            // 拖完的这一下不算点击：开关抽屉由 onClick 的 suppressed 标记挡住。
            endDrag();
            event.currentTarget.dataset.scratchpadDragged = 'true';
            return;
        }
        pressRef.current = null;
    };

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        // 长按拖完的松手会带一次 click：刚拖过就不展开抽屉。
        if (event.currentTarget.dataset.scratchpadDragged === 'true') {
            delete event.currentTarget.dataset.scratchpadDragged;
            return;
        }
        onToggle();
    };

    return (
        <div
            ref={edgeRef}
            className={`scratchpad-edge is-${handleStyle}${count > 0 ? ' has-entries' : ''}${pulsing ? ' is-pulsing' : ''}${dragging ? ' is-dragging' : ''}`}
            /* 拖动中行内写的是实时位置（拖动不经过 React，重渲染也不能把它抹回设置值）；
               平时写的才是设置值。 */
            style={{ '--scratchpad-edge-position': dragging ? dragPositionRef.current : position } as React.CSSProperties}
            data-ponder="scratchpad"
        >
            <span className="scratchpad-edge-rest" aria-hidden="true">
                <ScratchpadHandleRest handleStyle={handleStyle} />
            </span>
            <button
                ref={handleRef}
                type="button"
                className="scratchpad-handle"
                data-testid="scratchpad-handle"
                title={hint}
                aria-label={label}
                aria-expanded={false}
                onClick={handleClick}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                <span className="scratchpad-handle-paper">
                    <span className="scratchpad-handle-texture" aria-hidden="true" />
                    <span className="scratchpad-handle-body">
                        <ScratchpadShape kind="circle" size={14} fill="var(--scratchpad-mark)" />
                        <span className="scratchpad-handle-title">{title}</span>
                        {count > 0 && <span className="scratchpad-handle-count"><span>{count}</span></span>}
                        <ScratchpadShape kind="circle" size={12} fill="none" stroke="var(--scratchpad-ink)" strokeWidth={2} />
                    </span>
                </span>
            </button>
        </div>
    );
};

export default ScratchpadEdge;
