import React from 'react';
import { Pause } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase } from '../PonderSurfaceStateLayer';
import type { PonderRelativeRect } from '../../../../types/ponder';
import { THEME_PARK_GEOMETRY as P } from './themePark.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import { StudioColumn, StudioHeader, StudioSample, StudioTextTabs } from './studioParts';
import type { PonderSurfaceDeclarations, PonderSurfaceProps as SurfaceProps } from '../surfaceDeclarations';

// src/components/ponder/surfaces/studio/themePark.surface.tsx
// Theme Park：标题栏（编辑目标那一对、一行提示、重置、保存），左边一块实时预览，右边一条设置栏，
// 栏顶四个文字标签（配色、信息、内容、AI）。画的是「配色」那一页。
//
// 这一屏本身就是被教的对象，每个部件都要能被锚点指住，所以位置一律走 themePark.geometry。

/** 保存那颗按钮在登记表里的名字：按不动的那一层用 replaces 指向它。 */
const PARK_SAVE_STATE = 'park-save';

const TAB_RECTS = [P.tabColors, P.tabDetails, P.tabContent, P.tabAi] as const;

/** 推荐色画几枚。真实那一排最多十二枚。 */
const RECOMMENDED_COUNT = 8;

/** 把相对标题栏、右栏的部件放回它们该在的坐标系。 */
const Frame: React.FC<{ rect: PonderRelativeRect; children: React.ReactNode }> = ({ rect, children }) => (
    <div style={relativeRectStyle(rect)}>{children}</div>
);

/** 标题栏右端的保存：实心的强调色按钮。blocked = 名字没填，按不动。 */
const SaveButton: React.FC<{ accent: string; blocked?: boolean; marker: string }> = ({ accent, blocked, marker }) => (
    <span
        {...{ [marker]: true }}
        className={`flex items-center justify-center rounded-lg ${blocked ? 'opacity-40' : ''}`}
        style={{ ...relativeRectStyle(P.save), backgroundColor: accent }}
    >
        <span className="h-[14%] w-[62%] rounded-full bg-white/90" />
    </span>
);

/** 两格的切换：标题栏上「编辑哪一份」和右栏里「亮 / 暗」是同一种控件，选中的都是第二格。 */
const Pair: React.FC<{ rect: PonderRelativeRect; marker: string; line: string; outline: string; accent: string }> = ({
    rect, marker, line, outline, accent,
}) => (
    <div {...{ [marker]: true }} className="flex items-stretch gap-[2%] rounded-lg p-[1%]" style={{ ...relativeRectStyle(rect), backgroundColor: line }}>
        {[0, 1].map(index => (
            <span
                key={index}
                data-active={index === 1 || undefined}
                className="flex flex-1 items-center justify-center rounded-md"
                style={{ backgroundColor: index === 1 ? `${accent}33` : undefined }}
            >
                <span className="h-0.5 w-[44%] rounded-full" style={{ backgroundColor: index === 1 ? accent : outline }} />
            </span>
        ))}
    </div>
);

/**
 * Theme Park。
 *
 * 标题栏上三件是这一屏的关键：在编辑哪一份主题、重置、保存。保存会因为名字没填而灰着，
 * 而名字在右栏「信息」那一页上 —— 所以 `save-blocked` 那一层要同时把灰掉的保存和
 * 「信息」标签上的小圆点亮出来，两样分开画就讲不成一句话。
 */
const PonderThemeParkSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => {
    const paint = { accent, line, outline };
    return (
        <div className="absolute inset-0 overflow-hidden" data-ponder-theme-park-structure>
            <PonderSurfaceBase registerStateNode={registerStateNode}>
                {/* 标题栏上那几件的几何是相对标题栏的，所以它们作为 children 长在标题栏里面。 */}
                <StudioHeader rect={P.header} line={line} marker="data-ponder-park-header">
                    <Pair rect={P.targetToggle} marker="data-ponder-park-target" {...paint} />
                    <span data-ponder-park-hint className="rounded-full opacity-50" style={{ ...relativeRectStyle(P.hint), backgroundColor: line }} />
                    <span
                        data-ponder-park-reset
                        className="flex items-center justify-center rounded-lg"
                        style={{ ...relativeRectStyle(P.reset), backgroundColor: line }}
                    >
                        <span className="h-[14%] w-[52%] rounded-full" style={{ backgroundColor: outline }} />
                    </span>
                </StudioHeader>
                {/* 保存单独一层：名字没填时，整颗换成灰的那一颗。 */}
                <PonderSurfaceStateLayer state={PARK_SAVE_STATE} registerStateNode={registerStateNode} visible>
                    <Frame rect={P.header}>
                        <SaveButton accent={accent} marker="data-ponder-park-save" />
                    </Frame>
                </PonderSurfaceStateLayer>

                <StudioSample rect={P.preview} marker="data-ponder-park-preview" {...paint}>
                    <span data-ponder-park-name className="flex flex-col justify-center gap-[20%]" style={relativeRectStyle(P.previewName)}>
                        <span className="h-[24%] w-[62%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
                        <span className="h-[16%] w-full rounded-full opacity-50" style={{ backgroundColor: line }} />
                    </span>
                    <span
                        data-ponder-park-pause
                        className="flex items-center justify-center rounded-full"
                        style={{ ...relativeRectStyle(P.pause), backgroundColor: 'rgba(0,0,0,0.55)' }}
                    >
                        <Pause className="h-[42%] w-auto text-white opacity-80" />
                    </span>
                    {/* 底下一行：正在播放的小卡片、进度条、时间、一颗按钮。 */}
                    <span data-ponder-park-footer className="flex items-center gap-[2%]" style={relativeRectStyle(P.previewFooter)}>
                        <span className="flex h-full w-[16%] shrink-0 items-center gap-[8%] rounded-lg px-[1.2%]" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
                            <span className="aspect-square h-[64%] shrink-0 rounded-md" style={{ backgroundColor: line }} />
                            <span className="flex min-w-0 flex-1 flex-col gap-1">
                                <span className="h-1 w-[80%] rounded-full" style={{ backgroundColor: line }} />
                                <span className="h-0.5 w-[50%] rounded-full opacity-60" style={{ backgroundColor: line }} />
                            </span>
                        </span>
                        <span className="relative h-0.5 min-w-0 flex-1 rounded-full" style={{ backgroundColor: line }}>
                            <span className="absolute inset-y-0 left-0 w-[14%] rounded-full" style={{ backgroundColor: accent }} />
                        </span>
                        <span className="h-1 w-[4%] shrink-0 rounded-full opacity-50" style={{ backgroundColor: line }} />
                        <span className="flex h-[64%] w-[8%] shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: accent }}>
                            <span className="h-0.5 w-[50%] rounded-full bg-white/90" />
                        </span>
                    </span>
                </StudioSample>

                <StudioColumn rect={P.panel} outline={outline} marker="data-ponder-park-panel">
                    <StudioTextTabs rects={TAB_RECTS} line={line} accent={accent} activeIndex={0} />
                    <span className="absolute inset-x-0 top-[7%] h-px" style={{ backgroundColor: outline }} />

                    {/* 亮 / 暗是两份独立的配色，这一对切的是「现在编辑哪一份」。 */}
                    <Pair rect={P.modeToggle} marker="data-ponder-park-mode" {...paint} />

                    {/* 四种颜色是 2×2 的四格：色块、名字、HEX。描着边的是正在取色器里的那一种。 */}
                    <div data-ponder-park-colors className="grid grid-cols-2 grid-rows-2 gap-x-[2.5%] gap-y-[9%]" style={relativeRectStyle(P.colorWells)}>
                        {[0, 1, 2, 3].map(index => (
                            <span
                                key={index}
                                data-ponder-park-color-well
                                data-chosen={index === 2 || undefined}
                                className="flex items-center gap-[7%] rounded-lg px-[6%]"
                                style={{ backgroundColor: line, boxShadow: index === 2 ? `inset 0 0 0 2px ${accent}` : undefined }}
                            >
                                <span className="aspect-square h-[52%] shrink-0 rounded-md" style={{ backgroundColor: index === 2 ? accent : outline }} />
                                <span className="flex min-w-0 flex-1 flex-col gap-1">
                                    <span className="h-1 w-[46%] rounded-full" style={{ backgroundColor: outline }} />
                                    <span className="h-0.5 w-[64%] rounded-full opacity-60" style={{ backgroundColor: outline }} />
                                </span>
                            </span>
                        ))}
                    </div>

                    {/* 取色器那张卡：顶上一行是选中那种颜色的名字和用处，下面色域、色相条、HEX、推荐色。 */}
                    <div
                        data-ponder-park-picker
                        className="rounded-lg"
                        style={{ ...relativeRectStyle(P.picker), boxShadow: `inset 0 0 0 1px ${outline}` }}
                    >
                        <span className="absolute left-[4%] top-[4.5%] flex h-[2.4%] w-[62%] items-center gap-[4%]">
                            <span className="h-full w-[22%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
                            <span className="h-[70%] flex-1 rounded-full opacity-50" style={{ backgroundColor: line }} />
                        </span>
                    </div>
                    <span
                        data-ponder-park-picker-area
                        className="rounded-md"
                        style={{
                            ...relativeRectStyle(P.pickerArea),
                            background: `linear-gradient(to top, rgba(0,0,0,0.9), transparent), linear-gradient(to right, rgba(255,255,255,0.9), ${accent})`,
                        }}
                    />
                    <span className="rounded-full" style={{ ...relativeRectStyle(P.hue), backgroundColor: line }}>
                        <span className="absolute left-[66%] top-1/2 aspect-square h-[220%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
                    </span>
                    <span data-ponder-park-hex className="flex items-center gap-[3%]" style={relativeRectStyle(P.hex)}>
                        <span className="aspect-square h-full shrink-0 rounded-md" style={{ backgroundColor: accent }} />
                        <span className="flex h-full flex-1 items-center rounded-md px-[4%]" style={{ backgroundColor: line }}>
                            <span className="h-0.5 w-[30%] rounded-full" style={{ backgroundColor: outline }} />
                        </span>
                    </span>
                    {/* 推荐色：一行小标题，下面一排圆色块，点一枚直接填进正在选中的那一种。 */}
                    <div data-ponder-park-recommended className="flex flex-col justify-between" style={relativeRectStyle(P.recommended)}>
                        <span className="h-[12%] w-[14%] rounded-full opacity-50" style={{ backgroundColor: line }} />
                        <span className="flex h-[50%] items-stretch gap-[1.6%]">
                            {Array.from({ length: RECOMMENDED_COUNT }, (_, index) => (
                                <span
                                    key={index}
                                    data-ponder-park-swatch
                                    className="aspect-square h-full rounded-full"
                                    style={{
                                        backgroundColor: index % 3 === 0 ? accent : outline,
                                        opacity: 0.45 + (index % 4) * 0.15,
                                    }}
                                />
                            ))}
                        </span>
                    </div>
                </StudioColumn>
            </PonderSurfaceBase>

            {/* 名字没填：保存灰着，而要填的地方在「信息」那一页 —— 那个标签旁边多出一个小圆点。 */}
            <PonderSurfaceStateLayer state="save-blocked" registerStateNode={registerStateNode} replaces={PARK_SAVE_STATE}>
                <Frame rect={P.header}>
                    <SaveButton accent={accent} blocked marker="data-ponder-park-save-blocked" />
                </Frame>
                <Frame rect={P.panel}>
                    <span data-ponder-park-tab-details style={relativeRectStyle(P.tabDetails)}>
                        <span className="absolute -right-[24%] top-1/2 aspect-square h-[22%] -translate-y-1/2 rounded-full bg-amber-400" />
                    </span>
                </Frame>
            </PonderSurfaceStateLayer>
        </div>
    );
};

export default {
    'theme-park': PonderThemeParkSurface,
} satisfies PonderSurfaceDeclarations;
