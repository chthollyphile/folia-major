import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Line, Theme } from '../../types';
import { resolveThemeTranslationFontStack } from '../../utils/fontStacks';

interface VisualizerSubtitleOverlayProps {
    showText: boolean;
    activeLine: Line | null;
    recentCompletedLine: Line | null;
    nextLines: Line[];
    theme: Theme;
    translationFontSize: string;
    upcomingFontSize: string;
    opacity?: number;
}

const VisualizerSubtitleOverlay: React.FC<VisualizerSubtitleOverlayProps> = ({
    showText,
    activeLine,
    recentCompletedLine,
    nextLines,
    theme,
    translationFontSize,
    upcomingFontSize,
    opacity = 0.6,
}) => {
    return (
        <AnimatePresence>
            {showText && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="absolute bottom-28 w-full text-center space-y-2 px-4 z-20 pointer-events-none"
                >
                    {(activeLine?.translation || recentCompletedLine?.translation) ? (
                        <motion.div
                            key={`trans-${activeLine?.startTime || recentCompletedLine?.startTime}`}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            data-font-debug-target="visualizer-translation"
                            className="font-medium max-w-4xl mx-auto"
                            style={{
                                color: theme.secondaryColor,
                                fontSize: translationFontSize,
                                fontFamily: resolveThemeTranslationFontStack(theme),
                            }}
                        >
                            {activeLine?.translation || recentCompletedLine?.translation}
                        </motion.div>
                    ) : (
                        activeLine && nextLines.map((line, index) => (
                            <p
                                key={index}
                                className="truncate max-w-2xl mx-auto transition-all duration-500 blur-[1px]"
                                style={{
                                    color: theme.secondaryColor,
                                    fontSize: upcomingFontSize,
                                }}
                            >
                                {line.fullText}
                            </p>
                        ))
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default VisualizerSubtitleOverlay;
