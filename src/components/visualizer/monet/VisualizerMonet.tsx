import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, useMotionValueEvent } from 'framer-motion';
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
        songTitle,
        songArtist,
        songAlbum,
        coverUrl,
        staticMode = false,
        isPreviewMode = false,
        monetTuning = DEFAULT_MONET_TUNING,
        monetPortraitImage = null,
    } = props;
    const { t } = useTranslation();

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

    useEffect(() => {
        setIntroKey(prev => prev + 1);
    }, [songTitle, songArtist, coverUrl]);

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
            <motion.div
                key={`decor-${introKey}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 2.2, ease: 'easeOut' }}
            >
                <MonetFloatingDecor theme={theme} staticMode={staticMode} />
            </motion.div>

            <div className="relative z-10 flex h-full w-full items-center justify-center overflow-hidden">
                <div className="flex h-full w-full max-w-[1520px] flex-row items-center overflow-hidden">
                    {showText && (
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center px-5 py-5 sm:px-8 sm:py-6 lg:px-14 lg:py-8">
                            <motion.div
                                animate={theme.animationIntensity === 'chaotic' ? {
                                    y: [0, -3, 0, 3, 0],
                                    x: [0, -1.5, 0, 1.5, 0]
                                } : {}}
                                transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 0.1 }}
                            >
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
                            </motion.div>

                            <motion.div
                                key={`title-${introKey}`}
                                initial={{ opacity: 0, x: -40 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 1.3, ease: [0.25, 1, 0.5, 1], delay: 0.3 }}
                            >
                                <motion.div
                                    animate={theme.animationIntensity === 'chaotic' ? {
                                        y: [0, 4, 0, -4, 0],
                                        x: [0, 2, 0, -2, 0]
                                    } : {}}
                                    transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
                                    className="mb-6 space-y-1"
                                >
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
                                </motion.div>
                            </motion.div>

                            <motion.div
                                key={`rail-${introKey}`}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 1.2, ease: [0.25, 1, 0.5, 1], delay: 0.65 }}
                            >
                                <MonetLyricsRail
                                    entries={visibleLineEntries}
                                    currentTime={currentTime}
                                    theme={theme}
                                    lyricFontPx={lyricFontPx}
                                    inactiveFontPx={inactiveFontPx}
                                    translationFontPx={translationFontPx}
                                    fontStack={lyricFontStack}
                                    keywordColoringEnabled={monetTuning.keywordColoringEnabled}
                                    emptyText={t('ui.waitingForMusic') || 'Waiting for music'}
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
                                    <motion.div
                                        animate={theme.animationIntensity === 'chaotic' ? {
                                            y: [0, -3, 0, 3, 0],
                                            x: [0, 1.5, 0, -1.5, 0]
                                        } : {}}
                                        transition={{ duration: 6.5, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }}
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
                            className="hidden min-w-0 items-center justify-center overflow-visible px-3 pr-5 sm:pr-8 md:flex lg:justify-end lg:pr-10 xl:pr-12"
                            style={{ flex: '0 0 clamp(220px, 28vw, 430px)' }}
                        >
                            <motion.div
                                animate={theme.animationIntensity === 'chaotic' ? {
                                    y: [0, -6, 0, 6, 0],
                                    x: [0, -3, 0, 3, 0],
                                    rotate: [0, 0.4, 0, -0.4, 0]
                                } : {}}
                                transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
                                className="relative w-full max-w-[clamp(210px,26vw,380px)]"
                            >
                                <div
                                    className="absolute -top-3 right-8 z-20 h-14 w-3 rounded-full shadow-md"
                                    style={{
                                        backgroundColor: colorWithAlpha(theme.backgroundColor, 0.86),
                                        boxShadow: `0 8px 18px ${colorWithAlpha('#000000', 0.24)}`,
                                    }}
                                />
                                <div
                                    className="relative rounded-[2.5rem] border p-1.5 backdrop-blur-sm"
                                    style={{
                                        borderColor: colorWithAlpha(theme.primaryColor, 0.12),
                                        backgroundColor: colorWithAlpha(theme.backgroundColor, 0.08),
                                        boxShadow: `0 30px 70px ${colorWithAlpha(theme.backgroundColor, 0.34)}, 0 16px 36px ${colorWithAlpha(theme.accentColor, 0.14)}, 0 0 0 1px ${colorWithAlpha(theme.primaryColor, 0.04)}`,
                                    }}
                                >
                                    <div
                                        className="aspect-[0.74] w-full overflow-hidden rounded-[2rem] bg-cover bg-center"
                                        style={{
                                            backgroundImage: portraitUrl ? `url(${portraitUrl})` : undefined,
                                            backgroundColor: colorWithAlpha(theme.primaryColor, 0.08),
                                        }}
                                    />
                                </div>
                            </motion.div>
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
                    <motion.div
                        className="h-full w-full"
                        animate={theme.animationIntensity === 'chaotic' ? {
                            y: [0, 2, 0, -2, 0],
                            x: [0, -1, 0, 1, 0]
                        } : {}}
                        transition={{ duration: 7.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
                    >
                        <AudioOverlay
                            audioPower={audioPower}
                            audioBands={audioBands}
                            theme={theme}
                            mode={monetTuning.audioStyle}
                            staticMode={staticMode}
                            isPreviewMode={isPreviewMode}
                        />
                    </motion.div>
                </motion.div>
            )}
        </VisualizerShell>
    );
};

export default VisualizerMonet;
