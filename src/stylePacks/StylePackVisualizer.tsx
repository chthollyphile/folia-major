import React, { useEffect, useRef, useState } from 'react';
import type { VisualizerSharedProps } from '../components/visualizer/definition';
import VisualizerShell from '../components/visualizer/VisualizerShell';
import VisualizerStill from '../components/visualizer/still/VisualizerStill';
import { resolveThemeFontStack, resolveThemeFontWeight, resolveThemeTranslationFontStack } from '../utils/fontStacks';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { useReducedMotionFor } from '../hooks/useReducedMotionFor';
import { mountPackCanvas } from './canvasHost';
import type { PackFrame, StylePack } from './types';
import type { AnyStylePack } from './code/contract';
import CodePackVisualizer from './code/CodePackVisualizer';

// Adapts the existing player clock, lyrics and analyser without per-frame React state.
export default function StylePackVisualizer(props: VisualizerSharedProps & { pack: AnyStylePack }) {
    return props.pack.schemaVersion === 2 ? <CodePackVisualizer {...props} pack={props.pack} /> : <LayerPackVisualizer {...props} pack={props.pack} />;
}

function LayerPackVisualizer(props: VisualizerSharedProps & { pack: StylePack }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const live = useRef(props);
    live.current = props;
    const image = useRef<HTMLImageElement | null>(null);
    const host = useRef<ReturnType<typeof mountPackCanvas> | null>(null);
    const [failed, setFailed] = useState(false);
    const fps = useVisualizerSettingsStore(state => state.visualizerFrameRate);
    const reduced = useReducedMotionFor('uiMicroMotion');
    const options = useRef({ fps, reduced });
    options.current = { fps, reduced };

    useEffect(() => {
        image.current = null;
        if (!props.coverUrl) return;
        const candidate = new Image();
        let disposed = false;
        candidate.crossOrigin = 'anonymous';
        candidate.onload = () => { if (!disposed) { image.current = candidate; host.current?.draw(); } };
        candidate.src = props.coverUrl;
        return () => { disposed = true; candidate.onload = null; candidate.src = ''; image.current = null; };
    }, [props.coverUrl]);

    useEffect(() => { setFailed(false); }, [props.pack]);
    useEffect(() => {
        if (!canvas.current || failed) return;
        const getInput = () => {
            const p = live.current, index = p.currentLineIndex, line = p.lines[index];
            const subtitleTheme = p.subtitleTheme ?? p.theme;
            const spectrum = p.audioBands.spectrum?.get();
            const frame: PackFrame = {
                time: p.currentTime.get(), duration: p.duration ?? 0,
                title: p.songTitle ?? '', artist: p.songArtist ?? '', album: p.songAlbum ?? '',
                current: line?.fullText ?? '', previous: p.lines[index - 1]?.fullText ?? '', next: p.lines[index + 1]?.fullText ?? '',
                translation: p.hideTranslationSubtitle ? '' : line?.translation ?? '',
                audio: p.paused ? 0 : p.audioPower.get(),
                spectrum: Array.from({ length: 32 }, (_, i) => p.paused ? 0 : (spectrum?.[Math.floor(i * spectrum.length / 32)] ?? 0) / 255),
                cover: image.current,
                theme: { background: p.theme.backgroundColor, primary: p.theme.primaryColor, secondary: p.theme.secondaryColor, accent: p.theme.accentColor },
                fontFamily: resolveThemeFontStack(p.theme), fontWeight: resolveThemeFontWeight(p.theme, 500), fontScale: p.lyricsFontScale ?? 1,
                subtitleFontFamily: resolveThemeTranslationFontStack(subtitleTheme), subtitleFontWeight: resolveThemeFontWeight(subtitleTheme, 500), subtitleFontScale: p.subtitleFontScale ?? 1,
                reducedMotion: Boolean(p.staticMode || options.current.reduced), showText: p.showText !== false,
            };
            return { pack: p.pack, frame, fps: typeof options.current.fps === 'number' ? options.current.fps : 30, animate: !p.paused && !p.staticMode };
        };
        host.current = mountPackCanvas(canvas.current, getInput, error => {
            console.warn('[StylePacks] Rendering failed; using Still', error);
            setFailed(true);
        });
        const unsubscribe = props.currentTime.on('change', () => { if (live.current.paused || live.current.staticMode) host.current?.draw(); });
        return () => { unsubscribe(); host.current?.dispose(); host.current = null; };
    }, [failed, props.currentTime, props.pack]);
    useEffect(() => { host.current?.draw(); });

    if (failed) return <VisualizerStill {...props} />;
    return <VisualizerShell theme={props.theme} audioPower={props.audioPower} audioBands={props.audioBands} sharedProps={props} renderBackground={false}>
        <canvas ref={canvas} className="absolute inset-0 h-full w-full pointer-events-none" aria-hidden="true" />
        <div className="sr-only">{props.songTitle} {props.songArtist} {props.showText !== false && props.lines[props.currentLineIndex]?.fullText}</div>
    </VisualizerShell>;
}
