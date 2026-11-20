// sources/appleMusic/main/companionClient.d.cts
// The types of companionClient.cjs, for main/index.ts (sources/ compiles without allowJs).

/** What the companion answers one request with: its data, or the word for why it failed. */
export type CompanionResult =
    | { ok: true; data?: unknown }
    | { ok: false; error: string; httpStatus?: number | null; playbackStage?: string };

export interface CompanionClient {
    /** One validated operation on the companion (started on the first request); never throws. */
    request(operation: string, params?: Record<string, unknown>): Promise<CompanionResult>;
    /** Pauses the player when the companion runs; false when there was nothing to pause or the pause failed. */
    pauseIfRunning(): Promise<boolean>;
    /**
     * Disconnects the parent channel: the companion exits and pending work fails. Settles once the process has
     * exited, or after `waitMs` (2.5 s) at most.
     */
    close(options?: { waitMs?: number }): Promise<void>;
}

export function createCompanionClient(options: {
    /** The companion's executable (absolute); empty when the platform has none. */
    nativeExecutablePath?: string;
    /** The companion's own profile folder (absolute). */
    profilePath: string;
    timeoutMs?: number;
    /** Hears a companion start (true) and go (false). */
    onRunningChanged?: (running: boolean) => void;
}): CompanionClient;
