import React from 'react';
import { ChevronRight, ListMusic, RotateCcw, Volume2 } from 'lucide-react';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/settings/controlBarSettings.surface.tsx
// 设置里管底部控制条的两块：进度条按钮的摆放编辑器，和「控制栏」那一组。

/**
 * 进度条按钮的摆放编辑器（设置 · 播放页）：上面是缩小的胶囊（浮岛一排在上，进度条和右侧两个槽位在下），
 * 下面是没摆出去的控件。两个槽位画成带记号的方格（data-ponder-picker-field）。
 */
const PickerContents: React.FC<{ line: string; outline: string; accent: string }> = ({ line, outline, accent }) => (
    <div className="absolute inset-0 flex flex-col justify-center gap-[8%] px-[8%] py-[8%]">
        <div className="flex flex-col gap-2 rounded-xl px-[5%] py-[5%]" style={{ backgroundColor: outline }}>
            <div className="flex items-center gap-1 self-start rounded-full px-1.5 py-1" style={{ backgroundColor: line }}>
                {[0, 1, 2, 3].map(index => (
                    <span key={index} className="h-4 w-4 rounded-full" style={{ backgroundColor: outline }} />
                ))}
            </div>
            <div className="flex items-center gap-2 rounded-full px-1.5 py-1" style={{ backgroundColor: line }}>
                <span className="h-1 flex-1 rounded-full" style={{ backgroundColor: outline }} />
                {[0, 1].map(index => (
                    <span key={index} data-ponder-picker-field className="flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: outline }}>
                        {index === 0 ? <ListMusic className="h-3 w-3" style={{ color: accent }} /> : <Volume2 className="h-3 w-3" style={{ color: accent }} />}
                    </span>
                ))}
            </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
            {[0, 1, 2, 3, 4].map(index => (
                <span key={index} className="h-4 w-[22%] rounded-md" style={{ backgroundColor: line }} />
            ))}
        </div>
    </div>
);

/** 一行左边的名字和它下面那句说明。 */
const RowLabel: React.FC<{ line: string; width: string; note?: boolean }> = ({ line, width, note }) => (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="h-1.5 rounded-full" style={{ width, backgroundColor: line, opacity: 0.95 }} />
        {note && <span className="h-1 w-[72%] rounded-full opacity-45" style={{ backgroundColor: line }} />}
    </span>
);

/**
 * 设置 · 播放页里的「控制栏」那一组，一张卡四行：自动隐藏控制栏（开关）；底部组件高度（复位的小图标
 * 和一条滑杆）；在播放页拖动调整（点这一行，右端一个箭头）；进度条按钮（右端「恢复默认」，下面一块缩小的胶囊）。
 *
 * 教程讲的是中间那两行：滑杆直接定高度，点「在播放页拖动调整」那一行把控制条变成可以拖的东西。
 */
const BottomUiSettingsContents: React.FC<{ line: string; outline: string; accent: string }> = ({ line, outline, accent }) => (
    <div data-ponder-bottom-ui-settings className="absolute inset-0 flex flex-col px-[5%] py-[4%]">
        <span className="h-[4%] w-[14%] shrink-0 rounded-full opacity-70" style={{ backgroundColor: line }} />
        <div className="mt-[3%] flex min-h-0 flex-1 flex-col justify-evenly rounded-xl border px-[4%]" style={{ borderColor: outline }}>
            <div className="flex items-center gap-[4%]">
                <RowLabel line={line} width="34%" note />
                <span className="relative h-4 w-8 shrink-0 rounded-full" style={{ backgroundColor: line }}>
                    <span className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white" />
                </span>
            </div>
            <div className="flex items-center gap-[4%]">
                <RowLabel line={line} width="30%" note />
                <span className="flex w-[50%] shrink-0 items-center gap-[5%]">
                    <RotateCcw className="h-3 w-3 shrink-0 opacity-45" />
                    <span data-ponder-bottom-ui-offset-track className="relative h-1.5 min-w-0 flex-1 rounded-full" style={{ backgroundColor: line }}>
                        <span className="absolute inset-y-0 left-0 w-[46%] rounded-full" style={{ backgroundColor: accent, opacity: 0.7 }} />
                        <span
                            className="absolute left-[46%] top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                            style={{ borderColor: outline, backgroundColor: accent }}
                        />
                    </span>
                    <span className="h-1 w-[12%] shrink-0 rounded-full opacity-60" style={{ backgroundColor: line }} />
                </span>
            </div>
            <div data-ponder-bottom-ui-reposition className="flex items-center gap-[4%]">
                <RowLabel line={line} width="38%" />
                <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
            </div>
            <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-[4%]">
                    <RowLabel line={line} width="34%" note />
                    <RotateCcw className="h-3 w-3 shrink-0 opacity-45" />
                </div>
                <span className="flex h-5 items-center gap-1 rounded-md px-1.5" style={{ backgroundColor: line }}>
                    {[0, 1, 2, 3].map(index => (
                        <span key={index} className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: outline }} />
                    ))}
                </span>
            </div>
        </div>
    </div>
);

export default {
    picker: PickerContents,
    'bottom-ui-settings': BottomUiSettingsContents,
} satisfies PonderSurfaceDeclarations;
