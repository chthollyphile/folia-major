import React from 'react';
import type { PonderSurfaceKind } from '../../types/ponder';
import type { PonderSurfaceDeclarations, PonderSurfaceProps } from './surfaces/surfaceDeclarations';

// src/components/ponder/PonderSurfaceContents.tsx
// Synthetic surfaces imitate the silhouette of the real UI without mounting live settings or
// command-palette state. Their job is recognition: a queue should read as songs, not paragraph text.
//
// 每种 kind 画成什么，由 surfaces/ 下的 *.surface.tsx 自己声明（默认导出一张 kind → 组件的表），
// 这里只把它们收齐。照 ponderRegistry 收 targets 的做法：新增一种 kind 不用改这个文件。

const surfaceModules = import.meta.glob<{ default: PonderSurfaceDeclarations }>(
    './surfaces/**/*.surface.tsx',
    { eager: true },
);

const collectDrawings = () => {
    const byKind: PonderSurfaceDeclarations = {};
    for (const [path, module] of Object.entries(surfaceModules)) {
        if (!module.default) {
            throw new Error(`[PonderSurfaces] Missing default export in ${path}`);
        }
        for (const kind of Object.keys(module.default) as PonderSurfaceKind[]) {
            if (byKind[kind]) {
                throw new Error(`[PonderSurfaces] Duplicate surface kind "${kind}" in ${path}`);
            }
            byKind[kind] = module.default[kind];
        }
    }
    return byKind;
};

const SURFACE_DRAWINGS = collectDrawings();

type PonderSurfaceContentsProps = PonderSurfaceProps & {
    kind?: PonderSurfaceKind;
};

const PonderSurfaceContents: React.FC<PonderSurfaceContentsProps> = ({ kind, accent, line, outline, registerStateNode }) => {
    const resolvedKind = kind ?? 'palette';
    // 没人声明的 kind（模组可以随手写一个）照旧画成命令窗口。
    const Drawing = SURFACE_DRAWINGS[resolvedKind] ?? SURFACE_DRAWINGS.palette;

    return (
        <div className="absolute inset-0" data-ponder-surface-kind={resolvedKind}>
            {Drawing && <Drawing accent={accent} line={line} outline={outline} registerStateNode={registerStateNode} />}
        </div>
    );
};

export default PonderSurfaceContents;
