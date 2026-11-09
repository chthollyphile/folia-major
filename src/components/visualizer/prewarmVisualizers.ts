import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { VISUALIZER_REGISTRY, getVisualizerRegistryEntry, type VisualizerRegistryEntry } from './registry';

// src/components/visualizer/prewarmVisualizers.ts
// 让启动慢的歌词样式提前准备（entry 的 `prewarm`，definition.ts；比如雾笺在后台先编着色器），分两档：
// - 保存的样式：应用一启动就调（首屏加载遮罩还在），它马上要挂上；
// - 声明了 `prewarmWhenIdle` 的其他样式：首屏出来后再等一会儿，页面空闲时调，第一次切过去时就不用现准备。
// 都在主窗口里，各调一次。

/** 首屏出来后先等这么久再找空闲：启动时的加载、首屏的布局和图片解码先做完。 */
const IDLE_DELAY_MS = 2500;
/** 一直不空闲时最多再等这么久，到点照样调。 */
const IDLE_TIMEOUT_MS = 10_000;

const run = (entry: VisualizerRegistryEntry) => {
    try {
        entry.prewarm?.();
    } catch (error) {
        console.warn(`[Visualizer] prewarm of ${entry.mode} failed`, error);
    }
};

/** 保存的那个样式：主窗口启动时调一次（bootstrap.tsx）。 */
export const prewarmSavedVisualizer = (): void => {
    const { visualizerMode } = useVisualizerSettingsStore.getState();
    const entry = getVisualizerRegistryEntry(visualizerMode);
    // 存着的模式没注册时注册表退回默认样式：那不是保存的样式，不替它准备
    if (entry.mode !== visualizerMode) return;
    run(entry);
};

let idleScheduled = false;

/** 其他声明了 `prewarmWhenIdle` 的样式：首屏挂好时调（bootstrap.tsx），过一会儿等页面空闲再准备；再调（StrictMode 下 effect 跑两遍）不再排。 */
export const prewarmVisualizersWhenIdle = (): void => {
    if (idleScheduled) return;
    idleScheduled = true;
    setTimeout(() => {
        const start = () => {
            const saved = useVisualizerSettingsStore.getState().visualizerMode;
            // 保存的样式启动时已经准备过
            for (const entry of VISUALIZER_REGISTRY) if (entry.prewarmWhenIdle && entry.mode !== saved) run(entry);
        };
        if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
        else start();
    }, IDLE_DELAY_MS);
};
