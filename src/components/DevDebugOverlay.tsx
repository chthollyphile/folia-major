import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MotionValue, useMotionValueEvent } from 'framer-motion';

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
    activeLine: DevDebugLineSnapshot | null;
    nextLine: DevDebugLineSnapshot | null;
}

interface DevDebugOverlayProps {
    snapshot: DevDebugSnapshot;
    currentTime: MotionValue<number>;
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
            <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[10px]">
                <DebugRow label="words" value={line.wordCount === null ? 'N/A' : String(line.wordCount)} />
                <DebugRow label="start" value={formatSeconds(line.startTime)} />
                <DebugRow label="end" value={formatSeconds(line.endTime)} />
                <DebugRow label="renderEnd" value={formatSeconds(line.renderEndTime)} />
                <DebugRow label="raw" value={formatSeconds(line.rawDuration)} />
                <DebugRow label="timing" value={line.timingClass ?? 'N/A'} />
                <DebugRow label="transition" value={line.lineTransitionMode ?? 'N/A'} />
                <DebugRow label="reveal" value={line.wordRevealMode ?? 'N/A'} />
            </dl>
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
    isDaylight,
}) => {
    const [activeTab, setActiveTab] = useState<'memory' | 'playback' | 'lyrics'>('memory');
    const [liveCurrentTime, setLiveCurrentTime] = useState(() => currentTime.get());
    const [memoryHistory, setMemoryHistory] = useState<MemorySample[]>([]);
    const [gcCount, setGcCount] = useState(0);
    const [baselineUsedHeap, setBaselineUsedHeap] = useState<number | null>(null);
    const [baselineDomNodes, setBaselineDomNodes] = useState<number | null>(null);
    const previousUsedHeapRef = useRef<number | null>(null);

    useMotionValueEvent(currentTime, 'change', latest => {
        setLiveCurrentTime(latest);
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
        <aside className="pointer-events-none fixed top-4 right-4 z-[65] w-[min(34rem,calc(100vw-2rem))]">
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
                                    <DebugRow label="songSource" value={snapshot.songSource} />
                                    <DebugRow label="lyricsSource" value={snapshot.lyricsSource} />
                                    <DebugRow label="audioSrc" value={snapshot.audioSrcKind} />
                                    <DebugRow label="coverUrl" value={snapshot.coverUrlKind ?? 'N/A'} />
                                </dl>
                            </div>
                        </section>

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
                            currentTime={liveCurrentTime}
                            nextLineStartTime={snapshot.nextLine?.startTime ?? null}
                        />
                        <DebugLineBlock
                            label="Next Line"
                            line={snapshot.nextLine}
                            isDaylight={isDaylight}
                            currentTime={liveCurrentTime}
                            nextLineStartTime={null}
                        />
                    </div>
                )}
            </div>
        </aside>
    );
};

export default DevDebugOverlay;
