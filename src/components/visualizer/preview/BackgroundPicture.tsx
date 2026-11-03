import React, { memo, useMemo } from 'react';
import type { VisualizerBackgroundMode } from '../../../types';
import type { VisualizerBackgroundConfig } from '../backgrounds/definition';
import VisualizerBackgroundRenderer from '../backgrounds/VisualizerBackgroundRenderer';
import { BackgroundModeGlyph } from '../modeGlyphs';
import LivePicture, { PictureFrame } from './LivePicture';
import { useLyricPreview } from './LyricPreviewContext';
import { pictureKey } from './pictureImages';
import { useClockTap } from './usePreviewClock';

// src/components/visualizer/preview/BackgroundPicture.tsx
// One kind of background as a small picture (LivePicture): the real background layer with the
// settings the picker previews. The embedded-page background is never loaded into a picture: it
// shows its glyph. So does a background of which no image can be made.

/** Kinds that are never drawn: a picture must not load the user's page a second time. */
const NEVER_DRAWN: ReadonlySet<string> = new Set(['url']);

/** The background layer on the clock's tap. */
const BackgroundOnStage: React.FC<{ mode: VisualizerBackgroundMode; running: boolean }> = ({ mode, running }) => {
    const { clock, theme, isDaylight, background } = useLyricPreview();
    const tap = useClockTap(clock, running);
    const config = useMemo<VisualizerBackgroundConfig>(() => ({ ...background, mode, transparent: false }), [background, mode]);

    return (
        <VisualizerBackgroundRenderer
            config={config}
            theme={theme}
            isDaylight={isDaylight}
            coverUrl={clock.placeholder.coverUrl}
            audioPower={tap.audioPower}
            audioBands={tap.audioBands}
            seed={`background-picture-${mode}`}
            staticMode={false}
            paused={false}
        />
    );
};

type BackgroundPictureProps = {
    mode: VisualizerBackgroundMode;
    /** As the picture grid reports them (PictureState). */
    visible: boolean;
    chosen: boolean;
    active: boolean;
};

export const BackgroundPicture: React.FC<BackgroundPictureProps> = memo(({ mode, ...state }) => {
    const { clock, theme, isDaylight, background, stage } = useLyricPreview();
    const glyph = <BackgroundModeGlyph mode={mode} size={22} />;

    if (NEVER_DRAWN.has(mode)) {
        return <PictureFrame glyph={glyph} />;
    }
    const imageKey = pictureKey(
        ['background', mode, stage, theme, isDaylight, clock.placeholder.coverUrl, (background as Record<string, unknown> | undefined)?.[mode]],
        background?.customImage,
    );
    return (
        <LivePicture imageKey={imageKey} glyph={glyph} {...state}>
            {running => <BackgroundOnStage mode={mode} running={running} />}
        </LivePicture>
    );
});

BackgroundPicture.displayName = 'BackgroundPicture';

export default BackgroundPicture;
