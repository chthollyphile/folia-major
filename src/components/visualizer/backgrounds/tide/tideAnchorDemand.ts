// src/components/visualizer/backgrounds/tide/tideAnchorDemand.ts
//
// 逐字锚点（tideAnchorBridge）只有 tide 背景在「跟随歌词」时才有人读：商籁 / 绘光把字画在
// Pixi 画布里，DOM 里没有字形，才需要主动把位置报出来。别的背景选中的时候没人读这份锚点，
// 但两个 canvas 模式过去每帧仍在调 getGlobalPosition() 并发布，白白让其他背景买单。
//
// 这里统一回答「现在该不该发布」：当前背景是 tide，且它的 followLyrics 开着 —— 直接读全局
// 设置 store 的当前状态（useVisualizerSettingsStore.getState()），随开关即时生效，不必重建运行时。
import { useVisualizerSettingsStore } from '../../../../stores/useVisualizerSettingsStore';

/** 只有 tide 是当前背景、且它开着跟随歌词时，canvas 类模式才需要发布逐字锚点。 */
export const shouldPublishTideAnchors = (): boolean => {
    const state = useVisualizerSettingsStore.getState();
    return state.visualizerBackgroundMode === 'tide' && state.tideBackgroundTuning.followLyrics;
};
