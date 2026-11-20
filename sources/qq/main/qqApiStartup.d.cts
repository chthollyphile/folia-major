// sources/qq/main/qqApiStartup.d.cts
// The types of qqApiStartup.cjs, for main/index.ts (sources/ compiles without allowJs).

export const QQ_API_MODULE: '@yakult-green-tea/qq-music-api';

export function isModuleNotFound(error: unknown): boolean;

export function startQqApi(options: {
    port: number;
    stateFilePath?: string | null;
    authSessionRepository?: unknown;
    moduleId?: string;
    /** The package's exports; may answer a promise (a dynamic import from the deps archive). */
    loadModule?: (moduleId: string) => unknown;
    env?: Record<string, string | undefined>;
}): Promise<{ port: number; stateFilePath: string | null; server: unknown; close(): Promise<void> }>;
