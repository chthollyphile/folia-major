import { useEffect, useLayoutEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import {
    cubicBezierCss,
    getWallHandoffPitchPx,
    getWallHandoffSpot,
    rectCenter,
    rectsIntersect,
    WALL_HANDOFF_FLIP_IN_MS,
    WALL_HANDOFF_FLIP_OUT_MS,
    WALL_HANDOFF_IN_EASE,
    WALL_HANDOFF_OUT_EASE,
    WALL_HANDOFF_PERSPECTIVE_PX,
    type WallHandoffRect,
} from '../../../components/wall/wallHandoff';
import { cameraFromViewCenter } from '../../../components/wall/wallView';
import {
    resolveWallHandoffRole,
    useWallHandoffStore,
    type WallHandoffMode,
    type WallHandoffPhase,
    type WallHandoffSession,
} from '../../../stores/useWallHandoffStore';
import { BRAVAIS_METRICS, BRAVAIS_SEAM_TWEEN_S } from './bravaisConstants';
import type { BravaisDisplay } from './bravaisDisplay';
import type { BravaisFrameState } from './useBravaisFrame';

// src/library/suites/bravais/useBravaisWallHandoff.ts
// bravais 这面墙在翻牌交接里的一半（设计稿 §7「进入队列」；协议在 app 层的 useWallHandoffStore，时间表在 wall 的
// wallHandoff）。stage 以「首页墙」登记 peer（此刻能不能交接：画着、可交互、当前层归它），然后按会话阶段动：
// - 进 Lattice（这面墙离开，role = out）：closing 时缝合上（开口补间到 0）、窗关上（透光档在墙面之下垫一层实色的
//   veil，0.2s 淡入；全透明档的磁贴因此也成了实色），合上后量好起点（聚焦卡 / 键盘焦点 / 视口中心）与对齐信息报回去；
//   flipping 时视口里的每张磁贴按到起点的距离错开翻出半圈（WAAPI，只转内容层，fill forwards 停在侧立），翻完整面卸载。
// - 回资料库墙（这面墙进来，role = in）：挂上时磁贴全部藏着（data-wall-handoff-hold）、缝合着、veil 盖着；画好之后报
//   准备好（同时报有没有窗，visualizer 赶在窗打开之前装上）；flipping 时每张磁贴等到「同一位置上 Lattice 翻出半圈之后」
//   翻进来（fill backwards 在等待期间保持侧立）；opening 时缝张开、veil 淡出，正在播放那首（fb3）同时展开（2026-10-10，
//   之前等会话结束才展开，节奏拖沓）；会话结束后墙才算落定。
// - 降低动态效果（mode = fade）：这面墙什么都不做，Lattice 整层淡入盖上 / 淡出露出。
// 交接期间墙不接指针、不接键盘（stage 据 role 关掉 active），根节点挂 data-wall-handoff 与阶段，stage 视为 settling。
// 动画只动 transform / opacity；DOM 读写只在阶段切换的那一刻各一次（量起点、给视口里的磁贴排动画），没有逐帧工作。

export type BravaisWallHandoffState = {
    role: 'in' | 'out' | null;
    mode: WallHandoffMode | null;
    phase: WallHandoffPhase | null;
    /** 缝的开口此刻要合上（stage 把开口目标换成 0）。 */
    seamClosed: boolean;
    /** 透光档墙面之下的实色 veil 盖着（窗关上）。 */
    veilOn: boolean;
    /** 根节点的颗粒与暗角此刻交给 Lattice 画（两面墙叠着时只留上面那层的一份）。 */
    overlaysOff: boolean;
    /** 磁贴先藏着，等开翻（回资料库墙、还没开翻）。 */
    hold: boolean;
};

/**
 * 会话此刻要这面墙摆成什么样（纯计算）。stage 在缝的 hook 之前就要用它（开口目标），所以与下面排动画的 hook 分开。
 * 颗粒与暗角：两面墙叠着时只留上面那层（Lattice）的一份——进 Lattice 的 closing 里 Lattice 的那份关着、这面墙的照常；
 * 开翻起换过来；回资料库墙时这面墙在 Lattice 之下，开翻前后都交给 Lattice，opening（Lattice 已卸载）起才回来。
 */
export const resolveBravaisWallHandoffState = (session: WallHandoffSession | null): BravaisWallHandoffState => {
    const role = resolveWallHandoffRole(session, 'home');
    const flip = session?.mode === 'flip';
    const phase = session?.phase ?? null;
    const closed = flip && (role === 'out' || (role === 'in' && phase !== 'opening'));
    return {
        role,
        mode: session?.mode ?? null,
        phase,
        seamClosed: closed,
        veilOn: closed,
        overlaysOff: flip && (phase === 'flipping' || (role === 'in' && phase === 'waiting')),
        hold: flip && role === 'in' && phase === 'waiting',
    };
};

const rotation = (degrees: number) => `perspective(${WALL_HANDOFF_PERSPECTIVE_PX}px) rotateY(${degrees}deg)`;
const OUT_EASE = cubicBezierCss(WALL_HANDOFF_OUT_EASE);
const IN_EASE = cubicBezierCss(WALL_HANDOFF_IN_EASE);
/** veil 淡入 / 淡出（与 bravais.css 的 .bravais-handoff-veil 一致）。 */
const VEIL_FADE_MS = 200;
/** 回资料库墙：层还在加载时最多等这么久就开翻（数据随后到达时照常翻牌）。 */
const LOADING_GRACE_MS = 500;
/**
 * 回资料库墙、墙上有窗时：报了「有窗」之后 App 才装 visualizer（Pixi 初始化是主线程上的一大块），从挂上起至少等这么久
 * 再开翻，让那一块落在 Lattice 还静止的时候，而不是落在 Lattice 海报翻出（Framer 逐帧）的途中。
 */
const SEE_THROUGH_SETTLE_MS = 280;
/** 回正的补间比缝合上晚起步不到一帧：量位置前多等这么久（两帧）。 */
const TILT_SETTLE_SLACK_MS = 34;

/**
 * 进 Lattice · closing 要等多久再量磁贴的位置：缝合上（开口补间）、veil 盖上，以及整层回正——歌单的信息条、海报在场时
 * 整层倾斜着，缝合上时一起回正（useBravaisTilt 的 quickOut，同一个时长），多等两帧让它落定；量位置、给对齐点都按没倾斜的
 * 墙算。降低动态效果时都不等。
 */
export const handoffCloseWaitMs = ({ openWidth, tiltDeg, seeThrough, reducedMotion }: { openWidth: number; tiltDeg: number; seeThrough: boolean; reducedMotion: boolean }) => {
    if (reducedMotion) return 0;
    const seamMs = openWidth > 0.5 ? BRAVAIS_SEAM_TWEEN_S * 1000 : 0;
    const veilMs = seeThrough ? VEIL_FADE_MS : 0;
    const tiltMs = Math.abs(tiltDeg) >= 0.001 ? BRAVAIS_SEAM_TWEEN_S * 1000 + TILT_SETTLE_SLACK_MS : 0;
    return Math.max(seamMs, veilMs, tiltMs);
};

const toRect = (rect: DOMRect): WallHandoffRect => ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });

const viewportRect = (): WallHandoffRect => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });

/** 视口里的磁贴（外框与内容层）：只给看得见的排动画。 */
const visibleTiles = (root: HTMLElement) => {
    const viewport = viewportRect();
    const tiles: Array<{ face: HTMLElement; rect: WallHandoffRect }> = [];
    for (const tile of root.querySelectorAll<HTMLElement>('.bravais-tile')) {
        const face = tile.firstElementChild;
        if (!(face instanceof HTMLElement)) continue;
        const rect = toRect(tile.getBoundingClientRect());
        if (rect.width <= 0 || rect.height <= 0 || !rectsIntersect(rect, viewport)) continue;
        tiles.push({ face, rect });
    }
    return tiles;
};

export const useBravaisWallHandoff = ({
    session,
    rootRef,
    frameRef,
    display,
    canHandoff,
    seeThrough,
    reducedMotion,
    reducedTransitions,
    expandedSlotKey,
    focusedRef,
}: {
    /** 当前的交接会话（stage 已经订阅了 store，直接交进来）。 */
    session: WallHandoffSession | null;
    rootRef: RefObject<HTMLElement | null>;
    frameRef: MutableRefObject<BravaisFrameState>;
    display: BravaisDisplay | null;
    /** 此刻能交接：画着、可交互、当前层归 bravais。 */
    canHandoff: boolean;
    /** 墙上有窗（部分透明 / 全透明档）。 */
    seeThrough: boolean;
    /** 相机与缝的补间降级（lattice 一面）。 */
    reducedMotion: boolean;
    /** 换层转场降级（bravaisMotion）：交接也换成淡入淡出交叉。 */
    reducedTransitions: boolean;
    expandedSlotKey: string | null;
    focusedRef: MutableRefObject<string | null>;
}): void => {
    const role = resolveWallHandoffRole(session, 'home');
    const flip = session?.mode === 'flip';
    const phase = session?.phase ?? null;
    const sessionId = session?.id ?? null;

    // 首页墙的 peer：director 在视图切换那一刻问它（读最新的值，不随渲染重登记）。
    const latestRef = useRef({ canHandoff, seeThrough, reducedTransitions, expandedSlotKey });
    latestRef.current = { canHandoff, seeThrough, reducedTransitions, expandedSlotKey };
    useEffect(() => useWallHandoffStore.getState().registerHomePeer({
        canHandoff: () => latestRef.current.canHandoff,
        seeThrough: () => latestRef.current.seeThrough,
        reduced: () => latestRef.current.reducedTransitions,
    }), []);

    const animationsRef = useRef<Animation[]>([]);
    const cancelAnimations = () => {
        for (const animation of animationsRef.current) animation.cancel();
        animationsRef.current = [];
    };
    // 会话没了（放完、被放弃）或换了一次：上一次排的翻牌全部撤掉（离开时放弃 = 磁贴回正；进来时早已放完）。
    useLayoutEffect(() => cancelAnimations, [sessionId]);

    // 进 Lattice · closing：等缝合上、veil 盖上，量好起点与对齐信息报回去。
    useEffect(() => {
        if (role !== 'out' || !flip || phase !== 'closing' || sessionId === null) return undefined;
        const waitMs = handoffCloseWaitMs({ openWidth: frameRef.current.openWidth, tiltDeg: frameRef.current.tiltDeg, seeThrough, reducedMotion });
        let frame: number | null = null;
        const timer = setTimeout(() => {
            frame = requestAnimationFrame(() => {
                frame = null;
                const root = rootRef.current;
                const { view, center } = frameRef.current;
                if (!root || !view) {
                    useWallHandoffStore.getState().markHomeReady(sessionId);
                    return;
                }
                const rootRect = root.getBoundingClientRect();
                const originKey = latestRef.current.expandedSlotKey ?? focusedRef.current;
                const originTile = originKey
                    ? root.querySelector<HTMLElement>(`[data-bravais-slot="${CSS.escape(originKey)}"]`)
                    : null;
                const originRect = originTile ? toRect(originTile.getBoundingClientRect()) : null;
                const usable = originRect && rectsIntersect(originRect, viewportRect()) ? originRect : null;
                // 缝合上之后两半墙的偏移都是 0：世界原点（块角）在客户区里的位置就是相机的平移。
                const camera = cameraFromViewCenter(center, view);
                useWallHandoffStore.getState().markHomeReady(sessionId, {
                    origin: usable ? rectCenter(usable) : rectCenter(toRect(rootRect)),
                    align: {
                        card: latestRef.current.expandedSlotKey && usable ? usable : null,
                        gridPoint: { x: rootRect.left + camera.x, y: rootRect.top + camera.y },
                    },
                });
            });
        }, waitMs);
        return () => {
            clearTimeout(timer);
            if (frame !== null) cancelAnimationFrame(frame);
        };
    }, [flip, focusedRef, frameRef, phase, reducedMotion, role, rootRef, seeThrough, sessionId]);

    // 回资料库墙 · waiting：一挂上就报有没有窗（visualizer 早一点装上）；画好了（层不在加载，或等够了）报准备好。
    useEffect(() => {
        if (role !== 'in' || phase !== 'waiting' || sessionId === null) return;
        useWallHandoffStore.getState().reportSeeThrough(sessionId, seeThrough);
    }, [phase, role, seeThrough, sessionId]);
    const mountedAtRef = useRef(typeof performance !== 'undefined' ? performance.now() : 0);
    const viewReady = Boolean(display);
    const loading = Boolean(display?.layer.wall?.loading);
    useEffect(() => {
        if (role !== 'in' || phase !== 'waiting' || sessionId === null || !viewReady) return undefined;
        let frame: number | null = null;
        const report = () => {
            // 再等一帧：这一次提交里挂上的磁贴先画出来（藏着），开翻时才排得到它们。
            frame = requestAnimationFrame(() => {
                frame = null;
                useWallHandoffStore.getState().markHomeReady(sessionId, {
                    seeThrough: latestRef.current.seeThrough,
                    reduced: latestRef.current.reducedTransitions,
                });
            });
        };
        const now = performance.now();
        const waitMs = Math.max(
            loading ? mountedAtRef.current + LOADING_GRACE_MS - now : 0,
            latestRef.current.seeThrough ? mountedAtRef.current + SEE_THROUGH_SETTLE_MS - now : 0,
            0,
        );
        const timer = setTimeout(report, waitMs);
        return () => {
            clearTimeout(timer);
            if (frame !== null) cancelAnimationFrame(frame);
        };
    }, [loading, phase, role, sessionId, viewReady]);

    // flipping：给视口里的磁贴排半圈翻牌（离开时翻出、进来时等同一位置上 Lattice 翻出之后再翻进）。
    useLayoutEffect(() => {
        if (!session || !flip || session.phase !== 'flipping' || role === null) return;
        const root = rootRef.current;
        const { view } = frameRef.current;
        const { origin, startedAt } = session;
        if (!root || !view || !origin || startedAt === null) return;
        cancelAnimations();
        const pitchPx = getWallHandoffPitchPx(BRAVAIS_METRICS, view.scale);
        const now = performance.now();
        const animations: Animation[] = [];
        for (const { face, rect } of visibleTiles(root)) {
            const spot = getWallHandoffSpot(rect, origin, pitchPx);
            animations.push(role === 'out'
                ? face.animate(
                    [{ transform: rotation(0) }, { transform: rotation(90 * spot.direction) }],
                    { duration: WALL_HANDOFF_FLIP_OUT_MS, delay: Math.max(0, startedAt + spot.outAt - now), easing: OUT_EASE, fill: 'forwards' },
                )
                : face.animate(
                    [{ transform: rotation(-90 * spot.direction) }, { transform: rotation(0) }],
                    { duration: WALL_HANDOFF_FLIP_IN_MS, delay: Math.max(0, startedAt + spot.inAt - now), easing: IN_EASE, fill: 'backwards' },
                ));
        }
        animationsRef.current = animations;
    // 只在进入 flipping 的那一次排（会话对象的其他字段不变）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flip, phase, role, sessionId]);

    useLayoutEffect(() => () => cancelAnimations(), []);
};
