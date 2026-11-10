import React from 'react';
import { Check, RotateCcw } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase } from '../PonderSurfaceStateLayer';
import {
    SettingsHeading as Heading,
    SettingsLabelRow as LabelRow,
    SettingsToggleRow as ToggleRow,
    type PonderSettingsSurfaceProps as SurfaceProps,
} from './ponderSettingsParts';
import type { PonderRelativeRect } from '../../../../types/ponder';
import {
    GRID3D_CARD_STYLE_GEOMETRY as C,
    GRID_VIEW_CARD_GEOMETRY as V,
    LATTICE_STYLE_GEOMETRY as L,
} from './appearanceSettings.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/settings/appearanceSettings.surface.tsx
// 设置里管「卡片和海报长什么样」的三组：主页与歌单 · 主页，主页与歌单 · 网格卡片，播放页 · 视图。
//
// 三组都是一行小标题加一张卡，卡里一行一个名字加一个控件；开关、滑杆、标题和一行名字的画法
// 来自 ponderSettingsParts。

/** 一条滑杆：左边名字和一句说明，右边滑杆和数值。 */
const SliderRow: React.FC<{
    rect: PonderRelativeRect;
    line: string;
    accent: string;
    fill: number;
    marker: string;
}> = ({ rect, line, accent, fill, marker }) => (
    <div {...{ [marker]: true }} className="flex items-center gap-[4%]" style={relativeRectStyle(rect)}>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="h-1.5 w-[42%] rounded-full" style={{ backgroundColor: line }} />
            <span className="h-1 w-[70%] rounded-full opacity-45" style={{ backgroundColor: line }} />
        </span>
        <span className="relative h-1.5 w-[34%] shrink-0 rounded-full" style={{ backgroundColor: line }}>
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${fill * 100}%`, backgroundColor: accent, opacity: 0.8 }} />
            <span
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                style={{ left: `${fill * 100}%`, borderColor: outlineOf(accent), backgroundColor: accent }}
            />
        </span>
        <span className="h-1 w-[6%] shrink-0 rounded-full opacity-55" style={{ backgroundColor: line }} />
    </div>
);

/** 滑块把手的描边跟着强调色走，省一个只为它存在的 prop。 */
const outlineOf = (accent: string) => `${accent}88`;

/**
 * 两张小图里选一张的那种选项：一张小图，下面是它的名字，选中的那张描着边。
 * cards 是小图里画什么：一排整张都是封面的卡片，一排封面下面留一条边的卡片，几行歌词，一面海报墙。
 * 给了 rect 就按它摆（教程要单独指住这一张的时候）；不给就排在所在的那一行里。
 */
const PictureOption: React.FC<{
    rect?: PonderRelativeRect;
    line: string;
    outline: string;
    accent: string;
    selected?: boolean;
    marker: string;
    cards: 'cover' | 'polaroid' | 'lines' | 'wall';
}> = ({ rect, line, outline, accent, selected, marker, cards }) => (
    <span {...{ [marker]: true }} className={`flex flex-col items-center gap-1${rect ? '' : ' min-w-0 flex-1'}`} style={rect && relativeRectStyle(rect)}>
        <span
            className="flex min-h-0 w-full flex-1 items-center justify-center gap-[6%] overflow-hidden rounded-lg px-[6%]"
            style={{ backgroundColor: 'var(--st-pv)', boxShadow: `inset 0 0 0 ${selected ? 2 : 1}px ${selected ? accent : outline}` }}
        >
            {cards === 'lines' && (
                <span className="flex w-[64%] flex-col gap-1">
                    <span className="h-0.5 w-[50%] rounded-full" style={{ backgroundColor: outline }} />
                    <span className="h-0.5 w-full rounded-full" style={{ backgroundColor: accent }} />
                    <span className="h-0.5 w-[40%] rounded-full" style={{ backgroundColor: outline }} />
                </span>
            )}
            {cards === 'wall' && (
                <span className="grid h-[80%] w-[84%] grid-cols-4 grid-rows-3 gap-px">
                    {Array.from({ length: 12 }, (_, index) => (
                        <span key={index} className="rounded-[1px]" style={{ backgroundColor: index === 5 ? accent : outline, opacity: index === 5 ? 0.8 : 0.7 }} />
                    ))}
                </span>
            )}
            {(cards === 'cover' || cards === 'polaroid') && [0, 1, 2].map(index => (
                <span key={index} className="flex h-[66%] flex-1 flex-col overflow-hidden rounded-sm" style={{ backgroundColor: line }}>
                    <span className="min-h-0 flex-1" style={{ backgroundColor: index === 1 ? accent : outline, opacity: index === 1 ? 0.7 : 1 }} />
                    {cards === 'polaroid' && <span className="mx-auto my-[12%] h-px w-[60%]" style={{ backgroundColor: outline }} />}
                </span>
            ))}
        </span>
        <span className="h-1 w-[56%] shrink-0 rounded-full" style={{ backgroundColor: selected ? accent : outline }} />
    </span>
);

/**
 * 主页与歌单 · 主页：顶部胶囊入口（五个带勾的小块，平台没有探索页时“探索”那块是暗的）、歌单卡片样式（两张小图）、记住主页卡片位置（开关）。
 * 默认选中的是「拍立得卡片」。
 */
const PonderGrid3dCardStyleSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-grid3d-card-style-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <Heading rect={C.heading} line={line} />
            <div className="rounded-xl border" style={{ ...relativeRectStyle(C.card), borderColor: outline }}>
                <span className="absolute inset-x-[4%] top-[26%] h-px" style={{ backgroundColor: line }} />
                <span className="absolute inset-x-[4%] top-[76%] h-px" style={{ backgroundColor: line }} />
            </div>
            <LabelRow rect={C.tabsRow} line={line}>
                <span className="flex h-[52%] w-[50%] shrink-0 items-stretch gap-[3%]">
                    {[0, 1, 2, 3].map(index => (
                        <span key={index} className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md" style={{ backgroundColor: line }}>
                            <Check className="h-2.5 w-2.5 shrink-0" style={{ color: accent }} />
                            <span className="h-1 w-[34%] rounded-full" style={{ backgroundColor: outline }} />
                        </span>
                    ))}
                </span>
            </LabelRow>
            <LabelRow rect={C.styleRow} line={line} />
            <PictureOption marker="data-ponder-grid3d-style-image" rect={C.optionImage} line={line} outline={outline} accent={accent} cards="cover" />
            <PictureOption marker="data-ponder-grid3d-style-card" rect={C.optionCard} line={line} outline={outline} accent={accent} cards="polaroid" selected />
            <ToggleRow marker="data-ponder-grid3d-remember" rect={C.rememberRow} line={line} accent={accent} withDesc={false} on />
        </PonderSurfaceBase>
    </div>
);

/** 预览那一条里每张卡片有多大（占这一条高度的几成）和多淡：离中间越远越小越淡。 */
const PREVIEW_CARDS = [
    [0.34, 0.35], [0.46, 0.6], [0.62, 0.85], [0.76, 1], [0.62, 0.85], [0.46, 0.6], [0.34, 0.35],
] as const;

/**
 * 主页与歌单 · 网格卡片：标题那一行右端是「恢复默认衰减」；卡顶上一条预览，下面全画幅封面的开关
 * 和两条衰减滑杆。
 *
 * 「正方形卡片」画在结果层里：真实界面里它要等「全画幅封面」打开才渲染出来。
 */
const PonderGridViewCardSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-grid-view-card-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <Heading rect={V.heading} line={line} />
            <span data-ponder-grid-view-reset className="flex items-center justify-end gap-[6%]" style={relativeRectStyle(V.reset)}>
                <RotateCcw className="h-[64%] w-auto shrink-0 opacity-55" />
                <span className="h-[18%] w-[66%] rounded-full opacity-55" style={{ backgroundColor: line }} />
            </span>
            <div className="rounded-xl border" style={{ ...relativeRectStyle(V.card), borderColor: outline }} />
            <span
                data-ponder-grid-view-preview
                className="flex items-center justify-center gap-[2.5%] rounded-lg"
                style={{ ...relativeRectStyle(V.preview), backgroundColor: 'var(--st-pv)' }}
            >
                {PREVIEW_CARDS.map(([size, opacity], index) => (
                    <span
                        key={index}
                        className="aspect-[3/4] rounded-sm"
                        style={{ height: `${size * 100}%`, backgroundColor: index === 3 ? accent : outline, opacity: index === 3 ? 0.8 : opacity }}
                    />
                ))}
            </span>
            <ToggleRow marker="data-ponder-grid-view-full-bleed" rect={V.fullBleed} line={line} accent={accent} />
            <SliderRow marker="data-ponder-grid-view-min-scale" rect={V.minScale} line={line} accent={accent} fill={0.3} />
            <SliderRow marker="data-ponder-grid-view-min-opacity" rect={V.minOpacity} line={line} accent={accent} fill={0.42} />
        </PonderSurfaceBase>

        {/* 开了全画幅封面，缩进一级的「正方形卡片」那一行才长出来。纯叠加：底下那屏要留着。 */}
        <PonderSurfaceStateLayer state="full-bleed-on" registerStateNode={registerStateNode}>
            <ToggleRow marker="data-ponder-grid-view-full-bleed-on" rect={V.fullBleed} line={line} accent={accent} on />
            <ToggleRow marker="data-ponder-grid-view-square" rect={V.square} line={line} accent={accent} />
        </PonderSurfaceStateLayer>
    </div>
);

/**
 * 播放页 · 视图：播放后进入的视图（两张小图），边缘暗角，加一组层层解锁的海报聚焦叠色。
 *
 * 叠色关着时下面什么都没有；开了才有缩进的自定义颜色和强度；开了自定义颜色才有取色器。
 * 两层结果层照这个顺序叠。
 */
const PonderLatticeStyleSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-lattice-style-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <Heading rect={L.heading} line={line} />
            <div className="rounded-xl border" style={{ ...relativeRectStyle(L.card), borderColor: outline }}>
                <span className="absolute inset-x-[4%] top-[24%] h-px" style={{ backgroundColor: line }} />
            </div>
            <LabelRow rect={L.entryView} line={line}>
                <span className="flex h-full w-[44%] shrink-0 items-stretch gap-[6%] py-[1%]">
                    <PictureOption marker="data-ponder-lattice-entry-player" line={line} outline={outline} accent={accent} cards="lines" selected />
                    <PictureOption marker="data-ponder-lattice-entry-lattice" line={line} outline={outline} accent={accent} cards="wall" />
                </span>
            </LabelRow>
            <ToggleRow marker="data-ponder-lattice-vignette" rect={L.vignette} line={line} accent={accent} withDesc={false} on />
            <ToggleRow marker="data-ponder-lattice-tint" rect={L.tint} line={line} accent={accent} withDesc={false} />
        </PonderSurfaceBase>

        {/* 开了叠色：自定义颜色开关和强度滑杆出现。 */}
        <PonderSurfaceStateLayer state="tint-on" registerStateNode={registerStateNode}>
            <ToggleRow marker="data-ponder-lattice-tint-on" rect={L.tint} line={line} accent={accent} withDesc={false} on />
            <ToggleRow marker="data-ponder-lattice-custom-color" rect={L.customColor} line={line} accent={accent} />
            <SliderRow marker="data-ponder-lattice-intensity" rect={L.intensity} line={line} accent={accent} fill={0.5} />
        </PonderSurfaceStateLayer>

        {/* 再开自定义颜色：取色器占掉中间那块。 */}
        <PonderSurfaceStateLayer state="custom-color-on" registerStateNode={registerStateNode}>
            <ToggleRow marker="data-ponder-lattice-custom-color-on" rect={L.customColor} line={line} accent={accent} on />
            <div
                data-ponder-lattice-picker
                className="overflow-hidden rounded-lg border"
                style={{
                    ...relativeRectStyle(L.picker),
                    borderColor: outline,
                    background: `linear-gradient(90deg, #ef4444, #eab308, #22c55e, #3b82f6, #a855f7, #ef4444)`,
                }}
            >
                <span className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.55), transparent 45%, rgba(0,0,0,0.6))' }} />
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'grid3d-card-style': PonderGrid3dCardStyleSurface,
    'grid-view-card-settings': PonderGridViewCardSurface,
    'lattice-style-settings': PonderLatticeStyleSurface,
} satisfies PonderSurfaceDeclarations;
