import { useLayoutEffect } from 'react';
import { useBottomDockStore } from '../stores/useBottomDockStore';
import { resolveBottomLayout } from '../utils/playerBottomBarLayout';

// src/hooks/useBottomLayoutTracking.ts
// 主窗口按窗口宽度在紧凑档和桌面档之间切换（progress-bar v3）。只听 resize、只在跨档时写一次 store，
// 不量任何元素。挂在主窗口的覆盖层上，OBS 之类的独立页面不挂，它们的底部组件一直是桌面档。

export const useBottomLayoutTracking = (): void => {
    // layout effect：第一次判断在首帧绘制之前做完，窄窗口打开时不会先闪一下桌面布局。
    useLayoutEffect(() => {
        const store = useBottomDockStore.getState();
        let current = resolveBottomLayout(window.innerWidth, null);
        store.setLayout(current);
        store.setTracking(true);
        const onResize = () => {
            const next = resolveBottomLayout(window.innerWidth, current);
            if (next === current) return;
            current = next;
            useBottomDockStore.getState().setLayout(next);
        };
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
            useBottomDockStore.getState().setTracking(false);
        };
    }, []);
};
