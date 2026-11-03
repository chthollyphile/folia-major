import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from '../PonderSurfaceStateLayer';
import type { PonderRelativeRect } from '../../../../types/ponder';
import { LYRICS_ANIMATION_SETTINGS_GEOMETRY as L, THEME_SETTINGS_GEOMETRY as T } from './settingsSections.geometry';
import { SettingsLabelRow as LabelRow, SettingsSegments as Segments } from './ponderSettingsParts';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/settings/settingsSections.surface.tsx
// 设置 · 外观里的三组：歌词动画，主题，歌曲主题。
//
// 放同一个文件，因为它们是同一类东西 —— 设置页里的一组一张卡、卡里几行，形状简单、结构相近，
// 各拆一个文件只会多两个只有几十行的模块。
//
// 两组各自打开的那个窗口（歌词样式窗口、Theme Park）是同一个外壳：左边一块大的实时
// 预览，右边一条窄的设置栏，栏顶是一行文字标签。这不是巧合，它们本来就是同一套布局，
// 所以 FullScreenEditor 只写一遍。

type SurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

/** 一组上面那行小标题：只有字，没有图标。 */
const GroupHeading: React.FC<{ rect: PonderRelativeRect; line: string }> = ({ rect, line }) => (
    <span className="rounded-full opacity-70" style={{ ...relativeRectStyle(rect), backgroundColor: line }} />
);

/** 设置里的一行开关：左边标题加说明，右边一个 48×24 的滑块。 */
const ToggleRow: React.FC<{
    rect: PonderRelativeRect;
    line: string;
    accent: string;
    on?: boolean;
    marker: string;
}> = ({ rect, line, accent, on, marker }) => (
    <div {...{ [marker]: true }} className="flex items-center gap-[4%]" style={relativeRectStyle(rect)}>
        <span className="flex flex-1 flex-col gap-1.5">
            <span className="h-1.5 w-[44%] rounded-full" style={{ backgroundColor: line }} />
            <span className="h-1 w-[68%] rounded-full opacity-45" style={{ backgroundColor: line }} />
        </span>
        <span
            className="relative h-4 w-8 shrink-0 rounded-full"
            style={{ backgroundColor: on ? accent : line, opacity: on ? 0.75 : 1 }}
        >
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white ${on ? 'right-0.5' : 'left-0.5'}`} />
        </span>
    </div>
);

/**
 * 歌词样式窗口和 Theme Park 共用的那个外壳。
 *
 * 一条标题栏；左边那块大的是**实时预览**（歌词样式窗口在它下面还有一架样式图），
 * 右边那条窄的才是设置栏，栏顶一行文字标签。
 */
const FullScreenEditor: React.FC<{
    marker: string;
    accent: string;
    line: string;
    outline: string;
    /** 右栏顶上那行标签的个数。 */
    tabCount: number;
    activeTab: number;
    /** 预览下面有没有那一架样式图。 */
    shelf?: boolean;
    children: React.ReactNode;
}> = ({ marker, accent, line, outline, tabCount, activeTab, shelf, children }) => (
    <div
        {...{ [marker]: true }}
        className="absolute inset-[3%] flex flex-col overflow-hidden rounded-[4%] border bg-[var(--st-win)]"
        style={{ borderColor: outline }}
    >
        <div className="flex h-[11%] shrink-0 items-center gap-[2%] px-[3%]">
            <ChevronLeft className="h-[34%] w-auto shrink-0 opacity-60" />
            <span className="h-[16%] w-[14%] rounded-full" style={{ backgroundColor: line }} />
        </div>

        <div className="flex min-h-0 flex-1 gap-[3%] px-[3%] pb-[3%]">
            <div className="flex min-w-0 flex-[1.7] flex-col gap-[4%]">
                {/* 左：实时预览，右上角一颗暂停。 */}
                <div
                    data-ponder-editor-preview
                    className="relative min-h-0 flex-1 overflow-hidden rounded-[4%] border"
                    style={{ borderColor: outline, backgroundColor: 'rgba(0,0,0,0.35)' }}
                >
                    <span className="absolute right-[3%] top-[5%] aspect-square h-[9%] rounded-full" style={{ backgroundColor: line }} />
                    <span className="absolute inset-x-[10%] top-[38%] flex flex-col gap-[8%]">
                        {[78, 96, 58].map((width, index) => (
                            <span
                                key={width}
                                className="h-2 rounded-full"
                                style={{
                                    width: `${width}%`,
                                    backgroundColor: index === 1 ? accent : line,
                                    opacity: index === 1 ? 0.85 : 0.5,
                                }}
                            />
                        ))}
                    </span>
                </div>
                {shelf && (
                    <div data-ponder-editor-shelf className="flex h-[20%] shrink-0 gap-[2%]">
                        {[0, 1, 2, 3, 4, 5, 6].map(index => (
                            <span
                                key={index}
                                className="flex-1 rounded-md"
                                style={{
                                    backgroundColor: 'rgba(0,0,0,0.4)',
                                    boxShadow: `inset 0 0 0 ${index === 3 ? 2 : 1}px ${index === 3 ? accent : outline}`,
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* 右：窄的设置栏，顶上一行文字标签，选中的那个底下一道线。 */}
            <div data-ponder-editor-panel className="flex min-w-0 flex-1 flex-col gap-[4%] border-l pl-[3%]" style={{ borderColor: outline }}>
                <div className="flex h-[8%] shrink-0 items-stretch gap-[6%] border-b" style={{ borderColor: outline }}>
                    {Array.from({ length: tabCount }, (_, index) => (
                        <span
                            key={index}
                            data-ponder-editor-tab
                            className="relative flex w-[16%] items-center"
                        >
                            <span
                                className="h-[24%] w-full rounded-full"
                                style={{ backgroundColor: index === activeTab ? accent : line, opacity: index === activeTab ? 1 : 0.7 }}
                            />
                            {index === activeTab && <span className="absolute inset-x-0 -bottom-px h-px" style={{ backgroundColor: accent }} />}
                        </span>
                    ))}
                </div>
                {children}
            </div>
        </div>
    </div>
);

/**
 * 歌词动画：没有小标题的一组，卡里只有一行 —— 左边名字和一句说明，右端写着现在用的样式和一个箭头。
 * 点它打开歌词样式窗口。
 */
const PonderLyricsAnimationSettingsSurface: React.FC<SurfaceProps> = ({
    accent,
    line,
    outline,
    registerStateNode,
}) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-lyrics-animation-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <div
                data-ponder-lyrics-animation-entry
                className="flex items-center gap-[3%] rounded-xl border px-[4%]"
                style={{ ...relativeRectStyle(L.entry), borderColor: outline }}
            >
                <span className="flex flex-1 flex-col gap-1.5">
                    <span className="h-2 w-[30%] rounded-full" style={{ backgroundColor: line }} />
                    <span className="h-1 w-[52%] rounded-full opacity-45" style={{ backgroundColor: line }} />
                </span>
                <span className="h-1.5 w-[10%] shrink-0 rounded-full" style={{ backgroundColor: accent, opacity: 0.7 }} />
                <ChevronRight className="h-4 w-4 shrink-0 opacity-45" />
            </div>
        </PonderSurfaceBase>

        {/* 点那个入口打开的是歌词样式窗口：左边实时预览和样式架，右边设置栏，「歌词动画」页是所选样式自己的几项。 */}
        <PonderSurfaceStateLayer state="playground-open" registerStateNode={registerStateNode} replaces>
            <FullScreenEditor
                marker="data-ponder-lyrics-playground"
                accent={accent}
                line={line}
                outline={outline}
                tabCount={4}
                activeTab={0}
                shelf
            >
                <span className="h-1 w-[30%] shrink-0 rounded-full opacity-60" style={{ backgroundColor: line }} />
                <div className="flex flex-col gap-2 rounded-lg border p-2" style={{ borderColor: outline }}>
                    {[true, false, false].map((isToggle, index) => (
                        <span key={index} className="flex items-center gap-[6%]">
                            <span className="h-1 w-[34%] rounded-full opacity-60" style={{ backgroundColor: line }} />
                            <span className="flex-1" />
                            {isToggle
                                ? <span className="h-2.5 w-5 shrink-0 rounded-full" style={{ backgroundColor: accent, opacity: 0.75 }} />
                                : <span className="h-1 w-[40%] shrink-0 rounded-full" style={{ backgroundColor: accent, opacity: 0.6 }} />}
                        </span>
                    ))}
                </div>
            </FullScreenEditor>
        </PonderSurfaceStateLayer>
    </div>
);

/**
 * 「主题」和「歌曲主题」两组。
 *
 * 主题：明暗模式三段、配色主题预设两段、打开 Theme Park 一行。
 * 歌曲主题：主题自动切换、它管着的自动生成（缩进一级）、主题生成来源两段、优先使用自定义主题。
 */
const PonderThemeSettingsSurface: React.FC<SurfaceProps> = ({
    accent,
    line,
    outline,
    registerStateNode,
}) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-theme-settings-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <GroupHeading rect={T.headingTheme} line={line} />
            <div className="rounded-xl border" style={{ ...relativeRectStyle(T.cardTheme), borderColor: outline }} />
            <LabelRow marker="data-ponder-theme-brightness" rect={T.brightness} line={line}>
                <Segments count={3} active={1} className="h-[62%] w-[44%]" line={line} outline={outline} accent={accent} />
            </LabelRow>
            {/* 预设那两段按尺寸表单独摆：教程要一段一段指着讲。 */}
            <LabelRow rect={T.presetRow} line={line} />
            <span className="rounded-lg" style={{ ...relativeRectStyle(T.presetTrack), backgroundColor: line }} />
            {([
                ['data-ponder-theme-default', T.presetDefault, true],
                ['data-ponder-theme-custom', T.presetCustom, false],
            ] as const).map(([marker, rect, selected]) => (
                <span
                    key={marker}
                    {...{ [marker]: true }}
                    className="flex items-center justify-center rounded-md"
                    style={{ ...relativeRectStyle(rect), backgroundColor: selected ? `${accent}33` : undefined }}
                >
                    <span className="h-1 w-[52%] rounded-full" style={{ backgroundColor: selected ? accent : outline }} />
                </span>
            ))}
            <LabelRow marker="data-ponder-theme-park" rect={T.themePark} line={line}>
                <ChevronRight className="h-3 w-3 shrink-0 opacity-45" />
            </LabelRow>

            <GroupHeading rect={T.headingSong} line={line} />
            <div className="rounded-xl border" style={{ ...relativeRectStyle(T.cardSong), borderColor: outline }} />
            <ToggleRow marker="data-ponder-theme-auto-switch" rect={T.autoSwitch} line={line} accent={accent} on />
            <ToggleRow marker="data-ponder-theme-auto-generate" rect={T.autoGenerate} line={line} accent={accent} />
            <LabelRow marker="data-ponder-theme-source" rect={T.source} line={line}>
                <Segments count={2} active={0} className="h-[62%] w-[34%]" line={line} outline={outline} accent={accent} />
            </LabelRow>
            <ToggleRow marker="data-ponder-theme-prefer-custom" rect={T.preferCustom} line={line} accent={accent} />
        </PonderSurfaceBase>

        {/* Theme Park：配色编辑窗口 —— 左边实时预览，右边配色 / 信息 / 内容 / AI 四页。 */}
        <PonderSurfaceStateLayer state="theme-park-open" registerStateNode={registerStateNode} replaces>
            <FullScreenEditor
                marker="data-ponder-theme-park-open"
                accent={accent}
                line={line}
                outline={outline}
                tabCount={4}
                activeTab={0}
            >
                {/* 配色页：亮暗那一对，四种颜色的 2×2 格，下面是取色器。 */}
                <span className="flex h-3 shrink-0 gap-px rounded-md p-px" style={{ backgroundColor: line }}>
                    <span className="flex-1" />
                    <span className="flex-1 rounded-[5px]" style={{ backgroundColor: `${accent}55` }} />
                </span>
                <span className="grid shrink-0 grid-cols-2 gap-1">
                    {[0, 1, 2, 3].map(index => (
                        <span
                            key={index}
                            data-ponder-theme-park-swatch
                            className="flex h-4 items-center rounded-md px-1"
                            style={{ backgroundColor: line, boxShadow: index === 2 ? `inset 0 0 0 1px ${accent}` : undefined }}
                        >
                            <span className="aspect-square h-[56%] rounded-sm" style={{ backgroundColor: index === 2 ? accent : outline }} />
                        </span>
                    ))}
                </span>
                <span className="min-h-0 flex-1 rounded-lg" style={{ background: `linear-gradient(135deg, ${accent}, ${line})`, opacity: 0.55 }} />
            </FullScreenEditor>
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'lyrics-animation-settings': PonderLyricsAnimationSettingsSurface,
    'theme-settings': PonderThemeSettingsSurface,
} satisfies PonderSurfaceDeclarations;
