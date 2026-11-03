import React, { memo } from 'react';
import { useFoliumTunings } from '@/mods/folium/registries/tunings';
import { useFoliumVisualizerSettings } from '@/mods/folium/registries/visualizers';
import type { VisualizerMode } from '../../../types';
import type { VisualizerBackgroundConfig } from '../backgrounds/definition';
import { DEFAULT_VISUALIZER_BACKGROUND_MODE } from '../backgrounds/registry';
import { VisualizerModeGlyph } from '../modeGlyphs';
import { getVisualizerRegistryEntry, getVisualizerScopedSeed } from '../registry';
import { applyVisualizerTuning } from '../tuningRegistry';
import LivePicture from './LivePicture';
import { useLyricPreview } from './LyricPreviewContext';
import { stylePictureKey } from './pictureImages';
import { useClockTap } from './usePreviewClock';

// src/components/visualizer/preview/LyricStylePicture.tsx
// One lyric style as a small picture (LivePicture): the real style on the sample song, with the
// settings the picker previews. It draws no background and no subtitles: the style alone, on the
// theme's background colour. A style of which no image can be made shows its glyph.

/** No background layer: a style draws none when the background is said to be transparent. */
const NO_BACKGROUND: VisualizerBackgroundConfig = { mode: DEFAULT_VISUALIZER_BACKGROUND_MODE, transparent: true };

/** The style on the clock's tap, drawn as the renderer draws it. */
const StyleOnStage: React.FC<{ mode: VisualizerMode; running: boolean }> = ({ mode, running }) => {
    const { clock, theme, isDaylight, look } = useLyricPreview();
    const tap = useClockTap(clock, running);

    return getVisualizerRegistryEntry(mode).render(applyVisualizerTuning(mode, {
        ...look,
        currentTime: tap.currentTime,
        duration: clock.placeholder.loopDuration,
        currentLineIndex: tap.currentLineIndex,
        lines: clock.placeholder.lines,
        theme,
        isDaylight,
        audioPower: tap.audioPower,
        audioBands: tap.audioBands,
        songTitle: clock.placeholder.title,
        coverUrl: clock.placeholder.coverUrl,
        showText: true,
        isPreviewMode: true,
        background: NO_BACKGROUND,
        subtitleContentMode: 'none',
        showSubtitleTranslation: false,
        showHarmonySubtitle: false,
        hideTranslationSubtitle: true,
        seed: getVisualizerScopedSeed(mode, 'style-picture'),
    }, look.visualizerTunings));
};

type LyricStylePictureProps = {
    mode: VisualizerMode;
    /** As the picture grid reports them (PictureState). */
    visible: boolean;
    chosen: boolean;
    active: boolean;
};

export const LyricStylePicture: React.FC<LyricStylePictureProps> = memo(({ mode, ...state }) => {
    const { clock, theme, isDaylight, look, stage } = useLyricPreview();
    // What mods add to how this style draws: a mod style's own settings, and the multipliers other mods put on a built-in style.
    const modSettings = useFoliumVisualizerSettings(mode);
    const modTunings = useFoliumTunings(mode);
    const imageKey = stylePictureKey(
        {
            mode,
            stage,
            theme,
            isDaylight,
            sample: clock.placeholder.id,
            fontScale: look.lyricsFontScale,
            tuning: (look.visualizerTunings as Record<string, unknown> | undefined)?.[mode],
            modSettings,
            modTunings,
        },
        look.cappellaCustomEmojiImages,
        look.cappellaCustomAvatarImages,
        look.monetPortraitImage,
    );

    return (
        <LivePicture imageKey={imageKey} glyph={<VisualizerModeGlyph mode={mode} size={22} />} {...state}>
            {running => <StyleOnStage mode={mode} running={running} />}
        </LivePicture>
    );
});

LyricStylePicture.displayName = 'LyricStylePicture';

export default LyricStylePicture;
