import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { VisualizerSharedProps } from '../../components/visualizer/definition';
import VisualizerShell from '../../components/visualizer/VisualizerShell';
import VisualizerStill from '../../components/visualizer/still/VisualizerStill';
import { useReducedMotionFor } from '../../hooks/useReducedMotionFor';
import { resolveThemeFontStack, resolveThemeFontWeight, resolveThemeTranslationFontStack } from '../../utils/fontStacks';
import { mountCodePack } from './host';
import { makeCodeScene } from './scene';
import { loadCodeCover } from './cover';
import type { CodeStylePack } from './contract';

// Production bridge: React supplies structural updates; the worker receives the live clock at capped FPS.
export default function CodePackVisualizer(props: VisualizerSharedProps & { pack: CodeStylePack }) {
    const root = useRef<HTMLDivElement>(null), host = useRef<ReturnType<typeof mountCodePack> | null>(null);
    const [failed, setFailed] = useState(false);
    const reduced = useReducedMotionFor('uiMicroMotion');
    const mainFamily = resolveThemeFontStack(props.theme);
    const subtitleFamily = resolveThemeTranslationFontStack(props.subtitleTheme ?? props.theme);
    const scene = useMemo(() => makeCodeScene(props.lines, props.songTitle ?? '', props.songArtist ?? '', props.songAlbum ?? '', props.duration), [props.lines, props.songTitle, props.songArtist, props.songAlbum, props.duration]);
    const live = useRef({ props, reduced, scene }); live.current = { props, reduced, scene };
    useEffect(() => { setFailed(false); }, [props.pack]);
    useEffect(() => {
        if (!root.current || failed) return;
        host.current = mountCodePack(root.current, props.pack, () => {
            const { props: p, reduced, scene } = live.current;
            const sub = p.subtitleTheme ?? p.theme, index = p.currentLineIndex, line = p.lines[index];
            const spectrum = p.audioBands.spectrum?.get();
            return { scene, animate: !p.paused && !p.staticMode, frame: {
                index, paused: !!p.paused, time: p.currentTime.get(), duration: p.duration ?? 0,
                title: p.songTitle ?? '', artist: p.songArtist ?? '', album: p.songAlbum ?? '',
                current: line?.fullText ?? '', previous: p.lines[index - 1]?.fullText ?? '', next: p.lines[index + 1]?.fullText ?? '',
                translation: p.hideTranslationSubtitle ? '' : line?.translation ?? '',
                audio: p.paused ? 0 : Math.max(0, Math.min(1, p.audioPower.get())),
                spectrum: Array.from({ length: 32 }, (_, i) => p.paused ? 0 : (spectrum?.[Math.floor(i * spectrum.length / 32)] ?? 0) / 255),
                theme: { background: p.theme.backgroundColor, primary: p.theme.primaryColor, secondary: p.theme.secondaryColor, accent: p.theme.accentColor },
                fontFamily: resolveThemeFontStack(p.theme), fontWeight: resolveThemeFontWeight(p.theme, 500), fontScale: p.lyricsFontScale ?? 1,
                subtitleFontFamily: resolveThemeTranslationFontStack(sub), subtitleFontWeight: resolveThemeFontWeight(sub, 500), subtitleFontScale: p.subtitleFontScale ?? 1,
                reducedMotion: !!(reduced || p.staticMode), showText: p.showText !== false,
            } };
        }, error => { console.warn('[StylePacks] Renderer failed; using Still', error); setFailed(true); });
        const unsubscribe = props.currentTime.on('change', () => { if (live.current.props.paused || live.current.props.staticMode) host.current?.draw(); });
        return () => { unsubscribe(); host.current?.dispose(); host.current = null; };
    }, [props.pack, props.currentTime, failed]);
    useEffect(() => { host.current?.draw(); });
    useEffect(() => {
        const active = host.current;
        if (!active) return;
        return loadCodeCover(props.coverUrl, active);
    }, [props.coverUrl, props.pack, failed]);
    useEffect(() => {
        const active = host.current; if (!active) return;
        let disposed = false;
        void (async () => {
            const families = `${mainFamily}, ${subtitleFamily}`;
            const fonts: { family: string; data: ArrayBuffer }[] = [];
            if (families.includes('FoliaUploadedLyricsFont_')) {
                const { getStoredUploadedLyricsFont } = await import('../../services/customLyricsFont');
                const font = await getStoredUploadedLyricsFont();
                if (font && families.includes(`"${font.family}"`)) fonts.push({ family: font.family, data: await font.blob.arrayBuffer() });
            }
            if (!disposed) await active.setFonts(fonts);
        })().catch(error => { if (!disposed) console.warn('[StylePacks] Font bridge failed', error); });
        return () => { disposed = true; };
    }, [mainFamily, subtitleFamily, props.pack, failed]);
    if (failed) return <VisualizerStill {...props} />;
    return <VisualizerShell theme={props.theme} audioPower={props.audioPower} audioBands={props.audioBands} sharedProps={props} renderBackground={props.pack.kind === 'lyric-template'}>
        <div ref={root} className="absolute inset-0 pointer-events-none" aria-hidden="true" />
        <div className="sr-only">{props.songTitle} {props.showText !== false && props.lines[props.currentLineIndex]?.fullText}</div>
    </VisualizerShell>;
}
