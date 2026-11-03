import { useEffect, useRef, type RefObject } from 'react';
import { createTimeline, cubicBezier, type Timeline } from 'animejs';
import { readReducedMotion } from '../../stores/useMotionSettingsStore';
import { anchorPointToPx } from '../../utils/ponder/resolvePonderAnchors';
import { captionWindows, focusBeats, focusFrameBox } from '../../utils/ponder/ponderFocus';
import { keyframeIndexAt, keyframeSettleAt, nextKeyframeAt, prevKeyframeAt } from '../../utils/ponder/ponderKeyframes';
import { PONDER_HIGHLIGHT_MAX_OPACITY, type PonderRect, type PonderTimelinePlan } from '../../types/ponder';
import { PONDER_EASE, PONDER_MOTION, PONDER_RISE_PX, ponderMs, type PonderDuration } from './ponderMotion';
import { PONDER_SURFACE_BASE_STATE } from './surfaces/PonderSurfaceStateLayer';
import { seekPonderTimeline } from './ponderTimelineSeek';
import type { PonderStageNodes, PonderSurfaceStateNode } from './ponderStageNodes';

// src/components/ponder/usePonderTimeline.ts
// 把编译好的 plan 翻译成 anime.js v4 的 timeline，并提供播放控制。
//
// 这是整个功能里唯一 import animejs 的文件，且只被懒加载的 PonderStage 引用 —— animejs
// 约 38KB gz，不能进 bootstrap chunk（同 App.tsx:20-22 对 AutomixTransitionAnimation 的处理）。
//
// 进度条和当前关键帧都由 onUpdate 直接写 DOM，不经过 React：它们是每帧值。
//
// 时长和缓动只有两个来源：界面自己的那些（字幕换字、聚焦框、按键胶片出入）读 ponderMotion
// 的词汇；一个步骤要演多久（durationMs）是课程自己的，原样用。

type UsePonderTimelineParams = {
    plan: PonderTimelinePlan;
    rects: Record<string, PonderRect>;
    nodesRef: RefObject<PonderStageNodes>;
    /** 建时间线的那一刻用户是不是停着的。停着的就不自己播起来（窗口变了会重建时间线）。 */
    readPaused: () => boolean;
    /** 一段跑完时通知外面把「下一章」放出来。 */
    onComplete: () => void;
    /** 时间线回到了前面（重建、重播、跳关键帧、播完后再按播放）：这一章不再是「播完了」。 */
    onRewind: () => void;
};

export type PonderTimelineControls = {
    toggle: () => boolean;
    restart: () => void;
    isCompleted: () => boolean;
    /** 三个 seek 都会把落点那一拍播完后停住；调用方负责把 store 的 isPaused 同步成 true。 */
    seekPrevKeyframe: () => void;
    seekNextKeyframe: () => void;
    seekToTick: (index: number) => void;
};

/** 光标步骤的落点；锚点解析不出来时退回视口中心，宁可演得不准也不要飞到左上角。 */
const pointOrCenter = (
    point: Parameters<typeof anchorPointToPx>[0] | undefined,
    rects: Record<string, PonderRect>,
) => (point ? anchorPointToPx(point, rects) : null)
    ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };

export const usePonderTimeline = ({
    plan,
    rects,
    nodesRef,
    readPaused,
    onComplete,
    onRewind,
}: UsePonderTimelineParams): RefObject<PonderTimelineControls | null> => {
    const controlsRef = useRef<PonderTimelineControls | null>(null);

    useEffect(() => {
        const nodes = nodesRef.current;
        if (!nodes || plan.totalMs <= 0) {
            return;
        }

        const calm = readReducedMotion('uiMicroMotion');
        const ms = (duration: PonderDuration) => ponderMs(duration, calm);
        const arrive = calm ? 'linear' : cubicBezier(...PONDER_EASE.arrive);
        const travel = calm ? 'linear' : cubicBezier(...PONDER_EASE.travel);
        const startsPaused = readPaused();
        // 刻意不循环。无限循环既看不出「这一章讲完了」，也就无从提示还有下一章；
        // 跑完停在末帧，由 PonderStage 放出下一章卡片。
        const timeline: Timeline = createTimeline({
            defaults: { ease: arrive },
            autoplay: !startsPaused,
        });

        // 光标先摆到第一个 cursor/drag 步骤的起点，免得第一帧从左上角窜出来。
        const firstMove = plan.entries.find(entry => entry.step.kind === 'cursor' || entry.step.kind === 'drag');
        if (nodes.cursor && firstMove) {
            const step = firstMove.step;
            const origin = step.kind === 'cursor' ? pointOrCenter(step.from ?? step.to, rects)
                : step.kind === 'drag' ? pointOrCenter(step.from, rects)
                : null;
            if (origin) {
                nodes.cursor.style.transform = `translate(${origin.x}px, ${origin.y}px)`;
            }
        }

        // 每段字幕在场的那段时间：最迟在下一段开口时收声，本章最后一段留到章末。
        // 字幕都画在同一处，两段并存就是两行字叠在一起，谁也读不出来。
        const windows = captionWindows(plan);
        for (const { id, atMs, endMs, stays } of windows) {
            const node = nodes.captions.get(id);
            if (!node) continue;
            timeline.add(node, calm
                ? { opacity: [0, 1], duration: ms('enter') }
                : { opacity: [0, 1], y: [PONDER_RISE_PX, 0], duration: ms('enter') }, atMs);
            if (!stays) {
                timeline.add(node, calm
                    ? { opacity: 0, duration: ms('quick') }
                    : { opacity: 0, y: -4, duration: ms('quick') }, Math.max(atMs, endMs - ms('quick')));
            }
        }

        // 聚焦框：字幕在讲谁，框就落在谁身上。每一站的起止值都写全；往回跳时这些值能不能写到
        // DOM 上，靠的是 seekPonderTimeline 从头拨一遍。
        const frame = nodes.frame;
        if (frame) {
            for (const beat of focusBeats(windows, anchor => Boolean(rects[anchor]), ms('base'))) {
                const to = focusFrameBox(rects[beat.anchor]);
                const from = beat.from ? focusFrameBox(rects[beat.from]) : to;
                const shape = {
                    x: [from.left, to.left],
                    y: [from.top, to.top],
                    width: [`${from.width}px`, `${to.width}px`],
                    height: [`${from.height}px`, `${to.height}px`],
                    borderRadius: [`${from.radius}px`, `${to.radius}px`],
                };
                const tag = beat.from === beat.anchor ? undefined : nodes.frameTags.get(beat.anchor);
                if (beat.from === null) {
                    // 第一次出现：就地淡入，从略大一点收到位。
                    timeline.add(frame, calm
                        ? { ...shape, opacity: [0, 1], duration: ms('enter') }
                        : { ...shape, opacity: [0, 1], scale: [1.04, 1], duration: ms('enter') }, beat.atMs);
                } else if (beat.from !== beat.anchor) {
                    // 从上一个目标走过来，位置、大小、圆角一起变。
                    timeline.add(frame, { ...shape, duration: calm ? 1 : ms('move'), ease: travel }, beat.atMs);
                    const leftTag = nodes.frameTags.get(beat.from);
                    if (leftTag) timeline.add(leftTag, { opacity: [1, 0], duration: ms('quick') }, beat.atMs);
                }
                if (tag) timeline.add(tag, { opacity: [0, 1], duration: ms('base') }, beat.atMs);
                if (beat.hideAtMs !== null) {
                    timeline.add(frame, { opacity: [1, 0], duration: ms('base') }, beat.hideAtMs);
                    const shownTag = nodes.frameTags.get(beat.anchor);
                    if (shownTag) timeline.add(shownTag, { opacity: [1, 0], duration: ms('base') }, beat.hideAtMs);
                }
            }
        }

        // 每个「锚点 + 被替换的层」槽位上，当前露在最上面的是谁。叠加层（工具面板、命令面板）
        // 不进这张表，因为它们不该把底下那屏带走。
        const visibleLayers = new Map<string, PonderSurfaceStateNode>();

        for (const { step, atMs, durationMs } of plan.entries) {
            if (step.kind === 'caption') {
                // 字幕和聚焦框在上面按「在场时间」排好了。
                continue;
            } else if (step.kind === 'cursor' || step.kind === 'drag') {
                if (!nodes.cursor) continue;
                const to = pointOrCenter(step.to, rects);
                const from = step.kind === 'cursor'
                    ? (step.from ? pointOrCenter(step.from, rects) : null)
                    : pointOrCenter(step.from, rects);
                timeline.add(nodes.cursor, {
                    x: from ? [from.x, to.x] : to.x,
                    y: from ? [from.y, to.y] : to.y,
                    duration: calm ? 1 : durationMs,
                    ease: step.ease ?? travel,
                }, atMs);

                if (step.kind === 'cursor' && step.press && nodes.cursorRing) {
                    // 扩散圈说的是「这里按了一下」，关了微动效也照常演。
                    timeline.add(nodes.cursorRing, {
                        scale: [0.7, 1.6],
                        opacity: [0.9, 0],
                        duration: PONDER_MOTION.move,
                    }, atMs);
                }
            } else if (step.kind === 'keypress') {
                const node = nodes.keyChips.get(step.id);
                if (!node) continue;
                timeline.add(node, calm
                    ? { opacity: [0, 1], duration: ms('base') }
                    : { opacity: [0, 1], scale: [0.82, 1], duration: ms('base') }, atMs);
                timeline.add(node, { opacity: 0, duration: ms('quick') }, atMs + Math.max(durationMs - ms('quick'), 0));
            } else if (step.kind === 'highlight') {
                const node = nodes.highlights.get(step.anchor);
                if (!node) continue;
                // intensity 是 0..1 的「有多亮」，乘上限才落到画面 —— 直接画 1.0 会是一整块纯色。
                const [from, to] = step.intensity ?? [0, 1];
                timeline.add(node, {
                    opacity: [from * PONDER_HIGHLIGHT_MAX_OPACITY, to * PONDER_HIGHLIGHT_MAX_OPACITY],
                    duration: durationMs,
                }, atMs);
            } else if (step.kind === 'reveal') {
                // 这个框此前根本不在场。
                const box = nodes.boxes.get(step.anchor);
                if (!box) continue;
                const animation = { opacity: [0, 1], duration: calm ? 1 : durationMs };
                if (step.transition === 'slide-up') {
                    timeline.add(box, { ...animation, y: [14, 0] }, atMs);
                } else if (step.transition === 'zoom' || step.transition === undefined) {
                    timeline.add(box, { ...animation, scale: [0.92, 1] }, atMs);
                } else {
                    timeline.add(box, animation, atMs);
                }
            } else if (step.kind === 'surfaceState') {
                const layers = nodes.surfaceStates.get(step.anchor);
                const entry = layers?.get(step.state);
                if (!layers || !entry) continue;
                const animation = { opacity: [0, 1], duration: calm ? 1 : durationMs };
                if (step.transition === 'slide-up') {
                    timeline.add(entry.node, { ...animation, y: [18, 0] }, atMs);
                } else if (step.transition === 'zoom') {
                    timeline.add(entry.node, { ...animation, scale: [0.88, 1] }, atMs);
                } else {
                    timeline.add(entry.node, animation, atMs);
                }

                // 替换型的结果层要把它顶掉的那一层同时淡出。少了这一步，重画一遍的海报墙
                // 和底下那面原墙会同时在屏幕上，差着一点位移 —— 看起来就是骨架和界面对不上。
                if (entry.replaces) {
                    const replacedState = typeof entry.replaces === 'string'
                        ? entry.replaces
                        : PONDER_SURFACE_BASE_STATE;
                    // 同一个槽位可以被接连替换（平移之后再聚焦），所以记住的是「这个槽位现在是谁」。
                    const slot = `${step.anchor}:${replacedState}`;
                    const covered = visibleLayers.get(slot) ?? layers.get(replacedState);
                    if (covered && covered.node !== entry.node) {
                        timeline.add(covered.node, { opacity: [1, 0], duration: calm ? 1 : durationMs }, atMs);
                    }
                    visibleLayers.set(slot, entry);
                }
            } else {
                // pausePoint：时间线上的一段空隙。用裸 timer 占位，不动任何节点。
                timeline.add({ duration: durationMs }, atMs);
            }
        }

        // 时间线和 plan 一样长。章末那段字幕不收声，它的阅读时间在动画库眼里就不存在：不占住的话，
        // 最后一个动作做完时间线就报章末，下一章的读条在字幕刚出来时就开始走，进度条的填充也比
        // 按 plan.totalMs 摆的刻度跑得快。
        timeline.add({ duration: plan.totalMs }, 0);

        // 时间线的填充与关键帧的点：每帧直接写 DOM，所以「现在在第几帧」从头到尾不需要是 React 状态。
        // 走过的点标上 data-done，画成实心。null 是还没画过，头一次必写：
        // 重建的时间线才不会留着上一条标过的点。
        const keyframeIndexRef: { current: number | null } = { current: null };

        /**
         * 把当前进度刷到 DOM 上。
         *
         * 单独抽出来是因为 seek 必须显式调它：seek 的第二个参数 muteCallbacks 连 onUpdate
         * 一起静音了（这正是我们要的 —— 卷过 marker 不该触发它），于是暂停状态下按 ←/→
         * 时间线确实跳了，进度条却停在原处。
         */
        const paintProgress = () => {
            const nodes = nodesRef.current;
            if (!nodes) return;
            if (nodes.progressFill) {
                nodes.progressFill.style.transform = `scaleX(${timeline.iterationProgress})`;
            }
            const index = keyframeIndexAt(plan, timeline.iterationCurrentTime);
            if (index !== keyframeIndexRef.current) {
                keyframeIndexRef.current = index;
                nodes.ticks.forEach((tick, i) => {
                    if (tick) tick.toggleAttribute('data-done', i <= index);
                });
            }
        };

        // 跳关键帧后要停住的时间点。非 null 时时间线在播，但只是在把这一拍播完。
        let settleAtMs: number | null = null;

        timeline.onUpdate = () => {
            if (settleAtMs !== null && timeline.iterationCurrentTime >= settleAtMs) {
                const stopAtMs = settleAtMs;
                settleAtMs = null;
                // 停点就是章末时不拦：后面没有动作要挡，时间线自己走完、自己报章末。在这里拨过去
                // 是不触发回调的，时间线会先被标成播完，章末就没人报了。
                if (stopAtMs < timeline.duration) {
                    timeline.pause();
                    // 按帧检测会多走一点，拉回到准确的停点，免得把下一个动作的第一帧露出来。
                    seekPonderTimeline(timeline, stopAtMs);
                }
            }
            paintProgress();
        };

        timeline.onComplete = () => onComplete();

        /**
         * 跳到某个关键帧，把这一拍播完后停住。
         *
         * 跳关键帧是「我要看这一帧」：一直播下去的话字幕刚出来就被下一段顶掉，等于白跳；
         * 停在关键帧开头又是一帧空白。停点由 keyframeSettleAt 算。
         * muteCallbacks，理由和 AutomixTransitionAnimation 里那次 seek 一样：
         * 卷过一个 marker 不该把它触发一遍。
         */
        const seekKeyframe = (atMs: number) => {
            timeline.pause();
            seekPonderTimeline(timeline, atMs);
            // 一段字幕算「到位」，要等它淡入、也等它的聚焦框走到。
            const stopAtMs = keyframeSettleAt(plan, atMs, Math.max(ms('enter'), ms('move')));
            settleAtMs = stopAtMs > atMs ? stopAtMs : null;
            if (settleAtMs !== null) {
                timeline.play();
            }
            paintProgress();
            onRewind();
        };

        const restart = () => {
            settleAtMs = null;
            timeline.restart();
            paintProgress();
            onRewind();
        };

        controlsRef.current = {
            toggle: () => {
                // 播完了再按播放，是从头再看一遍这一章。
                if (timeline.completed) {
                    restart();
                    return false;
                }
                // 正在把一拍播完时，外面显示的是暂停态；这时按播放就是「接着播」，不是再暂停一次。
                if (settleAtMs !== null) {
                    settleAtMs = null;
                    return false;
                }
                if (timeline.paused) {
                    timeline.play();
                    return false;
                }
                timeline.pause();
                paintProgress();
                return true;
            },
            restart,
            isCompleted: () => timeline.completed,
            seekPrevKeyframe: () => seekKeyframe(prevKeyframeAt(plan, timeline.iterationCurrentTime)),
            seekNextKeyframe: () => seekKeyframe(nextKeyframeAt(plan, timeline.iterationCurrentTime)),
            seekToTick: index => {
                const keyframe = plan.keyframes[index];
                if (!keyframe) return;
                seekKeyframe(keyframe.atMs);
            },
        };

        // 新的时间线在开头：这一章不算播完。停着建的那一条不会自己走第一帧，开头的样子和进度在这里画。
        if (startsPaused) {
            timeline.seek(0, true);
            paintProgress();
        }
        onRewind();

        // 无限循环开着就一直有 rAF，切到后台必须停 —— 否则在别的窗口里持续烧 CPU。
        // 回来时只接着播切走那一刻正在播的：用户停下的、已经播完的（否则会把「下一章」卡片顶掉）都不动。
        let resumeWhenVisible = false;
        const handleVisibility = () => {
            if (document.hidden) {
                resumeWhenVisible = !timeline.paused;
                timeline.pause();
            } else if (resumeWhenVisible) {
                resumeWhenVisible = false;
                timeline.play();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            timeline.revert();
            controlsRef.current = null;
        };
    }, [plan, rects, nodesRef, readPaused, onComplete, onRewind]);

    return controlsRef;
};

export default usePonderTimeline;
