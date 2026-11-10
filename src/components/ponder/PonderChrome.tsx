import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lightbulb, Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PonderStageScreen } from '../../utils/ponder/ponderStageLayout';
import { ponderTransition } from './ponderMotion';
import { PONDER_ICON_BUTTON_CLASS, PONDER_TEXT_BUTTON_CLASS } from './ponderTheme';
import PonderChapterTimeline from './PonderChapterTimeline';
import { PONDER_QUIET_CAP, PonderKeyCombo } from './PonderKeyCap';
import type { PonderStageNodes } from './ponderStageNodes';

// src/components/ponder/PonderChrome.tsx
// 教程层的外框，三处：顶上一条标题栏（思索 + 这一课的名字，右边是退出）；画面正下方一行
// 播放控制（上一关键帧、播放/暂停、下一关键帧、按章节切开的时间线、重播），它下面是文字那一块
// （children）；最底下一行键位图例。
//
// 章节和关键帧这两套导航画在同一条时间线上：点一段换章，点一个点跳到那个关键帧。
// 键盘上 ←/→ 跳关键帧、[ ] 换章、空格暂停，图例只写这三样；Esc 画在退出按钮上。
//
// @note 以前这里有两套导航并存：屏幕上的 ◀▶ 切章节，键盘 ←/→ 跳关键帧，容易让人误解。
// 现在屏幕上那对按钮和键盘 ←/→ 是同一件事（跳关键帧）；换章只有两条路：在时间线上点一段，
// 或者按 [ ]。原版 Create 里底部箭头也是跳关键帧，这一点现在和它一致了。

type PonderChromeProps = {
    title: string;
    /** 各章的名字，按顺序。 */
    chapters: string[];
    sceneIndex: number;
    isPaused: boolean;
    /** 当前这一章每个关键帧的比例位置，0..1。 */
    ticks: number[];
    nodes: PonderStageNodes;
    /** 画面那块屏：播放控制和文字排在它正下方，和它同宽。 */
    screen: PonderStageScreen;
    calm: boolean;
    onSelectChapter: (index: number) => void;
    onTogglePlay: () => void;
    onRestart: () => void;
    onSeekToTick: (index: number) => void;
    /** 屏幕上的 ←/→：触屏没有方向键，时间线上的点又小，得有一对按得准的按钮。 */
    onPrevKeyframe: () => void;
    onNextKeyframe: () => void;
    onExit: () => void;
    /** 文字那一块：章节行和字幕。 */
    children: React.ReactNode;
};

/**
 * 最底下那行图例。键和它的说明成对出现，顺序按「播放时最先要用到的」排。
 *
 * 写在组件外面是因为它是一张固定的表，不随任何 props 变；也免得每次渲染重建一遍数组。
 */
const LEGEND = [
    { combo: '← →', labelKey: 'ponder.legend.keyframe' },
    { combo: '[ ]', labelKey: 'ponder.legend.chapter' },
    { combo: 'Space', labelKey: 'ponder.legend.pause' },
];

const PonderChrome: React.FC<PonderChromeProps> = ({
    title,
    chapters,
    sceneIndex,
    isPaused,
    ticks,
    nodes,
    screen,
    calm,
    onSelectChapter,
    onTogglePlay,
    onRestart,
    onSeekToTick,
    onPrevKeyframe,
    onNextKeyframe,
    onExit,
    children,
}) => {
    const { t } = useTranslation();
    const PlayIcon = isPaused ? Play : Pause;

    return (
        <>
            <div className="absolute left-6 right-5 top-0 flex h-[60px] items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2 text-sm text-[color:var(--st-t2)]">
                    <Lightbulb size={16} className="shrink-0" />
                    <span className="shrink-0">{t('ponder.title')}</span>
                    <b className="truncate font-semibold text-[color:var(--st-t1)]">{title}</b>
                </div>
                {/* 触屏没有 Esc，所以它是一颗看得出能点的按钮，键帽只是顺带说明。 */}
                <button type="button" data-testid="ponder-exit" onClick={onExit} className={PONDER_TEXT_BUTTON_CLASS}>
                    <PonderKeyCombo combo="Esc" {...PONDER_QUIET_CAP} />
                    {t('ponder.legend.exit')}
                </button>
            </div>

            <div
                className="pd-rise-in absolute"
                style={{ left: screen.left, top: screen.top + screen.height + 8, width: screen.width }}
            >
                <div className="flex h-10 items-center gap-3.5">
                    <div className="-ml-2 flex flex-none items-center gap-1.5">
                        <button
                            type="button"
                            data-testid="ponder-prev-keyframe"
                            onClick={onPrevKeyframe}
                            disabled={ticks.length === 0}
                            className={PONDER_ICON_BUTTON_CLASS}
                            aria-label={t('ponder.prevKeyframe')}
                        >
                            <SkipBack size={16} />
                        </button>
                        <button
                            type="button"
                            onClick={onTogglePlay}
                            className="pd-t-quick grid h-9 w-9 place-items-center rounded-full bg-[var(--st-accent)] text-[color:var(--st-on-accent)] transition-transform active:scale-95"
                            aria-label={t('ponder.playPause')}
                        >
                            {/* 两个图标叠在一处交替，按钮不跟着变宽。 */}
                            <AnimatePresence initial={false}>
                                <motion.span
                                    key={isPaused ? 'play' : 'pause'}
                                    initial={{ opacity: 0, scale: calm ? 1 : 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: calm ? 1 : 0.8 }}
                                    transition={ponderTransition('quick', calm)}
                                    className="grid [grid-area:1/1]"
                                >
                                    <PlayIcon size={16} fill="currentColor" />
                                </motion.span>
                            </AnimatePresence>
                        </button>
                        <button
                            type="button"
                            data-testid="ponder-next-keyframe"
                            onClick={onNextKeyframe}
                            disabled={ticks.length === 0}
                            className={PONDER_ICON_BUTTON_CLASS}
                            aria-label={t('ponder.nextKeyframe')}
                        >
                            <SkipForward size={16} />
                        </button>
                    </div>
                    <PonderChapterTimeline
                        chapters={chapters}
                        current={sceneIndex}
                        ticks={ticks}
                        nodes={nodes}
                        onSelectChapter={onSelectChapter}
                        onSeekToTick={onSeekToTick}
                    />
                    <button
                        type="button"
                        onClick={onRestart}
                        className={`${PONDER_ICON_BUTTON_CLASS} -mr-2 flex-none`}
                        aria-label={t('ponder.replay')}
                    >
                        <RotateCcw size={16} />
                    </button>
                </div>
                {children}
            </div>

            {/* 图例：键画成键帽，说明是说明。 */}
            <div
                data-ponder-legend
                className="pointer-events-none absolute inset-x-0 bottom-[34px] flex flex-wrap items-center justify-center gap-x-[22px] gap-y-1.5 text-[11px] text-[color:var(--st-t3)]"
            >
                {LEGEND.map(entry => (
                    <span key={entry.labelKey} className="inline-flex items-center gap-1.5">
                        <PonderKeyCombo combo={entry.combo} {...PONDER_QUIET_CAP} />
                        {t(entry.labelKey)}
                    </span>
                ))}
            </div>
        </>
    );
};

export default PonderChrome;
