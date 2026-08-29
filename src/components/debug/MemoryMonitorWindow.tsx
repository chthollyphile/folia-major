import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import DraggableDebugWindow from '../shared/DraggableDebugWindow';
import {
    getMemoryHistory,
    subscribeToMemoryHistory,
    type MemoryPoint,
} from '../../services/debug/memorySamples';
import {
    getDebugModuleSnapshot,
    setDebugModuleState,
    subscribeToDebugModule,
} from '../../services/debug/debugModule';

// src/components/debug/MemoryMonitorWindow.tsx
// The memory curve, live. Reads the store; owns no timer and no sampling of its own.
//
// The split matters: the main process decides how often to sample and writes every sample to disk,
// and this window is one of possibly zero readers. Closing it stops nothing, and opening it shows
// the history that accumulated while it was shut - which is the whole reason the recording is a
// switch in Settings and the window is a shortcut.
//
// What the chart is FOR is judging a trend, so the series are the ones that separate the two kinds
// of growth this app actually suffers: the JS heap climbing means leaked objects; a flat heap under
// a climbing working set means native memory - decoded audio, WebAudio nodes, an ONNX session.

/**
 * Series are drawn back-to-front in this order; the first is the one the eye should land on.
 *
 * Two private figures rather than one, and they are not interchangeable. The whole-app total can
 * only be built where every process reports its own private memory, which is Windows and nowhere
 * else; the renderer's needs no summing, so it exists everywhere. Plotting one under the other's
 * name depending on the platform would make a single coloured line mean two different things, which
 * is the mistake the merge in memoryMonitor.cjs already refuses to make.
 */
const SERIES = [
    { key: 'totalWorkingSetMB', label: 'Working set', color: '#34d399' },
    { key: 'totalPrivateMB', label: 'Private (all)', color: '#60a5fa' },
    { key: 'rendererPrivateMB', label: 'Private (renderer)', color: '#fbbf24' },
    // The renderer's, not main's. Main's heap has never been where either kind of growth shows up.
    { key: 'rendererHeapUsedMB', label: 'JS heap', color: '#f0abfc' },
] as const;

type SeriesKey = typeof SERIES[number]['key'];

const CHART_WIDTH = 480;
const CHART_HEIGHT = 120;

/** A series as an SVG polyline, or null when this run has no numbers for it (see `privateMB`). */
const linePoints = (points: readonly MemoryPoint[], key: SeriesKey, max: number): string | null => {
    if (points.length < 2) return null;
    const values = points.map(point => point[key]);
    if (values.every(value => value === null)) return null;
    const step = CHART_WIDTH / (points.length - 1);
    return values
        .map((value, index) => (value === null
            ? null
            : `${(index * step).toFixed(1)},${(CHART_HEIGHT - (value / max) * CHART_HEIGHT).toFixed(1)}`))
        .filter(Boolean)
        .join(' ');
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-[0.16em] opacity-50">{label}</div>
        <div className="truncate text-[13px] tabular-nums">{value}</div>
    </div>
);

interface MemoryMonitorWindowProps {
    isDaylight: boolean;
    shortcutLabel: string;
    onClose: () => void;
}

const MemoryMonitorWindow: React.FC<MemoryMonitorWindowProps> = ({ isDaylight, shortcutLabel, onClose }) => {
    const { t } = useTranslation();
    const history = useSyncExternalStore(subscribeToMemoryHistory, getMemoryHistory);
    const debug = useSyncExternalStore(subscribeToDebugModule, getDebugModuleSnapshot);
    const [hidden, setHidden] = useState<ReadonlySet<SeriesKey>>(() => new Set());

    const shown = useMemo(() => SERIES.filter(series => !hidden.has(series.key)), [hidden]);

    /**
     * Which series this platform has no numbers for at all.
     *
     * A line that is simply not drawn is indistinguishable from one somebody switched off, and the
     * reader is then left deciding whether "no private memory curve" means a bug, a setting, or the
     * platform. Named in the legend, it stops being a question.
     */
    const unavailable = useMemo(() => new Set(SERIES
        .filter(series => history.points.length > 0 && history.points.every(point => point[series.key] === null))
        .map(series => series.key)), [history.points]);

    // The ceiling only ever comes from series that are DRAWN. Scaling to a hidden one leaves the
    // visible curve pressed flat against the floor for no reason the reader can see.
    const max = useMemo(() => {
        let peak = 0;
        for (const point of history.points) {
            for (const series of shown) {
                const value = point[series.key];
                if (value !== null && value > peak) peak = value;
            }
        }
        return Math.max(peak * 1.08, 1);
    }, [history.points, shown]);

    const latest = history.latest;
    const panelClass = isDaylight
        ? 'rounded-xl border border-black/10 bg-black/[0.04]'
        : 'rounded-xl border border-white/10 bg-black/15';

    return (
        <DraggableDebugWindow
            id="memory"
            title={t('options.memoryMonitor') || 'Memory monitor'}
            shortcutLabel={shortcutLabel}
            isDaylight={isDaylight}
            onClose={onClose}
            widthClass="w-[min(32rem,calc(100vw-2rem))]"
            defaultOffset={{ x: -32, y: 56 }}
        >
            <div className="grid gap-3">
                {!debug.memoryMonitorEnabled && (
                    <div className={`${panelClass} px-3 py-2 text-[11px] leading-relaxed opacity-80`}>
                        {t('options.memoryMonitorOffHint') || 'Recording is off, so nothing is being sampled or written.'}
                        {debug.available && (
                            <button
                                type="button"
                                onClick={() => void setDebugModuleState({ memoryMonitorEnabled: true })}
                                className="ml-2 underline underline-offset-2 opacity-90 hover:opacity-100"
                            >
                                {t('options.memoryMonitorStart') || 'Start recording'}
                            </button>
                        )}
                    </div>
                )}

                <section className={panelClass}>
                    <div className="grid grid-cols-4 gap-2 px-3 pt-3">
                        <Stat label={t('options.memoryCurrent') || 'Current'} value={latest ? `${latest.totalWorkingSetMB} MB` : '—'} />
                        <Stat label={t('options.memoryPeak') || 'Peak'} value={latest ? `${latest.peakMB} MB` : '—'} />
                        <Stat label={t('options.memoryFloor') || 'Floor'} value={latest ? `${latest.floorMB} MB` : '—'} />
                        <Stat label={t('options.memoryAverage') || 'Average'} value={latest ? `${latest.avgMB} MB` : '—'} />
                    </div>

                    <div className="px-3 pt-3">
                        <svg
                            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                            preserveAspectRatio="none"
                            className="h-28 w-full"
                            role="img"
                            aria-label={t('options.memoryMonitor') || 'Memory monitor'}
                        >
                            {[0.25, 0.5, 0.75].map(fraction => (
                                <line
                                    key={fraction}
                                    x1="0"
                                    x2={CHART_WIDTH}
                                    y1={CHART_HEIGHT * fraction}
                                    y2={CHART_HEIGHT * fraction}
                                    stroke="currentColor"
                                    strokeWidth="0.5"
                                    opacity="0.12"
                                />
                            ))}
                            {shown.map(series => {
                                const points = linePoints(history.points, series.key, max);
                                return points
                                    ? (
                                        <polyline
                                            key={series.key}
                                            points={points}
                                            fill="none"
                                            stroke={series.color}
                                            strokeWidth="1.5"
                                            // The viewBox is stretched horizontally, so a plain
                                            // stroke would be drawn as a wedge that thins with the
                                            // window. This keeps it one width at any size.
                                            vectorEffect="non-scaling-stroke"
                                            strokeLinejoin="round"
                                        />
                                    )
                                    : null;
                            })}
                        </svg>
                        <div className="flex items-center justify-between pt-1 text-[10px] opacity-55">
                            <span>{history.points.length ? new Date(history.points[0].at).toLocaleTimeString() : '—'}</span>
                            <span className="tabular-nums">{`0 – ${Math.round(max)} MB`}</span>
                            <span>{latest ? new Date(Date.parse(latest.at)).toLocaleTimeString() : '—'}</span>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2 px-3 py-3">
                        {SERIES.map(series => {
                            const isMissing = unavailable.has(series.key);
                            const isOn = !hidden.has(series.key) && !isMissing;
                            return (
                                <button
                                    key={series.key}
                                    type="button"
                                    disabled={isMissing}
                                    title={isMissing ? (t('options.memorySeriesUnavailable') || 'Not reported on this platform') : undefined}
                                    onClick={() => setHidden(previous => {
                                        const next = new Set(previous);
                                        if (isOn) next.add(series.key); else next.delete(series.key);
                                        return next;
                                    })}
                                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition-opacity ${isDaylight ? 'border-black/10' : 'border-white/10'} ${isOn ? '' : 'opacity-40'}`}
                                >
                                    <span
                                        className="h-1.5 w-3 rounded-full"
                                        style={{ backgroundColor: isMissing ? 'currentColor' : series.color, opacity: isMissing ? 0.25 : 1 }}
                                    />
                                    {series.label}
                                    {isMissing && <span className="opacity-60">·&nbsp;n/a</span>}
                                </button>
                            );
                        })}
                    </div>
                </section>

                <section className={panelClass}>
                    <div className="px-3 pt-3 text-[10px] uppercase tracking-[0.16em] opacity-60">
                        {t('options.memoryByProcess') || 'By process'}
                    </div>
                    <div className="px-3 pb-3 pt-2">
                        {latest?.processes.length
                            ? (
                                <table className="w-full text-[10px] tabular-nums">
                                    <thead className="opacity-50">
                                        <tr className="text-left">
                                            <th className="font-normal">process</th>
                                            <th className="font-normal text-right">ws</th>
                                            <th className="font-normal text-right">peak</th>
                                            <th className="font-normal text-right">priv</th>
                                            <th className="font-normal text-right">heap</th>
                                            <th className="font-normal text-right">cpu</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {latest.processes.map(row => (
                                            <tr key={row.pid}>
                                                <td className="truncate pr-2">{`${row.type} #${row.pid}`}</td>
                                                <td className="text-right">{`${row.workingSetMB}`}</td>
                                                <td className="text-right opacity-60">{`${row.peakWorkingSetMB}`}</td>
                                                <td className="text-right opacity-60">{row.privateMB === null ? '—' : row.privateMB}</td>
                                                {/* Only the processes that can be asked have one -
                                                    a dash here means unavailable, not zero. */}
                                                <td className="text-right opacity-60">{row.heapMB === null ? '—' : row.heapMB}</td>
                                                <td className="text-right opacity-60">{`${row.cpuPercent}%`}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )
                            : <div className="text-[11px] opacity-60">—</div>}
                    </div>
                </section>

                <div className="text-[10px] leading-relaxed opacity-45">
                    {latest && (
                        <div className="tabular-nums">
                            {`${latest.samples} samples · ${latest.uptimeSec}s · cpu ${latest.cpuPercent}%`}
                            {latest.systemFreeMB !== null && ` · system free ${latest.systemFreeMB} / ${latest.systemTotalMB} MB`}
                        </div>
                    )}
                    {debug.memoryFile && <div className="mt-1 break-all">{debug.memoryFile}</div>}
                </div>
            </div>
        </DraggableDebugWindow>
    );
};

export default MemoryMonitorWindow;
