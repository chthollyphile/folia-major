import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMotionValue } from 'framer-motion';
import VisualizerRenderer from '../visualizer/VisualizerRenderer';
import type { Line, Theme } from '../../types';
import { findLatestActiveLineIndex } from '../../utils/appPlaybackHelpers';
import { buildBuiltinDualTheme } from '../../hooks/themeControllerState';
import { extractColors } from '../../utils/colorExtractor';
import type { WebLyricSource } from '../../types/webLyricSource';
import type { ObsWebAppearance } from '../../utils/obsWebAppearance';

// src/components/obs/ObsWebSourceApp.tsx
// Source-neutral browser OBS overlay shell: consumes an injected WebLyricSource
// (NowPlaying / PlayerCap / ...) plus the URL cfg appearance, reusing the same
// VisualizerRenderer pipeline as the main window (4K scaling, rAF clock, transparent bg).
// A pure browser OBS source has no local audio, so the spectrum/energy stay 0 (visuals
// take the static / low-energy branch).

const EMPTY_SPECTRUM = new Uint8Array(0);

// Cover colors -> Folia builtin dual theme (the fallback when cfg carries no theme; same
// as the main app without an AI key); pick the side by daylight.
const pickBuiltinTheme = (coverColors: string[], isDaylight: boolean): Theme => {
    const dual = buildBuiltinDualTheme({ coverColors });
    return isDaylight ? dual.light : dual.dark;
};

interface ObsWebSourceAppProps {
    source: WebLyricSource;
    appearance: ObsWebAppearance;
}

const ObsWebSourceApp: React.FC<ObsWebSourceAppProps> = ({ source, appearance }) => {
    const { state, getCurrentTimeSec } = source;
    const { isDaylight, transparent } = appearance;

    const [currentLineIndex, setCurrentLineIndex] = useState(-1);
    const [theme, setTheme] = useState<Theme>(() => appearance.theme ?? pickBuiltinTheme([], isDaylight));
    const [obsScale, setObsScale] = useState(1);
    const [obsDimensions, setObsDimensions] = useState({ width: '100vw', height: '100vh' });

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

    useEffect(() => {
        document.body.style.backgroundColor = 'transparent';
        document.documentElement.style.backgroundColor = 'transparent';
        document.body.style.overflow = 'hidden';
        document.title = 'Folia OBS';
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
    useEffect(() => {
        if (cfgTheme) {
            setTheme(cfgTheme);
            return;
        }
        let cancelled = false;
        if (!coverUrl) {
            setTheme(pickBuiltinTheme([], isDaylight));
            return () => { cancelled = true; };
        }
        void extractColors(coverUrl, 5)
            .then((colors) => { if (!cancelled) setTheme(pickBuiltinTheme(colors, isDaylight)); })
            .catch(() => { if (!cancelled) setTheme(pickBuiltinTheme([], isDaylight)); });
        return () => { cancelled = true; };
    }, [coverUrl, isDaylight, cfgTheme]);

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
                theme={theme}
                isDaylight={isDaylight}
                audioPower={audioPower}
                audioBands={audioBands}
                songTitle={state.track?.name}
                songArtist={state.track?.artist}
                coverUrl={coverUrl}
                showText={true}
                seed={state.track?.seed || 'folia-obs-web'}
                paused={paused}
                visualizerOpacity={appearance.visualizerOpacity}
                background={appearance.background}
                lyricsFontScale={appearance.lyricsFontScale}
                subtitleOverlayBackground={appearance.subtitleOverlayBackground}
                hideTranslationSubtitle={appearance.hideTranslationSubtitle}
                showSubtitleTranslation={appearance.showSubtitleTranslation}
                isPlayerChromeHidden={true}
            />
        </div>
    );
};

export default ObsWebSourceApp;
