// electron/debug/memoryMonitor.cjs
// Turns one reading of Electron's process metrics into one sample, and keeps the running peak /
// floor / mean across a session. No timers, no disk, no `require('electron')` - everything comes in
// as an argument, which is what makes it testable and what keeps the sampling policy in one place
// (debugHost) instead of spread across the thing being measured.
//
// Two things this deliberately does NOT do, both learned the hard way on the automix memory work:
//
// - It never sums the per-process `peakWorkingSetSize`. Those are each process's own high-water
//   mark, reached at different moments; added together they describe a state the machine was never
//   in. The headline peak here is the peak of the SIMULTANEOUS total, observed by this monitor.
// - It never reports commit as though it were occupancy. Commit is address space reserved from the
//   system; the working set is what is actually resident. A run that quotes the first as "memory
//   used" overstates itself by a factor that has already cost an afternoon once.

/** Kilobytes - Electron's unit for every size in `getAppMetrics` - to whole megabytes. */
const mb = (kb) => Math.round((kb || 0) / 1024);
/** Same, keeping one decimal, for figures small enough that rounding to a megabyte loses them. */
const mb1 = (kb) => Math.round(((kb || 0) / 1024) * 10) / 10;

/**
 * A process metric row, reduced to the fields worth logging.
 *
 * `privateBytes` is Windows-only in Chromium - guarded `#if IS_WIN` at the source - and simply
 * absent elsewhere, so it is carried as null rather than zero: a real zero and "this platform does
 * not report it" must not read the same in a log somebody reasons about months from now. Where a
 * process can answer for itself, `merge` fills the gap on every platform.
 */
const readProcess = (metric) => {
    const memory = metric.memory || {};
    const who = metric.serviceName || metric.name || '';
    return {
        pid: metric.pid,
        type: metric.type + (who ? `/${who}` : ''),
        workingSetMB: mb(memory.workingSetSize),
        // The OS's own high-water mark for THIS process, which is a different question from the
        // session peak below and is why it is not summed anywhere.
        peakWorkingSetMB: mb(memory.peakWorkingSetSize),
        privateMB: typeof memory.privateBytes === 'number' ? mb(memory.privateBytes) : null,
        sharedMB: null,
        /** V8 heap of this process, where it has one and volunteered it. */
        heapMB: null,
        /** Blink's own allocations - DOM, CSS, images. Renderer processes only. */
        blinkMB: null,
        cpuPercent: Math.round(((metric.cpu && metric.cpu.percentCPUUsage) || 0) * 10) / 10,
    };
};

/**
 * Folds a process's report about itself into its row in the metrics table.
 *
 * The metrics table sees every process but is missing `privateBytes` off Windows and has never had
 * a heap figure at all. A process asked directly has both, on every platform - it just cannot be
 * asked about anyone else. So the two are merged by pid: the table supplies coverage, the reports
 * supply depth, and the GPU and utility processes - which nothing can ask - keep their nulls.
 *
 * The reports arrive a tick late by construction (see installMemorySampleFeed), which on a curve
 * sampled every couple of seconds is not visible and is not worth a round of plumbing to avoid.
 */
const merge = (row, report) => {
    if (!report) return row;
    if (row.privateMB === null && typeof report.privateKB === 'number') row.privateMB = mb(report.privateKB);
    if (typeof report.sharedKB === 'number') row.sharedMB = mb(report.sharedKB);
    if (typeof report.heapUsedKB === 'number') row.heapMB = mb1(report.heapUsedKB);
    if (typeof report.blinkAllocatedKB === 'number') row.blinkMB = mb1(report.blinkAllocatedKB);
    return row;
};

/**
 * One field off the largest renderer process, or null if no renderer reported it.
 *
 * Largest rather than first because a session can have several renderers - the remote control
 * window, an OBS browser source - and the one that answers the question is the player.
 */
const fromRenderer = (processes, field) => processes.reduce((best, row) => (
    row.type.startsWith('Tab') && row[field] !== null ? Math.max(best ?? 0, row[field]) : best
), null);

const createMemoryMonitor = () => {
    let startedAt = Date.now();
    let count = 0;
    let sum = 0;
    let peak = 0;
    let floor = null;

    const reset = () => {
        startedAt = Date.now();
        count = 0;
        sum = 0;
        peak = 0;
        floor = null;
    };

    /**
     * @param metrics `app.getAppMetrics()`.
     * @param system  `process.getSystemMemoryInfo()`, or null where it throws.
     * @param heap    `process.getHeapStatistics()` for the main process, or null.
     * @param reports what individual processes said about themselves, keyed by pid. See `merge`.
     */
    const sample = ({ at = Date.now(), metrics = [], system = null, heap = null, reports = new Map() } = {}) => {
        // Biggest first, so the process worth asking about is the first one on the line - the same
        // ordering the automix diagnosis relied on to name the 2.6GB process without Task Manager.
        const processes = metrics
            .map(metric => merge(readProcess(metric), reports.get(metric.pid)))
            .sort((a, b) => b.workingSetMB - a.workingSetMB);
        const totalWorkingSetMB = processes.reduce((total, row) => total + row.workingSetMB, 0);
        // All or nothing. A sum over only the processes that answered would be labelled "total" and
        // read as one, while being short by however many did not - the kind of half-number that
        // gets quoted in a conclusion months later.
        const totalPrivateMB = processes.length && processes.every(row => row.privateMB !== null)
            ? processes.reduce((total, row) => total + row.privateMB, 0)
            : null;

        count += 1;
        sum += totalWorkingSetMB;
        peak = Math.max(peak, totalWorkingSetMB);
        floor = floor === null ? totalWorkingSetMB : Math.min(floor, totalWorkingSetMB);

        return {
            at: new Date(at).toISOString(),
            uptimeSec: Math.round((at - startedAt) / 100) / 10,
            totalWorkingSetMB,
            totalPrivateMB,
            cpuPercent: Math.round(processes.reduce((total, row) => total + row.cpuPercent, 0) * 10) / 10,
            processCount: processes.length,
            // Session figures, over the simultaneous total. See the header for why these are not
            // the sum of the per-process peaks.
            peakMB: peak,
            floorMB: floor,
            avgMB: Math.round(sum / count),
            samples: count,
            mainHeapUsedMB: heap ? mb1(heap.usedHeapSize) : null,
            mainHeapTotalMB: heap ? mb1(heap.totalHeapSize) : null,
            // The renderer's heap, not main's, is the one that separates the two kinds of growth
            // this app suffers: a climbing heap means leaked JS objects, while a flat heap under a
            // climbing working set means native memory - decoded audio, WebAudio nodes, an ONNX
            // session. Main's heap has never been where either shows up.
            rendererHeapUsedMB: fromRenderer(processes, 'heapMB'),
            // One process's private memory, which is a figure that needs no summing and therefore
            // survives the platforms where `totalPrivateMB` cannot exist. It is also the one worth
            // watching: the renderer is the largest process in this app - at the automix peak it
            // was 1222MB against htdemucs's 483MB - and the one where a leak would accumulate.
            rendererPrivateMB: fromRenderer(processes, 'privateMB'),
            systemFreeMB: system ? mb(system.free) : null,
            systemTotalMB: system ? mb(system.total) : null,
            processes,
        };
    };

    return { sample, reset, getStartedAt: () => startedAt };
};

module.exports = { createMemoryMonitor, readProcess };
