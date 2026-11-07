import React, { memo, useEffect, useRef, useState } from 'react';
import ScratchpadShape from './ScratchpadShape';
import type { ScratchpadShapeKind } from './scratchpadLook';

// src/components/app/scratchpad/ScratchpadCanvasSide.tsx
// 展开整页时卡片右边的那一列（ScratchpadCanvas 的 side）：跳到栏（一组一项，只有一组时一段一项；看得见的那几项垫一档浅黑，
// 正在播的那一项记号用点缀色），下面「定位正在播放」，再下面贴着底的几条操作提示。
// 自己听画布的滚动，只在「看得见的是哪几项」变了时才重渲染，不连累整块画布。

/** 跳到栏与操作提示（展开整页时卡片右边那一列）。 */
export type CanvasSide = {
    jumpLabel: string;
    tipsLabel: string;
    /** 跳到栏、提示前面的小几何体。 */
    mark: ScratchpadShapeKind;
    tips: readonly { key: string; label: string }[];
    /** 只有一组时每段多少首（播放队列）。 */
    chunk?: number;
    /** 跳到栏下面「定位正在播放」那一颗的字（给了 focusKey 才有）。 */
    locateLabel?: string;
};

/** 跳到栏的一项：一组（或一组里的一段）从哪张卡开始，以及它在内容坐标里的上下沿。 */
export type JumpTarget = {
    id: string;
    groupKey: string;
    index: number;
    label: string;
    count: number;
    holdsFocus: boolean;
    top: number;
    bottom: number;
};

type ScratchpadCanvasSideProps = {
    side: CanvasSide;
    targets: readonly JumpTarget[];
    scrollRef: React.RefObject<HTMLDivElement | null>;
    onLocate?: () => void;
};

/** 此刻看得见的那几项，写成一个字符串（比较用）。 */
const visibleIds = (targets: readonly JumpTarget[], element: HTMLDivElement) => {
    const top = element.scrollTop;
    const bottom = top + element.clientHeight;
    return targets.filter(target => target.bottom > top && target.top < bottom).map(target => target.id).join('|');
};

const ScratchpadCanvasSide: React.FC<ScratchpadCanvasSideProps> = ({ side, targets, scrollRef, onLocate }) => {
    const [inView, setInView] = useState('');
    // 滚动里读这一刻的项（项随列数、组变）。
    const targetsRef = useRef(targets);
    targetsRef.current = targets;
    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;
        let frame = 0;
        const read = () => {
            frame = 0;
            const next = visibleIds(targetsRef.current, element);
            setInView(current => (current === next ? current : next));
        };
        const onScroll = () => {
            if (!frame) frame = requestAnimationFrame(read);
        };
        read();
        element.addEventListener('scroll', onScroll, { passive: true });
        const observer = new ResizeObserver(onScroll);
        observer.observe(element);
        return () => {
            element.removeEventListener('scroll', onScroll);
            observer.disconnect();
            if (frame) cancelAnimationFrame(frame);
        };
    }, [scrollRef]);
    // 项本身变了（量到了网格、换了列数）时重算一次。
    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;
        const next = visibleIds(targets, element);
        setInView(current => (current === next ? current : next));
    }, [scrollRef, targets]);

    const visible = new Set(inView.split('|'));
    const jump = (top: number) => scrollRef.current?.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' });
    return (
        <aside className="scratchpad-canvas-side">
            {targets.length > 1 && (
                <nav className="scratchpad-jump" aria-label={side.jumpLabel}>
                    <span className="scratchpad-side-title">{side.jumpLabel}</span>
                    {targets.map(target => (
                        <button
                            key={target.id}
                            type="button"
                            className={`scratchpad-jump-item${visible.has(target.id) ? ' is-in-view' : ''}${target.holdsFocus ? ' is-current' : ''}`}
                            onClick={() => jump(target.top)}
                        >
                            <ScratchpadShape kind={side.mark} size={9} fill="currentColor" className="scratchpad-jump-mark" />
                            <span className="scratchpad-jump-label">{target.label}</span>
                            <span className="scratchpad-jump-count">{target.count}</span>
                        </button>
                    ))}
                </nav>
            )}
            {onLocate && side.locateLabel && (
                <button type="button" className="scratchpad-pill scratchpad-jump-locate" onClick={onLocate}>
                    <span>{side.locateLabel}</span>
                </button>
            )}
            <div className="scratchpad-tips" role="note" aria-label={side.tipsLabel}>
                <span className="scratchpad-side-title">{side.tipsLabel}</span>
                {side.tips.map(tip => (
                    <span key={tip.key} className="scratchpad-tip">
                        <ScratchpadShape kind={side.mark} size={7} fill="var(--scratchpad-mark-dark)" />
                        <b>{tip.key}</b>
                        <span>{tip.label}</span>
                    </span>
                ))}
            </div>
        </aside>
    );
};

export default memo(ScratchpadCanvasSide);
