import React from 'react';
import { ChevronLeft, ListPlus, Play, Search } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from '../PonderSurfaceStateLayer';
import {
    GRID_VIEW_CARD_COUNT,
    GRID_VIEW_FOCUSED_CARD,
    GRID_VIEW_GEOMETRY as G,
    gridViewCardRect,
} from './gridViewPage.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/library/gridViewPage.surface.tsx
// 位置一律来自 gridViewPage.geometry —— 这里和 gridViewPage.target.ts 的锚点是同一组数。

type PonderGridViewPageSurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

const GridCards: React.FC<{ accent: string; line: string; outline: string; focused?: boolean }> = ({ accent, line, outline, focused }) => (
    <div data-ponder-grid-view-cards style={relativeRectStyle(G.cards)}>
        {Array.from({ length: GRID_VIEW_CARD_COUNT }, (_, index) => {
            const selected = index === GRID_VIEW_FOCUSED_CARD;
            return (
                <span
                    key={index}
                    data-ponder-grid-view-card
                    data-focused={selected || undefined}
                    className="rounded-[11%] border shadow-md"
                    style={{
                        ...relativeRectStyle(gridViewCardRect(index)),
                        borderColor: selected && focused ? accent : outline,
                        backgroundColor: selected ? accent : line,
                        opacity: selected ? 0.62 : 0.48,
                        // 缩放会让画出来的卡和锚点框错开，焦点改用描边表示。
                        boxShadow: selected && focused ? `0 0 0 2px ${accent}` : undefined,
                    }}
                />
            );
        })}
    </div>
);

const PonderGridViewPageSurface: React.FC<PonderGridViewPageSurfaceProps> = ({
    accent,
    line,
    outline,
    registerStateNode,
}) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-grid-view-page-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <span
                data-ponder-grid-view-back
                className="flex items-center justify-center rounded-full border"
                style={{ ...relativeRectStyle(G.back), borderColor: outline }}
            >
                <ChevronLeft className="h-1/2 w-1/2 opacity-60" />
            </span>
            <div
                data-ponder-grid-view-title
                className="flex flex-col items-center justify-center gap-[14%] rounded-xl"
                style={relativeRectStyle(G.title)}
            >
                <span className="h-[15%] w-[60%] rounded-full" style={{ backgroundColor: line }} />
                <span className="h-[9%] w-[84%] rounded-full opacity-55" style={{ backgroundColor: line }} />
            </div>
            <GridCards accent={accent} line={line} outline={outline} />
        </PonderSurfaceBase>

        {/* 重画一遍卡片阵列，必须替换基础层，否则两层卡片会叠成重影。 */}
        <PonderSurfaceStateLayer state="card-focused" registerStateNode={registerStateNode} replaces>
            <GridCards accent={accent} line={line} outline={outline} focused />
        </PonderSurfaceStateLayer>

        {/* 信息面板是压在页面上的一侧抽屉，底下那屏要留着。 */}
        <PonderSurfaceStateLayer state="info-open" registerStateNode={registerStateNode}>
            <div
                data-ponder-grid-view-info
                className="flex flex-col rounded-[8%] border bg-zinc-950/95 p-[4%] shadow-2xl"
                style={{ ...relativeRectStyle(G.info), borderColor: outline }}
            >
                <span className="aspect-square w-full rounded-[7%]" style={{ backgroundColor: accent, opacity: 0.48 }} />
                <span className="mt-[8%] h-2 w-[72%] rounded-full" style={{ backgroundColor: line }} />
                <span className="mt-[4%] h-1 w-[48%] rounded-full opacity-60" style={{ backgroundColor: line }} />
                <div className="mt-auto flex flex-col gap-2">
                    <span className="flex h-8 items-center justify-center gap-2 rounded-full" style={{ backgroundColor: accent, opacity: 0.68 }}>
                        <Play className="h-3 w-3" />
                    </span>
                    <span className="flex h-8 items-center justify-center gap-2 rounded-full border" style={{ borderColor: outline }}>
                        <ListPlus className="h-3 w-3 opacity-55" />
                    </span>
                </div>
            </div>
        </PonderSurfaceStateLayer>

        <PonderSurfaceStateLayer state="filter-open" registerStateNode={registerStateNode} replaces>
            <div className="absolute inset-0 bg-zinc-950/70" />
            <GridCards accent={accent} line="rgba(255,255,255,0.05)" outline={outline} focused />
            <div
                data-ponder-grid-view-filter
                className="flex items-center gap-[4%] rounded-2xl border bg-zinc-950/95 px-[5%]"
                style={{ ...relativeRectStyle(G.filter), borderColor: outline }}
            >
                <Search className="h-[44%] w-auto opacity-55" />
                <span className="h-2 w-[58%] rounded-full" style={{ backgroundColor: line }} />
                <span className="ml-auto h-5 w-[14%] rounded-full border" style={{ borderColor: outline }} />
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'grid-view-page': PonderGridViewPageSurface,
} satisfies PonderSurfaceDeclarations;
