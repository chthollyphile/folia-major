import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useTransform, type MotionStyle } from 'framer-motion';
import type { Theme } from '../../../types';
import { usePlayerBottomBarBottomPx } from '../../../hooks/usePlayerBottomBarBottomPx';
import { usePlayerOverlayObstacle } from '../../../hooks/usePlayerOverlayLayout';
import { kitTransition, useKitReducedMotion } from '../../modal/settings/kit/motion';
import { panelTokens } from './panelTheme';
import { FOLDED_PX } from './SongHeader';
import { useMeasuredSize } from './useMeasuredSize';
import { useBottomDockStore, useIsDockCompactWithCapsule } from '../../../stores/useBottomDockStore';

// src/components/panelTab/shell/PanelShell.tsx
// The frame of the playing page's panel: where it sits, the glass surface, and how tall it is. The
// surface stands wholly above the round handle and grows out of it. From top to bottom it holds the
// song (the header), the open tab (which scrolls inside when the window is short) and the tab row,
// which stays at the bottom edge. Each tab gets the height its content needs: the content is
// measured, and the surface follows with the kit's motion, upward from the tab row. The open
// surface is in the way of a mod's player layout (usePlayerOverlayObstacle) and says so as it moves.

/** The handle's height and the gap above it: how far the surface's bottom edge is above the handle's. */
const HANDLE_ROOM_PX = 60;
/** Under the surface when no handle is drawn below it. */
const BARE_GAP_PX = 8;
/** What stays free between the surface and the top of the window. */
const TOP_MARGIN_PX = 56;
const PADDING_PX = 12;
const DOCK_HEIGHT_PX = 36;
const DOCK_GAP_PX = 12;
/** Above the open tab: the gap, the hairline, and the gap under it. */
const BODY_TOP_PX = { gap: 12, line: 1, under: 8 } as const;

type PanelShellProps = {
    isOpen: boolean;
    /** The round button stays under the open surface (a setting can take it away): the surface stands above it. */
    hasHandle: boolean;
    /** The cover tab is open: the header is the whole panel and there is no tab body. */
    isCover: boolean;
    /** Names the open tab: a new value brings its body in and measures it. */
    tabKey: string;
    theme: Theme;
    isDaylight: boolean;
    /** The song. It may use --pn-room, the height it can take on the cover tab, and 100cqw, the surface's inner width. */
    header: React.ReactNode;
    /** The tab row. */
    dock: React.ReactNode;
    /** The round button that opens and closes the panel. */
    handle: React.ReactNode;
    /** The open tab's body. It may use --pn-tab-room, the height it can take before it scrolls here. */
    children: React.ReactNode;
};

type PanelSurfaceProps = Omit<PanelShellProps, 'isOpen' | 'handle'> & {
    /** The handle hangs on the compact capsule's right end (progress-bar v3): the surface grows from there. */
    isDocked: boolean;
    /** Registers the surface as an obstacle of the player layout. */
    layoutRef: (element: HTMLElement | null) => void;
    /** Tells the player layout that the surface moved. */
    onLayoutUpdate: () => void;
};

const PanelSurface: React.FC<PanelSurfaceProps> = ({ hasHandle, isCover, tabKey, theme, isDaylight, header, dock, children, isDocked, layoutRef, onLayoutUpdate }) => {
    const reduced = useKitReducedMotion();
    const bottomBarBottomPx = usePlayerBottomBarBottomPx();
    // What is under the surface: the handle, or a small gap. A variable, so the two heights below follow it at once.
    // Docked on the compact capsule the surface always clears the capsule, handle or not.
    const underPx = hasHandle || isDocked ? HANDLE_ROOM_PX : BARE_GAP_PX;
    // Never taller than the window allows, wherever the bottom bar's baseline has been lifted to.
    const maxHeight = useTransform(
        bottomBarBottomPx,
        bottom => `calc(100dvh - var(--pn-under) - ${bottom + TOP_MARGIN_PX}px)`,
    );
    const headerRoom = useTransform(
        bottomBarBottomPx,
        bottom => `calc(100dvh - var(--pn-under) - ${bottom + TOP_MARGIN_PX + 2 * PADDING_PX + DOCK_GAP_PX + DOCK_HEIGHT_PX}px)`,
    );
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const content = useMeasuredSize(contentRef, tabKey);
    // The surface takes the size of its tab while it is still closed: nothing inside it moves
    // until it has been painted once.
    const [isStill, setIsStill] = useState(true);
    useEffect(() => {
        const frame = requestAnimationFrame(() => setIsStill(false));
        return () => cancelAnimationFrame(frame);
    }, []);
    // A new tab starts at its top.
    useLayoutEffect(() => {
        scrollRef.current?.scrollTo({ top: 0 });
    }, [tabKey]);

    const bodyHeight = isCover ? 0 : BODY_TOP_PX.gap + BODY_TOP_PX.line + BODY_TOP_PX.under + content.height;
    // Where the surface comes from and goes back to: a little smaller, toward the handle.
    const away = { opacity: 0, scale: 0.92 };

    return (
        <motion.div
            ref={layoutRef}
            onUpdate={onLayoutUpdate}
            initial={away}
            animate={{ opacity: 1, scale: 1, transition: kitTransition('unfold', reduced) }}
            exit={{ ...away, transition: kitTransition('move', reduced) }}
            data-testid="unified-panel-surface"
            data-still={isStill || undefined}
            className="st-window pointer-events-auto @container hide-scrollbar flex w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto overflow-x-hidden rounded-[20px] bg-[var(--pn-glass)] text-[color:var(--st-t1)] shadow-[var(--pn-shadow)] backdrop-blur-[40px] backdrop-saturate-[1.3] [&[data-still]_*]:transition-none"
            style={{
                ...panelTokens(isDaylight, theme, reduced),
                '--pn-under': `${underPx}px`,
                '--pn-room': headerRoom,
                // What is left of that room under the song's one line and the hairline: a tab with a
                // list of its own ends the list there, so the list scrolls and the tab does not.
                '--pn-tab-room': `calc(var(--pn-room) - ${FOLDED_PX + BODY_TOP_PX.gap + BODY_TOP_PX.line + BODY_TOP_PX.under}px)`,
                // The tab's body shrinks and scrolls first. Only a window too short for the cover
                // tab's least height makes the surface itself scroll, so the tab row stays in reach.
                maxHeight,
                padding: PADDING_PX,
                marginBottom: underPx,
                // The centre of the handle, at the surface's right end. Docked on the compact capsule the
                // 40px handle sits 8px in from the capsule's right edge, its centre 38px under the surface.
                transformOrigin: isDocked
                    ? 'calc(100% - 28px) calc(100% + 38px)'
                    : `calc(100% - 24px) calc(100% + ${underPx - 24}px)`,
            } as MotionStyle}
        >
            {header}

            {/* As wide as the surface, so the scrollbar (the kit's, as wide as the padding) lies in the surface's own padding. */}
            <div
                className="st-t-unfold flex min-h-0 shrink flex-col overflow-hidden transition-[height]"
                style={{ height: bodyHeight, marginInline: -PADDING_PX }}
            >
                <div
                    className="h-px shrink-0 bg-[var(--st-line)]"
                    style={{ marginTop: BODY_TOP_PX.gap, marginInline: PADDING_PX }}
                />
                {/* The tab scrolls here when the window is short. */}
                <div
                    ref={scrollRef}
                    className="st-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
                    style={{ paddingTop: BODY_TOP_PX.under, paddingLeft: PADDING_PX }}
                >
                    <div ref={contentRef} key={tabKey} className="st-page-in">
                        {children}
                    </div>
                </div>
            </div>

            <div className="shrink-0" style={{ height: DOCK_HEIGHT_PX, marginTop: DOCK_GAP_PX }}>
                {dock}
            </div>
        </motion.div>
    );
};

const PanelShell: React.FC<PanelShellProps> = ({ isOpen, handle, ...surface }) => {
    const bottomBarBottomPx = usePlayerBottomBarBottomPx();
    const { ref: layoutRef, invalidate: invalidateLayout } = usePlayerOverlayObstacle('player-panel', 'panel');
    // 紧凑档（progress-bar v3）：按钮挂在胶囊右端，面板从胶囊右端长出来，右边和胶囊对齐、底边在胶囊顶上
    // （bottomDock.css 平移这一层）。面板开着时胶囊不再悬停展开，免得两块玻璃叠在一起。
    const isDocked = useIsDockCompactWithCapsule();
    useEffect(() => {
        useBottomDockStore.getState().setCompanionOpen('panel', isOpen);
        return () => useBottomDockStore.getState().setCompanionOpen('panel', false);
    }, [isOpen]);

    return (
        <motion.div
            style={{ bottom: bottomBarBottomPx }}
            onUpdate={invalidateLayout}
            className="absolute right-0 z-[60] flex flex-col items-end pointer-events-none"
            onClick={(e) => e.stopPropagation()}
        >
            {/* 平移只加在面板这一层：按钮（handle）是 fixed 的兄弟，外层一带 translate 就成了它的定位参照，会被一起带偏。 */}
            <div
                className={`dock-companion dock-companion--panel-surface ${isDocked ? 'is-docked' : ''} pr-4 md:pr-8`}
                // 挂上、取下的平移走完再请 player.layout 量一次面板（CSS 平移不触发它自己的测量）。
                onTransitionEnd={invalidateLayout}
            >
                <AnimatePresence>
                    {isOpen && <PanelSurface {...surface} isDocked={isDocked} layoutRef={layoutRef} onLayoutUpdate={invalidateLayout} />}
                </AnimatePresence>
            </div>

            {handle}
        </motion.div>
    );
};

export default PanelShell;
