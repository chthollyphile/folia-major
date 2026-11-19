import type { StageLoopMode } from '../types';

// src/utils/loopMode.ts
// 循环按钮显示的模式和按一下之后的模式。只依赖类型：设置 store 也引它，不能连带加载平台注册表。

/**
 * 循环按钮显示、各处读到的循环模式。私人 FM 里单曲循环照常生效，列表循环没有可绕回的队首，
 * 显示为不循环；存着的偏好不变，退出 FM 后原样回来（#1225）。
 */
export const shownLoopMode = (loopMode: StageLoopMode, isFmMode: boolean): StageLoopMode => (
    isFmMode && loopMode === 'all' ? 'off' : loopMode
);

/** 按一下循环按钮之后的模式：不循环 → 列表循环 → 单曲循环 → 不循环；私人 FM 里跳过列表循环，从显示的模式往下走。 */
export const nextLoopMode = (loopMode: StageLoopMode, isFmMode: boolean): StageLoopMode => {
    const shown = shownLoopMode(loopMode, isFmMode);
    if (shown === 'off') return isFmMode ? 'one' : 'all';
    return shown === 'all' ? 'one' : 'off';
};
