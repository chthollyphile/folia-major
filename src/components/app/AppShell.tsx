import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Lock, LockOpen } from 'lucide-react';
import type { Theme } from '../../types';
import { SettingsKitThemeContext } from '../modal/settings/kit/kitTheme';
import { SheetLayerContext } from '../shared/Sheet';
import TitlebarDragZone from '../TitlebarDragZone';
import WindowControls from '../WindowControls';
import { usePlayerOverlayRoot, usePlayerOverlayReservation } from '../../hooks/usePlayerOverlayLayout';
import { usePlayerChromeSettingsStore } from '../../stores/usePlayerChromeSettingsStore';
import type { FoliumLayoutRect } from '../../mods/folium/contract';

// Shared shell for the app container, Electron titlebar, and mounted audio node.
type AppShellProps = {
    appStyle: React.CSSProperties;
    isElectronWindow: boolean;
    hideFullscreenButton: boolean;
    usesCustomWindowChrome: boolean;
    useCustomWindowRadius: boolean;
    showTransparentWindowBorder: boolean;
    isPlayerView: boolean;
    isTitlebarRevealed: boolean;
    alwaysShowMainWindowTitlebar: boolean;
    isMainWindowClickThroughEnabled: boolean;
    showMainWindowClickThroughToggle: boolean;
    onToggleMainWindowClickThrough: () => void;
    isDaylight: boolean;
    theme: Theme;
    audioElement: React.ReactNode;
    children: React.ReactNode;
};

const TITLEBAR_REVEAL_HEIGHT = 56;
const titlebarRevealArea = (bounds: FoliumLayoutRect): FoliumLayoutRect => ({
    left: bounds.left, top: bounds.top, width: bounds.width, height: TITLEBAR_REVEAL_HEIGHT,
});

// 透明播放窗口的圆角应该跟宿主系统的窗口圆角一致。Windows 11 原生窗口圆角是 8px，
// 之前写死的 18px 让 Folia 窗口和桌面其他窗口看着不像同一套；其余平台沿用原来的半径。
export const resolveWindowCornerRadius = (platform: string): string => (
    platform === 'win32' ? '8px' : '18px'
);

const AppShell: React.FC<AppShellProps> = ({
    appStyle,
    isElectronWindow,
    hideFullscreenButton,
    usesCustomWindowChrome,
    useCustomWindowRadius,
    showTransparentWindowBorder,
    isPlayerView,
    isTitlebarRevealed,
    alwaysShowMainWindowTitlebar,
    isMainWindowClickThroughEnabled,
    showMainWindowClickThroughToggle,
    onToggleMainWindowClickThrough,
    isDaylight,
    theme,
    audioElement,
    children,
}) => {
    const { t } = useTranslation();
    const layoutRootRef = useRef<HTMLDivElement>(null);
    usePlayerOverlayRoot(layoutRootRef, isPlayerView, { top: usesCustomWindowChrome ? TITLEBAR_REVEAL_HEIGHT : 0, right: 0, bottom: 0, left: 0 });
    usePlayerOverlayReservation('window-titlebar-reveal', 'window', titlebarRevealArea, usesCustomWindowChrome);
    // Light or dark and the theme, for the shared parts that colour themselves wherever they open (a dialog's sheet).
    const kitTheme = useMemo(() => ({ isDaylight, theme }), [isDaylight, theme]);
    const [sheetLayer, setSheetLayer] = useState<HTMLDivElement | null>(null);
    const [isWindowMaximized, setIsWindowMaximized] = useState(false);
    const [isWindowFullscreen, setIsWindowFullscreen] = useState(false);
    const hasFullscreenTitlebarButton = isElectronWindow && !hideFullscreenButton;
    const playerHeaderBlur = usePlayerChromeSettingsStore(state => state.playerHeaderBlur);

    useEffect(() => {
        if (!useCustomWindowRadius || !window.electron?.isWindowMaximized) {
            setIsWindowMaximized(false);
            return;
        }

        let isCancelled = false;

        const syncMaximizedState = async () => {
            try {
                const nextValue = await window.electron!.isWindowMaximized();
                if (!isCancelled) {
                    setIsWindowMaximized(nextValue);
                }
            } catch {
                if (!isCancelled) {
                    setIsWindowMaximized(false);
                }
            }
        };

        void syncMaximizedState();
        window.addEventListener('resize', syncMaximizedState);

        return () => {
            isCancelled = true;
            window.removeEventListener('resize', syncMaximizedState);
        };
    }, [useCustomWindowRadius]);

    // 全屏不等于「最大化」，不排除它，透明播放窗口在全屏下仍会保留圆角、露出背后的桌面。
    // 与 WindowControls 一样，先读一次再订阅 enter/leave-full-screen 事件，覆盖菜单和快捷键触发的全屏。
    useEffect(() => {
        if (!useCustomWindowRadius || !window.electron?.isWindowFullscreen) {
            setIsWindowFullscreen(false);
            return;
        }

        let isCancelled = false;
        let fullscreenEventReceived = false;

        const unsubscribe = window.electron!.onWindowFullscreenChanged(fullscreen => {
            fullscreenEventReceived = true;
            if (!isCancelled) {
                setIsWindowFullscreen(fullscreen);
            }
        });

        const syncFullscreenState = async () => {
            try {
                const nextValue = await window.electron!.isWindowFullscreen();
                if (!isCancelled && !fullscreenEventReceived) {
                    setIsWindowFullscreen(nextValue);
                }
            } catch {
                if (!isCancelled && !fullscreenEventReceived) {
                    setIsWindowFullscreen(false);
                }
            }
        };

        void syncFullscreenState();

        return () => {
            isCancelled = true;
            unsubscribe();
        };
    }, [useCustomWindowRadius]);

    const shouldApplyWindowRadius = useCustomWindowRadius && !isWindowMaximized && !isWindowFullscreen;
    const areTitlebarControlsVisible = isTitlebarRevealed || alwaysShowMainWindowTitlebar;
    // 播放页顶栏模糊背景：浅色主题压在深色画面上时，标题栏按钮看不清，开了就给播放页也垫上主页那层磨砂底。
    // 跟着按钮一起出现（悬停顶部或「始终显示标题栏控制按钮」），点击穿透时按钮都藏了，底也不画。
    const showsPlayerHeaderBlur = isPlayerView && playerHeaderBlur && !isMainWindowClickThroughEnabled;
    const shouldRenderTitlebarBackdrop = !isPlayerView || showsPlayerHeaderBlur || (useCustomWindowRadius && !isMainWindowClickThroughEnabled);
    const isTitlebarBackdropVisible = isTitlebarRevealed || (showsPlayerHeaderBlur && alwaysShowMainWindowTitlebar);
    // 开了顶栏模糊时用更实的一层：0.18 的白在深色画面上只会混成深灰，浅色主题的深色按钮照样看不清，
    // 得把底色抬到接近浅色主题的底；深色主题同理压暗。透明窗口原有的 0.18 样式不变。
    const titlebarBackdropClassName = showsPlayerHeaderBlur
        ? `absolute inset-0 backdrop-blur-md border-b ${
            isDaylight
                ? 'bg-white/65 border-black/5 shadow-[0_8px_28px_rgba(0,0,0,0.06)]'
                : 'bg-black/40 border-white/10 shadow-[0_8px_28px_rgba(0,0,0,0.20)]'
        }`
        : `absolute inset-0 backdrop-blur-sm ${
            isDaylight
                ? isPlayerView
                    ? 'bg-white/[0.18] border-b border-white/25 shadow-[0_8px_28px_rgba(0,0,0,0.06)]'
                    : 'bg-white/[0.12] border-b border-white/15'
                : isPlayerView
                    ? 'bg-black/[0.18] border-b border-white/10 shadow-[0_8px_28px_rgba(0,0,0,0.20)]'
                    : ''
        }`;

    return (
        <div
            ref={layoutRootRef}
            className="fixed inset-0 w-full h-full flex flex-col overflow-hidden font-sans transition-colors duration-500"
            style={{
                ...appStyle,
                borderRadius: shouldApplyWindowRadius ? resolveWindowCornerRadius(window.electron?.platform ?? '') : undefined,
                boxShadow: showTransparentWindowBorder ? 'inset 0 0 0 1px rgba(255,255,255,0.24)' : undefined,
            }}
        >
            {usesCustomWindowChrome && (
                <div className="absolute top-0 left-0 right-0 z-[9999] h-8 pointer-events-none">
                    {shouldRenderTitlebarBackdrop && (
                        <motion.div
                            initial={false}
                            animate={{
                                opacity: isTitlebarBackdropVisible ? 1 : 0,
                            }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                            className={titlebarBackdropClassName}
                        />
                    )}
                    <div className="relative h-full">
                        <TitlebarDragZone active={usesCustomWindowChrome} />
                        <div
                            className={`pointer-events-auto absolute top-0 z-20 h-full flex items-center ${
                                hasFullscreenTitlebarButton ? 'right-[224px]' : 'right-[180px]'
                            }`}
                            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                        >
                            <button
                                type="button"
                                aria-label={isMainWindowClickThroughEnabled ? 'Disable click-through' : 'Enable click-through'}
                                title={isMainWindowClickThroughEnabled ? t('remote.disableClickThrough') : t('remote.enableClickThrough')}
                                onClick={onToggleMainWindowClickThrough}
                                className={`flex h-7 w-7 items-center justify-center rounded-full border shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-md transition-all duration-200 ${
                                    showMainWindowClickThroughToggle
                                        ? 'click-through-interactive pointer-events-auto opacity-100 translate-y-0'
                                        : 'pointer-events-none opacity-0 -translate-y-1'
                                } ${
                                    isMainWindowClickThroughEnabled
                                        ? isDaylight
                                            ? 'border-amber-500/30 bg-amber-50/80 text-amber-700 hover:bg-amber-100/90'
                                            : 'border-amber-300/35 bg-black/55 text-amber-100 hover:bg-black/70'
                                        : isDaylight
                                            ? 'border-black/[0.06] bg-white/40 text-zinc-700 hover:bg-white/80 hover:text-zinc-900 shadow-[0_4px_12px_rgba(0,0,0,0.04)]'
                                            : 'border-white/15 bg-transparent text-white/75 hover:bg-black/20 hover:text-white'
                                }`}
                            >
                                {isMainWindowClickThroughEnabled ? <Lock size={14} /> : <LockOpen size={14} />}
                            </button>
                        </div>
                        <div className="pointer-events-auto absolute top-0 right-0 z-10 h-full">
                            <WindowControls
                                revealed={areTitlebarControlsVisible}
                                isDaylight={isDaylight}
                                isMainWindowClickThroughEnabled={isMainWindowClickThroughEnabled}
                                hideFullscreenButton={hideFullscreenButton}
                            />
                        </div>
                    </div>
                </div>
            )}

            {audioElement}
            <SettingsKitThemeContext.Provider value={kitTheme}>
                <SheetLayerContext.Provider value={sheetLayer}>
                    {children}
                </SheetLayerContext.Provider>
            </SettingsKitThemeContext.Provider>
            {/* Dialogs are drawn here: after every page and window of the app, inside its colour variables. */}
            <div ref={setSheetLayer} />
        </div>
    );
};

export default AppShell;
