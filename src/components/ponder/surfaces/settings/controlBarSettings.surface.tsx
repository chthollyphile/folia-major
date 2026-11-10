import React from 'react';
import { ChevronDown, ChevronRight, ListMusic, RotateCcw, Volume2 } from 'lucide-react';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/settings/controlBarSettings.surface.tsx
// 设置里管底部控制条的两块：换槽位的那对下拉框，和「控制栏」那一组。

const PickerContents: React.FC<{ line: string; outline: string; accent: string }> = ({ line, outline, accent }) => (
    <div className="absolute inset-0 flex flex-col justify-center gap-[12%] px-[8%] py-[8%]">
        <div className="flex items-center gap-2">
            <div className="h-2 w-[42%] rounded-full" style={{ backgroundColor: line }} />
            <div className="h-px flex-1" style={{ backgroundColor: outline }} />
        </div>
        <div className="grid grid-cols-2 gap-[6%]">
            {[0, 1].map(index => (
                <div key={index} className="flex flex-col gap-2">
                    <div className="h-1.5 w-[58%] rounded-full" style={{ backgroundColor: line }} />
                    <div data-ponder-picker-field className="flex h-9 items-center gap-2 rounded-lg border px-2" style={{ borderColor: outline }}>
                        <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: line }}>
                            {index === 0 ? <ListMusic className="h-3 w-3" style={{ color: accent }} /> : <Volume2 className="h-3 w-3" style={{ color: accent }} />}
                        </span>
                        <span className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: line }} />
                        <ChevronDown className="h-3 w-3 opacity-45" />
                    </div>
                </div>
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
 * 和一条滑杆）；在播放页拖动调整（点这一行，右端一个箭头）；进度条右侧按钮（左侧、右侧两个下拉）。
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
            <div className="flex items-center gap-[4%]">
                <RowLabel line={line} width="34%" note />
                <span className="flex w-[50%] shrink-0 items-stretch gap-[5%]">
                    {[0, 1].map(index => (
                        <span key={index} className="flex h-5 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5" style={{ backgroundColor: line }}>
                            <span className="h-1 min-w-0 flex-1 rounded-full" style={{ backgroundColor: outline }} />
                            <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-50" />
                        </span>
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
