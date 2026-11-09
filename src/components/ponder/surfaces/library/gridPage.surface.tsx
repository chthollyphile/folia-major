import React from 'react';
import { ChevronLeft, Command, Map, PanelsTopLeft, Search, Settings } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from '../PonderSurfaceStateLayer';
import { GRID_CARDS, GRID_FOCUSED_CARD, GRID_GEOMETRY as G, TAB_SWITCH_CARDS } from './gridPage.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/library/gridPage.surface.tsx
// 位置一律来自 gridPage.geometry —— 这里和 gridPage.target.ts 的锚点是同一组数。
//
// 卡片轨道刻意用绝对定位而不是 flex + scale：flex 算出来的位置和 scale 之后的视觉尺寸
// 都表达不成锚点里的比例，卡片一缩放，高亮框就落在卡片旁边。

/** 卡片轨道所在的层。换源时只替换它，页头留在 base 上。 */
const GRID_RAIL_STATE = 'rail';

type PonderGridPageSurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

const Line: React.FC<{ width: string; line: string; className?: string }> = ({ width, line, className = '' }) => (
    <span className={`block rounded-full ${className}`} style={{ width, backgroundColor: line }} />
);

const Honeycomb: React.FC<{ line: string; outline: string; accent: string }> = ({ line, outline, accent }) => (
    <div className="absolute inset-[13%_8%_9%] grid grid-cols-5 grid-rows-3 gap-[3%]">
        {Array.from({ length: 14 }, (_, index) => (
            <span
                key={index}
                className="rounded-[16%] border"
                style={{
                    borderColor: outline,
                    backgroundColor: index === 7 ? accent : line,
                    opacity: index === 7 ? 0.62 : 0.5,
                    transform: `translateY(${index % 2 === 0 ? '14%' : '-8%'})`,
                }}
            />
        ))}
    </div>
);

/**
 * 卡片轨道。卡片和 shelf 都按页面坐标摆（平级，不嵌套），锚点用的就是这同一批数；
 * 中间那张是 focusedCard 锚点，所以它不做任何 transform —— 缩放会让高亮框落在卡片旁边。
 */
const CardShelf: React.FC<{ accent: string; line: string; outline: string }> = ({ accent, line, outline }) => (
    <>
        <div data-ponder-grid-shelf style={relativeRectStyle(G.shelf)} />
        {GRID_CARDS.map((card, index) => {
            const focused = index === GRID_FOCUSED_CARD;
            return (
                <div
                    key={index}
                    data-ponder-grid-card
                    data-focused={focused || undefined}
                    className="overflow-hidden rounded-[9%] border shadow-lg"
                    style={{
                        ...relativeRectStyle(card),
                        borderColor: focused ? accent : outline,
                        backgroundColor: focused ? accent : line,
                        opacity: focused ? 0.62 : 0.45,
                        transform: focused ? undefined : `perspective(400px) rotateY(${(index - GRID_FOCUSED_CARD) * -8}deg)`,
                    }}
                >
                    <span className="absolute bottom-[8%] left-[8%] h-[5%] w-[64%] rounded-full bg-current opacity-40" />
                </div>
            );
        })}
    </>
);

const PonderGridPageSurface: React.FC<PonderGridPageSurfaceProps> = ({
    accent,
    line,
    outline,
    registerStateNode,
}) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-grid-page-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <div data-ponder-grid-brand className="flex items-center gap-[8%]" style={relativeRectStyle(G.help)}>
                <Line width="42%" line={line} className="h-[18%]" />
                <span className="flex aspect-square w-[17%] items-center justify-center rounded-full border" style={{ borderColor: outline }}>
                    <Settings className="h-[52%] w-[52%] opacity-55" />
                </span>
            </div>
            <div
                data-ponder-grid-tabs
                className="flex items-center gap-[2%] rounded-full p-[1.2%]"
                style={{ ...relativeRectStyle(G.tabs), backgroundColor: line }}
            >
                {[0, 1, 2, 3].map(index => (
                    <span key={index} className="h-full flex-1 rounded-full" style={{ backgroundColor: index === 1 ? accent : 'transparent', opacity: index === 1 ? 0.5 : 1 }} />
                ))}
                <PanelsTopLeft className="h-[45%] w-auto opacity-45" />
            </div>
            <div
                data-ponder-grid-search
                className="flex items-center gap-[6%] rounded-full border px-[5%]"
                style={{ ...relativeRectStyle(G.search), borderColor: outline, backgroundColor: line }}
            >
                <Search className="h-[48%] w-auto opacity-45" />
                <Line width="72%" line={outline} className="h-[13%]" />
            </div>

            <div
                data-ponder-grid-map-trigger
                className="flex items-center justify-center gap-[8%] rounded-full border"
                style={{ ...relativeRectStyle(G.map), borderColor: outline }}
            >
                <Map className="h-[50%] w-auto opacity-55" />
                <Line width="38%" line={line} className="h-[15%]" />
            </div>
            <div data-ponder-grid-source-actions className="flex items-center gap-[4%]" style={relativeRectStyle(G.sourceActions)}>
                <span className="h-full flex-1 rounded-full border" style={{ borderColor: outline, backgroundColor: line }} />
                <span className="aspect-square h-full rounded-full border" style={{ borderColor: outline }} />
            </div>

        </PonderSurfaceBase>

        {/* 轨道单独成层：换源只换这一条，页头和来源动作留在 base 上不动。 */}
        <PonderSurfaceStateLayer state={GRID_RAIL_STATE} registerStateNode={registerStateNode} visible>
            <CardShelf accent={accent} line={line} outline={outline} />
            <div
                data-ponder-grid-focused-copy
                className="flex flex-col items-center justify-center gap-[13%]"
                style={relativeRectStyle(G.focusedCopy)}
            >
                <Line width="58%" line={line} className="h-[13%]" />
                <Line width="35%" line={line} className="h-[8%] opacity-60" />
            </div>
        </PonderSurfaceStateLayer>

        {/* 换标签页只换轨道上摆的是哪一批卡：替换轨道层，页头和来源动作留着 —— 这一章
            后半段还要讲来源动作，拿一块不透明的底去盖轨道会把它们一起埋掉。 */}
        <PonderSurfaceStateLayer state="tab-switched" registerStateNode={registerStateNode} replaces={GRID_RAIL_STATE}>
            <div
                className="rounded-full"
                style={{ ...relativeRectStyle(G.activeTab), backgroundColor: accent, opacity: 0.65 }}
            />
            {TAB_SWITCH_CARDS.map((card, index) => (
                <span
                    key={index}
                    className="rounded-[9%] border"
                    style={{
                        ...relativeRectStyle(card),
                        borderColor: outline,
                        backgroundColor: index === 1 ? accent : line,
                        opacity: 0.52,
                    }}
                />
            ))}
        </PonderSurfaceStateLayer>

        <PonderSurfaceStateLayer state="collection-open" registerStateNode={registerStateNode} replaces>
            <div className="absolute inset-0" style={{ backgroundColor: 'rgba(9,9,11,0.92)' }}>
                <span className="absolute left-[4%] top-[5%] flex aspect-square w-[6%] items-center justify-center rounded-full border" style={{ borderColor: outline }}>
                    <ChevronLeft className="h-1/2 w-1/2 opacity-60" />
                </span>
                <div className="absolute left-1/2 top-[6%] flex w-[32%] -translate-x-1/2 flex-col items-center gap-2">
                    <Line width="62%" line={line} className="h-2" />
                    <Line width="86%" line={line} className="h-1 opacity-55" />
                </div>
                <Honeycomb line={line} outline={outline} accent={accent} />
            </div>
        </PonderSurfaceStateLayer>

        <PonderSurfaceStateLayer state="map-open" registerStateNode={registerStateNode} className="bg-zinc-950/90" replaces>
            <div className="absolute left-[4%] top-[5%] flex h-[8%] w-[30%] items-center gap-[8%]">
                <ChevronLeft className="h-[65%] w-auto opacity-60" />
                <Line width="72%" line={line} className="h-[16%]" />
            </div>
            <div className="absolute right-[5%] top-[5%] flex h-[7%] w-[24%] items-center gap-[6%] rounded-full border px-[5%]" style={{ borderColor: outline }}>
                <Search className="h-[48%] w-auto opacity-45" />
                <Line width="70%" line={line} className="h-[14%]" />
            </div>
            <Honeycomb line={line} outline={outline} accent={accent} />
        </PonderSurfaceStateLayer>

        <PonderSurfaceStateLayer state="search-open" registerStateNode={registerStateNode} className="bg-zinc-950/90" replaces>
            <div className="absolute inset-x-[8%] top-[8%] flex h-[10%] items-center gap-[4%]">
                <ChevronLeft className="h-[52%] w-auto opacity-60" />
                <div className="flex h-full flex-1 items-center gap-[3%] rounded-full border px-[4%]" style={{ borderColor: outline }}>
                    <Search className="h-[42%] w-auto opacity-50" />
                    <Line width="54%" line={line} className="h-[12%]" />
                </div>
            </div>
            <div className="absolute inset-x-[14%] bottom-[9%] top-[23%] flex flex-col gap-[4%]">
                {[0, 1, 2, 3].map(index => (
                    <div key={index} className="flex flex-1 items-center gap-[4%] border-b" style={{ borderColor: outline }}>
                        <span className="aspect-square h-[72%] rounded-[14%]" style={{ backgroundColor: index === 0 ? accent : line, opacity: 0.5 }} />
                        <span className="flex flex-1 flex-col gap-[16%]">
                            <Line width={`${72 - index * 7}%`} line={line} className="h-1.5" />
                            <Line width={`${44 + index * 4}%`} line={line} className="h-1 opacity-55" />
                        </span>
                    </div>
                ))}
            </div>
        </PonderSurfaceStateLayer>

        <PonderSurfaceStateLayer state="command-open" registerStateNode={registerStateNode}>
            <div
                className="overflow-hidden rounded-[5%] border bg-zinc-950/95"
                style={{ ...relativeRectStyle(G.command), borderColor: outline }}
            >
                {/* 从控制条长出来的样子：结果在上，搜索行在底。 */}
                <div className="flex h-[78%] flex-col justify-evenly px-[6%]">
                    {[76, 58, 84].map(width => <Line key={width} width={`${width}%`} line={line} className="h-[7%]" />)}
                </div>
                <div className="flex h-[22%] items-center gap-[4%] border-t px-[5%]" style={{ borderColor: outline }}>
                    <Command className="h-[38%] w-auto opacity-55" />
                    <Line width="66%" line={line} className="h-[12%]" />
                </div>
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'grid-page': PonderGridPageSurface,
} satisfies PonderSurfaceDeclarations;
