import { useCallback, useRef } from 'react';

// src/hooks/useCarouselDragScroll.ts
//
// 让结果横条能用鼠标拖着滚。
//
// 为什么需要：横条是 `overflow-x-auto`，触控板/触屏本来能滚，但**鼠标用户**只能去找那条
// 细滚动条——条目多的时候非常难用。而直接给容器挂 pointermove 监听有个坑：横条里全是
// <button>，按下→拖动→松手会被浏览器判成"拖拽选中"而不是滚动，且松手时若指针在按钮上
// 还会顺带触发一次点击，把用户不想点的歌给放了。
//
// 所以纪律有两条：拖动期间抑制点击（移动超过阈值就取消这次点击），阈值要大于手抖、
// 小于"我确实想拖"的距离。

const CLICK_SUPPRESS_PX = 6;

export const useCarouselDragScroll = () => {
    const anchor = useRef<{ pointerId: number; startX: number; startScroll: number; moved: boolean } | null>(null);

    const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        // 只接管鼠标左键与触摸；右键/中键留给系统。
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        anchor.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startScroll: event.currentTarget.scrollLeft,
            moved: false,
        };
    }, []);

    const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const state = anchor.current;
        if (!state || state.pointerId !== event.pointerId) return;
        const delta = event.clientX - state.startX;
        if (!state.moved && Math.abs(delta) < CLICK_SUPPRESS_PX) return;

        if (!state.moved) {
            state.moved = true;
            // 一旦判定为拖动，抓住指针，否则指针离开容器就收不到 move。
            event.currentTarget.setPointerCapture?.(event.pointerId);
        }
        event.currentTarget.scrollLeft = state.startScroll - delta;
    }, []);

    const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const state = anchor.current;
        if (!state || state.pointerId !== event.pointerId) return;
        // 真的拖过：吞掉随后的 click，免得松手时把光标下的那首歌给放了。
        if (state.moved) {
            const swallow = (clickEvent: MouseEvent) => {
                clickEvent.preventDefault();
                clickEvent.stopPropagation();
            };
            event.currentTarget.addEventListener('click', swallow, { capture: true, once: true });
        }
        anchor.current = null;
    }, []);

    return {
        onPointerDown,
        onPointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
    };
};
