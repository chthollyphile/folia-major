import React, { forwardRef, useState } from 'react';
import { AnimatePresence, motion, MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import { AudioBands, Theme, type UrlBackgroundItem } from '../../types';
import { resolveThemeFontStack } from '../../utils/fontStacks';
import { type VisualizerSharedProps } from './definition';
import FluidBackground from './FluidBackground';
import GeometricBackground from './GeometricBackground';
import MonetBackgroundLayer from './backgrounds/MonetBackgroundLayer';
import UrlBackgroundLayer from './backgrounds/UrlBackgroundLayer';
import SoraBackground from './SoraBackground';

// Shared outer shell for all visualizers.
// This is where we keep background layering, font injection, and the hover-only back button
// so each renderer can stay focused on lyric timing/layout instead of rebuilding the same frame.
type VisualizerShellSharedProps = Pick<
    VisualizerSharedProps,
    | 'coverUrl'
    | 'isDaylight'
    | 'useCoverColorBg'
    | 'seed'
    | 'backgroundOpacity'
    | 'visualizerOpacity'
    | 'transparentBackground'
    | 'disableGeometricBackground'
    | 'disableVignette'
    | 'resolvedVisualizerBackgroundMode'
    | 'monetBackgroundTuning'
    | 'monetBackgroundImage'
    | 'urlBackgroundList'
    | 'urlBackgroundSelectedId'
    | 'staticMode'
    | 'paused'
    | 'onBack'
>;

interface VisualizerShellProps {
    theme: Theme;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    sharedProps?: VisualizerShellSharedProps;
    coverUrl?: string | null;
    useCoverColorBg?: boolean;
    seed?: string | number;
    backgroundOpacity?: number;
    visualizerOpacity?: number;
    transparentBackground?: boolean;
    disableVignette?: boolean;
    staticMode?: boolean;
    disableGeometricBackground?: boolean;
    paused?: boolean;
    onBack?: () => void;
    urlBackgroundList?: UrlBackgroundItem[];
    urlBackgroundSelectedId?: string | null;
    children: React.ReactNode;
    className?: string;
}

const VisualizerShell = forwardRef<HTMLDivElement, VisualizerShellProps>(({
    theme,
    audioPower,
    audioBands,
    sharedProps,
    coverUrl,
    useCoverColorBg = false,
    seed,
    backgroundOpacity = 0.75,
    visualizerOpacity = 1,
    transparentBackground = false,
    disableVignette = false,
    staticMode = false,
    disableGeometricBackground = false,
    paused = false,
    onBack,
    urlBackgroundList,
    urlBackgroundSelectedId,
    children,
    className = '',
}, ref) => {
    const { t } = useTranslation();
    const [showBackButton, setShowBackButton] = useState(false);
    const resolvedCoverUrl = sharedProps?.coverUrl ?? coverUrl;
    const resolvedIsDaylight = sharedProps?.isDaylight ?? false;
    const resolvedUseCoverColorBg = sharedProps?.useCoverColorBg ?? useCoverColorBg;
    const resolvedSeed = sharedProps?.seed ?? seed;
    const resolvedBackgroundOpacity = sharedProps?.backgroundOpacity ?? backgroundOpacity;
    const resolvedVisualizerOpacity = sharedProps?.visualizerOpacity ?? visualizerOpacity;
    const resolvedTransparentBackground = sharedProps?.transparentBackground ?? transparentBackground;
    const resolvedDisableGeometricBackground = sharedProps?.disableGeometricBackground ?? disableGeometricBackground;
    const resolvedDisableVignette = sharedProps?.disableVignette ?? disableVignette;
    const resolvedBackgroundMode = sharedProps?.resolvedVisualizerBackgroundMode ?? 'common';
    const resolvedMonetBackgroundTuning = sharedProps?.monetBackgroundTuning;
    const resolvedMonetBackgroundImage = sharedProps?.monetBackgroundImage;
    const resolvedUrlBackgroundList = sharedProps?.urlBackgroundList ?? urlBackgroundList;
    const resolvedUrlBackgroundSelectedId = sharedProps?.urlBackgroundSelectedId ?? urlBackgroundSelectedId;
    const resolvedStaticMode = sharedProps?.staticMode ?? staticMode;
    const resolvedPaused = sharedProps?.paused ?? paused;
    const resolvedOnBack = sharedProps?.onBack ?? onBack;
    const shouldRenderCommonBackground = !resolvedTransparentBackground && resolvedBackgroundMode === 'common';
    const shouldRenderMonetBackground = !resolvedTransparentBackground && resolvedBackgroundMode === 'monet';
    const shouldRenderUrlBackground = !resolvedTransparentBackground && resolvedBackgroundMode === 'url';
    const shouldRenderSoraBackground = !resolvedTransparentBackground && resolvedBackgroundMode === 'sora';

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
                opacity: resolvedVisualizerOpacity,
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
            {resolvedOnBack && (
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
                        resolvedOnBack();
                    }}
                    className="absolute top-6 left-6 z-30 h-10 w-10 rounded-full flex items-center justify-center transition-colors backdrop-blur-md bg-black/20 hover:bg-white/10 text-white/60 pointer-events-auto"
                    style={{ pointerEvents: showBackButton ? 'auto' : 'none' }}
                >
                    <ChevronLeft size={20} />
                </motion.button>
            )}

            <AnimatePresence>
                {/* Cover-color background is optional because some modes already have a strong built-in background identity. */}
                {shouldRenderCommonBackground && resolvedUseCoverColorBg && (
                    <motion.div
                        key="fluid-bg"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1 }}
                        className="absolute inset-0 z-0"
                    >
                        <FluidBackground coverUrl={resolvedCoverUrl} theme={theme} />
                    </motion.div>
                )}
            </AnimatePresence>

            {shouldRenderCommonBackground && (
                <div
                    className="absolute inset-0 z-0 transition-all duration-1000"
                    style={{ backgroundColor: theme.backgroundColor, opacity: resolvedUseCoverColorBg ? resolvedBackgroundOpacity : 1 }}
                />
            )}

            {shouldRenderMonetBackground && (
                <MonetBackgroundLayer
                    coverUrl={resolvedCoverUrl}
                    monetBackgroundImage={resolvedMonetBackgroundImage}
                    theme={theme}
                    isDaylight={resolvedIsDaylight}
                    tuning={resolvedMonetBackgroundTuning}
                    transparentBackground={resolvedTransparentBackground}
                />
            )}

            {shouldRenderUrlBackground && (
                <UrlBackgroundLayer
                    urlBackgroundList={resolvedUrlBackgroundList}
                    urlBackgroundSelectedId={resolvedUrlBackgroundSelectedId}
                />
            )}

            {shouldRenderSoraBackground && (
                <div className="absolute inset-0 z-0">
                    <SoraBackground
                        theme={theme}
                        isDaylight={resolvedIsDaylight}
                        paused={resolvedPaused}
                    />
                </div>
            )}

            {/* staticMode here means "kill the heavier ambient motion layer",
                not "freeze the entire lyric renderer". Transparent background only removes
                the solid/fluid backing, so the geometric layer can still render. */}
            {shouldRenderCommonBackground && !resolvedStaticMode && (
                <div className="absolute inset-0 z-0">
                    <GeometricBackground
                        theme={theme}
                        audioPower={audioPower}
                        audioBands={audioBands}
                        seed={resolvedSeed}
                        hideShapes={resolvedDisableGeometricBackground}
                        disableVignette={resolvedDisableVignette}
                        paused={resolvedPaused}
                    />
                </div>
            )}

            {children}
        </div>
    );
});

VisualizerShell.displayName = 'VisualizerShell';

export default VisualizerShell;
