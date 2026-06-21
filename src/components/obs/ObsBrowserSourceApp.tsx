import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import VisualizerRenderer from '../visualizer/VisualizerRenderer';
import { PlayerState } from '../../types';
import type { ObsBrowserSourceAudio, ObsBrowserSourceClock, ObsBrowserSourceConfig } from '../../types/obsBrowserSource';
import { findLatestActiveLineIndex } from '../../utils/appPlaybackHelpers';
import { resolveObsBrowserSourceClockTime } from '../../utils/obsBrowserSource';

// src/components/obs/ObsBrowserSourceApp.tsx
// Read-only OBS browser source renderer driven by Folia's main playback clock.

const EMPTY_SPECTRUM = new Uint8Array(0);

const buildEventSourceUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') ?? '';
    const devPort = params.get('obsPort');
    const baseUrl = devPort ? `http://127.0.0.1:${devPort}` : window.location.origin;
    const url = new URL('/obs/events', baseUrl);
    url.searchParams.set('token', token);
    return url.toString();
};

const ObsBrowserSourceApp: React.FC = () => {
    const { t } = useTranslation();
    const [config, setConfig] = useState<ObsBrowserSourceConfig | null>(null);
    const [connected, setConnected] = useState(false);
    const [currentLineIndex, setCurrentLineIndex] = useState(-1);
    const [playbackState, setPlaybackState] = useState<PlayerState>(PlayerState.IDLE);
    const currentLineIndexRef = useRef(-1);
    const clockRef = useRef<ObsBrowserSourceClock | null>(null);
    const configRef = useRef<ObsBrowserSourceConfig | null>(null);
    const currentTime = useMotionValue(0);
    const audioPower = useMotionValue(0);
    const bass = useMotionValue(0);
    const lowMid = useMotionValue(0);
    const mid = useMotionValue(0);
    const vocal = useMotionValue(0);
    const treble = useMotionValue(0);
    const spectrum = useMotionValue(EMPTY_SPECTRUM);
    const audioBands = useMemo(() => ({
        bass,
        lowMid,
        mid,
        vocal,
        treble,
        spectrum,
    }), [bass, lowMid, mid, spectrum, treble, vocal]);

    useEffect(() => {
        document.body.style.backgroundColor = 'transparent';
        document.documentElement.style.backgroundColor = 'transparent';
        document.body.style.overflow = 'hidden';
        document.title = 'Folia OBS';
    }, []);

    useEffect(() => {
        configRef.current = config;
    }, [config]);

    useEffect(() => {
        const eventSource = new EventSource(buildEventSourceUrl());

        eventSource.onopen = () => setConnected(true);
        eventSource.onerror = () => setConnected(false);
        eventSource.addEventListener('config', event => {
            const nextConfig = JSON.parse((event as MessageEvent).data) as ObsBrowserSourceConfig;
            setConfig(nextConfig);
        });
        eventSource.addEventListener('clock', event => {
            const nextClock = JSON.parse((event as MessageEvent).data) as ObsBrowserSourceClock;
            clockRef.current = nextClock;
            setPlaybackState(prev => (
                prev === nextClock.playerState ? prev : nextClock.playerState
            ));
        });
        eventSource.addEventListener('audio', event => {
            const nextAudio = JSON.parse((event as MessageEvent).data) as ObsBrowserSourceAudio;
            audioPower.set(nextAudio.audioPower);
            bass.set(nextAudio.bands.bass);
            lowMid.set(nextAudio.bands.lowMid);
            mid.set(nextAudio.bands.mid);
            vocal.set(nextAudio.bands.vocal);
            treble.set(nextAudio.bands.treble);
            spectrum.set(new Uint8Array(nextAudio.spectrum));
        });

        return () => {
            eventSource.close();
        };
    }, [audioPower, bass, lowMid, mid, spectrum, treble, vocal]);

    useEffect(() => {
        let frameId = 0;
        const tick = () => {
            const nextTime = resolveObsBrowserSourceClockTime(clockRef.current);
            currentTime.set(nextTime);

            const lines = configRef.current?.lyrics?.lines ?? [];
            const nextLineIndex = lines.length > 0 ? findLatestActiveLineIndex(lines, nextTime) : -1;
            if (nextLineIndex !== currentLineIndexRef.current) {
                currentLineIndexRef.current = nextLineIndex;
                setCurrentLineIndex(nextLineIndex);
            }

            frameId = window.requestAnimationFrame(tick);
        };

        frameId = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frameId);
    }, [currentTime]);

    if (!config) {
        return (
            <div className="h-screen w-screen bg-transparent grid place-items-center text-white/70 text-sm">
                {connected ? t('obs.waitingForPlayback', 'Waiting for Folia playback') : t('obs.connecting', 'Connecting to Folia')}
            </div>
        );
    }

    return (
        <div
            className="h-screen w-screen overflow-hidden"
            style={{
                backgroundColor: config.transparentBackground ? 'transparent' : config.theme.backgroundColor,
                color: config.theme.primaryColor,
            }}
        >
            <VisualizerRenderer
                mode={config.visualizerMode}
                currentTime={currentTime}
                currentLineIndex={currentLineIndex}
                lines={config.lyrics?.lines ?? []}
                theme={config.theme}
                isDaylight={config.isDaylight}
                audioPower={audioPower}
                audioBands={audioBands}
                songTitle={config.song?.name}
                songArtist={config.songArtist}
                songAlbum={config.songAlbum}
                coverUrl={config.coverUrl}
                showText={true}
                useCoverColorBg={config.useCoverColorBg}
                seed={config.seed}
                staticMode={config.staticMode}
                paused={playbackState !== PlayerState.PLAYING}
                backgroundOpacity={config.backgroundOpacity}
                visualizerOpacity={config.visualizerOpacity}
                transparentBackground={config.transparentBackground}
                disableGeometricBackground={config.disableGeometricBackground}
                disableVignette={config.disableVignette}
                visualizerBackgroundMode={config.visualizerBackgroundMode}
                lyricsFontScale={config.lyricsFontScale}
                subtitleOverlayOpacity={config.subtitleOverlayOpacity}
                isPlayerChromeHidden={true}
                hideTranslationSubtitle={config.hideTranslationSubtitle}
                classicTuning={config.classicTuning}
                cadenzaTuning={config.cadenzaTuning}
                partitaTuning={config.partitaTuning}
                fumeTuning={config.fumeTuning}
                cappellaTuning={config.cappellaTuning}
                cappellaCustomEmojiImages={config.cappellaCustomEmojiImages}
                cappellaCustomAvatarImages={config.cappellaCustomAvatarImages}
                tiltTuning={config.tiltTuning}
                monetBackgroundTuning={config.monetBackgroundTuning}
                monetTuning={config.monetTuning}
                monetBackgroundImage={config.monetBackgroundImage}
                monetPortraitImage={config.monetPortraitImage}
                urlBackgroundList={config.urlBackgroundList}
                urlBackgroundSelectedId={config.urlBackgroundSelectedId}
            />
        </div>
    );
};

export default ObsBrowserSourceApp;
