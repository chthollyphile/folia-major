import type { MachiSceneId } from '../types';
import { KONBINI_SCENE } from './konbini/konbiniScene';
import { KOWLOON_SCENE } from './kowloon/kowloonScene';
import { STATION_SCENE } from './station/stationScene';
import type { MachiSceneDefinition } from './types';

// src/components/visualizer/machi/scenes/index.ts
// 町景的场景表：场景 id → 场景定义。场景都跟运行时在同一个按需加载的块里。

export const MACHI_SCENES: Record<MachiSceneId, MachiSceneDefinition> = {
    konbini: KONBINI_SCENE,
    station: STATION_SCENE,
    kowloon: KOWLOON_SCENE,
};
