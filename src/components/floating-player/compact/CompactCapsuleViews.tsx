import React, { Suspense, lazy, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Crosshair, Music } from 'lucide-react';
import type { Theme } from '../../../types';
import type { NowPlayingToastSong, StageTrackPillMode } from '../../app/overlays/NowPlayingToast';
import type { TransitionBorderCue } from '../../app/overlays/now-playing-toast/useTransitionBorderCue';
import type { WallLocateAction } from '../../../stores/useBottomDockStore';

// src/components/floating-player/compact/CompactCapsuleViews.tsx
// 紧凑档（窗口窄于 960，progress-bar v3）的胶囊里面长什么样。只管排布，按钮、进度条、标题这些零件由
// FloatingPlayerControls 造好交进来，和宽屏胶囊用的是同一批组件。
//
// 收起：[封面][歌名 · 歌手 / 3px 进度][播放]（右端给挂上来的面板按钮或墙工具按钮留 40px）。歌曲卡片设成
// 限时显示或不显示时，左半边换成 [时间 进度条 时长]，胶囊大小不变。
// 展开：最下一行和收起时同一高度、封面和右端按钮不动，向上长出标题行（两侧切歌箭头）和进度行；
// 快捷操作是最上面一行。

/** 胶囊左端那一份歌曲卡片：App 按卡片能不能在这一页出现算好，null 就是卡片不在。 */
export type CompactCapsuleCard = {
    song: NowPlayingToastSong;
    trackKey: string;
    nextUp: NowPlayingToastSong | null;
    isNextUp: boolean;
    mode: StageTrackPillMode;
    timeoutSec: number;
    /** 点封面做什么（播放页打开歌曲卡片、首页去播放页、Lattice 定位）；墙上有定位动作时以定位为准。 */
    onActivate?: () => void;
    activateLabel?: string;
};

/** 收起时左半边显示的那首歌；null 是进度态。 */
export type CompactCapsuleInfo = {
    title: string;
    artist: string | null;
    coverUrl: string | null;
    /** 小标（“接下来播放”）；平时不挂。 */
    label: string | null;
};

/** 展开时封面旁边的字。平时是歌手 / 专辑；预告下一首时是小标 + 下一首的歌名 / 歌手（封面那时也是下一首的）。 */
export type CompactCapsuleMeta = {
    label: string | null;
    primary: string | null;
    secondary: string | null;
};

const NowPlayingToastTransitionBorder = lazy(() => import('../../app/overlays/now-playing-toast/NowPlayingToastTransitionBorder'));

/** 紧凑胶囊的圆角：收起是 56 高的胶囊，展开后是圆角卡片，两种形状用同一个半径。 */
export const COMPACT_CAPSULE_RADIUS_PX = 28;

type CompactCoverProps = {
    coverUrl: string | null;
    isDaylight: boolean;
    /** 墙上的定位动作：有就按它，封面角上画定位记号。 */
    locate: WallLocateAction | null;
    onActivate?: () => void;
    activateLabel?: string;
    /** 歌曲卡片设成不显示、但墙上要能定位时：不画封面，只画一颗定位按钮。 */
    locateOnly?: boolean;
};

/**
 * 胶囊左端的圆形封面。墙上按它定位当前歌（原来叠在墙工具按钮上方的那颗定位按钮），别处按卡片原来的动作。
 * 封面地址失效时退回音符，和宽屏卡片一样。
 */
export const CompactCover: React.FC<CompactCoverProps> = ({ coverUrl, isDaylight, locate, onActivate, activateLabel, locateOnly = false }) => {
    const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
    const [presses, setPresses] = useState(0);
    const src = coverUrl && coverUrl !== brokenUrl ? coverUrl : null;
    const action = locate ? locate.run : onActivate;
    const label = locate ? locate.title : activateLabel;
    const face = locateOnly && locate ? (
        <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-current/10">
            <Crosshair size={18} style={{ color: locate.isHere ? 'var(--text-accent)' : undefined }} />
        </span>
    ) : (
        <span className={`relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full ${isDaylight ? 'bg-zinc-200' : 'bg-zinc-800'}`}>
            {src
                ? <img key={src} src={src} alt="" aria-hidden decoding="async" draggable={false} onError={() => setBrokenUrl(src)} className="absolute inset-0 h-full w-full object-cover" />
                : <Music size={16} className={isDaylight ? 'text-black/35' : 'text-white/35'} />}
        </span>
    );
    const badge = locate && !locateOnly && (
        <span
            aria-hidden
            className={`absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full shadow ${isDaylight ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-900'}`}
        >
            <Crosshair size={11} strokeWidth={2.6} style={{ color: locate.isHere ? 'var(--text-accent)' : undefined }} />
        </span>
    );
    if (!action) {
        return <span className="relative shrink-0">{face}</span>;
    }
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            data-compact-cover={locate ? 'locate' : 'card'}
            aria-busy={locate?.isSeeking || undefined}
            onClick={event => {
                // 胶囊自己的点击是开命令面板或去播放页，封面这一下不往上冒。
                event.stopPropagation();
                setPresses(count => count + 1);
                action();
            }}
            className="relative shrink-0 rounded-full transition-transform active:scale-95"
        >
            {face}
            {locate && (locate.isSeeking
                ? <span className="locate-seeking pointer-events-none absolute inset-0 rounded-full border" style={{ borderColor: 'var(--text-accent)' }} />
                : presses > 0 && <span key={presses} className="locate-ring pointer-events-none absolute inset-0 rounded-full border" style={{ borderColor: 'var(--text-accent)' }} />)}
            {badge}
        </button>
    );
};

type CompactCollapsedViewProps = {
    info: CompactCapsuleInfo | null;
    cover: ReactNode;
    /** 进度态左端的东西（墙上卡片不显示时的定位按钮）；没有为 null。 */
    progressLeading: ReactNode | null;
    /** 左半边的进度条：信息态是 'line'（歌名下的细条），进度态是带时间的那条。 */
    renderProgress: (variant: 'line' | 'full') => ReactNode;
    playButton: ReactNode;
    hasCompanion: boolean;
    primaryColor: string;
};

/** 收起的紧凑胶囊：56 高，左半边在信息态和进度态之间交叉淡入，右半边（播放、挂件位）不动。 */
export const CompactCollapsedView: React.FC<CompactCollapsedViewProps> = ({ info, cover, progressLeading, renderProgress, playButton, hasCompanion, primaryColor }) => (
    <div className="flex h-14 w-full items-center gap-2 px-2" data-compact-capsule="rest">
        {/* compact-swap：从展开收回来时这一块淡入（bottomDock.css），不瞬间替换。 */}
        <div className="compact-swap relative h-full min-w-0 flex-1">
            <AnimatePresence initial={false}>
                {info ? (
                    <motion.div
                        key="info"
                        className="absolute inset-0 flex items-center gap-2"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
                        data-compact-left="info"
                    >
                        {cover}
                        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-1">
                            {info.label && (
                                <span className="h-[10px] text-[9px] font-semibold uppercase leading-[10px] tracking-[0.14em] opacity-60 select-none" style={{ color: primaryColor }}>
                                    {info.label}
                                </span>
                            )}
                            <div className="flex min-w-0 items-baseline gap-1.5 select-none" style={{ color: primaryColor }}>
                                <span className="max-w-[70%] shrink-0 truncate text-[13px] font-semibold leading-4">{info.title}</span>
                                {info.artist && <span className="min-w-0 truncate text-xs leading-4 opacity-60">{info.artist}</span>}
                            </div>
                            {renderProgress('line')}
                        </div>
                    </motion.div>
                ) : (
                    <motion.div
                        key="progress"
                        className={`absolute inset-0 flex items-center gap-2 pr-1 ${progressLeading ? '' : 'pl-1'}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
                        data-compact-left="progress"
                    >
                        {progressLeading}
                        {renderProgress('full')}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
        {playButton}
        {hasCompanion && (
            <>
                <span aria-hidden className="h-6 w-px shrink-0 bg-current opacity-15" style={{ color: primaryColor }} />
                {/* 挂件（面板按钮 / 墙工具按钮）浮在这 40px 上，它自己是另一个组件。 */}
                <span aria-hidden className="h-10 w-10 shrink-0" />
            </>
        )}
    </div>
);

type CompactExpandedViewProps = {
    /** 快捷操作那一行；没停够或不在播放页时为 null。 */
    quickRow: ReactNode | null;
    /** 标题行：TrackTitleNavigator（两侧切歌箭头 + 预告），和宽屏胶囊同一个。 */
    titleRow: ReactNode;
    progressRow: ReactNode;
    /** 封面；卡片不在场时为 null。 */
    cover: ReactNode | null;
    /** 封面旁边的两行字（歌手 / 专辑，预告时是下一首）；卡片不在场或没有可写的为 null。 */
    meta: CompactCapsuleMeta | null;
    primaryColor: string;
    slotPrimary: ReactNode;
    slotSecondary: ReactNode;
    playButton: ReactNode;
    hasCompanion: boolean;
};

/**
 * 展开的紧凑胶囊。最下一行和收起时那一行一模一样：左边封面，右边播放键、分隔线和挂件位，离底边的距离也一样
 * （下边距 4 + 48 高的一行，中心离底 28）。展开、收起之间封面、播放键、右端按钮都不挪不变，只有中间那一块
 * 换内容：封面旁边是歌手和专辑（歌名已经在标题行），两个槽位靠在播放键左边。和收起时一样左边是封面加字、
 * 右边是控件，中间不留空。
 */
export const CompactExpandedView: React.FC<CompactExpandedViewProps> = ({
    quickRow,
    titleRow,
    progressRow,
    cover,
    meta,
    primaryColor,
    slotPrimary,
    slotSecondary,
    playButton,
    hasCompanion,
}) => (
    <div className={`flex w-full flex-col gap-3 px-1 pb-1 ${quickRow ? 'pt-2' : 'pt-3.5'}`} data-compact-capsule="expanded">
        {/* compact-reveal：随裁切淡入、上浮（bottomDock.css）；快捷行单独长出来时只有它动。 */}
        {quickRow && (
            <div className="compact-reveal compact-reveal-quick border-b border-current/10 px-1 pb-2">
                {quickRow}
            </div>
        )}
        <div className="compact-reveal min-w-0 px-2">{titleRow}</div>
        <div className="compact-reveal min-w-0 px-3">{progressRow}</div>
        <div className="flex h-12 items-center gap-2 px-1">
            {cover}
            {/* 这一块自己是容器：窄到两行字只剩三四个字符（约 360 以下的手机）时不写字，两个槽位在封面和播放键之间匀开。 */}
            <div className="compact-swap @container min-w-0 flex-1">
                <div className="flex items-center gap-1 @max-[159px]:justify-around">
                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-1 select-none @max-[159px]:hidden" style={{ color: primaryColor }} data-compact-meta>
                        {meta?.label && (
                            <span className="h-[10px] truncate text-[9px] font-semibold uppercase leading-[10px] tracking-[0.14em] opacity-60">{meta.label}</span>
                        )}
                        {meta?.primary && <span className="truncate text-[13px] font-medium leading-4">{meta.primary}</span>}
                        {meta?.secondary && <span className="truncate text-[11px] leading-[14px] opacity-60">{meta.secondary}</span>}
                    </div>
                    {slotPrimary}
                    {slotSecondary}
                </div>
            </div>
            {playButton}
            {hasCompanion && (
                <>
                    <span aria-hidden className="h-6 w-px shrink-0 bg-current opacity-15" />
                    {/* 挂件（面板按钮 / 墙工具按钮）浮在这 40px 上，和收起时同一个位置。 */}
                    <span aria-hidden className="h-10 w-10 shrink-0" />
                </>
            )}
        </div>
    </div>
);

type CompactCapsuleBorderProps = {
    /** 胶囊本身（描边贴着它的外沿画）。 */
    targetRef: RefObject<HTMLElement | null>;
    cue: TransitionBorderCue;
    /** 胶囊此刻的形态；一变，描边先淡出，变形落定后按新尺寸淡回来。 */
    shape: string;
    isDaylight: boolean;
    theme?: Theme;
};

/** 变形动画的时长再多一点：描边等它落定再回来。 */
const SHAPE_SETTLE_MS = 320;

/**
 * automix 的“卡片描边”在紧凑档里画在胶囊外沿：胶囊左端就是卡片。只在混音时挂载；挂着时量胶囊的尺寸
 * （ResizeObserver，只在尺寸真变了时 setState），描边不卸载、不重起，进度从混音的起点接着走。
 */
export const CompactCapsuleBorder: React.FC<CompactCapsuleBorderProps> = ({ targetRef, cue, shape, isDaylight, theme }) => {
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [settled, setSettled] = useState(true);
    const firstShapeRef = useRef(shape);

    useEffect(() => {
        const element = targetRef.current;
        if (!element || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(([entry]) => {
            // 边框盒：胶囊有 1px 描边，描边要压在它外沿上。
            const [box] = entry.borderBoxSize;
            const width = box.inlineSize;
            const height = box.blockSize;
            setSize(prev => (Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5 ? prev : { width, height }));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [targetRef]);

    useEffect(() => {
        if (shape === firstShapeRef.current) return;
        firstShapeRef.current = shape;
        setSettled(false);
        const timer = window.setTimeout(() => setSettled(true), SHAPE_SETTLE_MS);
        return () => window.clearTimeout(timer);
    }, [shape]);

    if (size.width <= 0) return null;
    return (
        <div
            aria-hidden
            className="pointer-events-none absolute inset-0 transition-opacity duration-200"
            style={{ opacity: settled ? 1 : 0 }}
        >
            <Suspense fallback={null}>
                <NowPlayingToastTransitionBorder
                    cue={cue.cue}
                    startAtMs={cue.startAtMs}
                    cardWidth={size.width}
                    cardHeight={size.height}
                    cardRadius={COMPACT_CAPSULE_RADIUS_PX}
                    isDaylight={isDaylight}
                    theme={theme}
                />
            </Suspense>
        </div>
    );
};
