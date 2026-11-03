import { hasVisualizerMode } from '@/components/visualizer/registry';
import { getFoliumClientStart, onFoliumClientStarted } from '../runtime/clientLoader';

// src/mods/export/exportStart.ts
// What stops an export before its first frame.
//
// The export window starts the mods' clients itself. The loader moves on from
// a mod that runs past its start limit, but it does not stop that start. So
// when the lyric style the export was asked for belongs to a mod that is still
// starting, the export waits for that start to end, however long it takes (the
// user can cancel the export). Only then is it judged: if the style is still
// not registered (the start threw, the mod is not there, or it never
// registered that style), the page would fall back to a builtin style and
// export the wrong video without a word. That case is an error the export
// stops on.

/** The error code for an export that cannot draw `mode` as things are now, or null when it can. */
export const exportModeProblem = (mode: string): string | null => (
    mode.startsWith('mod:') && !hasVisualizerMode(mode) ? 'export-mod-style-not-started' : null
);

/* Resolves once the start of this mod's client is no longer going: at once when it is not. */
const startEnded = (modId: string) => new Promise<void>((resolve) => {
    if (getFoliumClientStart(modId)?.state !== 'starting') {
        resolve();
        return;
    }
    const stop = onFoliumClientStarted((started) => {
        if (started !== modId) return;
        stop();
        resolve();
    });
});

/**
 * The same answer as `exportModeProblem`, given once it is final: a style of a mod that is still
 * starting is waited for until that start has ended.
 */
export const waitForExportMode = async (mode: string): Promise<string | null> => {
    if (exportModeProblem(mode) === null) return null;
    // `mod:<modid>:<name>`
    await startEnded(mode.split(':')[1] ?? '');
    return exportModeProblem(mode);
};
