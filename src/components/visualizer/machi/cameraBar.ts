// src/components/visualizer/machi/cameraBar.ts
// 町景的取景控制条开着没有：控制面板里的摄影机按钮和命令面板打开它，播放页上的町景画面（VisualizerMachi，预览里不算）
// 照着显示。离开播放页、播放页的町景画面拆掉时（换了别的歌词样式）收起来，下次回来不会自己冒出来。

let open = false;
const listeners = new Set<() => void>();

const setOpen = (next: boolean) => {
    if (open === next) return;
    open = next;
    listeners.forEach(listener => listener());
};

export const openMachiCameraBar = () => setOpen(true);

export const closeMachiCameraBar = () => setOpen(false);

export const toggleMachiCameraBar = () => setOpen(!open);

export const isMachiCameraBarOpen = () => open;

export const subscribeMachiCameraBar = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
