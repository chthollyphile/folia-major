import React from 'react';
import { AtSign, ListEnd, ListPlus, Search, Trash2, X } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from '../PonderSurfaceStateLayer';
import { QUEUE_COMMAND_GEOMETRY as Q } from './queueCommand.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/command/queueCommand.surface.tsx
// 队列命令窗口。
//
// 和通用的 queue surface（播放队列那块面板）分开画：那一块是一张列表，这一块是一扇
// 命令窗口 —— 输入行、@ 建议、批量预览条，三样都不在那张列表上。共用一个 surfaceKind
// 的话，讲 @ 语法时屏幕上没有输入行可指。

type SurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

/** 输入行。chip 给的是「输入行里已经收成一枚标签」的那个状态。 */
const InputLine: React.FC<{
    accent: string;
    line: string;
    outline: string;
    chip?: 'facet' | 'action';
}> = ({ accent, line, outline, chip }) => (
    <div
        data-ponder-queue-command-input
        className="flex items-center gap-[2%] rounded-xl border px-[3%]"
        style={{ ...relativeRectStyle(Q.input), borderColor: outline, backgroundColor: 'rgba(255,255,255,0.03)' }}
    >
        <Search className="h-[42%] w-auto shrink-0 opacity-45" />
        {chip && (
            <span
                data-ponder-queue-command-chip
                className="flex h-[52%] shrink-0 items-center gap-[6%] rounded-full border px-[3%]"
                style={{ borderColor: accent, color: accent, backgroundColor: `${accent}1f` }}
            >
                {chip === 'facet'
                    ? <AtSign className="h-[52%] w-auto" />
                    : <Trash2 className="h-[52%] w-auto" />}
                <span className="h-1 w-8 rounded-full" style={{ backgroundColor: accent }} />
                <X className="h-[44%] w-auto opacity-55" />
            </span>
        )}
        <span className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: line, opacity: 0.6 }} />
    </div>
);

/** 一行歌：左边缩略图，右边歌名与歌手。 */
const QueueRows: React.FC<{
    accent: string;
    line: string;
    outline: string;
    rect: Parameters<typeof relativeRectStyle>[0];
    widths: number[];
}> = ({ accent, line, outline, rect, widths }) => (
    <div className="flex flex-col gap-[4%]" style={relativeRectStyle(rect)}>
        {widths.map((width, index) => (
            <span key={width} data-ponder-queue-command-row className="flex min-h-0 flex-1 items-center gap-[3%] border-b" style={{ borderColor: outline }}>
                <span className="aspect-square h-[62%] rounded-md" style={{ backgroundColor: index === 0 ? accent : line, opacity: index === 0 ? 0.5 : 1 }} />
                <span className="flex flex-1 flex-col gap-1">
                    <span className="h-1.5 rounded-full" style={{ width: `${width}%`, backgroundColor: line }} />
                    <span className="h-1 rounded-full opacity-55" style={{ width: `${Math.max(32, width - 26)}%`, backgroundColor: line }} />
                </span>
            </span>
        ))}
    </div>
);

const PonderQueueCommandSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-queue-command-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <InputLine accent={accent} line={line} outline={outline} />
            {/* 输入行下面那行小字：输入 @ 筛选，输入 -- 批量操作。 */}
            <span
                data-ponder-queue-command-hint
                className="h-1 rounded-full opacity-35"
                style={{ ...relativeRectStyle({ left: 0.06, top: 0.235, width: 0.46, height: 0.012 }), backgroundColor: line }}
            />
            <QueueRows accent={accent} line={line} outline={outline} rect={Q.rows} widths={[82, 64, 74, 56, 70]} />
        </PonderSurfaceBase>

        {/* 打一个 @：底下列出可选的歌手和专辑，每条带着这一项在队列里有几首。 */}
        <PonderSurfaceStateLayer state="facet-suggestions" registerStateNode={registerStateNode}>
            <div
                data-ponder-queue-command-suggestions
                className="flex flex-col justify-evenly rounded-xl border bg-zinc-950/98 px-[3%]"
                style={{ ...relativeRectStyle(Q.suggestions), borderColor: outline }}
            >
                {[0, 1, 2].map(index => (
                    <span key={index} className="flex items-center gap-[3%]">
                        <AtSign className="h-3 w-3 shrink-0 opacity-55" />
                        <span className="h-1.5 rounded-full" style={{ width: `${54 - index * 8}%`, backgroundColor: index === 0 ? accent : line, opacity: index === 0 ? 0.8 : 1 }} />
                        <span className="flex-1" />
                        <span className="h-1 w-[6%] rounded-full opacity-45" style={{ backgroundColor: line }} />
                    </span>
                ))}
            </div>
        </PonderSurfaceStateLayer>

        {/* 选中之后收成一枚标签，列表只剩这一项底下的那几首。 */}
        <PonderSurfaceStateLayer state="facet-narrowed" registerStateNode={registerStateNode} replaces>
            <InputLine accent={accent} line={line} outline={outline} chip="facet" />
            <QueueRows accent={accent} line={line} outline={outline} rect={Q.rows} widths={[74, 58, 66]} />
        </PonderSurfaceStateLayer>

        {/* 再打 --remove：底下长出一条预览，写明这一下会动几首。 */}
        <PonderSurfaceStateLayer state="batch-preview" registerStateNode={registerStateNode} replaces>
            <InputLine accent={accent} line={line} outline={outline} chip="action" />
            <QueueRows accent={accent} line={line} outline={outline} rect={Q.narrowedRows} widths={[74, 58, 66]} />
            <div
                data-ponder-queue-command-preview
                className="flex items-center gap-[3%] rounded-2xl border px-[4%]"
                style={{ ...relativeRectStyle(Q.preview), borderColor: accent, backgroundColor: `${accent}14` }}
            >
                <Trash2 className="h-[34%] w-auto shrink-0" style={{ color: accent }} />
                <span className="flex flex-1 flex-col gap-1.5">
                    <span className="h-1.5 w-[62%] rounded-full" style={{ backgroundColor: accent, opacity: 0.85 }} />
                    <span className="h-1 w-[40%] rounded-full opacity-45" style={{ backgroundColor: line }} />
                </span>
                <span className="flex shrink-0 items-center gap-[6%] opacity-45">
                    <ListPlus className="h-3 w-3" />
                    <ListEnd className="h-3 w-3" />
                </span>
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'queue-command': PonderQueueCommandSurface,
} satisfies PonderSurfaceDeclarations;
