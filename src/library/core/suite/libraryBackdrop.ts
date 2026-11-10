import type { LibraryBackdropSnapshot } from './suite.contract';

// src/library/core/suite/libraryBackdrop.ts
// 未声明背景板的 suite 使用统一的中性淡入淡出，不限制它自行声明的转场钩子。
export const NEUTRAL_LIBRARY_BACKDROP: LibraryBackdropSnapshot = {
    enabled: true,
    enter: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
};
