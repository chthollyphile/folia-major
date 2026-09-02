import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMotionValue } from 'framer-motion';
import VisualizerRenderer from '../visualizer/VisualizerRenderer';
import { buildVisualizerTheme } from '../app/presentation/buildVisualizerTheme';
import type { DualTheme, Line, MonetPortraitImage, Theme } from '../../types';
import type { VisualizerBackgroundConfig } from '../visualizer/backgrounds/definition';
import { findLatestActiveLineIndex } from '../../utils/appPlaybackHelpers';
import { buildBuiltinDualTheme } from '../../hooks/themeControllerState';
import { extractColors } from '../../utils/colorExtractor';
import { readObsCustomCssAssets, type ObsCustomCssAssets } from '../../services/obs/obsCustomCss';
import type { WebLyricSource } from '../../types/webLyricSource';
import type { ObsWebAppearance } from '../../utils/obsWebAppearance';
import { useObsAiTheme } from '../../hooks/useObsAiTheme';
import type { ObsAiConfig } from '../../services/gemini';

// src/components/obs/ObsWebSourceApp.tsx
// Source-neutral browser OBS overlay shell: consumes an injected WebLyricSource
// (NowPlaying / PlayerCap / ...) plus the URL cfg appearance, reusing the same
// VisualizerRenderer pipeline as the main window (4K scaling, rAF clock, transparent bg).
// A pure browser OBS source has no local audio, so the spectrum/energy stay 0 (visuals
// take the static / low-energy branch).

const EMPTY_SPECTRUM = new Uint8Array(0);


interface ObsWebSourceAppProps {
    source: WebLyricSource;
    appearance: ObsWebAppearance;
    // Dynamic AI mode: when set, the overlay regenerates an AI theme per song (overrides cfg/cover);
    // null/undefined keeps the cfg-or-cover behavior unchanged.
    obsAiConfig?: ObsAiConfig | null;
}

const ObsWebSourceApp: React.FC<ObsWebSourceAppProps> = ({ source, appearance, obsAiConfig }) => {
    const { state, getCurrentTimeSec } = source;
    const { isDaylight, transparent } = appearance;

    const [currentLineIndex, setCurrentLineIndex] = useState(-1);
    // The builtin fallback is generated as a light/dark pair and kept whole: it is randomized per
    // cover, so re-deriving it on a daylight toggle would hand back an unrelated theme.
    const [builtinDualTheme, setBuiltinDualTheme] = useState<DualTheme>(() => buildBuiltinDualTheme());
    const [obsScale, setObsScale] = useState(1);
    const [obsDimensions, setObsDimensions] = useState({ width: '100vw', height: '100vh' });
    // Uploaded assets OBS injected through the Custom CSS field; the cfg URL cannot carry an image blob.
    const [cssAssets, setCssAssets] = useState<ObsCustomCssAssets>({ backgroundUrl: null, portraitUrl: null, cappellaEmojis: [], cappellaAvatars: [] });

    const currentLineIndexRef = useRef(-1);
    const linesRef = useRef<Line[]>([]);
    const getTimeRef = useRef(getCurrentTimeSec);
    getTimeRef.current = getCurrentTimeSec;
    linesRef.current = state.lyrics?.lines ?? [];

    const currentTime = useMotionValue(0);
    const audioPower = useMotionValue(0);
    const bass = useMotionValue(0);
    const lowMid = useMotionValue(0);
    const mid = useMotionValue(0);
    const vocal = useMotionValue(0);
    const treble = useMotionValue(0);
    const spectrum = useMotionValue(EMPTY_SPECTRUM);
    const audioBands = useMemo(() => ({ bass, lowMid, mid, vocal, treble, spectrum }), [bass, lowMid, mid, spectrum, treble, vocal]);

    // Dynamic AI overlay: a per-song regenerated DualTheme (null unless/until generated; overrides cfg/cover below).
    const aiDualTheme = useObsAiTheme({ enabled: !!obsAiConfig, aiConfig: obsAiConfig ?? null, state });

    useEffect(() => {
        document.body.style.backgroundColor = 'transparent';
        document.documentElement.style.backgroundColor = 'transparent';
        document.body.style.overflow = 'hidden';
        document.title = 'Folia OBS';
    }, []);

    // OBS applies the Custom CSS field around page load, which may land just before or just after this
    // mounts. Poll a few times (~1s) until an asset shows up, then stop; a source with no custom CSS
    // simply keeps both null and the overlay falls back to the cover as before.
    useEffect(() => {
        let attempts = 0;
        let timerId = 0;
        const read = () => {
            const assets = readObsCustomCssAssets();
            const hasAny = assets.backgroundUrl || assets.portraitUrl
                || assets.cappellaEmojis.length > 0 || assets.cappellaAvatars.length > 0;
            if (hasAny || attempts >= 5) {
                setCssAssets(assets);
                return;
            }
            attempts += 1;
            timerId = window.setTimeout(read, 200);
        };
        read();
        return () => window.clearTimeout(timerId);
    }, []);

    // 4K scaling: same as the upstream ObsBrowserSourceApp -lay children out as 1920x1080
    // while natively rasterizing text at 4K.
    useEffect(() => {
        let isHandlingResize = false;

        const handleResize = () => {
            if (isHandlingResize) return;
            isHandlingResize = true;

            try {
                const isPortrait = window.innerHeight > window.innerWidth;
                const baseWidth = isPortrait ? 1080 : 1920;

                const realWidth = window.document.documentElement.clientWidth;
                const realHeight = window.document.documentElement.clientHeight;

                const scale = Math.max(1, realWidth / baseWidth);
                setObsScale(scale);
                setObsDimensions({
                    width: `${realWidth / scale}px`,
                    height: `${realHeight / scale}px`,
                });

                try {
                    Object.defineProperty(window, 'devicePixelRatio', { get: () => scale, configurable: true });
                    Object.defineProperty(window, 'innerWidth', { get: () => realWidth / scale, configurable: true });
                    Object.defineProperty(window, 'innerHeight', { get: () => realHeight / scale, configurable: true });
                } catch {
                    // Ignore
                }

                if (scale > 1.0) {
                    window.dispatchEvent(new Event('resize'));
                }
            } finally {
                isHandlingResize = false;
            }
        };
        handleResize();

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Theme: use the cfg theme directly when present (side already picked by daylight in
    // appearance); otherwise derive from cover colors whenever the cover changes.
    const coverUrl = state.track?.coverUrl || null;
    const cfgTheme = appearance.theme;
    // Priority: per-song AI theme (Dynamic AI) > cfg theme (static burn-in) > cover-derived builtin.
    const aiTheme = aiDualTheme ? (isDaylight ? aiDualTheme.light : aiDualTheme.dark) : null;
    useEffect(() => {
        if (aiTheme || cfgTheme) {
            return;
        }
        let cancelled = false;
        if (!coverUrl) {
            setBuiltinDualTheme(buildBuiltinDualTheme());
            return () => { cancelled = true; };
        }
        void extractColors(coverUrl, 5)
            .then((colors) => { if (!cancelled) setBuiltinDualTheme(buildBuiltinDualTheme({ coverColors: colors })); })
            .catch(() => { if (!cancelled) setBuiltinDualTheme(buildBuiltinDualTheme()); });
        return () => { cancelled = true; };
    }, [coverUrl, cfgTheme, aiTheme]);

    const theme: Theme = aiTheme ?? cfgTheme ?? (isDaylight ? builtinDualTheme.light : builtinDualTheme.dark);

    // Clock + current line index: extrapolated by source.getCurrentTimeSec.
    useEffect(() => {
        let frameId = 0;
        const tick = () => {
            const lyricTime = getTimeRef.current(Date.now());
            currentTime.set(lyricTime);

            const lines = linesRef.current;
            const nextLineIndex = lines.length > 0 ? findLatestActiveLineIndex(lines, lyricTime) : -1;
            if (nextLineIndex !== currentLineIndexRef.current) {
                currentLineIndexRef.current = nextLineIndex;
                setCurrentLineIndex(nextLineIndex);
            }

            frameId = window.requestAnimationFrame(tick);
        };

        frameId = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frameId);
    }, [currentTime]);

    // Derive paused from the clock (single source of truth) so lyric advance and visual
    // animation never disagree — before the first pause-state event playerState is still
    // 'idle', which the clock and the visuals would otherwise interpret differently.
    const paused = !state.clock.playing;

    // Graft the Custom-CSS assets onto the cfg appearance: the uploaded background feeds the Monet /
    // Nomand pipelines through customImage, the portrait rides its own renderer prop. Present-wins, so
    // an overlay with no custom CSS is byte-for-byte the old cover-derived behaviour.
    const backgroundWithAssets = useMemo<VisualizerBackgroundConfig>(() => (
        cssAssets.backgroundUrl
            ? { ...appearance.background, customImage: { id: 'obs-css-bg', name: 'obs-css-bg', url: cssAssets.backgroundUrl } }
            : appearance.background
    ), [appearance.background, cssAssets.backgroundUrl]);
    const portraitImage = useMemo<MonetPortraitImage | null>(() => (
        cssAssets.portraitUrl ? { id: 'obs-css-portrait', name: 'obs-css-portrait', url: cssAssets.portraitUrl } : null
    ), [cssAssets.portraitUrl]);

    // Overlay the cfg font stack onto the resolved theme so the OBS fonts match the main window
    // (same helper as the main app). appStyle {} keeps theme.backgroundColor.
    const { visualizerTheme, visualizerSubtitleTheme } = buildVisualizerTheme({
        appStyle: {},
        theme,
        lyricsFontStyle: appearance.lyricsFontStyle ?? theme.fontStyle,
        lyricsFontWeight: appearance.lyricsFontWeight,
        lyricsCustomFontFamily: appearance.lyricsCustomFontFamily ?? null,
        lyricsFontFallbackFamilies: appearance.lyricsFontFallbackFamilies,
        subtitleFontInheritsLyrics: appearance.subtitleFontInheritsLyrics,
        subtitleFontStyle: appearance.subtitleFontStyle,
        subtitleFontWeight: appearance.subtitleFontWeight,
        subtitleFontFamily: appearance.subtitleFontFamily,
        subtitleFontFallbackFamilies: appearance.subtitleFontFallbackFamilies,
        visualizerMode: appearance.mode,
    });

    return (
        <div
            className="overflow-hidden"
            style={{
                width: obsDimensions.width,
                height: obsDimensions.height,
                zoom: obsScale,
                backgroundColor: transparent ? 'transparent' : theme.backgroundColor,
                color: theme.primaryColor,
            }}
        >
            <VisualizerRenderer
                mode={appearance.mode}
                visualizerTunings={appearance.visualizerTunings}
                currentTime={currentTime}
                currentLineIndex={currentLineIndex}
                lines={state.lyrics?.lines ?? []}
                theme={visualizerTheme}
                subtitleTheme={visualizerSubtitleTheme}
                isDaylight={isDaylight}
                audioPower={audioPower}
                audioBands={audioBands}
                songTitle={state.track?.name}
                songArtist={state.track?.artist}
                coverUrl={coverUrl}
                showText={true}
                seed={state.track?.seed || 'folia-obs-web'}
                paused={paused}
                staticMode={appearance.staticMode}
                visualizerOpacity={appearance.visualizerOpacity}
                background={backgroundWithAssets}
                monetPortraitImage={portraitImage}
                cappellaCustomEmojiImages={cssAssets.cappellaEmojis}
                cappellaCustomAvatarImages={cssAssets.cappellaAvatars}
                lyricsFontScale={appearance.lyricsFontScale}
                subtitleFontScale={appearance.subtitleFontScale}
                subtitleOverlayBackground={appearance.subtitleOverlayBackground}
                subtitleOverlayOpacity={appearance.subtitleOverlayOpacity}
                showHarmonySubtitle={appearance.showHarmonySubtitle}
                harmonySubtitleBackground={appearance.harmonySubtitleBackground}
                hideTranslationSubtitle={appearance.hideTranslationSubtitle}
                showSubtitleTranslation={appearance.showSubtitleTranslation}
                subtitleContentMode={appearance.subtitleContentMode}
                isPlayerChromeHidden={true}
            />
        </div>
    );
};

export default ObsWebSourceApp;
