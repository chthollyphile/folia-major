import type { LibraryBackdropSnapshot, LibrarySuiteBackdrop } from '../../../core/suite/suite.contract';
import { NEUTRAL_LIBRARY_BACKDROP } from '../../../core/suite/libraryBackdrop';
import { readReducedMotion, resolveReducedMotion, useMotionSettingsStore } from '../../../../stores/useMotionSettingsStore';

// src/library/suites/grid/transitions/gridBackdrop.ts
// 网格自行解析移形换影的背景板与启用状态；宿主不再读取网格动效设置或携带网格时长。
// 「降低动态效果」的这一面。关掉之后转场完全不出现（不藏 hero、不飞卡片、背景板按原来的
// 0.18s 淡入），而不是缩短成一次更快的飞行 —— 转场是纯装饰，降级就该是原来的行为。
// 移形换影也只属于网格：TUI 没有卡片可飞，开着只会让首页那张卡的残影盖在列表上。
// （网格以外的 suite 不声明 transitions，于是它渲染集合层时转场关闭。）
// 时长只在降级时回到官方原版的 0.18s：移形换影关闭后不该还留着
// 一段为飞行准备的慢淡入。开着的时候维持作者调的 0.62s / 0.28s。
const GRID_BACKDROP: LibraryBackdropSnapshot = {
    enabled: true,
    enter: { duration: 0.62, ease: [0.22, 1, 0.36, 1] },
    exit: { duration: 0.28, ease: [0.4, 0, 0.2, 1] },
};
const REDUCED_GRID_BACKDROP: LibraryBackdropSnapshot = { ...NEUTRAL_LIBRARY_BACKDROP, enabled: false };

export const gridBackdrop: LibrarySuiteBackdrop = {
    getSnapshot: () => readReducedMotion('collectionMorph') ? REDUCED_GRID_BACKDROP : GRID_BACKDROP,
    // 只有网格这面的最终降级状态变化才通知；别的动效设置不会让宿主重渲染。
    subscribe: listener => useMotionSettingsStore.subscribe((state, previous) => {
        if (resolveReducedMotion(state, 'collectionMorph') !== resolveReducedMotion(previous, 'collectionMorph')) listener();
    }),
};
