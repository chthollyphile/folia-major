import React from 'react';
import {
    ArrowDownUp,
    Blend,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Crosshair,
    Disc,
    FileJson,
    FileText,
    Heart,
    Home,
    ListEnd,
    ListPlus,
    LogOut,
    Minus,
    Moon,
    PackageOpen,
    Palette,
    PanelsTopLeft,
    Play,
    Plus,
    Radio,
    Repeat,
    Search,
    Settings,
    Shuffle,
    SkipBack,
    SkipForward,
    SlidersHorizontal,
    Sparkles,
    Star,
    Sun,
    Trash2,
    Upload,
    User,
    Volume2,
} from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase } from '../PonderSurfaceStateLayer';
import {
    SIDE_PANEL_CONTROLS_PAGE as C,
    SIDE_PANEL_COVER_ACTIONS as A,
    SIDE_PANEL_FM_PAGE as F,
    SIDE_PANEL_GEOMETRY as G,
    SIDE_PANEL_QUEUE_PAGE as Q,
    SIDE_PANEL_SOURCE_PAGE as S,
    SIDE_PANEL_TAB_CELLS as T,
} from './sidePanel.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations, PonderSurfaceProps as SurfaceProps } from '../surfaceDeclarations';

// src/components/ponder/surfaces/panel/sidePanel.surface.tsx
// 右侧展开的控制面板。从上到下：这首歌、当前这一页的内容、最底下一排标签。
//
// 封面页上「这首歌」占满整块面板：大封面、歌名歌手专辑、一行动作，下面直接是标签。
// 换到别的页，它收成顶上的一行（小封面、歌名、喜欢），中间才是那一页的内容。
//
// 所以换页换的是整块：顶上那首歌的样子、内容、标签上的高亮都跟着换。只换中间一截的话，
// 画面会停在「还选着上一页」的状态。

/** 整块面板的内容在登记表里的名字：换标签页替换的是它。 */
export const SIDE_PANEL_BODY_STATE = 'panel-body';

type Paint = Pick<SurfaceProps, 'accent' | 'line' | 'outline'>;

type TabName = keyof typeof T;

/** 每一格里名字那条杠占这一格的几成。四个字的「播放列表」那一格本身就宽。 */
const TAB_NAME_FILL: Record<TabName, number> = { cover: 0.5, source: 0.5, controls: 0.5, queue: 0.66, account: 0.5 };

/**
 * 最底下那排标签：一格一个名字，选中的那格有底色。每一页都画五格（见 SIDE_PANEL_TAB_CELLS）。
 * radio 是私人 FM 打开时的那一排：第四格的名字从「播放列表」换成两个字的「电台」，位置不动。
 */
const TabDock: React.FC<Paint & { active: TabName; radio?: boolean }> = ({ active, radio, accent, line, outline }) => (
    <div data-ponder-panel-tabs className="rounded-xl" style={{ ...relativeRectStyle(G.tabs), backgroundColor: line }}>
        {(Object.keys(T) as TabName[]).map(tab => (
            <span
                key={tab}
                data-ponder-panel-tab
                data-active={tab === active || undefined}
                className="flex items-center justify-center rounded-lg"
                style={{ ...relativeRectStyle(T[tab]), backgroundColor: tab === active ? `${accent}33` : undefined }}
            >
                <span
                    className="h-[14%] rounded-full"
                    style={{
                        width: `${(radio && tab === 'queue' ? 0.33 : TAB_NAME_FILL[tab]) * 100}%`,
                        backgroundColor: tab === active ? accent : outline,
                    }}
                />
            </span>
        ))}
    </div>
);

/** 封面页那一行里的四颗图标按钮：[标记, 位置, 图标, 有没有底色]。喜欢和加入歌单是有底色的那两颗。 */
const COVER_BUTTONS = [
    ['like', A.like, Heart, true],
    ['playlist', A.addToPlaylist, Star, true],
    ['home', A.home, Home, false],
    ['settings', A.settings, Settings, false],
] as const;

/**
 * 封面页：整块面板就是这首歌 —— 大封面，歌名、歌手、专辑，下面一行动作。
 *
 * 那一行一直在，不用悬停：左边喜欢、加入歌单、写着「播放自哪里」的那一枚，右端回到首页和设置。
 */
const CoverPage: React.FC<Paint> = ({ accent, line, outline }) => (
    <>
        <div
            data-ponder-panel-cover
            className="flex items-center justify-center rounded-xl"
            style={{ ...relativeRectStyle(G.cover), backgroundColor: `${accent}66` }}
        >
            <Disc className="h-[16%] w-auto opacity-55" />
        </div>
        <div data-ponder-panel-credits className="flex flex-col justify-between" style={relativeRectStyle(G.credits)}>
            <span className="h-[30%] w-[46%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
            <span className="h-[18%] w-[30%] rounded-full" style={{ backgroundColor: accent, opacity: 0.6 }} />
            <span className="h-[18%] w-[38%] rounded-full opacity-60" style={{ backgroundColor: line }} />
        </div>
        <div data-ponder-panel-cover-actions style={relativeRectStyle(G.actions)}>
            {COVER_BUTTONS.map(([marker, rect, Icon, filled]) => (
                <span
                    key={marker}
                    {...{ [`data-ponder-panel-cover-${marker}`]: true }}
                    className="flex items-center justify-center rounded-lg"
                    style={{ ...relativeRectStyle(rect), backgroundColor: filled ? line : undefined }}
                >
                    <Icon className="h-[50%] w-auto opacity-70" />
                </span>
            ))}
            <span
                data-ponder-panel-cover-source
                className="flex items-center gap-[6%] rounded-full px-[3%]"
                style={{ ...relativeRectStyle(A.playingFrom), backgroundColor: line }}
            >
                <Crosshair className="h-[44%] w-auto shrink-0 opacity-70" />
                <span className="h-[14%] min-w-0 flex-1 rounded-full" style={{ backgroundColor: outline }} />
            </span>
        </div>
        <TabDock active="cover" accent={accent} line={line} outline={outline} />
    </>
);

/**
 * 封面页以外的一页：顶上收成一行的歌（小封面、歌名和歌手、右端一颗喜欢），一道细线，
 * 当前这一页的内容，底下那排标签。
 */
const TabPage: React.FC<Paint & { active: TabName; radio?: boolean; children: React.ReactNode }> = ({
    active, radio, children, accent, line, outline,
}) => (
    <>
        <div data-ponder-panel-header className="flex items-center gap-[3.5%]" style={relativeRectStyle(G.header)}>
            <span className="flex aspect-square h-full shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${accent}66` }}>
                <Disc className="h-[38%] w-auto opacity-55" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="h-1.5 w-[42%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
                <span className="h-1 w-[28%] rounded-full opacity-60" style={{ backgroundColor: line }} />
            </span>
            <Heart className="h-[36%] w-auto shrink-0 opacity-60" />
        </div>
        <span className="absolute inset-x-[3.3%] top-[13.2%] h-px" style={{ backgroundColor: outline }} />
        {children}
        <TabDock active={active} radio={radio} accent={accent} line={line} outline={outline} />
    </>
);

/** 几段里选一段的那种控件。active 是选中的第几段。 */
const Segments: React.FC<Paint & { count: number; active: number; className: string }> = ({ count, active, className, accent, line, outline }) => (
    <span className={`flex items-stretch gap-[1%] rounded-lg p-[1%] ${className}`} style={{ backgroundColor: line }}>
        {Array.from({ length: count }, (_, index) => (
            <span
                key={index}
                className="flex flex-1 items-center justify-center rounded-md"
                style={{ backgroundColor: index === active ? `${accent}33` : undefined }}
            >
                <span className="h-0.5 w-[46%] rounded-full" style={{ backgroundColor: index === active ? accent : outline }} />
            </span>
        ))}
    </span>
);

/**
 * 控制页，从上到下：音量一行；循环、智能过渡、音频效果器三格；歌词样式、背景类型两行（动画强度在按钮右边，其余小控件在按钮下面）；
 * 「播放页透明背景」一行开关；一道线；主题来源一行；当前主题一行。
 */
const ControlsRows: React.FC<Paint> = ({ accent, line, outline }) => (
    <>
        <div data-ponder-panel-volume className="flex items-center gap-[4%]" style={relativeRectStyle(C.volume)}>
            <Volume2 className="h-[60%] w-auto shrink-0 opacity-55" />
            <span className="relative h-[14%] min-w-0 flex-1 rounded-full" style={{ backgroundColor: outline }}>
                <span className="absolute inset-y-0 left-0 w-[64%] rounded-full" style={{ backgroundColor: accent, opacity: 0.8 }} />
            </span>
            <span className="h-[18%] w-[8%] shrink-0 rounded-full opacity-60" style={{ backgroundColor: line }} />
        </div>

        {/* 三格：图标在上，名字在下。前两格点一下就开关，第三格点开是一个窗口，所以右上角多一个箭头。 */}
        <div data-ponder-panel-sound-tiles className="grid grid-cols-3 gap-[2.4%]" style={relativeRectStyle(C.soundTiles)}>
            {[Repeat, Blend, SlidersHorizontal].map((Icon, index) => (
                <span
                    key={index}
                    data-ponder-panel-sound-tile
                    className="relative flex flex-col justify-between rounded-xl p-[9%]"
                    style={{ backgroundColor: line }}
                >
                    <Icon className="h-[30%] w-auto self-start opacity-65" />
                    <span className="h-[9%] w-[62%] rounded-full" style={{ backgroundColor: outline }} />
                    {index === 2 && <ChevronRight className="absolute right-[8%] top-[14%] h-[22%] w-auto opacity-40" />}
                </span>
            ))}
        </div>

        {/* 两行：歌词样式、背景类型。中间那颗按钮、它右边那一枚和它下面那行小控件按几何表单独摆，不走 flex —— 它们要能被锚点指住。 */}
        {([
            [C.modeRowVisualizer, C.modeName, C.modeAside, C.modeParams, ['toggle'], true],
            [C.modeRowBackground, C.modeNameBackground, null, C.modeParamsBackground, ['chip', 'toggle'], false],
        ] as const).map(([rowRect, nameRect, asideRect, paramsRect, params, isFirst]) => (
            <React.Fragment key={isFirst ? 'visualizer' : 'background'}>
                {/* 两端的箭头对着中间那颗按钮，不对着整行：整行还包着下面那行小控件。 */}
                <div data-ponder-panel-mode-row style={relativeRectStyle(rowRect)}>
                    <span className="flex h-[62%] items-center justify-between">
                        <ChevronLeft className="h-[40%] w-auto shrink-0 opacity-35" />
                        <ChevronRight className="h-[40%] w-auto shrink-0 opacity-35" />
                    </span>
                </div>
                {/*
                  一张小图、两行字（这一行是什么、现在选的是哪个），向下的小箭头紧跟着模式名。
                  左内边距按面板宽算（真实按钮的 6），小图的宽跟着高（48 × 30），两行按钮宽窄不同，小图仍然一样大、和下面那行对齐。
                */}
                <span
                    {...(isFirst ? { 'data-ponder-panel-mode-name': true } : {})}
                    className="flex items-center pl-[1.8%]"
                    style={relativeRectStyle(nameRect)}
                >
                    <span
                        className="aspect-[8/5] h-[75%] shrink-0 rounded-md"
                        style={{ backgroundColor: 'rgba(0,0,0,0.4)', boxShadow: `inset 0 0 0 1px ${outline}` }}
                    />
                    <span className="ml-2.5 flex min-w-0 flex-1 flex-col gap-1">
                        <span className="h-0.5 w-[40%] rounded-full opacity-60" style={{ backgroundColor: line }} />
                        <span className="flex items-center gap-1">
                            <span className="h-1 w-[24%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
                            <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-40" />
                        </span>
                    </span>
                </span>
                {/* 歌词样式的动画强度：一枚写字的小控件，留在按钮右边。 */}
                {asideRect && (
                    <span className="flex items-center justify-center rounded-[28%]" style={{ ...relativeRectStyle(asideRect), backgroundColor: line }}>
                        <span className="h-0.5 w-[50%] rounded-full" style={{ backgroundColor: outline }} />
                    </span>
                )}
                {/* 这个模式其余的小控件：写字的、图标的，和按钮里的小图左对齐。 */}
                <span className="flex items-stretch gap-[2.3%]" style={relativeRectStyle(paramsRect)}>
                    {params.map((kind, index) => (kind === 'chip' ? (
                        <span key={index} className="flex w-[15%] items-center justify-center rounded-[28%]" style={{ backgroundColor: line }}>
                            <span className="h-0.5 w-[50%] rounded-full" style={{ backgroundColor: outline }} />
                        </span>
                    ) : (
                        <span key={index} className="aspect-square rounded-[28%]" style={{ backgroundColor: line }} />
                    )))}
                </span>
            </React.Fragment>
        ))}

        <div data-ponder-panel-transparent className="flex items-center justify-between" style={relativeRectStyle(C.transparent)}>
            <span className="h-[18%] w-[34%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
            <span className="relative h-[72%] w-[11%] rounded-full" style={{ backgroundColor: outline }}>
                <span className="absolute left-[8%] top-1/2 aspect-square h-[70%] -translate-y-1/2 rounded-full bg-white/80" />
            </span>
        </div>
        <span className="absolute inset-x-0 top-[77.9%] h-px" style={{ backgroundColor: outline }} />

        {/* 主题来源：默认、AI 主题、自定义三段，右边一颗调色板。 */}
        <div data-ponder-panel-theme-source className="flex items-stretch gap-[3%]" style={relativeRectStyle(C.themeSource)}>
            <Segments count={3} active={0} className="min-w-0 flex-1" accent={accent} line={line} outline={outline} />
            <span className="flex aspect-square h-full shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: line }}>
                <Palette className="h-[46%] w-auto opacity-55" />
            </span>
        </div>
        {/* 当前主题的名字，生成 AI 主题，亮暗两段。 */}
        <div data-ponder-panel-current-theme className="flex items-center gap-[3%]" style={relativeRectStyle(C.themeName)}>
            <span className="h-[18%] w-[18%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
            <span className="flex-1" />
            <span className="flex h-full w-[32%] items-center justify-center gap-[6%] rounded-lg" style={{ backgroundColor: line }}>
                <Sparkles className="h-[46%] w-auto opacity-55" />
                <span className="h-[14%] w-[50%] rounded-full" style={{ backgroundColor: outline }} />
            </span>
            <span className="flex h-full w-[19%] items-stretch gap-[2%] rounded-lg p-[1%]" style={{ backgroundColor: line }}>
                <span className="flex flex-1 items-center justify-center">
                    <Sun className="h-[50%] w-auto opacity-45" />
                </span>
                <span className="flex flex-1 items-center justify-center rounded-md" style={{ backgroundColor: `${accent}33` }}>
                    <Moon className="h-[50%] w-auto" style={{ color: accent }} />
                </span>
            </span>
        </div>
    </>
);

const ControlsPage: React.FC<Paint> = paint => (
    <div data-ponder-panel-controls style={relativeRectStyle(G.body)}>
        <ControlsRows {...paint} />
    </div>
);

/**
 * 点歌词样式那一行中间那颗按钮弹出来的一格图：三列，底下一条是通往完整设置的出口。
 *
 * 这一层整块替换面板，所以它得先把控制页原样画回来 —— 那一格图是压在这一页上的一块浮层，
 * 不是一页新内容。被点开的那颗按钮留在它上方。
 */
const ModeListPage: React.FC<Paint> = ({ accent, line, outline }) => (
    <div data-ponder-panel-mode-list-page style={relativeRectStyle(G.body)}>
        <ControlsRows accent={accent} line={line} outline={outline} />
        <div
            data-ponder-panel-mode-list
            className="rounded-xl"
            style={{ ...relativeRectStyle(C.modeList), backgroundColor: 'var(--st-menu)', boxShadow: `inset 0 0 0 1px ${outline}` }}
        >
            <span className="absolute inset-x-[5%] top-[6%] grid h-[62%] grid-cols-3 grid-rows-2 gap-[5%]">
                {[0, 1, 2, 3, 4, 5].map(index => (
                    <span key={index} data-ponder-panel-mode-option className="flex flex-col gap-1">
                        <span
                            className="min-h-0 flex-1 rounded-md"
                            style={{
                                backgroundColor: 'rgba(0,0,0,0.4)',
                                boxShadow: `inset 0 0 0 ${index === 1 ? 2 : 1}px ${index === 1 ? accent : outline}`,
                            }}
                        />
                        <span className="h-0.5 w-[60%] self-center rounded-full" style={{ backgroundColor: index === 1 ? accent : outline }} />
                    </span>
                ))}
            </span>
        </div>
        {/* 底下那一条不是第七张图，是「更多设置」。 */}
        <span
            data-ponder-panel-mode-list-footer
            className="flex items-center justify-center gap-[3%] rounded-lg"
            style={{ ...relativeRectStyle(C.modeListFooter), backgroundColor: line }}
        >
            <Settings className="h-[46%] w-auto shrink-0 opacity-55" />
            <span className="h-[14%] w-[26%] rounded-full" style={{ backgroundColor: outline }} />
        </span>
    </div>
);

/**
 * 电台页：私人 FM 打开时，队列那一格整格换成它。
 *
 * 顶上那颗按钮写着现在的电台模式，点它在命令窗口里换；下面一行左端是丢弃，中间上一首
 * （灰着）、播放、下一首，右端是喜欢。
 */
const FmPage: React.FC<Paint> = ({ accent, line, outline }) => (
    <div data-ponder-panel-fm style={relativeRectStyle(G.body)}>
        <span
            data-ponder-panel-fm-mode
            className="flex items-center gap-[4%] rounded-lg px-[4%]"
            style={{ ...relativeRectStyle(F.modeChip), backgroundColor: line }}
        >
            <Radio className="h-[46%] w-auto shrink-0" style={{ color: accent }} />
            <span className="h-[14%] w-[36%] rounded-full" style={{ backgroundColor: outline }} />
            <span className="flex-1" />
            <ChevronRight className="h-[40%] w-auto shrink-0 opacity-45" />
        </span>
        <span data-ponder-panel-fm-action className="flex items-center justify-center rounded-lg" style={relativeRectStyle(F.discard)}>
            <Trash2 className="h-[50%] w-auto opacity-60" />
        </span>
        <div data-ponder-panel-fm-transport className="flex items-center justify-center gap-[12%]" style={relativeRectStyle(F.transport)}>
            <SkipBack className="h-[38%] w-auto opacity-30" />
            <span className="flex aspect-square h-full items-center justify-center rounded-full" style={{ backgroundColor: accent }}>
                <Play className="h-[40%] w-auto text-white" />
            </span>
            <SkipForward className="h-[38%] w-auto opacity-70" />
        </div>
        <span data-ponder-panel-fm-action className="flex items-center justify-center rounded-lg" style={relativeRectStyle(F.like)}>
            <Heart className="h-[50%] w-auto opacity-60" />
        </span>
    </div>
);

/**
 * 队列页：顶上一行是标题和首数，右端铺成海报墙、打乱；下面一行一首，正在播的那一行左边
 * 有一道记号。行内三个动作只在指针停着的那一行右端出现；行多了往下滚，最后一行淡下去。
 */
const QueuePage: React.FC<Paint> = ({ accent, line }) => (
    <div data-ponder-panel-queue style={relativeRectStyle(G.body)}>
        <span className="absolute left-0 top-0 flex h-[8%] w-[40%] items-center gap-[8%]">
            <span className="h-[26%] w-[50%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
            <span className="h-[22%] w-[14%] rounded-full opacity-55" style={{ backgroundColor: line }} />
        </span>
        <span data-ponder-panel-queue-lattice className="flex items-center justify-center" style={relativeRectStyle(Q.lattice)}>
            <PanelsTopLeft className="h-[56%] w-auto opacity-50" />
        </span>
        <span data-ponder-panel-queue-shuffle className="flex items-center justify-center" style={relativeRectStyle(Q.shuffle)}>
            <Shuffle className="h-[56%] w-auto opacity-50" />
        </span>
        <div className="absolute inset-x-0 bottom-0 top-[11%] flex flex-col">
            {[0, 1, 2, 3, 4, 5, 6].map(index => (
                <span
                    key={index}
                    data-ponder-panel-queue-row
                    className="relative flex min-h-0 flex-1 items-center gap-[3%] pl-[4%]"
                    style={{ opacity: index === 6 ? 0.35 : 1 }}
                >
                    {index === 1 && <span className="absolute left-0 top-[22%] h-[56%] w-[1%] rounded-full" style={{ backgroundColor: accent }} />}
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span
                            className="h-1 rounded-full"
                            style={{ width: `${48 + (index % 3) * 12}%`, backgroundColor: index === 1 ? accent : line, opacity: index === 1 ? 1 : 0.95 }}
                        />
                        <span className="h-0.5 w-[30%] rounded-full opacity-55" style={{ backgroundColor: line }} />
                    </span>
                    {index === 2 && [ListPlus, ListEnd, Trash2].map((Icon, action) => (
                        <Icon key={action} className="h-[36%] w-auto shrink-0 opacity-55" />
                    ))}
                </span>
            ))}
        </div>
    </div>
);

/**
 * 账户页：已登录的那一行（头像，角上是平台的记号；昵称；「平台 · ID」；右端退出），一道线，
 * 默认音质是一行名字加一个下拉，最下面「同步数据」登录之后才有。
 */
const AccountPage: React.FC<Paint> = ({ accent, line, outline }) => (
    <div data-ponder-panel-account className="flex flex-col" style={relativeRectStyle(G.body)}>
        <div className="flex h-[13%] shrink-0 items-center gap-[4%]">
            <span className="relative flex aspect-square h-[78%] shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${accent}66` }}>
                <User className="h-[46%] w-auto opacity-70" />
                <span className="absolute -bottom-[4%] -right-[4%] aspect-square h-[40%] rounded-full" style={{ backgroundColor: accent }} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="h-1.5 w-[36%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
                <span className="h-1 w-[52%] rounded-full opacity-55" style={{ backgroundColor: line }} />
            </span>
            <LogOut className="h-[36%] w-auto shrink-0 opacity-55" />
        </div>
        <span className="my-[3%] h-px shrink-0" style={{ backgroundColor: outline }} />
        <div className="flex h-[9%] shrink-0 items-center justify-between">
            <span className="h-[18%] w-[22%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
            <span className="flex h-[86%] w-[38%] items-center gap-[6%] rounded-lg px-[4%]" style={{ backgroundColor: line }}>
                <span className="h-[14%] min-w-0 flex-1 rounded-full" style={{ backgroundColor: outline }} />
                <ChevronDown className="h-[40%] w-auto shrink-0 opacity-50" />
            </span>
        </div>
        <span className="mt-[4%] flex h-[9%] shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: line }}>
            <span className="h-[16%] w-[24%] rounded-full" style={{ backgroundColor: outline }} />
        </span>
    </div>
);

/**
 * 来源那一页，从上到下：歌词（右端是这首歌有的几种歌词来源）；时间轴偏移（减、数值、加）；
 * 两颗写着字的按钮（在线匹配、导入 / 导出歌词）；一道线；音频增益（名字下面一行小字是这首歌
 * 自带的值，右边关闭、单曲、专辑三段）；最底下是这首歌的来历。
 */
const SourceRows: React.FC<Paint> = ({ accent, line, outline }) => (
    <>
        <div data-ponder-panel-source-lyrics className="flex items-center justify-between" style={relativeRectStyle(S.lyrics)}>
            <span className="h-[18%] w-[12%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
            <Segments count={2} active={0} className="h-[80%] w-[52%]" accent={accent} line={line} outline={outline} />
        </div>
        <div data-ponder-panel-source-offset className="flex items-center justify-between" style={relativeRectStyle(S.offset)}>
            <span className="h-[18%] w-[22%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
            <span className="flex h-[80%] w-[40%] items-center justify-between rounded-lg px-[4%]" style={{ backgroundColor: line }}>
                <Minus className="h-[40%] w-auto opacity-55" />
                <span className="h-[14%] w-[34%] rounded-full" style={{ backgroundColor: outline }} />
                <Plus className="h-[40%] w-auto opacity-55" />
            </span>
        </div>
        <span
            data-ponder-panel-source-match
            className="flex items-center justify-center gap-[6%] rounded-lg"
            style={{ ...relativeRectStyle(S.matchButton), backgroundColor: line }}
        >
            <Search className="h-[40%] w-auto opacity-60" />
            <span className="h-[14%] w-[36%] rounded-full" style={{ backgroundColor: outline }} />
        </span>
        <span
            data-ponder-panel-source-lyrics-file
            className="flex items-center justify-center gap-[6%] rounded-lg"
            style={{ ...relativeRectStyle(S.fileButton), backgroundColor: line }}
        >
            <ArrowDownUp className="h-[40%] w-auto opacity-60" />
            <span className="h-[14%] w-[48%] rounded-full" style={{ backgroundColor: outline }} />
        </span>
        <span className="absolute inset-x-0 top-[38.5%] h-px" style={{ backgroundColor: outline }} />
        <div data-ponder-panel-source-gain className="flex items-center justify-between" style={relativeRectStyle(S.gain)}>
            <span className="flex w-[40%] flex-col gap-1.5">
                <span className="h-1 w-[52%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
                <span className="h-0.5 w-full rounded-full opacity-55" style={{ backgroundColor: line }} />
            </span>
            <Segments count={3} active={1} className="h-[62%] w-[52%]" accent={accent} line={line} outline={outline} />
        </div>
        <div data-ponder-panel-source-info className="flex flex-col justify-evenly" style={relativeRectStyle(S.info)}>
            {[0, 1].map(index => (
                <span key={index} className="flex items-center justify-between">
                    <span className="h-1 w-[18%] rounded-full opacity-55" style={{ backgroundColor: line }} />
                    <span className="h-1 rounded-full" style={{ width: index === 0 ? '46%' : '30%', backgroundColor: line, opacity: 0.95 }} />
                </span>
            ))}
        </div>
    </>
);

/**
 * 歌词文件窗口：一行标题；导入一行；导出这一首两行（.fia、.lrc）；批量导出一行。
 * 真实的它是一个盖在应用上的窗口，这里画在面板里，好让「按的是这颗、出来的是它」连得上。
 */
const FileDialog: React.FC<Paint> = ({ line, outline }) => (
    <div
        data-ponder-panel-source-file-dialog
        className="flex flex-col gap-[4%] rounded-xl p-[6%]"
        style={{ ...relativeRectStyle(S.fileDialog), backgroundColor: 'var(--st-win)', boxShadow: `inset 0 0 0 1px ${outline}` }}
    >
        <span className="h-[4%] w-[40%] shrink-0 rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
        {[Upload, FileJson, FileText, PackageOpen].map((Icon, index) => (
            <span
                key={index}
                data-ponder-panel-file-row
                className="flex min-h-0 flex-1 items-center gap-[5%] rounded-lg px-[5%]"
                style={{ backgroundColor: line }}
            >
                <Icon className="h-[36%] w-auto shrink-0 opacity-60" />
                <span className="h-0.5 rounded-full" style={{ width: `${40 + index * 6}%`, backgroundColor: outline }} />
            </span>
        ))}
    </div>
);

const PonderSidePanelSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => {
    const paint = { accent, line, outline };
    const source = <div data-ponder-panel-source style={relativeRectStyle(G.body)}><SourceRows {...paint} /></div>;
    /** 换页之后的每一副面孔：[结果层名, 整块面板的内容]。 */
    const pages: Array<[string, React.ReactNode]> = [
        ['cover-tab', <CoverPage {...paint} />],
        ['source-tab', <TabPage active="source" {...paint}>{source}</TabPage>],
        ['source-tab-file-dialog', (
            <TabPage active="source" {...paint}>
                <div data-ponder-panel-source style={relativeRectStyle(G.body)}>
                    <SourceRows {...paint} />
                    <FileDialog {...paint} />
                </div>
            </TabPage>
        )],
        ['controls-tab', <TabPage active="controls" {...paint}><ControlsPage {...paint} /></TabPage>],
        ['controls-mode-list', <TabPage active="controls" {...paint}><ModeListPage {...paint} /></TabPage>],
        ['queue-tab', <TabPage active="queue" {...paint}><QueuePage {...paint} /></TabPage>],
        ['fm-tab', <TabPage active="queue" radio {...paint}><FmPage {...paint} /></TabPage>],
        ['account-tab', <TabPage active="account" {...paint}><AccountPage {...paint} /></TabPage>],
    ];

    return (
        <div className="absolute inset-0 overflow-hidden" data-ponder-side-panel-structure>
            <PonderSurfaceBase registerStateNode={registerStateNode}>
                {/* 面板打开时停在封面页。 */}
                <PonderSurfaceStateLayer state={SIDE_PANEL_BODY_STATE} registerStateNode={registerStateNode} visible>
                    <CoverPage {...paint} />
                </PonderSurfaceStateLayer>
            </PonderSurfaceBase>

            {pages.map(([state, content]) => (
                <PonderSurfaceStateLayer key={state} state={state} registerStateNode={registerStateNode} replaces={SIDE_PANEL_BODY_STATE}>
                    {content}
                </PonderSurfaceStateLayer>
            ))}
        </div>
    );
};

export default {
    'side-panel': PonderSidePanelSurface,
} satisfies PonderSurfaceDeclarations;
