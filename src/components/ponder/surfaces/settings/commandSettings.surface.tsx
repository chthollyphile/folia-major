import React from 'react';
import { ChevronDown, Command, Search, X } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase } from '../PonderSurfaceStateLayer';
import { SettingsHeading as Heading, type PonderSettingsSurfaceProps as SurfaceProps } from './ponderSettingsParts';
import type { PonderRelativeRect } from '../../../../types/ponder';
import { CUSTOM_SHORTCUT_GEOMETRY as S, PINNED_COMMANDS_GEOMETRY as P } from './commandSettings.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/settings/commandSettings.surface.tsx
// 两组「配的是命令窗口」的设置：自定义快捷键，和固定命令。
//
// 放一个文件是因为它们配的是同一样东西 —— 一条运行某个命令的按键，和窗口下面那一排
// 常驻的三颗。两组都以下拉框为主体，和 PonderPlaybackSettingsSurfaces 那种「一卡几行开关」
// 不是同一种形状，所以没并进去。

/** 一个命令下拉：左边一行占位文字，右端一枚折角。 */
const CommandSelect: React.FC<{
    rect: PonderRelativeRect;
    line: string;
    outline: string;
    accent?: string;
    marker: string;
}> = ({ rect, line, outline, accent, marker }) => (
    <span
        {...{ [marker]: true }}
        className="flex items-center gap-[5%] rounded-lg border px-[5%]"
        style={{ ...relativeRectStyle(rect), borderColor: accent ?? outline }}
    >
        <Command className="h-3 w-3 shrink-0 opacity-55" style={accent ? { color: accent } : undefined} />
        <span className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: accent ?? line, opacity: accent ? 0.8 : 1 }} />
        <ChevronDown className="h-3 w-3 shrink-0 opacity-45" />
    </span>
);

/** 卡片顶上那两行：一行标题、一行说明。 */
const CardCopy: React.FC<{ rect: PonderRelativeRect; line: string }> = ({ rect, line }) => (
    <div className="flex flex-col justify-center gap-[18%]" style={relativeRectStyle(rect)}>
        <span className="h-1.5 w-[34%] rounded-full" style={{ backgroundColor: line }} />
        <span className="h-1 w-[66%] rounded-full opacity-45" style={{ backgroundColor: line }} />
    </div>
);

/** 一枚键帽。`pressed` 画成已经按下去的那种，给不可改的 Alt 用。 */
const KeyCap: React.FC<{
    rect: PonderRelativeRect;
    line: string;
    outline: string;
    accent?: string;
    pressed?: boolean;
    marker: string;
}> = ({ rect, line, outline, accent, pressed, marker }) => (
    <span
        {...{ [marker]: true }}
        className="flex items-center justify-center rounded-lg border"
        style={{
            ...relativeRectStyle(rect),
            borderColor: accent ?? outline,
            backgroundColor: pressed ? 'rgba(255,255,255,0.10)' : undefined,
            opacity: pressed ? 0.6 : 1,
        }}
    >
        <span className="h-1.5 w-[46%] rounded-full" style={{ backgroundColor: accent ?? line }} />
    </span>
);

/**
 * 自定义快捷键。
 *
 * 界面上没写出来的两件事，图上都得看得见：Alt 是固定的（所以画成一颗常按着的键帽），
 * 命令下拉里的条目是筛过的（所以展开那一层要画成明显短于命令窗口里的完整列表）。
 */
const PonderCustomShortcutSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-custom-shortcut-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <Heading rect={S.heading} line={line} />
            <div className="rounded-xl border" style={{ ...relativeRectStyle(S.card), borderColor: outline }} />
            <CardCopy rect={S.copy} line={line} />

            {/* Alt 不是录进去的，是印在那儿的：它画成一颗已经按下、且不参与编辑的键帽。 */}
            <KeyCap marker="data-ponder-shortcut-alt" rect={S.capAlt} line={line} outline={outline} pressed />
            <KeyCap marker="data-ponder-shortcut-key" rect={S.capKey} line={line} outline={outline} accent={accent} />
            <span
                data-ponder-shortcut-clear
                className="flex items-center justify-center rounded-full"
                style={{ ...relativeRectStyle(S.clear), color: line }}
            >
                <X className="h-[62%] w-auto opacity-50" />
            </span>
            <CommandSelect marker="data-ponder-shortcut-command" rect={S.command} line={line} outline={outline} />
        </PonderSurfaceBase>

        {/* 按到一颗已经被占掉的字母：字段不收，红字长在键帽底下说明为什么。 */}
        <PonderSurfaceStateLayer state="key-refused" registerStateNode={registerStateNode}>
            <KeyCap marker="data-ponder-shortcut-key-refused" rect={S.capKey} line={line} outline={outline} accent="#f87171" />
            <span
                data-ponder-shortcut-rejection
                className="flex items-center"
                style={relativeRectStyle(S.rejection)}
            >
                <span className="h-1 w-[72%] rounded-full" style={{ backgroundColor: '#f87171' }} />
            </span>
        </PonderSurfaceStateLayer>

        {/* 展开的命令列表。它短，而且短得有理由 —— 只挑得出「在哪儿都成立」的那些命令。 */}
        <PonderSurfaceStateLayer state="command-list" registerStateNode={registerStateNode}>
            <CommandSelect marker="data-ponder-shortcut-command-open" rect={S.command} line={line} outline={outline} accent={accent} />
            <div
                data-ponder-shortcut-command-list
                className="flex flex-col justify-evenly rounded-lg border px-[5%]"
                style={{ ...relativeRectStyle(S.commandList), borderColor: outline, backgroundColor: 'rgba(0,0,0,0.35)' }}
            >
                {[72, 58, 84, 64].map((width, index) => (
                    <span key={width} data-ponder-shortcut-command-row className="flex items-center gap-[5%]">
                        <Command className="h-2.5 w-2.5 shrink-0 opacity-40" />
                        <span
                            className="h-1 rounded-full"
                            style={{ width: `${width}%`, backgroundColor: index === 0 ? accent : line }}
                        />
                    </span>
                ))}
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

/**
 * 固定命令。
 *
 * 设置这边只有三个下拉，讲不出任何东西；这一组真正的样子在命令窗口底下那一排。
 * 所以结果层整屏换成窗口本身：上半是会随使用重排的列表，下半是三颗不动的。
 */
const PonderPinnedCommandsSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-pinned-commands-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <Heading rect={P.heading} line={line} />
            <div className="rounded-xl border" style={{ ...relativeRectStyle(P.card), borderColor: outline }} />
            <CardCopy rect={P.copy} line={line} />
            {([
                ['data-ponder-pinned-slot-first', P.slotFirst],
                ['data-ponder-pinned-slot-second', P.slotSecond],
                ['data-ponder-pinned-slot-third', P.slotThird],
            ] as const).map(([marker, rect], index) => (
                // 标记挂在整列上而不是那个下拉上：真实界面里「槽位 N」那行小字和下拉是一对，
                // 只框住下拉的话，高亮会从它上面那行标题旁边切过去。
                <div key={marker} {...{ [marker]: true }} className="flex flex-col justify-end gap-[14%]" style={relativeRectStyle(rect)}>
                    <span className="h-1 w-[38%] rounded-full opacity-45" style={{ backgroundColor: line }} />
                    <span className="flex h-[52%] items-center gap-[6%] rounded-lg border px-[6%]" style={{ borderColor: outline }}>
                        <span className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: index === 2 ? line : accent, opacity: index === 2 ? 1 : 0.75 }} />
                        <ChevronDown className="h-3 w-3 shrink-0 opacity-45" />
                    </span>
                </div>
            ))}
        </PonderSurfaceBase>

        {/* 配出来的东西长在这儿：窗口下面那一排三颗胶囊，位置固定，不随使用重排。 */}
        <PonderSurfaceStateLayer state="palette-preview" registerStateNode={registerStateNode} replaces>
            <div
                data-ponder-pinned-palette
                className="rounded-2xl border"
                style={{ ...relativeRectStyle(P.palette), borderColor: outline, backgroundColor: 'rgba(0,0,0,0.4)' }}
            >
                <div className="absolute inset-x-[5%] top-[8%] flex h-[12%] items-center gap-[3%]">
                    <Search className="h-[70%] w-auto opacity-45" />
                    <span className="h-[26%] flex-1 rounded-full" style={{ backgroundColor: line }} />
                </div>
                <div
                    data-ponder-pinned-palette-list
                    className="flex flex-col justify-evenly"
                    style={relativeRectStyle(P.paletteList)}
                >
                    {[80, 62, 90, 54].map(width => (
                        <span key={width} className="flex items-center gap-[3%]">
                            <Command className="h-2.5 w-2.5 shrink-0 opacity-40" />
                            <span className="h-1 rounded-full" style={{ width: `${width}%`, backgroundColor: line }} />
                        </span>
                    ))}
                </div>
            </div>
            <div data-ponder-pinned-row className="grid grid-cols-3 gap-[3%]" style={relativeRectStyle(P.pinnedRow)}>
                {[0, 1, 2].map(index => (
                    <span
                        key={index}
                        data-ponder-pinned-chip
                        className="flex items-center justify-center gap-[8%] rounded-full border"
                        style={{ borderColor: accent }}
                    >
                        <Command className="h-2.5 w-2.5 shrink-0" style={{ color: accent }} />
                        <span className="h-1 w-[42%] rounded-full" style={{ backgroundColor: line }} />
                    </span>
                ))}
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'custom-shortcut-settings': PonderCustomShortcutSurface,
    'pinned-commands-settings': PonderPinnedCommandsSurface,
} satisfies PonderSurfaceDeclarations;
