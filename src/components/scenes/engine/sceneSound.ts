import type { SceneSound } from '../definition';

// src/components/scenes/engine/sceneSound.ts
// 声音接上来的地方。第一期没有房间声：场景拿到的 ctx.sound 什么都不做（tier 'off'），音乐照原样放。
// 第二期在这里换成 src/services/sceneSound/ 的实现（主窗口播放页才出声，预览和 OBS 仍用这个空实现），场景代码不用改。

export const silentSceneSound: SceneSound = {
    setAcoustics: () => {},
    moveObject: () => {},
    setListener: () => {},
    play: () => ({ stop: () => {} }),
    tier: 'off',
};
