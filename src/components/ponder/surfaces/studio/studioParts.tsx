import React from 'react';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import type { PonderRelativeRect } from '../../../../types/ponder';
import { relativeRectStyle } from '../relativeRectStyle';

// src/components/ponder/surfaces/studio/studioParts.tsx
// 歌词样式窗口和 Theme Park 是同一个外壳：一条标题栏，左边一块实时预览，右边一条窄设置栏，
// 栏顶一行文字标签。这里是那几张合成界面共用的部件。
//
// 里面还装着别的部件的框，描边一律用 inset box-shadow 而不是 border：绝对定位子元素的
// 百分比按**内边距盒**算，而锚点按边框盒算 —— 一条 1px 的 border 就让两者差出 2px，
// 正好是「骨架和真实元素错位」。box-shadow 不占盒模型，两边于是重合。

type Paint = { line: string; outline: string; accent: string };

/**
 * 标题栏：左端一颗返回，旁边一条标题，其余由 children 摆。
 *
 * children 的几何是「相对标题栏」的，所以它们必须渲染在这个框里面 ——
 * 摆到外面去，百分比就按整个窗口算，锚点和元素立刻错开小半屏。
 */
export const StudioHeader: React.FC<{
    rect: PonderRelativeRect;
    line: string;
    marker: string;
    children?: React.ReactNode;
}> = ({ rect, line, marker, children }) => (
    <div {...{ [marker]: true }} className="flex items-center gap-[1.2%]" style={relativeRectStyle(rect)}>
        <ChevronLeft className="h-[34%] w-auto shrink-0 opacity-60" />
        <span className="h-[14%] w-[8%] rounded-full" style={{ backgroundColor: line, opacity: 0.9 }} />
        {children}
    </div>
);

/** 左边那块实时预览：中间三行歌词，其余由 children 摆（几何相对这块预览）。 */
export const StudioSample: React.FC<Paint & {
    rect: PonderRelativeRect;
    marker: string;
    children?: React.ReactNode;
}> = ({ rect, line, outline, accent, marker, children }) => (
    <div
        {...{ [marker]: true }}
        className="overflow-hidden rounded-[2.4%]"
        style={{ ...relativeRectStyle(rect), boxShadow: `inset 0 0 0 1px ${outline}`, backgroundColor: 'rgba(0,0,0,0.35)' }}
    >
        <span className="absolute inset-x-[12%] top-[38%] flex flex-col gap-[6%]">
            {[74, 96, 56].map((width, index) => (
                <span
                    key={width}
                    className="h-2 rounded-full"
                    style={{ width: `${width}%`, backgroundColor: index === 1 ? accent : line, opacity: index === 1 ? 0.85 : 0.45 }}
                />
            ))}
        </span>
        {children}
    </div>
);

/** 右边那条设置栏的外框：左边一道分隔线。几何相对整个窗口，里面的东西相对它。 */
export const StudioColumn: React.FC<{
    rect: PonderRelativeRect;
    outline: string;
    marker?: string;
    children: React.ReactNode;
}> = ({ rect, outline, marker, children }) => (
    <div {...(marker ? { [marker]: true } : {})} style={relativeRectStyle(rect)}>
        <span className="absolute inset-y-0 -left-[3.5%] w-px" style={{ backgroundColor: outline }} />
        {children}
    </div>
);

/**
 * 右栏顶上那行文字标签：一格一条字，选中的那格字是亮的、底下一道线。几何相对右栏。
 */
export const StudioTextTabs: React.FC<{
    rects: readonly PonderRelativeRect[];
    line: string;
    accent: string;
    activeIndex: number;
}> = ({ rects, line, accent, activeIndex }) => (
    <>
        {rects.map((rect, index) => (
            <span
                key={index}
                data-ponder-editor-tab
                data-ponder-editor-tab-active={index === activeIndex || undefined}
                className="flex items-center justify-center"
                style={relativeRectStyle(rect)}
            >
                <span
                    className="h-[22%] flex-1 rounded-full"
                    style={{ backgroundColor: index === activeIndex ? accent : line, opacity: index === activeIndex ? 1 : 0.7 }}
                />
                {index === activeIndex && <span className="absolute inset-x-0 bottom-0 h-px" style={{ backgroundColor: accent }} />}
            </span>
        ))}
    </>
);

/** 右栏一行控件的几种形状：开关、滑杆、分段、下拉、一排小图。 */
export type StudioRowKind = 'toggle' | 'slider' | 'segmented' | 'select' | 'tiles';

export type StudioRowSpec = {
    kind: StudioRowKind;
    on?: boolean;
    /** 缩进一级：上一行开关管着的那一行。 */
    sub?: boolean;
    marker?: string;
};

export const StudioRow: React.FC<Paint & StudioRowSpec & { rect: PonderRelativeRect }> = ({
    rect, kind, on, sub, marker, line, outline, accent,
}) => (
    <div
        {...(marker ? { [marker]: true } : {})}
        data-ponder-studio-row
        className={`flex flex-col justify-center gap-[14%] pr-[4%] ${sub ? 'pl-[10%]' : 'pl-[4%]'}`}
        style={relativeRectStyle(rect)}
    >
        <span className="flex items-center gap-[3%]">
            <span className="h-1 rounded-full opacity-60" style={{ width: kind === 'slider' ? '30%' : '36%', backgroundColor: line }} />
            <span className="flex-1" />
            {kind === 'toggle' && (
                <span className="relative h-3 w-6 shrink-0 rounded-full" style={{ backgroundColor: on ? accent : line, opacity: on ? 0.75 : 1 }}>
                    <span className={`absolute top-0.5 h-2 w-2 rounded-full bg-white ${on ? 'right-0.5' : 'left-0.5'}`} />
                </span>
            )}
            {kind === 'slider' && <span className="h-1 w-[10%] shrink-0 rounded-full opacity-45" style={{ backgroundColor: line }} />}
            {kind === 'segmented' && (
                <span className="flex h-3.5 w-[38%] shrink-0 items-stretch gap-[4%] rounded-md p-px" style={{ backgroundColor: line }}>
                    {[0, 1].map(index => (
                        <span
                            key={index}
                            className="flex flex-1 items-center justify-center rounded-[5px]"
                            style={{ backgroundColor: index === 0 ? `${accent}33` : undefined }}
                        >
                            <span className="h-0.5 w-[50%] rounded-full" style={{ backgroundColor: index === 0 ? accent : outline }} />
                        </span>
                    ))}
                </span>
            )}
            {kind === 'select' && (
                <span className="flex h-3.5 w-[34%] shrink-0 items-center gap-[6%] rounded-md px-[4%]" style={{ backgroundColor: line }}>
                    <span className="h-0.5 flex-1 rounded-full" style={{ backgroundColor: accent, opacity: 0.8 }} />
                    <ChevronDown className="h-2 w-2 shrink-0 opacity-50" />
                </span>
            )}
            {kind === 'tiles' && (
                <span className="flex h-3.5 w-[52%] shrink-0 items-stretch gap-[5%]">
                    {[0, 1, 2, 3].map(index => (
                        <span
                            key={index}
                            className="flex-1 rounded-[3px]"
                            style={{ boxShadow: `inset 0 0 0 1px ${index === 0 ? accent : outline}`, backgroundColor: index === 0 ? `${accent}26` : undefined }}
                        />
                    ))}
                </span>
            )}
        </span>
        {kind === 'slider' && (
            <span className="relative h-1 rounded-full" style={{ backgroundColor: line }}>
                <span className="absolute inset-y-0 left-0 w-[52%] rounded-full" style={{ backgroundColor: accent, opacity: 0.8 }} />
                <span className="absolute left-[52%] top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ backgroundColor: accent }} />
            </span>
        )}
    </div>
);
