import React from 'react';
import { useTranslation } from 'react-i18next';
import {
    Blinds,
    Check,
    ChevronLeft,
    Disc3,
    FoldHorizontal,
    Heart,
    Layers3,
    ListMusic,
    Maximize2,
    MoreHorizontal,
    PanelsTopLeft,
    Pause,
    Play,
    Plus,
    Radio,
    Search,
    Settings,
    Settings2,
    Shuffle,
    Sparkles,
    Volume2,
    X,
    type LucideIcon,
} from 'lucide-react';
import { relativeRectStyle } from './relativeRectStyle';
import {
    BRAVAIS_SEAM_TABS,
    BRAVAIS_TOOLS_QUICK,
    BRAVAIS_TOOLS_ROWS,
    BRAVAIS_WALL_GEOMETRY as G,
    type BravaisSlot,
    type BravaisSpecial,
    type BravaisWallItem,
} from './ponderBravaisGeometry';
import type { PonderRelativeRect } from '../../../types/ponder';

// src/components/ponder/surfaces/PonderBravaisWallParts.tsx
// bravais 墙合成界面的零件：一张磁贴（歌曲满版海报、集合叠页边、歌手双色调人像、特殊卡的强调色标签、聚焦卡）、
// 首页窄缝与集合信息条的轮廓、右下角工具按钮与工具面板。只画结构与样子，不挂真实 store；
// 位置一律来自 ponderBravaisGeometry，与 bravaisWall.target.ts 的锚点是同一组数。
// 样子照真实 bravais（直角海报、底部压暗、左上角 11px 粗体标签、强调色底的特殊标签、右下两层错开的页边）缩小着画。

export const BRAVAIS_WALL_BACKGROUND = '#0c0c10';
const SEAM_PAPER = '#16161b';
const KIND_LABEL_KEYS: Record<BravaisWallItem['kind'], string> = {
    track: 'libraryBravais.kind.track',
    playlist: 'libraryBravais.kind.playlist',
    album: 'libraryBravais.kind.album',
    artist: 'libraryBravais.kind.artist',
    folder: 'libraryBravais.kind.folder',
    feed: 'libraryBravais.kind.feed',
};
/** 首页窄缝的四个页签（歌单 / 电台 / 专辑 / 本地），文案与真实页签同一份。 */
const SEAM_TAB_KEYS = ['home.playlists', 'home.radio', 'home.albums', 'localMusic.folder'] as const;
const SPECIAL_ICONS: Record<BravaisSpecial, LucideIcon> = {
    liked: Heart,
    'personal-fm': Radio,
    'all-songs': ListMusic,
};

/**
 * 墙面底色 + 左上强调色、右下第二色两团光晕（真实墙面的样子，光晕钉在视口上）。
 * 只画 page 里的一块（rect）时，把整幅背景按 page 的尺寸摆好、只露出这一块 —— 盖在墙上的那几块
 * 「空墙面」（换页签退场、聚焦卡那一块）和底下的墙面连成一片，看不出接缝。
 */
export const pageBackgroundFor = (rect: PonderRelativeRect, accent: string): React.CSSProperties => {
    const left = rect.left ?? 0;
    const top = rect.top ?? 0;
    const width = rect.width ?? 1;
    const height = rect.height ?? 1;
    const position = (offset: number, size: number) => (size >= 1 ? 0 : (offset / (1 - size)) * 100);
    return {
        backgroundColor: BRAVAIS_WALL_BACKGROUND,
        backgroundImage: `radial-gradient(ellipse at 8% 6%, color-mix(in srgb, ${accent} 16%, transparent), transparent 46%),`
            + ' radial-gradient(ellipse at 94% 96%, rgba(124, 58, 237, 0.2), transparent 50%)',
        backgroundSize: `${100 / width}% ${100 / height}%`,
        backgroundPosition: `${position(left, width)}% ${position(top, height)}%`,
        backgroundRepeat: 'no-repeat',
    };
};

/** 墙后透出来的「可视化」：几团流动的颜色加两行歌词。窗与全透明档的磁贴透出的是它。 */
export const BravaisVisualizerBackdrop: React.FC<{ accent: string }> = ({ accent }) => (
    <div
        data-ponder-bravais-visualizer
        className="absolute inset-0"
        style={{
            background: `radial-gradient(circle at 28% 38%, color-mix(in srgb, ${accent} 70%, transparent), transparent 38%),`
                + ' radial-gradient(circle at 74% 64%, rgba(139, 92, 246, 0.85), transparent 42%),'
                + ' radial-gradient(circle at 58% 18%, rgba(45, 212, 191, 0.6), transparent 34%),'
                + ' linear-gradient(135deg, #1e1b4b, #0f172a 60%, #312e81)',
        }}
    >
        <span className="absolute left-[30%] top-[46%] h-[3%] w-[40%] rounded-full bg-white/70" />
        <span className="absolute left-[38%] top-[53%] h-[2%] w-[24%] rounded-full bg-white/40" />
    </div>
);

const coverBackground = (hue: number) => (
    `linear-gradient(145deg, hsl(${hue} 56% 48%), hsl(${(hue + 38) % 360} 48% 17%))`
);

const SHADE = 'linear-gradient(to top, rgba(0, 0, 0, 0.74), rgba(0, 0, 0, 0.18) 48%, transparent 70%)';

/** 集合的叠页边：右下两层错开的页，落在磁贴间距里，不占内容面积。 */
const STACK_EDGES = '2px 2px 0 0 #3b3b46, 2px 2px 0 1px rgba(0, 0, 0, 0.55), 4px 4px 0 0 #2a2a33';

/** 一个标签：歌曲是序号，集合是「种类 · N」，特殊集合换成强调色底 + 小图标。 */
const TileBadge: React.FC<{ item: BravaisWallItem; accent: string; dim?: boolean }> = ({ item, accent, dim }) => {
    const { t } = useTranslation();
    const special = item.special ? SPECIAL_ICONS[item.special] : null;
    const text = item.kind === 'track'
        ? item.number ?? ''
        : item.count ? `${t(KIND_LABEL_KEYS[item.kind])} · ${item.count}` : t(KIND_LABEL_KEYS[item.kind]);
    if (item.kind === 'artist') return null;
    const Icon = special;
    return (
        <span
            data-ponder-bravais-badge={item.special ? 'special' : item.kind}
            className="absolute left-[5px] top-[5px] flex items-center gap-[3px] whitespace-nowrap px-[4px] py-[1.5px] text-[7px] font-extrabold uppercase leading-none tracking-[0.12em]"
            style={{
                backgroundColor: Icon ? accent : 'rgba(0, 0, 0, 0.5)',
                color: Icon ? BRAVAIS_WALL_BACKGROUND : 'rgba(255, 255, 255, 0.82)',
                boxShadow: Icon ? '0 0 0 1px rgba(0, 0, 0, 0.45)' : undefined,
                opacity: dim ? 0.7 : 1,
            }}
        >
            {Icon ? <Icon className="h-[8px] w-[8px]" strokeWidth={2.6} /> : null}
            {text}
        </span>
    );
};

/** 标题与副标题的占位条。歌手的名字放大约 1.3 倍、没有副标题。 */
const TileTitle: React.FC<{ item: BravaisWallItem; large?: boolean }> = ({ item, large }) => {
    const portrait = item.kind === 'artist';
    const scale = large ? 2.4 : portrait ? 1.3 : 1;
    return (
        <span className="absolute inset-x-[7%] bottom-[7%] flex flex-col gap-[4%]" style={{ height: '30%', justifyContent: 'flex-end' }}>
            <span
                className="rounded-[2px] bg-white/85"
                style={{ width: `${item.titleWidth * 100}%`, height: `max(${4 * scale}px, ${5 * scale}%)` }}
            />
            {!portrait && (
                <span className="rounded-[2px] bg-white/45" style={{ width: `${item.titleWidth * 55}%`, height: `max(${2.5 * scale}px, 3%)` }} />
            )}
        </span>
    );
};

/** 歌手的人像：头 + 肩的剪影。双色调时是暗端底 + 亮端剪影，恢复原色时是封面色。 */
const Portrait: React.FC<{ hue: number; colored: boolean }> = ({ hue, colored }) => (
    <span
        data-ponder-bravais-portrait={colored ? 'color' : 'duotone'}
        className="absolute inset-0"
        style={{
            background: colored
                ? `linear-gradient(160deg, hsl(${(hue + 170) % 360} 55% 52%), hsl(${(hue + 200) % 360} 50% 22%))`
                : `linear-gradient(160deg, hsl(${hue} 22% 16%), hsl(${hue} 26% 8%))`,
        }}
    >
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet" className="absolute inset-0 h-full w-full">
            <circle cx="50" cy="40" r="17" fill={colored ? 'hsl(26 58% 72%)' : `hsl(${hue} 62% 66%)`} />
            <path d="M14 100 C 16 72, 34 62, 50 62 C 66 62, 84 72, 86 100 Z" fill={colored ? `hsl(${hue} 64% 46%)` : `hsl(${hue} 50% 52%)`} />
        </svg>
    </span>
);

export type BravaisTileProps = {
    item: BravaisWallItem;
    rect: PonderRelativeRect;
    accent: string;
    slotKey?: string;
    /** 全透明档：不画封面，只留标题排版与底部压暗（下面是透出来的可视化）。 */
    clear?: boolean;
    /** 歌手恢复原色（悬停 / 聚焦 / 正在播放）。 */
    colored?: boolean;
    /** 键盘焦点环（发丝线 + 主色环）。 */
    focused?: boolean;
    /** 不画叠页边（全透明档下页边照画，这里留给调用方决定）。 */
    flat?: boolean;
};

/** 墙上的一张磁贴。 */
export const BravaisTile: React.FC<BravaisTileProps> = ({ item, rect, accent, slotKey, clear, colored, focused, flat }) => {
    const stack = !flat && (item.kind === 'album' || item.kind === 'playlist' || item.kind === 'folder' || (item.kind === 'feed' && item.special !== 'personal-fm'));
    const shadows = [
        focused ? '0 0 0 1px rgba(0,0,0,0.62), 0 0 0 3px rgba(255,255,255,0.92), 0 0 0 4px rgba(0,0,0,0.38)' : null,
        stack && !focused ? STACK_EDGES : null,
    ].filter(Boolean).join(', ');
    return (
        <span
            data-ponder-bravais-tile={slotKey}
            data-kind={item.kind}
            data-special={item.special}
            data-focused={focused || undefined}
            className="overflow-hidden"
            style={{
                ...relativeRectStyle(rect),
                background: clear ? undefined : item.kind === 'artist' ? undefined : coverBackground(item.hue),
                boxShadow: shadows || undefined,
            }}
        >
            {!clear && item.kind === 'artist' ? <Portrait hue={item.hue} colored={Boolean(colored)} /> : null}
            <span className="absolute inset-0" style={{ background: SHADE, opacity: clear ? 0.75 : 1 }} />
            <TileBadge item={item} accent={accent} dim={clear} />
            <TileTitle item={item} />
        </span>
    );
};

/** 缝的纸：实色档是不透明的纸；透光档换成同色的半透明纸，隐约透出后面的可视化。 */
const seamFrame = (rect: PonderRelativeRect, translucent = false): React.CSSProperties => ({
    ...relativeRectStyle(rect),
    backgroundColor: translucent ? 'rgba(22, 22, 27, 0.8)' : SEAM_PAPER,
    boxShadow: '0 0 18px rgba(0, 0, 0, 0.55)',
});

/** 首页窄缝：「书库」、折叠、竖排页签、直达入口、账户、工具格。`activeTab` 是亮着的那个页签。 */
export const BravaisHomeSeam: React.FC<{ activeTab: number; accent: string; translucent?: boolean }> = ({ activeTab, accent, translucent }) => {
    const { t } = useTranslation();
    return (
        <div data-ponder-bravais-seam="home" data-active-tab={activeTab} style={seamFrame(G.seam, translucent)}>
            <span className="absolute inset-x-0 top-[3%] text-center text-[7px] font-extrabold tracking-[0.3em] text-white/85">
                {t('libraryBravais.homeTitle')}
            </span>
            <FoldHorizontal className="absolute left-1/2 top-[8.5%] h-[2.4%] w-auto -translate-x-1/2 text-white/55" />
            {BRAVAIS_SEAM_TABS.map((tab, index) => (
                <span
                    key={index}
                    data-ponder-bravais-seam-tab={index}
                    className="flex items-center justify-center overflow-hidden rounded-full text-[7px] font-bold tracking-[0.18em]"
                    style={{
                        ...relativeRectStyle(tab),
                        writingMode: 'vertical-rl',
                        backgroundColor: index === activeTab ? 'rgba(255,255,255,0.9)' : 'transparent',
                        color: index === activeTab ? BRAVAIS_WALL_BACKGROUND : 'rgba(255,255,255,0.62)',
                    }}
                >
                    {t(SEAM_TAB_KEYS[index])}
                </span>
            ))}
            {/* 直达入口：并排的两列竖排短名。 */}
            <span className="absolute inset-x-[14%] top-[64%] flex h-[10%] justify-center gap-[12%] text-[6.5px] text-white/55">
                {(['liked', 'cloud'] as const).map(kind => (
                    <span key={kind} className="max-h-full overflow-hidden whitespace-nowrap" style={{ writingMode: 'vertical-rl' }}>
                        {t(`libraryBravaisHome.special.${kind}`)}
                    </span>
                ))}
            </span>
            <span className="absolute left-1/2 top-[78%] aspect-square w-[26%] -translate-x-1/2 rounded-full border border-white/25" style={{ backgroundColor: `color-mix(in srgb, ${accent} 24%, #26262c)` }} />
            <span className="absolute left-[25%] right-[25%] top-[85%] h-[1.4%] rounded-full bg-white/60" />
            <div className="absolute inset-x-[16%] bottom-[2.5%] grid grid-cols-2 gap-y-[18%] text-white/70" style={{ height: '8%' }}>
                {[Search, Settings, PanelsTopLeft, MoreHorizontal].map((Icon, index) => (
                    <span key={index} className="flex items-center justify-center"><Icon className="h-[9px] w-[9px]" /></span>
                ))}
            </div>
        </div>
    );
};

/** 集合层的完整信息条（压窄着画）：‹ 与面包屑、过滤位、引号与竖排标题、播放全部与工具。 */
export const BravaisCollectionSeam: React.FC<{ accent: string }> = ({ accent }) => (
    <div data-ponder-bravais-seam="collection" style={seamFrame(G.seam)}>
        <span className="absolute left-[10%] top-[2.5%] flex aspect-square w-[22%] items-center justify-center rounded-full bg-white/10">
            <ChevronLeft className="h-[70%] w-[70%] text-white/75" />
        </span>
        <span className="absolute left-[38%] right-[10%] top-[4.5%] h-[1.2%] rounded-full bg-white/45" />
        <span className="absolute left-[10%] right-[10%] top-[10%] h-px bg-white/20" />
        <span className="absolute left-[10%] top-[8.2%] h-[1%] w-[44%] rounded-full bg-white/30" />
        <span className="absolute right-[12%] top-[15%] text-[9px] leading-none text-white/50">”</span>
        <span className="absolute left-[44%] top-[30%] h-[34%] w-[13%] rounded-[3px] bg-white/90" />
        <span className="absolute left-[12%] top-[78%] text-[9px] leading-none text-white/50">“</span>
        <span className="absolute left-[10%] right-[10%] top-[83%] h-px bg-white/20" />
        <span className="absolute left-[10%] top-[86%] h-[1%] w-[40%] rounded-full bg-white/45" />
        <span className="absolute left-[10%] top-[90%] flex h-[4%] w-[46%] items-center justify-center rounded-md" style={{ backgroundColor: `color-mix(in srgb, ${accent} 22%, #2a2a31)` }}>
            <Play className="h-[55%] w-auto text-white/80" fill="currentColor" />
        </span>
        <Plus className="absolute right-[12%] top-[90.6%] h-[2.8%] w-auto text-white/60" />
    </div>
);

const TOOL_BUTTON_STYLE: React.CSSProperties = {
    ...relativeRectStyle(G.tools),
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.12)',
};

/** 右下角工具按钮。打开时图标换成 ×。 */
export const BravaisToolsButton: React.FC<{ open?: boolean }> = ({ open }) => {
    const Icon = open ? X : Settings2;
    return (
        <span data-ponder-bravais-tools className="flex items-center justify-center rounded-full" style={TOOL_BUTTON_STYLE}>
            <Icon className="h-[46%] w-[46%] text-white/80" />
        </span>
    );
};

const LOOK_VALUE_KEYS = {
    solid: 'options.libraryWallLookSolid',
    partial: 'options.libraryWallLookPartial',
    clear: 'options.libraryWallLookClear',
} as const;

export type BravaisLook = keyof typeof LOOK_VALUE_KEYS;

/** 工具面板：顶上六格纯图标一次性动作、音量、「墙面外观」下的透光 / 叠色、开关灯。 */
export const BravaisToolsPanel: React.FC<{ accent: string; look: BravaisLook }> = ({ accent, look }) => {
    const { t } = useTranslation();
    const quick: LucideIcon[] = [Shuffle, Sparkles, ListMusic, PanelsTopLeft, Disc3, Settings];
    return (
        <div
            data-ponder-bravais-tools-panel={look}
            className="overflow-hidden rounded-[14px] text-white/80"
            style={{
                ...relativeRectStyle(G.toolsPanel),
                backgroundColor: 'rgba(18, 18, 23, 0.97)',
                boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.09), 0 18px 40px rgba(0, 0, 0, 0.5)',
            }}
        >
            {quick.map((Icon, index) => (
                <span
                    key={index}
                    data-ponder-bravais-quick={index}
                    className="flex items-center justify-center rounded-[6px] bg-white/[0.06]"
                    style={relativeRectStyle(BRAVAIS_TOOLS_QUICK[index])}
                >
                    <Icon className="h-[46%] w-auto" />
                </span>
            ))}
            <span className="flex items-center gap-[5%]" style={relativeRectStyle(BRAVAIS_TOOLS_ROWS.volume)}>
                <Volume2 className="h-[60%] w-auto shrink-0" />
                <span className="relative h-[16%] flex-1 rounded-full bg-white/15">
                    <span className="absolute inset-y-0 left-0 w-[62%] rounded-full" style={{ backgroundColor: accent }} />
                    <span className="absolute left-[62%] top-1/2 aspect-square h-[260%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
                </span>
            </span>
            <span className="flex items-center text-[6.5px] font-semibold uppercase tracking-[0.14em] text-white/45" style={relativeRectStyle(BRAVAIS_TOOLS_ROWS.heading)}>
                {t('libraryBravais.toolsAppearance')}
            </span>
            <span
                data-ponder-bravais-look-row={look}
                className="flex items-center gap-[5%] rounded-[8px] bg-white/[0.06] px-[4%] text-[8px]"
                style={relativeRectStyle(BRAVAIS_TOOLS_ROWS.look)}
            >
                <Blinds className="h-[48%] w-auto shrink-0" />
                <span className="flex-1 truncate">{t('options.libraryWallLook')}</span>
                <span className="font-semibold" style={{ color: accent }}>{t(LOOK_VALUE_KEYS[look])}</span>
            </span>
            <span className="flex items-center gap-[5%] px-[4%] text-[8px]" style={relativeRectStyle(BRAVAIS_TOOLS_ROWS.tint)}>
                <Layers3 className="h-[48%] w-auto shrink-0" />
                <span className="flex-1 truncate">{t('options.latticePosterTint')}</span>
                <span className="h-[46%] w-[16%] rounded-full bg-white/20" />
            </span>
            <span className="flex items-center gap-[4%]" style={relativeRectStyle(BRAVAIS_TOOLS_ROWS.lights)}>
                <span className="flex h-full flex-1 items-center rounded-full bg-white/[0.06] p-[1.5%] text-[7px]">
                    <span className="flex h-full flex-1 items-center justify-center rounded-full bg-white/85 text-zinc-900">{t('home.latticeLightsOn')}</span>
                    <span className="flex h-full flex-1 items-center justify-center text-white/55">{t('home.latticeLightsOff')}</span>
                </span>
            </span>
        </div>
    );
};

/** 聚焦卡（6×6 就地展开的歌）：大标题、歌手 · 专辑 · 时长、底部按钮排。 */
export const BravaisFocusCard: React.FC<{
    item: BravaisWallItem;
    accent: string;
    state: 'open' | 'queued' | 'playing';
}> = ({ item, accent, state }) => {
    const { t } = useTranslation();
    const playing = state === 'playing';
    const queued = state !== 'open';
    const QueueIcon = queued ? Check : Plus;
    return (
        <span
            data-ponder-bravais-focus-card={state}
            className="overflow-hidden"
            style={{
                ...relativeRectStyle(G.focusCard),
                background: coverBackground(item.hue),
                boxShadow: playing
                    ? `inset 0 0 0 2px ${accent}, inset 0 0 26px -6px ${accent}, 0 22px 60px rgba(0,0,0,0.6)`
                    : '0 22px 60px rgba(0, 0, 0, 0.6)',
            }}
        >
            <span className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.82), transparent 62%), linear-gradient(to right, rgba(0,0,0,0.35), transparent 60%)' }} />
            <TileBadge item={item} accent={accent} />
            {/* 大标题（真实的是 clamp(48px, 6vw, 82px) 的粗体字）：两行粗条。 */}
            <span className="absolute left-[6%] top-[50%] h-[6.5%] w-[58%] rounded-[3px] bg-white/90" />
            <span className="absolute left-[6%] top-[59%] h-[6.5%] w-[34%] rounded-[3px] bg-white/90" />
            <span className="absolute left-[6%] top-[70%] flex h-[3.4%] w-[60%] items-center gap-[4%]">
                <span className="h-full w-[34%] rounded-full bg-white/70" />
                <span className="h-full w-[38%] rounded-full bg-white/70" />
                <span className="h-full w-[14%] rounded-full bg-white/50" />
            </span>
            <span
                data-ponder-bravais-focus-play
                className="flex items-center justify-center rounded-[6px]"
                style={{ ...relativeRectStyle(G.focusPlay), boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.28)' }}
            >
                {playing ? <Pause className="h-[46%] w-auto text-white" fill="currentColor" /> : <Play className="h-[46%] w-auto text-white" fill="currentColor" />}
            </span>
            {playing && (
                <span data-ponder-bravais-focus-enter className="flex items-center justify-center rounded-[6px]" style={relativeRectStyle(G.focusEnter)}>
                    <Maximize2 className="h-[42%] w-auto text-white/85" />
                </span>
            )}
            <span
                data-ponder-bravais-focus-queue={queued ? 'queued' : 'add'}
                className="flex items-center justify-center gap-[6%] whitespace-nowrap text-[9px] font-medium text-white/85"
                style={relativeRectStyle(playing ? { ...G.focusQueue, left: 0.3 } : G.focusQueue)}
            >
                <QueueIcon className="h-[40%] w-auto shrink-0" />
                {t(queued ? 'libraryBravais.inQueue' : 'libraryBravais.addToQueue')}
            </span>
        </span>
    );
};

/** 方便调用方按 slot 列表批量画磁贴。 */
export const BravaisTiles: React.FC<{
    slots: readonly BravaisSlot[];
    itemFor: (slot: BravaisSlot) => BravaisWallItem | null;
    accent: string;
    clear?: boolean;
    focusedKey?: string;
}> = ({ slots, itemFor, accent, clear, focusedKey }) => (
    <>
        {slots.map(slot => {
            const item = itemFor(slot);
            return item ? (
                <BravaisTile
                    key={slot.key}
                    slotKey={slot.key}
                    item={item}
                    rect={slot.rect}
                    accent={accent}
                    clear={clear}
                    focused={slot.key === focusedKey}
                />
            ) : null;
        })}
    </>
);
