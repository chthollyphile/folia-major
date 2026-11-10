import React from 'react';
import { Pause } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase } from '../PonderSurfaceStateLayer';
import type { PonderRelativeRect } from '../../../../types/ponder';
import {
    VIS_PLAYGROUND_GEOMETRY as V,
    VIS_STYLE_SHELF_COUNT,
    visPanelRowRect,
    visStyleTileRect,
} from './visPlayground.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import { StudioColumn, StudioHeader, StudioRow, StudioSample, StudioTextTabs, type StudioRowSpec } from './studioParts';
import type { PonderSurfaceDeclarations, PonderSurfaceProps as SurfaceProps } from '../surfaceDeclarations';

// src/components/ponder/surfaces/studio/visPlayground.surface.tsx
// 歌词样式窗口：标题栏，左边上面是实时预览、下面一架样式图，右边一条设置栏，
// 栏顶五个文字标签（歌词动画、背景、通用、字幕、全局）。
// 样式架、右栏一页这两件也导出给歌词样式那张图（lyricStyle.surface.tsx）用：它画的是同一个窗口。
//
// 这一屏本身就是被教的对象，每个部件都要能被锚点指住，所以位置一律走 visPlayground.geometry。

type Paint = Pick<SurfaceProps, 'accent' | 'line' | 'outline'>;

/** 右栏那个槽位在登记表里的名字：换页的结果层用 replaces 指向它。 */
export const VIS_PANEL_STATE = 'vis-panel';

const TAB_RECTS = [V.tabAnimation, V.tabBackground, V.tabCommon, V.tabSubtitle, V.tabGlobal] as const;

/** 预览下面那一架样式图。chosen 是描着边的那一张。 */
export const VisStyleShelf: React.FC<Paint & { chosen: number; marker?: string }> = ({ chosen, marker, line, outline, accent }) => (
    <div {...(marker ? { [marker]: true } : {})} style={relativeRectStyle(V.shelf)}>
        <span className="absolute left-[0.4%] top-[3%] flex h-[7%] w-[12%] items-center gap-[10%]">
            <span className="h-[45%] w-[40%] rounded-full" style={{ backgroundColor: line, opacity: 0.9 }} />
            <span className="h-[45%] w-[20%] rounded-full opacity-50" style={{ backgroundColor: line }} />
        </span>
        {Array.from({ length: VIS_STYLE_SHELF_COUNT }, (_, index) => {
            const rect = visStyleTileRect(index);
            const isChosen = index === chosen;
            return (
                <React.Fragment key={index}>
                    <span
                        data-ponder-style-tile
                        data-chosen={isChosen || undefined}
                        className="flex items-center justify-center rounded-[10%]"
                        style={{
                            ...relativeRectStyle(rect),
                            backgroundColor: 'rgba(0,0,0,0.4)',
                            boxShadow: `inset 0 0 0 ${isChosen ? 2 : 1}px ${isChosen ? accent : outline}`,
                        }}
                    >
                        <span className="h-[8%] w-[22%] rounded-full" style={{ backgroundColor: isChosen ? accent : line }} />
                    </span>
                    <span
                        className="flex justify-center"
                        style={relativeRectStyle({ left: rect.left, width: rect.width, top: (rect.top ?? 0) + 0.31, height: 0.05 })}
                    >
                        <span className="h-full w-[34%] rounded-full" style={{ backgroundColor: line, opacity: isChosen ? 1 : 0.6 }} />
                    </span>
                </React.Fragment>
            );
        })}
    </div>
);

/** 一页里的一组：几行控件，或者「背景」页那一格背景图（占三行的位置）。heading = 组上面有一行小标题。 */
type VisPageGroup = { heading?: boolean } & ({ rows: readonly StudioRowSpec[] } | { pictures: true });

/** 右栏的一页：选中第几个标签，从上到下有哪几组。 */
export type VisPage = { tab: number; groups: readonly VisPageGroup[] };

/** 「歌词动画」页：当前样式自己的那几项。这里画的是「流光」的。 */
const ANIMATION_PAGE: VisPage = {
    tab: 0,
    groups: [{ heading: true, rows: [{ kind: 'toggle', on: true }, { kind: 'segmented' }, { kind: 'slider' }, { kind: 'slider' }] }],
};

/** 「背景」页：一格背景图，下面是选中的那个背景自己的几项。 */
export const VIS_BACKGROUND_PAGE: VisPage = {
    tab: 1,
    groups: [
        { heading: true, pictures: true },
        { rows: [{ kind: 'slider' }, { kind: 'toggle', on: true }] },
    ],
};

/** 「通用」页：预览文本、字体、字号、自动字重、整体透明度。 */
const COMMON_PAGE: VisPage = {
    tab: 2,
    groups: [{
        rows: [
            { kind: 'segmented', marker: 'data-ponder-playground-preview-text' },
            { kind: 'tiles', marker: 'data-ponder-playground-font' },
            { kind: 'slider' },
            { kind: 'toggle', on: true, marker: 'data-ponder-playground-font-weight' },
            { kind: 'slider', marker: 'data-ponder-playground-opacity' },
        ],
    }],
};

/**
 * 「字幕」页，按真实次序：隐藏底部字幕层、副字幕内容、字幕透明度、字幕背景、非翻译歌词模糊；
 * 和声字幕一组（显示、它的背景）；字幕字体一组（继承歌词字体、字幕缩放）。
 */
export const VIS_SUBTITLE_PAGE: VisPage = {
    tab: 3,
    groups: [
        {
            rows: [
                { kind: 'toggle' },
                { kind: 'select', marker: 'data-ponder-playground-subtitle-content' },
                { kind: 'slider' },
                { kind: 'toggle', on: true },
                { kind: 'toggle', on: true, marker: 'data-ponder-playground-subtitle-blur' },
            ],
        },
        { heading: true, rows: [{ kind: 'toggle', on: true, marker: 'data-ponder-playground-harmony' }, { kind: 'toggle', on: true, sub: true }] },
        { heading: true, rows: [{ kind: 'toggle', on: true, marker: 'data-ponder-playground-subtitle-font' }, { kind: 'slider' }] },
    ],
};

/**
 * 右栏的一页：标签行、右端那颗只管本页的「默认」，再按组铺下去。
 *
 * 「默认」退的只是这一页，不是整个窗口，所以它在骨架上必须始终在场、且在标签那一行的右端。
 */
export const VisPanelPage: React.FC<Paint & { page: VisPage; marker: string }> = ({ page, marker, line, outline, accent }) => {
    let slot = 0;
    return (
        <>
            <StudioTextTabs rects={TAB_RECTS} line={line} accent={accent} activeIndex={page.tab} />
            <span className="absolute inset-x-0 top-[7%] h-px" style={{ backgroundColor: outline }} />
            <span data-ponder-playground-section-reset className="flex items-center justify-center" style={relativeRectStyle(V.panelReset)}>
                <span className="h-[22%] w-[70%] rounded-full opacity-60" style={{ backgroundColor: line }} />
            </span>
            <div {...{ [marker]: true }} style={relativeRectStyle(V.rows)} />
            {page.groups.map((group, groupIndex) => {
                const first = slot;
                const size = 'pictures' in group ? 3 : group.rows.length;
                slot += size;
                const top = visPanelRowRect(first).top ?? 0;
                const last = visPanelRowRect(first + size - 1);
                const card: PonderRelativeRect = {
                    left: 0.03, right: 0.02, top: top - 0.004, height: (last.top ?? 0) + (last.height ?? 0) - top + 0.008,
                };
                return (
                    <React.Fragment key={groupIndex}>
                        {group.heading && (
                            <span
                                className="rounded-full opacity-60"
                                style={{ ...relativeRectStyle({ left: 0.04, top: top - 0.022, width: 0.2, height: 0.008 }), backgroundColor: line }}
                            />
                        )}
                        <span className="rounded-lg" style={{ ...relativeRectStyle(card), boxShadow: `inset 0 0 0 1px ${outline}` }} />
                        {'pictures' in group ? (
                            <span
                                data-ponder-playground-background-pictures
                                className="grid grid-cols-3 grid-rows-2 gap-[4%] p-[3%]"
                                style={relativeRectStyle(V.backgroundPictures)}
                            >
                                {[0, 1, 2, 3, 4, 5].map(index => (
                                    <span
                                        key={index}
                                        className="rounded-md"
                                        style={{
                                            backgroundColor: 'rgba(0,0,0,0.4)',
                                            boxShadow: `inset 0 0 0 ${index === 1 ? 2 : 1}px ${index === 1 ? accent : outline}`,
                                        }}
                                    />
                                ))}
                            </span>
                        ) : group.rows.map((row, index) => (
                            <StudioRow key={index} rect={visPanelRowRect(first + index)} {...row} line={line} outline={outline} accent={accent} />
                        ))}
                    </React.Fragment>
                );
            })}
        </>
    );
};

/** 这个窗口的右栏外框。 */
export const VisPanelFrame: React.FC<{ outline: string; marker?: string; children: React.ReactNode }> = ({ outline, marker, children }) => (
    <StudioColumn rect={V.panel} outline={outline} marker={marker}>{children}</StudioColumn>
);

/**
 * 歌词样式窗口。
 *
 * 最藏的是预览上那三块热区：它们完全透明，只有指针压上去才描边，所以这张图上
 * 基础层画的也是看不见的 —— 只有 `hotspots-visible` 那一层才把边框亮出来。
 */
const PonderVisPlaygroundSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => {
    const paint = { accent, line, outline };
    const hotspots = [
        ['data-ponder-playground-hotspot-background', V.hotspotBackground],
        ['data-ponder-playground-hotspot-visualizer', V.hotspotVisualizer],
        ['data-ponder-playground-hotspot-subtitle', V.hotspotSubtitle],
    ] as const;

    return (
        <div className="absolute inset-0 overflow-hidden" data-ponder-vis-playground-structure>
            <PonderSurfaceBase registerStateNode={registerStateNode}>
                <StudioHeader rect={V.header} line={line} marker="data-ponder-playground-header" />
                <StudioSample rect={V.preview} marker="data-ponder-playground-preview" {...paint}>
                    <span
                        data-ponder-playground-pause
                        className="flex items-center justify-center rounded-full"
                        style={{ ...relativeRectStyle(V.pause), backgroundColor: 'rgba(0,0,0,0.55)' }}
                    >
                        <Pause className="h-[42%] w-auto text-white opacity-80" />
                    </span>
                    {/* 平时的热区：位置就在这儿，但没有描边也没有底色，看不出任何东西。 */}
                    {hotspots.map(([marker, rect]) => (
                        <span key={marker} {...{ [marker]: true }} style={relativeRectStyle(rect)} />
                    ))}
                </StudioSample>
                <VisStyleShelf chosen={3} marker="data-ponder-playground-shelf" {...paint} />

                {/* 基础层停在「歌词动画」那一页：窗口打开时就是它。 */}
                <PonderSurfaceStateLayer state={VIS_PANEL_STATE} registerStateNode={registerStateNode} visible>
                    <VisPanelFrame outline={outline} marker="data-ponder-playground-panel">
                        <VisPanelPage page={ANIMATION_PAGE} marker="data-ponder-playground-rows" {...paint} />
                    </VisPanelFrame>
                </PonderSurfaceStateLayer>
            </PonderSurfaceBase>

            {/* 换到另一页：整块右栏一起换，否则标签高亮会停在上一页上。 */}
            {([
                ['section-background', VIS_BACKGROUND_PAGE],
                ['section-common', COMMON_PAGE],
                ['section-subtitle', VIS_SUBTITLE_PAGE],
            ] as const).map(([state, page]) => (
                <PonderSurfaceStateLayer key={state} state={state} registerStateNode={registerStateNode} replaces={VIS_PANEL_STATE}>
                    <VisPanelFrame outline={outline}>
                        <VisPanelPage page={page} marker={`data-ponder-playground-rows-${state}`} {...paint} />
                    </VisPanelFrame>
                </PonderSurfaceStateLayer>
            ))}

            {/* 指针压上去才显形：描边加一枚标签。 */}
            <PonderSurfaceStateLayer state="hotspots-visible" registerStateNode={registerStateNode}>
                <div style={relativeRectStyle(V.preview)}>
                    {hotspots.map(([marker, rect], index) => (
                        <span
                            key={marker}
                            data-ponder-playground-hotspot-shown
                            className="rounded-[4%] border"
                            style={{
                                ...relativeRectStyle(rect),
                                borderColor: index === 1 ? accent : `${accent}55`,
                                backgroundColor: index === 1 ? `${accent}14` : undefined,
                            }}
                        >
                            <span
                                className="absolute left-[3%] top-[8%] h-[24%] w-[22%] rounded-full border"
                                style={{ borderColor: index === 1 ? accent : outline, backgroundColor: 'rgba(0,0,0,0.5)' }}
                            />
                        </span>
                    ))}
                </div>
            </PonderSurfaceStateLayer>
        </div>
    );
};

export default {
    'vis-playground': PonderVisPlaygroundSurface,
} satisfies PonderSurfaceDeclarations;
