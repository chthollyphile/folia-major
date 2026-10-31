import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useTransform, type MotionStyle } from 'framer-motion';
import type { Theme } from '../../../types';
import { usePlayerBottomBarBottomPx } from '../../../hooks/usePlayerBottomBarBottomPx';
import { usePlayerOverlayObstacle } from '../../../hooks/usePlayerOverlayLayout';
import { kitTransition, useKitReducedMotion } from '../../modal/settings/kit/motion';
import { panelTokens } from './panelTheme';
import { FOLDED_PX } from './SongHeader';
import { useMeasuredSize } from './useMeasuredSize';
import { useGlass } from '@/shinoinject/useGlass';

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
    /** Registers the surface as an obstacle of the player layout. */
    layoutRef: (element: HTMLElement | null) => void;
    /** Tells the player layout that the surface moved. */
    onLayoutUpdate: () => void;
};

const PanelSurface: React.FC<PanelSurfaceProps> = ({ hasHandle, isCover, tabKey, theme, isDaylight, header, dock, children, layoutRef, onLayoutUpdate }) => {
    const reduced = useKitReducedMotion();
    const bottomBarBottomPx = usePlayerBottomBarBottomPx();
    // What is under the surface: the handle, or a small gap. A variable, so the two heights below follow it at once.
    const underPx = hasHandle ? HANDLE_ROOM_PX : BARE_GAP_PX;
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

    useGlass();
    return (
        <motion.div
            ref={layoutRef}
            onUpdate={onLayoutUpdate}
            initial={away}
            animate={{ opacity: 1, scale: 1, transition: kitTransition('unfold', reduced) }}
            exit={{ ...away, transition: kitTransition('move', reduced) }}
            data-glass data-glass-light
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
                // The centre of the handle, at the surface's right end.
                  transformOrigin: `calc(100% - 24px) calc(100% + ${underPx - 24}px)`,
                  backgroundColor: isDaylight
                    ? "rgba(255,255,255,0.4)"
                    : "rgba(0,0,0,0.4)",
                  borderTop: isDaylight
                    ? "1px solid rgba(0,0,0,0.08)"
                    : "1px solid rgba(255,255,255,0.12)",
                  borderBottom: isDaylight
                    ? "1px solid rgba(0,0,0,0.08)"
                    : "1px solid rgba(255,255,255,0.12)",
                  outline: "1px solid rgba(40,40,40,0.2)",
                  boxShadow: "2px 2px 8px 2px rgba(40,40,40,0.4)",
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

    return (
        <motion.div
            style={{ bottom: bottomBarBottomPx }}
            onUpdate={invalidateLayout}
            className="absolute right-0 z-[60] flex flex-col items-end pointer-events-none"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="pr-4 md:pr-8">
                <AnimatePresence>
                    {isOpen && <PanelSurface {...surface} layoutRef={layoutRef} onLayoutUpdate={invalidateLayout} />}
                </AnimatePresence>
            </div>

            {handle}
        </motion.div>
    );
};

export default PanelShell;
