import React from 'react';
import {
    ArrowDownUp,
    ChevronLeft,
    FoldHorizontal,
    List,
    ListFilter,
    ListPlus,
    Maximize2,
    MoreHorizontal,
    Play,
    Settings2,
    Star,
} from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from './PonderSurfaceStateLayer';
import { relativeRectStyle } from './relativeRectStyle';
import {
    BRAVAIS_EDGE_TAB,
    BRAVAIS_PANEL_GEOMETRY as P,
    BRAVAIS_PANEL_LINKED_TILE,
    BRAVAIS_SEAM_WIDTHS,
    BRAVAIS_SPINE_GEOMETRY as SP,
    BRAVAIS_STRIP_GEOMETRY as G,
    BRAVAIS_TOOLS_GEOMETRY as T,
    bravaisSeamRect,
} from './ponderBravaisSeamGeometry';
import {
    BRAVAIS_SEAM_PAPER,
    BRAVAIS_SEAM_INK,
    BRAVAIS_SEAM_POPUP,
    BravaisWall,
    HorizontalGlyphs,
    SeamIcon,
    SeamPaper,
    TextBar,
    VerticalGlyphs,
    WallToolsButton,
    type BravaisSeamColors,
} from './ponderBravaisSeamParts';

// src/components/ponder/surfaces/PonderBravaisStripSurface.tsx
// bravais 集合 / 歌手页：墙从中间裂开 300px 的完整信息条。从上到下：‹ 与面包屑、过滤输入位、引号夹着的竖排大标题
// （整块是一个按钮，点它收成书脊）、元数据、描述、播放全部 / 加入队列 / 收藏、列表与「⋯ 更多」。
// 结果层：书脊（64px）、「⋯ 更多」展开、折叠（墙合拢、侧边一枚竖排标签）、列表面板（420px）。
// 每一屏都整面重画、替换上一屏：缝换宽度时墙的两半跟着让位，只叠一层新缝的话旧墙还露在两边。

type PonderBravaisStripSurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

/** 面包屑：书库 › 当前层。 */
const Crumbs: React.FC<{ rect: typeof G.crumbs; outline: string; panel?: boolean }> = ({ rect, outline, panel }) => (
    <div data-ponder-bravais-crumbs className="flex items-center gap-[3%]" style={relativeRectStyle(rect)}>
        <span className="flex aspect-square h-[78%] shrink-0 items-center justify-center rounded-full border" style={{ borderColor: outline }}>
            <ChevronLeft className="h-1/2 w-1/2 opacity-70" />
        </span>
        <HorizontalGlyphs count={2} height="34%" color={BRAVAIS_SEAM_INK} opacity={0.7} />
        <span className="text-[9px] opacity-45">›</span>
        <HorizontalGlyphs count={panel ? 3 : 5} height="34%" color={BRAVAIS_SEAM_INK} opacity={panel ? 0.7 : 0.95} />
        {panel && (
            <>
                <span className="text-[9px] opacity-45">›</span>
                <HorizontalGlyphs count={2} height="34%" color={BRAVAIS_SEAM_INK} opacity={0.95} />
            </>
        )}
    </div>
);

/** 当前页过滤：漏斗、一道下划线、占位「过滤当前页」。 */
const FilterLine: React.FC<{ rect: typeof G.filter; line: string; outline: string }> = ({ rect, line, outline }) => (
    <div data-ponder-bravais-strip-filter className="flex items-center gap-[4%] border-b" style={{ ...relativeRectStyle(rect), borderColor: outline }}>
        <ListFilter className="h-3 w-3 shrink-0 opacity-55" />
        <TextBar width="34%" color={line} className="h-1" opacity={0.55} />
    </div>
);

const ChromeButton: React.FC<{ icon: typeof Play; primary?: boolean; accent: string; line: string; width: string; marker?: string; style?: React.CSSProperties }> = ({
    icon: Icon,
    primary,
    accent,
    line,
    width,
    marker,
    style,
}) => (
    <span
        {...(marker ? { [marker]: true } : {})}
        className="flex items-center justify-center gap-[7%] rounded-full"
        style={{ width, backgroundColor: primary ? 'rgba(255,255,255,0.1)' : undefined, ...style }}
    >
        <Icon className="h-3 w-3 shrink-0" style={{ color: primary ? accent : undefined, opacity: primary ? 1 : 0.75 }} />
        <TextBar width="44%" color={line} className="h-1" opacity={primary ? 1 : 0.75} />
    </span>
);

const FullStrip: React.FC<{ colors: BravaisSeamColors; menu?: boolean }> = ({ colors, menu }) => {
    const { accent, line, outline } = colors;
    return (
        <SeamPaper rect={bravaisSeamRect('full')} outline={outline} marker="data-ponder-bravais-strip">
            <Crumbs rect={G.crumbs} outline={outline} />
            <FilterLine rect={G.filter} line={line} outline={outline} />

            {/* 标题区域：上下一对引号成对角，中间是竖排大标题 —— 整块是一个按钮，点它收成书脊。 */}
            <div
                data-ponder-bravais-title
                className="rounded-[12px]"
                style={{ ...relativeRectStyle(G.title), backgroundColor: 'rgba(255,255,255,0.035)' }}
            >
                <span className="absolute right-[7%] top-[3%] text-[18px] font-black leading-none opacity-60">”</span>
                <span className="absolute inset-0 flex items-center justify-center">
                    <VerticalGlyphs count={5} size="9%" gap="7px" color={BRAVAIS_SEAM_INK} opacity={1} />
                </span>
                <span className="absolute bottom-[3%] left-[7%] text-[18px] font-black leading-none opacity-60">“</span>
            </div>
            <span className="absolute inset-x-[6%] h-px" style={{ top: `${(G.meta.top - 0.012) * 100}%`, backgroundColor: outline }} />
            <span data-ponder-bravais-meta className="flex items-center" style={relativeRectStyle(G.meta)}>
                <TextBar width="100%" color={line} className="h-1" opacity={0.6} />
            </span>

            {/* 描述（歌单简介 / 专辑介绍；歌手页是头像、简介与统计）：截断几行，点一下展开。 */}
            <div data-ponder-bravais-about className="flex flex-col justify-between" style={relativeRectStyle(G.about)}>
                <TextBar width="96%" color={line} className="h-1" opacity={0.7} />
                <TextBar width="90%" color={line} className="h-1" opacity={0.7} />
                <TextBar width="94%" color={line} className="h-1" opacity={0.7} />
                <TextBar width="52%" color={line} className="h-1" opacity={0.7} />
            </div>

            <div data-ponder-bravais-actions className="flex items-stretch gap-[4%]" style={relativeRectStyle(G.actions)}>
                <ChromeButton icon={Play} primary accent={accent} line={line} width="40%" />
                <ChromeButton icon={ListPlus} accent={accent} line={line} width="36%" />
            </div>
            <span data-ponder-bravais-star className="flex items-center justify-center" style={relativeRectStyle(G.star)}>
                <Star className="h-3.5 w-3.5 opacity-75" />
            </span>

            <span data-ponder-bravais-list className="flex" style={relativeRectStyle(G.list)}>
                <ChromeButton icon={List} accent={accent} line={line} width="100%" />
            </span>
            <span data-ponder-bravais-more className="flex" style={relativeRectStyle(G.more)}>
                <ChromeButton icon={MoreHorizontal} accent={accent} line={line} width="100%"
                    style={menu ? { backgroundColor: 'rgba(255,255,255,0.1)' } : undefined} />
            </span>

            {menu && (
                <div
                    data-ponder-bravais-strip-menu
                    className="rounded-[10px]"
                    style={{ ...relativeRectStyle(G.menu), backgroundColor: BRAVAIS_SEAM_POPUP, boxShadow: `0 0 0 1px ${outline}, 0 10px 30px rgba(0,0,0,0.5)` }}
                >
                    {/* 改名、重新拉取、导出、删除（红）……一道分隔线，最后一项是「折叠信息条」。 */}
                    <div className="absolute inset-x-[8%] top-[7%] flex h-[66%] flex-col justify-evenly">
                        {[62, 70, 54].map(width => <TextBar key={width} width={`${width}%`} color={line} className="h-1" />)}
                        <TextBar width="40%" color="rgb(248,113,113)" className="h-1" />
                    </div>
                    <span className="absolute inset-x-[6%] h-px" style={{ top: '78%', backgroundColor: outline }} />
                </div>
            )}
            {menu && (
                <span data-ponder-bravais-menu-fold className="flex items-center px-[2.5%]" style={relativeRectStyle(G.menuFold)}>
                    <TextBar width="56%" color={line} className="h-1" />
                </span>
            )}
        </SeamPaper>
    );
};

/** 书脊：返回、折叠、竖排标题（点它展开回去）、计数、播放、展开。 */
const Spine: React.FC<{ colors: BravaisSeamColors }> = ({ colors }) => {
    const { outline } = colors;
    return (
        <SeamPaper rect={bravaisSeamRect('spine')} outline={outline} marker="data-ponder-bravais-spine">
            <SeamIcon rect={SP.back} icon={ChevronLeft} />
            <SeamIcon rect={SP.fold} icon={FoldHorizontal} marker="data-ponder-bravais-spine-fold" />
            <span data-ponder-bravais-spine-title className="flex justify-center" style={relativeRectStyle(SP.title)}>
                <VerticalGlyphs count={5} size="46%" gap="5px" color={BRAVAIS_SEAM_INK} opacity={1} />
            </span>
            <span className="flex justify-center" style={relativeRectStyle(SP.count)}>
                <VerticalGlyphs count={2} size="40%" gap="3px" color={BRAVAIS_SEAM_INK} opacity={0.55} />
            </span>
            <SeamIcon rect={SP.play} icon={Play} />
            <SeamIcon rect={SP.expand} icon={Maximize2} />
        </SeamPaper>
    );
};

/** 列表面板：缝加宽到 420px，横排标题、工具行、可滚动的歌曲列表、底部动作。悬停的那一行在墙上对应的磁贴亮起。 */
const ListPanel: React.FC<{ colors: BravaisSeamColors }> = ({ colors }) => {
    const { accent, line, outline } = colors;
    return (
        <SeamPaper rect={bravaisSeamRect('panel')} outline={outline} marker="data-ponder-bravais-panel">
            <Crumbs rect={P.crumbs} outline={outline} panel />
            <span className="flex items-center" style={relativeRectStyle(P.heading)}>
                <TextBar width="100%" color={line} className="h-2" />
            </span>
            <div className="flex items-center gap-[4%]" style={relativeRectStyle(P.toolbar)}>
                <span className="flex h-full flex-1 items-center gap-[3%] border-b" style={{ borderColor: outline }}>
                    <ListFilter className="h-3 w-3 opacity-55" />
                    <TextBar width="30%" color={line} className="h-1" opacity={0.55} />
                </span>
                <span className="flex h-[80%] items-center gap-[8%] rounded-full border px-[3%]" style={{ borderColor: outline }}>
                    <ArrowDownUp className="h-3 w-3 opacity-60" />
                    <TextBar width="24px" color={line} className="h-1" />
                </span>
            </div>
            <div data-ponder-bravais-panel-rows className="flex flex-col" style={relativeRectStyle(P.rows)}>
                {Array.from({ length: 8 }, (_, index) => (
                    <span
                        key={index}
                        className="flex min-h-0 flex-1 items-center gap-[4%] rounded-[8px] px-[3%]"
                        style={{ backgroundColor: index === 2 ? 'rgba(255,255,255,0.09)' : undefined, boxShadow: index === 2 ? `inset 2px 0 0 ${accent}` : undefined }}
                    >
                        <span className="w-[6%] text-[8px] opacity-45">{String(index + 1).padStart(2, '0')}</span>
                        <span className="flex flex-1 flex-col gap-[3px]">
                            <TextBar width={`${68 - (index % 3) * 12}%`} color={line} className="h-1" />
                            <TextBar width="34%" color={line} className="h-[3px]" opacity={0.5} />
                        </span>
                        <TextBar width="9%" color={line} className="h-1" opacity={0.5} />
                    </span>
                ))}
            </div>
            <div className="flex items-stretch gap-[3%]" style={relativeRectStyle(P.footer)}>
                <ChromeButton icon={Play} primary accent={accent} line={line} width="30%" />
                <ChromeButton icon={ListPlus} accent={accent} line={line} width="28%" />
                <span className="ml-auto flex aspect-square h-full items-center justify-center">
                    <FoldHorizontal className="h-3.5 w-3.5 opacity-70" />
                </span>
            </div>
        </SeamPaper>
    );
};

const PonderBravaisStripSurface: React.FC<PonderBravaisStripSurfaceProps> = ({ accent, line, outline, registerStateNode }) => {
    const colors = { accent, line, outline };
    return (
        <div className="absolute inset-0 overflow-hidden" data-ponder-bravais-strip-structure>
            <PonderSurfaceBase registerStateNode={registerStateNode}>
                <BravaisWall colors={colors} seamWidth={BRAVAIS_SEAM_WIDTHS.full} />
                <FullStrip colors={colors} />
            </PonderSurfaceBase>

            {/* 收成书脊：缝从 300px 收到 64px，两半墙跟着合拢过来。 */}
            <PonderSurfaceStateLayer state="spine" registerStateNode={registerStateNode} replaces>
                <BravaisWall colors={colors} seamWidth={BRAVAIS_SEAM_WIDTHS.spine} />
                <Spine colors={colors} />
            </PonderSurfaceStateLayer>

            {/* 在书脊上点标题，展开回完整信息条（和最开始那一屏一样）。 */}
            <PonderSurfaceStateLayer state="strip-again" registerStateNode={registerStateNode} replaces>
                <BravaisWall colors={colors} seamWidth={BRAVAIS_SEAM_WIDTHS.full} />
                <FullStrip colors={colors} />
            </PonderSurfaceStateLayer>

            <PonderSurfaceStateLayer state="strip-more" registerStateNode={registerStateNode} replaces>
                <BravaisWall colors={colors} seamWidth={BRAVAIS_SEAM_WIDTHS.full} />
                <FullStrip colors={colors} menu />
            </PonderSurfaceStateLayer>

            {/* 折叠：墙合拢成一整面，侧边留一枚竖排标签（显示层标题），点它恢复。 */}
            <PonderSurfaceStateLayer state="hidden" registerStateNode={registerStateNode} replaces>
                <BravaisWall colors={colors} seamWidth={BRAVAIS_SEAM_WIDTHS.hidden} />
                <span
                    data-ponder-bravais-edge-tab
                    className="flex items-center justify-center rounded-r-[8px]"
                    style={{ ...relativeRectStyle(BRAVAIS_EDGE_TAB), backgroundColor: BRAVAIS_SEAM_PAPER, boxShadow: `0 0 0 1px ${outline}, 0 0 18px rgba(0,0,0,0.5)` }}
                >
                    <VerticalGlyphs count={5} size="46%" gap="4px" color={BRAVAIS_SEAM_INK} opacity={0.95} />
                </span>
            </PonderSurfaceStateLayer>

            <PonderSurfaceStateLayer state="list-panel" registerStateNode={registerStateNode} replaces>
                <BravaisWall colors={colors} seamWidth={BRAVAIS_SEAM_WIDTHS.panel} linked={BRAVAIS_PANEL_LINKED_TILE} />
                <ListPanel colors={colors} />
            </PonderSurfaceStateLayer>

            <PonderSurfaceStateLayer state="tools-chrome" registerStateNode={registerStateNode} visible>
                <WallToolsButton rect={T.button} icon={Settings2} outline={outline} />
            </PonderSurfaceStateLayer>
        </div>
    );
};

export default PonderBravaisStripSurface;
