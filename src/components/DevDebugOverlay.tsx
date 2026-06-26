import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MotionValue, useMotionValueEvent } from 'framer-motion';
import type { ThemeMode, DualTheme } from '../types';

export interface DevDebugLineSnapshot {
    text: string | null;
    translation: string | null;
    wordCount: number | null;
    startTime: number | null;
    endTime: number | null;
    renderEndTime: number | null;
    rawDuration: number | null;
    timingClass: string | null;
    lineTransitionMode: string | null;
    wordRevealMode: string | null;
}

interface DevDebugRawWordSnapshot {
    text: string;
    startTime: number;
    endTime: number;
}

interface DevDebugRawLineSnapshot {
    startTime: number;
    endTime: number;
    fullText: string;
    translation: string | null;
    isChorus: boolean;
    chorusEffect: string | null;
    renderHints: Record<string, unknown> | null;
    words: DevDebugRawWordSnapshot[];
}

export interface DevDebugSnapshot {
    shortcutLabel: string;
    songKey?: string | null;
    currentView: string;
    playerState: string;
    visualizerMode: string;
    songName: string | null;
    songSource: string;
    lyricsSource: string;
    audioSrcKind: string;
    coverUrlKind?: string;
    duration: number;
    currentLineIndex: number;
    totalLines: number;
    totalWords?: number;
    maxWordsPerLine?: number;
    nowPlaying?: {
        connectionStatus: string;
        isActive: boolean;
        paused: boolean;
        progressMs: number;
        progressQuality: 'precise' | 'coarse';
        trackTitle: string | null;
        durationSec: number;
        lastQuerySource: 'idle' | 'progress' | 'pause-boundary' | 'resume-boundary' | 'poll';
        lastQueryStatus: 'idle' | 'pending' | 'applied' | 'skipped' | 'failed';
        lastResponseProgressMs: number | null;
        lastResponseRttMs: number | null;
        lastCandidateTimeSec: number | null;
        lastDisplayTimeSec: number | null;
        lastDriftSec: number | null;
        lastError: string | null;
    } | null;
    activeLine: DevDebugLineSnapshot | null;
    nextLine: DevDebugLineSnapshot | null;
    rawActiveLine: DevDebugRawLineSnapshot | null;
    rawNextLine: DevDebugRawLineSnapshot | null;
    themeMode: ThemeMode;
    activeDualTheme: DualTheme;
}

interface DevDebugOverlayProps {
    snapshot: DevDebugSnapshot;
    currentTime: MotionValue<number>;
    lyricCurrentTime: MotionValue<number>;
    isDaylight: boolean;
}

interface BrowserHeapMemory {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
    memory?: BrowserHeapMemory;
}

interface MemorySample {
    timestamp: number;
    usedHeap: number;
    totalHeap: number;
    heapLimit: number;
    domNodes: number;
}

const MEMORY_SAMPLE_INTERVAL_MS = 1000;
const MEMORY_SAMPLE_LIMIT = 90;
const GC_DROP_THRESHOLD_BYTES = 8 * 1024 * 1024;

const formatSeconds = (value: number | null | undefined) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return 'N/A';
    }

    return `${value.toFixed(3)}s`;
};

const formatClock = (value: number) => {
    if (!Number.isFinite(value) || value < 0) {
        return '00:00';
    }

    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const formatBytes = (value: number | null | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return 'N/A';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    let nextValue = value;
    let unitIndex = 0;

    while (nextValue >= 1024 && unitIndex < units.length - 1) {
        nextValue /= 1024;
        unitIndex += 1;
    }

    const precision = unitIndex === 0 ? 0 : unitIndex === 1 ? 1 : 2;
    return `${nextValue.toFixed(precision)} ${units[unitIndex]}`;
};

const formatDelta = (value: number | null | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 'N/A';
    }

    if (value === 0) {
        return '0 B';
    }

    const sign = value > 0 ? '+' : '-';
    return `${sign}${formatBytes(Math.abs(value))}`;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const DebugRow: React.FC<{ label: string; value: string; }> = ({ label, value }) => {
    return (
        <>
            <dt className="text-[10px] uppercase tracking-[0.16em] opacity-60">{label}</dt>
            <dd className="text-[11px] font-medium text-right break-words">{value}</dd>
        </>
    );
};

const renderCellValue = (value: string, isDaylight: boolean) => {
    if (/^#[0-9a-fA-F]{3,8}$/.test(value.trim())) {
        return (
            <span className="inline-flex items-center gap-1.5">
                <span
                    className={`inline-block h-2.5 w-2.5 rounded-full border shrink-0 ${isDaylight ? 'border-black/15' : 'border-white/15'}`}
                    style={{ backgroundColor: value.trim() }}
                />
                <span>{value}</span>
            </span>
        );
    }
    return value;
};

const DebugMetricTable: React.FC<{
    title?: string;
    rows: Array<{ label: string; value: string; }>;
    isDaylight: boolean;
}> = ({ title, rows, isDaylight }) => {
    const cellClass = isDaylight
        ? 'border-black/10 bg-white/40'
        : 'border-white/10 bg-white/[0.03]';

    return (
        <div className={`overflow-hidden rounded-lg border text-[10px] ${isDaylight ? 'border-black/10' : 'border-white/10'}`}>
            {title ? (
                <div className={`border-b px-2 py-1 text-[9px] uppercase tracking-[0.14em] opacity-60 ${isDaylight ? 'border-black/10 bg-black/[0.03]' : 'border-white/10 bg-white/[0.02]'}`}>
                    {title}
                </div>
            ) : null}
            <table className="w-full border-collapse">
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={row.label}>
                            <th
                                className={`w-[4.75rem] border-b px-2 py-1 text-left font-medium uppercase tracking-[0.12em] opacity-65 ${cellClass} ${index === rows.length - 1 ? 'border-b-0' : ''}`}
                            >
                                {row.label}
                            </th>
                            <td
                                className={`border-b px-2 py-1 font-medium break-all ${cellClass} ${index === rows.length - 1 ? 'border-b-0' : ''}`}
                            >
                                {renderCellValue(row.value, isDaylight)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

interface LyricStatusPill {
    key: string;
    label: string;
    value?: string;
    tone: 'slate' | 'blue' | 'amber' | 'emerald' | 'rose';
}

const buildLyricStatusPills = (
    line: DevDebugLineSnapshot | null,
    currentTime: number,
    nextLineStartTime: number | null | undefined,
): LyricStatusPill[] => {
    if (!line) {
        return [];
    }

    const startTime = line.startTime;
    const endTime = line.endTime;
    const renderEndTime = line.renderEndTime;
    const hasCompleteTiming = [startTime, endTime, renderEndTime].every(value => typeof value === 'number' && Number.isFinite(value));

    if (!hasCompleteTiming) {
        return [
            { key: 'timing', label: 'Timing', value: 'N/A', tone: 'slate' },
        ];
    }

    const start = startTime as number;
    const end = endTime as number;
    const renderEnd = renderEndTime as number;
    const revealLag = renderEnd - end;

    const phase: LyricStatusPill = currentTime < start
        ? { key: 'phase', label: 'Phase', value: 'Before Start', tone: 'slate' }
        : currentTime < end
            ? { key: 'phase', label: 'Phase', value: 'Reveal Active', tone: 'blue' }
            : currentTime < renderEnd
                ? { key: 'phase', label: 'Phase', value: 'Past End / Hold', tone: 'amber' }
                : { key: 'phase', label: 'Phase', value: 'Past RenderEnd', tone: 'emerald' };

    const revealState: LyricStatusPill = currentTime < end
        ? { key: 'reveal', label: 'Reveal', value: 'Incomplete', tone: 'rose' }
        : { key: 'reveal', label: 'Reveal', value: 'Completed', tone: 'emerald' };

    const holdState: LyricStatusPill = renderEnd > end
        ? currentTime < end
            ? { key: 'hold', label: 'Render Hold', value: `+${(revealLag).toFixed(3)}s`, tone: 'amber' }
            : currentTime < renderEnd
                ? { key: 'hold', label: 'Render Hold', value: `${(renderEnd - currentTime).toFixed(3)}s left`, tone: 'amber' }
                : { key: 'hold', label: 'Render Hold', value: 'Consumed', tone: 'slate' }
        : { key: 'hold', label: 'Render Hold', value: 'None', tone: 'slate' };

    const cutoffState: LyricStatusPill = typeof nextLineStartTime === 'number' && Number.isFinite(nextLineStartTime)
        ? nextLineStartTime < renderEnd
            ? {
                key: 'cutoff',
                label: 'RenderEnd Cutoff',
                value: `${formatSeconds(renderEnd)} -> ${formatSeconds(nextLineStartTime)}`,
                tone: 'rose',
            }
            : {
                key: 'cutoff',
                label: 'RenderEnd Cutoff',
                value: `No (${formatSeconds(nextLineStartTime)} >= ${formatSeconds(renderEnd)})`,
                tone: 'emerald',
            }
        : {
            key: 'cutoff',
            label: 'RenderEnd Cutoff',
            value: 'N/A',
            tone: 'slate',
        };

    const currentMarker: LyricStatusPill = currentTime < end
        ? { key: 'marker', label: 'Current vs End', value: `${(end - currentTime).toFixed(3)}s left`, tone: 'blue' }
        : currentTime < renderEnd
            ? { key: 'marker', label: 'Current vs End', value: `+${(currentTime - end).toFixed(3)}s`, tone: 'amber' }
            : { key: 'marker', label: 'Current vs End', value: `+${(currentTime - end).toFixed(3)}s`, tone: 'slate' };

    return [phase, revealState, cutoffState, holdState, currentMarker];
};

const DebugStatusPill: React.FC<{ pill: LyricStatusPill; isDaylight: boolean; }> = ({ pill, isDaylight }) => {
    const toneClassMap = isDaylight
        ? {
            slate: 'bg-zinc-900/8 text-zinc-800',
            blue: 'bg-sky-500/18 text-sky-900',
            amber: 'bg-amber-500/20 text-amber-950',
            emerald: 'bg-emerald-500/18 text-emerald-900',
            rose: 'bg-rose-500/18 text-rose-900',
        }
        : {
            slate: 'bg-white/10 text-zinc-100',
            blue: 'bg-sky-400/20 text-sky-100',
            amber: 'bg-amber-400/20 text-amber-100',
            emerald: 'bg-emerald-400/20 text-emerald-100',
            rose: 'bg-rose-400/20 text-rose-100',
        };

    return (
        <div className={`rounded-full px-2.5 py-1 text-[10px] leading-tight ${toneClassMap[pill.tone]}`}>
            <span className="uppercase tracking-[0.14em] opacity-70">{pill.label}</span>
            {pill.value ? <span className="ml-1 font-semibold">{pill.value}</span> : null}
        </div>
    );
};

const DebugLineBlock: React.FC<{ label: string; line: DevDebugLineSnapshot | null; isDaylight: boolean; currentTime: number; nextLineStartTime?: number | null; }> = ({
    label,
    line,
    isDaylight,
    currentTime,
    nextLineStartTime,
}) => {
    const blockClass = isDaylight
        ? 'border-black/10 bg-black/[0.04]'
        : 'border-white/10 bg-black/15';
    const statusPills = buildLyricStatusPills(line, currentTime, nextLineStartTime);

    if (!line) {
        return (
            <section className={`rounded-xl border px-3 py-2 ${blockClass}`}>
                <div className="text-[10px] uppercase tracking-[0.16em] opacity-60">{label}</div>
                <div className="mt-1 text-[11px] font-medium">N/A</div>
            </section>
        );
    }

    return (
        <section className={`rounded-xl border px-3 py-2 ${blockClass}`}>
            <div className="text-[10px] uppercase tracking-[0.16em] opacity-60">{label}</div>
            {statusPills.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                    {statusPills.map(pill => (
                        <DebugStatusPill key={pill.key} pill={pill} isDaylight={isDaylight} />
                    ))}
                </div>
            ) : null}
            <div className="mt-1 text-[11px] font-medium whitespace-pre-wrap break-words">
                {line.text || 'N/A'}
            </div>
            {line.translation ? (
                <div className="mt-1 text-[10px] opacity-70 whitespace-pre-wrap break-words">
                    {line.translation}
                </div>
            ) : null}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <DebugMetricTable
                    title="Scale"
                    isDaylight={isDaylight}
                    rows={[
                        { label: 'words', value: line.wordCount === null ? 'N/A' : String(line.wordCount) },
                        { label: 'raw', value: formatSeconds(line.rawDuration) },
                    ]}
                />
                <DebugMetricTable
                    title="Window"
                    isDaylight={isDaylight}
                    rows={[
                        { label: 'start', value: formatSeconds(line.startTime) },
                        { label: 'end', value: formatSeconds(line.endTime) },
                        { label: 'renderEnd', value: formatSeconds(line.renderEndTime) },
                    ]}
                />
                <DebugMetricTable
                    title="Profile"
                    isDaylight={isDaylight}
                    rows={[
                        { label: 'timing', value: line.timingClass ?? 'N/A' },
                        { label: 'transition', value: line.lineTransitionMode ?? 'N/A' },
                    ]}
                />
                <DebugMetricTable
                    title="Reveal"
                    isDaylight={isDaylight}
                    rows={[
                        { label: 'mode', value: line.wordRevealMode ?? 'N/A' },
                    ]}
                />
            </div>
        </section>
    );
};

const RawLinePayloadBlock: React.FC<{
    label: string;
    line: DevDebugRawLineSnapshot | null;
    isDaylight: boolean;
}> = ({ label, line, isDaylight }) => {
    const blockClass = isDaylight
        ? 'border-black/10 bg-black/[0.04]'
        : 'border-white/10 bg-black/15';
    const codeClass = isDaylight
        ? 'border-black/10 bg-white/45 text-zinc-900'
        : 'border-white/10 bg-black/25 text-zinc-100';

    return (
        <section className={`rounded-xl border px-3 py-2 ${blockClass}`}>
            <div className="text-[10px] uppercase tracking-[0.16em] opacity-60">{label}</div>
            {line ? (
                <pre className={`mt-2 overflow-x-auto rounded-lg border px-2.5 py-2 text-[10px] leading-4 ${codeClass}`}>
                    {JSON.stringify(line, null, 2)}
                </pre>
            ) : (
                <div className="mt-1 text-[11px] font-medium">N/A</div>
            )}
        </section>
    );
};

const TabButton: React.FC<{
    label: string;
    isActive: boolean;
    onClick: () => void;
    isDaylight: boolean;
}> = ({ label, isActive, onClick, isDaylight }) => {
    const baseClass = isDaylight
        ? 'border-black/10 hover:bg-black/[0.05]'
        : 'border-white/10 hover:bg-white/[0.07]';
    const activeClass = isDaylight
        ? 'bg-black/[0.08] text-zinc-950'
        : 'bg-white/[0.12] text-white';

    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors ${baseClass} ${isActive ? activeClass : 'opacity-75'}`}
        >
            {label}
        </button>
    );
};

const DevDebugOverlay: React.FC<DevDebugOverlayProps> = ({
    snapshot,
    currentTime,
    lyricCurrentTime,
    isDaylight,
}) => {
    const [activeTab, setActiveTab] = useState<'memory' | 'playback' | 'lyrics' | 'theme'>('memory');
    const [liveCurrentTime, setLiveCurrentTime] = useState(() => currentTime.get());
    const [liveLyricCurrentTime, setLiveLyricCurrentTime] = useState(() => lyricCurrentTime?.get() ?? currentTime.get());
    const [memoryHistory, setMemoryHistory] = useState<MemorySample[]>([]);
    const [gcCount, setGcCount] = useState(0);
    const [baselineUsedHeap, setBaselineUsedHeap] = useState<number | null>(null);
    const [baselineDomNodes, setBaselineDomNodes] = useState<number | null>(null);
    const previousUsedHeapRef = useRef<number | null>(null);

    useMotionValueEvent(currentTime, 'change', latest => {
        setLiveCurrentTime(latest);
    });

    useMotionValueEvent(lyricCurrentTime, 'change', latest => {
        setLiveLyricCurrentTime(latest);
    });

    useEffect(() => {
        setMemoryHistory([]);
        setGcCount(0);
        setBaselineUsedHeap(null);
        setBaselineDomNodes(null);
        previousUsedHeapRef.current = null;
    }, [snapshot.songKey]);

    useEffect(() => {
        const perf = performance as PerformanceWithMemory;
        if (!perf.memory) {
            return;
        }

        const sample = () => {
            const memory = perf.memory;
            if (!memory) {
                return;
            }

            const domNodes = document.getElementsByTagName('*').length;
            const usedHeap = memory.usedJSHeapSize;

            setMemoryHistory(prev => {
                const next = [
                    ...prev,
                    {
                        timestamp: Date.now(),
                        usedHeap,
                        totalHeap: memory.totalJSHeapSize,
                        heapLimit: memory.jsHeapSizeLimit,
                        domNodes,
                    },
                ];

                if (next.length > MEMORY_SAMPLE_LIMIT) {
                    next.splice(0, next.length - MEMORY_SAMPLE_LIMIT);
                }

                return next;
            });

            setBaselineUsedHeap(prev => prev ?? usedHeap);
            setBaselineDomNodes(prev => prev ?? domNodes);

            if (
                previousUsedHeapRef.current !== null
                && previousUsedHeapRef.current - usedHeap >= GC_DROP_THRESHOLD_BYTES
            ) {
                setGcCount(prev => prev + 1);
            }

            previousUsedHeapRef.current = usedHeap;
        };

        sample();
        const timer = window.setInterval(sample, MEMORY_SAMPLE_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, []);

    const latestMemorySample = memoryHistory.length > 0 ? memoryHistory[memoryHistory.length - 1] : null;
    const memorySupported = Boolean((performance as PerformanceWithMemory).memory);

    const peakUsedHeap = useMemo(() => {
        if (!memoryHistory.length) {
            return null;
        }

        return memoryHistory.reduce((peak, sample) => Math.max(peak, sample.usedHeap), 0);
    }, [memoryHistory]);

    const recentDelta = useMemo(() => {
        if (memoryHistory.length < 2) {
            return null;
        }

        const referenceIndex = Math.max(0, memoryHistory.length - 16);
        return latestMemorySample
            ? latestMemorySample.usedHeap - memoryHistory[referenceIndex].usedHeap
            : null;
    }, [latestMemorySample, memoryHistory]);

    const domDelta = latestMemorySample && baselineDomNodes !== null
        ? latestMemorySample.domNodes - baselineDomNodes
        : null;
    const heapDelta = latestMemorySample && baselineUsedHeap !== null
        ? latestMemorySample.usedHeap - baselineUsedHeap
        : null;

    const chartRange = useMemo(() => {
        if (!memoryHistory.length) {
            return { min: 0, max: 1 };
        }

        const values = memoryHistory.map(sample => sample.usedHeap);
        const min = Math.min(...values);
        const max = Math.max(...values);
        return {
            min,
            max: Math.max(max, min + 1),
        };
    }, [memoryHistory]);

    const shellClass = isDaylight
        ? 'bg-white/76 text-zinc-900 border border-black/10 shadow-[0_18px_60px_rgba(0,0,0,0.14)]'
        : 'bg-black/58 text-white border border-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.32)]';
    const panelClass = isDaylight
        ? 'rounded-xl border border-black/10 bg-black/[0.04]'
        : 'rounded-xl border border-white/10 bg-black/15';
    const chartBarClass = isDaylight ? 'bg-emerald-600/75' : 'bg-emerald-400/80';

    return (
        <aside className="pointer-events-none fixed top-4 right-4 z-[55] w-[min(34rem,calc(100vw-2rem))]">
            <div
                className={`pointer-events-auto max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain rounded-2xl backdrop-blur-2xl px-4 py-3 font-mono ${shellClass}`}
            >
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="text-[10px] uppercase tracking-[0.24em] opacity-60">Dev Debug Overlay</div>
                        <div className="mt-1 text-sm font-semibold break-words">{snapshot.songName || 'No Track'}</div>
                    </div>
                    <div className="text-[10px] opacity-70 whitespace-nowrap">{snapshot.shortcutLabel}</div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                    <TabButton label="Memory" isActive={activeTab === 'memory'} onClick={() => setActiveTab('memory')} isDaylight={isDaylight} />
                    <TabButton label="Playback" isActive={activeTab === 'playback'} onClick={() => setActiveTab('playback')} isDaylight={isDaylight} />
                    <TabButton label="Lyrics" isActive={activeTab === 'lyrics'} onClick={() => setActiveTab('lyrics')} isDaylight={isDaylight} />
                    <TabButton label="Theme" isActive={activeTab === 'theme'} onClick={() => setActiveTab('theme')} isDaylight={isDaylight} />
                </div>

                {activeTab === 'memory' && (
                    <div className="mt-3 grid gap-3">
                        <section className={panelClass}>
                            <div className="px-3 pt-3 text-[10px] uppercase tracking-[0.16em] opacity-60">Heap Monitor</div>
                            {memorySupported && latestMemorySample ? (
                                <div className="px-3 pb-3">
                                    <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[10px]">
                                        <DebugRow label="usedHeap" value={formatBytes(latestMemorySample.usedHeap)} />
                                        <DebugRow label="totalHeap" value={formatBytes(latestMemorySample.totalHeap)} />
                                        <DebugRow label="heapLimit" value={formatBytes(latestMemorySample.heapLimit)} />
                                        <DebugRow label="sinceSong" value={formatDelta(heapDelta)} />
                                        <DebugRow label="last15s" value={formatDelta(recentDelta)} />
                                        <DebugRow label="peak" value={formatBytes(peakUsedHeap)} />
                                        <DebugRow label="domNodes" value={String(latestMemorySample.domNodes)} />
                                        <DebugRow label="domDelta" value={domDelta === null ? 'N/A' : `${domDelta >= 0 ? '+' : ''}${domDelta}` } />
                                        <DebugRow label="gcCount" value={String(gcCount)} />
                                        <DebugRow label="api" value="performance.memory" />
                                    </dl>

                                    <div className="mt-3">
                                        <div className="flex h-20 items-end gap-[2px]">
                                            {memoryHistory.map(sample => {
                                                const heightRatio = (sample.usedHeap - chartRange.min) / (chartRange.max - chartRange.min);
                                                return (
                                                    <div
                                                        key={sample.timestamp}
                                                        className={`min-w-0 flex-1 rounded-t-[2px] ${chartBarClass}`}
                                                        style={{ height: `${clamp(heightRatio, 0.08, 1) * 100}%` }}
                                                        title={`${new Date(sample.timestamp).toLocaleTimeString()} ${formatBytes(sample.usedHeap)}`}
                                                    />
                                                );
                                            })}
                                        </div>
                                        <div className="mt-2 flex items-center justify-between text-[10px] opacity-60">
                                            <span>{formatBytes(chartRange.min)}</span>
                                            <span>{memoryHistory.length}s window</span>
                                            <span>{formatBytes(chartRange.max)}</span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="px-3 pb-3 pt-2 text-[11px] opacity-70">
                                    `performance.memory` is not available in this runtime, so JS heap stats cannot be read here.
                                </div>
                            )}
                        </section>

                        <section className={panelClass}>
                            <div className="px-3 pt-3 text-[10px] uppercase tracking-[0.16em] opacity-60">Correlation</div>
                            <div className="px-3 pb-3">
                                <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[10px]">
                                    <DebugRow label="renderer" value={snapshot.visualizerMode} />
                                    <DebugRow label="coverUrl" value={snapshot.coverUrlKind ?? 'N/A'} />
                                    <DebugRow label="lineIndex" value={String(snapshot.currentLineIndex)} />
                                    <DebugRow label="lineCount" value={String(snapshot.totalLines)} />
                                    <DebugRow label="totalWords" value={String(snapshot.totalWords ?? 0)} />
                                    <DebugRow label="maxLineWords" value={String(snapshot.maxWordsPerLine ?? 0)} />
                                    <DebugRow
                                        label="activeWords"
                                        value={snapshot.activeLine?.wordCount === null || snapshot.activeLine?.wordCount === undefined ? 'N/A' : String(snapshot.activeLine.wordCount)}
                                    />
                                </dl>
                            </div>
                        </section>

                    </div>
                )}

                {activeTab === 'playback' && (
                    <div className="mt-3 grid gap-3">
                        <section className={panelClass}>
                            <div className="px-3 pt-3 text-[10px] uppercase tracking-[0.16em] opacity-60">Playback</div>
                            <div className="px-3 pb-3">
                                <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[10px]">
                                    <DebugRow label="view" value={snapshot.currentView} />
                                    <DebugRow label="player" value={snapshot.playerState} />
                                    <DebugRow label="renderer" value={snapshot.visualizerMode} />
                                    <DebugRow
                                        label="time"
                                        value={`${formatClock(liveCurrentTime)} / ${formatClock(snapshot.duration)} (${formatSeconds(liveCurrentTime)})`}
                                    />
                                    <DebugRow
                                        label="lyricTime"
                                        value={`${formatClock(liveLyricCurrentTime)} (${formatSeconds(liveLyricCurrentTime)})`}
                                    />
                                    <DebugRow label="songSource" value={snapshot.songSource} />
                                    <DebugRow label="lyricsSource" value={snapshot.lyricsSource} />
                                    <DebugRow label="audioSrc" value={snapshot.audioSrcKind} />
                                    <DebugRow label="coverUrl" value={snapshot.coverUrlKind ?? 'N/A'} />
                                </dl>
                            </div>
                        </section>

                        {snapshot.nowPlaying ? (
                            <section className={panelClass}>
                                <div className="px-3 pt-3 text-[10px] uppercase tracking-[0.16em] opacity-60">Now Playing Clock</div>
                                <div className="px-3 pb-3">
                                    <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[10px]">
                                        <DebugRow label="connection" value={snapshot.nowPlaying.connectionStatus} />
                                        <DebugRow label="active" value={snapshot.nowPlaying.isActive ? 'yes' : 'no'} />
                                        <DebugRow label="paused" value={snapshot.nowPlaying.paused ? 'yes' : 'no'} />
                                        <DebugRow label="wsProgress" value={`${snapshot.nowPlaying.progressMs}ms (${snapshot.nowPlaying.progressQuality})`} />
                                        <DebugRow label="lastQuery" value={`${snapshot.nowPlaying.lastQuerySource} / ${snapshot.nowPlaying.lastQueryStatus}`} />
                                        <DebugRow label="queryProgress" value={snapshot.nowPlaying.lastResponseProgressMs === null ? 'N/A' : `${snapshot.nowPlaying.lastResponseProgressMs}ms`} />
                                        <DebugRow label="rtt" value={snapshot.nowPlaying.lastResponseRttMs === null ? 'N/A' : `${snapshot.nowPlaying.lastResponseRttMs.toFixed(1)}ms`} />
                                        <DebugRow label="display" value={formatSeconds(snapshot.nowPlaying.lastDisplayTimeSec)} />
                                        <DebugRow label="candidate" value={formatSeconds(snapshot.nowPlaying.lastCandidateTimeSec)} />
                                        <DebugRow label="drift" value={formatSeconds(snapshot.nowPlaying.lastDriftSec)} />
                                        <DebugRow label="error" value={snapshot.nowPlaying.lastError ?? 'N/A'} />
                                    </dl>
                                </div>
                            </section>
                        ) : null}

                        <section className={panelClass}>
                            <div className="px-3 pt-3 text-[10px] uppercase tracking-[0.16em] opacity-60">Lyrics Scale</div>
                            <div className="px-3 pb-3">
                                <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[10px]">
                                    <DebugRow label="lineIndex" value={String(snapshot.currentLineIndex)} />
                                    <DebugRow label="lineCount" value={String(snapshot.totalLines)} />
                                    <DebugRow label="totalWords" value={String(snapshot.totalWords ?? 0)} />
                                    <DebugRow label="maxLineWords" value={String(snapshot.maxWordsPerLine ?? 0)} />
                                    <DebugRow
                                        label="activeWords"
                                        value={snapshot.activeLine?.wordCount === null || snapshot.activeLine?.wordCount === undefined ? 'N/A' : String(snapshot.activeLine.wordCount)}
                                    />
                                </dl>
                            </div>
                        </section>
                    </div>
                )}

                {activeTab === 'lyrics' && (
                    <div className="mt-3 grid gap-2">
                        <DebugLineBlock
                            label="Current Line"
                            line={snapshot.activeLine}
                            isDaylight={isDaylight}
                            currentTime={liveLyricCurrentTime}
                            nextLineStartTime={snapshot.nextLine?.startTime ?? null}
                        />
                        <DebugLineBlock
                            label="Next Line"
                            line={snapshot.nextLine}
                            isDaylight={isDaylight}
                            currentTime={liveLyricCurrentTime}
                            nextLineStartTime={null}
                        />
                        <RawLinePayloadBlock
                            label="Raw Current Line Payload"
                            line={snapshot.rawActiveLine}
                            isDaylight={isDaylight}
                        />
                        <RawLinePayloadBlock
                            label="Raw Next Line Payload"
                            line={snapshot.rawNextLine}
                            isDaylight={isDaylight}
                        />
                    </div>
                )}

                {activeTab === 'theme' && (
                    <div className="mt-3 grid gap-3">
                        <section className={panelClass}>
                            <div className="px-3 pt-3 text-[10px] uppercase tracking-[0.16em] opacity-60">Theme Status</div>
                            <div className="px-3 pb-3">
                                <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[10px]">
                                    <DebugRow label="Mode" value={snapshot.themeMode} />
                                    <DebugRow label="Daylight Mode" value={isDaylight ? 'Light' : 'Dark'} />
                                    <DebugRow label="Active Name" value={isDaylight ? snapshot.activeDualTheme.light.name : snapshot.activeDualTheme.dark.name} />
                                </dl>
                            </div>
                        </section>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <DebugMetricTable
                                title="Light Theme"
                                isDaylight={isDaylight}
                                rows={[
                                    { label: 'Name', value: snapshot.activeDualTheme.light.name },
                                    { label: 'BG', value: snapshot.activeDualTheme.light.backgroundColor },
                                    { label: 'Primary', value: snapshot.activeDualTheme.light.primaryColor },
                                    { label: 'Accent', value: snapshot.activeDualTheme.light.accentColor },
                                    { label: 'Secondary', value: snapshot.activeDualTheme.light.secondaryColor },
                                    { label: 'Font Style', value: snapshot.activeDualTheme.light.fontStyle },
                                    { label: 'Font Family', value: snapshot.activeDualTheme.light.fontFamily ?? 'N/A' },
                                    { label: 'Animation', value: snapshot.activeDualTheme.light.animationIntensity },
                                    { label: 'Word Colors', value: snapshot.activeDualTheme.light.wordColors?.map(wc => `${wc.word}: ${wc.color}`).join(', ') || '[]' },
                                    { label: 'Icons', value: snapshot.activeDualTheme.light.lyricsIcons?.join(', ') || '[]' },
                                    { label: 'Provider', value: snapshot.activeDualTheme.light.provider ?? 'N/A' },
                                    { label: 'Desc', value: snapshot.activeDualTheme.light.description ?? 'N/A' },
                                ]}
                            />
                            <DebugMetricTable
                                title="Dark Theme"
                                isDaylight={isDaylight}
                                rows={[
                                    { label: 'Name', value: snapshot.activeDualTheme.dark.name },
                                    { label: 'BG', value: snapshot.activeDualTheme.dark.backgroundColor },
                                    { label: 'Primary', value: snapshot.activeDualTheme.dark.primaryColor },
                                    { label: 'Accent', value: snapshot.activeDualTheme.dark.accentColor },
                                    { label: 'Secondary', value: snapshot.activeDualTheme.dark.secondaryColor },
                                    { label: 'Font Style', value: snapshot.activeDualTheme.dark.fontStyle },
                                    { label: 'Font Family', value: snapshot.activeDualTheme.dark.fontFamily ?? 'N/A' },
                                    { label: 'Animation', value: snapshot.activeDualTheme.dark.animationIntensity },
                                    { label: 'Word Colors', value: snapshot.activeDualTheme.dark.wordColors?.map(wc => `${wc.word}: ${wc.color}`).join(', ') || '[]' },
                                    { label: 'Icons', value: snapshot.activeDualTheme.dark.lyricsIcons?.join(', ') || '[]' },
                                    { label: 'Provider', value: snapshot.activeDualTheme.dark.provider ?? 'N/A' },
                                    { label: 'Desc', value: snapshot.activeDualTheme.dark.description ?? 'N/A' },
                                ]}
                            />
                        </div>
                    </div>
                )}
            </div>
            </aside>
    );
};

export default DevDebugOverlay;
