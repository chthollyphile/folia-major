import React from 'react';
import {
    Blinds,
    CircleHelp,
    Crosshair,
    DiscAlbum,
    Disc3,
    EyeOff,
    Folder,
    FoldHorizontal,
    Library,
    ListFilter,
    ListMusic,
    MicVocal,
    MonitorPlay,
    MoreHorizontal,
    PanelsTopLeft,
    Search,
    Settings,
    Settings2,
    Shuffle,
    Sparkles,
    Volume2,
    X,
} from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from './PonderSurfaceStateLayer';
import { relativeRectStyle } from './relativeRectStyle';
import {
    BRAVAIS_HOME_DOCK,
    BRAVAIS_HOME_DOCK_STAGE,
    BRAVAIS_HOME_SEAM_GEOMETRY as H,
    BRAVAIS_SEAM_WIDTHS,
    BRAVAIS_SEARCH_SEAM_GEOMETRY as S,
    BRAVAIS_TOOLS_GEOMETRY as T,
    bravaisSeamRect,
} from './ponderBravaisSeamGeometry';
import {
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

// src/components/ponder/surfaces/PonderBravaisHomeSeamSurface.tsx
// bravais 首页：墙从中间裂开一道 120px 的窄缝。从上到下是「书库」、折叠、竖排的一级页签、中段（本地 / Navidrome 的二级
// 切换、直达入口）、账户入口、工具格（搜索、设置 / 队列、⋯）。位置一律来自 ponderBravaisSeamGeometry，和
// bravaisSeam.target.ts 的锚点是同一组数。
//
// 结果层都是「整面重画、替换上一屏」：缝换档时墙的两半要跟着让位，只叠一层新缝的话旧墙还露在两边。
// 平台列表、「⋯」菜单也画进各自那一屏里，而不是叠加层 —— 叠加层在一章里打开就收不回去了。
// 右下角的墙面工具按钮在最上面单独一层，不随换屏淡出；工具面板是叠在它上面的结果层。

type PonderBravaisHomeSeamSurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

/** 一级页签的「字数」：歌单、电台、专辑、本地、Navi。 */
const TAB_GLYPHS = [2, 2, 2, 2, 4] as const;
const ONLINE_TAB = 0;
const LOCAL_TAB = 3;

type HomeSeamOptions = {
    tab: number;
    /** 本地页签：中段多一列二级切换，直达入口换成本地的两张。 */
    local?: boolean;
    stage?: boolean;
    filtering?: boolean;
    popup?: 'menu';
};

const ShortcutColumns: React.FC<{ rect: typeof H.shortcuts; counts: readonly number[]; rule: boolean; outline: string }> = ({ rect, counts, rule, outline }) => (
    <div data-ponder-bravais-shortcuts className="flex flex-col items-center" style={relativeRectStyle(rect)}>
        {rule && <span className="mb-[8%] h-px w-[34%] shrink-0" style={{ backgroundColor: outline }} />}
        <span className="flex min-h-0 flex-1 items-start justify-center gap-[16%]">
            {counts.map((count, index) => (
                <VerticalGlyphs key={index} count={count} size="8px" gap="2px" color={BRAVAIS_SEAM_INK} opacity={0.55} />
            ))}
        </span>
    </div>
);

const HomeSeam: React.FC<{ colors: BravaisSeamColors; options: HomeSeamOptions }> = ({ colors, options }) => {
    const { accent, line, outline } = colors;
    const dock = options.stage ? BRAVAIS_HOME_DOCK_STAGE : BRAVAIS_HOME_DOCK;
    const shortcutsRect = options.stage || options.filtering ? H.shortcutsFiltering : H.shortcuts;
    return (
        <SeamPaper rect={bravaisSeamRect('home')} outline={outline} marker="data-ponder-bravais-home-seam">
            <span className="flex justify-center" style={relativeRectStyle(H.title)}>
                <HorizontalGlyphs count={2} height="70%" color={BRAVAIS_SEAM_INK} opacity={0.95} />
            </span>
            <SeamIcon rect={H.fold} icon={FoldHorizontal} marker="data-ponder-bravais-fold" />

            <div data-ponder-bravais-tabs style={relativeRectStyle(H.tabs)} />
            {H.tab.map((rect, index) => {
                const active = index === options.tab;
                return (
                    <span
                        key={index}
                        data-ponder-bravais-tab={index}
                        data-active={active || undefined}
                        className="flex items-center justify-center rounded-[10px]"
                        style={{ ...relativeRectStyle(rect), backgroundColor: active ? 'rgba(255,255,255,0.13)' : undefined }}
                    >
                        <VerticalGlyphs count={TAB_GLYPHS[index]} size={index === 4 ? '8px' : '13px'} gap="2px" color={BRAVAIS_SEAM_INK} opacity={active ? 1 : 0.5} />
                    </span>
                );
            })}

            {options.local && (
                <div data-ponder-bravais-sections className="flex flex-col items-center gap-[6%]" style={relativeRectStyle(H.sections)}>
                    {/* 激活项：图标 + 竖排文字，左侧一道强调色细线；其余只有图标。 */}
                    <span className="flex flex-col items-center gap-[6px] border-l-2 pl-[6px]" style={{ borderColor: accent, color: accent }}>
                        <Folder className="h-3.5 w-3.5" />
                        <VerticalGlyphs count={3} size="8px" gap="2px" color={accent} opacity={0.9} />
                    </span>
                    {[DiscAlbum, MicVocal, Library].map((Icon, index) => <Icon key={index} className="h-3.5 w-3.5 opacity-50" />)}
                </div>
            )}

            <ShortcutColumns rect={shortcutsRect} counts={options.local ? [4, 3] : [6, 2]} rule={Boolean(options.local)} outline={outline} />

            {options.filtering && (
                <div data-ponder-bravais-filter className="flex items-center gap-[6%] border-b-2 px-[4%]" style={{ ...relativeRectStyle(H.filter), borderColor: accent }}>
                    <ListFilter className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
                    <HorizontalGlyphs count={4} height="30%" color={BRAVAIS_SEAM_INK} opacity={0.95} />
                    <span className="ml-auto text-[8px] opacity-60">3</span>
                </div>
            )}

            {options.stage && (
                <span
                    data-ponder-bravais-stage-row
                    className="flex items-center justify-center gap-[10%] rounded-[10px]"
                    style={{ ...relativeRectStyle(dock.stageRow), boxShadow: `inset 0 0 0 1px ${outline}` }}
                >
                    <MonitorPlay className="h-3.5 w-3.5 opacity-80" />
                    <HorizontalGlyphs count={2} height="34%" color={BRAVAIS_SEAM_INK} opacity={0.9} />
                </span>
            )}

            <div data-ponder-bravais-account className="flex flex-col items-center justify-center gap-[8%]" style={relativeRectStyle(dock.account)}>
                <span className="flex aspect-square h-[52%] items-center justify-center rounded-full text-[8px] font-bold" style={{ backgroundColor: line }}>p</span>
                <TextBar width="62%" color={line} className="h-1" />
            </div>

            <div data-ponder-bravais-tools style={relativeRectStyle(dock.tools)} />
            <SeamIcon rect={dock.search} icon={Search} marker="data-ponder-bravais-tool-search" />
            <SeamIcon rect={dock.settings} icon={Settings} marker="data-ponder-bravais-tool-settings" />
            <SeamIcon rect={dock.queue} icon={PanelsTopLeft} marker="data-ponder-bravais-tool-queue" />
            <SeamIcon rect={dock.more} icon={MoreHorizontal} marker="data-ponder-bravais-tool-more" pressed={options.popup === 'menu'} accent={accent} outline={outline} />

            {options.popup === 'menu' && (
                <div
                    data-ponder-bravais-menu
                    className="flex flex-col justify-evenly rounded-[10px] px-[8%]"
                    style={{ ...relativeRectStyle(H.menuPopup), backgroundColor: BRAVAIS_SEAM_POPUP, boxShadow: `0 0 0 1px ${outline}, 0 10px 30px rgba(0,0,0,0.5)` }}
                >
                    {/* 本页签的项在前（过滤当前页、管理隐藏……），一道分隔线，app 级的去处在后（回到播放页）。 */}
                    {[ListFilter, EyeOff].map((Icon, index) => (
                        <span key={index} className="flex items-center gap-[8%]">
                            <Icon className="h-3 w-3 shrink-0 opacity-75" />
                            <TextBar width={index === 0 ? '62%' : '50%'} color={line} className="h-1" />
                        </span>
                    ))}
                    <span className="h-px w-full" style={{ backgroundColor: outline }} />
                    <span className="flex items-center gap-[8%]">
                        <Disc3 className="h-3 w-3 shrink-0 opacity-75" />
                        <TextBar width="56%" color={line} className="h-1" />
                    </span>
                </div>
            )}
        </SeamPaper>
    );
};

/** 搜索态：⌕ 把首页窄缝展开成完整宽度，换成带框的搜索框；和过滤的漏斗 + 下划线是两个样子。 */
const SearchSeam: React.FC<{ colors: BravaisSeamColors }> = ({ colors }) => {
    const { accent, line, outline } = colors;
    return (
        <SeamPaper rect={bravaisSeamRect('full')} outline={outline} marker="data-ponder-bravais-search-seam">
            <div className="flex items-center gap-[3%]" style={relativeRectStyle(S.crumbs)}>
                <HorizontalGlyphs count={2} height="46%" color={BRAVAIS_SEAM_INK} />
                <span className="text-[9px] opacity-50">›</span>
                <HorizontalGlyphs count={2} height="46%" color={BRAVAIS_SEAM_INK} />
                <span className="ml-auto"><TextBar width="40px" color={line} className="h-1" opacity={0.6} /></span>
            </div>
            <div data-ponder-bravais-search-box className="flex items-center gap-[4%] rounded-[10px] border px-[4%]" style={{ ...relativeRectStyle(S.box), borderColor: accent }}>
                <Search className="h-3.5 w-3.5 shrink-0 opacity-80" />
                <TextBar width="56%" color={line} className="h-1.5" />
                <X className="ml-auto h-3 w-3 shrink-0 opacity-55" />
            </div>
            <div className="flex flex-col gap-[14%]" style={relativeRectStyle(S.hint)}>
                <TextBar width="94%" color={line} className="h-1" opacity={0.55} />
                <TextBar width="70%" color={line} className="h-1" opacity={0.55} />
            </div>
            <span className="flex items-center justify-center gap-[8%] rounded-full" style={{ ...relativeRectStyle(S.submit), backgroundColor: accent }}>
                <Search className="h-3 w-3" style={{ color: 'rgba(9,9,11,0.85)' }} />
                <TextBar width="30%" color="rgba(9,9,11,0.7)" className="h-1" />
            </span>
        </SeamPaper>
    );
};

/** 一屏首页：两半墙加中间那道缝。 */
const HomeView: React.FC<{ colors: BravaisSeamColors; options: HomeSeamOptions; wall?: 'a' | 'b' }> = ({ colors, options, wall = 'a' }) => (
    <>
        <BravaisWall
            colors={colors}
            seamWidth={BRAVAIS_SEAM_WIDTHS.home}
            variant={wall}
            // 过滤中墙退化为以缝为中心的有限拼贴：离缝最近的几张还在，其余翻成墙面。
            keep={options.filtering ? { left: [0, 4], right: [0, 5] } : undefined}
        />
        <HomeSeam colors={colors} options={options} />
    </>
);

const ToolsPanel: React.FC<{ colors: BravaisSeamColors }> = ({ colors }) => {
    const { accent, line, outline } = colors;
    return (
        <div
            data-ponder-bravais-tools-panel
            className="rounded-[14px] border"
            style={{ ...relativeRectStyle(T.panel), borderColor: outline, backgroundColor: 'rgb(24,24,27)', boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}
        >
            {/* 一排纯图标的一次性动作：定位正在播放、打乱队列、生成主题、播放队列、前往 Lattice、前往播放页。 */}
            <div data-ponder-bravais-tools-quick className="grid grid-cols-6 gap-[3%]" style={relativeRectStyle(T.quick)}>
                {[Crosshair, Shuffle, Sparkles, ListMusic, PanelsTopLeft, Disc3].map((Icon, index) => (
                    <span key={index} className="flex items-center justify-center rounded-[8px]" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                        <Icon className="h-3.5 w-3.5 opacity-80" />
                    </span>
                ))}
            </div>
            {/* 音量：和播放条上的是同一份。 */}
            <div data-ponder-bravais-tools-volume className="flex items-center gap-[5%]" style={relativeRectStyle(T.volume)}>
                <Volume2 className="h-3.5 w-3.5 shrink-0 opacity-75" />
                <span className="relative h-1.5 flex-1 rounded-full" style={{ backgroundColor: line }}>
                    <span className="absolute inset-y-0 left-0 w-[64%] rounded-full" style={{ backgroundColor: accent }} />
                </span>
                <span className="text-[8px] opacity-55">64%</span>
            </div>
            {/* 墙面外观：透光（三档轮换）、叠色、开灯 / 关灯。 */}
            <div data-ponder-bravais-tools-appearance className="flex flex-col justify-between" style={relativeRectStyle(T.appearance)}>
                <TextBar width="32%" color={line} className="h-1" opacity={0.55} />
                <span className="flex items-center gap-[5%]">
                    <Blinds className="h-3.5 w-3.5 shrink-0 opacity-75" />
                    <TextBar width="34%" color={line} className="h-1.5" />
                    <span className="ml-auto rounded-full px-[4%] py-[1%] text-[8px]" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>· · ·</span>
                </span>
                <span className="flex items-center gap-[5%]">
                    <span className="h-3.5 w-3.5 shrink-0 rounded-[4px] border" style={{ borderColor: outline }} />
                    <TextBar width="40%" color={line} className="h-1.5" />
                    <span className="ml-auto h-3 w-6 rounded-full" style={{ backgroundColor: accent, opacity: 0.6 }} />
                </span>
                <span className="flex items-center justify-between rounded-full border px-[6%] py-[2%]" style={{ borderColor: outline }}>
                    <span className="text-[8px] opacity-70">ON</span>
                    <span className="text-[8px] opacity-35">OFF</span>
                </span>
            </div>
            {/* 快捷键说明在右下角。 */}
            <CircleHelp className="absolute bottom-[3%] right-[5%] h-3.5 w-3.5 opacity-50" />
        </div>
    );
};

const PonderBravaisHomeSeamSurface: React.FC<PonderBravaisHomeSeamSurfaceProps> = ({ accent, line, outline, registerStateNode }) => {
    const colors = { accent, line, outline };
    return (
        <div className="absolute inset-0 overflow-hidden" data-ponder-bravais-home-structure>
            <PonderSurfaceBase registerStateNode={registerStateNode}>
                <HomeView colors={colors} options={{ tab: ONLINE_TAB }} />
            </PonderSurfaceBase>

            {/* 换页签：整条信息条翻一次，墙整面换成本地那一页（同样的格子，换一批磁贴）。 */}
            <PonderSurfaceStateLayer state="home-local" registerStateNode={registerStateNode} replaces>
                <HomeView colors={colors} options={{ tab: LOCAL_TAB, local: true }} wall="b" />
            </PonderSurfaceStateLayer>

            <PonderSurfaceStateLayer state="menu-open" registerStateNode={registerStateNode} replaces>
                <HomeView colors={colors} options={{ tab: ONLINE_TAB, popup: 'menu' }} />
            </PonderSurfaceStateLayer>

            <PonderSurfaceStateLayer state="stage-on" registerStateNode={registerStateNode} replaces>
                <HomeView colors={colors} options={{ tab: ONLINE_TAB, stage: true }} />
            </PonderSurfaceStateLayer>

            <PonderSurfaceStateLayer state="filtering" registerStateNode={registerStateNode} replaces>
                <HomeView colors={colors} options={{ tab: ONLINE_TAB, filtering: true }} />
            </PonderSurfaceStateLayer>

            {/* 搜索态：缝展开成完整宽度，墙的两半跟着让开。 */}
            <PonderSurfaceStateLayer state="search-open" registerStateNode={registerStateNode} replaces>
                <BravaisWall colors={colors} seamWidth={BRAVAIS_SEAM_WIDTHS.full} />
                <SearchSeam colors={colors} />
            </PonderSurfaceStateLayer>

            {/* 工具按钮不随换屏淡出：它是墙上的浮层控件，和缝是哪一档无关。 */}
            <PonderSurfaceStateLayer state="tools-chrome" registerStateNode={registerStateNode} visible>
                <WallToolsButton rect={T.button} icon={Settings2} outline={outline} />
            </PonderSurfaceStateLayer>

            <PonderSurfaceStateLayer state="tools-open" registerStateNode={registerStateNode}>
                <WallToolsButton rect={T.button} icon={Settings2} outline={outline} pressed />
                <ToolsPanel colors={colors} />
            </PonderSurfaceStateLayer>
        </div>
    );
};

export default PonderBravaisHomeSeamSurface;
