import React, { useCallback, useEffect, useRef, useState } from 'react';

// src/components/lxmusic/LxGlassRail.tsx
// 洛雪这几处（歌单分类 / 推荐榜单 / 专辑）共用的横向滑动导轨。
//
// 三条硬要求（都在真机上量过，别再回退）：
//   1) 一行内容不足一屏时整组居中（不是把第一张顶到正中、后面拖一长串空白）；
//   2) 卡片一律用洛雪官方那种「上方方图 + 下方标题/副标题」的卡，不做封面铺满整卡；
//   3) 鼠标按住能拖着滑、滚轮/触控板能横向滑——不是只能靠点两侧的箭头。
// 内容真正超过一屏时才加首尾留白，让任意一张都能停在正中（中间那张放大提亮）。

const GLASS_BACKGROUND = 'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.07) 100%), rgba(18,20,24,0.62)';
const GLASS_BORDER = '1px solid rgba(255,255,255,0.22)';
const GLASS_SHADOW = 'inset 0 1px 0 rgba(255,255,255,0.26), inset 0 -1px 0 rgba(255,255,255,0.06), 0 14px 32px -16px rgba(0,0,0,0.75)';

export const lxGlassStyle = (isDaylight?: boolean): React.CSSProperties => ({
    background: isDaylight
        ? 'linear-gradient(180deg, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.34) 100%)'
        : GLASS_BACKGROUND,
    border: isDaylight ? '1px solid rgba(0,0,0,0.10)' : GLASS_BORDER,
    boxShadow: isDaylight
        ? 'inset 0 1px 0 rgba(255,255,255,0.9), 0 8px 20px -14px rgba(0,0,0,0.45)'
        : GLASS_SHADOW,
    backdropFilter: 'blur(20px) saturate(1.45)',
    WebkitBackdropFilter: 'blur(20px) saturate(1.45)',
});

/**
 * 导轨的留白与居中：
 *   · 内容比可视区窄  -> 首尾不留白，整组靠 margin auto 居中（用户要的就是这一条）；
 *   · 内容比可视区宽  -> 首尾各留「半个可视区减半张卡」，这样第一张/最后一张也能停在正中。
 * 量的是 layout 宽度（offsetWidth），不吃 transform 缩放。
 */
const useRailFit = (
    referenceWidth: number,
    itemCount: number,
): { trackRef: React.RefObject<HTMLDivElement | null>; innerRef: React.RefObject<HTMLDivElement | null>; pad: number } => {
    const trackRef = useRef<HTMLDivElement | null>(null);
    const innerRef = useRef<HTMLDivElement | null>(null);
    const [pad, setPad] = useState(0);

    useEffect(() => {
        const measure = (): void => {
            const track = trackRef.current;
            const inner = innerRef.current;
            if (!track || !inner) return;
            const avail = track.clientWidth;
            if (avail <= 0) return;
            const kids = Array.from(inner.children) as HTMLElement[];
            const gap = Number.parseFloat(window.getComputedStyle(inner).columnGap || '') || 8;
            const content = kids.reduce((sum, kid) => sum + kid.offsetWidth, 0)
                + gap * Math.max(0, kids.length - 1);
            setPad(content >= avail ? Math.max(0, Math.round((avail - referenceWidth) / 2)) : 0);
        };
        measure();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
        if (observer) {
            if (trackRef.current) observer.observe(trackRef.current);
            if (innerRef.current) observer.observe(innerRef.current);
        }
        window.addEventListener('resize', measure);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [referenceWidth, itemCount]);

    return { trackRef, innerRef, pad };
};

/** 按住拖动 + 滚轮横向滑动；拖动过的这一下不再当成点击。 */
const useRailScroll = (
    trackRef: React.RefObject<HTMLDivElement | null>,
    innerRef: React.RefObject<HTMLDivElement | null>,
    onScroll?: () => void,
): {
    draggingRef: React.RefObject<boolean>;
    handlers: {
        onPointerDown: React.PointerEventHandler<HTMLDivElement>;
        onPointerMove: React.PointerEventHandler<HTMLDivElement>;
        onPointerUp: React.PointerEventHandler<HTMLDivElement>;
        onPointerCancel: React.PointerEventHandler<HTMLDivElement>;
        onPointerLeave: React.PointerEventHandler<HTMLDivElement>;
    };
} => {
    const dragState = useRef<{ x: number; left: number; moved: boolean; pointerId: number } | null>(null);
    const draggingRef = useRef(false);

    useEffect(() => {
        const track = trackRef.current;
        if (!track) return;
        // 竖向滚轮也换横向位移：这一屏本来就是一条横导轨，滚轮把它当横向列表用最顺。
        const onWheel = (event: WheelEvent): void => {
            if (track.scrollWidth <= track.clientWidth + 1) return;
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            if (delta === 0) return;
            track.scrollLeft += delta;
            event.preventDefault();
            onScroll?.();
        };
        track.addEventListener('wheel', onWheel, { passive: false });
        return () => track.removeEventListener('wheel', onWheel);
    }, [trackRef, onScroll]);

    const handlers = {
        onPointerDown: (event: React.PointerEvent<HTMLDivElement>): void => {
            if (event.button !== 0) return;
            const track = trackRef.current;
            if (!track || track.scrollWidth <= track.clientWidth + 1) return;
            dragState.current = { x: event.clientX, left: track.scrollLeft, moved: false, pointerId: event.pointerId };
        },
        onPointerMove: (event: React.PointerEvent<HTMLDivElement>): void => {
            const state = dragState.current;
            const track = trackRef.current;
            if (!state || !track) return;
            const delta = event.clientX - state.x;
            if (!state.moved && Math.abs(delta) > 6) {
                state.moved = true;
                draggingRef.current = true;
                track.style.cursor = 'grabbing';
            }
            if (!state.moved) return;
            track.scrollLeft = state.left - delta;
            onScroll?.();
        },
        onPointerUp: (): void => {
            const track = trackRef.current;
            if (track && dragState.current?.moved) track.style.cursor = '';
            dragState.current = null;
            // 拖完的指针抬起会紧跟一次 click：留个短尾巴把它吃掉，别把拖动当成进下一级。
            window.setTimeout(() => { draggingRef.current = false; }, 120);
        },
        onPointerCancel: (): void => {
            const track = trackRef.current;
            if (track) track.style.cursor = '';
            dragState.current = null;
            window.setTimeout(() => { draggingRef.current = false; }, 120);
        },
        onPointerLeave: (): void => {
            const track = trackRef.current;
            if (track && dragState.current?.moved) track.style.cursor = '';
            dragState.current = null;
            window.setTimeout(() => { draggingRef.current = false; }, 120);
        },
    };

    return { draggingRef, handlers };
};

export type LxChipItem = { key: string; label: string };

/** 平台 / 分类组 / 标签这一层：横滑的液态玻璃胶囊，选中的那颗是亮胶囊。 */
export const LxGlassChipRail: React.FC<{
    items: ReadonlyArray<LxChipItem>;
    activeKey: string;
    onSelect: (key: string) => void;
    isDaylight?: boolean;
    testId?: string;
}> = ({ items, activeKey, onSelect, isDaylight, testId }) => {
    const { trackRef, innerRef, pad } = useRailFit(120, items.length);
    const { draggingRef, handlers } = useRailScroll(trackRef, innerRef);

    return (
        <div
            ref={trackRef}
            data-lx-rail={testId ?? 'chips'}
            className="w-full overflow-x-auto overflow-y-hidden snap-x snap-proximity cursor-grab"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            {...handlers}
        >
            <div
                ref={innerRef}
                className="flex w-max items-center gap-1.5 py-0"
                style={{ paddingLeft: pad, paddingRight: pad, marginLeft: 'auto', marginRight: 'auto' }}
            >
                {items.map((item) => {
                    const active = item.key === activeKey;
                    return (
                        <button
                            key={item.key}
                            type="button"
                            onClick={() => onSelect(item.key)}
                            className={`snap-center shrink-0 inline-flex items-center justify-center rounded-full px-3 text-[12px] font-medium transition-all duration-300 cursor-pointer select-none whitespace-nowrap leading-none ${
                                active ? 'text-black' : 'hover:scale-105 opacity-70 hover:opacity-100'
                            }`}
                            data-lx-chip-height="26"
                            style={{
                                height: 26,
                                ...(active
                                    ? { background: 'rgba(255,255,255,0.86)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.95), 0 8px 22px -10px rgba(0,0,0,0.65)' }
                                    : { ...lxGlassStyle(isDaylight), color: 'var(--text-primary)' }),
                            }}
                        >
                            {item.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export type LxCardItem = {
    key: string;
    /** 主标题（卡面下一行）。 */
    title: string;
    /** 副标题（卡面下二行，可省）。 */
    caption?: string;
    /** 正式封面：上方方图铺满方形区；没有就是一个玻璃色块 + 首字。 */
    coverUrl?: string;
    /** 点了也去不了下一级（例如这张专辑没有平台曲目信息）：置灰且不响应。 */
    disabled?: boolean;
};

/** 内容的相对缩放：正中放满，两侧明显收小、变暗、虚一点（远处只露出半张）。 */
const CENTER_SCALE = 1.04;
const FAR_SCALE = 0.56;

const applyCardFocus = (track: HTMLElement, inner: HTMLElement): void => {
    // 用布局坐标（offsetLeft/offsetWidth + scrollLeft）而不是 getBoundingClientRect：
    // 卡片身上带着上一帧的 scale，rect 是缩放后的结果，用 rect 反算距离会形成反馈——
    // 某帧判成不在正中就缩小，下一帧量到的宽度更小、判定离中心更远，最后整排缩到最小。
    if (track.clientWidth <= 0) return;
    const centerX = track.scrollLeft + track.clientWidth / 2;
    const half = Math.max(1, track.clientWidth / 2);
    Array.from(inner.children).forEach((node) => {
        const element = node as HTMLElement;
        if (!element.dataset.lxCard) return;
        const cardCenter = element.offsetLeft + element.offsetWidth / 2;
        const distance = Math.abs(cardCenter - centerX) / half;
        const closeness = Math.max(0, 1 - Math.min(1, distance));
        const scale = FAR_SCALE + (CENTER_SCALE - FAR_SCALE) * closeness;
        const opacity = 0.34 + 0.66 * closeness;
        const blur = 2.6 * (1 - closeness);
        element.style.transform = `scale(${scale.toFixed(3)})`;
        element.style.opacity = opacity.toFixed(3);
        element.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
        element.style.zIndex = String(Math.round(100 * closeness) + 1);
        element.dataset.lxCentered = closeness > 0.82 ? 'true' : 'false';
    });
};

/** 内容卡片导轨：官方那种卡（上封面 + 下标题），横向滑，中间那张放大。 */
export const LxGlassCardRail: React.FC<{
    items: ReadonlyArray<LxCardItem>;
    activeKey?: string;
    onSelect: (key: string) => void;
    /** 封面方图边长；整卡高度 = 这个宽度 + 信息区。 */
    width?: number;
    isDaylight?: boolean;
    testId?: string;
    /** storefront：导轨不是整屏高时不需要上下居中，交给外层排。 */
    align?: 'center' | 'start';
}> = ({ items, activeKey, onSelect, width = 262, isDaylight, testId, align = 'center' }) => {
    const { trackRef, innerRef, pad } = useRailFit(width, items.length);
    const frameRef = useRef(0);

    const refresh = useCallback((): void => {
        const track = trackRef.current;
        const inner = innerRef.current;
        if (!track || !inner) return;
        cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(() => applyCardFocus(track, inner));
    }, [trackRef, innerRef]);

    useEffect(() => {
        const track = trackRef.current;
        const inner = innerRef.current;
        if (!track) return;
        // 挂载这一帧经常还量不到最终布局（层在动画、padding 还没落），
        // 所以补两次延迟重算，并且盯住轨道/内容的实际尺寸变化，一有变化就重算。
        refresh();
        const timers = [80, 260, 600].map((ms) => window.setTimeout(refresh, ms));
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => refresh());
        observer?.observe(track);
        if (inner) observer?.observe(inner);
        track.addEventListener('scroll', refresh, { passive: true });
        window.addEventListener('resize', refresh);

        // 真机踩到的坑（推荐页一次 30 张榜单卡）：内容批量追加时浏览器会挪动 scrollLeft，
        // 之后又被悄悄夹回 0，但 scroll 事件没跟上，于是 transform 还在按旧 scrollLeft 算——
        // 整屏全是缩小的侧边卡、正中的大卡落在屏幕外。
        // 挂载后 4 秒内每帧比一次签名（滚动位/视宽/内容宽/子节点数），一变就重算。
        let watchFrame = 0;
        let signature = '';
        const watchStart = performance.now();
        const watch = (): void => {
            const sig = `${track.scrollLeft}|${track.clientWidth}|${inner ? inner.offsetWidth : 0}|${
                inner ? inner.children.length : 0
            }`;
            if (sig !== signature) {
                signature = sig;
                refresh();
            }
            if (performance.now() - watchStart < 4000) watchFrame = requestAnimationFrame(watch);
        };
        watchFrame = requestAnimationFrame(watch);

        return () => {
            timers.forEach((id) => window.clearTimeout(id));
            observer?.disconnect();
            track.removeEventListener('scroll', refresh);
            window.removeEventListener('resize', refresh);
            cancelAnimationFrame(frameRef.current);
            cancelAnimationFrame(watchFrame);
        };
    }, [refresh, items.length, width, pad]);

    const { draggingRef, handlers } = useRailScroll(trackRef, innerRef, refresh);

    const settle = (node: HTMLElement): void => {
        const track = trackRef.current;
        if (!track) return;
        const trackRect = track.getBoundingClientRect();
        const cardRect = node.getBoundingClientRect();
        const delta = (cardRect.left + cardRect.width / 2) - (trackRect.left + trackRect.width / 2);
        if (Math.abs(delta) > 4) track.scrollTo({ left: track.scrollLeft + delta, behavior: 'smooth' });
    };

    return (
        <div
            ref={trackRef}
            data-lx-rail={testId ?? 'cards'}
            className={`w-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory cursor-grab ${align === 'center' ? 'py-0.5' : 'pb-0.5'}`}
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            {...handlers}
        >
            <div
                ref={innerRef}
                className={`flex w-max gap-2 ${align === 'center' ? 'items-center' : 'items-start'}`}
                style={{ paddingLeft: pad, paddingRight: pad, marginLeft: 'auto', marginRight: 'auto' }}
            >
                {items.map((item) => {
                    const active = item.key === activeKey || item.key === '';
                    return (
                        <button
                            key={item.key}
                            type="button"
                            data-lx-card="true"
                            data-lx-key={item.key}
                            disabled={item.disabled}
                            onClick={(event) => {
                                if (item.disabled) return;
                                if (draggingRef.current) return;
                                const node = event.currentTarget;
                                // 不在中间的那张：先把它滑到中间，再点一次才真正进去。
                                if (node.dataset.lxCentered !== 'true') {
                                    settle(node);
                                    return;
                                }
                                onSelect(item.key);
                            }}
                            className={`snap-center shrink-0 relative flex flex-col items-stretch text-left transition-[box-shadow,border-color,transform] duration-300 select-none ${
                                item.disabled ? 'cursor-default' : 'cursor-pointer'
                            } ${active ? 'ring-1 ring-white/25' : ''}`}
                            style={{
                                width,
                                padding: 16,
                                borderRadius: 12,
                                background: isDaylight ? 'rgba(255,255,255,0.74)' : 'rgba(0,0,0,0.40)',
                                border: isDaylight ? '1px solid rgba(0,0,0,0.12)' : '1px solid rgba(255,255,255,0.12)',
                                boxShadow: isDaylight
                                    ? '0 10px 24px -16px rgba(0,0,0,0.35)'
                                    : '0 16px 34px -18px rgba(0,0,0,0.75)',
                                backdropFilter: 'blur(14px) saturate(1.2)',
                                WebkitBackdropFilter: 'blur(14px) saturate(1.2)',
                            }}
                            title={item.caption ? `${item.title} · ${item.caption}` : item.title}
                        >
                            <div className="relative shrink-0 overflow-hidden" style={{ width: width - 34, height: width - 34, borderRadius: 8 }}>
                                {item.coverUrl ? (
                                    <img
                                        src={item.coverUrl}
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                        draggable={false}
                                        className="h-full w-full object-cover pointer-events-none select-none"
                                    />
                                ) : (
                                    <div
                                        className="flex h-full w-full items-center justify-center text-[22px] font-semibold opacity-40"
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        {item.title.slice(0, 1)}
                                    </div>
                                )}
                            </div>
                            <div className="flex w-full flex-col justify-start gap-0.5 pt-3.5" style={{ minHeight: 58 }}>
                                <span
                                    className="text-[15px] font-semibold leading-[20px]"
                                    style={{
                                        color: 'var(--text-primary)',
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden',
                                    }}
                                >
                                    {item.title}
                                </span>
                                {item.caption && (
                                    <span className="truncate text-[11px] leading-[15px] opacity-55">{item.caption}</span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
