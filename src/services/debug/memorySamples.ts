// src/services/debug/memorySamples.ts
// The memory curve the monitor window draws, kept in the renderer.
//
// Bounded twice over, because a monitor that leaks is a joke at its own expense:
//
// - Only `HISTORY` points are retained, oldest dropped. At the default two-second sampling that is
//   twenty minutes of curve, which is longer than any question this answers.
// - Only the numbers the chart plots are retained. A full sample carries a row per process, and
//   keeping those for every point would be most of the memory this thing spends. The per-process
//   breakdown is a snapshot question, so only the latest sample keeps one.
//
// The file on disk has all of it. This is the live view, not the record.

/** One plotted point. Whole megabytes; the source is electron/debug/memoryMonitor.cjs. */
export interface MemoryPoint {
    at: number;
    totalWorkingSetMB: number;
    totalPrivateMB: number | null;
    rendererPrivateMB: number | null;
    rendererHeapUsedMB: number | null;
    cpuPercent: number;
}

export interface MemoryHistory {
    points: readonly MemoryPoint[];
    /** The whole most recent sample, per-process rows included, or null before the first one. */
    latest: DebugMemorySample | null;
}

const HISTORY = 600;
const EMPTY: MemoryHistory = { points: [], latest: null };

let history: MemoryHistory = EMPTY;
const listeners = new Set<() => void>();

export const getMemoryHistory = () => history;

export const subscribeToMemoryHistory = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export const clearMemoryHistory = () => {
    history = EMPTY;
    listeners.forEach(listener => listener());
};

/** Exported for the test; the app feeds this from the main process - see `installMemorySampleFeed`. */
export const recordMemorySample = (sample: DebugMemorySample) => {
    const point: MemoryPoint = {
        at: Date.parse(sample.at) || Date.now(),
        totalWorkingSetMB: sample.totalWorkingSetMB,
        totalPrivateMB: sample.totalPrivateMB,
        rendererPrivateMB: sample.rendererPrivateMB,
        rendererHeapUsedMB: sample.rendererHeapUsedMB,
        cpuPercent: sample.cpuPercent,
    };
    // A new array rather than a push: useSyncExternalStore compares by identity, and a list mutated
    // in place leaves the chart rendering data it believes is current.
    const points = history.points.concat(point);
    history = {
        points: points.length > HISTORY ? points.slice(points.length - HISTORY) : points,
        latest: sample,
    };
    listeners.forEach(listener => listener());
};

/**
 * Tells the main process what this process knows about itself, which is more than the metrics
 * table can see from outside.
 *
 * `app.getAppMetrics()` reports `privateBytes` on Windows only, and has never reported a JS heap at
 * all. Asked directly, a renderer has both on every platform - and this renderer is the biggest
 * process in the app, so it is the one where the gap mattered.
 *
 * Sent in reply to a sample rather than on a timer of its own: the sampling rate is the main
 * process's to decide and this way there is nothing to keep in step. The figures land in the NEXT
 * sample, which on a curve this slow is not visible.
 */
const reportSelf = async () => {
    const bridge = window.electron;
    if (!bridge?.debugRendererMemory || !bridge.debugReportRendererMemory) return;
    try {
        const report = await bridge.debugRendererMemory();
        if (!report) return;
        // Read here rather than in the preload: `performance.memory` is per-context, and the
        // context worth measuring is the one the app actually runs in.
        const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        bridge.debugReportRendererMemory({
            ...report,
            heapUsedKB: heap ? Math.round(heap.usedJSHeapSize / 1024) : undefined,
        });
    } catch {
        // The window is going away, or the runtime has no such API. Its row keeps its nulls.
    }
};

let stop: (() => void) | null = null;

/**
 * Subscribes to the main process's samples. Idempotent; a no-op in the browser build.
 *
 * The subscription outlives the window that draws it, on purpose: closing the monitor window must
 * not stop the recording - that is what the switch in Settings is for. The cost of staying
 * subscribed while nothing is watching is one bounded array that the monitor stops filling the
 * moment the switch goes off.
 */
export const installMemorySampleFeed = () => {
    if (stop || typeof window === 'undefined') return;
    stop = window.electron?.onDebugMemorySample?.(sample => {
        recordMemorySample(sample);
        void reportSelf();
    }) ?? null;
};
