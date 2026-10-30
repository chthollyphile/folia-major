import type { MachiSceneId } from './types';

// src/components/visualizer/machi/shownScene.ts
// 正在画的是哪个场景：“自动”时按歌选，设置面板自己算不出来，自定义视角的滑块要知道该调哪个场景的那一份。
// 运行时换上场景时报上来、拆掉时撤掉。几个运行时同时在（播放页一个、样式窗口的大预览一个）时以后出现的那个为准：
// 样式窗口开着时就是面板旁边那张预览，关掉以后回到播放页那个。

const shown = new Map<object, MachiSceneId>();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach(listener => listener());

export const reportMachiShownScene = (owner: object, id: MachiSceneId) => {
    if (shown.get(owner) === id) return;
    // 已经在的运行时换场景，留在原来的位置（Map 的顺序不变）。
    shown.set(owner, id);
    notify();
};

export const withdrawMachiShownScene = (owner: object) => {
    if (shown.delete(owner)) notify();
};

export const subscribeMachiShownScene = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export const getMachiShownScene = (): MachiSceneId | null => {
    let latest: MachiSceneId | null = null;
    shown.forEach(id => { latest = id; });
    return latest;
};
