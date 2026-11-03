import { useSyncExternalStore } from 'react';
import type { LibraryHomeActionsController, LibraryHomeActionsSnapshot } from './homeModel.contract';
import { homeScanPercent, isHomeImportBusy } from './homeSources';

// src/library/core/home/useLibraryHomeActions.ts
// 首页动作控制器的绑定：订阅快照（哪个导入在进行、扫描进度），给出三个导入按钮共用的「忙」与扫描百分比。
// 订阅本身让控制器开始听扫描进度（最后一个订阅者离开时停）。

export const useLibraryHomeActions = (controller: LibraryHomeActionsController): {
    snapshot: LibraryHomeActionsSnapshot;
    importBusy: boolean;
    scanPercent: number;
} => {
    const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
    return {
        snapshot,
        importBusy: isHomeImportBusy(snapshot),
        scanPercent: homeScanPercent(snapshot.scan),
    };
};
