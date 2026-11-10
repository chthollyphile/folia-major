import React from 'react';
import { ArrowUpRight, ChevronLeft, Command, Crosshair, Disc3, Focus, House, ListMusic, Pause, Settings2, Shuffle, Sparkles, Volume2 } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from '../PonderSurfaceStateLayer';
import { LATTICE_FOCUSED_POSTER, LATTICE_GEOMETRY as G, LATTICE_PAN, LATTICE_POSTERS } from './latticePage.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/player/latticePage.surface.tsx
// 位置一律来自 latticePage.geometry —— 这里和 latticePage.target.ts 的锚点是同一组数。

type PonderLatticePageSurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

const PosterWall: React.FC<{ accent: string; line: string; outline: string; focused?: boolean; panned?: boolean }> = ({
    accent,
    line,
    outline,
    focused,
    panned,
}) => (
    <div
        data-ponder-lattice-wall
        data-panned={panned || undefined}
        className="overflow-hidden"
        style={{
            ...relativeRectStyle(G.wall),
            // 百分比 translate 以自身尺寸为基准，所以位移和 LATTICE_PAN 的 wall 比例一致。
            ...(panned ? { transform: `translate(${LATTICE_PAN.x * 100}%, ${LATTICE_PAN.y * 100}%)` } : {}),
        }}
    >
        {LATTICE_POSTERS.map((poster, index) => {
            const isFocus = index === LATTICE_FOCUSED_POSTER;
            return (
                <span
                    key={index}
                    data-ponder-lattice-poster
                    data-focused={isFocus || undefined}
                    className="overflow-hidden rounded-[7%] border shadow-md"
                    style={{
                        ...relativeRectStyle(poster),
                        borderColor: focused && isFocus ? accent : outline,
                        backgroundColor: isFocus ? accent : line,
                        opacity: isFocus ? 0.68 : 0.48,
                        boxShadow: focused && isFocus ? `0 0 0 2px ${accent}` : undefined,
                    }}
                >
                    <span className="absolute left-[8%] top-[8%] text-[7px] opacity-50">{String(index + 1).padStart(2, '0')}</span>
                    <span className="absolute inset-x-[9%] bottom-[13%] h-[6%] rounded-full bg-current opacity-35" />
                </span>
            );
        })}
    </div>
);

const ExpandedPoster: React.FC<{ accent: string; line: string; outline: string }> = ({ accent, line, outline }) => (
    <div
        data-ponder-lattice-expanded
        className="overflow-hidden rounded-[4%] border shadow-2xl"
        style={{ ...relativeRectStyle(G.expanded), borderColor: accent, backgroundColor: 'rgba(24,24,27,0.98)' }}
    >
        <div className="absolute inset-0 opacity-35" style={{ background: `linear-gradient(135deg, ${accent}, transparent 62%)` }} />
        <div className="absolute inset-x-[8%] top-[12%] flex flex-col gap-2">
            <span className="h-2 w-[58%] rounded-full" style={{ backgroundColor: line }} />
            <span className="h-1.5 w-[34%] rounded-full opacity-60" style={{ backgroundColor: line }} />
        </div>
        <div
            data-ponder-lattice-chrome
            className="flex flex-col justify-center gap-[8%] rounded-2xl border px-[4%]"
            style={{ ...relativeRectStyle(G.chrome), borderColor: outline, backgroundColor: 'rgba(9,9,11,0.82)' }}
        >
            <div className="flex items-center gap-[5%]">
                <span className="flex aspect-square w-[10%] items-center justify-center rounded-full" style={{ backgroundColor: accent }}>
                    <Pause className="h-1/2 w-1/2" />
                </span>
                <span className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: line }} />
                <span className="text-[7px] opacity-50">01:24 / 03:48</span>
                <ArrowUpRight className="h-4 w-4 opacity-55" />
            </div>
            <div className="relative h-1 rounded-full" style={{ backgroundColor: line }}>
                <span className="absolute inset-y-0 left-0 w-[38%] rounded-full" style={{ backgroundColor: accent }} />
            </div>
        </div>
    </div>
);

const PonderLatticePageSurface: React.FC<PonderLatticePageSurfaceProps> = ({
    accent,
    line,
    outline,
    registerStateNode,
}) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-lattice-page-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <PosterWall accent={accent} line={line} outline={outline} />
            <span
                data-ponder-lattice-back
                className="flex items-center justify-center rounded-full border"
                style={{ ...relativeRectStyle(G.back), borderColor: outline }}
            >
                <ChevronLeft className="h-1/2 w-1/2 opacity-60" />
            </span>
            <span
                data-ponder-lattice-tools
                className="flex items-center justify-center rounded-full border"
                style={{ ...relativeRectStyle(G.tools), borderColor: outline, backgroundColor: line }}
            >
                <Settings2 className="h-1/2 w-1/2 opacity-60" />
                {/* 工具按钮上方的“定位正在播放的歌”，和歌单页右下角的是同一个按钮。位置跟着工具按钮走，不另设锚点。 */}
                <span
                    data-ponder-lattice-locate
                    className="absolute bottom-[125%] left-[8%] flex aspect-square w-[84%] items-center justify-center rounded-full border"
                    style={{ borderColor: outline, backgroundColor: line }}
                >
                    <Crosshair className="h-1/2 w-1/2 opacity-60" />
                </span>
            </span>
        </PonderSurfaceBase>

        {/* 平移和聚焦都是把整面墙重画一遍，必须替换基础层，否则两面墙会差着位移同时在屏幕上。 */}
        <PonderSurfaceStateLayer state="wall-panned" registerStateNode={registerStateNode} replaces>
            <PosterWall accent={accent} line={line} outline={outline} panned />
        </PonderSurfaceStateLayer>

        {/* 聚焦沿用同一个平移，两层只差一圈焦点描边，交叉淡入时不会出现两面错开的墙。 */}
        <PonderSurfaceStateLayer state="poster-focused" registerStateNode={registerStateNode} replaces>
            <PosterWall accent={accent} line={line} outline={outline} panned focused />
        </PonderSurfaceStateLayer>

        {/* 展开的海报是压在墙上的一张卡，底下那面墙要透出来，所以不替换。 */}
        <PonderSurfaceStateLayer state="poster-expanded" registerStateNode={registerStateNode} className="bg-zinc-950/55">
            <ExpandedPoster accent={accent} line={line} outline={outline} />
        </PonderSurfaceStateLayer>

        <PonderSurfaceStateLayer state="tools-open" registerStateNode={registerStateNode}>
            <div
                data-ponder-lattice-tools-panel
                className="flex flex-col gap-[3%] rounded-[7%] border bg-zinc-950/95 p-[4%]"
                style={{ ...relativeRectStyle(G.toolsPanel), borderColor: outline }}
            >
                {/* 与资料库墙同一套：一排纯图标（聚焦、洗牌、主题、队列、主页、播放页）、音量、切歌自动聚焦。 */}
                <div className="grid min-h-0 flex-1 grid-cols-6 gap-[3%]">
                    {[Crosshair, Shuffle, Sparkles, ListMusic, House, Disc3].map((Icon, index) => (
                        <span key={index} className="flex items-center justify-center rounded-[6px]" style={{ backgroundColor: line }}>
                            <Icon className="h-3 w-3 opacity-60" />
                        </span>
                    ))}
                </div>
                <div className="flex min-h-0 flex-1 items-center gap-[5%] border-b" style={{ borderColor: outline }}>
                    <Volume2 className="h-4 w-4 opacity-55" />
                    <span className="relative h-1 flex-1 rounded-full" style={{ backgroundColor: line }}>
                        <span className="absolute inset-y-0 left-0 w-[60%] rounded-full" style={{ backgroundColor: accent, opacity: 0.7 }} />
                    </span>
                </div>
                <div className="flex min-h-0 flex-1 items-center gap-[5%] border-b" style={{ borderColor: outline }}>
                    <Focus className="h-4 w-4 opacity-55" />
                    <span className="h-1.5 rounded-full" style={{ width: '62%', backgroundColor: line }} />
                    <span className="ml-auto h-3 w-6 rounded-full" style={{ backgroundColor: accent, opacity: 0.6 }} />
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-between rounded-full border px-[5%]" style={{ borderColor: outline }}>
                    <span className="text-[8px] opacity-50">ON</span>
                    <span className="text-[8px] opacity-35">OFF</span>
                </div>
            </div>
        </PonderSurfaceStateLayer>

        {/* 关灯也是整面墙换一次配色，同样替换。 */}
        <PonderSurfaceStateLayer state="lights-off" registerStateNode={registerStateNode} replaces>
            <div className="absolute inset-0 bg-black/70" />
            <PosterWall accent={accent} line="rgba(255,255,255,0.035)" outline="rgba(255,255,255,0.08)" />
        </PonderSurfaceStateLayer>

        <PonderSurfaceStateLayer state="command-open" registerStateNode={registerStateNode}>
            <div className="rounded-[5%] border bg-zinc-950/95 p-[5%]" style={{ ...relativeRectStyle(G.command), borderColor: outline }}>
                {/* 从控制条长出来的样子：结果在上，搜索行在底。 */}
                <div className="flex h-[82%] flex-col justify-evenly">
                    {[70, 86, 58, 76].map(width => <span key={width} className="h-2 rounded-full" style={{ width: `${width}%`, backgroundColor: line }} />)}
                </div>
                <div className="flex h-[18%] items-center gap-[4%] border-t" style={{ borderColor: outline }}>
                    <Command className="h-[48%] w-auto opacity-55" />
                    <span className="h-2 w-[68%] rounded-full" style={{ backgroundColor: line }} />
                </div>
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'lattice-page': PonderLatticePageSurface,
} satisfies PonderSurfaceDeclarations;
