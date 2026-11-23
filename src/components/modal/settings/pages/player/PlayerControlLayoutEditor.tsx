import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Command, Minus, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { PLAYER_CONTROL_SLOT_OPTIONS } from '../../../../floating-player/playerControlSlotActions';
import { usePlayerChromeSettingsStore } from '../../../../../stores/usePlayerChromeSettingsStore';
import {
    CAPSULE_ISLAND_MAX,
    locatePlayerControl,
    placePlayerControl,
    type PlayerControlLayout,
    type PlayerControlPlacement,
    type PlayerControlSlotActionId,
    type PlayerControlSlotSide,
} from '../../../../../types/playerControlSlots';
import { Menu, kitTransition, useKitReducedMotion, type MenuItem } from '../../kit';

// src/components/modal/settings/pages/player/PlayerControlLayoutEditor.tsx
// 进度条上的按钮怎么摆：右侧两个槽位和指针停在胶囊上时浮出的那一排（浮岛）合在一起编辑，像 iOS 控制中心那样拖。
// 上面是缩小的胶囊（浮岛一排在上，进度条和两个槽位在下），下面是没摆出去的控件。
// - 从下面拖到浮岛上插进去，拖到槽位上替换（原来的回到下面）；点一下加到浮岛末尾；
// - 浮岛里拖着挪位置，拖回下面或点角上的「−」拿下；有焦点时左右方向键挪、Delete 拿下；
// - 槽位不能空：槽位里的拖到另一个槽位互换，拖到浮岛的某一个上和它互换；点槽位从菜单里挑一个换上。
// 一个控件只在一处，规则在 types/playerControlSlots 的 placePlayerControl，store 也用它。
//
// 拖动跟着指针走的那个影子只在 pointermove 里改 transform（不进 React state）；
// 落点（插到第几个、换哪个槽位）变了才 setState，预览按落点重新排一遍，框架的 layout 动画让别的格子让位。

/**
 * 胶囊模型里一格的大小和间距（px）：落点按这个算，不量格子，排的过程中格子在动也不会来回跳。
 * 一格最大 36；窄窗口（主窗口最窄 350，网页版可能在手机上）里按编辑器的宽度缩，保证放满时一排也装得下。
 */
const TILE_MAX = 36;
const TILE_MIN = 24;
const GAP = 4;
/** 一排除了格子以外占的宽：外框内边距 24、浮岛内边距 12、命令面板前的分隔线 13。 */
const ISLAND_CHROME = 24 + 12 + 13;
const tileFor = (width: number) => {
    if (width <= 0) return TILE_MAX;
    const fit = Math.floor((width - ISLAND_CHROME - GAP * (CAPSULE_ISLAND_MAX - 1)) / (CAPSULE_ISLAND_MAX + 1));
    return Math.max(TILE_MIN, Math.min(TILE_MAX, fit));
};
/** 按下后挪这么远才算开始拖，不然是点。 */
const DRAG_THRESHOLD = 4;

type DragSession = {
    id: PlayerControlSlotActionId;
    pointerId: number;
    startX: number;
    startY: number;
    started: boolean;
};

/** 落点：一个能成立的摆法，或「浮岛满了」（拖着下面的控件悬在浮岛上）。 */
type DropTarget = PlayerControlPlacement | { kind: 'island-full' };

const targetKey = (target: DropTarget | null) => (target ? `${target.kind}:${'index' in target ? target.index : 'slot' in target ? target.slot : ''}` : '');

const OPTION_BY_ID = new Map(PLAYER_CONTROL_SLOT_OPTIONS.map(option => [option.id, option]));

const sameLayout = (a: PlayerControlLayout, b: PlayerControlLayout) => (
    a.primary === b.primary && a.secondary === b.secondary && a.island.join('\n') === b.island.join('\n')
);

/** 影子的左上角放到指针上（它自己用负外边距把中心对上指针）。 */
const placeGhost = (ghost: HTMLElement | null, x: number, y: number) => {
    if (ghost) ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
};

const contains = (rect: DOMRect | undefined, x: number, y: number, pad = 0) => (
    rect !== undefined && x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad
);

const PlayerControlLayoutEditor: React.FC = () => {
    const { t } = useTranslation();
    const reduced = useKitReducedMotion();
    const menuId = useId();
    const { primary, secondary, island, setLayout } = usePlayerChromeSettingsStore(useShallow(state => ({
        primary: state.playerControlSlotPrimary,
        secondary: state.playerControlSlotSecondary,
        island: state.playerCapsuleIsland,
        setLayout: state.handleSetPlayerControlLayout,
    })));
    const layout = useMemo<PlayerControlLayout>(() => ({ primary, secondary, island }), [primary, secondary, island]);
    const layoutRef = useRef(layout);
    layoutRef.current = layout;

    const [dragging, setDragging] = useState<PlayerControlSlotActionId | null>(null);
    const [target, setTarget] = useState<DropTarget | null>(null);
    const sessionRef = useRef<DragSession | null>(null);
    const targetRef = useRef<DropTarget | null>(null);
    const ghostRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const lastPointRef = useRef({ x: 0, y: 0 });
    const islandRef = useRef<HTMLDivElement>(null);
    const islandTilesRef = useRef<HTMLDivElement>(null);
    const slotRefs = { primary: useRef<HTMLButtonElement>(null), secondary: useRef<HTMLButtonElement>(null) };
    const poolRef = useRef<HTMLDivElement>(null);
    // 编辑器的宽度只在窗口变宽变窄时量（ResizeObserver），格子大小由它算出来。
    const [width, setWidth] = useState(0);
    const widthRef = useRef(0);
    useLayoutEffect(() => {
        const element = rootRef.current;
        if (!element || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(([entry]) => {
            const next = Math.round(entry.contentRect.width);
            if (next === widthRef.current) return;
            widthRef.current = next;
            setWidth(next);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    const TILE = tileFor(width);
    const PITCH = TILE + GAP;
    const iconSize = TILE >= 32 ? 16 : 14;
    /** 拖完松手后紧跟着的那个 click 不算点。 */
    const swallowClickRef = useRef(false);
    const [menuSide, setMenuSide] = useState<PlayerControlSlotSide | null>(null);
    /** 键盘挪过的那一格：重排后焦点还给它。 */
    const refocusRef = useRef<PlayerControlSlotActionId | null>(null);

    const apply = (next: PlayerControlLayout | null) => {
        if (next && !sameLayout(next, layoutRef.current)) setLayout(next);
    };

    /** 指针下面是哪个落点。 */
    const hitTest = (id: PlayerControlSlotActionId, x: number, y: number): DropTarget | null => {
        const current = layoutRef.current;
        const from = locatePlayerControl(current, id);
        for (const side of ['primary', 'secondary'] as const) {
            if (contains(slotRefs[side].current?.getBoundingClientRect(), x, y, 6)) {
                return from === side ? null : { kind: 'slot', slot: side };
            }
        }
        const islandRect = islandRef.current?.getBoundingClientRect();
        const tilesLeft = islandTilesRef.current?.getBoundingClientRect().left;
        if (contains(islandRect, x, y, 8) && tilesLeft !== undefined) {
            const offset = (x - tilesLeft) / PITCH;
            if (from === 'primary' || from === 'secondary') {
                const index = Math.floor(offset);
                return index >= 0 && index < current.island.length ? { kind: 'island-swap', index } : null;
            }
            if (from === 'pool' && current.island.length >= CAPSULE_ISLAND_MAX) return { kind: 'island-full' };
            const rest = current.island.length - (from === 'pool' ? 0 : 1);
            // 指针在第几格上就插到第几格：占位总在指针下面（格子等宽，不会来回跳）。
            return { kind: 'island', index: Math.max(0, Math.min(rest, Math.floor(offset))) };
        }
        if (contains(poolRef.current?.getBoundingClientRect(), x, y, 8)) {
            return typeof from === 'number' ? { kind: 'pool' } : null;
        }
        return null;
    };


    const endDrag = (commit: boolean) => {
        const session = sessionRef.current;
        sessionRef.current = null;
        setPressing(false);
        if (session?.started) {
            swallowClickRef.current = true;
            const drop = targetRef.current;
            if (commit && drop && drop.kind !== 'island-full') {
                apply(placePlayerControl(layoutRef.current, session.id, drop));
            }
        }
        targetRef.current = null;
        setTarget(null);
        setDragging(null);
    };

    const handleMove = (event: PointerEvent) => {
        const session = sessionRef.current;
        if (!session || event.pointerId !== session.pointerId) return;
        // 松手没传到这里（按着键切走了窗口）：不让影子接着跟着空着的鼠标走，下一次点击才把它放下。
        if (event.pointerType === 'mouse' && event.buttons === 0) {
            endDrag(false);
            return;
        }
        lastPointRef.current = { x: event.clientX, y: event.clientY };
        if (!session.started) {
            if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < DRAG_THRESHOLD) return;
            session.started = true;
            setDragging(session.id);
        }
        event.preventDefault();
        placeGhost(ghostRef.current, event.clientX, event.clientY);
        const next = hitTest(session.id, event.clientX, event.clientY);
        if (targetKey(next) !== targetKey(targetRef.current)) {
            targetRef.current = next;
            setTarget(next);
        }
    };
    // 按下之后才在 window 上听：拖的那一格在预览里会换地方、甚至被换下去，不能靠它自己的 pointer capture。
    // 监听只挂一次，处理函数从 ref 里取最新的那一版。
    const handlersRef = useRef({ move: handleMove, end: endDrag });
    handlersRef.current = { move: handleMove, end: endDrag };
    const [pressing, setPressing] = useState(false);
    useEffect(() => {
        if (!pressing) return;
        const pointerOf = (event: PointerEvent) => sessionRef.current && event.pointerId === sessionRef.current.pointerId;
        const onMove = (event: PointerEvent) => handlersRef.current.move(event);
        const onUp = (event: PointerEvent) => {
            if (pointerOf(event)) handlersRef.current.end(true);
        };
        const onCancel = (event: PointerEvent) => {
            if (pointerOf(event)) handlersRef.current.end(false);
        };
        // 拖着的时候按 Esc：放弃这一下（不让它再关掉设置）。
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !sessionRef.current?.started) return;
            event.preventDefault();
            event.stopPropagation();
            handlersRef.current.end(false);
        };
        const onBlur = () => handlersRef.current.end(false);
        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('blur', onBlur);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        window.addEventListener('keydown', onKey, true);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onCancel);
            window.removeEventListener('keydown', onKey, true);
        };
    }, [pressing]);
    // 影子挂上的那一刻就放到指针下面，不等下一次 pointermove；颜色从设置窗口的变量里抄过来（影子挂在 body 上，拿不到它们）。
    useLayoutEffect(() => {
        const ghost = ghostRef.current;
        if (!dragging || !ghost) return;
        const root = rootRef.current;
        if (root) {
            const computed = getComputedStyle(root);
            for (const name of ['--st-card', '--st-t1', '--st-line2']) {
                ghost.style.setProperty(name, computed.getPropertyValue(name));
            }
        }
        placeGhost(ghost, lastPointRef.current.x, lastPointRef.current.y);
    }, [dragging]);

    const startPress = (id: PlayerControlSlotActionId, event: React.PointerEvent) => {
        if (event.button !== 0 || sessionRef.current) return;
        swallowClickRef.current = false;
        sessionRef.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, started: false };
        lastPointRef.current = { x: event.clientX, y: event.clientY };
        setPressing(true);
    };
    /**
     * 一个 click 是不是拖完松手带出来的（是的话吞掉）。键盘按出来的 click（detail 为 0）从来不是：
     * 拖到别处松手时原来那格收不到 click，标记会一直留着，不能让它吃掉下一次 Enter。
     */
    const takeSwallowedClick = (event: React.MouseEvent) => {
        const swallowed = swallowClickRef.current && event.detail !== 0;
        swallowClickRef.current = false;
        return swallowed;
    };

    // 预览：按落点排出来的样子；落点不成立时照原样。
    const preview = useMemo(() => {
        if (!dragging || !target || target.kind === 'island-full') return layout;
        return placePlayerControl(layout, dragging, target) ?? layout;
    }, [dragging, layout, target]);
    const placed = new Set<PlayerControlSlotActionId>([preview.primary, preview.secondary, ...preview.island]);
    const pool = PLAYER_CONTROL_SLOT_OPTIONS.filter(option => !placed.has(option.id) || (dragging === option.id && locatePlayerControl(layout, option.id) === 'pool'));
    const islandFull = layout.island.length >= CAPSULE_ISLAND_MAX;
    const label = (id: PlayerControlSlotActionId) => t(OPTION_BY_ID.get(id)?.labelKey ?? '');
    const sideName = (side: PlayerControlSlotSide) => t(side === 'primary' ? 'options.playerControlSlotPrimary' : 'options.playerControlSlotSecondary');

    const moveInIsland = (id: PlayerControlSlotActionId, step: 1 | -1) => {
        const from = layout.island.indexOf(id);
        const to = from + step;
        if (from < 0 || to < 0 || to >= layout.island.length) return;
        refocusRef.current = id;
        apply(placePlayerControl(layout, id, { kind: 'island', index: to }));
    };
    useLayoutEffect(() => {
        const id = refocusRef.current;
        if (!id) return;
        refocusRef.current = null;
        islandTilesRef.current?.querySelector<HTMLElement>(`[data-control-tile="${id}"]`)?.focus();
    }, [island]);

    // 拿下、加上之后原来那格没了：焦点交给浮岛里挨着的那格 / 刚加上的那格，不掉回页面顶上。
    const removeFromIsland = (id: PlayerControlSlotActionId) => {
        const index = layout.island.indexOf(id);
        const neighbour = index + 1 < layout.island.length ? index + 1 : index - 1;
        refocusRef.current = neighbour >= 0 ? layout.island[neighbour] : null;
        apply(placePlayerControl(layout, id, { kind: 'pool' }));
    };
    const addToIsland = (id: PlayerControlSlotActionId) => {
        refocusRef.current = id;
        apply(placePlayerControl(layout, id, { kind: 'island', index: layout.island.length }));
    };

    const menuItems: MenuItem[] = menuSide
        ? PLAYER_CONTROL_SLOT_OPTIONS.map(option => {
            const where = locatePlayerControl(layout, option.id);
            const end = where === menuSide
                ? undefined
                : where === 'primary' || where === 'secondary'
                    ? sideName(where)
                    : typeof where === 'number' ? t('options.playerControlLayoutIsland') : undefined;
            return {
                id: option.id,
                label: t(option.labelKey),
                icon: option.icon,
                chosen: where === menuSide,
                end: end ? <span className="text-xs text-[color:var(--st-t3)]">{end}</span> : undefined,
                onSelect: () => {
                    apply(placePlayerControl(layout, option.id, { kind: 'slot', slot: menuSide }));
                    setMenuSide(null);
                },
            };
        })
        : [];

    const tileClass = (isGhostSource: boolean, extra = '') => [
        'st-t-fast relative flex shrink-0 select-none items-center justify-center rounded-full text-[color:var(--st-t1)] outline-none transition-[background-color,opacity,box-shadow]',
        'focus-visible:ring-2 focus-visible:ring-[var(--st-accent)]',
        isGhostSource ? 'opacity-30 ring-1 ring-dashed ring-[var(--st-t3)]' : 'hover:bg-[var(--st-fill2)]',
        extra,
    ].join(' ');

    const renderSlot = (side: PlayerControlSlotSide) => {
        const id = preview[side];
        const option = OPTION_BY_ID.get(id);
        const Icon = option?.icon ?? Command;
        const isTarget = target?.kind === 'slot' && target.slot === side;
        return (
            <button
                ref={slotRefs[side]}
                type="button"
                data-control-slot={side}
                aria-haspopup="menu"
                aria-expanded={menuSide === side}
                aria-controls={menuSide === side ? menuId : undefined}
                aria-label={t('options.playerControlLayoutSlot', { side: sideName(side), name: label(id) })}
                title={`${sideName(side)} · ${label(id)}`}
                style={{ width: TILE, height: TILE, touchAction: 'none' }}
                className={tileClass(dragging === id && layout[side] === id, isTarget ? 'bg-[var(--st-fill2)] ring-2 ring-[var(--st-accent)]' : 'bg-[var(--st-fill)]')}
                onPointerDown={event => startPress(layout[side], event)}
                onClick={event => {
                    if (takeSwallowedClick(event)) return;
                    setMenuSide(side);
                }}
            >
                <Icon size={iconSize} aria-hidden />
            </button>
        );
    };

    const islandCount = preview.island.length;
    const fullWarning = target?.kind === 'island-full';

    return (
        <div ref={rootRef} className="flex flex-col gap-3" data-testid="player-control-layout-editor">
            {/* 缩小的胶囊：浮岛一排在上，进度条和两个槽位在下。 */}
            <div className="flex flex-col items-stretch gap-2 rounded-xl bg-[var(--st-fill)] p-3">
                <div className="flex items-baseline justify-between text-xs text-[color:var(--st-t3)]">
                    <span>{t('options.playerControlLayoutIsland')}</span>
                    <span className={fullWarning ? 'text-[color:var(--st-accent)]' : undefined}>
                        {fullWarning
                            ? t('options.playerControlLayoutFull', { max: CAPSULE_ISLAND_MAX })
                            : t('options.playerControlLayoutCount', { count: islandCount, max: CAPSULE_ISLAND_MAX })}
                    </span>
                </div>
                <div ref={islandRef} className="flex min-h-[48px] items-center">
                    <div className="flex max-w-full items-center rounded-full bg-[var(--st-card)] p-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.18)]">
                        <div
                            ref={islandTilesRef}
                            role="list"
                            aria-label={t('options.playerControlLayoutIsland')}
                            className="flex items-center"
                            style={{ gap: GAP, minWidth: islandCount === 0 ? TILE * 3 : undefined, minHeight: TILE }}
                        >
                            {islandCount === 0 && (
                                <span className="px-2 text-xs text-[color:var(--st-t3)]">{t('options.playerControlLayoutIslandEmpty')}</span>
                            )}
                            {preview.island.map((id, index) => {
                                const option = OPTION_BY_ID.get(id);
                                const Icon = option?.icon ?? Command;
                                const isPlaceholder = dragging === id;
                                const isSwapTarget = target?.kind === 'island-swap' && target.index === index;
                                const isLive = layout.island.includes(id);
                                return (
                                    <motion.div
                                        key={id}
                                        layout
                                        transition={kitTransition('move', reduced)}
                                        role="listitem"
                                        className="relative"
                                    >
                                        <button
                                            type="button"
                                            data-control-tile={id}
                                            aria-label={t('options.playerControlLayoutIslandItem', { name: label(id), position: index + 1, count: islandCount })}
                                            title={label(id)}
                                            style={{ width: TILE, height: TILE, touchAction: 'none' }}
                                            className={tileClass(isPlaceholder, `cursor-grab active:cursor-grabbing ${isSwapTarget ? 'bg-[var(--st-fill2)] ring-2 ring-[var(--st-accent)]' : ''}`)}
                                            onPointerDown={event => isLive && startPress(id, event)}
                                            onClick={event => {
                                                takeSwallowedClick(event);
                                            }}
                                            onKeyDown={event => {
                                                if (!isLive) return;
                                                const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
                                                if (step !== 0) {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    moveInIsland(id, step);
                                                } else if (event.key === 'Delete' || event.key === 'Backspace') {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    removeFromIsland(id);
                                                }
                                            }}
                                        >
                                            <Icon size={iconSize} aria-hidden />
                                        </button>
                                        {isLive && !dragging && (
                                            <button
                                                type="button"
                                                tabIndex={-1}
                                                aria-label={t('options.playerControlLayoutRemove', { name: label(id) })}
                                                title={t('options.playerControlLayoutRemove', { name: label(id) })}
                                                className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--st-t3)] text-[color:var(--st-card)] hover:bg-[var(--st-t2)]"
                                                onPointerDown={event => event.stopPropagation()}
                                                onClick={() => removeFromIsland(id)}
                                            >
                                                <Minus size={10} strokeWidth={3} aria-hidden />
                                            </button>
                                        )}
                                    </motion.div>
                                );
                            })}
                        </div>
                        {/* 最右固定一个命令面板按钮：不能挪、不能拿下，画淡一点。 */}
                        <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-[var(--st-t3)] opacity-40" />
                        <span
                            className="flex shrink-0 items-center justify-center text-[color:var(--st-t3)]"
                            style={{ width: TILE, height: TILE }}
                            title={t('options.playerControlLayoutPalette')}
                        >
                            <Command size={iconSize} aria-hidden />
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2 rounded-full bg-[var(--st-card)] p-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.18)]">
                    <span aria-hidden className="flex shrink-0 items-center justify-center text-[color:var(--st-t2)]" style={{ width: TILE, height: TILE }}>
                        <Play size={iconSize} fill="currentColor" />
                    </span>
                    <span aria-hidden className="relative h-1 min-w-[40px] flex-1 overflow-hidden rounded-full bg-[var(--st-fill2)]">
                        <span className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-[var(--st-t2)]" />
                    </span>
                    <div className="flex shrink-0 items-center" style={{ gap: GAP }}>
                        {renderSlot('primary')}
                        {renderSlot('secondary')}
                    </div>
                </div>
            </div>
            <Menu
                id={menuId}
                anchorRef={menuSide ? slotRefs[menuSide] : slotRefs.primary}
                open={menuSide !== null}
                onClose={() => setMenuSide(null)}
                label={menuSide ? sideName(menuSide) : ''}
                items={menuItems}
                side="under"
                align="end"
            />

            {/* 没摆出去的控件：拖上去，或点一下加到浮岛末尾。 */}
            <div
                ref={poolRef}
                className={`flex min-h-[44px] flex-wrap gap-1.5 rounded-xl p-1 transition-[background-color] ${target?.kind === 'pool' ? 'bg-[var(--st-fill)]' : ''}`}
                role="list"
                aria-label={t('options.playerControlLayoutPool')}
            >
                {pool.length === 0 && (
                    <span className="px-2 py-2 text-xs text-[color:var(--st-t3)]">{t('options.playerControlLayoutPoolEmpty')}</span>
                )}
                {pool.map(option => {
                    const Icon = option.icon;
                    const isSource = dragging === option.id;
                    return (
                        <motion.div
                            key={option.id}
                            layout
                            transition={kitTransition('move', reduced)}
                            role="listitem"
                            className="shrink-0"
                        >
                            <button
                                type="button"
                                data-control-pool={option.id}
                                aria-label={t('options.playerControlLayoutPoolItem', { name: t(option.labelKey) })}
                                style={{ touchAction: 'none' }}
                                className={`st-t-fast flex h-8 cursor-grab select-none items-center gap-1.5 rounded-lg bg-[var(--st-fill)] pl-2 pr-2.5 text-[13px] text-[color:var(--st-t1)] outline-none transition-[background-color,opacity] hover:bg-[var(--st-fill2)] focus-visible:ring-2 focus-visible:ring-[var(--st-accent)] active:cursor-grabbing ${isSource ? 'opacity-30' : ''}`}
                                onPointerDown={event => startPress(option.id, event)}
                                onClick={event => {
                                    // 浮岛满了点一下加不上去（拖到槽位上照样能换）。
                                    if (takeSwallowedClick(event) || islandFull) return;
                                    addToIsland(option.id);
                                }}
                            >
                                <Icon size={14} aria-hidden className="text-[color:var(--st-t2)]" />
                                {t(option.labelKey)}
                            </button>
                        </motion.div>
                    );
                })}
            </div>

            {dragging && createPortal(
                <div
                    ref={ghostRef}
                    aria-hidden
                    className="pointer-events-none fixed left-0 top-0 z-[2147483000] flex items-center justify-center rounded-full bg-[var(--st-card)] text-[color:var(--st-t1)] shadow-[0_8px_22px_rgba(0,0,0,0.35)] ring-1 ring-[var(--st-line2)]"
                    style={{ width: TILE, height: TILE, marginLeft: -TILE / 2, marginTop: -TILE / 2 }}
                >
                    {React.createElement(OPTION_BY_ID.get(dragging)?.icon ?? Command, { size: 16 })}
                </div>,
                document.body,
            )}
        </div>
    );
};

export default PlayerControlLayoutEditor;
