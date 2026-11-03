import type { LibraryHomeData, LibraryHomeLocalMusicState } from '../../../library/core/home/home.contract';

// src/components/app/home/homeSurfaceTypes.ts
// 首页模型的形状。R3 起定义在 Library Core 的首页契约（library/core/home/home.contract），任何一套 suite 的首页
// surface 都按它接收；这里保留应用侧一直在用的名字。

export type HomeLocalMusicState = LibraryHomeLocalMusicState;

export type HomeSurfaceProps = LibraryHomeData;
