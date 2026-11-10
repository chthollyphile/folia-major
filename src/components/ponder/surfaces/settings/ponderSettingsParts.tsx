import React from 'react';
import type { PonderSurfaceStateRegistrar } from '../PonderSurfaceStateLayer';
import type { PonderRelativeRect } from '../../../../types/ponder';
import { relativeRectStyle } from '../relativeRectStyle';

// src/components/ponder/surfaces/settings/ponderSettingsParts.tsx
// 设置类合成界面的几个小件：分组标题、一行开关、一行名字加控件、分段控件。
//
// 抽出来是因为设置面板在真实界面里本来就是同一套形状，此前每个 surface 文件各写了一份 ——
// 第三份出现的时候，「改一次开关的画法」就变成了在三个文件里找同名组件。
// 各处的细微差别（图标 58% 还是 62%）是抄来抄去的噪声，不是设计，这里统一成一套。

export type PonderSettingsSurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

/** 分组标题：一条标题文字。真实的分组标题只有字，没有图标。 */
export const SettingsHeading: React.FC<{
    rect: PonderRelativeRect;
    line: string;
}> = ({ rect, line }) => (
    <span className="flex items-center" style={relativeRectStyle(rect)}>
        <span className="h-[25%] w-[62%] rounded-full opacity-70" style={{ backgroundColor: line }} />
    </span>
);

/** 一行开关：左边标题（可带说明），右边 48×24 的滑块。 */
export const SettingsToggleRow: React.FC<{
    rect: PonderRelativeRect;
    line: string;
    accent: string;
    on?: boolean;
    withDesc?: boolean;
    marker: string;
}> = ({ rect, line, accent, on, withDesc = true, marker }) => (
    <div {...{ [marker]: true }} className="flex items-center gap-[4%]" style={relativeRectStyle(rect)}>
        <span className="flex flex-1 flex-col gap-1.5">
            <span className="h-1.5 w-[40%] rounded-full" style={{ backgroundColor: line }} />
            {withDesc && <span className="h-1 w-[74%] rounded-full opacity-45" style={{ backgroundColor: line }} />}
        </span>
        {/* 开着的那条槽是实心的：它常常盖在同一颗关着的开关上，透明的话底下那颗把手会透出来。 */}
        <span
            className="relative h-4 w-8 shrink-0 rounded-full"
            style={{ backgroundColor: on ? accent : line }}
        >
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white ${on ? 'right-0.5' : 'left-0.5'}`} />
        </span>
    </div>
);

/** 设置里的一行：左边名字，右边的控件由 children 摆。 */
export const SettingsLabelRow: React.FC<{
    rect: PonderRelativeRect;
    line: string;
    marker?: string;
    children?: React.ReactNode;
}> = ({ rect, line, marker, children }) => (
    <div {...(marker ? { [marker]: true } : {})} className="flex items-center justify-between gap-[4%]" style={relativeRectStyle(rect)}>
        <span className="h-1.5 w-[26%] rounded-full" style={{ backgroundColor: line }} />
        {children}
    </div>
);

/** 几段里选一段的那种控件。active 是选中的第几段。 */
export const SettingsSegments: React.FC<{ count: number; active: number; className: string; line: string; outline: string; accent: string }> = ({
    count, active, className, line, outline, accent,
}) => (
    <span className={`flex shrink-0 items-stretch gap-[1%] rounded-lg p-[1%] ${className}`} style={{ backgroundColor: line }}>
        {Array.from({ length: count }, (_, index) => (
            <span
                key={index}
                className="flex flex-1 items-center justify-center rounded-md"
                style={{ backgroundColor: index === active ? `${accent}33` : undefined }}
            >
                <span className="h-1 w-[52%] rounded-full" style={{ backgroundColor: index === active ? accent : outline }} />
            </span>
        ))}
    </span>
);

/** 分段控件里的一段：选中的那段有底色。外面那条槽由各张图自己按尺寸表摆。 */
export const SettingsSegment: React.FC<{
    rect: PonderRelativeRect;
    outline: string;
    accent: string;
    selected?: boolean;
    marker: string;
}> = ({ rect, outline, accent, selected, marker }) => (
    <span
        {...{ [marker]: true }}
        className="flex items-center justify-center rounded-md"
        style={{ ...relativeRectStyle(rect), backgroundColor: selected ? `${accent}33` : undefined }}
    >
        <span className="h-1 w-[52%] rounded-full" style={{ backgroundColor: selected ? accent : outline }} />
    </span>
);
