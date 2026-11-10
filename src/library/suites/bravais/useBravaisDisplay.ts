import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { planFlip, type FlipOrigin } from '../../../components/wall/flipPlan';
import { getViewWorldBounds, type WallView, type WallViewCenter } from '../../../components/wall/wallView';
import type { WallSlot } from '../../../components/wall/wallSlots';
import type { WallCameraRange } from '../../../components/wall/finiteWall';
import type { SeamAxis } from '../../../components/wall/seamPlan';
import type { LibraryNavigationContext } from '../../core/suite/suite.contract';
import { BRAVAIS_METRICS, BRAVAIS_REDUCED_FADE_MS } from './bravaisConstants';
import {
    isGrownExploreShape,
    moveStartSlotKey,
    nearestShapeBoundaryX,
    nearestShapeBoundaryY,
    resolveLayerShape,
    resolveShiftStart,
    shapeSlotFromKey,
    splitGrownSlots,
    type BravaisWallShape,
} from './bravaisWallShape';
import {
    createBravaisDisplay,
    diffDisplays,
    findNearestSlot,
    isDisplayedWallLook,
    pointOrigin,
    resolveSlotFaceKey,
    toFlipSteps,
    toWaveSteps,
    type BravaisDisplay,
    type BravaisEntrance,
    type BravaisFlipStep,
} from './bravaisDisplay';
import { decideDataUpdate } from './bravaisDisplayUpdate';
import { canReuseFinitePlan, planBravaisFinite, resolveFiniteCameraRange, type BravaisFiniteState } from './bravaisFiniteWall';
import { findDisplayItemSlot } from './bravaisItemSlots';
import type { BravaisLayer } from './bravaisLayer';
import { fitBravaisLayoutToShape, readBravaisLayout, writeBravaisLayout } from './bravaisLayoutMemory';
import { resolveReservedPerBlock, type BravaisWallLook } from './bravaisLook';
import { releasePanelOnLayerChange } from './bravaisPanelHistory';
import { maskRemovedEntries } from './bravaisRemoval';
import { takeBravaisPendingOrigin } from './bravaisStageStore';
import { takeBravaisRemovalOrigin } from './bravaisUiStore';
import type { BravaisFrameState } from './useBravaisFrame';
import type { BravaisOpeningPlan } from './useBravaisSeam';
import { anchorAxis, anchorOf, columnAnchor, rowAnchor, seamBoundsOf, seamPointOf, type BravaisAnchor } from './bravaisAnchor';
import { planWallWave, WALL_WAVE_EXIT_TOTAL_MS, WALL_WAVE_IN_MS, WALL_WAVE_MAX_DELAY_MS } from './bravaisWallWave';
import { isSourceOrigin, layerMatchesNavigation, resolveShiftKind, type BravaisShiftKind } from './bravaisShift';

// src/library/suites/bravais/useBravaisDisplay.ts
// 换层的编排（设计稿 §7 转场语法）：store 给出的当前层一变，就决定这是 push / back / 原地替换（首页换页签）还是同一层
// 的数据更新，算出新层的起点 slot、缝锚点与相机去处，对已渲染的 slot 比较前后内容排一次翻牌（wall 的 planFlip），
// 一次 setState 换上新的显示。缝保持张开、只翻缝里的内容（useBravaisSeam）；push 时被点的磁贴是起点磁贴，原地成为
// 新层的第 1 项；back 时相机回到父层离开时的位置，翻牌从缝开始。
// B7：同一层的数据更新分四种（bravaisDisplayUpdate）——进出有限态 / 过滤从缝的两侧边缘翻；移除先把那一项翻成墙面、
// 翻完（按住旧帧）再让后面的 rank 前移；有限态的相机钳制在有内容的部分；进入一层时没有起点磁贴就用会话的
// focusedEntryKey 摆键盘焦点。
// B6b③：透光换档 / 换窗数也走同一层的数据更新（只翻开窗、关窗与内容因跳过窗位而挪了的 slot）；有限拼贴按同一个
// 每块窗数规划，换窗数时重新规划。
// 布局记忆：push 离开一层时、stage 卸载时写 sessionStorage；back 时离开的那一层不写（「完成」刚让宿主忘掉了它）。
// B9：换首页页签（首页层之间的 replace）不从缝翻牌，而是整墙出场 → 入场（bravaisWallWave，沿用 Lattice 的 lift wave）。
// B11：换层种类加上来源（bravaisShift）——从搜索 / 播放页打开集合是整墙入场（enter，没有起点磁贴，相机直接就位），
// 回到来源是整墙出场（exit，下面的首页层在搜索页 / 淡出的首页之下落回）；栈里有重复的集合时「同一个键、深度变了」
// 也算换层（面包屑跳回同名的那一层）。降低动态效果（reducedTransitions）时波次换成从起点 / 缝开始的翻牌、由磁贴淡入淡出，
// 落定时刻按 0.18s 算。每次换层在显示上记一个 shift（种类 + 序号），stage 根节点据此标记。
// 信息条横向：锚点可以是块行边界的世界 y（bravaisAnchor）。这里算出的锚点都先放在本地，最后交给 setAnchor 一次——缝换
// 方向时 setAnchor 先合上再换（useBravaisSeam），不能先把帧状态改了。新层的方向由 axisFor 给；记忆里的锚点方向不同
// （设置改过）就不沿用，按相机另取。
// 换形状（bravaisWallShape：块 ↔ 探索的地，或探索页的 section 变了）：slot 的矩形整套换掉，不能原地翻。先在旧形状上
// 整墙出场（换层时是这次换层自己的波次 / 淡出，目标全是墙面），按住到出场放完（期间来的数据先不上墙），再换上新形状：
// 缝锚点挪到新形状最近的块边界、相机跟着平移同样的距离（缝在屏幕上不动），换层时再像平常一样给新开口排相机，
// 磁贴按新形状重新挂载、整墙入场落回。探索页的 section 补到（isGrownExploreShape）不走这两段：原地换上新形状，
// 换了地的块重新挂载落回（只给新挂载的磁贴的入场），没换的不动。

/** 翻牌只排视口外扩这么多（世界单位）以内的磁贴。 */
const FLIP_OVERSCAN = 160;
/** 移除第一段（翻成墙面）放完之后再多等这么久才换上新数据。 */
const REMOVAL_SETTLE_MS = 40;

export type BravaisDisplayControls = {
    frameRef: MutableRefObject<BravaisFrameState>;
    view: WallView | null;
    /** 透光偏好（B6b③）：换档 / 换窗数走同一层的数据更新，只翻开窗、关窗与内容因跳过窗位而变了的 slot。 */
    wallLook: BravaisWallLook;
    /** 此刻渲染着的 slot（翻牌只比较它们）。 */
    slotsRef: MutableRefObject<readonly WallSlot[]>;
    /** 导航快照（深度、来源、各层的键）。 */
    navigation: LibraryNavigationContext;
    /** 换层转场降级成淡入淡出、不放整墙波次（bravaisMotion）。 */
    reducedTransitions: boolean;
    /** 这一层此刻的开口宽度（等级、面板、表单、过滤框都算进去了）。 */
    openWidthFor: (layer: BravaisLayer) => number;
    /** 这一层的缝是不是歌手海报（planOpening 换成把缝带到最左边的相机）。 */
    posterFor: (layer: BravaisLayer) => boolean;
    /** 这一层的缝开在哪个方向（信息条横向时的信息条是 'y'；折叠时是恢复后会用的方向）。 */
    axisFor: (layer: BravaisLayer) => SeamAxis;
    setAnchor: (anchor: BravaisAnchor) => void;
    /** prefer：想沿用的锚点（同方向才算数）；shape：缝开在哪种形状的块边界上（缺省是显示着的那一层的形状）。 */
    planOpening: (center: WallViewCenter, width: number, prefer: BravaisAnchor | null, poster?: boolean, shape?: BravaisWallShape, axis?: SeamAxis) => BravaisOpeningPlan;
    /** 换层要先换墙的形状、且缝要换方向：让缝合上后等 finishShapeChange 给锚点再张开（useBravaisSeam 的 awaitAnchor）。 */
    awaitAnchor?: () => void;
    /** 锚点（缺省是墙上此刻的）在不在屏内。 */
    isAnchorOnScreen: (anchor?: BravaisAnchor) => boolean;
    moveTo: (center: WallViewCenter, forceRecull?: boolean) => void;
    tweenTo: (center: WallViewCenter) => void;
    /** 有限态的相机范围（无限态给 null）。 */
    setCameraRange: (range: WallCameraRange | null, settle?: boolean) => void;
    /** 换层时收起聚焦卡、按起点 / 记忆放键盘焦点。 */
    collapseFocusCard: () => void;
    getFocusedSlotKey: () => string | null;
    restoreFocus: (slotKey: string | null) => void;
    /** 挂载时不跑整墙入场（翻牌交接从 Lattice 回来：磁贴由交接翻进来）。只在第一次显示时问。 */
    suppressEntrance?: () => boolean;
    /** 显示写进这个 ref（stage 的其余部分在换形状的同一次提交里就能读到新形状）；不给就用自己的。 */
    displayRef?: MutableRefObject<BravaisDisplay | null>;
};

/** 换形状按住的那一段放完之后要做的事：新形状上的起点、相机与焦点。 */
type ShapeChange = {
    startSlotKey: string | null;
    /** 落定时的相机（返回时是记忆里的）与锚点（锚点会挪到新形状的块边界上，相机跟着平移）。 */
    center: WallViewCenter;
    anchor: BravaisAnchor;
    /** 相机补间过去（返回、换页签）；否则直接就位。 */
    tween: boolean;
    focusKey: string | null;
    focusFromSession: boolean;
    /** 换层：落定时像平常的换层一样给开口排相机（缝可见就沿用它的边界）；数据让形状变了时不给（不排）。 */
    preferAnchor?: boolean;
};

/** 一层的布局记忆，已经搬到这一层的形状上（首页各页签共用一份，记着的可能是另一种形状的）。 */
const readLayoutFor = (layer: BravaisLayer) => {
    const memory = readBravaisLayout(layer.sessionKey);
    return memory && fitBravaisLayoutToShape(memory, resolveLayerShape(layer.shape, null));
};

/**
 * 一层开缝的锚点：沿用 `from`（同方向的才算，落到这个形状最近的块边界上），否则按相机 `center` 取 `axis` 方向上最近的
 * 块边界。
 */
const anchorOnShape = (shape: BravaisWallShape, axis: SeamAxis, from: BravaisAnchor | null, center: WallViewCenter): BravaisAnchor => (
    axis === 'y'
        ? rowAnchor(nearestShapeBoundaryY(shape, from?.y ?? center.y))
        : columnAnchor(nearestShapeBoundaryX(shape, from?.x ?? center.x))
);

/** 记忆里的锚点（没有记忆或没有锚点时为 null）。 */
const memoryAnchor = (memory: { anchorX: number | null; anchorY?: number | null } | null): BravaisAnchor | null => {
    if (!memory) return null;
    const anchor = anchorOf(memory);
    return anchorAxis(anchor) === null ? null : anchor;
};

/** 一个起点 slot 搬到这一层的形状上（起点是旧墙上的 slot）。 */
const startOnLayerShape = (key: string | null, from: BravaisWallShape, layer: BravaisLayer) => (
    moveStartSlotKey(key, from, resolveLayerShape(layer.shape, null))
);

/**
 * 同一层的数据更新：还在翻的磁贴（目标没变、这次又没安排它）保留原来的安排，不被打断。B9：整墙入场还在进行时
 * （换到一个还在加载的页签，数据随后到达），这一次的磁贴仍走整墙的那一步，只把目标换成新内容（不改成从起点翻牌）。
 */
const mergeFlipSteps = (
    previous: BravaisDisplay,
    next: BravaisDisplay,
    fresh: ReadonlyMap<string, BravaisFlipStep>,
    slots: readonly WallSlot[],
    waveRunning = false,
): ReadonlyMap<string, BravaisFlipStep> => {
    if (previous.flips.size === 0) return fresh;
    const merged = new Map(fresh);
    if (waveRunning) {
        for (const [key, step] of fresh) {
            const running = previous.flips.get(key);
            if (running?.wave) merged.set(key, { ...running, to: step.to });
        }
    }
    for (const slot of slots) {
        if (merged.has(slot.key)) continue;
        const step = previous.flips.get(slot.key);
        if (step && step.to === resolveSlotFaceKey(next, slot)) merged.set(slot.key, step);
    }
    return merged;
};

export const useBravaisDisplay = (layer: BravaisLayer | null, controls: BravaisDisplayControls) => {
    const [display, setDisplay] = useState<BravaisDisplay | null>(null);
    const ownDisplayRef = useRef<BravaisDisplay | null>(null);
    const displayRef = controls.displayRef ?? ownDisplayRef;
    const displayedDepthRef = useRef(controls.navigation.depth);
    /** 显示着的那一层打开时的导航来源（回到深度 0 时据此判断是不是回到搜索 / 播放页）。 */
    const displayedOriginRef = useRef(controls.navigation.origin);
    const shiftSeqRef = useRef(0);
    const flipTokenRef = useRef(0);
    const latestControls = useRef(controls);
    latestControls.current = controls;
    // 移除的第一段在放：期间来的层先不上墙，放完一次换上最新的（holdRelease 让 effect 重跑）。
    const holdRef = useRef<{ timer: ReturnType<typeof setTimeout>; origin: FlipOrigin } | null>(null);
    // 换形状的出场在放：放完时把要做的事交给 effect（与移除同一个 holdRef 按住数据更新）。
    const releasedShapeRef = useRef<ShapeChange | null>(null);
    const releasedOriginRef = useRef<FlipOrigin | null>(null);
    const [holdRelease, setHoldRelease] = useState(0);
    // 翻牌在放（含移除按住旧帧的那一段）：给 stage 根节点挂 data-bravais-settling，探针据此等墙落定再操作。
    // 只在一次翻牌开始与结束时各 setState 一次（离散）。
    const [isSettling, setIsSettling] = useState(false);
    const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** B9：整墙出场 / 入场放到什么时候（这之前同一层的数据更新沿用整墙的那一步，只换目标）。 */
    const waveUntilRef = useRef(0);
    // B9：一次翻牌还没放完又来一次（整墙入场途中数据到达）时，落定时刻取两者里晚的那个，不被短的那次提前撤掉。
    const settleUntilRef = useRef(0);
    const markSettling = useCallback((planned: number | undefined) => {
        if (!planned || planned <= 0) return;
        // 降低动态效果：磁贴不错开、各自淡出淡入，0.18s 就落定。
        const durationMs = latestControls.current.reducedTransitions ? BRAVAIS_REDUCED_FADE_MS : planned;
        setIsSettling(true);
        const now = performance.now();
        const until = Math.max(settleUntilRef.current, now + durationMs + REMOVAL_SETTLE_MS * 2);
        settleUntilRef.current = until;
        if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
        settleTimerRef.current = setTimeout(() => {
            settleTimerRef.current = null;
            if (!holdRef.current) setIsSettling(false);
        }, until - now);
    }, []);

    /**
     * 换上新的显示。shift 给了就是一次换层（记下种类与序号、导航来源）；没给是同一层的数据更新，沿用上一次的 shift，
     * 整墙入场还没放完时也沿用它（入场途中到达的数据照样落回，不重启）。
     */
    const commit = useCallback((next: BravaisDisplay, depth: number, shift?: BravaisShiftKind | 'first') => {
        const previous = displayRef.current;
        const now = performance.now();
        const carried = previous?.entrance && now < previous.entrance.until ? previous.entrance : null;
        const committed: BravaisDisplay = {
            ...next,
            shift: shift ? { kind: shift, seq: (shiftSeqRef.current += 1) } : previous?.shift ?? null,
            // 显式给了 null（换形状的出场）就不沿用还在放的入场。
            entrance: next.entrance !== undefined ? next.entrance : shift ? null : carried,
        };
        if (shift) displayedOriginRef.current = latestControls.current.navigation.origin;
        displayRef.current = committed;
        displayedDepthRef.current = depth;
        setDisplay(committed);
    }, []);

    /** 离开一层时记下它的相机、锚点、起点与键盘焦点。 */
    const remember = useCallback((current: BravaisDisplay) => {
        const { frameRef, getFocusedSlotKey } = latestControls.current;
        writeBravaisLayout(current.layer.sessionKey, {
            center: { ...frameRef.current.center },
            anchorX: frameRef.current.anchorX,
            anchorY: frameRef.current.anchorY,
            startSlotKey: current.startSlotKey,
            focusSlotKey: getFocusedSlotKey(),
            shapeKind: current.shape.kind,
        });
    }, []);

    const planFlipFor = useCallback((before: BravaisDisplay | null, after: BravaisDisplay, origin: FlipOrigin, slots?: readonly WallSlot[]) => {
        const { frameRef, slotsRef } = latestControls.current;
        const { view, center } = frameRef.current;
        if (!view) return null;
        flipTokenRef.current += 1;
        const plan = planFlip({
            changes: diffDisplays(before, after, slots ?? slotsRef.current),
            origin,
            visible: getViewWorldBounds(center, view, { ...seamBoundsOf(frameRef.current), overscan: FLIP_OVERSCAN }),
            metrics: BRAVAIS_METRICS,
        });
        return { steps: toFlipSteps(flipTokenRef.current, plan), durationMs: plan.durationMs };
    }, []);

    /** 整墙出场 → 入场：从视口左上角量波次（视口加 overscan 以内的磁贴动，其余直接换）。 */
    const planWaveFor = useCallback((before: BravaisDisplay | null, after: BravaisDisplay) => {
        const { frameRef, slotsRef } = latestControls.current;
        const { view, center } = frameRef.current;
        if (!view) return null;
        flipTokenRef.current += 1;
        const plan = planWallWave({
            changes: diffDisplays(before, after, slotsRef.current),
            viewport: getViewWorldBounds(center, view),
            visible: getViewWorldBounds(center, view, { ...seamBoundsOf(frameRef.current), overscan: FLIP_OVERSCAN }),
            metrics: BRAVAIS_METRICS,
        });
        return { steps: toWaveSteps(flipTokenRef.current, plan), durationMs: plan.durationMs };
    }, []);

    /** 整墙入场（B11）：从此刻视口的左上角量错开，入场窗口 = 最大错开 + 落回时长（降低动效时是 0.18s 的淡入）。 */
    const planEntrance = useCallback((): BravaisEntrance | null => {
        const { frameRef, reducedTransitions } = latestControls.current;
        const { view, center } = frameRef.current;
        if (!view) return null;
        flipTokenRef.current += 1;
        const bounds = getViewWorldBounds(center, view);
        const startedAt = performance.now();
        const durationMs = reducedTransitions ? BRAVAIS_REDUCED_FADE_MS : WALL_WAVE_MAX_DELAY_MS + WALL_WAVE_IN_MS;
        return { token: flipTokenRef.current, corner: { left: bounds.left, top: bounds.top }, startedAt, until: startedAt + durationMs, reduced: reducedTransitions };
    }, []);

    /**
     * 有限态（过滤）：沿用上一次的规划或以缝为中心重新规划；无限态为 null。相机范围随之更新。规划跳过部分透明的结构窗
     * （与显示同一个 k），换窗数时不沿用旧规划。
     */
    const resolveFinite = useCallback((next: BravaisLayer, previous: BravaisFiniteState | null | undefined, planned?: BravaisAnchor) => {
        const { frameRef, setCameraRange, openWidthFor, wallLook } = latestControls.current;
        const { view, center } = frameRef.current;
        // 平常按帧状态里的锚点规划；这次换层要换方向时帧状态里的锚点要等缝合上才换，按排好的锚点（planned）规划。
        const shown = anchorOf(frameRef.current);
        const anchor = planned && anchorAxis(planned) !== null && anchorAxis(planned) !== anchorAxis(shown) ? planned : shown;
        if (next.mode !== 'finite' || !view) {
            setCameraRange(null);
            return null;
        }
        const count = Math.max(next.items.length, next.wall?.planCount ?? 0);
        const reservedPerBlock = resolveReservedPerBlock(wallLook);
        const axis = anchorAxis(anchor) ?? 'x';
        // 同一层换了方向（横的信息条 ↔ 竖的面板）：沿用原来的规划（不整面重排），相机范围按此刻的方向算。
        const keepAcrossAxis = Boolean(previous && previous.axis !== axis && previous.reservedPerBlock === reservedPerBlock && count <= previous.capacity);
        const finite = previous && (keepAcrossAxis || canReuseFinitePlan(previous, { anchorX: anchor.x, anchorY: anchor.y, count, reservedPerBlock }))
            ? previous
            : planBravaisFinite({ count, anchorX: anchor.x, anchorY: anchor.y, center, view, reservedPerBlock });
        setCameraRange(resolveFiniteCameraRange({
            finite,
            itemCount: next.items.length,
            view,
            seamWidth: openWidthFor(next),
            seam: finite.axis === axis ? undefined : { axis, anchor: seamPointOf({ anchorX: anchor.x, anchorY: anchor.y, center }) },
        }), true);
        return finite;
    }, []);

    /** 缝换完方向（useBravaisSeam 合上再张开之后）：有限态的相机范围按新的方向与锚点重算（规划沿用）。 */
    const refreshFiniteRange = useCallback(() => {
        const current = displayRef.current;
        if (!current?.finite) return;
        resolveFinite(current.layer, current.finite);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- displayRef 是稳定的 ref
    }, [resolveFinite]);

    /** 用会话记着的焦点条目摆键盘焦点（离缝最近的那一份）。 */
    const focusSessionEntry = useCallback((next: BravaisDisplay) => {
        const key = next.layer.focusedEntryKey;
        if (!key) return null;
        const { frameRef } = latestControls.current;
        return findDisplayItemSlot(next, key, seamPointOf(frameRef.current))?.key ?? null;
    }, []);

    /**
     * 换形状的第一段：旧形状上整墙出场（目标全是墙面；降低动效时是淡出），按住到出场放完，再由 effect 换上新形状。
     * shift 给了就是一次换层（种类记在这一次上，第二段沿用它）。
     */
    const beginShapeChange = useCallback((previous: BravaisDisplay, layer: BravaisLayer, depth: number, change: ShapeChange, shift?: BravaisShiftKind) => {
        const { reducedTransitions, frameRef, collapseFocusCard } = latestControls.current;
        collapseFocusCard();
        // 移除放完时记下的翻牌起点是旧形状上的：丢掉。
        releasedOriginRef.current = null;
        const outgoing: BravaisDisplay = {
            ...previous,
            layer: { ...layer, items: [], shape: undefined },
            finite: null,
            hiddenKeys: undefined,
            entrance: null,
        };
        const seam = pointOrigin(seamPointOf(frameRef.current));
        const flips = reducedTransitions ? planFlipFor(previous, outgoing, seam) : planWaveFor(previous, outgoing);
        waveUntilRef.current = 0;
        commit({ ...outgoing, flips: flips?.steps ?? outgoing.flips, flipToken: flipTokenRef.current }, depth, shift);
        markSettling(flips?.durationMs);
        const release = () => {
            releasedShapeRef.current = change;
            holdRef.current = null;
            setHoldRelease(value => value + 1);
        };
        if (!flips || flips.steps.size === 0) {
            release();
            return;
        }
        const holdMs = reducedTransitions ? BRAVAIS_REDUCED_FADE_MS / 2 : WALL_WAVE_EXIT_TOTAL_MS;
        holdRef.current = { origin: seam, timer: setTimeout(release, holdMs + REMOVAL_SETTLE_MS) };
    }, [commit, markSettling, planFlipFor, planWaveFor]);

    /** 换形状的第二段：锚点挪到新形状的块边界（相机平移同样的距离），磁贴按新形状重新挂载、整墙入场。 */
    const finishShapeChange = useCallback((layer: BravaisLayer, change: ShapeChange) => {
        const controlsNow = latestControls.current;
        const { frameRef, wallLook } = controlsNow;
        const draft = createBravaisDisplay(layer, change.startSlotKey, undefined, wallLook);
        const axis = controlsNow.axisFor(layer);
        let center = change.center;
        let anchor = change.anchor;
        // 锚点挪到新形状的块边界、相机跟着平移（缝在屏幕上不动）；新层的缝换了方向时这条缝不用了，相机不跟着平移。
        const followsAnchor = anchorAxis(change.anchor) === axis;
        if (change.anchor.x !== null) {
            const anchorX = nearestShapeBoundaryX(draft.shape, change.anchor.x);
            if (followsAnchor) center = { ...center, x: center.x + anchorX - change.anchor.x };
            anchor = columnAnchor(anchorX);
        } else if (change.anchor.y !== null) {
            const anchorY = nearestShapeBoundaryY(draft.shape, change.anchor.y);
            if (followsAnchor) center = { ...center, y: center.y + anchorY - change.anchor.y };
            anchor = rowAnchor(anchorY);
        }
        // 换层：与平常的换层同一套开口规划（缝不在屏内时另开一道、歌手海报带到最左边、开口变宽时相机让位）。
        const width = change.preferAnchor === undefined ? 0 : controlsNow.openWidthFor(layer);
        if (width > 0) {
            const plan = controlsNow.planOpening(center, width, change.preferAnchor ? anchor : null, controlsNow.posterFor(layer), draft.shape, axis);
            anchor = plan.anchor;
            center = plan.center;
        }
        // 与改动前同一个时刻规划（锚点、相机都还是出场时的样子），只有换方向时用排好的锚点。
        const finite = resolveFinite(layer, null, anchor);
        if (anchorAxis(change.anchor) !== null || width > 0) controlsNow.setAnchor(anchor);
        if (change.tween) controlsNow.tweenTo(center);
        else controlsNow.moveTo(center, true);
        const entrance = planEntrance();
        commit({ ...draft, finite, entrance }, displayedDepthRef.current);
        if (entrance) markSettling(entrance.until - entrance.startedAt);
        controlsNow.restoreFocus(change.focusFromSession ? focusSessionEntry(draft) ?? change.focusKey : change.focusKey);
    }, [commit, focusSessionEntry, markSettling, planEntrance, resolveFinite]);

    useLayoutEffect(() => {
        const controlsNow = latestControls.current;
        const { frameRef, slotsRef } = controlsNow;
        const previous = displayRef.current;
        const { wallLook } = controlsNow;
        if (!layer || !controls.view) return;
        const { navigation } = controlsNow;
        const depth = navigation.depth;
        // 同一个键、深度变了（栈里有重复的集合，面包屑跳回同名的那一层）：store 的层正是导航此刻的那一层时才算换层。
        const sameKeyShift = previous !== null && previous.layer.key === layer.key
            && depth !== displayedDepthRef.current && layerMatchesNavigation(layer, navigation);
        if (previous && previous.layer === layer && !sameKeyShift && !releasedOriginRef.current && isDisplayedWallLook(previous, wallLook)) return;
        // 移除的第一段还在放：等它放完。
        if (holdRef.current && previous && previous.layer.key === layer.key && !sameKeyShift) return;
        const width = controlsNow.openWidthFor(layer);
        const seamPoint = () => seamPointOf(frameRef.current);
        const nearestToSeam = () => findNearestSlot(slotsRef.current, seamPoint())?.key ?? null;

        // 第一次（stage 挂载）：按记忆摆好相机与锚点，直接画出当前层，不跑翻牌。B11：从搜索 / 播放页打开集合时
        // （播放页回来 stage 才挂载）整墙入场。
        if (!previous) {
            const memory = readLayoutFor(layer);
            let center = memory?.center ?? frameRef.current.center;
            const draft = createBravaisDisplay(layer, memory?.startSlotKey ?? null, undefined, wallLook);
            // 没有记忆（或记着的是另一个方向）时锚点按相机落到这一层形状的块边界上（记忆里的已经搬好）。
            const axis = controlsNow.axisFor(layer);
            let anchor = anchorOnShape(draft.shape, axis, memoryAnchor(memory), center);
            if (width > 0) {
                const plan = controlsNow.planOpening(center, width, anchor, controlsNow.posterFor(layer), draft.shape, axis);
                anchor = plan.anchor;
                center = plan.center;
            }
            controlsNow.setAnchor(anchor);
            controlsNow.moveTo(center, true);
            releasePanelOnLayerChange('first', layer.key);
            const entering = depth > 0 && isSourceOrigin(navigation.origin) && !controlsNow.suppressEntrance?.();
            const entrance = entering ? planEntrance() : null;
            const next = { ...draft, finite: resolveFinite(layer, null), entrance };
            commit(next, depth, entering ? 'enter' : 'first');
            if (entrance) markSettling(entrance.until - entrance.startedAt);
            controlsNow.restoreFocus(memory?.focusSlotKey ?? focusSessionEntry(next));
            return;
        }

        // 换形状的出场放完了：同一层（期间没换层）就换上新形状。
        const shapeChange = releasedShapeRef.current;
        releasedShapeRef.current = null;
        if (shapeChange && previous.layer.key === layer.key && !sameKeyShift) {
            finishShapeChange(layer, shapeChange);
            return;
        }

        // 同一层的数据更新（含透光换档 / 换窗数：层没变但显示的透光偏好变了，按 update 翻）。
        if (previous.layer.key === layer.key && !sameKeyShift) {
            // 数据让形状变了（探索页的 section 到了 / 变了）：不原地翻，走换形状的两段。
            const startSlotKey = startOnLayerShape(previous.startSlotKey ?? nearestToSeam(), previous.shape, layer);
            const grown = resolveLayerShape(layer.shape, previous.startSlotKey);
            if (grown.id !== previous.shape.id && isGrownExploreShape(previous.shape, grown)) {
                // section 补到了：原地换上新形状（起点、原点照旧）。换了地的块重新挂载、按新的入场落回；留在原地的块上
                // 同一序号的条目变了，照平常的数据更新从起点翻。屏内没有块换地就不排入场（之后平移进来的磁贴不落回）。
                releasedOriginRef.current = null;
                controlsNow.collapseFocusCard();
                const draft = { ...createBravaisDisplay(layer, previous.startSlotKey, undefined, wallLook), finite: resolveFinite(layer, previous.finite) };
                const { kept, remounted } = splitGrownSlots(previous.shape, draft.shape, slotsRef.current);
                const start = shapeSlotFromKey(previous.shape, previous.startSlotKey);
                const fresh = planFlipFor(previous, draft, pointOrigin(start ? { x: start.centerX, y: start.centerY } : seamPoint()), kept);
                const flips = mergeFlipSteps(previous, draft, fresh?.steps ?? new Map(), kept, performance.now() < waveUntilRef.current);
                const entrance = remounted.length > 0 ? planEntrance() : null;
                // 没排入场时不给 entrance：还在放的入场照常沿用（commit）。
                commit({ ...draft, flips, flipToken: flipTokenRef.current, ...(entrance ? { entrance: { ...entrance, mountsOnly: true } } : {}) }, displayedDepthRef.current);
                markSettling(Math.max(fresh?.durationMs ?? 0, entrance ? entrance.until - entrance.startedAt : 0));
                return;
            }
            if (resolveLayerShape(layer.shape, startSlotKey).id !== previous.shape.id) {
                beginShapeChange(previous, layer, displayedDepthRef.current, {
                    startSlotKey,
                    center: { ...frameRef.current.center },
                    anchor: anchorOf(frameRef.current),
                    tween: false,
                    focusKey: null,
                    focusFromSession: false,
                });
                return;
            }
            const released = releasedOriginRef.current;
            releasedOriginRef.current = null;
            const dataDecision = released ? { kind: 'update' as const } : decideDataUpdate(previous, layer);
            const decision = dataDecision.kind === 'refresh' && !isDisplayedWallLook(previous, wallLook)
                ? { kind: 'update' as const }
                : dataDecision;
            if (decision.kind === 'refresh') {
                commit({ ...previous, layer }, displayedDepthRef.current);
                return;
            }
            const start = shapeSlotFromKey(previous.shape, previous.startSlotKey);
            const startPoint = start ? { x: start.centerX, y: start.centerY } : seamPoint();

            if (decision.kind === 'removal') {
                // 第一段：旧帧按住，只把消失的条目翻成墙面，从被删的那张（或离缝最近的一份）开始。
                const originKey = takeBravaisRemovalOrigin(layer.key)
                    ?? findDisplayItemSlot(previous, [...decision.removed][0], seamPoint())?.key
                    ?? null;
                const originSlot = shapeSlotFromKey(previous.shape, originKey);
                const origin = pointOrigin(originSlot ? { x: originSlot.centerX, y: originSlot.centerY } : seamPoint());
                const masked = maskRemovedEntries(previous, decision.removed);
                const flip = planFlipFor(previous, masked, origin);
                controlsNow.collapseFocusCard();
                commit({ ...masked, flips: flip?.steps ?? masked.flips, flipToken: flipTokenRef.current }, displayedDepthRef.current);
                markSettling(flip?.durationMs);
                if (flip && flip.durationMs > 0) {
                    holdRef.current = {
                        origin,
                        timer: setTimeout(() => {
                            releasedOriginRef.current = holdRef.current?.origin ?? origin;
                            holdRef.current = null;
                            setHoldRelease(value => value + 1);
                        }, flip.durationMs + REMOVAL_SETTLE_MS),
                    };
                    return;
                }
                releasedOriginRef.current = null;
            }

            const finite = resolveFinite(layer, previous.finite);
            const draft = { ...createBravaisDisplay(layer, previous.startSlotKey, undefined, wallLook), finite };
            const origin: FlipOrigin = released
                ?? (decision.kind === 'filter'
                    ? (frameRef.current.anchorY !== null
                        ? { kind: 'seam-edges', y: frameRef.current.anchorY }
                        : { kind: 'seam-edges', x: frameRef.current.anchorX ?? frameRef.current.center.x })
                    : pointOrigin(startPoint));
            // B11：整墙入场还在放（入场途中数据到达）：不另排翻牌，磁贴在抬起 / 落回途中直接换成新内容。
            const entering = Boolean(previous.entrance && performance.now() < previous.entrance.until);
            const fresh = entering ? null : planFlipFor(previous, draft, origin);
            // 整墙有内容在翻：聚焦卡收起（它所在的块也可能在翻）。
            if (fresh && fresh.steps.size > 0) controlsNow.collapseFocusCard();
            const flips = mergeFlipSteps(previous, draft, fresh?.steps ?? new Map(), slotsRef.current, performance.now() < waveUntilRef.current);
            commit({ ...draft, flips, flipToken: flipTokenRef.current }, displayedDepthRef.current);
            markSettling(fresh?.durationMs);
            return;
        }

        // 换层：上一层若还在按住移除的第一段，直接放弃。
        if (holdRef.current) {
            clearTimeout(holdRef.current.timer);
            holdRef.current = null;
        }
        releasedOriginRef.current = null;
        const kind = resolveShiftKind({
            fromDepth: displayedDepthRef.current,
            toDepth: depth,
            fromOrigin: displayedOriginRef.current,
            toOrigin: navigation.origin,
        });
        const leaving = kind === 'back' || kind === 'exit';
        const hadKeyboardFocus = controlsNow.getFocusedSlotKey() !== null;
        controlsNow.collapseFocusCard();
        // 起点只给 push 用（整墙入场没有起点磁贴：被点的不在墙上）；任何换层都把它取走丢掉。
        const taken = takeBravaisPendingOrigin(previous.layer.key);
        const pending = kind === 'push' || kind === 'replace' ? taken : null;
        if (!leaving) remember(previous);
        releasePanelOnLayerChange(kind === 'enter' ? 'push' : kind === 'exit' ? 'back' : kind, layer.key);

        let center = frameRef.current.center;
        // 这次换层要用的锚点（先放在本地，最后交给 setAnchor；墙上此刻按帧状态里的锚点分两半）。
        let anchor = anchorOf(frameRef.current);
        // 「缝在哪」按这次要用的锚点（返回 / 入场时是记忆里的），相机还是此刻的（与改动前先把记忆锚点写进帧状态再量一样）。
        const plannedSeamPoint = () => seamPointOf({ anchorX: anchor.x, anchorY: anchor.y, center: frameRef.current.center });
        const nearestToPlannedSeam = () => findNearestSlot(slotsRef.current, plannedSeamPoint())?.key ?? null;
        let startSlotKey: string | null;
        let origin: FlipOrigin;
        let focusKey: string | null = null;
        let focusFromSession = false;
        if (leaving) {
            const memory = readLayoutFor(layer);
            center = memory?.center ?? center;
            anchor = memoryAnchor(memory) ?? anchor;
            // B8：记忆里的起点是 null（这一层第一次画时没有起点，循环偏移按 0 算）也照记忆恢复，墙回到离开时的样子；
            // 只有没有记忆时才取离缝最近的 slot（以前一律取最近的，返回到这种层时整面墙换了一种排法）。
            startSlotKey = memory ? memory.startSlotKey : nearestToPlannedSeam();
            origin = pointOrigin(plannedSeamPoint());
            focusKey = memory?.focusSlotKey ?? null;
            focusFromSession = !focusKey;
        } else {
            const memory = pending ? null : readLayoutFor(layer);
            // 整墙入场回到这一层上次离开时的位置（相机与缝的锚点一起，起点磁贴才在屏内）。
            if (kind === 'enter' && memory?.center) {
                center = memory.center;
                anchor = memoryAnchor(memory) ?? anchor;
            }
            // 起点：被点的那张、离缝最近的是旧墙上的 slot，搬到新形状上；记忆里的（换页签前记下的）readLayoutFor 已经搬好，
            // 不再搬第二次。翻牌从它开始。
            const remembered = pending ? null : memory?.startSlotKey ?? null;
            const start = resolveShiftStart(
                remembered === null ? { onPrevious: pending?.slotKey ?? nearestToPlannedSeam() } : { remembered },
                previous.shape,
                layer.shape,
            );
            startSlotKey = start.key;
            origin = pointOrigin(start.slot ? { x: start.slot.centerX, y: start.slot.centerY } : plannedSeamPoint());
            if (hadKeyboardFocus) focusKey = startSlotKey;
            // 不是从一张磁贴打开的（从别处、换 suite 时正开着）：焦点落在会话记着的那一项上。
            focusFromSession = !pending && !hadKeyboardFocus;
        }
        // 换形状：这次换层先在旧形状上整墙出场，相机、锚点与新内容等出场放完再一起换（finishShapeChange）。
        if (resolveLayerShape(layer.shape, startSlotKey).id !== previous.shape.id) {
            // 与下面平常的换层同一个判断（此刻的锚点在不在屏内），落定时据此排开口。
            const preferAnchor = leaving || controlsNow.isAnchorOnScreen(anchor);
            if (width > 0 && controlsNow.axisFor(layer) !== anchorAxis(anchorOf(frameRef.current))) controlsNow.awaitAnchor?.();
            beginShapeChange(previous, layer, depth, {
                startSlotKey,
                center,
                anchor,
                tween: leaving,
                focusKey,
                focusFromSession,
                preferAnchor,
            }, kind);
            return;
        }
        // 缝保持张开：可见就沿用它的块边界，新开口放不下时相机最小让位（完全收起时不为看不见的缝平移相机）。
        // 新层的缝换了方向时不沿用（planOpening 只认同方向的），合上后在新方向上张开（useBravaisSeam）。
        if (width > 0) {
            const preferAnchor = leaving || controlsNow.isAnchorOnScreen(anchor);
            const plan = controlsNow.planOpening(center, width, preferAnchor ? anchor : null, controlsNow.posterFor(layer), previous.shape, controlsNow.axisFor(layer));
            anchor = plan.anchor;
            center = plan.center;
        }
        controlsNow.setAnchor(anchor);
        // 整墙入场：相机直接就位（被点的不在墙上，没有可以跟着走的东西），波次从就位后的视口左上角量。
        if (kind === 'enter') controlsNow.moveTo(center, true);
        const draft = { ...createBravaisDisplay(layer, startSlotKey, undefined, wallLook), finite: resolveFinite(layer, null, anchor) };
        const isHomeTabSwitch = kind === 'replace' && layer.surface === 'home' && previous.layer.surface === 'home';
        // 整墙波次：换首页页签（出场 → 入场）、歌手页 ↔ 专辑页与回到来源（出场；首页层在遮盖之下落回）。降低动效时换成
        // 普通翻牌（磁贴淡入淡出）。
        // 歌手页 ↔ 专辑页：同样整墙波次（歌手墙按对角线抬起淡出、曲目墙再按对角线落进来），封面另外从墙上飞到海报上
        // （bravaisCoverFlight）。
        const isArtistAlbumHop = (kind === 'push' && previous.layer.surface === 'artist' && Boolean(layer.seam.album))
            || (kind === 'back' && layer.surface === 'artist' && Boolean(previous.layer.seam.album));
        const waves = (isHomeTabSwitch || isArtistAlbumHop || kind === 'exit') && !controlsNow.reducedTransitions;
        const entrance = kind === 'enter' ? planEntrance() : null;
        const flips = entrance ? null : waves ? planWaveFor(previous, draft) : planFlipFor(previous, draft, origin);
        waveUntilRef.current = waves && flips ? performance.now() + flips.durationMs : 0;
        commit({ ...draft, flips: flips?.steps ?? draft.flips, flipToken: flipTokenRef.current, entrance }, depth, kind);
        markSettling(entrance ? entrance.until - entrance.startedAt : flips?.durationMs);
        if (kind !== 'enter') controlsNow.tweenTo(center);
        controlsNow.restoreFocus(focusFromSession ? focusSessionEntry(draft) ?? focusKey : focusKey);
    }, [beginShapeChange, commit, controls.navigation, controls.view, controls.wallLook, finishShapeChange, focusSessionEntry, holdRelease, layer, markSettling, planEntrance, planFlipFor, planWaveFor, remember, resolveFinite]);

    // stage 卸载（离开首页约 350ms 后）：记下当前层，回来时按它恢复；还在按住的移除第一段丢掉。
    useEffect(() => () => {
        if (holdRef.current) clearTimeout(holdRef.current.timer);
        if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
        holdRef.current = null;
        if (displayRef.current) remember(displayRef.current);
    }, [remember]);

    return { display, displayRef, isSettling, refreshFiniteRange };
};
