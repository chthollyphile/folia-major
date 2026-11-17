import { useDesktopSettingsStore } from '../stores/useDesktopSettingsStore';
import { resolveUiZoomFactor } from '../utils/uiZoom';

// src/services/uiZoomRuntime.ts
// 界面缩放（#1264）套到主窗口上：启动时在首屏渲染前套一次，之后跟着设置改。只在桌面版的主窗口装
// （bootstrap.tsx）；遥控窗口尺寸固定，不缩放。

let installed = false;

/** 按当前设置缩放这个窗口，并在开关或挡位改动时跟着改。web 版没有 preload，什么也不做。 */
export const installUiZoom = () => {
    const electron = window.electron;
    if (installed || !electron?.setPageZoomFactor) return;
    installed = true;
    // 和窗口现在的缩放比，不和上次设的比：默认菜单的 Ctrl+=/-/0 会绕过设置改掉它，再选一次同一挡要能改回来。
    // 启动时也一样：同源页面按源记着的缩放（例如以前按过 Ctrl+-）不一样就盖掉。
    const apply = (enabled: boolean, step: Parameters<typeof resolveUiZoomFactor>[1]) => {
        const factor = resolveUiZoomFactor(enabled, step);
        if (Math.abs(electron.getPageZoomFactor() - factor) < 0.001) return;
        electron.setPageZoomFactor(factor);
        console.info(`[UiZoom] page zoom ${Math.round(factor * 100)}%`);
    };
    const initial = useDesktopSettingsStore.getState();
    apply(initial.uiZoomEnabled, initial.uiZoomStep);
    useDesktopSettingsStore.subscribe(state => apply(state.uiZoomEnabled, state.uiZoomStep));
};
