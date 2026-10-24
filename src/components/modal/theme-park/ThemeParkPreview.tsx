import React, { useState } from 'react';
import { motion, useMotionValue, useMotionValueEvent, useTransform } from 'framer-motion';
import { Pause, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import VisualizerRenderer from '../../visualizer/VisualizerRenderer';
import {
    AudioBands,
    CappellaAvatarImage,
    CappellaEmojiImage,
    MonetPortraitImage,
    SubtitleContentMode,
    Theme,
    VisualizerMode,
} from '../../../types';
import {
    VIS_PLAYGROUND_PREVIEW_COVER_URL,
    VIS_PLAYGROUND_PREVIEW_LINES,
    VIS_PLAYGROUND_PREVIEW_LOOP_DURATION,
} from '../../visualizer/PreviewPlaceholder';
import { getVisualizerScopedSeed } from '../../visualizer/registry';
import type { VisualizerTuningBundle } from '../../visualizer/tuningRegistry';
import type { VisualizerBackgroundConfig } from '../../visualizer/backgrounds/definition';
import VisPlaygroundSampleStage, { SampleBox } from '../../visualizer/window/VisPlaygroundSampleStage';
import { Tooltip } from '../settings/kit';
import { SAMPLE_COLOR_MOTION_CLASS, ThemeSampleButton, ThemeSampleCard, themeSampleVars } from './ThemeSample';
import type { EditableMode } from './themeParkDraft';

// src/components/modal/theme-park/ThemeParkPreview.tsx
// The sample of the Theme Park editor: the draft theme through the same VisualizerRenderer the
// player uses, and over it what the four colours do beside the lyrics: the theme's name and
// description, a now-playing card, a progress line and a button. It fills the place it is put in
// and always shows the side being edited, whatever the window around it looks like. The pause
// control stops the lyric sample.

type PreviewClock = ReturnType<typeof useMotionValue<number>>;

/** The progress line and the time beside it, read from the sample's own clock. */
const ThemeSampleProgress: React.FC<{ currentTime: PreviewClock }> = ({ currentTime }) => {
    const progress = useTransform(currentTime, time => time / VIS_PLAYGROUND_PREVIEW_LOOP_DURATION);
    const [seconds, setSeconds] = useState(() => Math.floor(currentTime.get()));
    useMotionValueEvent(currentTime, 'change', (latest) => {
        const next = Math.floor(latest);
        setSeconds(previous => (previous === next ? previous : next));
    });

    return (
        <>
            <div className={`${SAMPLE_COLOR_MOTION_CLASS} h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ts-muted)_40%,transparent)]`}>
                <motion.div className={`${SAMPLE_COLOR_MOTION_CLASS} h-full origin-left bg-[var(--ts-accent)]`} style={{ scaleX: progress }} />
            </div>
            <span className={`${SAMPLE_COLOR_MOTION_CLASS} shrink-0 font-mono text-xs tabular-nums text-[color:var(--ts-muted)]`}>
                0:{String(seconds).padStart(2, '0')}
            </span>
        </>
    );
};

/**
 * How far above the sample's bottom the lyric subtitle sits, in the sample's pixels: a little over the
 * song card below (`bottom-[18px]`, about 52 pixels tall, so its top is about 70 pixels up), which is
 * not scaled with the style.
 */
const SUBTITLE_BOTTOM_PX = 90;

const ThemePreview: React.FC<{
    /** The side being edited, safe to draw. */
    theme: Theme;
    mode: EditableMode;
    /** The name and the description as they are typed. */
    name: string;
    description: string;
    visualizerMode: VisualizerMode;
    visualizerTunings?: VisualizerTuningBundle;
    staticMode: boolean;
    visualizerOpacity: number;
    backgroundConfig?: VisualizerBackgroundConfig;
    cappellaCustomEmojiImages: CappellaEmojiImage[];
    cappellaCustomAvatarImages: CappellaAvatarImage[];
    monetPortraitImage?: MonetPortraitImage | null;
    showSubtitleTranslation: boolean;
    subtitleContentMode?: SubtitleContentMode;
    lyricsFontScale: number;
    currentTime: PreviewClock;
    currentLineIndex: number;
    audioPower: PreviewClock;
    audioBands: AudioBands;
    isPaused: boolean;
    onTogglePause: () => void;
}> = ({
    theme,
    mode,
    name,
    description,
    visualizerMode,
    visualizerTunings,
    staticMode,
    visualizerOpacity,
    backgroundConfig,
    cappellaCustomEmojiImages,
    cappellaCustomAvatarImages,
    monetPortraitImage,
    showSubtitleTranslation,
    subtitleContentMode,
    lyricsFontScale,
    currentTime,
    currentLineIndex,
    audioPower,
    audioBands,
    isPaused,
    onTogglePause,
}) => {
        const { t } = useTranslation();
        const pauseLabel = isPaused ? t('ui.playPreview') : t('ui.pausePreview');

        return (
            <SampleBox
                room="h-full"
                className="relative isolate overflow-hidden rounded-xl bg-[var(--ts-bg)] shadow-[0_0_0_1px_var(--st-line)]"
                style={themeSampleVars(theme)}
            >
                {/* Styles lay out from the app's window (vw, window.innerWidth), so the style is drawn
                    as large as the window and scaled to fit, as in the lyric style window. The song
                    card below is not scaled, so the subtitle keeps a set height above it
                    (SUBTITLE_BOTTOM_PX). */}
                <VisPlaygroundSampleStage subtitleBottomPx={SUBTITLE_BOTTOM_PX}>
                    <div className="absolute inset-0">
                        <VisualizerRenderer
                            mode={visualizerMode}
                            visualizerTunings={visualizerTunings}
                            currentTime={currentTime}
                            duration={VIS_PLAYGROUND_PREVIEW_LOOP_DURATION}
                            currentLineIndex={currentLineIndex}
                            lines={VIS_PLAYGROUND_PREVIEW_LINES}
                            theme={theme}
                            isDaylight={mode === 'light'}
                            audioPower={audioPower}
                            audioBands={audioBands}
                            songTitle="Cappella Preview"
                            showText
                            staticMode={staticMode}
                            isPreviewMode
                            visualizerOpacity={visualizerOpacity}
                            background={backgroundConfig}
                            coverUrl={VIS_PLAYGROUND_PREVIEW_COVER_URL}
                            lyricsFontScale={lyricsFontScale}
                            showSubtitleTranslation={showSubtitleTranslation}
                            subtitleContentMode={subtitleContentMode}
                            cappellaCustomEmojiImages={cappellaCustomEmojiImages}
                            cappellaCustomAvatarImages={cappellaCustomAvatarImages}
                            monetPortraitImage={monetPortraitImage}
                            seed={getVisualizerScopedSeed(visualizerMode, `theme-park-${mode}`)}
                        />
                    </div>
                </VisPlaygroundSampleStage>

                {/* A picture of the theme at work: nothing in it takes the pointer or the keyboard. */}
                <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
                    <div className="absolute left-5 right-16 top-4">
                        <div className={`${SAMPLE_COLOR_MOTION_CLASS} min-h-5 truncate text-sm font-semibold leading-5 text-[color:var(--ts-fg)]`}>{name}</div>
                        <div className={`${SAMPLE_COLOR_MOTION_CLASS} truncate text-xs leading-[18px] text-[color:var(--ts-muted)]`}>{description}</div>
                    </div>
                    <div className="absolute inset-x-5 bottom-[18px] flex items-center gap-4">
                        <ThemeSampleCard />
                        <ThemeSampleProgress currentTime={currentTime} />
                        <ThemeSampleButton />
                    </div>
                </div>

                <Tooltip text={pauseLabel} className="absolute right-3 top-3 z-30 inline-flex">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onTogglePause();
                        }}
                        aria-label={pauseLabel}
                        className="st-t-fast grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/65"
                    >
                        {isPaused ? <Play size={14} className="translate-x-[1px]" fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
                    </button>
                </Tooltip>
            </SampleBox>
        );
    };

export default ThemePreview;
