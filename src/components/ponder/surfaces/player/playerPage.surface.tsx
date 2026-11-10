import React from 'react';
import { ChevronsRight, Command, Pause, Search, Shuffle } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from '../PonderSurfaceStateLayer';
import { PLAYER_PAGE_GEOMETRY as G } from './playerPage.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/player/playerPage.surface.tsx
// 播放页整屏：歌词铺在中间，控制条浮在底部，侧边手柄贴右缘且和控制条底边对齐。
//
// 画成整屏而不是一张居中的卡片，是因为这一章要讲的就是「什么东西在哪」——
// 手柄贴的是屏幕右缘、不是某张卡片的右缘，摆成卡片就把这件事讲错了。
//
// 命令窗口、执行模式、展开的控制面板都是结果层：一进场就摆在屏幕上的话，
// 字幕说「按 S 打开命令窗口」就成了旁白。

type PonderPlayerPageSurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

const LYRIC_WIDTHS = [72, 96, 58, 84, 44];

/**
 * 命令窗口的外壳：几条结果加一条搜索行。两个结果层都套它，窗口本身才不会长出两个样子。
 * 它是从控制条长出来的，所以搜索行在底、落在控制条的位置上。
 */
const PaletteFrame: React.FC<{
    line: string;
    outline: string;
    children: React.ReactNode;
}> = ({ line, outline, children }) => (
    <div
        data-ponder-player-palette
        className="flex flex-col overflow-hidden rounded-[4%] border bg-zinc-950/95 p-[3%]"
        style={{ ...relativeRectStyle(G.palette), borderColor: outline }}
    >
        {children}
        <div className="flex h-[16%] shrink-0 items-center gap-[3%] border-t" style={{ borderColor: outline }}>
            <Search className="h-[42%] w-auto opacity-50" />
            <span className="h-1.5 w-[46%] rounded-full" style={{ backgroundColor: line }} />
        </div>
    </div>
);

const PonderPlayerPageSurface: React.FC<PonderPlayerPageSurfaceProps> = ({
    accent,
    line,
    outline,
    registerStateNode,
}) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-player-page-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <div data-ponder-player-lyrics className="flex flex-col justify-center gap-[7%]" style={relativeRectStyle(G.lyrics)}>
                {LYRIC_WIDTHS.map((width, index) => (
                    <span
                        key={width}
                        className="h-2 rounded-full"
                        style={{
                            width: `${width}%`,
                            backgroundColor: index === 2 ? accent : line,
                            opacity: index === 2 ? 0.75 : 0.5,
                        }}
                    />
                ))}
            </div>

            {/* 手柄背后那条滑轨常态是看不见的，画成虚线：它在那里，只是还没显出来。 */}
            <div
                data-ponder-player-track
                className="rounded-full border border-dashed"
                style={{ ...relativeRectStyle(G.track), borderColor: outline }}
            />
            <span
                data-ponder-player-toggle
                className="flex items-center justify-center rounded-full border"
                style={{ ...relativeRectStyle(G.toggle), borderColor: outline, backgroundColor: line }}
            >
                <ChevronsRight className="h-1/2 w-1/2 opacity-60" />
            </span>

            <div
                data-ponder-player-bar
                className="flex items-center gap-[3%] rounded-full border px-[3%]"
                style={{ ...relativeRectStyle(G.bar), borderColor: outline, backgroundColor: 'rgba(255,255,255,0.04)' }}
            >
                <span className="flex aspect-square h-[52%] items-center justify-center rounded-full" style={{ backgroundColor: accent }}>
                    <Pause className="h-1/2 w-1/2" style={{ color: 'rgba(9,9,11,0.85)' }} />
                </span>
                <span className="flex flex-1 flex-col gap-1.5">
                    <span className="h-1.5 w-[34%] self-center rounded-full" style={{ backgroundColor: line }} />
                    <span className="relative h-1.5 rounded-full" style={{ backgroundColor: line }}>
                        <span className="absolute inset-y-0 left-0 w-[42%] rounded-full" style={{ backgroundColor: accent }} />
                    </span>
                </span>
                <span className="aspect-square h-[40%] rounded-full border" style={{ borderColor: outline }} />
                <span className="aspect-square h-[40%] rounded-full border" style={{ borderColor: outline }} />
            </div>
        </PonderSurfaceBase>

        {/* 按 S、滑手柄、点控制条空白处或触屏点右缘，几条路开的是同一个窗口。
            结果倒着排：第一名（亮着的那条）贴着底部的搜索行。 */}
        <PonderSurfaceStateLayer state="palette-open" registerStateNode={registerStateNode} className="bg-zinc-950/55">
            <PaletteFrame line={line} outline={outline}>
                <div className="flex flex-1 flex-col justify-evenly pb-[3%]">
                    {[2, 1, 0].map(index => (
                        <div
                            key={index}
                            data-ponder-player-palette-row
                            className="flex h-[22%] items-center gap-[3%] rounded-lg px-[2%]"
                            style={{ backgroundColor: index === 0 ? line : undefined }}
                        >
                            <span className="flex aspect-square h-[62%] items-center justify-center rounded-md border" style={{ borderColor: outline }}>
                                <Command className="h-1/2 w-1/2 opacity-55" />
                            </span>
                            <span className="flex flex-1 flex-col gap-1">
                                <span className="h-1.5 rounded-full" style={{ width: `${82 - index * 12}%`, backgroundColor: line }} />
                                <span className="h-1 rounded-full opacity-60" style={{ width: `${54 - index * 8}%`, backgroundColor: line }} />
                            </span>
                        </div>
                    ))}
                </div>
            </PaletteFrame>
        </PonderSurfaceStateLayer>

        {/* 按 Esc 关掉命令窗口：一块空层顶掉 palette-open。结果层只能淡入、不能退回 base，
            要让窗口「关上」只能用替换。执行模式必须从这一屏进入 —— 窗口开着时按冒号只会打进输入框。 */}
        <PonderSurfaceStateLayer state="palette-closed" registerStateNode={registerStateNode} replaces="palette-open">
            {null}
        </PonderSurfaceStateLayer>

        {/* 执行模式：输入行变成一个冒号提示，下面列的是「一个键一条命令」。 */}
        <PonderSurfaceStateLayer state="execute-mode" registerStateNode={registerStateNode} replaces="palette-open" className="bg-zinc-950/55">
            <PaletteFrame line={line} outline={outline}>
                <div data-ponder-player-execute-mode className="flex flex-1 flex-col justify-evenly pb-[3%]">
                    {['r', 'v', 'o'].map((key, index) => (
                        <div key={key} className="flex h-[22%] items-center gap-[3%] px-[2%]">
                            <span
                                data-ponder-player-execute-key
                                className="flex aspect-square h-[70%] items-center justify-center rounded-md border font-mono text-[9px]"
                                style={{ borderColor: index === 0 ? accent : outline, color: index === 0 ? accent : undefined }}
                            >
                                {key}
                            </span>
                            {index === 0 ? <Shuffle className="h-3 w-3" style={{ color: accent }} /> : null}
                            <span className="h-1.5 rounded-full" style={{ width: `${58 - index * 10}%`, backgroundColor: line }} />
                        </div>
                    ))}
                </div>
            </PaletteFrame>
        </PonderSurfaceStateLayer>

        {/* 右侧面板展开：手柄退场，面板从它上方长出来。打开时是封面页：大封面、歌名歌手专辑、一行动作，最底下一排标签。 */}
        <PonderSurfaceStateLayer state="panel-open" registerStateNode={registerStateNode}>
            <div
                data-ponder-player-panel
                className="flex flex-col gap-[3%] overflow-hidden rounded-[8%] border bg-[var(--st-win)] p-[5%]"
                style={{ ...relativeRectStyle(G.panel), borderColor: outline }}
            >
                <span className="aspect-square w-full shrink-0 rounded-[7%]" style={{ backgroundColor: accent, opacity: 0.4 }} />
                <div className="flex shrink-0 flex-col gap-1.5 px-[2%]">
                    <span className="h-1.5 w-[52%] rounded-full" style={{ backgroundColor: line }} />
                    <span className="h-1 w-[34%] rounded-full" style={{ backgroundColor: accent, opacity: 0.55 }} />
                </div>
                <div className="flex shrink-0 items-center gap-[3%]">
                    <span className="aspect-square w-[10%] rounded-md" style={{ backgroundColor: line }} />
                    <span className="aspect-square w-[10%] rounded-md" style={{ backgroundColor: line }} />
                    <span className="flex-1" />
                    <span className="aspect-square w-[8%] rounded-full opacity-60" style={{ backgroundColor: line }} />
                    <span className="aspect-square w-[8%] rounded-full opacity-60" style={{ backgroundColor: line }} />
                </div>
                <span className="min-h-0 flex-1" />
                <div className="flex h-[8%] shrink-0 items-stretch gap-[2%] rounded-xl p-[1.5%]" style={{ backgroundColor: line }}>
                    {[0, 1, 2, 3, 4].map(index => (
                        <span
                            key={index}
                            className="flex-1 rounded-lg"
                            style={{ backgroundColor: index === 0 ? accent : 'transparent', opacity: index === 0 ? 0.55 : 1 }}
                        />
                    ))}
                </div>
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'player-page': PonderPlayerPageSurface,
} satisfies PonderSurfaceDeclarations;
