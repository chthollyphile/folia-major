// sources/qq/main/qqApiStartup.d.cts
// The types of qqApiStartup.cjs, for main/index.ts (sources/ compiles without allowJs).

export const QQ_API_MODULE: '@yakult-green-tea/qq-music-api';

export function isModuleNotFound(error: unknown): boolean;
/** Runs `run` once the previous start's environment window has ended, or `waitMs` (30 s by default) has passed. */
export function inEnvWindow<T>(run: () => T | Promise<T>, waitMs?: number): Promise<T>;

export function startQqApi(options: {
    port: number;
    stateFilePath?: string | null;
    authSessionRepository?: unknown;
    moduleId?: string;
    /** The package's exports; may answer a promise (a dynamic import from the deps archive). */
    loadModule?: (moduleId: string) => unknown;
    env?: Record<string, string | undefined>;
}): Promise<{ port: number; stateFilePath: string | null; server: unknown; close(): Promise<void> }>;
