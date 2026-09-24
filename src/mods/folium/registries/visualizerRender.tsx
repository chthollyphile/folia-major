import React, { useMemo } from 'react';
import type { VisualizerSharedProps } from '@/components/visualizer/definition';
import VisualizerShell from '@/components/visualizer/VisualizerShell';
import VisualizerSubtitleOverlay from '@/components/visualizer/VisualizerSubtitleOverlay';
import { resolveSubtitleFontSizes } from '@/components/visualizer/subtitleFontSizes';
import { useVisualizerRuntime } from '@/components/visualizer/runtime';
import { getLineRenderEndTime } from '@/utils/lyrics/renderHints';
import { useFoliumStageContext } from '../stageContext';
import { FoliumMountHost } from '../FoliumMountHost';
import type { StoredFoliumVisualizer } from './visualizers';

// src/mods/folium/registries/visualizerRender.tsx
// The render half of a mod visualizer mode, loaded lazily like every builtin
// renderer: the host shell (background, back button, stage layer slots), the
// mod's own mount, and the shared bottom subtitle layer.

/*
 * The shared bottom subtitle layer (translation / upcoming line) for mod modes.
 * Builtin modes wire this inside their own renderers; a mod has no React and no
 * access to the host's subtitle settings, so the host fills the gap here and
 * mod modes get the same font scaling, opacity, offset, blur and content mode
 * as every builtin mode. Font sizes come from subtitleFontSizes, so switching
 * from a builtin mode to a mod mode keeps the subtitles in place.
 */
const FoliumSubtitleOverlay: React.FC<VisualizerSharedProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        subtitleTheme,
        showText = true,
        lyricsFontScale = 1,
        subtitleFontScale = 1,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        isPlayerChromeHidden,
        hideTranslationSubtitle,
        showSubtitleTranslation,
        subtitleContentMode,
    } = props;
    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });
    const subtitleFontSizes = resolveSubtitleFontSizes(lyricsFontScale);
    return (
        <VisualizerSubtitleOverlay
            showText={showText}
            activeLine={activeLine}
            recentCompletedLine={recentCompletedLine}
            nextLines={nextLines}
            theme={theme}
            subtitleTheme={subtitleTheme}
            {...subtitleFontSizes}
            subtitleFontScale={subtitleFontScale}
            subtitleOverlayOpacity={subtitleOverlayOpacity}
            subtitleOverlayBackground={subtitleOverlayBackground}
            subtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur}
            isPlayerChromeHidden={isPlayerChromeHidden}
            hideTranslationSubtitle={hideTranslationSubtitle}
            showSubtitleTranslation={showSubtitleTranslation}
            subtitleContentMode={subtitleContentMode}
        />
    );
};

const FoliumVisualizerStage: React.FC<{
    id: string;
    modId: string;
    stored: StoredFoliumVisualizer;
    props: VisualizerSharedProps;
}> = ({ id, modId, stored, props }) => {
    const transparent = Boolean(props.background?.transparent);
    const surface = useMemo(
        () => ({ transparent, hostBackground: stored.hostBackground && !transparent }),
        [transparent, stored.hostBackground],
    );
    const ctx = useFoliumStageContext({
        lines: props.lines,
        currentTime: props.currentTime,
        currentLineIndex: props.currentLineIndex,
        paused: Boolean(props.paused),
        theme: props.theme,
        isDaylight: Boolean(props.isDaylight),
        songTitle: props.songTitle ?? null,
        songArtist: props.songArtist ?? null,
        songAlbum: props.songAlbum ?? null,
        staticMode: Boolean(props.staticMode),
        surface,
        settings: stored.settingsAccess,
    });
    return (
        <FoliumMountHost
            modId={modId}
            where={`visualizer ${id}`}
            mount={stored.def.mount}
            ctx={ctx}
            className="absolute inset-0"
        />
    );
};

const FoliumVisualizerRender: React.FC<{
    id: string;
    modId: string;
    stored: StoredFoliumVisualizer;
    props: VisualizerSharedProps;
}> = ({ id, modId, stored, props }) => (
    <VisualizerShell
        theme={props.theme}
        audioPower={props.audioPower}
        audioBands={props.audioBands}
        sharedProps={props}
        renderBackground={stored.hostBackground}
    >
        <FoliumVisualizerStage id={id} modId={modId} stored={stored} props={props} />
        {stored.hostSubtitles ? <FoliumSubtitleOverlay {...props} /> : null}
    </VisualizerShell>
);

export default FoliumVisualizerRender;
