import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { WallSlot } from '../../../components/wall/wallSlots';
import { BRAVAIS_BLOCK_SHAPE, collectShapeSlots } from './bravaisWallShape';
import { FLIP_MAX_TILES } from '../../../components/wall/flipPlan';
import { useDevicePixelRatio, useMediaQuery } from '../../../hooks/useMediaQuery';
import { LIBRARY_WALL_PORTRAIT_QUERY, resolveLibraryWallSeamHorizontal } from '../../../utils/libraryWallSeamDirection';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { useLatticeSettingsStore } from '../../../stores/useLatticeSettingsStore';
import { useLibraryWallLookStore } from '../../../stores/useLibraryWallLookStore';
import type { LibrarySuiteStageProps } from '../../core/suite/suite.contract';
import { BRAVAIS_METRICS, BRAVAIS_OVERSCAN, BRAVAIS_SEAM_ACRYLIC_BLUR } from './bravaisConstants';
import { WALL_REFLOW_CONTROLS_REVEAL } from '../../../components/wall/wallReflowMotion';
import { resolveSlotItem, type BravaisDisplay } from './bravaisDisplay';
import type { BravaisLayer } from './bravaisLayer';
import { useBravaisSeamStore, type BravaisSeamLevel } from './bravaisSeamLevel';
import { resolveCurrentLayer, useBravaisStageStore } from './bravaisStageStore';
import BravaisSeam from './BravaisSeam';
import BravaisStageChrome from './BravaisStageChrome';
import BravaisWall from './BravaisWall';
import BravaisWallHint from './BravaisWallHint';
import { useBravaisCamera } from './useBravaisCamera';
import { useBravaisChromeActions } from './useBravaisChromeActions';
import { useBravaisDisplay } from './useBravaisDisplay';
import { useBravaisLocate } from './useBravaisLocate';
import { useBravaisFocus } from './useBravaisFocus';
import { useBravaisFrame } from './useBravaisFrame';
import { bravaisSlotFromKey, useBravaisInteractions, type BravaisStagePlayback } from './useBravaisInteractions';
import { useBravaisPlayingCard } from './useBravaisPlayingCard';
import { useBravaisKeyboard } from './useBravaisKeyboard';
import { useBravaisBlockPlates } from './useBravaisBlockPlates';
import { useBravaisReflowDriver } from './useBravaisReflowDriver';
import { useBravaisPlayerSafeArea } from './useBravaisPlayerSafeArea';
import { useBravaisPosterTilt } from './useBravaisPosterTilt';
import { albumPaletteVars, posterPaletteVars, resolvePosterPaletteSources, useBravaisPosterPalette } from './bravaisPosterPalette';
import { useBravaisSeam } from './useBravaisSeam';
import { useBravaisViewport } from './useBravaisViewport';
import { closeCommandFilter } from '../../../stores/useAppViewStore';
import { findDisplayItemSlot } from './bravaisItemSlots';
import { closeBravaisPanel, openBravaisPanel, syncPanelWithHistory } from './bravaisPanelHistory';
import { resolveSeamAxis, resolveSeamTarget, type BravaisSeamTargetInput } from './bravaisSeamTarget';
import { seamPointOf } from './bravaisAnchor';
import { setBravaisFilterEditing, useBravaisUiStore } from './bravaisUiStore';
import type { BravaisPanelActions } from './BravaisListPanel';
import { useBravaisWallLook } from './useBravaisWallLook';
import { opensBackdropFor } from './bravaisLook';
import { libraryWallSeamStyleVars } from '../../../utils/libraryWallSeamStyle';
import { setBravaisSearchOpen, useBravaisHomeUiStore } from './bravaisHomeUiStore';
import { useBravaisReducedTransitions } from './bravaisMotion';
import { useBravaisBeforePush } from './bravaisTransitions';
import { useWallHandoffStore } from '../../../stores/useWallHandoffStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { resolveBravaisBackStep, selectBravaisHasCurrentSong, type BravaisBackStep } from './bravaisBack';
import { resolveBravaisWallHandoffState, useBravaisWallHandoff } from './useBravaisWallHandoff';
import '../../../components/wall/wall.css';
import './bravais.css';
import './bravaisAppearance.css';
import './bravaisHandoff.css';
import './bravaisSeamLooks.css';

// src/library/suites/bravais/BravaisStage.tsx
// bravais 的常驻舞台（B1 的 stage 契约）：一面横跨首页与集合层的墙、相机、缝、翻牌、聚焦卡与键盘焦点。
// 层描述从 suite 内的 stage store 读（surface 推进来），stage 不碰 core 的资源与控制器。视觉沿用 Lattice
// （wall.css 的 .lattice-* 类与 --lattice-* 变量，跟随 Lattice 的染色与暗角设置），墙一律实色——透光（底板、窗、
// reportPlayerOcclusion）在 B6b③。高频的东西（相机、缝的开合、翻牌）都不经过 React：帧状态 + 直接写 DOM。
// 透光（B6b③，设计稿 §11）：实色档根节点画墙面并报告遮挡播放页；透明档根节点不画底，墙面交给世界层之下的实色底板
// （useBravaisPlate，遮罩只在窗位挖洞），缝的纸条换成半透明。
// B12b：底板改为按块的内联 SVG（useBravaisBlockPlates → BravaisWall 画进世界层、磁贴之下），不再有全屏遮罩底板与
// 局部底板；聚焦卡让位只逐帧重画那一块。
// B9：首页层的目录树面板与集合层的列表面板同一种开口；首页的全局搜索框开着时窄缝临时展开（search）；管理隐藏视图里
// 根节点挂 is-managing-hidden（歌单类磁贴的眼睛按钮常驻）。
// B10：登录与切换确认不在缝里（共用的登录窗口与回退到的 grid 确认框）。
// 实测反馈 1：灯光（is-lights-out）与叠色同 Lattice 一样读 useLatticeSettingsStore（一套墙面外观设置）；左上角隐藏式返回
// 与右下角工具按钮在 BravaisStageChrome，与 Lattice 共用 components/wall 的同一套控件。左上角返回的去处（bravaisBack）：
// 不在首页根层时与缝里的 ‹ 同一个返回，首页根层有歌时回到播放页、没有歌时不画。
// 2026-10-09：叠色与熄灯也作用到缝（bravaisAppearance.css）；集合的叠页边由根节点的 has-stack-edges 打开（设置可关）。
// 2026-10-09（seam looks）：缝的材质——「始终透明」（has-clear-seam，透出 visualizer，实色墙也不报遮挡）与实色模式的预设
// （data-bravais-seam-style + 根节点上的材质变量，bravaisSeamLooks.css）；透出画面的歌词 / 模糊经 reportPlayerBackdrop 报给宿主。
// 实测反馈 fb3：宿主的播放开关与「进入播放视图」交给聚焦卡（正在播放的那首：暂停 / 继续 + 进入）；从墙上播放后那首的
// 聚焦卡在回来 / 返回这一层时重新展开（useBravaisPlayingCard）。
// 翻牌交接（设计稿 §7「进入队列」）：进 / 出 Lattice 时这面墙与 Lattice 叠着换内容（useBravaisWallHandoff）。交接期间
// 缝的开口目标是 0（合上）、透光档墙面之下垫一层实色 veil（窗关上）、墙不接指针与键盘、根节点挂 data-wall-handoff；
// 回来时会话结束才算落定；fb3 的正在播放那首在缝开始张开时就展开（2026-10-10）。工具按钮在离开途中仍认领 dock，
// Lattice 后认领、盖在上面。
// 空墙说明（BravaisWallHint）：首页的来源因为还没连在线平台、还没导入本地文件夹而空着时，墙面上画一段背景字（wall.hint）。
// 信息条方向（useLibraryWallLookStore 的 seamDirection；两种自动都按视口是不是竖着的，转屏时缝合上再换方向张开）：横向时
// 首页窄缝 / 书脊、信息条 / 书脊与搜索框从块的横向缝隙裂开
// （resolveSeamAxis），墙上下分开；面板、表单与海报仍是竖的。根节点与缝挂 data-bravais-seam-axis（此刻画着的内容的方向）。

const expandBounds = (bounds: { left: number; right: number; top: number; bottom: number }, by: number) => ({
    left: bounds.left - by,
    right: bounds.right + by,
    top: bounds.top - by,
    bottom: bounds.bottom + by,
});

/**
 * 海报的取色来源（bravaisPosterPalette）：歌手页从这位歌手最火的三张专辑封面取；专辑页从这张专辑的封面取（专辑里有
 * 带自己封面的歌时，再补上它们）。
 */
const posterPaletteSourcesFor = (target: BravaisLayer | null): readonly string[] => {
    if (!target) return NO_SOURCES;
    const sources = resolvePosterPaletteSources(target.items);
    const albumCover = target.seam.album?.coverUrl;
    return albumCover ? [albumCover, ...sources.filter(url => url !== albumCover)].slice(0, 3) : sources;
};
const NO_SOURCES: readonly string[] = [];

const BravaisStage: React.FC<LibrarySuiteStageProps> = ({
    isInteractive,
    isDaylight,
    navigation: hostNavigation,
    reportPlayerOcclusion,
    reportPlayerBackdrop,
    onBackToPlayer,
    onTogglePlayback,
    onEnterPlaybackView,
    onOpenLattice,
}) => {
    const { t } = useTranslation();
    // 交接会话：缝的开口、veil、颗粒与暗角、磁贴藏不藏都按它（纯计算）；排动画的 hook 在下面（要等显示）。
    const handoffSession = useWallHandoffStore(state => state.session);
    const handoff = resolveBravaisWallHandoffState(handoffSession);
    // 进 Lattice 的那一刻导航层把集合栈清空（Lattice 的历史记录不带集合），墙不该在离开途中翻回首页层：离开期间沿用
    // 交接开始前的导航快照（回来时历史后退会把集合栈恢复，stage 重新挂载时看的是恢复后的那份）。
    const frozenNavigationRef = useRef(hostNavigation);
    if (handoff.role !== 'out') frozenNavigationRef.current = hostNavigation;
    const navigation = handoff.role === 'out' ? frozenNavigationRef.current : hostNavigation;
    const rootRef = useRef<HTMLElement>(null);
    const fieldRef = useRef<HTMLDivElement>(null);
    const leftRef = useRef<HTMLDivElement>(null);
    const rightRef = useRef<HTMLDivElement>(null);
    const seamRef = useRef<HTMLDivElement>(null);
    const seamContentRef = useRef<HTMLDivElement>(null);
    const tabRef = useRef<HTMLButtonElement>(null);
    const hintRef = useRef<HTMLDivElement>(null);
    const frameRefs = useMemo(() => ({ left: leftRef, right: rightRef, seam: seamRef, seamContent: seamContentRef, tab: tabRef, hint: hintRef }), []);
    const { stateRef: frameRef, renderFrame } = useBravaisFrame(frameRefs);
    const { wallLook, seamLook } = useBravaisWallLook(reportPlayerOcclusion, reportPlayerBackdrop);
    const view = useBravaisViewport(rootRef);
    const reducedMotion = useReducedMotionFor('lattice');
    // B11：换层的翻牌 / 波次按「降低动态效果」降级成淡入淡出（lattice 或 collectionMorph，见 bravaisMotion）。
    const reducedTransitions = useBravaisReducedTransitions();
    const devicePixelRatio = useDevicePixelRatio();
    const vignette = useLatticeSettingsStore(state => state.latticeVignette);
    const lightsOn = useLatticeSettingsStore(state => state.latticeLightsOn);
    const tintEnabled = useLatticeSettingsStore(state => state.latticePosterTintEnabled);
    const tintCustom = useLatticeSettingsStore(state => state.latticePosterTintUseCustomColor);
    const tintColor = useLatticeSettingsStore(state => state.latticePosterTintColor);
    const tintIntensity = useLatticeSettingsStore(state => state.latticePosterTintIntensity);
    const stackEdges = useLibraryWallLookStore(state => state.collectionStackEdges);
    const seamDirection = useLibraryWallLookStore(state => state.seamDirection);
    const portrait = useMediaQuery(LIBRARY_WALL_PORTRAIT_QUERY);
    const seamHorizontal = resolveLibraryWallSeamHorizontal(seamDirection, portrait);
    // 换层编排里按层算开口时读最新的（不进回调的依赖）。
    const seamHorizontalRef = useRef(seamHorizontal);
    seamHorizontalRef.current = seamHorizontal;

    // 当前层：首页时是首页层，集合层打开时是顶层；顶层还没到（lazy、交接、回退给 grid）时沿用上一次画的层。
    const home = useBravaisStageStore(state => state.home);
    const top = useBravaisStageStore(state => state.top);
    const previousLayerRef = useRef<BravaisLayer | null>(null);
    const { layer, owned } = resolveCurrentLayer({ depth: navigation.depth, home, top, previous: previousLayerRef.current });
    previousLayerRef.current = layer;

    // B7：缝此刻的开口——等级之上还有表单态、列表面板与过滤输入位的临时展开（bravaisSeamTarget；正在输入过滤词时
    // 书脊 / 折叠的缝展开成完整信息条，首页是窄缝）。
    const seamLevel = useBravaisSeamStore(state => state.level);
    const panelFor = useBravaisUiStore(state => state.panelFor);
    const linkedKey = useBravaisUiStore(state => state.linkedKey);
    const isFilterOpen = useBravaisUiStore(state => state.filterEditing);
    const isSearchOpen = useBravaisHomeUiStore(state => state.searchOpen);
    const seamInputFor = useCallback((
        target: BravaisLayer,
        live?: { level: BravaisSeamLevel; panelFor: string | null; filterOpen: boolean; searchOpen: boolean },
    ): BravaisSeamTargetInput => {
        const current = live ?? {
            level: useBravaisSeamStore.getState().level,
            panelFor: useBravaisUiStore.getState().panelFor,
            filterOpen: useBravaisUiStore.getState().filterEditing,
            searchOpen: useBravaisHomeUiStore.getState().searchOpen,
        };
        return {
            surface: target.surface,
            level: current.level,
            viewportWidth: frameRef.current.view?.width ?? window.innerWidth,
            formOpen: Boolean(target.seam.collection?.form),
            panelOpen: current.panelFor === target.key && Boolean(target.entries?.hasPanel),
            filterOpen: current.filterOpen,
            searchOpen: current.searchOpen,
            // 海报（歌手页、专辑页）只画在无限拼贴上：过滤生效（有限拼贴）时 rank 围着锚点两边排，海报会挡住一半。
            poster: (target.surface === 'artist' || Boolean(target.seam.album)) && target.mode !== 'finite',
            horizontal: seamHorizontalRef.current,
        };
    }, [frameRef]);
    const resolvedSeamTarget = layer
        ? resolveSeamTarget({
            ...seamInputFor(layer, { level: seamLevel, panelFor, filterOpen: isFilterOpen && owned, searchOpen: isSearchOpen }),
            viewportWidth: view?.width ?? 0,
            horizontal: seamHorizontal,
        })
        : { width: 0, variant: 'none' as const };
    const seamAxis = resolveSeamAxis(resolvedSeamTarget.variant, seamHorizontal);
    // 交接时缝合上：只把开口目标换成 0，内容不换（缝里画的仍是这一层，开口补间让它随宽度淡出 / 淡入）。
    const seamTarget = handoff.seamClosed
        ? { width: 0, variant: resolvedSeamTarget.variant, axis: seamAxis }
        : { ...resolvedSeamTarget, axis: seamAxis };
    const openWidthFor = useCallback((target: BravaisLayer) => (
        resolveSeamTarget(seamInputFor(target)).width
    ), [seamInputFor]);
    const posterFor = useCallback((target: BravaisLayer) => (
        resolveSeamTarget(seamInputFor(target)).variant === 'poster'
    ), [seamInputFor]);
    // 这一层的缝开在哪个方向；折叠时（没有方向）按设置给恢复后多半会用的方向。
    const axisFor = useCallback((target: BravaisLayer) => {
        const horizontal = seamHorizontalRef.current;
        return resolveSeamAxis(resolveSeamTarget(seamInputFor(target)).variant, horizontal) ?? (horizontal ? 'y' : 'x');
    }, [seamInputFor]);

    const camera = useBravaisCamera({ frameRef, renderFrame, fieldRef, reducedMotion });
    // 墙此刻的显示（useBravaisDisplay 提交时就写进它）：形状从它读，换形状的同一次提交里各处就按新形状找 slot。
    const displayBridgeRef = useRef<BravaisDisplay | null>(null);
    const getShape = useCallback(() => displayBridgeRef.current?.shape ?? BRAVAIS_BLOCK_SHAPE, []);
    // 缝换完方向时让换层编排重算有限态的相机范围（编排的 hook 在下面，经 ref 接上）。
    const refreshFiniteRangeRef = useRef<(() => void) | null>(null);
    const onAxisSettled = useCallback(() => refreshFiniteRangeRef.current?.(), []);
    const seam = useBravaisSeam({
        getShape,
        onAxisSettled,
        frameRef,
        renderFrame,
        layer,
        target: seamTarget,
        viewportWidth: view?.width ?? 0,
        contentRef: seamContentRef,
        reducedMotion,
        reducedTransitions,
        tweenCamera: camera.tweenTo,
        checkCull: camera.checkCull,
    });
    const { bottomPx, getBottomInset } = useBravaisPlayerSafeArea();
    // 歌手海报在场时整层（两半墙与缝）一起倾斜，倾斜着照样拖动、滚动（useBravaisPosterTilt）。从横的信息条换过来时
    // 等横条合上、竖的海报换上来再转（横条在场时帧里没有倾斜，提前开始补间会在换方向那一刻跳一下）。
    useBravaisPosterTilt({
        frameRef,
        renderFrame,
        checkCull: camera.checkCull,
        poster: seamTarget.variant === 'poster' && seamTarget.width > 0 && seam.rendered.axis !== 'y',
        reducedMotion,
    });

    // 量到视口（或尺寸变了）：写进帧状态，相机保持视图中心不动，重新裁剪；跨过窄屏阈值时缝回到新宽度的默认等级。
    useLayoutEffect(() => {
        if (!view) return;
        frameRef.current.view = view;
        useBravaisSeamStore.getState().syncViewport(view.width);
        camera.moveTo(frameRef.current.center, true);
    }, [camera.moveTo, frameRef, view]);

    // 此刻渲染着的 slot（按显示的形状裁剪，见下面 useBravaisDisplay 之后）。
    const slotsRef = useRef<readonly WallSlot[]>([]);

    // 键盘焦点换了：把 slot 换成条目 key 交给层描述（集合页据此写回浏览会话）。
    const onFocusEntry = useCallback((slotKey: string | null) => {
        const current = displayBridgeRef.current;
        const slot = bravaisSlotFromKey(slotKey, current?.shape);
        current?.layer.onFocusEntry?.(slot ? resolveSlotItem(current, slot)?.key ?? null : null);
    }, []);
    const focus = useBravaisFocus({ frameRef, tweenTo: camera.tweenTo, getBottomInset, onFocusEntry, getShape });

    const { display, displayRef, isSettling, refreshFiniteRange } = useBravaisDisplay(layer, {
        frameRef,
        view,
        wallLook,
        slotsRef,
        navigation,
        reducedTransitions,
        openWidthFor,
        posterFor,
        axisFor,
        setCameraRange: camera.setRange,
        setAnchor: seam.setAnchor,
        planOpening: seam.planOpening,
        isAnchorOnScreen: seam.isAnchorOnScreen,
        awaitAnchor: seam.awaitAnchor,
        moveTo: camera.moveTo,
        tweenTo: camera.tweenTo,
        collapseFocusCard: focus.collapse,
        getFocusedSlotKey: () => focus.focusedRef.current,
        restoreFocus: key => focus.focusSlot(bravaisSlotFromKey(key, getShape())),
        // 从 Lattice 翻牌交接回来：磁贴由交接翻进来，不再跑整墙入场。
        suppressEntrance: () => resolveBravaisWallHandoffState(useWallHandoffStore.getState().session).role === 'in',
        displayRef: displayBridgeRef,
    });
    refreshFiniteRangeRef.current = refreshFiniteRange;
    const shape = display?.shape ?? BRAVAIS_BLOCK_SHAPE;
    const slots = useMemo<readonly WallSlot[]>(() => (
        camera.bounds ? collectShapeSlots(shape, expandBounds(camera.bounds, BRAVAIS_OVERSCAN), FLIP_MAX_TILES) : []
    ), [camera.bounds, shape]);
    slotsRef.current = slots;
    // B11 transitions.beforePush：宿主压栈之前，没经过墙上磁贴的打开用键盘焦点所在的 slot 当起点磁贴。
    const getFocusedSlotKey = useCallback(() => focus.focusedRef.current, [focus.focusedRef]);
    useBravaisBeforePush(displayRef, getFocusedSlotKey);

    const playbackRef = useRef<BravaisStagePlayback>({});
    playbackRef.current = { toggle: onTogglePlayback, enter: onEnterPlaybackView };
    const interactions = useBravaisInteractions({
        displayRef,
        focus,
        slotsRef,
        frameRef,
        tweenTo: camera.tweenTo,
        rootRef,
        fieldRef,
        seamRef,
        seamTabRef: tabRef,
        playbackRef,
        togglesCurrent: Boolean(onTogglePlayback),
        hasEnter: Boolean(onEnterPlaybackView),
    });
    // 交接期间墙不算落定。fb3 的「正在播放那首重新展开」：从 Lattice 回来时在翻完、缝开始张开（opening）那一刻就展开，
    // 与缝张开、窗打开同时进行（2026-10-10 用户：先等缝张开再放大，节奏拖沓）；相机让位按张开后的缝算。
    const settling = isSettling || (handoff.role !== null && !(handoff.role === 'in' && handoff.phase === 'opening'));
    useBravaisPlayingCard({ display, isSettling: settling, focus, frameRef });
    // 透光以墙上此刻显示的档位为准（换档时与翻牌同一次提交）；还没有显示时看偏好。
    const seeThrough = (display?.look ?? wallLook.look) !== 'solid';
    // 透出播放页的地方：透光档的窗，或「始终透明」的缝（2026-10-09）。实色档 + 透明缝时根节点同样不画墙面、改由块底板铺
    // （缝开口下面没有底板），交接时同样要先盖 veil、visualizer 等窗关上才卸载。
    const backdropOpen = opensBackdropFor(display?.look ?? wallLook.look, seamLook.seamClear);
    useBravaisWallHandoff({
        session: handoffSession,
        rootRef,
        frameRef,
        display,
        canHandoff: isInteractive && owned && Boolean(display) && Boolean(view),
        seeThrough: backdropOpen,
        reducedMotion,
        reducedTransitions,
        expandedSlotKey: focus.expandedSlotKey,
        focusedRef: focus.focusedRef,
    });
    const plates = useBravaisBlockPlates({
        enabled: backdropOpen,
        slots,
        display,
        expandedSlotKey: focus.expandedSlotKey,
        reflow: focus.reflow,
        anchorX: seam.anchor.x,
        anchorY: seam.anchor.y,
    });
    // 聚焦卡块内让位：磁贴外框与透光底板的洞同一帧逐帧写（2026-10-09 起，不再是 CSS 过渡）。
    const platesRef = useRef(plates);
    platesRef.current = plates;
    useBravaisReflowDriver({ reflow: focus.reflow, enabled: !reducedMotion, fieldRef, platesRef, getShape });

    const active = isInteractive && owned && Boolean(layer?.isInteractive) && handoff.role === null;
    useBravaisKeyboard(active, interactions.handleAction);
    // B7 列表面板：打开是一次导航（写 history，面包屑多「列表」），打开时等级拉回 full；单击一行定位到离缝最近的一份并
    // 聚焦（歌曲直接展开聚焦卡），双击播放。
    const openList = useCallback(() => {
        const current = displayRef.current?.layer;
        if (!current?.entries?.hasPanel) return;
        if (useBravaisSeamStore.getState().level !== 'full') useBravaisSeamStore.getState().setLevel('full');
        openBravaisPanel(current.key);
    }, [displayRef]);
    // 定位到墙上的一份（列表面板的单击、「定位正在播放」）：键盘焦点落在它上面，相机把它移到屏幕中间（与网格集合页的定位
    // 一样）；歌曲还展开聚焦卡，居中的是展开后的卡。
    const showSlot = useCallback((slot: WallSlot) => {
        const current = displayRef.current;
        const isTrack = current ? resolveSlotItem(current, slot)?.kind === 'track' : false;
        focus.focusSlot(slot);
        if (isTrack) focus.expand(slot, { centered: true });
        else focus.reveal(focus.drawnRect(slot), { centered: true });
    }, [displayRef, focus.drawnRect, focus.expand, focus.focusSlot, focus.reveal]);
    const panelActions = useMemo<BravaisPanelActions>(() => ({
        close: closeBravaisPanel,
        fold: () => useBravaisSeamStore.getState().setLevel('hidden'),
        locate: itemKey => {
            const slot = findDisplayItemSlot(displayRef.current, itemKey, seamPointOf(frameRef.current));
            if (slot) showSlot(slot);
        },
        play: itemKey => displayRef.current?.layer.onPlayItem?.(itemKey),
    }), [displayRef, frameRef, showSlot]);
    // 浏览器后退 / 前进：面板开合跟着 history 记录上的标记走。回到首页（导航栈空了）时面板一定收起。
    useEffect(() => {
        window.addEventListener('popstate', syncPanelWithHistory);
        return () => window.removeEventListener('popstate', syncPanelWithHistory);
    }, []);
    useEffect(() => {
        // 首页层自己的面板（B9 的目录树）不在此列：它跟着首页层与 history 记录走。
        const open = useBravaisUiStore.getState().panelFor;
        if (navigation.depth === 0 && open !== null && open !== useBravaisStageStore.getState().home?.layer.key) {
            useBravaisUiStore.setState({ panelFor: null });
        }
    }, [navigation.depth]);
    // 过滤输入：换了层（push、返回、换页签）或 stage 卸载时结束（过滤词留在各层的会话里）。
    const layerKey = layer?.key ?? null;
    useEffect(() => {
        setBravaisFilterEditing(false);
    }, [layerKey]);
    useEffect(() => () => setBravaisFilterEditing(false), []);
    // B9 全局搜索框：折叠缝、离开首页层（打开了集合）时关上；stage 卸载（离开首页、换 suite）时也关上。
    useEffect(() => {
        if (seamLevel === 'hidden' || navigation.depth > 0) setBravaisSearchOpen(false);
    }, [navigation.depth, seamLevel]);
    useEffect(() => () => setBravaisSearchOpen(false), []);
    // 过滤输入位里按 ↓ / Enter（或命令面板浮层过滤框里按 ↓）：结束输入（过滤词保留，缝缩回原等级），键盘焦点交给墙上的
    // 第 1 项（有限拼贴的 rank 0）。
    const { handleAction, focusWall } = interactions;
    useEffect(() => {
        if (!active) return;
        const focusFirst = () => {
            closeCommandFilter();
            setBravaisFilterEditing(false);
            focusWall();
            return handleAction({ type: 'first' }, null);
        };
        useBravaisUiStore.setState({ focusFirst });
        return () => {
            if (useBravaisUiStore.getState().focusFirst === focusFirst) useBravaisUiStore.setState({ focusFirst: null });
        };
    }, [active, focusWall, handleAction]);

    const chromeHandlers = useBravaisChromeActions({
        active,
        displayRef,
        frameRef,
        isCollapsed: seam.isCollapsed,
        reopenHere: seam.reopenHere,
        showSlot,
        openList,
    });
    // 「定位正在播放」问到这一层时回答（集合层；首页层不被问）。
    useBravaisLocate({ display, active, isSettling: settling, frameRef, showSlot });
    // 工具按钮上方的定位按钮：有歌在放时画；首页层（定位器不问它）只在这首在墙上时画。
    const hasSong = usePlaybackStore(state => state.currentSong !== null);
    const locatePageKey = layer?.locate?.pageKey ?? null;
    const isPlayingHere = Boolean(layer?.nowPlayingKey);
    const locateRun = chromeHandlers['locate-playing'].run;
    const locatePlaying = useMemo(() => (
        hasSong && (locatePageKey !== null || isPlayingHere) ? { run: locateRun, isHere: isPlayingHere, pageKey: locatePageKey } : null
    ), [hasSong, isPlayingHere, locatePageKey, locateRun]);

    const setLevel = useCallback((level: BravaisSeamLevel) => useBravaisSeamStore.getState().setLevel(level), []);
    // 边缘标签：折叠时恢复，出屏收起时在这里裂开。键盘激活（Enter / Space，click 的 detail 为 0）时标签随即藏起，
    // 焦点不落空：等缝张开后交进缝里（落点同 Tab 进缝）。
    const { focusSeamWhenOpen } = interactions;
    const onSeamTab = useCallback((event?: MouseEvent<HTMLButtonElement>) => {
        if (useBravaisSeamStore.getState().level === 'hidden') useBravaisSeamStore.getState().restore();
        else seam.reopenHere();
        if (event?.detail === 0) focusSeamWhenOpen();
    }, [focusSeamWhenOpen, seam.reopenHere]);

    // 左上角返回（bravaisBack）：渲染时判一次（显不显示、可访问名），点击时按最新的层、面板与播放状态再判一次。
    const hasCurrentSong = usePlaybackStore(selectBravaisHasCurrentSong);
    const backToPlayerRef = useRef(onBackToPlayer);
    backToPlayerRef.current = onBackToPlayer;
    const resolveBackStep = useCallback((target: BravaisLayer | null, openPanel: string | null, songLoaded: boolean): BravaisBackStep | null => {
        const hasPlayer = songLoaded && Boolean(backToPlayerRef.current);
        if (!target) return hasPlayer ? 'player' : null;
        return resolveBravaisBackStep({
            hasPanel: openPanel !== null && openPanel === target.key,
            hasForm: Boolean(target.entries?.hasForm),
            canLeaveLayer: Boolean(target.onDone),
            hasPlayer,
        });
    }, []);
    const runBack = useCallback(() => {
        const current = displayRef.current?.layer ?? null;
        const step = resolveBackStep(current, useBravaisUiStore.getState().panelFor, selectBravaisHasCurrentSong(usePlaybackStore.getState()));
        if (step === 'panel') closeBravaisPanel();
        else if (step === 'form') current?.entries?.cancelForm?.();
        else if (step === 'layer') current?.onDone?.();
        else if (step === 'player') backToPlayerRef.current?.();
    }, [displayRef, resolveBackStep]);
    const backStep = resolveBackStep(display?.layer ?? layer, panelFor, hasCurrentSong);
    const back = useMemo(() => (backStep ? { step: backStep, run: runBack } : null), [backStep, runBack]);

    // 空墙说明（层描述的 wall.hint）：跟着显示着的那一层走（换页签时随整墙出场 / 入场换），层里有条目就不画，交接时藏起；
    // 没有说明时淡出，淡出途中留着上一条的文字。显示出来的那一刻按此刻的缝写一次横向区间（之后每帧由 renderFrame 写）。
    const wallHint = display && display.layer.items.length === 0 ? display.layer.wall?.hint ?? null : null;
    const lastWallHintRef = useRef(wallHint);
    if (wallHint) lastWallHintRef.current = wallHint;
    const wallHintShown = wallHint !== null && !handoff.role;
    useLayoutEffect(() => {
        if (wallHintShown) renderFrame();
    }, [renderFrame, wallHintShown]);

    // 点墙面空白处（不是磁贴）收起聚焦卡；拖动后的残余点击已被 onClickCapture 吞掉。
    const onFieldClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
        if (event.target instanceof Element && event.target.closest('.bravais-tile')) return;
        focus.collapse();
    }, [focus.collapse]);

    // 信息条的预设（§5「缝的材质」）：主题纸色以外的预设把材质写成根节点上的自定义属性；透明的缝不写（预设不生效）。
    const seamStyleVars = useMemo(() => (seamLook.seamStyle ? libraryWallSeamStyleVars(seamLook.seamStyle) : null), [seamLook.seamStyle]);
    // 海报与旁边那面墙共用一套颜色（bravaisPosterPalette）：歌手页从这位歌手最火的三张专辑封面取；专辑页从这张专辑的
    // 封面取（专辑里有带自己封面的歌时，再补上它们）。
    const posterActive = seamTarget.variant === 'poster';
    const albumPoster = posterActive && Boolean(layer?.seam.album);
    const renderedPosterLayer = seam.rendered.variant === 'poster' ? seam.rendered.layer : null;
    // 同一层换形态（点过滤、开列表面板、表单）时目标先不是海报了，海报还要转出去半圈：颜色等它换下来再撤，不然转出的
    // 那一拍回退成默认色（专辑页是藏青色块）。
    const paletteLayer = posterActive || (renderedPosterLayer && renderedPosterLayer.key === layer?.key) ? layer : null;
    const posterSources = useMemo(() => posterPaletteSourcesFor(paletteLayer), [paletteLayer]);
    const posterPalette = useBravaisPosterPalette(posterSources, Boolean(paletteLayer));
    // 缝里此刻画着的海报可能还是上一层的（换层时缝的内容晚一拍才换，约 0.2s）：它的颜色也留着，不然那一拍里它读不到
    // 自己的颜色、回退成默认色，看着像闪了一下。歌手与专辑两套变量名不同，可以同时在。
    const lingeringPoster = renderedPosterLayer && renderedPosterLayer.key !== layer?.key ? renderedPosterLayer : null;
    const lingeringSources = useMemo(() => posterPaletteSourcesFor(lingeringPoster), [lingeringPoster]);
    const lingeringPalette = useBravaisPosterPalette(lingeringSources, Boolean(lingeringPoster));
    const posterVars = useMemo(() => {
        const varsFor = (target: BravaisLayer | null, palette: typeof posterPalette) => {
            if (!target) return {};
            return target.seam.album ? albumPaletteVars(palette?.album ?? null) : posterPaletteVars(palette?.artist ?? null);
        };
        return { ...varsFor(lingeringPoster, lingeringPalette), ...varsFor(paletteLayer, posterPalette) };
    }, [lingeringPalette, lingeringPoster, paletteLayer, posterPalette]);

    const rootClassName = [
        'lattice-root',
        'bravais-root',
        isDaylight ? 'is-daylight' : '',
        vignette ? 'has-vignette' : '',
        lightsOn ? '' : 'is-lights-out',
        tintEnabled ? 'has-poster-tint' : '',
        tintCustom ? 'uses-custom-poster-tint' : '',
        stackEdges ? 'has-stack-edges' : '',
        layer?.wall?.loading ? 'is-loading' : '',
        seeThrough ? 'is-see-through' : '',
        backdropOpen ? 'is-backdrop-open' : '',
        seamLook.seamClear ? 'has-clear-seam' : '',
        seamLook.backdropBlur ? 'has-backdrop-blur' : '',
        seeThrough && BRAVAIS_SEAM_ACRYLIC_BLUR ? 'has-seam-blur' : '',
        display?.layer.seam.home?.manage ? 'is-managing-hidden' : '',
        display?.layer.home?.batch ? 'is-batch' : '',
        // 歌手海报在场：墙上的磁贴改成海报的样子（间隔拉开、封面保持正方形，bravaisPoster.css）。
        posterActive && !albumPoster ? 'has-poster-wall' : '',
        // 专辑海报在场：墙上的曲目画成这张封面的拼贴或碎片（bravaisAlbumPoster.css）。
        albumPoster ? 'has-album-wall' : '',
    ].filter(Boolean).join(' ');

    return (
        <section
            ref={rootRef}
            className={rootClassName}
            style={{
                '--lattice-poster-tint-color': tintColor,
                '--lattice-poster-tint-intensity': tintIntensity,
                '--bravais-focus-reveal-delay': `${WALL_REFLOW_CONTROLS_REVEAL.delayMs}ms`,
                '--bravais-focus-reveal-duration': `${WALL_REFLOW_CONTROLS_REVEAL.durationMs}ms`,
                '--bravais-focus-reveal-rise': `${WALL_REFLOW_CONTROLS_REVEAL.risePx}px`,
                ...seamStyleVars,
                ...posterVars,
            } as CSSProperties}
            data-library-stage="bravais"
            data-bravais-layer={display?.layer.key}
            data-bravais-active={active || undefined}
            data-bravais-settling={settling || undefined}
            data-wall-handoff={handoff.role ?? undefined}
            data-wall-handoff-phase={handoff.phase ?? undefined}
            data-wall-handoff-mode={handoff.mode ?? undefined}
            data-wall-handoff-hold={handoff.hold || undefined}
            data-wall-handoff-overlays={handoff.overlaysOff ? 'off' : undefined}
            data-wall-handoff-veil={backdropOpen && handoff.veilOn ? 'on' : undefined}
            data-bravais-shift={display?.shift?.kind}
            data-bravais-shift-seq={display?.shift?.seq}
            data-bravais-look={display?.look ?? wallLook.look}
            data-bravais-seam-style={seamLook.seamStyle ?? 'clear'}
            data-bravais-seam-axis={seam.rendered.axis ?? undefined}
            aria-label={t('libraryBravais.wallLabel')}
        >
            {/* 交接时关窗：透光档墙面之下的一层实色（与实色档的墙面同一份底色与光晕），开 / 关各淡 0.2s。 */}
            {backdropOpen && <div className="bravais-handoff-veil" data-veil={handoff.veilOn ? 'on' : 'off'} aria-hidden="true" />}
            <div
                ref={fieldRef}
                className="lattice-field bravais-field"
                tabIndex={-1}
                onPointerDown={camera.pointer.onPointerDown}
                onPointerMove={camera.pointer.onPointerMove}
                onPointerUp={camera.pointer.onPointerUp}
                onPointerCancel={camera.pointer.onPointerCancel}
                onLostPointerCapture={event => {
                    if (event.target === event.currentTarget) camera.pointer.onPointerCancel(event);
                }}
                onClickCapture={camera.pointer.onClickCapture}
                onClick={onFieldClick}
            >
                <BravaisWall
                    slots={view ? slots : []}
                    display={display}
                    anchorX={seam.anchor.x}
                    anchorY={seam.anchor.y}
                    reflow={focus.reflow}
                    expandedSlotKey={focus.expandedSlotKey}
                    focusedSlotKey={focus.focusedSlotKey}
                    linkedKey={panelFor !== null && panelFor === display?.layer.key ? linkedKey : null}
                    pixelScale={(view?.scale ?? 1) * devicePixelRatio}
                    reducedMotion={reducedTransitions}
                    didDragRef={camera.pointer.didDragRef}
                    handlers={interactions.handlers}
                    leftRef={leftRef}
                    rightRef={rightRef}
                    plates={plates}
                />
                <BravaisWallHint ref={hintRef} hint={wallHint ?? lastWallHintRef.current} shown={wallHintShown} />
            </div>
            <BravaisSeam
                seamRef={seamRef}
                contentRef={seamContentRef}
                tabRef={tabRef}
                variant={seam.rendered.variant}
                axis={seam.rendered.axis}
                leaving={seam.leaving}
                contentWidth={seam.rendered.width}
                layer={seam.rendered.layer}
                currentLayer={layer}
                level={seam.level}
                navigation={navigation}
                bottomPx={bottomPx}
                setLevel={setLevel}
                onTab={onSeamTab}
                openList={openList}
                panel={panelActions}
                openShortcut={interactions.openShortcut}
            />
            <BravaisStageChrome
                isDaylight={isDaylight}
                toolsClaimed={(isInteractive && owned) || handoff.role === 'out'}
                back={back}
                locatePlaying={locatePlaying}
                onOpenLattice={onOpenLattice}
            />
        </section>
    );
};

export default BravaisStage;
