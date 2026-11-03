import React, { useEffect, useMemo, useRef, useState } from 'react';
import { WholeWord } from 'lucide-react';
import type { LyricData, StatusMessage, Theme } from '../../../types';
import type { LyricSegmentationRecord, LyricSegmentationSource } from '../../../types/lyricSegmentation';
import {
    SegmentationImportError,
    buildSegmentationExportText,
    countAppliedSegmentationLines,
    getLyricLineSegmentationKey,
    parseSegmentationImport,
} from '../../../utils/lyrics/lyricSegmentationRecord';
import {
    SEGMENTATION_BATCH_SIZE,
    buildLyricSegmentationPrompt,
    segmentLyricsWithAi,
    type SegmentationProgress,
} from '../../../services/lyricSegmentationAi';
import { copyText } from '../../../utils/system/clipboard';
import LyricSegmentationActionBar from './LyricSegmentationActionBar';
import { registerLyricSegmentationHandle } from './lyricSegmentationSurface';
import type { LyricSegmentationAction } from '../lyricSegmentationQuery';
import LyricSegmentationLineList from './LyricSegmentationLineList';

// src/components/command-palette/surfaces/LyricSegmentationSurfaceView.tsx
// The lyric segmentation editor. Two ways in — run the configured model, or paste a result back
// from one the user ran themselves — plus a reset to the default split (icu-folia, see
// utils/lyrics/icuFolia; plain Intl.Segmenter until its engines have loaded).
//
// Height is CSS-resolved throughout: the palette body is a fixed box and nothing here measures it.

type LyricSegmentationSurfaceViewProps = {
    isDaylight: boolean;
    theme: Theme;
    t: (key: string, fallback?: string) => string;
    lyrics: LyricData | null;
    setStatusMsg: React.Dispatch<React.SetStateAction<StatusMessage | null>>;
    record: LyricSegmentationRecord | null;
    isAiAvailable: boolean;
    onSave: (lines: Record<string, string[]>, source: LyricSegmentationSource) => Promise<void>;
    onReset: () => Promise<void>;
    /** The flag the user is part-way through typing, so the matching button can be highlighted. */
    pendingAction?: LyricSegmentationAction | null;
    refocusInput?: () => void;
};

/** Lines the model is asked about. Blank lines are skipped so they cannot shift the row mapping. */
const readSegmentableLines = (lyrics: LyricData) => lyrics.lines.filter(line => Boolean(line.fullText));

const LyricSegmentationSurfaceView: React.FC<LyricSegmentationSurfaceViewProps> = ({
    isDaylight,
    theme,
    t,
    lyrics,
    setStatusMsg,
    record,
    isAiAvailable,
    onSave,
    onReset,
    pendingAction,
}) => {
    const [isRunningAi, setIsRunningAi] = useState(false);
    const [progress, setProgress] = useState<SegmentationProgress | null>(null);
    // The batch counter only moves when a batch comes back. A song short enough to fit one batch
    // would therefore sit on "0 / 12" for the whole run and read as frozen, so the elapsed second
    // count is what actually shows the request is alive.
    const [elapsedSec, setElapsedSec] = useState(0);
    // Batches run in sequence, so leaving the surface has to stop the ones not sent yet.
    const abortRef = useRef<AbortController | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // An in-flight request must not write a record after the surface is gone or the song changed.
    //
    // The setup line is load-bearing, not decoration. The app renders under React.StrictMode
    // (src/bootstrap.tsx), so in dev every effect runs mount → cleanup → mount on the same
    // instance. Without re-arming here the cleanup's `false` stuck for the component's whole life,
    // which silently disabled every guard below: progress never advanced, the result was never
    // saved, and `finally` never cleared the spinner.
    const isMountedRef = useRef(true);
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            abortRef.current?.abort();
        };
    }, []);

    useEffect(() => {
        if (!isRunningAi) {
            return;
        }
        const timer = window.setInterval(() => setElapsedSec(seconds => seconds + 1), 1000);
        return () => window.clearInterval(timer);
    }, [isRunningAi]);

    const segmentableLines = useMemo(() => (lyrics ? readSegmentableLines(lyrics) : []), [lyrics]);
    const appliedCount = countAppliedSegmentationLines(lyrics, record);

    const copy = async (text: string, successKey: string, fallback: string) => {
        try {
            await copyText(text);
            setStatusMsg({ type: 'success', text: t(successKey, fallback) });
        } catch {
            setError(t('lyricSegmentation.copyFailed', 'Could not write to the clipboard'));
        }
    };

    const runAi = async () => {
        if (!lyrics || segmentableLines.length === 0) return;
        const controller = new AbortController();
        abortRef.current = controller;
        setError(null);
        setProgress({ done: 0, total: segmentableLines.length });
        setElapsedSec(0);
        setIsRunningAi(true);
        try {
            const texts = segmentableLines.map(line => line.fullText);
            const { boundaries, failures } = await segmentLyricsWithAi(texts, {
                signal: controller.signal,
                onProgress: next => { if (isMountedRef.current) setProgress(next); },
            });
            // The batch in flight when Cancel was pressed still resolves — an ipcRenderer.invoke
            // cannot be called off — so its result is dropped here rather than saved.
            if (!isMountedRef.current || controller.signal.aborted) return;

            const lines: Record<string, string[]> = {};
            segmentableLines.forEach((line, index) => {
                const row = boundaries[index];
                // A null row is a batch that failed; that line stays on the default split rather
                // than being written with a guess.
                if (row) {
                    lines[getLyricLineSegmentationKey(line)] = row;
                }
            });
            await onSave(lines, 'ai');
            if (!isMountedRef.current) return;

            // Two different partial outcomes, both non-fatal: a whole batch that errored, and
            // individual lines the model mangled. Either way those lines keep the default split,
            // so say how many rather than presenting it as a success or a failure.
            const skipped = segmentableLines.length - Object.keys(lines).length;
            if (failures.length > 0) {
                setError(t('lyricSegmentation.partialFailure', '{{count}} batches failed')
                    .replace('{{count}}', String(failures.length)) + ` — ${failures[0]}`);
            } else if (skipped > 0) {
                setError(t('lyricSegmentation.skippedLines', '{{count}} lines kept the default split')
                    .replace('{{count}}', String(skipped)));
            }
        } catch (aiError) {
            if (!isMountedRef.current || (aiError instanceof DOMException && aiError.name === 'AbortError')) return;
            setError(aiError instanceof Error ? aiError.message : String(aiError));
        } finally {
            if (isMountedRef.current) {
                setIsRunningAi(false);
                setProgress(null);
            }
            abortRef.current = null;
        }
    };

    const cancelAi = () => {
        abortRef.current?.abort();
        setIsRunningAi(false);
        setProgress(null);
    };

    // Elapsed seconds always; the line counter only once there is more than one batch to count.
    const aiRunningLabel = (() => {
        const elapsed = `${elapsedSec}s`;
        return progress && progress.total > SEGMENTATION_BATCH_SIZE
            ? `${t('lyricSegmentation.cancel', 'Cancel')} · ${progress.done}/${progress.total} · ${elapsed}`
            : `${t('lyricSegmentation.cancel', 'Cancel')} · ${elapsed}`;
    })();

    const runImport = async (text: string) => {
        if (!lyrics) return;
        setError(null);
        setIsImporting(true);
        try {
            const { lines } = parseSegmentationImport(text, lyrics);
            await onSave(lines, 'manual');
        } catch (importError) {
            if (!isMountedRef.current) return;
            setError(importError instanceof SegmentationImportError
                ? t(
                    `lyricSegmentation.importError.${importError.message}`,
                    importError.row ? `Line ${importError.row} does not match the lyrics` : 'Could not read that segmentation',
                ).replace('{{row}}', String(importError.row ?? ''))
                : String(importError));
        } finally {
            if (isMountedRef.current) setIsImporting(false);
        }
    };

    // One implementation behind both the buttons here and the palette input's flags/paste. Kept in
    // a ref-free effect so a re-render never leaves a stale closure registered.
    const copyPrompt = () => copy(
        buildLyricSegmentationPrompt(segmentableLines.map(line => line.fullText)),
        'lyricSegmentation.promptCopied',
        'Prompt and lyrics copied',
    );
    const copySegmentation = () => (lyrics ? copy(
        buildSegmentationExportText(lyrics),
        'lyricSegmentation.currentCopied',
        'Current segmentation copied',
    ) : undefined);

    const handleRef = useRef({ runAi, copyPrompt, copySegmentation, importText: runImport });
    handleRef.current = { runAi, copyPrompt, copySegmentation, importText: runImport };
    const hasSegmentableLyrics = segmentableLines.length > 0;
    useEffect(() => {
        // Before lyrics arrive, leave paste events to the input so their content is not swallowed.
        if (!hasSegmentableLyrics) return;
        return registerLyricSegmentationHandle({
            runAi: () => handleRef.current.runAi(),
            copyPrompt: () => { void handleRef.current.copyPrompt(); },
            copySegmentation: () => { void handleRef.current.copySegmentation(); },
            importText: (text: string) => { void handleRef.current.importText(text); },
        });
    }, [hasSegmentableLyrics]);

    // All hooks also run in the empty state: lyrics can arrive after this surface mounts.
    if (!lyrics || segmentableLines.length === 0) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 opacity-50">
                <WholeWord size={26} />
                <div className="text-sm">{t('lyricSegmentation.noLyrics', 'No lyrics to segment')}</div>
            </div>
        );
    }

    const statusText = record
        ? `${t(
            record.source === 'ai' ? 'lyricSegmentation.sourceAi' : 'lyricSegmentation.sourceManual',
            record.source === 'ai' ? 'AI' : 'Manual',
        )} · ${t('lyricSegmentation.appliedCount', '{{count}} lines').replace('{{count}}', String(appliedCount))}`
        : t('lyricSegmentation.statusDefault', 'Default segmentation');

    return (
        <div className="flex h-full min-h-0 flex-col gap-2">
            <LyricSegmentationActionBar
                isDaylight={isDaylight}
                t={t}
                statusText={statusText}
                isAiAvailable={isAiAvailable}
                isRunningAi={isRunningAi}
                aiRunningLabel={aiRunningLabel}
                isImporting={isImporting}
                hasRecord={Boolean(record)}
                pendingAction={pendingAction ?? null}
                onRunAi={runAi}
                onCancelAi={cancelAi}
                onCopyPrompt={copyPrompt}
                onCopyCurrent={() => { void copySegmentation(); }}
                onReset={() => { setError(null); void onReset(); }}
            />

            {error && (
                <div role="alert" className="shrink-0 rounded-lg bg-red-500/15 px-2 py-1.5 text-[11px] text-red-400">{error}</div>
            )}

            {/* The one scroll region. Its height comes from flex against the palette's fixed body,
                so nothing here has to be measured. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
                <LyricSegmentationLineList
                    isDaylight={isDaylight}
                    accentColor={theme.accentColor}
                    lyrics={lyrics}
                    record={record}
                />
            </div>
        </div>
    );
};

export default LyricSegmentationSurfaceView;
