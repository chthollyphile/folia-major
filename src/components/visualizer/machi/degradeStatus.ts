// src/components/visualizer/machi/degradeStatus.ts
// 自动降级现在压下去了几格：运行时降一格（或改了画质归零）时报上来、拆掉时撤掉，设置面板在「自动降级」那一行写出来，
// 用的人能看出画面为什么比选的低。预览（样式窗口里的那张）不降级，也不报；几个运行时同时在时取压得最多的那个。

const degraded = new Map<object, number>();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach(listener => listener());

export const reportMachiDegrade = (owner: object, steps: number) => {
    if (degraded.get(owner) === steps) return;
    degraded.set(owner, steps);
    notify();
};

export const withdrawMachiDegrade = (owner: object) => {
    if (degraded.delete(owner)) notify();
};

export const subscribeMachiDegrade = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export const getMachiDegrade = (): number => {
    let most = 0;
    degraded.forEach(steps => { most = Math.max(most, steps); });
    return most;
};
