import { useEffect, useState } from 'react';
import { useMediaQuery } from './useMediaQuery';

// src/hooks/useCursorAutoHide.ts
// 播放页鼠标指针自动隐藏：空闲一段时间后隐藏指针，移动/点击/滚轮/键盘操作立即唤回。
// 返回 hidden 布尔值，由调用方决定把隐藏 class 挂到哪个容器上。
type UseCursorAutoHideOptions = {
    delay?: number;
    suppressPointerReveal?: boolean;
};

export function useCursorAutoHide(
    enabled: boolean,
    { delay = 1200, suppressPointerReveal = false }: UseCursorAutoHideOptions = {},
) {
    const [hidden, setHidden] = useState(false);
    const hasFinePointer = useMediaQuery('(any-pointer: fine)');

    useEffect(() => {
        if (!enabled || !hasFinePointer) {
            setHidden(false);
            return;
        }

        // 点击穿透（桌面宠物）模式下，鼠标在别的窗口，mousemove 仍会进入渲染进程，
        // 会无限重置计时器。此时直接隐藏指针，不监听鼠标。
        if (suppressPointerReveal) {
            setHidden(true);
            return;
        }

        let timerId: number | undefined;
        let rafId: number | undefined;
        let isThrottled = false;
        let pointerHeld = false;

        const reveal = () => setHidden(false);
        const scheduleHide = () => {
            window.clearTimeout(timerId);
            if (pointerHeld) return;
            timerId = window.setTimeout(() => setHidden(true), delay);
        };
        const bump = () => {
            reveal();
            scheduleHide();
        };
        bump();

        const handleMouseMove = () => {
            if (isThrottled) return;
            isThrottled = true;
            rafId = requestAnimationFrame(() => {
                bump();
                isThrottled = false;
            });
        };
        const handlePointerDown = () => {
            pointerHeld = true;
            window.clearTimeout(timerId);
            reveal();
        };
        const handlePointerUp = () => {
            pointerHeld = false;
            bump();
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerUp);
        window.addEventListener('wheel', bump);
        window.addEventListener('keydown', bump);
        return () => {
            window.clearTimeout(timerId);
            if (rafId !== undefined) cancelAnimationFrame(rafId);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);
            window.removeEventListener('wheel', bump);
            window.removeEventListener('keydown', bump);
            setHidden(false);
        };
    }, [enabled, delay, suppressPointerReveal, hasFinePointer]);

    return hidden;
}
