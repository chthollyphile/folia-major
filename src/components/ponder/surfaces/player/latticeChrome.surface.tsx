import React from 'react';
import { ArrowUpRight, Pause, Repeat, ChartBar, SkipBack, SkipForward } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from '../PonderSurfaceStateLayer';
import { LATTICE_CHROME_GEOMETRY as G } from './latticeChrome.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderRelativeRect } from '../../../../types/ponder';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/player/latticeChrome.surface.tsx
// Lattice 里展开的那张海报，重点是它底部那条播放控制。
//
// 四个额外按钮里两端固定是上一首/下一首，中间两个是底栏那两个可配置槽位的同一份 ——
// 它们共用 handler、图标和可用性判断，所以这里也画成和底栏一样的两个图标，
// 而不是随便摆两个示意按钮：这一章讲的就是「这两处是同一个东西」。
//
// 卡片之外还画了一条底栏：当前歌曲的海报滚出视口时它会自己出现，那是一个结果层。

type PonderLatticeChromeSurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

const RoundButton: React.FC<{
    rect: PonderRelativeRect;
    outline: string;
    accent: string;
    marker?: string;
    active?: boolean;
    children: React.ReactNode;
}> = ({ rect, outline, accent, marker, active, children }) => (
    <span
        {...(marker ? { [marker]: true } : {})}
        className="flex items-center justify-center rounded-full border"
        style={{
            ...relativeRectStyle(rect),
            borderColor: active ? accent : outline,
            color: active ? accent : undefined,
        }}
    >
        {children}
    </span>
);

const PonderLatticeChromeSurface: React.FC<PonderLatticeChromeSurfaceProps> = ({
    accent,
    line,
    outline,
    registerStateNode,
}) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-lattice-chrome-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <div
                data-ponder-chrome-card
                className="overflow-hidden rounded-[3%] border shadow-2xl"
                style={{ ...relativeRectStyle(G.card), borderColor: accent, backgroundColor: 'rgba(24,24,27,0.96)' }}
            >
                <div className="absolute inset-0 opacity-30" style={{ background: `linear-gradient(135deg, ${accent}, transparent 58%)` }} />
                <div className="absolute inset-x-[6%] top-[8%] flex flex-col gap-2">
                    <span className="h-2 w-[54%] rounded-full" style={{ backgroundColor: line }} />
                    <span className="h-1.5 w-[32%] rounded-full opacity-55" style={{ backgroundColor: line }} />
                </div>

                <div
                    data-ponder-chrome-bar
                    className="rounded-2xl border"
                    style={{ ...relativeRectStyle(G.chrome), borderColor: outline, backgroundColor: 'rgba(9,9,11,0.85)' }}
                >
                    <span
                        data-ponder-chrome-play
                        className="flex items-center justify-center rounded-full"
                        style={{ ...relativeRectStyle(G.play), backgroundColor: accent }}
                    >
                        <Pause className="h-1/2 w-1/2" style={{ color: 'rgba(9,9,11,0.85)' }} />
                    </span>

                    <RoundButton rect={G.prev} outline={outline} accent={accent} marker="data-ponder-chrome-prev">
                        <SkipBack className="h-1/2 w-1/2 opacity-70" />
                    </RoundButton>
                    {/* 这两个就是底栏那两个槽位。画的是它们当前放着的动作，不是示意图标。 */}
                    <RoundButton rect={G.slotPrimary} outline={outline} accent={accent} marker="data-ponder-chrome-slot-primary">
                        <Repeat className="h-1/2 w-1/2 opacity-70" />
                    </RoundButton>
                    <RoundButton rect={G.slotSecondary} outline={outline} accent={accent} marker="data-ponder-chrome-slot-secondary">
                        <ChartBar className="h-1/2 w-1/2 opacity-70" />
                    </RoundButton>
                    <RoundButton rect={G.next} outline={outline} accent={accent} marker="data-ponder-chrome-next">
                        <SkipForward className="h-1/2 w-1/2 opacity-70" />
                    </RoundButton>

                    <span data-ponder-chrome-time className="flex items-center justify-center text-[8px] opacity-55" style={relativeRectStyle(G.time)}>
                        01:24 / 03:48
                    </span>
                    <RoundButton rect={G.openPlayer} outline={outline} accent={accent} marker="data-ponder-chrome-open-player">
                        <ArrowUpRight className="h-1/2 w-1/2 opacity-70" />
                    </RoundButton>

                    <div data-ponder-chrome-progress className="rounded-full" style={{ ...relativeRectStyle(G.progress), backgroundColor: line }}>
                        <span className="absolute inset-y-0 left-0 w-[38%] rounded-full" style={{ backgroundColor: accent }} />
                    </div>
                </div>
            </div>
        </PonderSurfaceBase>

        {/* 底栏那两个槽位换了，卡片里中间两个跟着换 —— 同一份配置，两处显示。
            按钮的坐标是 chrome 内的比例，所以这里要把 card → chrome 两层容器补回来，
            否则它会按整个页面去算，落到卡片外面。 */}
        <PonderSurfaceStateLayer state="slots-swapped" registerStateNode={registerStateNode}>
            <div style={relativeRectStyle(G.card)}>
                <div style={relativeRectStyle(G.chrome)}>
                    <RoundButton rect={G.slotPrimary} outline={outline} accent={accent} active marker="data-ponder-chrome-slot-primary-swapped">
                        <SkipBack className="h-1/2 w-1/2" />
                    </RoundButton>
                </div>
            </div>
        </PonderSurfaceStateLayer>

        {/* 当前歌曲的海报滚出视口，底栏自己出现。替换基础层 —— 这时那张卡确实已经不在屏幕上了，
            留着它和底栏同框，正好把这一章要讲的因果讲反。 */}
        <PonderSurfaceStateLayer state="bottom-bar-shown" registerStateNode={registerStateNode} replaces>
            <div
                data-ponder-chrome-bottom-bar
                className="flex items-center gap-[3%] rounded-full border px-[3%]"
                style={{ ...relativeRectStyle(G.bottomBar), borderColor: outline, backgroundColor: 'rgba(9,9,11,0.92)' }}
            >
                <span className="flex aspect-square h-[54%] items-center justify-center rounded-full" style={{ backgroundColor: accent }}>
                    <Pause className="h-1/2 w-1/2" style={{ color: 'rgba(9,9,11,0.85)' }} />
                </span>
                <span className="relative h-1.5 flex-1 rounded-full" style={{ backgroundColor: line }}>
                    <span className="absolute inset-y-0 left-0 w-[38%] rounded-full" style={{ backgroundColor: accent }} />
                </span>
                <span className="aspect-square h-[40%] rounded-full border" style={{ borderColor: outline }} />
                <span className="aspect-square h-[40%] rounded-full border" style={{ borderColor: outline }} />
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'lattice-chrome': PonderLatticeChromeSurface,
} satisfies PonderSurfaceDeclarations;
