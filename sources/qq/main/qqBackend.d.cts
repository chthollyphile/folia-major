// sources/qq/main/qqBackend.d.cts
// The types of qqBackend.cjs, for main/index.ts (sources/ compiles without allowJs).
import type { QqAuthSessionRepository } from './qqAuthSessionRepository.cjs';

/** The embedded backend's status (what `status` answers the client). */
export interface QqBackendStatusRecord {
    status: string;
    port: number | null;
    error: string | null;
    updatedAt: number;
    sessionStoreUnreadable?: boolean;
}

export interface QqBackend {
    statusChannel: string;
    start(): Promise<void>;
    stop(): Promise<void>;
    getStatus(): QqBackendStatusRecord;
    getPort(): number | null;
    getDiagnostics(): Record<string, unknown>;
    selfCheckHosts: readonly string[];
}

export const QQ_SELF_CHECK_HOSTS: readonly string[];

export function createQqBackend(options: {
    broadcast(channel: string, status: QqBackendStatusRecord): void;
    networkRecorder?: { snapshot(providerId: string): unknown[] } | null;
    getStateFilePath?: () => string | null;
    authSessionRepository?: QqAuthSessionRepository;
    logger?: Pick<Console, 'info' | 'warn' | 'error'>;
    now?: () => number;
    resolvePackageRoot?: () => string;
    startServer?: (options: Record<string, unknown>) => Promise<{ close(): Promise<void> }>;
    loadFile?: (file: string) => any;
}): QqBackend;
