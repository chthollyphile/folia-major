import { useSyncExternalStore } from 'react';
import type { LibrarySuiteBackdrop } from '../core/suite/suite.contract';
import { NEUTRAL_LIBRARY_BACKDROP } from '../core/suite/libraryBackdrop';

// src/library/app/useLibraryBackdrop.ts
// 宿主消费 suite 的背景板快照；切换 suite 时 React 自动换订阅，SSR 使用中性背景板。
const readNeutral = () => NEUTRAL_LIBRARY_BACKDROP;
const subscribeNeutral = () => () => {};

export const useLibraryBackdrop = (backdrop?: LibrarySuiteBackdrop) => useSyncExternalStore(
    backdrop?.subscribe ?? subscribeNeutral,
    backdrop?.getSnapshot ?? readNeutral,
    readNeutral,
);
