import { useEffect, useState } from 'react';

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

    useEffect(() => {
        if (!enabled) {
            setHidden(false);
            return;
        }

        // 触摸设备收不到 mousemove，指针隐藏会永久挂着，直接不启用。
        if (!window.matchMedia('(pointer: fine)').matches) {
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

        const reveal = () => setHidden(false);
        const bump = () => {
            window.clearTimeout(timerId);
            reveal();
            timerId = window.setTimeout(() => setHidden(true), delay);
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

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mousedown', bump);
        window.addEventListener('wheel', bump);
        window.addEventListener('pointerup', bump);
        window.addEventListener('keydown', bump);
        return () => {
            window.clearTimeout(timerId);
            if (rafId !== undefined) cancelAnimationFrame(rafId);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mousedown', bump);
            window.removeEventListener('wheel', bump);
            window.removeEventListener('pointerup', bump);
            window.removeEventListener('keydown', bump);
            setHidden(false);
        };
    }, [enabled, delay, suppressPointerReveal]);

    return hidden;
}