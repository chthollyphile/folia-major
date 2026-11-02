import React, { useMemo, useState } from 'react';
import { motion, MotionValue, Variants, useMotionValueEvent } from 'framer-motion';
import { Theme, Word as WordType } from '../../../types';
import { GlowWord } from '../GlowWord';
import { getGlowWordActiveEndTime, type GlowWordRenderProfile } from '../glowWordTiming';
import { resolveLyricTextDirection } from '../../../utils/lyrics/textDirection';
import { PARTITA_WORD_LAYOUT_STYLE, type WordLayoutConfig, buildPartitaWordConfigs, getActiveColor } from './partitaLayout';
import { type PartitaRowSpacing } from './partitaOverlap';
import { OVERLAP_FIT_ROW_ATTRIBUTE } from '../useOverlapFit';

// src/components/visualizer/partita/PartitaChunk.tsx
// 一列中的一个 chunk：组合 GlowWord 与引导线，chunk 自身只订阅粗粒度状态。

// Word component is still basically Classic under the hood.
// The big difference is that here the word lives inside a chunked column layout instead of a free-form line.
// Chunk is the structural wrapper.
// It does not own lyric timing directly; it mostly exists so guide lines and grouped word offsets have a place to live.
export const PartitaChunk: React.FC<{
    chunkWords: WordType[];
    displayWords: WordType[];
    config: WordLayoutConfig;
    guideIndex: number;
    currentTime: MotionValue<number>;
    theme: Theme;
    layoutVariants: Variants;
    bodyVariants: Variants;
    baseColor: string;
    renderProfile: GlowWordRenderProfile;
    isChorus?: boolean;
    showGuideLines: boolean;
    /** With avoidOverlap: the gaps this row's words and the row itself keep (partitaOverlap.ts). */
    overlapSpacing?: PartitaRowSpacing;
    fontSize: string;
}> = ({ chunkWords, displayWords, config, guideIndex, currentTime, theme, layoutVariants, bodyVariants, baseColor, renderProfile, isChorus, showGuideLines, overlapSpacing, fontSize }) => {
    const [chunkStatus, setChunkStatus] = useState<'waiting' | 'active' | 'passed'>('waiting');

    const chunkStartTime = chunkWords[0].startTime;
    const chunkEndTime = getGlowWordActiveEndTime(chunkWords[chunkWords.length - 1], renderProfile);

    useMotionValueEvent(currentTime, 'change', (latest: number) => {
        let newStatus: 'waiting' | 'active' | 'passed' = 'waiting';
        if (latest >= chunkStartTime - renderProfile.wordLookahead && latest <= chunkEndTime) {
            newStatus = 'active';
        } else if (latest > chunkEndTime) {
            newStatus = 'passed';
        }
        if (newStatus !== chunkStatus) setChunkStatus(newStatus);
    });

    const activeColor = getActiveColor(displayWords.map(w => w.text).join(' '), theme);
    const guidePosition = guideIndex % 2 === 0 ? 'left' : 'right';
    const direction = resolveLyricTextDirection(displayWords.map(w => w.text).join(' '));

    // Per-word random offset only (chunk position is on the container).
    const wordConfigs = useMemo(
        () => buildPartitaWordConfigs(displayWords, config, theme.animationIntensity),
        [displayWords, config, theme.animationIntensity],
    );

    return (
        <motion.div
            // An RTL chunk (Uyghur, Arabic...) lays its words out from the right.
            dir={direction}
            {...(overlapSpacing ? { [OVERLAP_FIT_ROW_ATTRIBUTE]: '' } : null)}
            className="inline-flex origin-center relative whitespace-nowrap items-center justify-center flex-row"
            style={{
                // With avoidOverlap the row's margins are in em of the lyric size, so the row takes it on.
                ...(overlapSpacing ? { fontSize, marginTop: overlapSpacing.marginTop } : null),
                marginBottom: overlapSpacing?.marginBottom ?? config.marginBottom,
                alignSelf: config.alignSelf,
                lineHeight: 1,
                minWidth: 'auto',
                minHeight: 'auto',
                padding: '0.2rem 0.5rem',
            }}
            animate={{
                opacity: chunkStatus === 'waiting' ? 0 : 1,
                scale: chunkStatus === 'waiting' ? 0.85 : 1,
                x: chunkStatus === 'waiting'
                    ? config.x + (guidePosition === 'left' ? -40 : 40)
                    : config.x,
                y: config.y,
                rotate: config.rotate,
            }}
            transition={chunkStatus === 'active' ? {
                type: 'spring' as const,
                stiffness: 200,
                damping: 20,
                opacity: { duration: 0.1 },
            } : {
                duration: 0.4,
                ease: 'easeOut' as const,
            }}
        >
            {showGuideLines && guidePosition === 'left' && (
                <>
                    <motion.span
                        className="absolute w-px pointer-events-none"
                        style={{
                            left: '-8px',
                            bottom: '-16px',
                            height: '32px',
                            transformOrigin: 'bottom',
                            backgroundColor: chunkStatus === 'active' ? activeColor : chunkStatus === 'passed' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)',
                            boxShadow: chunkStatus === 'active' ? `0 0 10px ${activeColor}45` : 'none',
                        }}
                        animate={{
                            scaleY: chunkStatus === 'waiting' ? 0 : 1,
                            opacity: chunkStatus === 'waiting' ? 0 : 1,
                        }}
                        transition={{
                            duration: 0.4,
                            ease: 'easeOut' as const,
                        }}
                        aria-hidden="true"
                    />
                    <motion.span
                        className="absolute h-px pointer-events-none"
                        style={{
                            left: '-16px',
                            bottom: '-8px',
                            width: 'calc(100% + 36px)',
                            transformOrigin: 'left',
                            backgroundColor: chunkStatus === 'active' ? activeColor : chunkStatus === 'passed' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)',
                            boxShadow: chunkStatus === 'active' ? `0 0 10px ${activeColor}35` : 'none',
                        }}
                        animate={{
                            scaleX: chunkStatus === 'waiting' ? 0 : 1,
                            opacity: chunkStatus === 'waiting' ? 0 : 1,
                        }}
                        transition={{
                            duration: 0.4,
                            ease: 'easeOut' as const,
                        }}
                        aria-hidden="true"
                    />
                </>
            )}
            {showGuideLines && guidePosition === 'right' && (
                <>
                    <motion.span
                        className="absolute w-px pointer-events-none"
                        style={{
                            right: '-8px',
                            bottom: '-16px',
                            height: '32px',
                            transformOrigin: 'bottom',
                            backgroundColor: chunkStatus === 'active' ? activeColor : chunkStatus === 'passed' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)',
                            boxShadow: chunkStatus === 'active' ? `0 0 10px ${activeColor}45` : 'none',
                        }}
                        animate={{
                            scaleY: chunkStatus === 'waiting' ? 0 : 1,
                            opacity: chunkStatus === 'waiting' ? 0 : 1,
                        }}
                        transition={{
                            duration: 0.4,
                            ease: 'easeOut' as const,
                        }}
                        aria-hidden="true"
                    />
                    <motion.span
                        className="absolute h-px pointer-events-none"
                        style={{
                            right: '-16px',
                            bottom: '-8px',
                            width: 'calc(100% + 36px)',
                            transformOrigin: 'right',
                            backgroundColor: chunkStatus === 'active' ? activeColor : chunkStatus === 'passed' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)',
                            boxShadow: chunkStatus === 'active' ? `0 0 10px ${activeColor}35` : 'none',
                        }}
                        animate={{
                            scaleX: chunkStatus === 'waiting' ? 0 : 1,
                            opacity: chunkStatus === 'waiting' ? 0 : 1,
                        }}
                        transition={{
                            duration: 0.4,
                            ease: 'easeOut' as const,
                        }}
                        aria-hidden="true"
                    />
                </>
            )}

            {displayWords.map((w, idx) => {
                const wordConfig = wordConfigs[idx];

                return (
                    <GlowWord
                        key={`${w.text}-${idx}`}
                        word={w}
                        config={wordConfig}
                        currentTime={currentTime}
                        theme={theme}
                        layoutVariants={layoutVariants}
                        bodyVariants={bodyVariants}
                        baseColor={baseColor}
                        activeColor={getActiveColor(w.text, theme)}
                        renderProfile={renderProfile}
                        isChorus={isChorus}
                        fontSize={fontSize}
                        layoutStyle={overlapSpacing?.words[idx] ?? PARTITA_WORD_LAYOUT_STYLE}
                    />
                );
            })}
        </motion.div>
    );
};
