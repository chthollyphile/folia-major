import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import TitlebarDragZone from '../TitlebarDragZone';
import WindowControls from '../WindowControls';

// Shared shell for the app container, Electron titlebar, and mounted audio node.
type AppShellProps = {
    appStyle: React.CSSProperties;
    isElectronWindow: boolean;
    usesCustomWindowChrome: boolean;
    useCustomWindowRadius: boolean;
    showTransparentWindowBorder: boolean;
    isPlayerView: boolean;
    isTitlebarRevealed: boolean;
    showClickThroughUnlockButton: boolean;
    onDisableMainWindowClickThrough: () => void;
    audioElement: React.ReactNode;
    children: React.ReactNode;
};

const AppShell: React.FC<AppShellProps> = ({
    appStyle,
    isElectronWindow,
    usesCustomWindowChrome,
    useCustomWindowRadius,
    showTransparentWindowBorder,
    isPlayerView,
    isTitlebarRevealed,
    showClickThroughUnlockButton,
    onDisableMainWindowClickThrough,
    audioElement,
    children,
}) => {
    const [isWindowMaximized, setIsWindowMaximized] = useState(false);

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

    const shouldApplyWindowRadius = useCustomWindowRadius && !isWindowMaximized;

    return (
        <div
            className="fixed inset-0 w-full h-full flex flex-col overflow-hidden font-sans transition-colors duration-500"
            style={{
                ...appStyle,
                borderRadius: shouldApplyWindowRadius ? '18px' : undefined,
                boxShadow: showTransparentWindowBorder ? 'inset 0 0 0 1px rgba(255,255,255,0.24)' : undefined,
            }}
        >
            {usesCustomWindowChrome && (
                <div className="absolute top-0 left-0 right-0 z-[9999] h-8 pointer-events-none">
                    {!isPlayerView && (
                        <motion.div
                            initial={false}
                            animate={{
                                opacity: isTitlebarRevealed ? 1 : 0,
                            }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                            className="absolute inset-0 backdrop-blur-sm"
                        />
                    )}
                    <div className="relative h-full">
                        <TitlebarDragZone active={usesCustomWindowChrome} />
                        {showClickThroughUnlockButton && (
                            <div
                                className="pointer-events-auto absolute top-1 right-[180px] z-20"
                                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                            >
                                <button
                                    type="button"
                                    aria-label="Disable click-through"
                                    title="解除点击穿透"
                                    onClick={onDisableMainWindowClickThrough}
                                    className="flex h-7 w-7 items-center justify-center rounded-full border border-amber-300/35 bg-black/55 text-amber-100 shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-md transition hover:bg-black/70"
                                >
                                    <Lock size={14} />
                                </button>
                            </div>
                        )}
                        <div className="pointer-events-auto absolute top-0 right-0 z-10 h-full">
                            <WindowControls revealed={isTitlebarRevealed} />
                        </div>
                    </div>
                </div>
            )}

            {audioElement}
            {children}
        </div>
    );
};

export default AppShell;
