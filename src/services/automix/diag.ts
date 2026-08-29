// src/services/automix/diag.ts
// Forwards the automix session's own stage marks (armed, fading, settle, dropped) into the main-side
// runtime log, so the renderer's timeline sits beside the worker's rss/timing lines rather than only
// in the renderer console. Event-driven - a handful of lines per song change - and no-ops entirely
// off Electron (web build, tests). See electron/analysis/host.cjs for where these land.

const bridge = (): ((text: string) => void) | undefined =>
    (typeof window !== 'undefined' ? (window as unknown as { electron?: { diagMark?: (t: string) => void } }).electron?.diagMark : undefined);

/** Drop a one-line stage marker into the diag log. Never throws into playback. */
export const diagMark = (text: string): void => {
    try { bridge()?.(text); } catch { /* logging must never break a transition */ }
};
