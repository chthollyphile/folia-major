import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearMemoryHistory,
    getMemoryHistory,
    recordMemorySample,
    subscribeToMemoryHistory,
} from '@/services/debug/memorySamples';

// test/unit/services/debugMemorySamples.test.ts
// The live curve is the one part of the memory monitor that could itself leak, which would be a
// particular kind of embarrassing. Both of its bounds are checked here.

const sampleAt = (index: number, workingSetMB: number): DebugMemorySample => ({
    at: new Date(1_700_000_000_000 + index * 2000).toISOString(),
    uptimeSec: index * 2,
    totalWorkingSetMB: workingSetMB,
    totalPrivateMB: null,
    cpuPercent: 1,
    processCount: 1,
    peakMB: workingSetMB,
    floorMB: workingSetMB,
    avgMB: workingSetMB,
    samples: index + 1,
    mainHeapUsedMB: 40,
    mainHeapTotalMB: 60,
    rendererHeapUsedMB: 120,
    rendererPrivateMB: 640,
    systemFreeMB: 8000,
    systemTotalMB: 32000,
    processes: [
        { pid: 1, type: 'Browser', workingSetMB, peakWorkingSetMB: workingSetMB, privateMB: null, sharedMB: null, heapMB: null, blinkMB: null, cpuPercent: 1 },
    ],
});

describe('the memory history the monitor window draws', () => {
    beforeEach(() => { clearMemoryHistory(); });

    it('drops the oldest points instead of growing without end', () => {
        // A monitor left running all day must not become the memory problem it was opened to find.
        for (let index = 0; index < 900; index += 1) recordMemorySample(sampleAt(index, 100 + index));

        const { points } = getMemoryHistory();
        expect(points.length).toBe(600);
        // The window that survived is the RECENT one - a curve that stopped updating twenty minutes
        // ago would be worse than no curve.
        expect(points[points.length - 1].totalWorkingSetMB).toBe(999);
        expect(points[0].totalWorkingSetMB).toBe(400);
    });

    it('keeps a per-process breakdown for the latest sample only', () => {
        recordMemorySample(sampleAt(0, 500));
        recordMemorySample(sampleAt(1, 700));

        const history = getMemoryHistory();
        expect(history.latest?.totalWorkingSetMB).toBe(700);
        expect(history.latest?.processes).toHaveLength(1);
        // A row per process on every retained point would be most of what this store spends, and
        // "which process" is a question about now, not about twenty minutes ago. The file on disk
        // has all of it.
        expect(Object.keys(history.points[0])).toEqual([
            'at', 'totalWorkingSetMB', 'totalPrivateMB', 'rendererPrivateMB', 'rendererHeapUsedMB', 'cpuPercent',
        ]);
    });

    it('hands the chart a new array each time, so React sees the change', () => {
        recordMemorySample(sampleAt(0, 500));
        const before = getMemoryHistory().points;
        recordMemorySample(sampleAt(1, 600));

        // useSyncExternalStore compares snapshots by identity; a list mutated in place leaves the
        // chart rendering data it believes is current.
        expect(getMemoryHistory().points).not.toBe(before);
    });

    it('notifies subscribers, and stops once they leave', () => {
        let ticks = 0;
        const unsubscribe = subscribeToMemoryHistory(() => { ticks += 1; });
        recordMemorySample(sampleAt(0, 500));
        expect(ticks).toBe(1);

        unsubscribe();
        recordMemorySample(sampleAt(1, 600));
        expect(ticks).toBe(1);
    });
});
