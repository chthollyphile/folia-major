import React from 'react';
import PonderSurfaceStateLayer, { PonderSurfaceBase } from '../PonderSurfaceStateLayer';
import { LYRIC_STYLE_GEOMETRY as L } from './lyricStyle.geometry';
import { StudioHeader } from './studioParts';
import { VIS_PLAYGROUND_GEOMETRY as V } from './visPlayground.geometry';
import { VIS_BACKGROUND_PAGE, VIS_SUBTITLE_PAGE, VisPanelFrame, VisPanelPage, VisStyleShelf, type VisPage } from './visPlayground.surface';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations, PonderSurfaceProps as SurfaceProps } from '../surfaceDeclarations';

// src/components/ponder/surfaces/studio/lyricStyle.surface.tsx
// 歌词样式那张图：歌词样式窗口的布局（设置直达打开的就是它），左边预览和样式架、右边一页设置。
//
// 左边一列和右栏是两个各自可换的槽位，而预览里又分背景和歌词两层 —— 这张图要讲的正是
// 「换歌词样式，右栏整页跟着换」和「背景、歌词各换各的」，两件事都得能只动一半。
// 结果层只能淡入，所以每个变体都是一整块左列或一整页右栏，替换对应的槽位。

/** 预览槽位和右栏槽位在登记表里的名字。变体层用 replaces 指向它们。 */
export const LYRIC_STYLE_PREVIEW_STATE = 'lyric-style-preview';
export const LYRIC_STYLE_PANEL_STATE = 'lyric-style-panel';

type BackgroundVariant = 'a' | 'b';
type StyleVariant = 'a' | 'b' | 'monet' | 'monet-bare';
type SubtitleVariant = 'translation' | 'romanization';

type PaintProps = Pick<SurfaceProps, 'accent' | 'line' | 'outline'>;

/** 两种背景：柔光色块和斜向条纹。形状差得够远，换了一眼就看得出来。 */
const Background: React.FC<PaintProps & { variant: BackgroundVariant }> = ({ variant, accent, line }) => (
    variant === 'a' ? (
        <span
            data-ponder-lyric-style-background="a"
            className="absolute inset-0"
            style={{
                background: `radial-gradient(circle at 22% 30%, ${accent}33, transparent 42%), radial-gradient(circle at 78% 72%, ${accent}26, transparent 46%)`,
            }}
        />
    ) : (
        <span
            data-ponder-lyric-style-background="b"
            className="absolute inset-0"
            style={{ background: `repeating-linear-gradient(135deg, ${line} 0 2px, transparent 2px 22px)`, opacity: 0.55 }}
        />
    )
);

/** 通用底部副字幕。罗马音那一版换一种字形节奏，并且描出来，表示「这一条改过了」。 */
const Subtitle: React.FC<PaintProps & { variant: SubtitleVariant }> = ({ variant, accent, line, outline }) => (
    <span
        data-ponder-lyric-style-subtitle
        className="flex items-center justify-center gap-[3%] rounded-lg"
        style={{
            ...relativeRectStyle(L.subtitle),
            backgroundColor: 'rgba(0,0,0,0.35)',
            boxShadow: `inset 0 0 0 1px ${variant === 'romanization' ? accent : outline}`,
        }}
    >
        {(variant === 'translation' ? [38, 22, 30] : [14, 12, 16, 10, 14]).map((width, index) => (
            <span
                key={index}
                className="h-1 rounded-full"
                style={{ width: `${width}%`, backgroundColor: variant === 'romanization' ? accent : line, opacity: 0.7 }}
            />
        ))}
    </span>
);

/** 样式 A：居中几行，当前行高亮。 */
const LyricsA: React.FC<PaintProps> = ({ accent, line }) => (
    <span data-ponder-lyric-style-lyrics className="flex flex-col items-center justify-center gap-[10%]" style={relativeRectStyle(L.lyrics)}>
        {[64, 88, 52].map((width, index) => (
            <span
                key={width}
                className="h-2 rounded-full"
                style={{ width: `${width}%`, backgroundColor: index === 1 ? accent : line, opacity: index === 1 ? 0.9 : 0.45 }}
            />
        ))}
    </span>
);

/** 样式 B：左对齐、错落倾斜的大字块。和 A 放在一起，说明「样式」换的是整套排版。 */
const LyricsB: React.FC<PaintProps> = ({ accent, line }) => (
    <span data-ponder-lyric-style-lyrics className="flex flex-col justify-center gap-[8%]" style={relativeRectStyle(L.lyrics)}>
        {[[0, 46], [18, 62], [8, 34]].map(([indent, width], index) => (
            <span
                key={index}
                className="h-4 rounded-md"
                style={{
                    marginLeft: `${indent}%`,
                    width: `${width}%`,
                    backgroundColor: index === 1 ? accent : line,
                    opacity: index === 1 ? 0.85 : 0.4,
                    transform: `rotate(${index === 1 ? -4 : 3}deg)`,
                }}
            />
        ))}
    </span>
);

/**
 * 莫奈：左边一列歌词，右边肖像。bare 是三件可隐藏的部件都关掉之后的样子：
 * 歌曲描述、肖像上的拖拽调整按钮、肖像下的音频图案。
 */
const Monet: React.FC<PaintProps & { bare: boolean }> = ({ bare, accent, line, outline }) => (
    <>
        <span className="flex flex-col justify-center gap-[9%]" style={relativeRectStyle(L.monetRail)}>
            {[70, 92, 58, 80].map((width, index) => (
                <span
                    key={width}
                    className="h-2 rounded-full"
                    style={{ width: `${width}%`, backgroundColor: index === 1 ? accent : line, opacity: index === 1 ? 0.9 : 0.45 }}
                />
            ))}
        </span>
        <span
            data-ponder-lyric-style-monet-portrait
            className="rounded-[6%]"
            style={{ ...relativeRectStyle(L.monetPortrait), backgroundColor: accent, opacity: 0.3 }}
        />
        {!bare && (
            <>
                <span
                    data-ponder-lyric-style-monet-description
                    className="flex flex-col justify-center gap-[14%] rounded-lg px-[3%]"
                    style={{ ...relativeRectStyle(L.monetDescription), boxShadow: `inset 0 0 0 1px ${outline}` }}
                >
                    {[90, 72].map(width => (
                        <span key={width} className="h-1 rounded-full opacity-50" style={{ width: `${width}%`, backgroundColor: line }} />
                    ))}
                </span>
                <span
                    data-ponder-lyric-style-monet-hanger
                    className="rounded-full"
                    style={{ ...relativeRectStyle(L.monetHanger), boxShadow: `inset 0 0 0 1px ${outline}`, backgroundColor: 'rgba(0,0,0,0.55)' }}
                />
                <span
                    data-ponder-lyric-style-monet-audio
                    className="flex items-end justify-between px-[4%] pb-[2%]"
                    style={relativeRectStyle(L.monetAudio)}
                >
                    {[40, 75, 55, 90, 35, 65, 80, 45, 60, 30].map((height, index) => (
                        <span key={index} className="w-[6%] rounded-sm" style={{ height: `${height}%`, backgroundColor: accent, opacity: 0.6 }} />
                    ))}
                </span>
            </>
        )}
    </>
);

/** 样式架上各样式是第几张。莫奈在第二排。 */
const SHELF_INDEX: Record<StyleVariant, number> = { a: 3, b: 4, monet: 9, 'monet-bare': 9 };

/** 左边一整列：预览里背景一层、歌词一层，自己排版的样式（莫奈）不带通用副字幕；下面样式架上描着当前这一张。 */
const Preview: React.FC<PaintProps & {
    background: BackgroundVariant;
    style: StyleVariant;
    subtitle?: SubtitleVariant;
    marker?: string;
}> = ({ background, style, subtitle = 'translation', marker, ...paint }) => {
    const isMonet = style === 'monet' || style === 'monet-bare';
    return (
        <>
            <div
                {...(marker ? { [marker]: true } : {})}
                className="overflow-hidden rounded-[2.4%]"
                style={{ ...relativeRectStyle(V.preview), boxShadow: `inset 0 0 0 1px ${paint.outline}`, backgroundColor: 'rgba(0,0,0,0.35)' }}
            >
                <Background variant={background} {...paint} />
                {style === 'a' && <LyricsA {...paint} />}
                {style === 'b' && <LyricsB {...paint} />}
                {isMonet && <Monet bare={style === 'monet-bare'} {...paint} />}
                {!isMonet && <Subtitle variant={subtitle} {...paint} />}
            </div>
            <VisStyleShelf chosen={SHELF_INDEX[style]} {...paint} />
        </>
    );
};

/** 右栏一页。 */
const Panel: React.FC<PaintProps & { page: VisPage; marker: string; frameMarker?: string }> = ({ page, marker, frameMarker, ...paint }) => (
    <VisPanelFrame outline={paint.outline} marker={frameMarker}>
        <VisPanelPage page={page} marker={marker} {...paint} />
    </VisPanelFrame>
);

/** 样式 A 自己的那几项（「歌词动画」页）。 */
const STYLE_A_PAGE: VisPage = {
    tab: 0,
    groups: [{ heading: true, rows: [{ kind: 'toggle', on: true }, { kind: 'segmented' }, { kind: 'slider' }, { kind: 'slider' }] }],
};

/** 样式 B：同一页，下面是完全不同的一组。 */
const STYLE_B_PAGE: VisPage = {
    tab: 0,
    groups: [{ heading: true, rows: [{ kind: 'slider' }, { kind: 'toggle' }, { kind: 'select' }, { kind: 'slider' }, { kind: 'toggle', on: true }] }],
};

/**
 * 莫奈，按真实的三组：歌词（字体缩放、关键词着色、显示歌曲描述）、肖像（肖像来源、肖像样式、
 * 拖拽调整按钮）、音频（显示音频图案、频谱样式）。要讲的三个开关在第三、第六、第七行。
 */
const monetPage = (on: boolean): VisPage => ({
    tab: 0,
    groups: [
        {
            heading: true,
            rows: [
                { kind: 'slider' },
                { kind: 'toggle', on: true },
                { kind: 'toggle', on, marker: 'data-ponder-lyric-style-monet-toggle' },
            ],
        },
        {
            heading: true,
            rows: [
                { kind: 'segmented' },
                { kind: 'tiles' },
                { kind: 'toggle', on, marker: 'data-ponder-lyric-style-monet-toggle' },
            ],
        },
        {
            heading: true,
            rows: [
                { kind: 'toggle', on, marker: 'data-ponder-lyric-style-monet-toggle' },
                { kind: 'tiles' },
            ],
        },
    ],
});

/** 左列槽位的变体：[结果层名, 背景, 样式, 副字幕]。 */
const PREVIEW_VARIANTS = [
    ['preview-style-b', 'a', 'b', 'translation'],
    ['preview-monet', 'a', 'monet', 'translation'],
    ['preview-monet-bare', 'a', 'monet-bare', 'translation'],
    ['preview-background-b', 'b', 'a', 'translation'],
    ['preview-background-b-style-b', 'b', 'b', 'translation'],
    ['preview-romanization', 'a', 'a', 'romanization'],
] as const;

/** 右栏槽位的变体：[结果层名, 那一页]。 */
const PANEL_VARIANTS = [
    ['panel-style-b', STYLE_B_PAGE],
    ['panel-monet', monetPage(true)],
    ['panel-monet-off', monetPage(false)],
    ['panel-background', VIS_BACKGROUND_PAGE],
    ['panel-subtitle', VIS_SUBTITLE_PAGE],
] as const;

const PonderLyricStyleSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => {
    const paint = { accent, line, outline };
    return (
        <div className="absolute inset-0 overflow-hidden" data-ponder-lyric-style-structure>
            <PonderSurfaceBase registerStateNode={registerStateNode}>
                <StudioHeader rect={V.header} line={line} marker="data-ponder-lyric-style-header" />
                <PonderSurfaceStateLayer state={LYRIC_STYLE_PREVIEW_STATE} registerStateNode={registerStateNode} visible>
                    <Preview background="a" style="a" marker="data-ponder-lyric-style-preview" {...paint} />
                </PonderSurfaceStateLayer>
                {/* 基础层停在「歌词动画」那一页：从控制页的歌词样式那一行点「更多设置」，落的就是这一页。 */}
                <PonderSurfaceStateLayer state={LYRIC_STYLE_PANEL_STATE} registerStateNode={registerStateNode} visible>
                    <Panel page={STYLE_A_PAGE} marker="data-ponder-lyric-style-rows" frameMarker="data-ponder-lyric-style-panel" {...paint} />
                </PonderSurfaceStateLayer>
            </PonderSurfaceBase>

            {PREVIEW_VARIANTS.map(([state, background, style, subtitle]) => (
                <PonderSurfaceStateLayer key={state} state={state} registerStateNode={registerStateNode} replaces={LYRIC_STYLE_PREVIEW_STATE}>
                    <Preview background={background} style={style} subtitle={subtitle} {...paint} />
                </PonderSurfaceStateLayer>
            ))}

            {PANEL_VARIANTS.map(([state, page]) => (
                <PonderSurfaceStateLayer key={state} state={state} registerStateNode={registerStateNode} replaces={LYRIC_STYLE_PANEL_STATE}>
                    <Panel page={page} marker={`data-ponder-lyric-style-rows-${state}`} {...paint} />
                </PonderSurfaceStateLayer>
            ))}
        </div>
    );
};

export default {
    'lyric-style': PonderLyricStyleSurface,
} satisfies PonderSurfaceDeclarations;
