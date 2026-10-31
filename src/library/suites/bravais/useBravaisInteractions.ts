import { useCallback, useMemo, useRef, type MutableRefObject, type RefObject } from 'react';
import { getViewWorldBounds, type WallViewCenter } from '../../../components/wall/wallView';
import type { WallDirection } from '../../../components/wall/wallNavigation';
import { overlaps } from '../../../components/wall/layout';
import type { WallSlot } from '../../../components/wall/wallSlots';
import { BRAVAIS_BLOCK_SHAPE, shapeSlotFromKey, type BravaisWallShape } from './bravaisWallShape';
import { findNearestSlot, resolveSlotFace, resolveSlotItem, type BravaisDisplay } from './bravaisDisplay';
import { findDisplayItemSlot } from './bravaisItemSlots';
import type { BravaisHomeShortcut } from './bravaisHomeModels';
import { resolveEscapeStep, type BravaisKeyAction } from './bravaisKeyboardModel';
import type { BravaisHomeKeyAction } from './bravaisHomeKeys';
import { findAdjacentSlot } from './bravaisNavigation';
import { setBravaisPendingOrigin } from './bravaisStageStore';
import { armBravaisPlayingCard } from './bravaisPlayingCard';
import { closeBravaisPanel } from './bravaisPanelHistory';
import { setBravaisWallHoverKey, useBravaisUiStore } from './bravaisUiStore';
import { setBravaisSearchOpen } from './bravaisHomeUiStore';
import { useBravaisSeamStore } from './bravaisSeamLevel';
import { canTakeSeamFocus, resolveSeamEntry, resolveSeamStep } from './bravaisSeamFocus';
import { BRAVAIS_SEAM_FLIP_ATTRIBUTE } from './bravaisSeamMotion';
import type { BravaisTileHandlers } from './BravaisTile';
import type { BravaisFrameState } from './useBravaisFrame';
import type { useBravaisFocus } from './useBravaisFocus';
import { seamPointOf } from './bravaisAnchor';

// src/library/suites/bravais/useBravaisInteractions.ts
// 点击与按键 → 动作：点歌曲磁贴就地展开聚焦卡（不播放），点歌单 / 专辑卡 push 下一层（先把被点的 slot 记成新层的
// 起点）；聚焦卡上的「立即播放」「加入队列」、歌手 / 专辑链接；方向键空间导航、Enter / Shift+Enter / Alt+Enter、
// Esc 阶梯、Home、PgUp / PgDn、Tab 在墙与缝之间。动作一律经层描述的回调交给 surface，stage 不碰数据。
// B9 首页：批量模式（目录树面板开着）里点卡片 / Enter 只切换选中、绝不进入文件夹（拖动后的残余点击在磁贴里已吞掉）；
// 私人 FM 卡直接播放、不记起点；歌单类卡片的眼睛按钮；F6 切页签与批量按键（bravaisHomeKeys）；Esc 阶梯的「视图」一级
// 退出管理隐藏。
// Tab（用户实测：原先进缝后按 DOM 顺序一格格走、缝折叠时把焦点交给浏览器，焦点框跳到墙上的按钮或页面别处）：Tab / Shift+Tab
// 只在墙与缝两站之间切换——墙上（含墙上的按钮、左上角返回）或没有焦点时进缝（bravaisSeamFocus 的落点），缝里（含过滤位等
// 输入框、缝的边缘标签）时回墙（上次的焦点磁贴，没有就是有限拼贴的 rank 0 / 无限墙上离缝最近的一张）；缝里的控件之间用方向键走。
// 键盘在边缘标签上按 Enter 恢复缝后，等缝张开再把焦点交进缝里（focusSeamWhenOpen，落点同 Tab 进缝），不落空到 body。
// fb3：聚焦卡的「立即播放」（点按钮或展开后再按 Enter）在正在播放的那首上是暂停 / 继续（宿主的播放开关）；其余的照旧
// 交给 surface 播放，并记下「回来时展开这一项」（bravaisPlayingCard）。「进入」按钮按设置进入播放视图。
// fb2：点窗（结构窗、透明档有限墙的空 slot）什么都不做：不收起聚焦卡、不动键盘焦点、不翻牌、不动相机。只有实色空画框
// （实色档或无限墙的空画框）与磁贴之间的墙面算「空白墙面」，点它收起聚焦卡。

type BravaisFocus = ReturnType<typeof useBravaisFocus>;

/** fb3：宿主经 stage 契约交来的播放开关与「进入播放视图」（最新值放 ref 里，磁贴的 handlers 才能保持同一个对象）。 */
export type BravaisStagePlayback = {
    toggle?: () => void;
    enter?: () => void;
};

/** 墙上的按键动作：通用的（bravaisKeyboardModel）与首页的（bravaisHomeKeys）。 */
export type BravaisWallKeyAction = BravaisKeyAction | BravaisHomeKeyAction;

/** slot key → slot，按墙此刻的形状（bravaisWallShape）。 */
export const bravaisSlotFromKey = (key: string | null, shape: BravaisWallShape = BRAVAIS_BLOCK_SHAPE): WallSlot | null => (
    shapeSlotFromKey(shape, key)
);

const NO_MENU: readonly never[] = [];

const isControlTarget = (target: EventTarget | null) => (
    target instanceof Element && Boolean(target.closest('button, a[href], input, select, textarea'))
);

export const useBravaisInteractions = ({
    displayRef,
    focus,
    slotsRef,
    frameRef,
    tweenTo,
    rootRef,
    fieldRef,
    seamRef,
    seamTabRef,
    playbackRef,
    togglesCurrent,
    hasEnter,
}: {
    displayRef: MutableRefObject<BravaisDisplay | null>;
    focus: BravaisFocus;
    slotsRef: MutableRefObject<readonly WallSlot[]>;
    frameRef: MutableRefObject<BravaisFrameState>;
    tweenTo: (center: WallViewCenter) => void;
    rootRef: RefObject<HTMLElement | null>;
    fieldRef: RefObject<HTMLDivElement | null>;
    seamRef: RefObject<HTMLDivElement | null>;
    /** 缝的边缘标签（折叠 / 出屏收起时点它恢复）：不在 seamRef 里，但算缝的一部分。 */
    seamTabRef: RefObject<HTMLButtonElement | null>;
    playbackRef: MutableRefObject<BravaisStagePlayback>;
    /** 宿主给了播放开关（正在播放的那首上，play 改为暂停 / 继续）。 */
    togglesCurrent: boolean;
    /** 宿主给了「进入播放视图」。 */
    hasEnter: boolean;
}) => {
    // 只取 focus 里身份稳定的成员：磁贴的 handlers 要跨渲染保持同一个对象，否则每张磁贴的 memo 都会失效。
    const { focusSlot, expand, collapse, expandedRef, focusedRef, drawnRect } = focus;
    const itemAt = useCallback((slotKey: string | null) => {
        const slot = bravaisSlotFromKey(slotKey, displayRef.current?.shape);
        return slot ? resolveSlotItem(displayRef.current, slot) : null;
    }, [displayRef]);

    /** 从一张磁贴打开下一层：先记下起点（新层到达时它原地成为第 1 项）。 */
    const openFrom = useCallback((slotKey: string, open: () => void) => {
        const layer = displayRef.current?.layer;
        if (!layer) return;
        setBravaisPendingOrigin({ fromLayerKey: layer.key, slotKey });
        open();
    }, [displayRef]);

    const handlers = useMemo<BravaisTileHandlers>(() => ({
        activate: slotKey => {
            const slot = bravaisSlotFromKey(slotKey, displayRef.current?.shape);
            const item = itemAt(slotKey);
            const layer = displayRef.current?.layer;
            if (!slot || !item || !layer) {
                // 窗不是墙面：点它没有反应（聚焦卡仍展开）。
                if (slot && resolveSlotFace(displayRef.current, slot).kind === 'window') return;
                collapse();
                return;
            }
            focusSlot(slot);
            // B9 批量模式：点卡片只切换选中，绝不进入文件夹（GridMap onSelect 里批量模式的提前 return）。
            const batch = layer.home?.batch;
            if (batch) {
                batch.toggle(item.key);
                return;
            }
            if (item.kind === 'track') {
                if (expandedRef.current !== slotKey) expand(slot);
                return;
            }
            collapse();
            if (!layer.onOpenItem) return;
            // 私人 FM：直接播放、不进新层，不记起点（否则下一次换页签会把它当起点）。
            if (item.direct) layer.onOpenItem(item.key);
            else openFrom(slotKey, () => layer.onOpenItem!(item.key));
        },
        toggleHidden: slotKey => {
            const item = itemAt(slotKey);
            if (item?.hideable) displayRef.current?.layer.home?.onToggleHidden?.(item.key);
        },
        play: slotKey => {
            const item = itemAt(slotKey);
            const layer = displayRef.current?.layer;
            if (!item || !layer) return;
            const toggle = playbackRef.current.toggle;
            if (toggle && layer.nowPlayingKey === item.key) {
                toggle();
                return;
            }
            armBravaisPlayingCard(layer.key, item.key);
            layer.onPlayItem?.(item.key);
        },
        togglesCurrent,
        enterPlayback: hasEnter ? () => playbackRef.current.enter?.() : undefined,
        enqueue: slotKey => {
            const item = itemAt(slotKey);
            if (item) displayRef.current?.layer.onEnqueueItem?.(item.key);
        },
        canCollect: itemKey => Boolean(displayRef.current?.layer.canCollectItem?.(itemKey)),
        collect: slotKey => {
            const item = itemAt(slotKey);
            if (item) displayRef.current?.layer.onCollectItem?.(item.key);
        },
        canSaveToPlaylist: itemKey => Boolean(displayRef.current?.layer.canSaveItemToPlaylist?.(itemKey)),
        saveToPlaylist: slotKey => {
            const item = itemAt(slotKey);
            if (item) displayRef.current?.layer.onSaveItemToPlaylist?.(item.key);
        },
        canOpenAlbum: itemKey => Boolean(displayRef.current?.layer.canOpenAlbum?.(itemKey)),
        openAlbum: slotKey => {
            const item = itemAt(slotKey);
            const layer = displayRef.current?.layer;
            if (item && layer?.onOpenAlbum && layer.canOpenAlbum?.(item.key)) openFrom(slotKey, () => layer.onOpenAlbum!(item.key));
        },
        canOpenArtist: (itemKey, index) => Boolean(displayRef.current?.layer.canOpenArtist?.(itemKey, index)),
        openArtist: (slotKey, index) => {
            const item = itemAt(slotKey);
            const layer = displayRef.current?.layer;
            if (item && layer?.onOpenArtist && layer.canOpenArtist?.(item.key, index)) {
                openFrom(slotKey, () => layer.onOpenArtist!(item.key, index));
            }
        },
        // B7：聚焦卡「⋯」。移出歌单先记下这张的 slot（两段翻牌从它开始）、收起聚焦卡，再交给 surface。
        menuFor: itemKey => displayRef.current?.layer.entries?.menuFor?.(itemKey) ?? NO_MENU,
        runMenu: (slotKey, actionId) => {
            const item = itemAt(slotKey);
            const layer = displayRef.current?.layer;
            if (!item || !layer?.entries?.onMenuAction) return;
            if (actionId === 'remove-entry') {
                useBravaisUiStore.setState({ removalOrigin: { layerKey: layer.key, slotKey } });
                collapse();
            }
            layer.entries.onMenuAction(item.key, actionId);
        },
        // 悬停磁贴：列表面板开着时高亮并滚到对应的行（列表 ↔ 墙联动）。
        hover: slotKey => {
            const layer = displayRef.current?.layer;
            if (!layer || useBravaisUiStore.getState().panelFor !== layer.key) return;
            setBravaisWallHoverKey(slotKey ? itemAt(slotKey)?.key ?? null : null);
        },
    }), [collapse, displayRef, expand, expandedRef, focusSlot, hasEnter, itemAt, openFrom, playbackRef, togglesCurrent]);

    const hasContent = useCallback((slot: WallSlot) => resolveSlotItem(displayRef.current, slot) !== null, [displayRef]);

    /** 第一次按方向键：落在屏内离缝最近的有内容磁贴。 */
    const seedSlot = useCallback(() => {
        const { view, center } = frameRef.current;
        if (!view) return null;
        const visible = getViewWorldBounds(center, view);
        const onScreen = slotsRef.current.filter(slot => overlaps(
            { left: slot.x, right: slot.x + slot.width, top: slot.y, bottom: slot.y + slot.height },
            visible,
        ));
        return findNearestSlot(onScreen, seamPointOf(frameRef.current), hasContent);
    }, [frameRef, hasContent, slotsRef]);

    const focusWall = useCallback(() => fieldRef.current?.focus({ preventScroll: true }), [fieldRef]);

    /** 上次离开缝时焦点停在的控件（Tab 回缝时还给它）。 */
    const lastSeamFocusRef = useRef<Element | null>(null);
    const isInSeam = useCallback((target: EventTarget | null) => (
        target instanceof Node && (Boolean(seamRef.current?.contains(target)) || target === seamTabRef.current)
    ), [seamRef, seamTabRef]);

    /** 回墙：上次的焦点磁贴；没有就是有限拼贴的 rank 0，无限墙上离缝最近的一张（不为它挪远相机）。 */
    const returnToWall = useCallback(() => {
        focusWall();
        const display = displayRef.current;
        const current = bravaisSlotFromKey(focusedRef.current, displayRef.current?.shape);
        if (current && hasContent(current)) {
            focusSlot(current, { reveal: true });
            return;
        }
        const first = display?.finite && display.layer.items.length > 0 ? display.finite.order[0] ?? null : null;
        const target = first ?? seedSlot();
        if (target) focusSlot(target, { reveal: true });
    }, [displayRef, focusSlot, focusWall, focusedRef, hasContent, seedSlot]);

    // 两站切换。焦点在 stage 之外的别处（标题栏、右下角工具按钮、播放条……）时不接管，那里的 Tab 归浏览器。
    const handleTab = useCallback((target: EventTarget | null) => {
        const root = rootRef.current;
        const inStage = target instanceof Node && Boolean(root?.contains(target));
        const unfocused = target === null || target === document.body || target === document.documentElement;
        if (!inStage && !unfocused) return false;
        // 焦点还挂在缝里一个已经藏起来的元素上（边缘标签点完就藏、翻走的半圈）：当作没有焦点，进缝。
        if (isInSeam(target) && canTakeSeamFocus(target as Element)) {
            if (target instanceof Element && seamRef.current?.contains(target)) lastSeamFocusRef.current = target;
            returnToWall();
            return true;
        }
        const entry = resolveSeamEntry(seamRef.current, lastSeamFocusRef.current);
        const seamTab = seamTabRef.current;
        if (entry) entry.focus({ preventScroll: true });
        // 缝折叠 / 出屏收起：落在边缘标签上（Enter 恢复缝）。
        else if (seamTab && canTakeSeamFocus(seamTab)) seamTab.focus({ preventScroll: true });
        // 缝合着（交接、翻转途中）：留在墙上，不让浏览器把焦点交给墙上的按钮或页面别处。
        else if (!inStage) focusWall();
        return true;
    }, [focusWall, isInSeam, returnToWall, rootRef, seamRef, seamTabRef]);

    /**
     * 键盘在缝的边缘标签上按 Enter 恢复缝之后：等缝张开（开口补间放完、内容不透明、没有在翻）再把焦点交进缝里，落点与
     * Tab 进缝相同。等待中焦点被放到了别处（不是 body、也不是那颗标签）就作罢；最多等 2 秒。
     */
    const focusSeamWhenOpen = useCallback(() => {
        const startedAt = performance.now();
        const step = () => {
            const active = document.activeElement;
            if (active && active !== document.body && active !== seamTabRef.current) return;
            const seam = seamRef.current;
            if (!seam?.isConnected || performance.now() - startedAt > 2000) return;
            const content = seam.querySelector<HTMLElement>('.bravais-seam-content');
            const open = content !== null && Number(content.style.opacity || '1') >= 1
                && !seam.querySelector(`[${BRAVAIS_SEAM_FLIP_ATTRIBUTE}]`);
            const entry = open ? resolveSeamEntry(seam, lastSeamFocusRef.current) : null;
            if (entry) entry.focus({ preventScroll: true });
            else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }, [seamRef, seamTabRef]);

    /** 缝里的方向键：在控件之间走（文本输入与 select 里的方向键归它们自己，到不了这里）。 */
    const moveInSeam = useCallback((target: EventTarget | null, direction: WallDirection) => {
        const next = resolveSeamStep(seamRef.current, target instanceof Element ? target : null, direction);
        next?.focus({ preventScroll: true });
        return true;
    }, [seamRef]);

    const handleAction = useCallback((action: BravaisWallKeyAction, target: EventTarget | null): boolean => {
        const display = displayRef.current;
        const layer = display?.layer;
        if (!layer) return false;
        // Tab / Shift+Tab 都是「换到另一站」（只有两站，反向也是同一个去处）。
        if (action.type === 'tab') return handleTab(target);
        if (action.type === 'escape') {
            const step = resolveEscapeStep({
                hasForm: Boolean(layer.entries?.hasForm),
                hasFocusCard: expandedRef.current !== null,
                hasKeyboardFocus: focusedRef.current !== null,
                hasPanel: useBravaisUiStore.getState().panelFor === layer.key,
                hasViewMode: Boolean(layer.entries?.hasViewMode),
                hasQuery: Boolean(layer.entries?.hasQuery),
                canGoBack: Boolean(layer.onBack),
            });
            if (step === 'form') layer.entries?.cancelForm?.();
            else if (step === 'focus-card') collapse();
            else if (step === 'keyboard-focus') focusSlot(null);
            else if (step === 'panel') closeBravaisPanel();
            else if (step === 'view') layer.entries?.exitViewMode?.();
            else if (step === 'query') layer.entries?.clearQuery?.();
            else if (step === 'back') layer.onBack!();
            return step !== null;
        }
        // B9 首页：F6 切页签；批量模式的 Ctrl+A / Ctrl+Enter / Delete（不在首页、不在批量模式时不接，按键照常放行）。
        if (action.type === 'cycle-tab') return layer.home?.cycleTab?.(action.delta) ?? false;
        if (action.type === 'open-search') {
            // 目录树面板开着（批量模式）时 `/` 是过滤字符（命令面板经 ownInput 交给缝里的输入位），不开搜索。
            if (!layer.seam.home || useBravaisUiStore.getState().panelFor === layer.key) return false;
            if (useBravaisSeamStore.getState().level === 'hidden') useBravaisSeamStore.getState().restore();
            setBravaisSearchOpen(true);
            return true;
        }
        const batch = layer.home?.batch;
        if (action.type === 'batch-select-all' || action.type === 'batch-play' || action.type === 'batch-remove') {
            if (!batch) return false;
            if (action.type === 'batch-select-all') batch.selectAll();
            else if (action.type === 'batch-play') batch.play(action.enqueue);
            else batch.requestRemove();
            return true;
        }
        if (action.type === 'move' && isInSeam(target)) return moveInSeam(target, action.direction);
        // 缝里的按钮、页面上别的控件保留自己的按键（Enter 激活按钮）。
        if (isControlTarget(target)) return false;
        const focusedKey = focusedRef.current;
        const focused = bravaisSlotFromKey(focusedKey, display.shape);
        if (action.type === 'batch-toggle') {
            // Insert：切换焦点那张的选中，焦点往下走一格（TUI 目录页的「切换并下移」）。
            const current = focused ? itemAt(focused.key) : null;
            if (!batch || !focused || !current) return false;
            batch.toggle(current.key);
            const next = findAdjacentSlot(focused, 'down', { drawn: drawnRect, hasContent, shape: display.shape });
            if (next) focusSlot(next, { reveal: true });
            return true;
        }
        switch (action.type) {
            case 'move': {
                const next = focused && hasContent(focused)
                    ? findAdjacentSlot(focused, action.direction, { drawn: drawnRect, hasContent, shape: display.shape })
                    : seedSlot();
                if (!next) return false;
                focusWall();
                focusSlot(next, { reveal: true });
                return true;
            }
            case 'first': {
                // 有限拼贴（过滤中）：rank 0；无限拼贴：起点磁贴（第 1 项）。
                const start = display.finite
                    ? (display.layer.items.length > 0 ? display.finite.order[0] ?? null : null)
                    : bravaisSlotFromKey(display.startSlotKey, display.shape) ?? seedSlot();
                if (!start) return false;
                focusWall();
                focusSlot(start, { reveal: true });
                return true;
            }
            case 'last': {
                // 只有有限拼贴有「最后一项」。
                const last = display.finite ? display.finite.order[display.layer.items.length - 1] ?? null : null;
                if (!last) return false;
                focusWall();
                focusSlot(last, { reveal: true });
                return true;
            }
            case 'page': {
                const { view, center } = frameRef.current;
                if (!view) return false;
                tweenTo({ x: center.x, y: center.y + action.direction * view.height * 0.85 / view.scale });
                return true;
            }
            default: break;
        }
        const item = focusedKey ? itemAt(focusedKey) : null;
        if (!focused || !item) return false;
        if (action.type === 'enter') {
            if (item.kind !== 'track') handlers.activate(focused.key);
            else if (expandedRef.current === focused.key) handlers.play(focused.key);
            else expand(focused);
            return true;
        }
        if (item.kind !== 'track') return false;
        if (action.type === 'enqueue') handlers.enqueue(focused.key);
        else if (action.type === 'open-album') handlers.openAlbum(focused.key);
        else if (action.type === 'open-artist') handlers.openArtist(focused.key, 0);
        return true;
    }, [collapse, displayRef, drawnRect, expand, expandedRef, focusSlot, focusWall, focusedRef, frameRef, handleTab, handlers, hasContent, isInSeam, itemAt, moveInSeam, seedSlot, tweenTo]);

    /**
     * 缝里的直达入口（特殊集合）：与点墙上那张卡同一条打开路径。先在墙上找这一项此刻屏内离缝最近的一份，找得到就把它记成
     * 起点磁贴、走层描述的 onOpenItem（与点它一样）；找不到（别的 section、被过滤掉、在屏外）就不经墙打开，并明确记下
     * 「这次没有起点」：新层不沿用它自己布局记忆里的起点（上次 Esc 离开时留下的），也不拿键盘焦点那张补，以缝为中心排序。
     * 私人 FM 直接播放，不记起点。聚焦卡先收起（与点非歌曲磁贴一样）。
     */
    const openShortcut = useCallback((shortcut: BravaisHomeShortcut) => {
        const display = displayRef.current;
        const layer = display?.layer;
        if (!layer) {
            shortcut.open();
            return;
        }
        collapse();
        if (shortcut.direct) {
            shortcut.open();
            return;
        }
        const { view, center } = frameRef.current;
        const slot = findDisplayItemSlot(display, shortcut.itemKey, seamPointOf(frameRef.current));
        const visible = view ? getViewWorldBounds(center, view) : null;
        const onScreen = slot && visible
            && slot.centerX >= visible.left && slot.centerX <= visible.right
            && slot.centerY >= visible.top && slot.centerY <= visible.bottom;
        if (slot && onScreen && layer.onOpenItem && resolveSlotItem(display, slot)?.key === shortcut.itemKey) {
            openFrom(slot.key, () => layer.onOpenItem!(shortcut.itemKey));
            return;
        }
        setBravaisPendingOrigin({ fromLayerKey: layer.key, slotKey: null });
        shortcut.open();
    }, [collapse, displayRef, frameRef, openFrom]);

    return { handlers, handleAction, itemAt, seedSlot, focusWall, focusSeamWhenOpen, openShortcut };
};
