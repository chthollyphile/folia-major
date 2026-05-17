import React from 'react';
import { motion } from 'framer-motion';
import TitlebarDragZone from '../TitlebarDragZone';
import WindowControls from '../WindowControls';

// Shared shell for the app container, Electron titlebar, and mounted audio node.
type AppShellProps = {
    appStyle: React.CSSProperties;
    isElectronWindow: boolean;
    isPlayerView: boolean;
    isTitlebarRevealed: boolean;
    audioElement: React.ReactNode;
    children: React.ReactNode;
};

const AppShell: React.FC<AppShellProps> = ({
    appStyle,
    isElectronWindow,
    isPlayerView,
    isTitlebarRevealed,
    audioElement,
    children,
}) => {
    return (
        <div
            className="fixed inset-0 w-full h-full flex flex-col overflow-hidden font-sans transition-colors duration-500"
            style={appStyle}
        >
            {isElectronWindow && (
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
                        <TitlebarDragZone active={isElectronWindow} />
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
