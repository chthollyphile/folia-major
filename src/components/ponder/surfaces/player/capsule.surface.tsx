import React from 'react';
import { Captions, Command, Heart, LayoutGrid, Search, Settings2, Shuffle, Star, Volume2, type LucideIcon } from 'lucide-react';
import { PLAYER_CONTROL_SLOT_OPTIONS, type PlayerControlSlotActionId } from '../../../floating-player/playerControlSlotActions';
import { usePlayerChromeSettingsStore } from '../../../../stores/usePlayerChromeSettingsStore';
import { CAPSULE_QUICK_ACTIONS_GEOMETRY as Q } from './playerBar.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations, PonderSurfaceProps } from '../surfaceDeclarations';

// src/components/ponder/surfaces/player/capsule.surface.tsx
// 底部胶囊周围那几样，各自一块合成面板，由教程按需放出来：指针停一下浮在胶囊上方的快捷操作、
// 从胶囊原地长出来的命令窗口、在槽位正上方弹出的换按钮浮层。胶囊本身在 playerBar.surface。

/**
 * 浮在胶囊上方的那一排：和当前歌曲有关的六个操作，顺序和真实那排一样。
 * 能放进槽位的三样带着槽位动作 id —— 已经在用户槽位里的，真实那排不会重复，这里也不画。
 */
const QUICK_ACTIONS: readonly { Icon: LucideIcon; slotAction?: PlayerControlSlotActionId; }[] = [
    { Icon: Volume2, slotAction: 'volume' },
    { Icon: Heart, slotAction: 'like' },
    { Icon: Star },
    { Icon: Shuffle, slotAction: 'shuffle' },
    { Icon: Captions },
    { Icon: LayoutGrid },
];

const PonderCapsuleQuickActionsSurface: React.FC<PonderSurfaceProps> = ({ accent, outline }) => {
    const primaryId = usePlayerChromeSettingsStore(state => state.playerControlSlotPrimary);
    const secondaryId = usePlayerChromeSettingsStore(state => state.playerControlSlotSecondary);
    const actions = QUICK_ACTIONS.filter(action => action.slotAction !== primaryId && action.slotAction !== secondaryId);
    return (
        <div className="absolute inset-0" data-ponder-capsule-quick-actions>
            {/* 按宽度等分，而不是按高度画方块：舞台的宽高比一变，六个方块就会挤出这块区域，压到分隔线和命令窗口那颗上。 */}
            <div className="flex items-center" style={relativeRectStyle(Q.actions)}>
                {actions.map(({ Icon }, index) => (
                    <span key={index} data-ponder-quick-action className="flex h-full min-w-0 flex-1 items-center justify-center">
                        <Icon className="h-[52%] max-h-full w-auto max-w-[70%] opacity-70" />
                    </span>
                ))}
            </div>
            <span style={{ ...relativeRectStyle(Q.divider), backgroundColor: outline }} />
            <span
                data-ponder-quick-palette
                className="flex items-center justify-center rounded-full"
                style={{ ...relativeRectStyle(Q.paletteButton), color: accent }}
            >
                <Command className="h-[52%] w-[52%]" />
            </span>
        </div>
    );
};

/**
 * 从胶囊长出来的命令窗口：结果列在上面，第一名贴着底部的输入行。
 * 底色是实的，和播放页那张命令窗口一样：它盖住的胶囊和上方那排在真实界面里都已经让开了。
 */
const PonderCapsulePaletteSurface: React.FC<PonderSurfaceProps> = ({ line, outline }) => (
    <div className="absolute inset-0 flex flex-col bg-zinc-950/95" data-ponder-capsule-palette>
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-[3%] px-[4%] py-[3%]">
            {[64, 76, 88].map((width, index) => (
                <div
                    key={width}
                    data-ponder-capsule-palette-row
                    className="flex h-[24%] min-h-0 items-center gap-[3%] rounded-lg px-[2%]"
                    style={{ backgroundColor: index === 2 ? line : undefined }}
                >
                    <span className="flex aspect-square h-[64%] items-center justify-center rounded-md border" style={{ borderColor: outline }}>
                        <Command className="h-1/2 w-1/2 opacity-55" />
                    </span>
                    <span className="flex flex-1 flex-col gap-1">
                        <span className="h-1.5 rounded-full" style={{ width: `${width}%`, backgroundColor: line }} />
                        <span className="h-1 rounded-full opacity-70" style={{ width: `${Math.max(40, width - 26)}%`, backgroundColor: line }} />
                    </span>
                </div>
            ))}
        </div>
        <div data-ponder-capsule-palette-input className="flex h-[18%] shrink-0 items-center gap-2 border-t px-[4%]" style={{ borderColor: outline }}>
            <Search className="h-[34%] w-auto opacity-50" />
            <div className="h-[22%] flex-1 rounded-full" style={{ backgroundColor: line }} />
        </div>
    </div>
);

/** 在槽位正上方弹出的换按钮浮层：一格一个动作，当前那个亮着，底下一行通往设置。 */
const PonderSlotPickerSurface: React.FC<PonderSurfaceProps> = ({ accent, line, outline }) => {
    const primaryId = usePlayerChromeSettingsStore(state => state.playerControlSlotPrimary);
    return (
        <div className="absolute inset-0 flex flex-col p-[5%]" data-ponder-slot-picker>
            <span className="mb-[4%] h-1 w-[28%] rounded-full opacity-60" style={{ backgroundColor: line }} />
            <div className="grid min-h-0 flex-1 grid-cols-4 gap-[3%]">
                {PLAYER_CONTROL_SLOT_OPTIONS.map(option => {
                    const Icon = option.icon;
                    const isCurrent = option.id === primaryId;
                    return (
                        <span
                            key={option.id}
                            data-ponder-slot-picker-option
                            className="flex min-h-0 flex-col items-center justify-center gap-[10%] rounded-xl"
                            style={{ backgroundColor: isCurrent ? line : undefined, color: isCurrent ? accent : undefined }}
                        >
                            <Icon className="h-[34%] w-auto opacity-75" />
                            <span className="h-0.5 w-[56%] rounded-full opacity-60" style={{ backgroundColor: line }} />
                        </span>
                    );
                })}
            </div>
            <div className="mt-[4%] flex items-center gap-2 border-t pt-[4%]" style={{ borderColor: outline }}>
                <Settings2 className="h-3 w-3 opacity-50" />
                <span className="h-1 w-[34%] rounded-full opacity-60" style={{ backgroundColor: line }} />
            </div>
        </div>
    );
};

export default {
    'capsule-quick-actions': PonderCapsuleQuickActionsSurface,
    'capsule-palette': PonderCapsulePaletteSurface,
    'slot-picker': PonderSlotPickerSurface,
} satisfies PonderSurfaceDeclarations;
