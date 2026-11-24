// sources/netease/main/neteaseBackend.d.cts
// The types of neteaseBackend.cjs, for main/index.ts (sources/ compiles without allowJs).

/** The embedded API's status (what `status` and `restart` answer the client). */
export interface NeteaseBackendStatusRecord {
    status: string;
    port: number | null;
    error: string | null;
    offline?: boolean;
    updatedAt: number;
}

export interface NeteaseBackend {
    statusChannel: string;
    preload(): void;
    /** `needed`: a request needs it and it did not start for the network (it starts again only after a gap). */
    start(reason?: 'needed'): Promise<NeteaseBackendStatusRecord>;
    stop(): Promise<void>;
    getStatus(): NeteaseBackendStatusRecord;
    getPort(): number | null;
    getDiagnostics(): Promise<Record<string, unknown>>;
    selfCheckHosts: readonly string[];
}

export const NETEASE_SELF_CHECK_HOSTS: readonly string[];

export function createNeteaseBackend(options: {
    broadcast(channel: string, status: NeteaseBackendStatusRecord): void;
    logger?: Pick<Console, 'log' | 'info' | 'warn' | 'error'>;
    now?: () => number;
    onUnhandledRejection?: (reason: unknown) => void;
    onWorkerError?: (error: Error) => void;
    createWorker?: () => unknown;
    workerPath?: string;
    workerData?: unknown;
}): NeteaseBackend;
