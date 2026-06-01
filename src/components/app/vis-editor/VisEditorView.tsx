import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMotionValue, useMotionValueEvent } from 'framer-motion';
import type { MotionValue } from 'framer-motion';
import type { AudioBands, CappellaEmojiImage, CappellaTuning, CadenzaTuning, FumeTuning, Line, PartitaTuning, Theme, TiltTuning, VisualizerMode } from '../../../types';
import VisEditor from '../../visEditor/VisEditor';
import VisualizerComplexRenderer from '../../visualizer/VisualizerComplexRenderer';
import {
    findPreviewPlaceholderLineIndex,
    getPreviewPlaceholderStartOffset,
    VIS_PLAYGROUND_PREVIEW_LINES,
    VIS_PLAYGROUND_PREVIEW_LOOP_DURATION,
} from '../../visualizer/PreviewPlaceholder';
import { createDefaultVisualizerComplex, type VisualizerComplexV1 } from '../../visualizer/complex';

// src/components/app/vis-editor/VisEditorView.tsx
// App-level adapter that binds visEditor drafts to the current player preview inputs.
interface VisEditorViewProps {
    complex: VisualizerComplexV1;
    theme: Theme;
    isDaylight: boolean;
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    lines: Line[];
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    fallbackMode: VisualizerMode;
    songTitle?: string | null;
    coverUrl?: string | null;
    lyricsFontScale?: number;
    cadenzaTuning?: CadenzaTuning;
    partitaTuning?: PartitaTuning;
    fumeTuning?: FumeTuning;
    cappellaTuning?: CappellaTuning;
    tiltTuning?: TiltTuning;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    onSaveComplex: (complex: VisualizerComplexV1) => void;
    onResetComplex: () => void;
    onBack: () => void;
}

const VisEditorView: React.FC<VisEditorViewProps> = ({
    complex,
    theme,
    isDaylight,
    fallbackMode,
    songTitle,
    coverUrl,
    lyricsFontScale,
    cadenzaTuning,
    partitaTuning,
    fumeTuning,
    cappellaTuning,
    tiltTuning,
    cappellaCustomEmojiImages,
    onSaveComplex,
    onResetComplex,
    onBack,
}) => {
    const [draftComplex, setDraftComplex] = useState(complex);
    const previewCurrentTime = useMotionValue(0);
    const previewAudioPower = useMotionValue(0.24);
    const previewBass = useMotionValue(0.18);
    const previewLowMid = useMotionValue(0.15);
    const previewMid = useMotionValue(0.12);
    const previewVocal = useMotionValue(0.2);
    const previewTreble = useMotionValue(0.1);
    const previewElapsedRef = useRef(0);
    const [isPreviewPlaying, setIsPreviewPlaying] = useState(true);
    const [previewLineIndex, setPreviewLineIndex] = useState(() => (
        findPreviewPlaceholderLineIndex(VIS_PLAYGROUND_PREVIEW_LINES, 0)
    ));

    useEffect(() => {
        setDraftComplex(complex);
    }, [complex]);

    const previewAudioBands = useMemo<AudioBands>(() => ({
        bass: previewBass,
        lowMid: previewLowMid,
        mid: previewMid,
        vocal: previewVocal,
        treble: previewTreble,
    }), [previewBass, previewLowMid, previewMid, previewTreble, previewVocal]);

    useEffect(() => {
        if (!isPreviewPlaying) {
            return undefined;
        }

        let frameId = 0;
        const initialElapsed = previewElapsedRef.current || getPreviewPlaceholderStartOffset(fallbackMode, VIS_PLAYGROUND_PREVIEW_LOOP_DURATION);
        const startedAt = performance.now() - initialElapsed * 1000;
        const wave = (now: number, offset: number, speed: number, floor: number, amplitude: number) => (
            floor + (Math.sin(now * speed + offset) * 0.5 + 0.5) * amplitude
        );

        const tick = (now: number) => {
            const elapsed = ((now - startedAt) / 1000) % VIS_PLAYGROUND_PREVIEW_LOOP_DURATION;
            previewElapsedRef.current = elapsed;
            previewCurrentTime.set(elapsed);
            previewAudioPower.set(wave(now, 0.4, 0.0036, 0.16, 0.58));
            previewBass.set(wave(now, 1.1, 0.0026, 0.12, 0.55));
            previewLowMid.set(wave(now, 2.2, 0.0031, 0.1, 0.5));
            previewMid.set(wave(now, 3.1, 0.0042, 0.08, 0.48));
            previewVocal.set(wave(now, 4.0, 0.0038, 0.18, 0.62));
            previewTreble.set(wave(now, 5.4, 0.0051, 0.06, 0.44));
            frameId = window.requestAnimationFrame(tick);
        };

        frameId = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frameId);
    }, [
        fallbackMode,
        isPreviewPlaying,
        previewAudioPower,
        previewBass,
        previewCurrentTime,
        previewLowMid,
        previewMid,
        previewTreble,
        previewVocal,
    ]);

    useMotionValueEvent(previewCurrentTime, 'change', latest => {
        const nextIndex = findPreviewPlaceholderLineIndex(VIS_PLAYGROUND_PREVIEW_LINES, latest);
        setPreviewLineIndex(current => current === nextIndex ? current : nextIndex);
    });

    const previewLines = VIS_PLAYGROUND_PREVIEW_LINES;
    const preview = useMemo(() => (
        <VisualizerComplexRenderer
            complex={draftComplex}
            fallbackMode={fallbackMode}
            currentTime={previewCurrentTime}
            currentLineIndex={previewLineIndex}
            lines={previewLines}
            theme={theme}
            audioPower={previewAudioPower}
            audioBands={previewAudioBands}
            songTitle={songTitle ?? 'visEditor Preview'}
            coverUrl={coverUrl}
            showText
            staticMode={false}
            backgroundOpacity={1}
            transparentBackground={false}
            disableGeometricBackground={false}
            disableVignette={false}
            lyricsFontScale={lyricsFontScale}
            cadenzaTuning={cadenzaTuning}
            partitaTuning={partitaTuning}
            fumeTuning={fumeTuning}
            cappellaTuning={cappellaTuning}
            tiltTuning={tiltTuning}
            cappellaCustomEmojiImages={cappellaCustomEmojiImages}
            isPreviewMode
        />
    ), [
        cappellaCustomEmojiImages,
        cappellaTuning,
        cadenzaTuning,
        coverUrl,
        draftComplex,
        fallbackMode,
        fumeTuning,
        lyricsFontScale,
        partitaTuning,
        previewAudioBands,
        previewAudioPower,
        previewCurrentTime,
        previewLineIndex,
        previewLines,
        songTitle,
        theme,
        tiltTuning,
    ]);

    return (
        <VisEditor
            complex={draftComplex}
            theme={theme}
            isDaylight={isDaylight}
            preview={preview}
            isPreviewPlaying={isPreviewPlaying}
            onTogglePreviewPlayback={() => setIsPreviewPlaying(current => !current)}
            onChange={setDraftComplex}
            onSave={() => onSaveComplex(draftComplex)}
            onReset={() => {
                const next = createDefaultVisualizerComplex();
                setDraftComplex(next);
                onResetComplex();
            }}
            onBack={onBack}
        />
    );
};

export default VisEditorView;
