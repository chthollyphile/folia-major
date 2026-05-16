import React, { forwardRef, useState } from 'react';
import { AnimatePresence, motion, MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import { AudioBands, Theme } from '../../types';
import { resolveThemeFontStack } from '../../utils/fontStacks';
import FluidBackground from './FluidBackground';
import GeometricBackground from './GeometricBackground';

// Shared outer shell for all visualizers.
// This is where we keep background layering, font injection, and the hover-only back button
// so each renderer can stay focused on lyric timing/layout instead of rebuilding the same frame.
interface VisualizerShellProps {
    theme: Theme;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    coverUrl?: string | null;
    useCoverColorBg?: boolean;
    seed?: string | number;
    backgroundOpacity?: number;
    staticMode?: boolean;
    disableGeometricBackground?: boolean;
    paused?: boolean;
    onBack?: () => void;
    children: React.ReactNode;
    className?: string;
}

const VisualizerShell = forwardRef<HTMLDivElement, VisualizerShellProps>(({
    theme,
    audioPower,
    audioBands,
    coverUrl,
    useCoverColorBg = false,
    seed,
    backgroundOpacity = 0.75,
    staticMode = false,
    disableGeometricBackground = false,
    paused = false,
    onBack,
    children,
    className = '',
}, ref) => {
    const { t } = useTranslation();
    const [showBackButton, setShowBackButton] = useState(false);

    // Keep the tailwind font utility roughly aligned with the theme category,
    // but still let the real resolved font stack win through inline style.
    const fontClassName = theme.fontStyle === 'mono'
        ? 'font-mono'
        : theme.fontStyle === 'serif'
            ? 'font-serif'
            : 'font-sans';

    return (
        <div
            ref={ref}
            className={`w-full h-full flex flex-col items-center justify-center overflow-hidden relative ${fontClassName} transition-colors duration-1000 ${className}`.trim()}
            style={{
                backgroundColor: 'transparent',
                fontFamily: resolveThemeFontStack(theme),
            }}
            onMouseMove={(event) => {
                // Back button is intentionally hidden most of the time.
                // Only reveal it near the top-left hot area so it does not pollute the visual field.
                const nearBackArea = event.clientX <= 120 && event.clientY <= 120;
                if (nearBackArea !== showBackButton) {
                    setShowBackButton(nearBackArea);
                }
            }}
            onMouseLeave={() => {
                if (showBackButton) {
                    setShowBackButton(false);
                }
            }}
        >
            {onBack && (
                <motion.button
                    type="button"
                    aria-label={t('ui.backToHome')}
                    initial={false}
                    animate={{
                        opacity: showBackButton ? 1 : 0,
                        scale: showBackButton ? 1 : 0.92,
                        x: showBackButton ? 0 : -6,
                    }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onBack();
                    }}
                    className="absolute top-6 left-6 z-30 h-10 w-10 rounded-full flex items-center justify-center transition-colors backdrop-blur-md bg-black/20 hover:bg-white/10 text-white/60 pointer-events-auto"
                    style={{ pointerEvents: showBackButton ? 'auto' : 'none' }}
                >
                    <ChevronLeft size={20} />
                </motion.button>
            )}

            <AnimatePresence>
                {/* Cover-color background is optional because some modes already have a strong built-in background identity. */}
                {useCoverColorBg && (
                    <motion.div
                        key="fluid-bg"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1 }}
                        className="absolute inset-0 z-0"
                    >
                        <FluidBackground coverUrl={coverUrl} theme={theme} />
                    </motion.div>
                )}
            </AnimatePresence>

            <div
                className="absolute inset-0 z-0 transition-all duration-1000"
                style={{ backgroundColor: theme.backgroundColor, opacity: useCoverColorBg ? backgroundOpacity : 1 }}
            />

            {/* staticMode here means "kill the heavier ambient motion layer",
                not "freeze the entire lyric renderer". */}
            {!staticMode && (
                <div className="absolute inset-0 z-0">
                    <GeometricBackground
                        theme={theme}
                        audioPower={audioPower}
                        audioBands={audioBands}
                        seed={seed}
                        hideShapes={disableGeometricBackground}
                        paused={paused}
                    />
                </div>
            )}

            {children}
        </div>
    );
});

VisualizerShell.displayName = 'VisualizerShell';

export default VisualizerShell;
