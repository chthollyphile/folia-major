// Copyright (c) 2026 chthollyphile
import { createVisualizerRng, createVisualizerRngAt } from '../visualizerSeedHash';

// src/components/visualizer/lumiere/lumiereRandom.ts
// 绘光的确定性随机数：按 key 播种的 mulberry32 流（key 先经 FNV-1a 散列）。场景构建与编译里的随机量
// 全部从这里取，同一首歌同一个种子永远得到同一帧——seek、重建、预热都不会改变画面。
// 流本身与花火共用 visualizerSeedHash 的 createVisualizerRng。

/** mulberry32：32 位状态，周期 2^32，对装饰用的随机足够。数字种子直接当状态，字符串种子先散列。 */
export const createRng = createVisualizerRng;

/**
 * 与 createRng(seed) 同一条流，但从第 skip 个值之后开始：mulberry32 每取一次状态加一个常数，跳过是 O(1)。
 * 歌词窗口按需构建某一行时用它直接跳到这一行的起点，拿到的值与从头顺序取完全一样。
 */
export const createRngAt = createVisualizerRngAt;
