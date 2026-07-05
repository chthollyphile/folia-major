import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, useMotionValueEvent, useDragControls, useMotionValue } from 'framer-motion';
import { RotateCcw } from 'lucide-react';
import { DEFAULT_MONET_TUNING } from '../../../types';
import { colorWithAlpha } from '../colorMix';
import { type VisualizerSharedProps } from '../definition';
import { useVisualizerRuntime } from '../runtime';
import VisualizerShell from '../VisualizerShell';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { resolveThemeFontStack } from '../../../utils/fontStacks';
import AudioOverlay from './AudioOverlay';
import MonetFloatingDecor from './MonetFloatingDecor';
import MonetLyricsRail from './MonetLyricsRail';
import { buildMonetVisibleLineEntries, resolveClampFontPx } from './monetLyricsModel';

// src/components/visualizer/monet/VisualizerMonet.tsx
// Monet keeps the poster layout here while its lyric rail owns measured scrolling and line states.

export { buildMonetDisplayTokens, resolveMonetLyricContext } from './monetLyricsModel';

type VisualizerMonetProps = VisualizerSharedProps;

const VisualizerMonet: React.FC<VisualizerMonetProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        audioPower,
        audioBands,
        showText = true,
        showSubtitleTranslation = true,
        songTitle,
        songArtist,
        songAlbum,
        coverUrl,
        staticMode = false,
        isPreviewMode = false,
        monetTuning = DEFAULT_MONET_TUNING,
        monetPortraitImage = null,
        onMonetTuningChange,
        onLyricLineSeek,
        seed,
    } = props;
    const { t } = useTranslation();

    const handleSetMonetTuning = onMonetTuningChange;

    // Edit/moving mode states for the right-side cover component position
    const [isEditingPosition, setIsEditingPosition] = useState(false);
    const [isHangerHovered, setIsHangerHovered] = useState(false);
    const initialOffsetX = monetTuning.portraitOffsetX ?? 0;
    const offsetX = useMotionValue(initialOffsetX);

    useEffect(() => {
        offsetX.set(initialOffsetX);
    }, [initialOffsetX, offsetX]);

    const dragControls = useDragControls();
    const isDraggingRef = useRef(false);

    const [introKey, setIntroKey] = useState(0);
    const lastTimeRef = useRef(0);

    useMotionValueEvent(currentTime, 'change', (latest) => {
        const wasAtEnd = lastTimeRef.current > 2.0;
        const isAtStart = latest < 0.1;
        if (isAtStart && wasAtEnd) {
            setIntroKey(prev => prev + 1);
        }
        lastTimeRef.current = latest;
    });

    const songIdentifier = seed ?? songTitle ?? '';

    useEffect(() => {
        setIntroKey(prev => prev + 1);
    }, [songIdentifier]);

    const {
        activeLine,
        recentCompletedLine,
        upcomingLine,
        currentTimeValue,
    } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    const visibleLineEntries = useMemo(() => buildMonetVisibleLineEntries({
        lines,
        currentLineIndex,
        activeLine,
        recentCompletedLine,
        upcomingLine,
        currentTime: currentTimeValue,
        before: 2,
        after: 2,
    }), [
        activeLine,
        currentLineIndex,
        currentTimeValue,
        lines,
        recentCompletedLine,
        upcomingLine,
    ]);

    const lyricFontStack = useMemo(() => resolveThemeFontStack(theme), [theme]);
    const fontScale = monetTuning.fontScale;
    const lyricFontPx = resolveClampFontPx(
        1.34,
        2.75,
        2.28,
    ) * fontScale;
    const inactiveFontPx = resolveClampFontPx(1.08, 2, 1.48) * fontScale;
    const translationFontPx = resolveClampFontPx(0.94, 1.28, 1.14) * fontScale;

    const primaryMetaLabel = songArtist?.trim() || 'Monet';
    const secondaryMetaLabel = songAlbum?.trim() || 'Monet';
    const capsuleLabel = theme.description?.trim() || theme.name?.trim() || 'Monet';
    const portraitUrl = monetTuning.portraitSource === 'custom'
        ? monetPortraitImage?.url ?? coverUrl
        : coverUrl ?? monetPortraitImage?.url;

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={props}
        >
            {showText && (
                <motion.div
                    key={`decor-${introKey}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 2.2, ease: 'easeOut' }}
                >
                    <MonetFloatingDecor theme={theme} staticMode={staticMode} />
                </motion.div>
            )}

            <div className="relative z-10 flex h-full w-full items-center justify-center overflow-hidden">
                <div className="flex h-full w-full max-w-[1520px] flex-row items-center overflow-hidden">
                    {showText && (
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center px-5 py-5 sm:px-8 sm:py-6 lg:px-14 lg:py-8">
                            <div className="mb-3 space-y-1.5">
                                <motion.div
                                    key={`artist-${introKey}`}
                                    initial={{ opacity: 0, x: -30, y: -10 }}
                                    animate={{ opacity: 1, x: 0, y: 0 }}
                                    transition={{ duration: 1.2, ease: [0.25, 1, 0.5, 1], delay: 0.15 }}
                                    className="text-[clamp(1rem,1.8vw,1.8rem)] italic"
                                    style={{ color: colorWithAlpha(theme.primaryColor, 0.96), letterSpacing: 0 }}
                                >
                                    {primaryMetaLabel}
                                </motion.div>
                                <motion.div
                                    key={`line-${introKey}`}
                                    initial={{ scaleY: 0 }}
                                    animate={{ scaleY: 1 }}
                                    transition={{ duration: 1.5, ease: [0.25, 1, 0.5, 1], delay: 0.5 }}
                                    className="h-14 w-px rounded-full"
                                    style={{ 
                                        originY: 0,
                                        background: `linear-gradient(180deg, ${colorWithAlpha(theme.primaryColor, 0.72)}, transparent)` 
                                    }}
                                />
                            </div>

                            <motion.div
                                key={`title-${introKey}`}
                                initial={{ opacity: 0, x: -40 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 1.3, ease: [0.25, 1, 0.5, 1], delay: 0.3 }}
                            >
                                <div className="mb-6 space-y-1">
                                    <div
                                        className="font-semibold leading-[1.06]"
                                        style={{
                                            color: theme.primaryColor,
                                            fontSize: 'clamp(1.45rem, 3.3vw, 2.8rem)',
                                            letterSpacing: 0,
                                            textShadow: `0 14px 36px ${colorWithAlpha(theme.backgroundColor, 0.28)}`,
                                        }}
                                    >
                                        {songTitle || 'Monet'}
                                    </div>
                                    <div
                                        className="text-sm uppercase"
                                        style={{ color: colorWithAlpha(theme.secondaryColor, 0.84), letterSpacing: 0 }}
                                    >
                                        {secondaryMetaLabel}
                                    </div>
                                </div>
                            </motion.div>

                            <motion.div
                                key={`rail-${introKey}`}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 1.2, ease: [0.25, 1, 0.5, 1], delay: 0.65 }}
                            >
                                <MonetLyricsRail
                                    entries={visibleLineEntries}
                                    lines={lines}
                                    currentLineIndex={currentLineIndex}
                                    currentTime={currentTime}
                                    theme={theme}
                                    lyricFontPx={lyricFontPx}
                                    inactiveFontPx={inactiveFontPx}
                                    translationFontPx={translationFontPx}
                                    fontStack={lyricFontStack}
                                    keywordColoringEnabled={monetTuning.keywordColoringEnabled}
                                    emptyText=""
                                    showSubtitleTranslation={showSubtitleTranslation}
                                    audioPower={audioPower}
                                    audioBands={audioBands}
                                    onLyricLineSeek={onLyricLineSeek}
                                    seekDisabled={isPreviewMode}
                                />
                            </motion.div>

                            {monetTuning.showDescription && (
                                <motion.div
                                    key={`desc-${introKey}`}
                                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    transition={{ duration: 1.0, ease: [0.25, 1, 0.5, 1], delay: 0.95 }}
                                    className="mt-auto pt-4"
                                >
                                        <div
                                            className="inline-flex items-center gap-3 rounded-full border px-4 py-2 backdrop-blur-md"
                                            style={{
                                                borderColor: colorWithAlpha(theme.primaryColor, 0.16),
                                                backgroundColor: colorWithAlpha(theme.backgroundColor, 0.18),
                                                color: colorWithAlpha(theme.primaryColor, 0.9),
                                            }}
                                        >
                                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: theme.accentColor }} />
                                            <span className="text-xs uppercase" style={{ letterSpacing: 0 }}>{capsuleLabel}</span>
                                        </div>
                                </motion.div>
                            )}
                        </div>
                    )}

                    {showText ? (
                        <motion.div
                            key={`portrait-${introKey}`}
                            initial={{ opacity: 0, x: 50, scale: 0.95, rotate: 1 }}
                            animate={{ opacity: 1, x: 0, scale: 1, rotate: 0 }}
                            transition={{ duration: 1.6, ease: [0.25, 1, 0.5, 1], delay: 0.25 }}
                            className="hidden min-w-0 items-center justify-center overflow-visible px-3 pr-5 sm:pr-8 md:flex lg:justify-end lg:pr-10 xl:pr-12 select-none"
                            style={{ flex: '0 0 clamp(220px, 28vw, 430px)' }}
                        >
                            {/* Bounding box wrapper that stays in the default position */}
                            <div className="relative w-full max-w-[clamp(210px,26vw,380px)]">
                                
                                {/* Dashed movable region border */}
                                {isEditingPosition && (
                                    <div
                                        className="absolute border-2 border-dashed rounded-[2.5rem] pointer-events-none"
                                        style={{
                                            borderColor: colorWithAlpha(theme.primaryColor, 0.24),
                                            left: monetTuning.portraitStyle === 'square' ? 'calc(-35.135% - 150px)' : -150,
                                            right: 0,
                                            top: -12,
                                            bottom: -12,
                                            zIndex: 5,
                                        }}
                                    >
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                offsetX.set(0);
                                            }}
                                            className="absolute -top-10 right-0 pointer-events-auto rounded-full p-2 text-xs backdrop-blur-md transition-all active:scale-95 flex items-center justify-center font-medium"
                                            style={{
                                                backgroundColor: colorWithAlpha(theme.backgroundColor, 0.86),
                                                color: theme.primaryColor,
                                                border: `1px solid ${colorWithAlpha(theme.primaryColor, 0.16)}`,
                                                boxShadow: `0 4px 12px ${colorWithAlpha('#000000', 0.12)}`,
                                            }}
                                            title={t('common.reset') || '重置'}
                                        >
                                            <RotateCcw size={14} />
                                        </button>
                                    </div>
                                )}

                                {/* Draggable motion wrapper */}
                                <motion.div
                                    drag={isEditingPosition ? 'x' : false}
                                    dragControls={dragControls}
                                    dragListener={false}
                                    dragConstraints={{ left: -150, right: 0 }}
                                    dragElastic={0}
                                    dragMomentum={false}
                                    style={{ x: offsetX, touchAction: isEditingPosition ? 'none' : 'auto' }}
                                    onDragStart={() => {
                                        isDraggingRef.current = true;
                                    }}
                                    onDragEnd={() => {
                                        // Delay resetting drag reference to avoid triggering click save
                                        setTimeout(() => {
                                            isDraggingRef.current = false;
                                        }, 50);
                                    }}
                                    className="w-full relative"
                                >
                                    <motion.div
                                        animate={
                                            theme.animationIntensity === 'chaotic'
                                                ? {
                                                      y: [0, -18, 0, 18, 0],
                                                      x: [0, -9, 0, 9, 0],
                                                      rotate: [0, 1.2, 0, -1.2, 0],
                                                  }
                                                : {
                                                      y: 0,
                                                      x: 0,
                                                      rotate: 0,
                                                  }
                                        }
                                        transition={
                                            theme.animationIntensity === 'chaotic'
                                                ? { duration: 9, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }
                                                : { duration: 0.8, ease: 'easeOut' }
                                        }
                                        className="relative"
                                        style={{
                                            width: monetTuning.portraitStyle === 'square' ? '135.135%' : '100%',
                                            marginLeft: monetTuning.portraitStyle === 'square' ? '-35.135%' : '0%',
                                            willChange: 'transform',
                                            transform: 'translateZ(0)',
                                        }}
                                    >
                                        {/* Hanger / Black-White Bar */}
                                        {monetTuning.showPortraitDragHanger && (
                                            <motion.div
                                                onPointerDown={(e) => {
                                                    if (isEditingPosition) {
                                                        e.preventDefault();
                                                        dragControls.start(e);
                                                    }
                                                }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (isDraggingRef.current) return;
                                                    
                                                    if (!isEditingPosition) {
                                                        setIsEditingPosition(true);
                                                    } else {
                                                        const finalOffset = Math.round(offsetX.get());
                                                        handleSetMonetTuning?.({
                                                            ...monetTuning,
                                                            portraitOffsetX: finalOffset,
                                                        });
                                                        setIsEditingPosition(false);
                                                    }
                                                }}
                                                onMouseEnter={() => setIsHangerHovered(true)}
                                                onMouseLeave={() => setIsHangerHovered(false)}
                                                className="absolute -top-3 right-8 z-20 h-14 w-3 rounded-full shadow-md cursor-pointer transition-transform duration-200 hover:scale-y-105 active:scale-y-95"
                                                animate={isEditingPosition ? {
                                                    borderColor: [
                                                        colorWithAlpha(theme.accentColor, 0.3),
                                                        colorWithAlpha(theme.accentColor, 1.0),
                                                        colorWithAlpha(theme.accentColor, 0.3)
                                                    ],
                                                    boxShadow: [
                                                        `0 0 2px ${colorWithAlpha(theme.accentColor, 0.2)}, 0 8px 18px ${colorWithAlpha('#000000', 0.24)}`,
                                                        `0 0 10px ${colorWithAlpha(theme.accentColor, 0.65)}, 0 8px 18px ${colorWithAlpha('#000000', 0.24)}`,
                                                        `0 0 2px ${colorWithAlpha(theme.accentColor, 0.2)}, 0 8px 18px ${colorWithAlpha('#000000', 0.24)}`
                                                    ]
                                                } : {
                                                    borderColor: isHangerHovered
                                                        ? colorWithAlpha(theme.primaryColor, 0.36)
                                                        : colorWithAlpha(theme.primaryColor, 0),
                                                    boxShadow: `0 8px 18px ${colorWithAlpha('#000000', 0.24)}`
                                                }}
                                                transition={isEditingPosition ? {
                                                    duration: 1.5,
                                                    repeat: Infinity,
                                                    ease: "easeInOut"
                                                } : { duration: 0.2 }}
                                                style={{
                                                    backgroundColor: colorWithAlpha(theme.backgroundColor, 0.86),
                                                    borderWidth: '1.5px',
                                                    borderStyle: 'solid',
                                                    touchAction: isEditingPosition ? 'none' : 'auto',
                                                }}
                                            />
                                        )}

                                        {/* Square cover with enhanced shadow, no transparent border */}
                                        {monetTuning.portraitStyle === 'square' ? (
                                            <div
                                                className="relative w-full aspect-square overflow-hidden rounded-[2rem] bg-center"
                                                style={{
                                                    boxShadow: `0 36px 80px ${colorWithAlpha(theme.backgroundColor, 0.45)}, 0 20px 42px ${colorWithAlpha(theme.accentColor, 0.22)}, 0 0 0 1px ${colorWithAlpha(theme.primaryColor, 0.06)}`,
                                                    backgroundColor: colorWithAlpha(theme.primaryColor, 0.08),
                                                }}
                                            >
                                                <img
                                                    src={portraitUrl || ''}
                                                    decoding="async"
                                                    alt=""
                                                    className="w-full h-full object-cover"
                                                    style={{ opacity: portraitUrl ? 1 : 0, transition: 'opacity 1s ease' }}
                                                    draggable={false}
                                                />
                                            </div>
                                        ) : (
                                            <div
                                                className="relative w-full aspect-[0.74] p-1.5 rounded-[2.15rem] border backdrop-blur-sm"
                                                style={{
                                                    borderColor: colorWithAlpha(theme.primaryColor, 0.1),
                                                    backgroundColor: colorWithAlpha(theme.backgroundColor, 0.15),
                                                    boxShadow: `0 24px 60px ${colorWithAlpha(theme.backgroundColor, 0.35)}`,
                                                }}
                                            >
                                                <div
                                                    className="w-full h-full overflow-hidden rounded-[1.85rem] bg-center"
                                                    style={{
                                                        backgroundColor: colorWithAlpha(theme.primaryColor, 0.08),
                                                    }}
                                                >
                                                    <img
                                                        src={portraitUrl || ''}
                                                        decoding="async"
                                                        alt=""
                                                        className="w-full h-full object-cover"
                                                        style={{ opacity: portraitUrl ? 1 : 0, transition: 'opacity 1s ease' }}
                                                        draggable={false}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </motion.div>
                                </motion.div>
                            </div>
                        </motion.div>
                    ) : null}
                </div>
            </div>

            {showText && (
                <motion.div
                    key={`audio-${introKey}`}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 1.2, ease: [0.25, 1, 0.5, 1], delay: 0.8 }}
                    className="absolute bottom-0 left-0 z-20 h-10 overflow-hidden px-5 sm:px-8 lg:px-14"
                    style={{ width: 'min(450px, 55vw)' }}
                >
                    <div className="h-full w-full">
                        <AudioOverlay
                            audioPower={audioPower}
                            audioBands={audioBands}
                            theme={theme}
                            mode={monetTuning.audioStyle}
                            staticMode={staticMode}
                            isPreviewMode={isPreviewMode}
                        />
                    </div>
                </motion.div>
            )}
        </VisualizerShell>
    );
};

export default VisualizerMonet;
