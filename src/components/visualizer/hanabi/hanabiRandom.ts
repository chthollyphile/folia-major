// Copyright (c) 2026 chthollyphile
import { createVisualizerRng } from '../visualizerSeedHash';

// src/components/visualizer/hanabi/hanabiRandom.ts
// 花火的确定性随机数：按 key 播种的流（visualizerSeedHash 的 mulberry32）。编译、烟花事件、装饰件、逐字动画的
// 随机量全部从这里取，每帧画面只由时间决定——seek、重建、预热都不会改变画面。

export const createRng = createVisualizerRng;
