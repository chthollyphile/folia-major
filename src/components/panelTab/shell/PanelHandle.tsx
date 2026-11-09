import React from 'react';
import { PANEL_SLIDE_CLAMP_PX, PANEL_SLIDE_TRACK_BASE_PX, PANEL_SLIDE_TRACK_FULL_PX, PANEL_SLIDE_TRIGGER_PX } from '../../../utils/panelSlideGesture';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings2, X, Command } from 'lucide-react';
import type { Theme } from '../../../types';
import { usePlayerBottomBarBottomPx } from '../../../hooks/usePlayerBottomBarBottomPx';
import { usePlayerOverlayObstacle } from '../../../hooks/usePlayerOverlayLayout';
import { holdCompanionHover, releaseCompanionHover, useBottomDockStore, useIsDockCompactWithCapsule } from '../../../stores/useBottomDockStore';

// src/components/panelTab/shell/PanelHandle.tsx
// The round button at the bottom right of the playing page that opens the panel and, white, closes
// it. Slid to the left while the panel is closed, it opens the command palette instead: the track
// it slides on, the feedback while it is dragged, and the guide that shows the track on hover or
// after a touch beside it.

const TOUCH_GUIDE_DISPLAY_MS = 1400;

type PanelHandleProps = {
    isOpen: boolean;
    onToggle: () => void;
    theme: Theme;
    isDaylight: boolean;
    showOpenPanelCloseButton: boolean;
    isPanelGuideHotspotActive: boolean;
    hideToggleButton: boolean;
    onOpenCommandPalette?: () => void;
    isCommandPaletteOpen: boolean;
};

const PanelHandle: React.FC<PanelHandleProps> = ({
    isOpen,
    onToggle,
    theme,
    isDaylight,
    showOpenPanelCloseButton,
    isPanelGuideHotspotActive,
    hideToggleButton,
    onOpenCommandPalette,
    isCommandPaletteOpen,
}) => {
    const [showGuideLine, setShowGuideLine] = React.useState(false);
    const [isDragging, setIsDragging] = React.useState(false);
    const guideHideTimeoutRef = React.useRef<number | null>(null);
    const bottomBarBottomPx = usePlayerBottomBarBottomPx();
    // The button is in the way of a mod's player layout, as the open panel above it is.
    const { ref: layoutRef, invalidate: invalidateLayout } = usePlayerOverlayObstacle('panel-toggle', 'panel');
    const supportsHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const commandSlideRef = React.useRef<{ startX: number; startY: number; triggered: boolean; } | null>(null);
    const suppressToggleClickRef = React.useRef(false);
    const toggleButtonRef = React.useRef<HTMLButtonElement | null>(null);
    const trackEndIconRef = React.useRef<HTMLDivElement | null>(null);
    const trackFillRef = React.useRef<HTMLDivElement | null>(null);
    // 紧凑档（窗口窄于 960，progress-bar v3）里按钮挂到进度条胶囊的右端：缩成 40、去掉自己的底色，
    // 位置由 bottomDock.css 按 <html data-bottom-layout> 平移过去。挂着时没有左滑开命令面板的手势：
    // 滑轨会横在胶囊上；命令面板从点胶囊或快捷行最右那一格开。
    const isDocked = useIsDockCompactWithCapsule();
    const canSlideOpenCommandPalette = !isOpen && Boolean(onOpenCommandPalette) && !isDocked;
    // 按钮这一刻画不画（下面 AnimatePresence 的条件）。它被拿掉时浏览器不会补发 pointerleave：
    // 不在这里清掉，胶囊会一直当作还在悬停、一直展开着。
    const isButtonShown = !hideToggleButton && (!isOpen || showOpenPanelCloseButton) && !isCommandPaletteOpen;
    React.useEffect(() => {
        if (!isButtonShown) releaseCompanionHover(true);
    }, [isButtonShown]);
    const isGuideLineVisible = canSlideOpenCommandPalette && (showGuideLine || isPanelGuideHotspotActive);
    React.useEffect(() => {
        if (hideToggleButton) return undefined;
        const store = useBottomDockStore.getState();
        store.setCompanion('panel-toggle', true);
        return () => {
            useBottomDockStore.getState().setCompanion('panel-toggle', false);
            releaseCompanionHover(true);
        };
    }, [hideToggleButton]);
    const toggleButtonMotionClass = (isOpen || isGuideLineVisible || isDragging || isDocked)
        ? 'translate-x-0 opacity-100'
        : supportsHover
            ? 'translate-x-1/2 opacity-60 group-hover:translate-x-0 group-hover:opacity-100 md:translate-x-0 md:opacity-100 md:hover:scale-105'
            : 'translate-x-1/2 opacity-60';
    const setCommandDestinationFeedback = (progress: number) => {
        const iconContainer = trackEndIconRef.current;
        if (!iconContainer) {
            return;
        }

        iconContainer.style.opacity = String(0.35 + progress * 0.65);
        iconContainer.style.transform = `scale(${1.0 + progress * 0.15}) rotate(${progress * 45}deg)`;

        if (progress >= 1) {
            iconContainer.style.color = theme.accentColor;
        } else {
            iconContainer.style.color = '';
        }
    };
    const resetCommandDestinationFeedback = () => {
        const iconContainer = trackEndIconRef.current;
        if (!iconContainer) {
            return;
        }

        iconContainer.style.transition = 'opacity 150ms ease-out, transform 150ms ease-out, color 150ms ease-out';
        iconContainer.style.opacity = '0.35';
        iconContainer.style.transform = 'scale(1) rotate(0deg)';
        iconContainer.style.color = '';
    };
    const setToggleButtonDragFeedback = (deltaX: number) => {
        const button = toggleButtonRef.current;
        if (!button) {
            return;
        }

        const dragX = Math.max(-PANEL_SLIDE_CLAMP_PX, Math.min(0, deltaX));
        const progress = Math.min(1, Math.abs(dragX) / PANEL_SLIDE_TRIGGER_PX);
        button.style.transition = 'none';
        button.style.transform = `translateX(${dragX}px)`;
        button.style.filter = `brightness(${1 + progress * 0.18})`;

        const icon = button.querySelector('svg');
        if (icon) {
            icon.style.transform = `rotate(${progress * -180}deg)`;
            icon.style.scale = String(1 - progress * 0.1);
        }

        if (progress >= 1) {
            button.style.backgroundColor = theme.accentColor;
            button.style.color = '#ffffff';
            button.style.boxShadow = `0 0 16px ${theme.accentColor}66, 0 18px 42px rgba(0, 0, 0, ${0.24 + progress * 0.16})`;
        } else {
            button.style.backgroundColor = '';
            button.style.color = '';
            button.style.boxShadow = `0 18px 42px rgba(0, 0, 0, ${0.24 + progress * 0.16})`;
        }

        // update osu! Slider Track Fill
        const trackFill = trackFillRef.current;
        if (trackFill) {
            trackFill.style.transition = 'none';
            trackFill.style.width = `${PANEL_SLIDE_TRACK_BASE_PX + Math.abs(dragX)}px`;
            if (progress >= 1) {
                trackFill.style.backgroundColor = theme.accentColor;
                trackFill.style.opacity = '0.35';
            } else {
                trackFill.style.backgroundColor = '';
                trackFill.style.opacity = '';
            }
        }

        const iconContainer = trackEndIconRef.current;
        if (iconContainer) {
            iconContainer.style.transition = 'none';
        }

        setCommandDestinationFeedback(progress);
    };
    const resetToggleButtonDragFeedback = (mode: 'release' | 'trigger' = 'release', deltaX = 0) => {
        setIsDragging(false);
        const button = toggleButtonRef.current;
        if (!button) {
            resetCommandDestinationFeedback();
            return;
        }

        const dragX = Math.max(-PANEL_SLIDE_CLAMP_PX, Math.min(0, deltaX));

        if (mode === 'trigger') {
            button.animate(
                [
                    { transform: `translateX(${dragX}px) scale(1)`, opacity: '1', filter: 'brightness(1.18)' },
                    { transform: 'translateX(-80px) scale(0.8)', opacity: '0' },
                ],
                { duration: 250, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
            );

            const iconContainer = trackEndIconRef.current;
            if (iconContainer) {
                iconContainer.animate(
                    [
                        { transform: 'scale(1.15) rotate(45deg)', opacity: '1' },
                        { transform: 'translateX(-40px) scale(0.9) rotate(45deg)', opacity: '0' },
                    ],
                    { duration: 250, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
                );
            }

            const trackFill = trackFillRef.current;
            if (trackFill) {
                trackFill.animate(
                    [
                        { width: `${PANEL_SLIDE_TRACK_BASE_PX + Math.abs(dragX)}px`, opacity: '0.35' },
                        { width: `${PANEL_SLIDE_TRACK_FULL_PX}px`, opacity: '0' },
                    ],
                    { duration: 250, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
                );
            }

            resetCommandDestinationFeedback();

            button.style.transition = '';
            button.style.transform = '';
            button.style.filter = '';
            button.style.boxShadow = '';
            button.style.backgroundColor = '';
            button.style.color = '';
            const icon = button.querySelector('svg');
            if (icon) {
                icon.style.transition = '';
                icon.style.transform = '';
                icon.style.scale = '';
            }

            if (trackFill) {
                trackFill.style.transition = '';
                trackFill.style.width = `${PANEL_SLIDE_TRACK_BASE_PX}px`;
                trackFill.style.backgroundColor = '';
                trackFill.style.opacity = '';
            }

            if (iconContainer) {
                iconContainer.style.transition = '';
                iconContainer.style.opacity = '0.35';
                iconContainer.style.transform = '';
                iconContainer.style.color = '';
            }
            return;
        }

        resetCommandDestinationFeedback();
        button.style.transition = 'transform 160ms ease-out, filter 160ms ease-out, box-shadow 160ms ease-out, background-color 160ms ease-out, color 160ms ease-out';
        button.style.transform = '';
        button.style.filter = '';
        button.style.boxShadow = '';
        button.style.backgroundColor = '';
        button.style.color = '';

        const icon = button.querySelector('svg');
        if (icon) {
            icon.style.transition = 'transform 160ms ease-out, scale 160ms ease-out';
            icon.style.transform = '';
            icon.style.scale = '';
        }

        const trackFill = trackFillRef.current;
        if (trackFill) {
            trackFill.style.transition = 'width 160ms ease-out, background-color 160ms ease-out, opacity 160ms ease-out';
            trackFill.style.width = `${PANEL_SLIDE_TRACK_BASE_PX}px`;
            trackFill.style.backgroundColor = '';
            trackFill.style.opacity = '';
        }
    };
    const handleToggleButtonPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!canSlideOpenCommandPalette) {
            return;
        }

        commandSlideRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            triggered: false,
        };
        suppressToggleClickRef.current = false;
        setShowGuideLine(false);
        setIsDragging(true);

        setToggleButtonDragFeedback(0);
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };
    const handleToggleButtonPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        const gesture = commandSlideRef.current;
        if (!canSlideOpenCommandPalette || !gesture || gesture.triggered) {
            return;
        }

        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        setToggleButtonDragFeedback(deltaX);
        if (deltaX <= -PANEL_SLIDE_TRIGGER_PX && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
            gesture.triggered = true;
            suppressToggleClickRef.current = true;
            event.preventDefault();
            resetToggleButtonDragFeedback('trigger', deltaX);
            onOpenCommandPalette?.();
        }
    };
    const handleToggleButtonMouseEnter = () => {
        if (supportsHover && canSlideOpenCommandPalette) {
            setShowGuideLine(true);
        }
    };
    const handleToggleButtonMouseLeave = () => {
        if (supportsHover) {
            setShowGuideLine(false);
        }
    };
    // 挂在胶囊上时，鼠标停在按钮上胶囊也算在悬停，不会从展开缩回去。只认鼠标和笔：
    // 手指点完浏览器会补发 mouseenter，又没有对应的离开，胶囊就会一直展开着。
    const handleCompanionPointerEnter = (event: React.PointerEvent<HTMLDivElement>) => {
        if (isDocked && event.pointerType !== 'touch') {
            holdCompanionHover();
        }
    };
    const handleCompanionPointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== 'touch') {
            releaseCompanionHover();
        }
    };
    const handleToggleHotspotPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== 'touch' || !canSlideOpenCommandPalette) {
            return;
        }

        if (event.target instanceof Node && toggleButtonRef.current?.contains(event.target)) {
            return;
        }

        if (guideHideTimeoutRef.current !== null) {
            window.clearTimeout(guideHideTimeoutRef.current);
        }

        setShowGuideLine(true);
        guideHideTimeoutRef.current = window.setTimeout(() => {
            guideHideTimeoutRef.current = null;
            setShowGuideLine(false);
        }, TOUCH_GUIDE_DISPLAY_MS);
    };
    const clearToggleButtonGesture = () => {
        commandSlideRef.current = null;
        resetToggleButtonDragFeedback();
    };
    const handleToggleButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        if (suppressToggleClickRef.current) {
            suppressToggleClickRef.current = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        onToggle();
    };

    React.useEffect(() => () => {
        if (guideHideTimeoutRef.current !== null) {
            window.clearTimeout(guideHideTimeoutRef.current);
        }
    }, []);

    return (
        <AnimatePresence>
            {isButtonShown && (
                <motion.div
                    initial={{ opacity: 0, x: 20, y: 12, scale: 0.92 }}
                    animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                    exit={isCommandPaletteOpen
                        ? { opacity: 0, x: 0, y: 0, scale: 1 }
                        : { opacity: 0, x: 20, y: 12, scale: 0.92 }
                    }
                    transition={{ duration: 0.24, ease: 'easeOut' }}
                    data-testid="panel-toggle"
                    ref={layoutRef}
                    onUpdate={invalidateLayout}
                    // 挂上、取下只动 CSS 的 translate / scale，尺寸观察和 framer 的 onUpdate 都不会响：
                    // 平移走完再请模组的 player.layout 量一次，不然它拿到的是半路的位置。
                    onTransitionEnd={invalidateLayout}
                    style={{ bottom: bottomBarBottomPx }}
                    className={`dock-companion dock-companion--panel ${isDocked ? 'is-docked' : ''} pointer-events-auto fixed right-0 z-[60] pr-4 md:pr-8 group w-20 flex justify-end`}
                    onMouseEnter={handleToggleButtonMouseEnter}
                    onMouseLeave={handleToggleButtonMouseLeave}
                    onPointerEnter={handleCompanionPointerEnter}
                    onPointerLeave={handleCompanionPointerLeave}
                    onPointerDown={handleToggleHotspotPointerDown}
                >
                    {/* Wrapper for both track and button to guarantee perfect alignment across browsers */}
                    <div className={`relative w-12 h-12 transition-all duration-300 transform ${toggleButtonMotionClass}`}>
                        {/* osu! Slider Track */}
                        <div
                            style={{
                                width: '96px',
                                transition: 'opacity 200ms ease-out',
                            }}
                            className={`absolute right-0 top-0 h-12 rounded-full border pointer-events-none z-0 ${
                                isGuideLineVisible || isDragging
                                    ? 'opacity-100'
                                    : 'opacity-0'
                            } ${
                                isDaylight
                                    ? 'border-black/10 bg-black/5'
                                    : 'border-white/10 bg-white/5'
                            }`}
                        >
                            {/* Semi-transparent command icon at the left end of the track */}
                            <motion.div 
                                className="absolute left-3.5 top-[17px] w-3.5 h-3.5 pointer-events-none flex items-center justify-center"
                                animate={isGuideLineVisible ? {
                                    x: [0, -4, 0],
                                    opacity: [0.45, 0.85, 0.45],
                                } : {
                                    x: 0,
                                    opacity: 0.45,
                                }}
                                transition={isGuideLineVisible ? {
                                    duration: 1.5,
                                    repeat: Infinity,
                                    ease: "easeInOut",
                                } : undefined}
                            >
                                <div
                                    ref={trackEndIconRef}
                                    style={{ 
                                        color: isDaylight ? '#000000' : '#ffffff',
                                    }}
                                    className="w-full h-full flex items-center justify-center"
                                >
                                    <Command size={14} />
                                </div>
                            </motion.div>

                            {/* Track Fill */}
                            <div
                                ref={trackFillRef}
                                style={{
                                    width: '48px',
                                }}
                                className={`absolute right-0 top-0 bottom-0 rounded-full pointer-events-none ${
                                    isDaylight ? 'bg-black/10' : 'bg-white/10'
                                }`}
                            />
                        </div>

                        <button
                            ref={toggleButtonRef}
                            type="button"
                            onPointerDown={handleToggleButtonPointerDown}
                            onPointerMove={handleToggleButtonPointerMove}
                            onPointerUp={clearToggleButtonGesture}
                            onPointerCancel={clearToggleButtonGesture}
                            onClick={handleToggleButtonClick}
                            style={{ touchAction: canSlideOpenCommandPalette ? 'none' : undefined }}
                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 transform
                                border-none absolute right-0 top-0 z-10 ${isOpen
                    ? 'bg-white text-black shadow-lg'
                    : isDocked
                    // 挂在胶囊上：胶囊的玻璃就是它的底，不再叠一层自己的。
                        ? `bg-transparent ${isDaylight ? 'text-zinc-900 hover:bg-black/5' : 'text-white hover:bg-white/10'}`
                        : `shadow-lg backdrop-blur-md ${isDaylight ? 'bg-white/70 text-zinc-900' : 'bg-black/40 text-white'}`}`}
                        >
                            {isOpen ? <X size={20} /> : <Settings2 size={20} />}
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default PanelHandle;
