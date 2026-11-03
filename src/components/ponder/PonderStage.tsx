import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { usePonderStore } from '../../stores/usePonderStore';
import { resolveReducedMotion, useMotionSettingsStore } from '../../stores/useMotionSettingsStore';
import { usePonderSessionKeys } from '../../hooks/usePonderSessionKeys';
import { compilePonderScene } from '../../utils/ponder/compilePonderTimeline';
import { keyframeTicks } from '../../utils/ponder/ponderKeyframes';
import { resolvePonderAnchors } from '../../utils/ponder/resolvePonderAnchors';
import { fitRectsToStage } from '../../utils/ponder/fitRectsToStage';
import { ponderStageScreen } from '../../utils/ponder/ponderStageLayout';
import { refreshPonderDomRectSnapshot, type PonderDomRectSnapshot } from '../../utils/ponder/ponderDomRectSnapshot';
import { findPonderTarget } from './ponderRegistry';
import { type SettingsAnchorId } from '../modal/settings/navigation/settingsAnchorModel';
import { openSettingsFromPonder, openVisualizerSettingsFromPonder } from '../../services/ponder/pagePonderTarget';
import type { VisualizerSettingsSection } from '../../stores/useSettingsModalStore';
import { openPonderActionUrl } from '../../services/ponder/ponderActionUrl';
import { SettingsKitThemeContext } from '../modal/settings/kit/kitTheme';
import { ponderLayerMotion } from './ponderMotion';
import { ponderLayerTokens, ponderWindowTokens } from './ponderTheme';
import { createPonderStageNodes } from './ponderStageNodes';
import { usePonderTimeline, type PonderTimelineControls } from './usePonderTimeline';
import PonderActors from './PonderActors';
import PonderCaptionBlock from './PonderCaptionBlock';
import PonderChrome from './PonderChrome';
import PonderSkeletonLayer from './PonderSkeletonLayer';
import PonderNextChapterCue from './PonderNextChapterCue';
import PonderRelatedTargets from './PonderRelatedTargets';
import { PONDER_AUTO_ADVANCE_MS, type PonderRect } from '../../types/ponder';
import type { Theme } from '../../types';

// src/components/ponder/PonderStage.tsx
// 教程层本体。这是懒加载 chunk 的根 —— animejs 只经由 usePonderTimeline 进到这条链里。
//
// 矩形在进入瞬间采一次就定住，不订阅任何东西：底栏基线是 React 之外的 MotionValue、
// Lattice 相机也绕过 React，订阅既拿不到正确值也违反 guardrails。窗口尺寸变了才重采一次。
//
// 退场那一小段（ponderMotion 的 base 时长）里 store 的 session 已经是 null 了，这一层却还要留在屏幕上。所以这里存一份
// 最后的 session 快照，整棵树在退场期间继续按它渲染 —— 少了这一步，关闭时会先整屏闪成空白
// 再淡出，等于没有退场动画。

/** resize 后等这么久再重采，避免拖动窗口时连续重建时间线。 */
const RESAMPLE_DEBOUNCE_MS = 250;

/** 「本页可单独思索的组件」那张浮层卡占掉的右侧宽度（卡宽 224 + 右边距）。 */
const RELATED_PANEL_GUTTER_PX = 248;

/** 骨架离那块屏的边至少这么远。 */
const SCREEN_INSET_PX = 20;

const readViewport = () => ({ width: window.innerWidth, height: window.innerHeight });

/** 时间线重建的那一刻（窗口变了）用户是不是停着的。 */
const readPaused = () => usePonderStore.getState().isPaused;

type PonderStageProps = {
    theme?: Theme;
    isDaylight: boolean;
};

const readRect = (selector: string): PonderRect | null => {
    const element = document.querySelector(selector);
    if (!element) {
        return null;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) {
        return null;
    }
    // 圆角照量：真实界面里是圆按钮，骨架就该是圆的。
    const radius = window.getComputedStyle(element).borderRadius;
    return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        ...(radius && radius !== '0px' ? { radius } : {}),
    };
};

const PonderStage: React.FC<PonderStageProps> = ({ theme, isDaylight }) => {
    const { t } = useTranslation();
    const calm = useMotionSettingsStore(state => resolveReducedMotion(state, 'uiMicroMotion'));
    const liveSession = usePonderStore(state => state.session);
    const isPaused = usePonderStore(state => state.isPaused);
    const closePonder = usePonderStore(state => state.closePonder);
    const openPonder = usePonderStore(state => state.openPonder);
    const stepScene = usePonderStore(state => state.stepScene);
    const setPaused = usePonderStore(state => state.setPaused);

    // 退场期间 liveSession 已经是 null，但这一层还要按最后那次会话继续渲染到退场播完。
    const lastSessionRef = useRef(liveSession);
    if (liveSession) {
        lastSessionRef.current = liveSession;
    }
    const session = liveSession ?? lastSessionRef.current;
    const isLeaving = liveSession === null;

    const target = session ? findPonderTarget(session.targetId) : null;

    // 章节按「此刻讲不讲得通」过滤：目标是按组件划分的，一个组件里却不是每件事都始终存在 ——
    // 两个槽位可以放十个动作中的任意两个，没放随机时就不该有「随机其实是洗一次牌」这一章。
    // 只在进入或换目标时求值一次，教程跑着的时候章节数不会变。
    const scenes = useMemo(
        () => (target ? target.scenes.filter(candidate => candidate.isAvailable?.() !== false) : []),
        [target],
    );
    const scene = scenes[session?.sceneIndex ?? 0] ?? null;

    const nodesRef = useRef(createPonderStageNodes());
    const [rects, setRects] = useState<Record<string, PonderRect>>({});
    // 窗口尺寸和骨架矩形同一个口径：进入时采一次，窗口变了才和矩形一起重采。
    const [viewport, setViewport] = useState(readViewport);
    // 骨架画在上面的那块屏。列了相关组件就在两侧给那张浮层卡让出位置，卡才不压在屏上。
    const screen = useMemo(
        () => ponderStageScreen(viewport, target?.relatedTargetIds ? RELATED_PANEL_GUTTER_PX : 0),
        [viewport, target],
    );
    const [sampleToken, setSampleToken] = useState(0);
    const domRectSnapshotRef = useRef<PonderDomRectSnapshot>({});
    const snapshotTargetIdRef = useRef<string | null>(null);
    const sampledTokenRef = useRef(-1);

    // 换场景或换目标时，节点表必须先清空 —— 上一场景的字幕节点已经卸载，留着会让
    // 时间线对着 detached 节点写属性。
    useLayoutEffect(() => {
        nodesRef.current = createPonderStageNodes();
    }, [session?.targetId, session?.sceneIndex]);

    useLayoutEffect(() => {
        if (!scene || !target || !session) {
            return;
        }
        const targetChanged = snapshotTargetIdRef.current !== session.targetId;
        if (targetChanged) {
            // A different target has unrelated selectors and geometry; never mix both snapshots.
            domRectSnapshotRef.current = {};
            snapshotTargetIdRef.current = session.targetId;
            sampledTokenRef.current = -1;
        }
        if (sampledTokenRef.current !== sampleToken) {
            // Capture every chapter now, while hover-only controls are still mounted. On resize,
            // update what is measurable and retain the last good rect for anything now collapsed.
            domRectSnapshotRef.current = refreshPonderDomRectSnapshot(
                target.scenes,
                readRect,
                domRectSnapshotRef.current,
            );
            sampledTokenRef.current = sampleToken;
        }
        // 先按真实位置解析，再把整幅图等比装进那块屏。
        // 必须在这里一次性做完：骨架、聚焦框、光标全都消费这同一份 rects，
        // 任何一处单独变换都会让它们互相错位。
        setRects(fitRectsToStage({
            rects: resolvePonderAnchors(scene.anchors, {
                readRect: selector => domRectSnapshotRef.current[selector] ?? null,
                viewport,
            }),
            viewport,
            chrome: {
                top: screen.top,
                bottom: viewport.height - screen.top - screen.height,
                left: screen.left,
                right: viewport.width - screen.left - screen.width,
            },
            gap: SCREEN_INSET_PX,
        }));
    }, [scene, sampleToken, session, target, viewport, screen]);

    useEffect(() => {
        if (!scene) {
            return;
        }
        let timer: number | null = null;
        const handleResize = () => {
            if (timer !== null) window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                timer = null;
                setViewport(readViewport());
                setSampleToken(token => token + 1);
            }, RESAMPLE_DEBOUNCE_MS);
        };
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            if (timer !== null) window.clearTimeout(timer);
        };
    }, [scene]);

    const plan = useMemo(() => (scene ? compilePonderScene(scene) : null), [scene]);
    const ticks = useMemo(() => (plan ? keyframeTicks(plan) : []), [plan]);

    // 一章播完停下，由卡片接手。isFinished 是离散事实，可以进 state。
    const [isFinished, setIsFinished] = useState(false);
    // 读条被取消过没有。取消是单向的：这一章里一旦取消，就不再自己往下走。
    const [autoAdvanceCancelled, setAutoAdvanceCancelled] = useState(false);
    useLayoutEffect(() => {
        setIsFinished(false);
        setAutoAdvanceCancelled(false);
    }, [session?.targetId, session?.sceneIndex]);
    const handleComplete = useCallback(() => setIsFinished(true), []);

    const hasNextScene = Boolean(scenes[(session?.sceneIndex ?? 0) + 1]);
    const isAutoAdvancing = isFinished && hasNextScene && !isPaused && !autoAdvanceCancelled && !isLeaving;

    /**
     * 读条走完就进下一章。
     *
     * 暂停、把指针移到「下一章」上、或者在读条期间按任意键都会取消它 —— 这三件事
     * 都说明用户此刻在看这一屏，而不是在等下一章。
     */
    useEffect(() => {
        if (!isAutoAdvancing) {
            return;
        }
        const timer = window.setTimeout(() => stepScene(1, scenes.length), PONDER_AUTO_ADVANCE_MS);
        return () => window.clearTimeout(timer);
    }, [isAutoAdvancing, stepScene, scenes.length]);

    // 按键的取消由 usePonderSessionKeys 转发进来：它在 capture 阶段把认不出的键
    // stopImmediatePropagation 掉，在外面再挂一个 keydown 监听是收不到的。
    const cancelAutoAdvance = useCallback(() => setAutoAdvanceCancelled(true), []);

    // 时间线回到了前面（重播、跳关键帧、窗口变了重建）：「这一章播完了」就不再成立，「下一章」和读条都该收起来。
    const handleRewind = useCallback(() => {
        setIsFinished(false);
        setAutoAdvanceCancelled(false);
    }, []);

    const emptyPlan = useMemo(() => ({ totalMs: 0, entries: [], keyframes: [] }), []);
    const controlsRef = usePonderTimeline({
        plan: plan ?? emptyPlan,
        rects,
        nodesRef,
        readPaused,
        onComplete: handleComplete,
        onRewind: handleRewind,
    });

    usePonderSessionKeys({
        // 退场那几帧按 liveSession 判：会话已经关了，键盘就该立刻还给底下的界面。
        isActive: Boolean(liveSession),
        sceneCount: scenes.length,
        controlsRef,
        onAnyKey: cancelAutoAdvance,
    });

    /** 屏幕上的关键帧跳转：时间线那头已经停了，这里把播放键的图标同步成暂停态。 */
    const seekKeyframe = (seek: (controls: PonderTimelineControls) => void) => {
        const controls = controlsRef.current;
        if (!controls) return;
        seek(controls);
        setPaused(true);
    };

    // 画在窗口之外的套件部件（提示气泡）靠它知道深浅。
    const kitTheme = useMemo(() => ({ isDaylight, theme }), [isDaylight, theme]);

    if (!session || !target || !scene || !plan) {
        return null;
    }

    const layer = ponderLayerMotion(calm);
    const nextScene = scenes[session.sceneIndex + 1];

    /** 从头播这一章。暂停着的时候按重播也是「播」，播放键要跟着变回去。 */
    const restartChapter = () => {
        controlsRef.current?.restart();
        setPaused(false);
    };

    const runAction = () => {
        if (!scene.action) return;
        // 外链不关教程：看完文档回来还想接着看这一章。
        if (scene.action.kind === 'openUrl') {
            openPonderActionUrl(scene.action.url);
            return;
        }
        if (scene.action.kind === 'openVisualizerSettings') {
            openVisualizerSettingsFromPonder(scene.action.section as VisualizerSettingsSection);
            return;
        }
        // 顺序和「还要收掉哪几层」都在 openSettingsFromPonder 里 ——
        // 设置窗口是整个应用里最低的浮层，漏关一层就会把它盖住。
        openSettingsFromPonder(scene.action.anchorId as SettingsAnchorId);
    };

    return (
        <motion.div
            {...layer.backdrop}
            // 接管键盘：底下那些全局热键靠这个属性让路，这也是 G 不会在教程里再次触发的原因。
            // 退场期间就该摘掉 —— 教程已经关了，底下的热键不必再等退场播完。
            data-folia-keyboard-window={isLeaving ? undefined : 'true'}
            data-testid="ponder-stage"
            // z-[220]：压过状态 toast（210），教程是全屏接管，不该被任何东西盖住。
            // backdrop-blur 让底下的真实界面退成一团轮廓而不是仍然可读的文字：
            // 保留「这是同一个地方」的空间感，又不至于和骨架抢注意力。
            className={`fixed inset-0 z-[220] overflow-hidden bg-[var(--pd-veil)] backdrop-blur-md ${isLeaving ? 'pointer-events-none' : ''}`}
            style={ponderLayerTokens(isDaylight, theme)}
            role="dialog"
            aria-modal="true"
            aria-label={t(target.titleKey)}
        >
            <div className="st-window absolute inset-0 text-[color:var(--st-t1)]" style={ponderWindowTokens(isDaylight, theme, calm)}>
                <SettingsKitThemeContext.Provider value={kitTheme}>
                    {/* 画面：一块屏，骨架和会动的那几个都画在它上面。位移和缩放只挂在这一层：底衬要一直铺满，
                        跟着缩会在四边露出没盖住的真实界面；外框那几处只跟着底衬淡入。 */}
                    <motion.div {...layer.panel} data-ponder-stage-content className="absolute inset-0">
                        <div
                            data-ponder-screen
                            className="absolute rounded-[14px] bg-[var(--st-pv)] shadow-[0_0_0_1px_var(--st-line),0_30px_70px_rgba(0,0,0,0.28)]"
                            style={screen}
                        />
                        <PonderSkeletonLayer
                            rects={rects}
                            anchors={scene.anchors}
                            nodes={nodesRef.current}
                            theme={theme}
                            isDaylight={isDaylight}
                        />
                        <PonderActors plan={plan} rects={rects} anchors={scene.anchors} nodes={nodesRef.current} screen={screen} />
                    </motion.div>
                    <PonderChrome
                        title={t(target.titleKey)}
                        chapters={scenes.map(candidate => t(candidate.titleKey))}
                        sceneIndex={session.sceneIndex}
                        // 播完了也画成「播放」：这时再按它是从头看这一章。
                        isPaused={isPaused || isFinished}
                        ticks={ticks}
                        nodes={nodesRef.current}
                        screen={screen}
                        calm={calm}
                        // 点当前这一段是重播这一章；点别的段换到那一章。
                        onSelectChapter={index => (
                            index === session.sceneIndex ? restartChapter() : openPonder(session.targetId, index)
                        )}
                        onTogglePlay={() => {
                            const controls = controlsRef.current;
                            if (controls) setPaused(controls.toggle());
                        }}
                        onRestart={restartChapter}
                        onSeekToTick={index => seekKeyframe(controls => controls.seekToTick(index))}
                        onPrevKeyframe={() => seekKeyframe(controls => controls.seekPrevKeyframe())}
                        onNextKeyframe={() => seekKeyframe(controls => controls.seekNextKeyframe())}
                        onExit={closePonder}
                    >
                        <PonderCaptionBlock
                            sceneIndex={session.sceneIndex}
                            sceneCount={scenes.length}
                            sceneTitle={t(scene.titleKey)}
                            plan={plan}
                            nodes={nodesRef.current}
                            calm={calm}
                            actionLabel={scene.action ? t(scene.action.labelKey) : null}
                            onRunAction={runAction}
                            cue={isFinished && (
                                <PonderNextChapterCue
                                    nextSceneTitle={nextScene ? t(nextScene.titleKey) : null}
                                    onNextScene={() => stepScene(1, scenes.length)}
                                    autoAdvanceMs={isAutoAdvancing ? PONDER_AUTO_ADVANCE_MS : null}
                                    onCancelAutoAdvance={cancelAutoAdvance}
                                />
                            )}
                        />
                    </PonderChrome>
                    <PonderRelatedTargets
                        target={target}
                        accent={theme?.accentColor || (isDaylight ? '#27272a' : '#fafafa')}
                        isDaylight={isDaylight}
                    />
                </SettingsKitThemeContext.Provider>
            </div>
        </motion.div>
    );
};

export default PonderStage;
