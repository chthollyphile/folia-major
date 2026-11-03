import type { ComponentType } from 'react';
import type { PonderSurfaceKind } from '../../../types/ponder';
import type { PonderSurfaceStateRegistrar } from './PonderSurfaceStateLayer';

// src/components/ponder/surfaces/surfaceDeclarations.ts
// 一张合成界面怎么报上自己的名字。
//
// 每个 *.surface.tsx 默认导出一张「kind → 画它的组件」的表，PonderSurfaceContents 用 glob 收齐。
// 新增一种 kind：在 types/ponder.ts 的 PonderSurfaceKind 里登记名字，再写它的 *.surface.tsx
// （或者加进画同一屏的那个文件）。它的尺寸放在旁边的 *.geometry.ts 里，教程从那里引用 ——
// 尺寸不和组件写在同一个文件：教程文件随注册表在启动时加载，不能把组件一起拖进来。

export type PonderSurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

export type PonderSurfaceDeclarations = Partial<Record<PonderSurfaceKind, ComponentType<PonderSurfaceProps>>>;
