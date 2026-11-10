import { useRef, useState } from 'react';
import type { LibraryDirectoryBatchController } from '../core/directory/directory.contract';
import type { HomeSurfaceProps } from '../../components/app/home/homeSurfaceTypes';
import { createLocalDirectoryActions } from '../core/directory/localDirectoryActions.service';
import { createLibraryDirectoryBatchPort } from './createLibraryDirectoryBatchPort';

// src/library/app/useLibraryDirectoryBatchController.ts
// 首页外壳持有的目录批量动作控制器：整个首页一个、生命周期跟着首页（进行中的动作与 pending 不因曲库刷新、
// 回调换新而丢）。端口经 ref 现读最新的 surface，所以控制器本身不随渲染重建，也不让外壳多渲染一次。

export const useLibraryDirectoryBatchController = (surface: HomeSurfaceProps): LibraryDirectoryBatchController => {
    // 渲染时赋值（不放 effect）：effect 之前的窗口里动作会读到上一次渲染的曲库。
    const surfaceRef = useRef(surface);
    surfaceRef.current = surface;
    const [controller] = useState(() => createLocalDirectoryActions(
        createLibraryDirectoryBatchPort(() => surfaceRef.current),
    ));
    return controller;
};
