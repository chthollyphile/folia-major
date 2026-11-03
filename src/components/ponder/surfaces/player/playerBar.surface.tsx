import React from 'react';
import { ChevronLeft, ChevronRight, Pause, Shuffle, Volume2, type LucideIcon } from 'lucide-react';
import { PLAYER_CONTROL_SLOT_OPTIONS } from '../../../floating-player/playerControlSlotActions';
import { usePlayerChromeSettingsStore } from '../../../../stores/usePlayerChromeSettingsStore';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from '../PonderSurfaceStateLayer';
import { PLAYER_BAR_GEOMETRY as G } from './playerBar.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/player/playerBar.surface.tsx
// 一条完整尺寸的底部控制条。
//
// 刻意不量真实 DOM：真实那条平时收成一根进度条，指针靠近才展开，还会被整体缩放 ——
// 进教程的瞬间量到的多半是收起来的形态，教程于是在讲一个屏幕上不存在的东西。
// 几何固定在 playerBar.geometry，锚点和这里画的是同一组数。
//
// 标题区和两个槽位各自是一层，替换它们的那几层也一并嵌在基础层里：讲切歌或讲某个槽位动作时
// 只换那一层，胶囊其余部分不动；而「收起来的样子」替换整个基础层，嵌在里面的全部一起带走 ——
// 放在基础层外面的话，胶囊收起来了，浮出的箭头还留在屏幕上。
//
// 胶囊周围那几样（上方浮出的快捷操作、从胶囊长出来的命令窗口、换按钮的浮层）在 capsule.surface。

/** 可被单独替换的两层。 */
export const PLAYER_BAR_TITLE_STATE = 'title';
export const PLAYER_BAR_SLOTS_STATE = 'slots';

type PonderPlayerBarSurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

const iconOf = (actionId: string): LucideIcon => (
    PLAYER_CONTROL_SLOT_OPTIONS.find(option => option.id === actionId)?.icon
    ?? PLAYER_CONTROL_SLOT_OPTIONS[0].icon
);

const SlotButton: React.FC<{
    Icon: LucideIcon;
    rect: typeof G.primarySlot;
    outline: string;
    accent: string;
    active?: boolean;
    /** 正被按住：按钮缩一点，外圈画到一大半 —— 画满的那一刻浮层就会弹出来。 */
    holding?: boolean;
    slot: 'primary' | 'secondary';
}> = ({ Icon, rect, outline, accent, active, holding, slot }) => (
    <span
        data-ponder-bar-slot={slot}
        className="flex items-center justify-center rounded-full border"
        style={{
            ...relativeRectStyle(rect),
            borderColor: active || holding ? accent : outline,
            color: active || holding ? accent : undefined,
        }}
    >
        <Icon className="h-1/2 w-1/2 opacity-70" style={holding ? { transform: 'scale(0.88)' } : undefined} />
        {holding ? (
            <svg data-ponder-bar-slot-hold viewBox="0 0 36 36" className="pointer-events-none absolute -inset-[18%] -rotate-90">
                <circle cx="18" cy="18" r="16.5" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" pathLength={1} strokeDasharray="0.72 1" />
            </svg>
        ) : null}
    </span>
);

const SlotPair: React.FC<{
    outline: string;
    accent: string;
    primary: LucideIcon;
    secondary: LucideIcon;
    activePrimary?: boolean;
    holdingPrimary?: boolean;
}> = ({ outline, accent, primary, secondary, activePrimary, holdingPrimary }) => (
    <>
        <SlotButton slot="primary" Icon={primary} rect={G.primarySlot} outline={outline} accent={accent} active={activePrimary} holding={holdingPrimary} />
        <SlotButton slot="secondary" Icon={secondary} rect={G.secondarySlot} outline={outline} accent={accent} />
    </>
);

const PonderPlayerBarSurface: React.FC<PonderPlayerBarSurfaceProps> = ({
    accent,
    line,
    outline,
    registerStateNode,
}) => {
    // 画用户自己那两个按钮，而不是一组示意图标 —— 这里讲的就是「右边放什么由你定」。
    const primaryId = usePlayerChromeSettingsStore(state => state.playerControlSlotPrimary);
    const secondaryId = usePlayerChromeSettingsStore(state => state.playerControlSlotSecondary);
    const PrimaryIcon = iconOf(primaryId);
    const SecondaryIcon = iconOf(secondaryId);

    return (
        <div className="absolute inset-0 overflow-hidden" data-ponder-player-bar-structure>
            <PonderSurfaceBase registerStateNode={registerStateNode}>
                <span
                    data-ponder-bar-play
                    className="flex items-center justify-center rounded-full"
                    style={{ ...relativeRectStyle(G.play), backgroundColor: accent }}
                >
                    <Pause className="h-1/2 w-1/2" style={{ color: 'rgba(9,9,11,0.85)' }} />
                </span>

                <PonderSurfaceStateLayer state={PLAYER_BAR_TITLE_STATE} registerStateNode={registerStateNode} visible>
                    <div data-ponder-bar-title className="flex items-center justify-center" style={relativeRectStyle(G.title)}>
                        <span className="h-1.5 w-[38%] rounded-full" style={{ backgroundColor: line }} />
                    </div>
                </PonderSurfaceStateLayer>

                <div data-ponder-bar-progress className="flex flex-col justify-center gap-1.5" style={relativeRectStyle(G.progress)}>
                    <div className="relative h-1.5 rounded-full" style={{ backgroundColor: line }}>
                        <span className="absolute inset-y-0 left-0 w-[42%] rounded-full" style={{ backgroundColor: accent }} />
                        <span className="absolute left-[42%] top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ backgroundColor: accent }} />
                    </div>
                    {/* 两端的时间。高度写死：父级是 auto 高的 flex 行，百分比高度会塌成 0。 */}
                    <div className="flex items-center justify-between">
                        <span className="h-1 w-8 rounded-full opacity-70" style={{ backgroundColor: line }} />
                        <span className="h-1 w-8 rounded-full opacity-70" style={{ backgroundColor: line }} />
                    </div>
                </div>

                <PonderSurfaceStateLayer state={PLAYER_BAR_SLOTS_STATE} registerStateNode={registerStateNode} visible>
                    <SlotPair outline={outline} accent={accent} primary={PrimaryIcon} secondary={SecondaryIcon} />
                </PonderSurfaceStateLayer>

                {/* 指针移到歌名上的样子：两侧浮出箭头，并半透明预览相邻曲目的名字。 */}
                <PonderSurfaceStateLayer state="title-hovered" registerStateNode={registerStateNode} replaces={PLAYER_BAR_TITLE_STATE}>
                    <div
                        data-ponder-bar-title-nav
                        className="flex items-center justify-between gap-[2%] px-[1%]"
                        style={relativeRectStyle(G.title)}
                    >
                        <span className="flex shrink-0 items-center gap-1.5" style={{ color: accent }}>
                            <ChevronLeft className="h-5 w-5" />
                            <span className="h-1.5 w-14 rounded-full opacity-50" style={{ backgroundColor: line }} />
                        </span>
                        <span className="h-1.5 w-[26%] rounded-full opacity-40" style={{ backgroundColor: line }} />
                        <span className="flex shrink-0 items-center gap-1.5" style={{ color: accent }}>
                            <span className="h-1.5 w-14 rounded-full opacity-50" style={{ backgroundColor: line }} />
                            <ChevronRight className="h-5 w-5" />
                        </span>
                    </div>
                </PonderSurfaceStateLayer>

                {/* 随机和音量两章不看槽位里此刻放的是什么，直接换成要讲的那个按钮。 */}
                <PonderSurfaceStateLayer state="slots-shuffle" registerStateNode={registerStateNode} replaces={PLAYER_BAR_SLOTS_STATE}>
                    <SlotPair outline={outline} accent={accent} primary={Shuffle} secondary={SecondaryIcon} activePrimary />
                </PonderSurfaceStateLayer>

                <PonderSurfaceStateLayer state="slots-volume" registerStateNode={registerStateNode} replaces={PLAYER_BAR_SLOTS_STATE}>
                    <SlotPair outline={outline} accent={accent} primary={Volume2} secondary={SecondaryIcon} activePrimary />
                </PonderSurfaceStateLayer>

                {/* 按住第一个槽位：外圈正在画，画满就弹出换按钮的浮层。 */}
                <PonderSurfaceStateLayer state="slots-holding" registerStateNode={registerStateNode} replaces={PLAYER_BAR_SLOTS_STATE}>
                    <SlotPair outline={outline} accent={accent} primary={PrimaryIcon} secondary={SecondaryIcon} holdingPrimary />
                </PonderSurfaceStateLayer>
            </PonderSurfaceBase>

            {/* 移开指针它收回去的样子：胶囊自己也缩窄一圈，里面只剩一根进度条。 */}
            <PonderSurfaceStateLayer state="collapsed" registerStateNode={registerStateNode} replaces>
                <div
                    data-ponder-bar-collapsed
                    className="absolute inset-x-[16%] top-1/2 flex h-[54%] -translate-y-1/2 items-center rounded-full border px-[3%]"
                    style={{ borderColor: outline }}
                >
                    <div className="relative h-1.5 w-full rounded-full" style={{ backgroundColor: line }}>
                        <span className="absolute inset-y-0 left-0 w-[42%] rounded-full" style={{ backgroundColor: accent }} />
                    </div>
                </div>
            </PonderSurfaceStateLayer>
        </div>
    );
};

export default {
    'player-bar': PonderPlayerBarSurface,
} satisfies PonderSurfaceDeclarations;
